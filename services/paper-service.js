/**
 * Paper Service
 *
 * The sole intermediary between IPC and ingestion/database/filesystem.
 * IPC handlers call ONLY this service. Never ingestion, DB, or raw fs directly.
 *
 * Responsibilities:
 *   - Workspace config: canonical <workspaceRoot>/raw_papers/ directory
 *   - searchAndStore: orchestrator → insert with DB-level dedup → return with DB-consistent IDs
 *   - downloadPaperPdf: safe atomic PDF acquisition, validation, deduplication, and DB linking
 *   - getLibraryPapers: auto-scan raw_papers/ directory and map to PostgreSQL paper records
 *   - addManualPaper: copy PDF to raw_papers/ and record in database
 *   - getAllPapers, getPaperById, deletePaper: relational CRUD operations
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import { query } from './db.js';
import { searchPapers as orchestratorSearch } from '../ingestion/search-orchestrator.js';

// ─── Workspace Configuration ──────────────────────────────────────────

/**
 * Get canonical workspace paths.
 * Canonical path: <workspaceRoot>/raw_papers/
 * @returns {{ workspaceRoot: string, rawPapersDir: string }}
 */
export function getWorkspaceConfig() {
  const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
  const rawPapersDir = path.join(workspaceRoot, 'raw_papers');
  return {
    workspaceRoot,
    rawPapersDir,
  };
}

/**
 * Ensure canonical raw_papers directory exists.
 * @returns {Promise<string>} Absolute path to raw_papers
 */
export async function ensureRawPapersDir() {
  const { rawPapersDir } = getWorkspaceConfig();
  await fs.mkdir(rawPapersDir, { recursive: true });
  return rawPapersDir;
}

// ─── INSERT & SELECT SQL ──────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO papers (id, source, source_id, title, abstract, authors, year, venue, doi, url, pdf_url, citation_count, local_pdf_path)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT DO NOTHING
`;

const SELECT_WITH_DOI_SQL = `
  SELECT id, local_pdf_path FROM papers
  WHERE (source = $1 AND source_id = $2)
     OR (doi IS NOT NULL AND doi = $3)
  ORDER BY (source = $1 AND source_id = $2) DESC
  LIMIT 1
`;

const SELECT_NO_DOI_SQL = `
  SELECT id, local_pdf_path FROM papers
  WHERE source = $1 AND source_id = $2
  LIMIT 1
