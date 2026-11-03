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

  const result = [];
  // Map of canonical key -> paper in result array for merging enriched metadata
  const mapByKey = new Map();

  for (const paper of papers) {
    const doi = normalizeDoi(paper.doi);
    const sourceKey = paper.source_id ? `${paper.source}:${paper.source_id}` : null;
    const hash = fallbackKey(paper);

    // Check if duplicate already seen
    const existing =
      (doi && mapByKey.get(`doi:${doi}`)) ||
      (sourceKey && mapByKey.get(`src:${sourceKey}`)) ||
      mapByKey.get(`hash:${hash}`);

    if (existing) {
      // Merge best fields into existing: especially pdf_url, abstract, venue, citation_count
      if (!existing.pdf_url && paper.pdf_url) existing.pdf_url = paper.pdf_url;
      if (!existing.abstract && paper.abstract) existing.abstract = paper.abstract;
      if (!existing.venue && paper.venue) existing.venue = paper.venue;
      if (!existing.doi && paper.doi) existing.doi = paper.doi;
      if ((existing.citation_count == null) && (paper.citation_count != null)) {
        existing.citation_count = paper.citation_count;
      }
      continue;
    }

    result.push(paper);

    if (doi) mapByKey.set(`doi:${doi}`, paper);
    if (sourceKey) mapByKey.set(`src:${sourceKey}`, paper);
    mapByKey.set(`hash:${hash}`, paper);
  }

  return result;
}
