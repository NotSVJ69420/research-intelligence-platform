/**
 * Deduplication Module
 *
 * Pure, deterministic deduplication of normalized Paper objects.
 * Three-tier key strategy:
 *   1. DOI match (normalized: no prefix, lowercased)
 *   2. source + source_id match
 *   3. Fallback: hash(lowercase(trim(title)) + lowercase(trim(firstAuthor)) + year)
 *
 * First paper wins when a duplicate is detected.
 */

import { createHash } from 'crypto';

/**
 * Normalize a DOI for comparison: strip https://doi.org/ prefix, lowercase.
 * @param {string|null} doi
 * @returns {string|null}
 */
function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || null;
}

/**
 * Generate a fallback dedup key from title + first author + year.
 * @param {object} paper
 * @returns {string}
 */
function fallbackKey(paper) {
  const title = (paper.title || '').toLowerCase().trim();
  const firstAuthor = (paper.authors?.[0] || '').toLowerCase().trim();
  const year = paper.year ?? '';
  const raw = `${title}|${firstAuthor}|${year}`;
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Deduplicate an array of normalized Paper objects.
 * @param {object[]} papers - Array of Paper objects (id may be null).
 * @returns {object[]} Deduplicated array. First occurrence wins.
 */
export function deduplicate(papers) {
  if (!Array.isArray(papers)) return [];

  const seenDois = new Set();
  const seenSourceIds = new Set();
  const seenHashes = new Set();
  const result = [];

  for (const paper of papers) {
    // Tier 1: DOI
    const doi = normalizeDoi(paper.doi);
    if (doi) {
      if (seenDois.has(doi)) continue;
      seenDois.add(doi);
    }

    // Tier 2: source + source_id
    const sourceKey = `${paper.source}:${paper.source_id}`;
    if (paper.source_id) {
      if (seenSourceIds.has(sourceKey)) continue;
      seenSourceIds.add(sourceKey);
    }

    // Tier 3: fallback hash
    const hash = fallbackKey(paper);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    result.push(paper);
  }

  return result;
}
