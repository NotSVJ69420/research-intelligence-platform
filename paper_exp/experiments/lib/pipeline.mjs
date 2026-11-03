// Helpers that route synthetic provider payloads through the repository's REAL normalizers
// and replicate orchestrator steps 1-3 using the repository's real source modules and ranker,
// so that the pre-deduplication candidate list can be inspected (the orchestrator does not expose it).
import { parseStringPromise } from 'xml2js';
import { normalize as nOpenAlex } from '../../../ingestion/normalizers/openalex.js';
import { normalize as nArxiv } from '../../../ingestion/normalizers/arxiv.js';
import { normalize as nS2 } from '../../../ingestion/normalizers/semanticscholar.js';
import { normalize as nCrossref } from '../../../ingestion/normalizers/crossref.js';
import { normalize as nEpmc } from '../../../ingestion/normalizers/europepmc.js';
import { normalize as nPubmed } from '../../../ingestion/normalizers/pubmed.js';
import { searchPapers as fOpenAlex } from '../../../ingestion/sources/openalex.js';
import { searchPapers as fArxiv } from '../../../ingestion/sources/arxiv.js';
import { searchPapers as fS2 } from '../../../ingestion/sources/semanticscholar.js';
import { searchPapers as fCrossref } from '../../../ingestion/sources/crossref.js';
import { searchPapers as fEpmc } from '../../../ingestion/sources/europepmc.js';
import { searchPapers as fPubmed } from '../../../ingestion/sources/pubmed.js';
import { rankPapers } from '../../../ingestion/ranking.js';
import * as R from './render.mjs';

export const REGISTRY = {
  openalex: { fetch: fOpenAlex, normalize: nOpenAlex },
  arxiv: { fetch: fArxiv, normalize: nArxiv },
  semantic_scholar: { fetch: fS2, normalize: nS2 },
  crossref: { fetch: fCrossref, normalize: nCrossref },
  europe_pmc: { fetch: fEpmc, normalize: nEpmc },
  pubmed: { fetch: fPubmed, normalize: nPubmed },
};
export const SOURCES = Object.keys(REGISTRY);

/** Render a work in provider `source` style and run it through the real normalizer. */
export async function toNormalized(source, work, style = {}) {
  switch (source) {
    case 'openalex': return nOpenAlex(R.renderOpenAlex(work, style));
    case 'semantic_scholar': return nS2(R.renderS2(work, style));
    case 'crossref': return nCrossref(R.renderCrossref(work, style));
    case 'europe_pmc': return nEpmc(R.renderEuropePmc(work, style));
    case 'arxiv': {
      const parsed = await parseStringPromise(R.wrapArxivFeed([R.renderArxivEntry(work, style)]), { explicitArray: false });
      return nArxiv(parsed.feed.entry);
    }
    case 'pubmed': {
      const parsed = await parseStringPromise(R.wrapPubmedSet([R.renderPubmedXml(work, style)]), { explicitArray: false });
      return nPubmed(parsed.PubmedArticleSet.PubmedArticle);
    }
  }
  throw new Error('unknown source ' + source);
}

/** Replicates orchestrator steps 1-3 (fetch in parallel, normalize, per-provider rank+trim). */
export async function collectPreDedup(query, sources, limit, sortBy = 'date') {
  const results = await Promise.allSettled(sources.map(s => REGISTRY[s].fetch(query, limit, sortBy)));
  let all = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
    const norm = r.value.map(x => REGISTRY[sources[i]].normalize(x));
    all = all.concat(rankPapers(norm, sortBy).slice(0, limit));
  });
  return all;
}
