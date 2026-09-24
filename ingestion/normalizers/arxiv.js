/**
 * arXiv Normalizer
 *
 * Maps a raw arXiv entry object (parsed from XML) to the Standard Paper Schema.
 * Never throws. Missing fields → null.
 */

/**
 * Extract the bare arXiv ID from the full entry ID URL.
 * Input:  "http://arxiv.org/abs/2301.12345v1"
 * Output: "2301.12345v1"
 *
 * @param {string} fullId
 * @returns {string}
 */
function extractArxivId(fullId) {
  if (!fullId || typeof fullId !== 'string') return '';
  return fullId.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').trim();
}

/**
 * Extract text from an xml2js node. 
 * If it's a string, return it.
 * If it's an object, return the "_" property (text content).
 */
function getText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && node._) return node._;
  return '';
}

/**
 * Normalize a raw arXiv entry into the Standard Paper Schema.
 * @param {object} raw - Raw arXiv entry object from xml2js.
 * @returns {object} Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    // xml2js may return single author as object or array of objects
    let rawAuthors = raw.author;
    if (!rawAuthors) {
      rawAuthors = [];
    } else if (!Array.isArray(rawAuthors)) {
      rawAuthors = [rawAuthors];
    }
    const authors = rawAuthors
      .map(a => getText(typeof a === 'string' ? a : a?.name))
      .filter(name => name.length > 0);

    // Extract year from published date (e.g. "2023-01-15T00:00:00Z")
    const published = getText(raw.published);
    const yearMatch = published.match(/^(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Build bare ID and PDF URL
    const rawId = getText(raw.id);
    const bareId = extractArxivId(rawId);
    const pdfUrl = bareId ? `https://arxiv.org/pdf/${bareId}.pdf` : null;

    // Clean title (xml2js may include newlines)
    const title = getText(raw.title).replace(/\s+/g, ' ').trim();

    // Clean abstract
    const summary = getText(raw.summary).replace(/\s+/g, ' ').trim();

    return {
      id: null,
      source: 'arxiv',
      source_id: bareId,
      title: title || '',
      abstract: summary || null,
      authors,
      year,
      venue: null,
      doi: null,
      url: rawId,
      pdf_url: pdfUrl,
      citation_count: null,
    };
  } catch (err) {
    console.warn('[arxiv-normalizer] failed:', err.message);
    // Never throw — return a safe empty-ish Paper
    return {
      id: null,
      source: 'arxiv',
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
