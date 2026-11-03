// E3: orchestrator concurrency, request amplification, fault handling, and CPU cost.
// All upstream behaviour is EMULATED (lib/emulator.mjs); injected latencies are parameters,
// not measurements of real services. What is measured is the repository code's own scheduling.
// Usage: node e3_orchestrator.mjs <mode> [args]
//   sweep | warm | amplify | faults | hang <source> <reps> | cpu
import fs from 'fs';
import { makeCorpus } from './lib/corpus.mjs';
import { installEmulator } from './lib/emulator.mjs';
import { summarize } from './lib/rng.mjs';

const mode = process.argv[2];
const corpus = makeCorpus(600, 31);
const ALL = ['openalex', 'arxiv', 'semantic_scholar', 'crossref', 'europe_pmc', 'pubmed'];
const cov = { openalex: 0.7, semantic_scholar: 0.7, crossref: 0.7, europe_pmc: 0.7, pubmed: 0.7, arxiv: 1 };
const quiet = async (f) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await f(); } finally { console.log = l; console.warn = w; } };
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const { searchPapers } = await import('../../ingestion/search-orchestrator.js');
const save = (name, obj) => fs.writeFileSync(new URL(`../results/${name}.json`, import.meta.url), JSON.stringify(obj, null, 2));
const limit = 10;

if (mode === 'sweep') {
  const res = { meta: { limit, reps: 5, node: process.version, note: 'latency L injected identically for every emulated upstream request; cold = >3.2 s idle before each run so the arXiv adapter throttle does not engage' }, rows: [] };
  for (const L of [0, 100, 250, 500, 1000]) {
    const emu = installEmulator({ corpus, latency: L, coverage: cov, seed: 3 });
    const ts = []; let nreq = 0, nres = 0;
    for (let r = 0; r < 6; r++) {
      await sleepMs(3300);
      emu.reset();
      const t = performance.now();
      const out = await quiet(() => searchPapers(`sweep-${L}-${r}`, ALL, limit, 'date'));
      const dt = performance.now() - t;
      if (r >= 1) { ts.push(dt); nreq = emu.log.length; nres = out.length; } // first run discarded as warm-up
    }
    emu.uninstall();
    const Tpar = Math.max(L, 2 * L, Math.max(L, 350) + L);                       // max over per-source critical paths
    const Tsrcseq = L + L + L + L + 2 * L + (Math.max(L, 350) + L);              // sources one after another
    res.rows.push({ L, observed: summarize(ts), model_parallel_ms: Tpar, model_source_sequential_ms: Tsrcseq, model_fully_sequential_ms: nreq * L, upstreamRequests: nreq, resultsReturned: nres });
    console.log(L, 'obs median', res.rows.at(-1).observed.median.toFixed(1), 'par', Tpar, 'srcseq', Tsrcseq, 'seq', nreq * L, 'req', nreq);
  }
  save('e3_sweep', res);
}

if (mode === 'warm') {
  const L = 100; const reps = 5;
  const emu = installEmulator({ corpus, latency: L, coverage: cov, seed: 3 });
  const rows = [];
  for (let gap of [0, 1000, 2000, 3500]) {
    const first = [], second = [];
    for (let r = 0; r < reps; r++) {
      await sleepMs(3500);
      let t = performance.now(); await quiet(() => searchPapers(`warm-a-${gap}-${r}`, ALL, limit, 'date')); first.push(performance.now() - t);
      await sleepMs(gap);
      t = performance.now(); await quiet(() => searchPapers(`warm-b-${gap}-${r}`, ALL, limit, 'date')); second.push(performance.now() - t);
    }
    rows.push({ idleGapBetweenSearches_ms: gap, first: summarize(first), second: summarize(second) });
    console.log('gap', gap, 'first', summarize(first).median.toFixed(0), 'second', summarize(second).median.toFixed(0));
  }
  emu.uninstall();
  save('e3_warm', { meta: { L, reps, note: 'second search issued `gap` ms after the first returns' }, rows });
}

