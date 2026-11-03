/**
 * Semantic Scholar Normalizer
 *
 * Maps a raw Semantic Scholar paper object to the Canonical Paper Schema.
 * Never throws. Missing fields → null.
 */

function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase().trim() || null;
}

/**
 * Normalize a raw Semantic Scholar paper object into the Canonical Paper Schema.
 * @param {object} raw - Raw paper object from S2 Graph API.
 * @returns {object} Canonical Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    if (!raw || typeof raw !== 'object') {
      return emptyPaper();
    }

    const authors = Array.isArray(raw.authors)
      ? raw.authors
          .map(a => (typeof a === 'string' ? a : a?.name))
          .filter(name => typeof name === 'string' && name.trim().length > 0)
      : [];

    const sourceId = raw.paperId || '';
    const doi = normalizeDoi(raw.externalIds?.DOI);
    const url = raw.url || (sourceId ? `https://www.semanticscholar.org/paper/${sourceId}` : '');
    const pdfUrl = raw.openAccessPdf?.url || null;

    return {
      id: null,
      source: 'semantic_scholar',
      source_id: sourceId,
      title: typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim() : '',
      abstract: typeof raw.abstract === 'string' ? raw.abstract.replace(/\s+/g, ' ').trim() : null,
      authors,
      year: typeof raw.year === 'number' ? raw.year : null,
      venue: typeof raw.venue === 'string' && raw.venue.trim().length > 0 ? raw.venue.trim() : null,
      doi,
      url,
      pdf_url: pdfUrl,
      citation_count: typeof raw.citationCount === 'number' ? raw.citationCount : null,
    };
  } catch (err) {
    console.warn('[semanticscholar-normalizer] failed:', err.message);
    return emptyPaper();
  }
}

function emptyPaper() {
  return {
    id: null,
    source: 'semantic_scholar',
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
