/**
 * OpenAlex Normalizer
 *
 * Maps a raw OpenAlex work object to the Standard Paper Schema.
 * Never throws. Missing fields → null.
 */

/**
 * Reconstruct abstract from OpenAlex inverted index.
 * The index maps words to arrays of positional indices.
 * Missing positions are filled with empty strings.
 *
 * @param {object|null|undefined} invertedIndex
 * @returns {string|null}
 */
function reconstructAbstract(invertedIndex) {
  try {
    if (!invertedIndex || typeof invertedIndex !== 'object') return null;

    const entries = Object.entries(invertedIndex);
    if (entries.length === 0) return null;

    // Find the maximum position to size the array
    let maxPos = 0;
    for (const [, positions] of entries) {
      for (const pos of positions) {
        if (pos > maxPos) maxPos = pos;
      }
    }

    // Fill the array: empty strings for gaps
    const words = new Array(maxPos + 1).fill('');
    for (const [word, positions] of entries) {
      for (const pos of positions) {
        words[pos] = word;
      }
    }

    const result = words.join(' ').trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Normalize DOI: strip https://doi.org/ prefix, lowercase.
 * @param {string|null|undefined} doi
 * @returns {string|null}
 */
function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || null;
}

/**
 * Normalize a raw OpenAlex work object into the Standard Paper Schema.
 * @param {object} raw - Raw OpenAlex work object.
 * @returns {object} Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    const authors = Array.isArray(raw.authorships)
      ? raw.authorships
          .map(a => a?.author?.display_name)
          .filter(name => typeof name === 'string' && name.length > 0)
      : [];

    // Extract OpenAlex ID (strip URL prefix if present)
    const rawId = raw.id || '';
    const sourceId = rawId.replace('https://openalex.org/', '');

    // Extract direct PDF link from open_access / locations.
    // ScienceDirect / Elsevier requires institutional login or browser session for direct PDF downloads and returns 403 to server scripts.
    // If an alternate open access repository copy (like arxiv.org or open repos) is available in locations, prefer it.
    const allPdfCandidates = [
      raw.best_oa_location?.pdf_url,
      raw.primary_location?.pdf_url,
      ...(raw.locations?.map(loc => loc?.pdf_url) || []),
      (raw.open_access?.oa_url && /\.pdf($|\?)/i.test(raw.open_access.oa_url) ? raw.open_access.oa_url : null),
    ].filter(Boolean);

    // Prefer non-sciencedirect/non-paywall sources if available
    const pdfUrl =
      allPdfCandidates.find(u => !u.includes('sciencedirect.com')) ||
      allPdfCandidates[0] ||
      null;

    return {
      id: null,
      source: 'openalex',
      source_id: sourceId,
      title: typeof raw.display_name === 'string' ? raw.display_name : (typeof raw.title === 'string' ? raw.title : ''),
      abstract: reconstructAbstract(raw.abstract_inverted_index),
      authors,
      year: typeof raw.publication_year === 'number' ? raw.publication_year : null,
      venue: raw.primary_location?.source?.display_name || null,
      doi: normalizeDoi(raw.doi),
      url: typeof raw.id === 'string' ? raw.id : '',
      pdf_url: pdfUrl,
      citation_count: typeof raw.cited_by_count === 'number' ? raw.cited_by_count : null,
    };
  } catch {
    // Never throw — return a safe empty-ish Paper
    return {
      id: null,
      source: 'openalex',
      source_id: '',
      title: '',
      abstract: null,
      authors: [],
      year: null,
      venue: null,
      doi: null,
      url: '',
      pdf_url: null,
      citation_count: null,
    };
  }
}