`;

// ─── Helpers ──────────────────────────────────────────────────────────

function sanitizeForInsert(paper) {
  paper.year = Number(paper.year) || null;
  paper.authors = Array.isArray(paper.authors) ? paper.authors : [];
  return paper;
}

async function fetchDbRow(paper) {
  let result;
  if (paper.doi) {
    result = await query(SELECT_WITH_DOI_SQL, [paper.source, paper.source_id, paper.doi]);
  } else {
    result = await query(SELECT_NO_DOI_SQL, [paper.source, paper.source_id]);
  }
  return result.rows[0] || null;
}

// ─── Search & Ingestion ───────────────────────────────────────────────

/**
 * Search papers via orchestrator, store in PostgreSQL, and return DB-consistent entities.
 */
export async function searchAndStore(queryStr, sources = ['openalex', 'arxiv'], limit = 20, sortBy = 'date') {
  const papers = await orchestratorSearch(queryStr, sources, limit, sortBy);
  if (papers.length === 0) return { succeeded: [], failed: [] };

  const succeeded = [];
  const failed = [];

  for (const paper of papers) {
    try {
      sanitizeForInsert(paper);

      await query(INSERT_SQL, [
        paper.id,
        paper.source,
        paper.source_id,
        paper.title,
        paper.abstract,
        JSON.stringify(paper.authors),
        paper.year,
        paper.venue || null,
        paper.doi || null,
        paper.url,
        paper.pdf_url || null,
        paper.citation_count,
        null,
      ]);

      const dbRow = await fetchDbRow(paper);
      if (dbRow) {
        paper.id = dbRow.id;
        if (dbRow.local_pdf_path) {
          paper.local_pdf_path = dbRow.local_pdf_path;
        }
      }
      succeeded.push(paper);
    } catch (err) {
      console.warn(`[paper-service] insert failed:`, err.message);
      failed.push({ paper, error: err.message });
    }
  }

  return { succeeded, failed };
}

// ─── PDF Acquisition & Filesystem Contract ───────────────────────────

/**
 * Download a paper PDF, validate headers, deduplicate against existing files,
 * and atomically place it into the destination directory.
 *
 * @param {object} params
 * @param {string|null} [params.paperId] - Canonical paper UUID
 * @param {string} params.url - Remote PDF URL
 * @param {string|null} [params.targetDirectory] - Custom directory or null for default raw_papers/
 * @param {string|null} [params.filename] - Base title for filename
 * @returns {Promise<{ localPath: string, relativePath: string|null, filename: string, alreadyExists: boolean }>}
 */
export async function downloadPaperPdf({ paperId, url, targetDirectory, filename }) {
  if (!url) throw new Error('PDF URL is required');

  const { rawPapersDir, workspaceRoot } = getWorkspaceConfig();
  const dir = targetDirectory || rawPapersDir;
  await fs.mkdir(dir, { recursive: true });

  const safeTitle = (filename || 'paper')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);

  // Deterministic filename: include paper UUID suffix when available for reverse mapping
  const pdfFileName = paperId ? `${safeTitle}--${paperId}.pdf` : `${safeTitle}.pdf`;
  const destPath = path.join(dir, pdfFileName);

  // Compute workspace-relative path if inside workspace
  const isInsideWorkspace = !path.relative(workspaceRoot, destPath).startsWith('..') && !path.isAbsolute(path.relative(workspaceRoot, destPath));
  const relPath = isInsideWorkspace ? path.relative(workspaceRoot, destPath).replace(/\\/g, '/') : null;

  // 1. Deduplication check: check if file already exists with valid %PDF- magic bytes
  try {
    const stat = await fs.stat(destPath);
    if (stat.size > 5) {
      const fileHandle = await fs.open(destPath, 'r');
      const headerBuf = Buffer.alloc(5);
      await fileHandle.read(headerBuf, 0, 5, 0);
      await fileHandle.close();

      if (headerBuf.toString('ascii') === '%PDF-') {
        // File already present in destination. Update DB pointer without redownload.
        if (paperId) {
          const pathToSave = relPath || destPath;
          await query('UPDATE papers SET local_pdf_path = $1 WHERE id = $2', [pathToSave, paperId]).catch(() => {});
        }
        return {
          localPath: destPath,
          relativePath: relPath,
          filename: pdfFileName,
          alreadyExists: true,
        };
      }
    }
  } catch {
    // Destination file does not exist, continue to download
  }

  // 2. Safe download to an isolated temp directory outside raw_papers/
  const tempPath = path.join(os.tmpdir(), `rie-dl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.tmp`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Invalid content-type "${contentType}": URL returned HTML instead of PDF`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate %PDF- header magic bytes
    if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') {
      throw new Error('Downloaded file is not a valid PDF (missing %PDF- header)');
    }

    // Write buffer to external temp file
    await fs.writeFile(tempPath, buffer);

    // Atomically copy to target destination, then unlink temp
    await fs.copyFile(tempPath, destPath);
    await fs.unlink(tempPath).catch(() => {});

    // 3. Update database record with relative path for cross-device sync
    if (paperId) {
      const pathToSave = relPath || destPath;
      await query('UPDATE papers SET local_pdf_path = $1 WHERE id = $2', [pathToSave, paperId]).catch(() => {});
    }

    return {
      localPath: destPath,
      relativePath: relPath,
      filename: pdfFileName,
      alreadyExists: false,
    };
  } catch (err) {
    // Clean up temporary download file if anything failed
    await fs.unlink(tempPath).catch(() => {});
    throw new Error(`Download failed: ${err.message}`);
  }
}

// ─── Automatic Library Discovery & Indexing ───────────────────────────

/**
 * Scan raw_papers/ and map files to canonical PostgreSQL paper records.
 * Discovered external PDFs are included with transparent 'External File' metadata.
 *
 * @returns {Promise<object[]>} Array of indexed library paper items
 */
