// E2b: wall-clock scaling of deduplicate() (repository) and the harness-only union-find variants vs input size n.
// Input: synthetic normalized records, 30% of which are exact-metadata copies of an earlier record (so all variants find them).
import fs from 'fs';
import { deduplicate } from '../../ingestion/dedupe.js';
import { variants } from './lib/dedupe_variants.mjs';
import { makeCorpus } from './lib/corpus.mjs';
import { makeRng, summarize } from './lib/rng.mjs';

const rows = [];
for (const n of [100, 1000, 10000, 100000]) {
  const base = makeCorpus(Math.ceil(n * 0.7), 77).map((w, i) => ({
    id: null, source: 'crossref', source_id: w.doi, title: w.title, abstract: w.abstract, authors: w.authors.map(a => `${a.given} ${a.family}`),
    year: w.year, venue: w.venue, doi: i % 3 === 0 ? null : w.doi, url: '', pdf_url: null, citation_count: w.citations,
  }));
  const rng = makeRng(5);
  const recs = base.slice();
  while (recs.length < n) { const o = rng.pick(base); recs.push({ ...o, source: 'arxiv', source_id: 'x' + recs.length, doi: null }); }
  const input = rng.shuffle(recs).slice(0, n);
  const row = { n };
  for (const [name, fn] of [['repo', (ps) => deduplicate(ps.map(p => ({ ...p })))], ['uf_repo_keys', (ps) => variants.uf_repo_keys(ps)], ['uf_relaxed', (ps) => variants.uf_relaxed(ps)]]) {
    const ts = []; let outN = 0;
    const reps = n >= 100000 ? 5 : 9;
    for (let r = 0; r < reps; r++) { const t = performance.now(); const o = fn(input); const dt = performance.now() - t; if (r >= 2) ts.push(dt); outN = o.length; }
    row[name] = { ...summarize(ts), outputRecords: outN };
  }
  rows.push(row);
  console.log(n, JSON.stringify(Object.fromEntries(['repo', 'uf_repo_keys', 'uf_relaxed'].map(k => [k, row[k].median.toFixed(2) + 'ms/' + row[k].outputRecords]))));
}
fs.writeFileSync(new URL('../results/e2b_dedup_scaling.json', import.meta.url), JSON.stringify({ meta: { node: process.version, duplicateFraction: 0.3, note: 'repo variant includes a shallow clone of every record (deduplicate mutates); uf variants do not' }, rows }, null, 2));
