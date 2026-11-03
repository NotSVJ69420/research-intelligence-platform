// E4: persistence layer on a REAL local PostgreSQL 16 instance (loopback), with emulated upstream APIs.
//   a) searchAndStore cost split (orchestrator vs DB) and id-reconciliation behaviour
//   b) cross-source persisted duplicates over a multi-query session
//   c) getLibraryPapers() scaling with DB rows P and PDF files F in raw_papers/
// Requires: DB_NAME=rie_bench (see run_all.sh). Usage: node e4_db.mjs <a|b|c>
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeCorpus } from './lib/corpus.mjs';
import { installEmulator } from './lib/emulator.mjs';
import { summarize } from './lib/rng.mjs';

const mode = process.argv[2];
process.env.DB_NAME ||= 'rie_bench';
const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rie-ws-'));
process.env.WORKSPACE_ROOT = wsRoot;
const { query } = await import('../../services/db.js');
const { initializeDatabase } = await import('../../services/schema.js');
const svc = await import('../../services/paper-service.js');
const { searchPapers } = await import('../../ingestion/search-orchestrator.js');
const save = (name, obj) => fs.writeFileSync(new URL(`../results/${name}.json`, import.meta.url), JSON.stringify(obj, null, 2));
const quiet = async (f) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await f(); } finally { console.log = l; console.warn = w; } };
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const ALL = ['openalex', 'arxiv', 'semantic_scholar', 'crossref', 'europe_pmc', 'pubmed'];
const NOARX = ALL.filter(s => s !== 'arxiv' && s !== 'pubmed'); // adapters with wall-clock throttles are excluded from the cost-split measurement

let t0 = performance.now();
await initializeDatabase();
const initMs = performance.now() - t0;
t0 = performance.now(); await initializeDatabase(); const initIdemMs = performance.now() - t0;

if (mode === 'a') {
  const corpus = makeCorpus(1500, 41);
  const rows = [];
  for (const lim of [10, 25, 50, 100]) {
    const emu = installEmulator({ corpus, latency: 0, seed: 9, coverage: { openalex: 0.8, semantic_scholar: 0.8, crossref: 0.8, europe_pmc: 0.8, pubmed: 0.8, arxiv: 1 } });
    const tOrch = [], tTotal = [], tSecond = []; let nRet = 0, idStable = null, rowsAfter = 0, failedN = 0;
    for (let r = 0; r < 8; r++) {
      await query('TRUNCATE papers');
      const q = `dbq-${lim}-${r}`;
      let t = performance.now(); await quiet(() => searchPapers(q, NOARX, lim, 'date')); const a = performance.now() - t;
      await query('TRUNCATE papers');
      t = performance.now(); const res1 = await quiet(() => svc.searchAndStore(q, NOARX, lim, 'date')); const b = performance.now() - t;
      t = performance.now(); const res2 = await quiet(() => svc.searchAndStore(q, NOARX, lim, 'date')); const c = performance.now() - t;
      if (r >= 2) { tOrch.push(a); tTotal.push(b); tSecond.push(c); }
      nRet = res1.succeeded.length; failedN = res1.failed.length;
      const ids1 = new Set(res1.succeeded.map(p => p.id)); const ids2 = new Set(res2.succeeded.map(p => p.id));
      idStable = ids1.size === ids2.size && [...ids1].every(i => ids2.has(i));
      rowsAfter = (await query('SELECT count(*)::int AS n FROM papers')).rows[0].n;
    }
    emu.uninstall();
    const dbPer = (summarize(tTotal).median - summarize(tOrch).median) / nRet;
    rows.push({ limit: lim, papersReturned: nRet, failedInserts: failedN, rowsInTableAfterTwoRuns: rowsAfter, idsStableAcrossRepeatedSearch: idStable, orchestrator_ms: summarize(tOrch), searchAndStore_ms: summarize(tTotal), repeatSearchAndStore_ms: summarize(tSecond), approxDbMsPerPaper: dbPer });
    console.log(lim, nRet, 'orch', summarize(tOrch).median.toFixed(1), 'total', summarize(tTotal).median.toFixed(1), 'repeat', summarize(tSecond).median.toFixed(1), 'db/paper', dbPer.toFixed(3), 'rows', rowsAfter, 'stable', idStable);
  }
  save('e4_a_search_and_store', { meta: { postgres: '16.15 (local, loopback)', schemaInitMs: initMs, schemaInitIdempotentMs: initIdemMs, sources: NOARX, reps: 6, warmupDiscarded: 2 }, rows });
}

