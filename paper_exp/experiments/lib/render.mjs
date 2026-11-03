// Render a ground-truth work into the *raw response shape* that each repository
// normalizer consumes. Field names/shapes are taken from what the repo's normalizers
// and unit-test fixtures read (ingestion/normalizers/*.js, test/test-all-providers.js);
// they are a reconstruction, NOT recorded live API traffic.
//
// `style` options control how metadata strings are written, so that cross-source
// disagreement can be introduced one factor at a time.

const fullName = (a) => `${a.given} ${a.family}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function invertedIndex(text) {
  const idx = {};
  text.split(/\s+/).forEach((w, i) => { (idx[w] ||= []).push(i); });
  return idx;
}

export function renderOpenAlex(w, st = {}) {
  return {
    id: `https://openalex.org/W${2000000000 + w.wid}`,
    doi: `https://doi.org/${w.doi}`,
    display_name: st.title ?? w.title,
    publication_year: st.year ?? w.year,
    authorships: w.authors.map(a => ({ author: { display_name: (st.authorFmt ?? fullName)(a) } })),
    abstract_inverted_index: invertedIndex(w.abstract),
    cited_by_count: w.citations,
    primary_location: { source: { display_name: w.venue }, pdf_url: null },
    best_oa_location: null,
    locations: [],
    open_access: {},
  };
}

export function renderS2(w, st = {}) {
  return {
    paperId: w.s2Id,
    title: st.title ?? w.title,
    abstract: w.abstract,
    authors: w.authors.map(a => ({ name: (st.authorFmt ?? fullName)(a) })),
    year: st.year ?? w.year,
    venue: w.venue,
    externalIds: { DOI: w.doi, ...(w.arxivId ? { ArXiv: w.arxivId } : {}) },
    url: `https://www.semanticscholar.org/paper/${w.s2Id}`,
    openAccessPdf: null,
    citationCount: w.citations,
  };
}

export function renderCrossref(w, st = {}) {
  return {
    DOI: w.doi,
    title: [st.title ?? w.title],
    abstract: `<jats:p>${esc(w.abstract)}</jats:p>`,
    author: w.authors.map(a => ({ given: a.given, family: a.family })),
    'published-print': { 'date-parts': [[st.year ?? w.year, 1, 1]] },
    'container-title': [w.venue],
    URL: `https://doi.org/${w.doi}`,
    'is-referenced-by-count': w.citations,
    link: [],
  };
}

export function renderEuropePmc(w, st = {}) {
  const authorString = w.authors.map(a => (st.authorFmt ? st.authorFmt(a) : `${a.family} ${a.given[0]}`)).join(', ');
  return {
    id: w.pmid,
    source: 'MED',
    pmid: w.pmid,
    doi: w.doi,
    title: st.title ?? w.title,
    authorString,
    pubYear: String(st.year ?? w.year),
    journalTitle: w.venue,
    abstractText: w.abstract,
    citedByCount: w.citations,
  };
}

/** PubMed: returns the <PubmedArticle> XML fragment. */
export function renderPubmedXml(w, st = {}) {
  const authors = w.authors.map(a => {
    if (st.authorFmt) return `<Author><LastName>${esc(a.family)}</LastName><ForeName>${esc(st.authorFmt(a))}</ForeName></Author>`;
    return `<Author><LastName>${esc(a.family)}</LastName><ForeName>${esc(a.given)}</ForeName></Author>`;
  }).join('');
  return `<PubmedArticle><MedlineCitation><PMID Version="1">${w.pmid}</PMID><Article><Journal><JournalIssue><PubDate><Year>${st.year ?? w.year}</Year></PubDate></JournalIssue><Title>${esc(w.venue)}</Title></Journal><ArticleTitle>${esc(st.title ?? w.title)}</ArticleTitle><Abstract><AbstractText>${esc(w.abstract)}</AbstractText></Abstract><AuthorList>${authors}</AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">${w.pmid}</ArticleId><ArticleId IdType="doi">${w.doi}</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`;
}

/** arXiv Atom entry (no DOI; year = year of first submission). */
export function renderArxivEntry(w, st = {}) {
  const y = st.year ?? w.preprintYear ?? w.year;
  const authors = w.authors.map(a => `<author><name>${esc((st.authorFmt ?? fullName)(a))}</name></author>`).join('');
  return `<entry><id>http://arxiv.org/abs/${w.arxivId}v1</id><updated>${y}-06-01T00:00:00Z</updated><published>${y}-01-15T00:00:00Z</published><title>${esc((st.title ?? w.title).replace(/ /g, '\n  ').replace(/\n {2}/, ' '))}</title><summary>${esc(w.abstract)}</summary>${authors}</entry>`;
}

export const wrapArxivFeed = (entries) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>query</title>${entries.join('')}</feed>`;
export const wrapPubmedSet = (items) => `<?xml version="1.0"?><PubmedArticleSet>${items.join('')}</PubmedArticleSet>`;

// --- author / title perturbation functions (single-factor) ---
export const authorFmts = {
  full: fullName,
  initialDotFamily: (a) => `${a.given[0]}. ${a.family}`,     // "A. Vaswani"
  familyInitial: (a) => `${a.family} ${a.given[0]}`,          // "Vaswani A"  (Europe PMC style, cf. repo fixture 'Doudna JA')
};
