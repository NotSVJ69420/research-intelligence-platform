/**
 * Europe PMC Normalizer
 *
 * Maps a raw Europe PMC article item to the Canonical Paper Schema.
 * Never throws. Missing fields → null.
 */

function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase().trim() || null;
}

function cleanAbstract(rawAbstract) {
  if (!rawAbstract || typeof rawAbstract !== 'string') return null;
  return rawAbstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function extractPdfUrl(raw) {
  // 1. Check fullTextUrlList for explicit PDF documentStyle
  // Note: europepmc.org/articles/*?pdf=render URLs are protected by Cloudflare bot walls and 403 on automated fetch.
  // We prefer direct publisher / archive PDF URLs if available.
  const list = raw?.fullTextUrlList?.fullTextUrl;
  if (Array.isArray(list)) {
    const pdfItem = list.find(item => {
      const style = String(item?.documentStyle || '').toLowerCase();
      const u = String(item?.url || '');
      // Exclude cloudflare-blocked render URLs
      if (u.includes('europepmc.org') && u.includes('pdf=render')) return false;
      return style === 'pdf' || /\.pdf($|\?)/i.test(u);
    });
    if (pdfItem?.url) return pdfItem.url;
  } else if (list && typeof list === 'object') {
    const u = String(list.url || '');
    if (String(list.documentStyle || '').toLowerCase() === 'pdf' && !u.includes('pdf=render')) {
      return list.url;
    }
  }

  return null;
}

/**
 * Normalize a raw Europe PMC article item into the Canonical Paper Schema.
 * @param {object} raw - Raw article item from Europe PMC.
 * @returns {object} Canonical Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    if (!raw || typeof raw !== 'object') {
      return emptyPaper();
    }

    const sourceId = String(raw.id || raw.pmid || '').trim();
    const doi = normalizeDoi(raw.doi);

    // Authors
    let authors = [];
    if (raw.authorString) {
      authors = raw.authorString.split(',').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(raw.authorList?.author)) {
      authors = raw.authorList.author
        .map(a => a?.fullName || [a?.firstName, a?.lastName].filter(Boolean).join(' '))
        .filter(Boolean);
    }

    const year = raw.pubYear ? parseInt(raw.pubYear, 10) || null : null;
    const title = typeof raw.title === 'string'
      ? raw.title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : '';

    const venue = raw.journalTitle || raw.journalInfo?.journal?.title || null;
    const url = doi
      ? `https://doi.org/${doi}`
      : (sourceId ? `https://europepmc.org/article/${raw.source || 'MED'}/${sourceId}` : '');

    const pdfUrl = extractPdfUrl(raw);
    const citationCount = typeof raw.citedByCount === 'number' ? raw.citedByCount : null;

    return {
      id: null,
      source: 'europe_pmc',
      source_id: sourceId,
      title: title || '',
      abstract: cleanAbstract(raw.abstractText),
      authors,
      year,
      venue: typeof venue === 'string' ? venue.trim() : null,
      doi,
      url,
      pdf_url: pdfUrl,
      citation_count: citationCount,
    };
  } catch (err) {
    console.warn('[europepmc-normalizer] failed:', err.message);
    return emptyPaper();
  }
}

function emptyPaper() {
  return {
    id: null,
    source: 'europe_pmc',
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
