// E2: Deduplication behaviour of ingestion/dedupe.js (repository code) vs. two harness-only variants.
//   A  single-factor metadata disagreement -> pairwise merge recall (two records of the same work)
//   B  false-merge probes (distinct works)
//   C  order dependence / non-confluence (three records of the same work, all 6 source orders)
//   D  end-to-end: emulated 6-source search through the real source modules + normalizers
// Usage: node e2_dedup.mjs
import fs from 'fs';
import { deduplicate } from '../../ingestion/dedupe.js';
import { makeCorpus, foldDiacritics } from './lib/corpus.mjs';
import { installEmulator } from './lib/emulator.mjs';
import { toNormalized, collectPreDedup, SOURCES } from './lib/pipeline.mjs';
import { variants, strictHash, relaxedKey } from './lib/dedupe_variants.mjs';
import { authorFmts } from './lib/render.mjs';

const withArxiv = (w) => (w.arxivId ? w : { ...w, arxivId: `2001.${String(w.wid).padStart(5, '0')}` });
const clone = (ps) => ps.map(p => ({ ...p, authors: [...p.authors] }));
const nOut = {
  repo: (ps) => deduplicate(clone(ps)).length,
  uf_repo_keys: (ps) => variants.uf_repo_keys(ps).length,
  uf_relaxed: (ps) => variants.uf_relaxed(ps).length,
};
const VARIANTS = Object.keys(nOut);

const out = { meta: { node: process.version, date: new Date().toISOString(), seed: 1 } };

// ------------------------------------------------------------------ A
const corpus = makeCorpus(500, 1);
const PERT = [
  ['none', () => ({})],
  ['year -1 (preprint earlier)', (w) => ({ year: w.year - 1 })],
  ['year +1', (w) => ({ year: w.year + 1 })],
  ['author "A. Surname"', () => ({ authorFmt: authorFmts.initialDotFamily })],
  ['author "Surname A"', () => ({ authorFmt: authorFmts.familyInitial })],
  ['author order reversed', (w) => ({ __reverse: true })],
  ['title trailing period', (w) => ({ title: w.title + '.' })],
  ['title upper-cased', (w) => ({ title: w.title.toUpperCase() })],
  ['title ": " -> " - "', (w) => ({ title: w.title.replace(': ', ' - ') })],
  ['title subtitle dropped', (w) => ({ title: w.title.split(':')[0] })],
  ['author diacritics folded', () => ({ authorFmt: (a) => foldDiacritics(`${a.given} ${a.family}`) })],
  ['combined (Europe PMC-like)', (w) => ({ year: w.year - 1, title: w.title + '.', authorFmt: authorFmts.familyInitial })],
];

async function renderS(cond, w, st) {
  const w2 = st.__reverse ? { ...w, authors: [...w.authors].reverse() } : w;
  const style = { ...st }; delete style.__reverse;
  if (cond === 'both_doi') return toNormalized('crossref', w2, style);
  // arXiv-like: no DOI. year defaults to work year unless the perturbation overrides it
  return toNormalized('arxiv', withArxiv(w2), { year: w.year, ...style });
}
// crossref renderer ignores authorFmt (it uses given/family); use semantic_scholar for 'both_doi' so author formats apply
async function renderS_both(w, st) {
  const w2 = st.__reverse ? { ...w, authors: [...w.authors].reverse() } : w;
  const style = { ...st }; delete style.__reverse;
  return toNormalized('semantic_scholar', w2, style);
}

