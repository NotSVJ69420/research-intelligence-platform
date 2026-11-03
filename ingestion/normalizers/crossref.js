/**
 * Crossref Normalizer
 *
 * Maps a raw Crossref work item to the Canonical Paper Schema.
 * Never throws. Missing fields → null.
 */

function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase().trim() || null;
}

function cleanAbstract(rawAbstract) {
  if (!rawAbstract || typeof rawAbstract !== 'string') return null;
  // Strip JATS / XML tags and collapse whitespace
  const cleaned = rawAbstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function extractYear(raw) {
  const dateParts =
    raw['published-print']?.['date-parts']?.[0] ||
    raw['published-online']?.['date-parts']?.[0] ||
    raw.issued?.['date-parts']?.[0] ||
    raw.created?.['date-parts']?.[0];

  if (Array.isArray(dateParts) && typeof dateParts[0] === 'number') {
    return dateParts[0];
  }
  return null;
}

const BOT_WALLED_HOSTS = ['sciencedirect.com', 'royalsocietypublishing.org', 'mdpi.com', 'wiley.com'];

function extractPdfUrl(raw) {
  if (!Array.isArray(raw.link)) return null;
  const pdfLink = raw.link.find(l => {
    const ct = String(l?.['content-type'] || '').toLowerCase();
    const url = String(l?.URL || '').toLowerCase();
    const isPdf = ct.includes('application/pdf') || ct.includes('pdf') || /\.pdf($|\?)/i.test(url) || url.includes('/pdf/');
    const isBlocked = BOT_WALLED_HOSTS.some(h => url.includes(h));
    return isPdf && !isBlocked;
  });
  return pdfLink?.URL || null;
}

/**
 * Normalize a raw Crossref work item into the Canonical Paper Schema.
 * @param {object} raw - Raw work item from Crossref.
 * @returns {object} Canonical Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    if (!raw || typeof raw !== 'object') {
      return emptyPaper();
    }

    const doi = normalizeDoi(raw.DOI);
    const sourceId = doi || raw.id || '';

    // Title can be string or array of strings
    let title = '';
    if (Array.isArray(raw.title)) {
      title = raw.title.join(' ');
    } else if (typeof raw.title === 'string') {
      title = raw.title;
    }
    title = title.replace(/\s+/g, ' ').trim();

    // Authors
    const authors = Array.isArray(raw.author)
      ? raw.author
          .map(a => {
            if (typeof a === 'string') return a;
            const full = [a?.given, a?.family].filter(Boolean).join(' ');
            return full || a?.name || '';
          })
          .filter(name => typeof name === 'string' && name.trim().length > 0)
      : [];

    // Venue / Container
    let venue = null;
    if (Array.isArray(raw['container-title']) && raw['container-title'].length > 0) {
      venue = String(raw['container-title'][0]).trim();
    } else if (typeof raw['container-title'] === 'string') {
      venue = raw['container-title'].trim();
    }

    const year = extractYear(raw);
    const url = raw.URL || (doi ? `https://doi.org/${doi}` : '');
    const pdfUrl = extractPdfUrl(raw);
    const citationCount = typeof raw['is-referenced-by-count'] === 'number'
      ? raw['is-referenced-by-count']
      : null;

    return {
      id: null,
      source: 'crossref',
      source_id: sourceId,
      title: title || '',
      abstract: cleanAbstract(raw.abstract),
      authors,
      year,
      venue: venue || null,
      doi,
      url,
      pdf_url: pdfUrl,
      citation_count: citationCount,
    };
  } catch (err) {
    console.warn('[crossref-normalizer] failed:', err.message);
    return emptyPaper();
  }
}

function emptyPaper() {
  return {
    id: null,
    source: 'crossref',
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