export async function getLibraryPapers() {
  const { rawPapersDir, workspaceRoot } = getWorkspaceConfig();
  await ensureRawPapersDir();

  // 1. Scan filesystem in raw_papers/
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(rawPapersDir, { withFileTypes: true });
  } catch (err) {
    console.warn('[paper-service] failed to read raw_papers directory:', err.message);
  }

  const pdfFiles = dirEntries
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.pdf'))
    .map(d => d.name);

  // 2. Fetch all paper records from PostgreSQL
  let dbPapers = [];
  try {
    const res = await query('SELECT * FROM papers ORDER BY created_at DESC');
    dbPapers = res.rows || [];
  } catch (err) {
    console.warn('[paper-service] failed to query papers table:', err.message);
  }

  // Build lookups for fast, deterministic file ↔ record association
  const paperById = new Map();
  const paperByRelPath = new Map();
  const paperByFilename = new Map();
  const matchedPaperIds = new Set();

  for (const p of dbPapers) {
    paperById.set(p.id, p);
    if (p.local_pdf_path) {
      const norm = p.local_pdf_path.replace(/\\/g, '/');
      paperByRelPath.set(norm, p);
      paperByFilename.set(path.basename(norm), p);
    }
  }

  const libraryResults = [];
  const uuidSuffixRegex = /--([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.pdf$/i;

  // 3. Match discovered PDF files against database
  for (const filename of pdfFiles) {
    const fullPath = path.join(rawPapersDir, filename);
    const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

    let matchedPaper = null;

    // Check 1: Deterministic UUID suffix in filename (--<uuid>.pdf)
    const match = filename.match(uuidSuffixRegex);
    if (match && paperById.has(match[1])) {
      matchedPaper = paperById.get(match[1]);
    }

    // Check 2: Match by local_pdf_path stored in database
    if (!matchedPaper) {
      matchedPaper = paperByRelPath.get(relPath) || paperByFilename.get(filename);
    }

    // Check 3: Match by source_id inside filename (e.g. arXiv identifier)
    if (!matchedPaper) {
      for (const p of dbPapers) {
        if (matchedPaperIds.has(p.id)) continue;
        if (p.source_id && filename.includes(p.source_id.replace(/[^a-zA-Z0-9_\-]/g, ''))) {
          matchedPaper = p;
          break;
        }
      }
    }

    if (matchedPaper) {
      matchedPaperIds.add(matchedPaper.id);

      // Reconcile database pointer if it was missing or points to old location
      if (matchedPaper.local_pdf_path !== relPath) {
        matchedPaper.local_pdf_path = relPath;
        query('UPDATE papers SET local_pdf_path = $1 WHERE id = $2', [relPath, matchedPaper.id]).catch(() => {});
      }

      libraryResults.push({
        ...matchedPaper,
        local_pdf_path: fullPath,
        pdfPath: fullPath,
        hasLocalPdf: true,
        isExternal: false,
      });
    } else {
      // Discovered an external PDF placed into raw_papers/ without prior DB record
      const cleanTitle = filename
        .replace(/\.pdf$/i, '')
        .replace(/--[0-9a-fA-F-]{36}$/i, '')
        .replace(/[_\-]+/g, ' ')
        .trim();

      libraryResults.push({
        id: `ext-${filename}`,
        title: cleanTitle || filename,
        authors: ['External Document'],
        year: null,
        venue: 'raw_papers/',
        source: 'local',
        doi: null,
        local_pdf_path: fullPath,
        pdfPath: fullPath,
        hasLocalPdf: true,
        isExternal: true,
      });
    }
  }

  // 4. Include any other DB papers that have an active local_pdf_path on disk
  for (const p of dbPapers) {
    if (matchedPaperIds.has(p.id)) continue;
    if (!p.local_pdf_path) continue;

    const fullPath = path.isAbsolute(p.local_pdf_path)
      ? p.local_pdf_path
      : path.join(workspaceRoot, p.local_pdf_path);

    try {
      await fs.access(fullPath);
      libraryResults.push({
        ...p,
        local_pdf_path: fullPath,
        pdfPath: fullPath,
        hasLocalPdf: true,
        isExternal: false,
      });
      matchedPaperIds.add(p.id);
    } catch {
      // File no longer on disk; leave out of active local library
    }
  }

  return libraryResults;
}

/**
 * Manually add a paper to the library.
 * Copies PDF to raw_papers/ and creates a canonical PostgreSQL record.
 */
export async function addManualPaper({ title, authors, year, pdfPath }) {
  if (!title || !pdfPath) {
    throw new Error('Title and PDF are required');
  }

  const { rawPapersDir, workspaceRoot } = getWorkspaceConfig();
  await ensureRawPapersDir();

  const id = crypto.randomUUID();
  const cleanTitle = String(title).replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 80);
  const destFilename = `${cleanTitle}--${id}.pdf`;
  const destPath = path.join(rawPapersDir, destFilename);

  await fs.copyFile(pdfPath, destPath);

  const authorsArr = typeof authors === 'string'
    ? authors.split(',').map(a => a.trim()).filter(Boolean)
    : (Array.isArray(authors) ? authors : []);

  const relPath = path.relative(workspaceRoot, destPath).replace(/\\/g, '/');

  await query(INSERT_SQL, [
    id,
    'manual',
    id,
    String(title).trim(),
    '',
    JSON.stringify(authorsArr),
    year ? parseInt(year, 10) || null : null,
    'Manual Entry',
    null,
    '',
    null,
    0,
    relPath,
  ]);

  return {
    id,
    title: String(title).trim(),
    authors: authorsArr,
    year: year ? String(year).trim() : '',
    local_pdf_path: destPath,
    pdfPath: destPath,
    hasLocalPdf: true,
    isExternal: false,
  };
}

// ─── General CRUD Operations ──────────────────────────────────────────

export async function getAllPapers(limit = 50) {
  const result = await query(
    'SELECT * FROM papers ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

export async function getPaperById(id) {
  const result = await query('SELECT * FROM papers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function deletePaper(id) {
  const result = await query('DELETE FROM papers WHERE id = $1', [id]);
  return result.rowCount > 0;
}