const A = {};
for (const cond of ['both_doi', 's_no_doi']) {
  A[cond] = [];
  for (const [name, mk] of PERT) {
    let applicable = 0;
    const merged = Object.fromEntries(VARIANTS.map(v => [v, 0]));
    for (const w of corpus) {
      const R = await toNormalized('openalex', w, {});
      const st = mk(w);
      const S = cond === 'both_doi' ? await renderS_both(w, st) : await renderS(cond, w, st);
      const S0 = cond === 'both_doi' ? await renderS_both(w, {}) : await renderS(cond, w, {});
      // a perturbation is "applicable" if it changed the title / first-author / year strings (the fields the strict key uses) (or is the null perturbation)
      const sig = (p) => JSON.stringify([p.title, p.authors[0], p.year]); // fields used by the repository's strict key
      if (name !== 'none' && sig(S) === sig(S0)) continue;
      applicable++;
      for (const v of VARIANTS) if (nOut[v]([R, S]) === 1) merged[v]++;
    }
    A[cond].push({ perturbation: name, applicable, recall: Object.fromEntries(VARIANTS.map(v => [v, applicable ? merged[v] / applicable : null])), merged });
  }
}
out.A = A;

// ------------------------------------------------------------------ B
const B = {};
{ // B1: distinct DOIs, identical (title, first author, year)
  let m = Object.fromEntries(VARIANTS.map(v => [v, 0])); const n = 500;
  for (const w of corpus) {
    const w2 = { ...w, wid: w.wid + 100000, doi: w.doi + '.suppl', s2Id: 'b'.repeat(40), pmid: '9' + w.pmid, arxivId: null };
    const R = await toNormalized('openalex', w, {});
    const S = await toNormalized('crossref', w2, {});
    for (const v of VARIANTS) if (nOut[v]([R, S]) === 1) m[v]++;
  }
  B.distinct_doi_same_title_author_year = { n, falseMerged: m };
}
{ // B2: records with empty title / no authors, distinct DOIs, same year
  const ps = Array.from({ length: 100 }, (_, i) => ({ id: null, source: 'crossref', source_id: `10.1/x${i}`, title: '', abstract: null, authors: [], year: 2020, venue: null, doi: `10.1/x${i}`, url: '', pdf_url: null, citation_count: null }));
  B.empty_title_records = { n: ps.length, outputRecords: Object.fromEntries(VARIANTS.map(v => [v, nOut[v](ps)])) };
}
{ // B3: same title + same surname + same initial, different persons (Wei vs Wen Zhang)
  let m = Object.fromEntries(VARIANTS.map(v => [v, 0])); const n = 500;
  for (const w of corpus) {
    const w1 = { ...w, authors: [{ given: 'Wei', family: 'Zhang' }, ...w.authors.slice(1)] };
    const w2 = { ...w, wid: w.wid + 100000, doi: w.doi + 'b', s2Id: 'c'.repeat(40), authors: [{ given: 'Wen', family: 'Zhang' }, ...w.authors.slice(1)], arxivId: null };
    const R = await toNormalized('semantic_scholar', w1, {});
    const S = await toNormalized('arxiv', withArxiv({ ...w2, arxivId: null }), { year: w.year });
    for (const v of VARIANTS) if (nOut[v]([R, S]) === 1) m[v]++;
  }
  B.same_initial_different_person = { n, falseMerged: m };
}
out.B = B;

// ------------------------------------------------------------------ C
function permutations(a) { if (a.length <= 1) return [a]; return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }
{
  const N = 1000;
  const cc = makeCorpus(N, 3);
  const blocks = { A: [], B: [], C: [] };
  for (const w of cc) {
    blocks.A.push(await toNormalized('arxiv', withArxiv(w), { year: w.year })); // no DOI
    blocks.B.push(await toNormalized('semantic_scholar', w, {}));                                              // DOI, identical strings to A
    blocks.C.push(await toNormalized('europe_pmc', w, { title: w.title + '.' }));                              // DOI, different title/author strings
  }
  const rows = [];
  for (const perm of permutations(['A', 'B', 'C'])) {
    const ps = perm.flatMap(k => blocks[k]);
    rows.push({ order: perm.join(''), records: Object.fromEntries(VARIANTS.map(v => [v, nOut[v](ps)])) });
  }
  out.C = { works: N, copiesPerWork: 3, groundTruthRecords: N, legend: 'A=arXiv-like (no DOI); B=S2-like (DOI, same strings as A); C=EuropePMC-like (DOI, title+".", surname-initial authors)', rows };
}

