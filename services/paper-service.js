/**
 * Paper Service
 *
 * The sole intermediary between IPC and ingestion/database.
 * IPC handlers call ONLY this service. Never ingestion or DB directly.
 *
 * Responsibilities:
 *   - searchAndStore: orchestrator → insert with DB-level dedup → return with DB-consistent IDs
 *   - getAllPapers: read from DB with default limit
 *   - getPaperById: single paper lookup, returns null if not found
 *   - deletePaper: remove paper, returns true/false
 */

import { query } from './db.js';
import { searchPapers as orchestratorSearch } from '../ingestion/search-orchestrator.js';

// ─── INSERT ───────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO papers (id, source, source_id, title, abstract, authors, year, venue, doi, url, pdf_url, citation_count)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT DO NOTHING
`;

// ─── SELECT (with DOI fallback, preferring source match) ──────────────

const SELECT_WITH_DOI_SQL = `
  SELECT id FROM papers
  WHERE (source = $1 AND source_id = $2)
     OR (doi IS NOT NULL AND doi = $3)
  ORDER BY (source = $1 AND source_id = $2) DESC
  LIMIT 1
`;

const SELECT_NO_DOI_SQL = `
  SELECT id FROM papers
  WHERE source = $1 AND source_id = $2
  LIMIT 1
`;

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Safely prepare a paper for DB insertion:
 *   - Normalize year to integer or null
 *   - Guard authors to always be an array
 * @param {object} paper
 * @returns {object} The same paper, mutated in place
 */
function sanitizeForInsert(paper) {
  paper.year = Number(paper.year) || null;
  paper.authors = Array.isArray(paper.authors) ? paper.authors : [];
  return paper;
}

/**
 * Fetch the actual DB row ID for a paper, using source+source_id
 * with DOI fallback (only when DOI exists).
 * @param {object} paper
 * @returns {Promise<string|null>} DB UUID or null
 */
async function fetchDbId(paper) {
  let result;
  if (paper.doi) {
    result = await query(SELECT_WITH_DOI_SQL, [paper.source, paper.source_id, paper.doi]);
  } else {
    result = await query(SELECT_NO_DOI_SQL, [paper.source, paper.source_id]);
  }
  return result.rows[0]?.id || null;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Search for papers via the ingestion orchestrator, store results in DB,
 * and return them with DB-consistent IDs.
 *
 * @param {string} queryStr - Search query.
 * @param {string[]} sources - Source names (e.g., ["openalex", "arxiv"]).
 * @param {number} limit - Max results.
 * @param {'date'|'citations'} sortBy - Sort strategy.
 * @returns {Promise<object[]>} Papers with DB-consistent UUIDs.
 */
export async function searchAndStore(queryStr, sources = ['openalex', 'arxiv'], limit = 20, sortBy = 'date') {
  // Step 1: Get papers from orchestrator
  const papers = await orchestratorSearch(queryStr, sources, limit, sortBy);
  if (papers.length === 0) return { succeeded: [], failed: [] };

  const succeeded = [];
  const failed = [];

  // Step 2: Insert each sequentially, fetch actual DB ID
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
      ]);

      // Fetch actual DB row ID (handles ON CONFLICT cases)
      const dbId = await fetchDbId(paper);
      if (dbId) {
        paper.id = dbId;
      }
      succeeded.push(paper);
    } catch (err) {
      console.warn(`[paper-service] insert failed:`, err.message);
      failed.push({ paper, error: err.message });
    }
  }

  return { succeeded, failed };
}

/**
 * Get all papers from the database.
 * @param {number} limit - Max papers to return (default 50).
 * @returns {Promise<object[]>} Array of Paper objects.
 */
export async function getAllPapers(limit = 50) {
  const result = await query(
    'SELECT * FROM papers ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

/**
 * Get a single paper by UUID.
 * @param {string} id - Paper UUID.
 * @returns {Promise<object|null>} Paper object or null if not found.
 */
export async function getPaperById(id) {
  const result = await query('SELECT * FROM papers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Delete a paper by UUID.
 * @param {string} id - Paper UUID.
 * @returns {Promise<boolean>} true if deleted, false if not found.
 */
export async function deletePaper(id) {
  const result = await query('DELETE FROM papers WHERE id = $1', [id]);
  return result.rowCount > 0;
}
