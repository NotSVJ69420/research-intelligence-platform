/**
 * PubMed / NCBI Normalizer
 *
 * Maps a raw parsed PubmedArticle XML object to the Canonical Paper Schema.
 * Never throws. Missing fields → null.
 */

function getText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    if (node._) return String(node._);
    if (Array.isArray(node)) return node.map(getText).join(' ');
  }
  return '';
}

function normalizeDoi(doi) {
  if (!doi || typeof doi !== 'string') return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase().trim() || null;
}

function extractPmid(raw) {
  const pmidNode = raw?.MedlineCitation?.PMID;
  return getText(pmidNode).trim();
}

function extractArticleIds(raw) {
  let ids = raw?.PubmedData?.ArticleIdList?.ArticleId;
  if (!ids) return { doi: null, pmc: null };
  if (!Array.isArray(ids)) ids = [ids];

  let doi = null;
  let pmc = null;

  for (const item of ids) {
    const idType = item?.$?.IdType || item?.IdType;
    const val = getText(item).trim();
    if (idType === 'doi' && !doi) {
      doi = normalizeDoi(val);
    } else if (idType === 'pmc' && !pmc) {
      pmc = val.toUpperCase().startsWith('PMC') ? val.toUpperCase() : `PMC${val}`;
    }
  }

  // Fallback: check Article.ELocationID for DOI
  if (!doi) {
    let elocs = raw?.MedlineCitation?.Article?.ELocationID;
    if (elocs) {
      if (!Array.isArray(elocs)) elocs = [elocs];
      for (const eloc of elocs) {
        const eType = eloc?.$?.EIdType || eloc?.EIdType;
        if (eType === 'doi') {
          doi = normalizeDoi(getText(eloc));
          break;
        }
      }
    }
  }

  return { doi, pmc };
}

function extractAuthors(raw) {
  const authorNode = raw?.MedlineCitation?.Article?.AuthorList?.Author;
  if (!authorNode) return [];
  const list = Array.isArray(authorNode) ? authorNode : [authorNode];

  return list
    .map(a => {
      const collective = getText(a?.CollectiveName);
      if (collective) return collective;
      const last = getText(a?.LastName);
      const fore = getText(a?.ForeName);
      const full = [fore, last].filter(Boolean).join(' ');
      return full || getText(a);
    })
    .filter(name => typeof name === 'string' && name.trim().length > 0);
}

function extractYear(raw) {
  const journalIssue = raw?.MedlineCitation?.Article?.Journal?.JournalIssue;
  const pubDate = journalIssue?.PubDate;
  if (!pubDate) return null;

  const yearStr = getText(pubDate?.Year);
  if (yearStr) {
    const y = parseInt(yearStr, 10);
    if (!isNaN(y)) return y;
  }

  const medlineDate = getText(pubDate?.MedlineDate);
  const match = medlineDate.match(/\b(19\d\d|20\d\d)\b/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

function extractAbstract(raw) {
  const abstractNode = raw?.MedlineCitation?.Article?.Abstract?.AbstractText;
  if (!abstractNode) return null;

  if (Array.isArray(abstractNode)) {
    const parts = abstractNode
      .map(part => {
        const label = part?.$?.Label ? `${part.$.Label}: ` : '';
        return `${label}${getText(part)}`.trim();
      })
      .filter(Boolean);
    return parts.join('\n\n') || null;
  }

  const text = getText(abstractNode).replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Normalize a raw PubMed article item into the Canonical Paper Schema.
 * @param {object} raw - Raw parsed PubmedArticle XML object.
 * @returns {object} Canonical Paper object (id is null — assigned by orchestrator).
 */
export function normalize(raw) {
  try {
    if (!raw || typeof raw !== 'object') {
      return emptyPaper();
    }

    const pmid = extractPmid(raw);
    const { doi, pmc } = extractArticleIds(raw);
    const sourceId = pmid || doi || '';

    const title = getText(raw?.MedlineCitation?.Article?.ArticleTitle)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const abstract = extractAbstract(raw);
    const authors = extractAuthors(raw);
    const year = extractYear(raw);
    const venue = getText(raw?.MedlineCitation?.Article?.Journal?.Title) || null;

    const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (doi ? `https://doi.org/${doi}` : '');
    // Note: PMC direct /pdf/ URLs are now protected by NCBI Proof-of-Work (PoW) anti-bot challenges
    // that return HTML pages ("Preparing to download...") causing download failures.
    // We leave pdf_url as null here; let Unpaywall/cross-provider deduplication supply working OA links.
    const pdfUrl = null;

    return {
      id: null,
      source: 'pubmed',
      source_id: sourceId,
      title: title || '',
      abstract,
      authors,
      year,
      venue: venue ? venue.trim() : null,
      doi,
      url,
      pdf_url: pdfUrl,
      citation_count: null,
    };
  } catch (err) {
    console.warn('[pubmed-normalizer] failed:', err.message);
    return emptyPaper();
  }
}

function emptyPaper() {
  return {
    id: null,
    source: 'pubmed',
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