// ------------------------------------------------------------------ D
{
  const D = { configs: [] };
  const N = 400, Q = 20;
  const dc = makeCorpus(N, 11);
  const widOf = new Map();
  for (const w of dc) {
    widOf.set(`openalex:W${2000000000 + w.wid}`, w.wid);
    if (w.arxivId) widOf.set(`arxiv:${w.arxivId}v1`, w.wid);
    widOf.set(`semantic_scholar:${w.s2Id}`, w.wid);
    widOf.set(`crossref:${w.doi}`, w.wid);
    widOf.set(`europe_pmc:${w.pmid}`, w.wid);
    widOf.set(`pubmed:${w.pmid}`, w.wid);
  }
  for (const limit of [10, 25]) {
    const emu = installEmulator({ corpus: dc, latency: 0, seed: 5, coverage: { openalex: 0.5, semantic_scholar: 0.5, crossref: 0.5, europe_pmc: 0.5, pubmed: 0.5, arxiv: 1 } });
    const agg = { limit, queries: Q, raw: 0, uniqueWorks: 0, perVariant: Object.fromEntries(VARIANTS.map(v => [v, { outputRecords: 0, residualDuplicates: 0, lostWorks: 0 }])), residualPairTypes: {} };
    for (let qi = 0; qi < Q; qi++) {
      const pre = await collectPreDedup(`query-${qi}`, SOURCES.filter(s => s !== 'arxiv' || true), limit, 'date');
      pre.forEach(p => { p.__wid = widOf.get(`${p.source}:${p.source_id}`); });
      const widsRaw = new Set(pre.map(p => p.__wid));
      agg.raw += pre.length; agg.uniqueWorks += widsRaw.size;
      // repository dedupe
      const kept = deduplicate(pre.map(p => ({ ...p, authors: [...p.authors] })));
      const groupsRepo = kept.map(k => k.__wid);
      // union-find variants
      const sets = { repo: kept.map(k => [k.__wid, k.source]) };
      for (const v of ['uf_repo_keys', 'uf_relaxed']) sets[v] = variants[v](pre).map(g => [pre[g[0]].__wid, pre[g[0]].source, g.map(i => pre[i].__wid)]);
      for (const v of VARIANTS) {
        const recs = sets[v];
        const wids = recs.map(r => r[0]);
        const uniq = new Set(wids);
        agg.perVariant[v].outputRecords += recs.length;
        agg.perVariant[v].residualDuplicates += recs.length - uniq.size;
        agg.perVariant[v].lostWorks += widsRaw.size - uniq.size; // (unchanged unique count => 0 unless a work vanished)
      }
      // residual duplicate pair types for the repository dedupe
      const byWid = new Map();
      kept.forEach(k => { if (!byWid.has(k.__wid)) byWid.set(k.__wid, []); byWid.get(k.__wid).push(k.source); });
      for (const srcs of byWid.values()) {
        for (let i = 0; i < srcs.length; i++) for (let j = i + 1; j < srcs.length; j++) {
          const key = [srcs[i], srcs[j]].sort().join(' + ');
          agg.residualPairTypes[key] = (agg.residualPairTypes[key] || 0) + 1;
        }
      }
    }
    // consistency check: orchestrator-equivalent pipeline == real orchestrator output size (single query)
    const { searchPapers } = await import('../../ingestion/search-orchestrator.js');
    const origLog = console.log; console.log = () => {};
    const real = await searchPapers('query-0', SOURCES, limit, 'date');
    console.log = origLog;
    const pre0 = await collectPreDedup('query-0', SOURCES, limit, 'date');
    agg.consistencyCheck = { orchestratorOutput: real.length, replicatedPipelineOutput: deduplicate(pre0.map(p => ({ ...p }))).length };
    emu.uninstall();
    D.configs.push(agg);
  }
  out.D = D;
}

fs.writeFileSync(new URL('../results/e2_dedup.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