if (mode === 'amplify') {
  const rows = [];
  for (const lim of [5, 10, 20, 50]) {
    const emu = installEmulator({ corpus, latency: 0, coverage: cov, seed: 3 });
    await sleepMs(3300);
    const out = await quiet(() => searchPapers('amp', ALL, lim, 'date'));
    const by = {};
    for (const e of emu.log) { const k = e.kind === 'enrich' ? 'europe_pmc→crossref enrichment' : e.source + (e.source === 'pubmed' ? ` (${e.kind})` : ''); by[k] = (by[k] || 0) + 1; }
    rows.push({ limit: lim, totalUpstreamRequests: emu.log.length, perEndpoint: by, resultsReturned: out.length });
    console.log(lim, emu.log.length, JSON.stringify(by));
    emu.uninstall();
  }
  save('e3_amplify', { rows });
}

if (mode === 'faults') {
  const L = 50; const rows = [];
  const faults = [['http500'], ['neterror'], ['http429']];
  for (const src of ALL) for (const [f] of faults) {
    if (f === 'http429' && src !== 'semantic_scholar') continue;
    const emu = installEmulator({ corpus, latency: L, coverage: cov, seed: 3, faults: { [src]: f } });
    await sleepMs(3300);
    const t = performance.now();
    const out = await quiet(() => searchPapers('fault', ALL, limit, 'date'));
    const dt = performance.now() - t;
    const st = out.providerStats?.[src];
    const reported = (out.providerFailures || []).some(x => x.source === src);
    const others = Object.entries(out.providerStats || {}).filter(([k]) => k !== src).every(([, v]) => v.status === 'success' && v.count > 0);
    rows.push({ faultySource: src, fault: f, elapsed_ms: Math.round(dt), statusReported: st?.status, countReported: st?.count, listedInProviderFailures: reported, otherSourcesIntact: others, resultsReturned: out.length, requestsToFaultySource: emu.log.filter(e => e.source === src && e.kind !== 'enrich').length });
    console.log(src.padEnd(17), f.padEnd(9), JSON.stringify(rows.at(-1)));
    emu.uninstall();
  }
  save('e3_faults', { meta: { L, note: 'fault applied to every request to the named host; status as reported by orchestrator providerStats' }, rows });
}

if (mode === 'hang') {
  const src = process.argv[3]; const reps = parseInt(process.argv[4] || '3', 10);
  const ts = []; let nres = 0; let stats;
  for (let r = 0; r < reps; r++) {
    const emu = installEmulator({ corpus, latency: 50, coverage: cov, seed: 3, faults: { [src]: 'hang' } });
    await sleepMs(3300);
    const t = performance.now();
    const out = await quiet(() => searchPapers('hang', ALL, limit, 'date'));
    ts.push(performance.now() - t); nres = out.length; stats = out.providerStats;
    emu.uninstall();
    console.log(src, 'rep', r, ts.at(-1).toFixed(0), 'ms', 'results', nres, 'status', stats[src]?.status);
  }
  save(`e3_hang_${src}`, { source: src, reps, elapsed_ms: summarize(ts), resultsReturned: nres, statusReported: stats[src], otherStatuses: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.status + '/' + v.count])) });
}

if (mode === 'cpu') {
  const noArxiv = ALL.filter(s => s !== 'arxiv' && s !== 'pubmed'); // both adapters impose wall-clock throttles (3 s / 2x350 ms) that would mask CPU cost
  const rows = [];
  for (const lim of [10, 20, 50, 100, 200]) {
    const emu = installEmulator({ corpus: makeCorpus(2000, 33), latency: 0, coverage: { ...cov, openalex: 1, semantic_scholar: 1, crossref: 1, europe_pmc: 1, pubmed: 1 }, seed: 3 });
    const ts = []; let n = 0, raw = 0;
    for (let r = 0; r < 18; r++) {
      const t = performance.now();
      const out = await quiet(() => searchPapers(`cpu-${r}`, noArxiv, lim, 'date'));
      const dt = performance.now() - t;
      if (r >= 3) ts.push(dt);
      n = out.length; raw = Object.values(out.providerStats).reduce((a, v) => a + v.count, 0);
    }
    emu.uninstall();
    rows.push({ limit: lim, sources: noArxiv.length, rawAfterTrim: raw, deduplicated: n, wall_ms: summarize(ts) });
    console.log(lim, raw, n, summarize(ts).median.toFixed(1));
  }
  save('e3_cpu', { meta: { note: 'L=0; includes JSON parse, normalization, dedup, ranking, UUID assignment and emulator overhead; arXiv and PubMed excluded because their adapters impose wall-clock throttles (3 s; 2x350 ms between back-to-back searches) that would mask CPU cost' }, rows });
}