if (mode === 'b') {
  const corpus = makeCorpus(300, 51);
  const emu = installEmulator({ corpus, latency: 0, seed: 13, coverage: { openalex: 0.6, semantic_scholar: 0.6, crossref: 0.6, europe_pmc: 0.6, pubmed: 0.6, arxiv: 1 } });
  await query('TRUNCATE papers');
  const widOf = new Map();
  for (const w of corpus) {
    widOf.set(`openalex:W${2000000000 + w.wid}`, w.wid); if (w.arxivId) widOf.set(`arxiv:${w.arxivId}v1`, w.wid);
    widOf.set(`semantic_scholar:${w.s2Id}`, w.wid); widOf.set(`crossref:${w.doi}`, w.wid); widOf.set(`europe_pmc:${w.pmid}`, w.wid); widOf.set(`pubmed:${w.pmid}`, w.wid);
  }
  const steps = []; let returned = 0;
  for (let q = 0; q < 8; q++) {
    await sleepMs(3300);
    const res = await quiet(() => svc.searchAndStore(`session-${q}`, ALL, 20, 'date'));
    returned += res.succeeded.length;
    const rows = (await query('SELECT source, source_id, doi FROM papers')).rows;
    const wids = rows.map(r => widOf.get(`${r.source}:${r.source_id}`));
    const uniq = new Set(wids);
    steps.push({ queries: q + 1, returnedCumulative: returned, rowsInTable: rows.length, distinctWorks: uniq.size, persistedDuplicateRows: rows.length - uniq.size, rowsWithoutDoi: rows.filter(r => !r.doi).length });
    console.log(JSON.stringify(steps.at(-1)));
  }
  const bySource = (await query('SELECT source, count(*)::int AS n, count(doi)::int AS with_doi FROM papers GROUP BY source ORDER BY source')).rows;
  emu.uninstall();
  save('e4_b_session', { meta: { sources: ALL, limit: 20, corpusWorks: 300 }, steps, bySource });
}

if (mode === 'c') {
  const rows = [];
  for (const P of [1000, 5000, 20000]) {
    await query('TRUNCATE papers');
    // bulk-load P synthetic rows (setup only; not timed)
    await query(`INSERT INTO papers (id, source, source_id, title, authors, year, doi, url, local_pdf_path)
                 SELECT gen_random_uuid(), 'crossref', 'sid-' || g, 'Synthetic paper ' || g, '["A B"]'::jsonb, 2020, '10.9/' || g, '', NULL FROM generate_series(1, $1) g`, [P]);
    for (const F of [0, 100, 500, 1000]) {
      const raw = path.join(wsRoot, 'raw_papers');
      fs.rmSync(raw, { recursive: true, force: true }); fs.mkdirSync(raw, { recursive: true });
      for (let i = 0; i < F; i++) fs.writeFileSync(path.join(raw, `external_document_${i}.pdf`), '%PDF-1.4\n'); // unmatched external files = worst case for "Check 3"
      const ts = [];
      for (let r = 0; r < 6; r++) {
        const t = performance.now(); const lib = await quiet(() => svc.getLibraryPapers()); const dt = performance.now() - t;
        if (r >= 1) ts.push(dt);
        if (r === 0 && lib.length !== F) console.log('WARN: library size', lib.length, 'expected', F);
      }
      rows.push({ dbRows: P, pdfFiles: F, getLibraryPapers_ms: summarize(ts) });
      console.log('P', P, 'F', F, summarize(ts).median.toFixed(1), 'ms');
    }
  }
  await query('TRUNCATE papers');
  save('e4_c_library_scan', { meta: { note: 'PDF files are 9-byte stubs with names that match no DB row (worst case for the filename.includes(source_id) fallback)', reps: 5 }, rows });
}
process.exit(0);
