// Verifies that the experiment harness exercises the repository's REAL modules and quantifies the fidelity of the
// synthetic provider renderings. Output: module_usage_report.json / .md
//   1. static: which application modules each experiment script imports (and that nothing is re-implemented in lib/)
//   2. git: no tracked application file differs from the baseline commit (bf2d3a3) outside paper_exp/
//   3. dynamic: replicated pre-dedup pipeline == real orchestrator (full record-set equality, 3 queries)
//   4. dynamic: renderer -> real normalizer round trip vs ground truth, per provider field-by-field
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
const here = new URL('.', import.meta.url).pathname;
const root = path.resolve(here, '../../') + '/';
const expDir = root + 'paper_exp/experiments/';
const out = { generatedAt: new Date().toISOString() };

// 1. static import inventory
const files = [...fs.readdirSync(expDir).filter(f => f.endsWith('.mjs')).map(f => expDir + f), ...fs.readdirSync(expDir + 'lib').map(f => expDir + 'lib/' + f)];
out.imports = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const mods = [...src.matchAll(/(?:from\s+|import\()\s*['"]((?:\.\.\/)+(?:ingestion|services)\/[^'"]+)['"]/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
  out.imports[path.relative(expDir, f)] = [...new Set(mods)].sort();
}
// functions defined in lib/ that could shadow application logic
out.harnessOnlyFunctions = {
  'lib/dedupe_variants.mjs': 'strictHash/relaxedKey/clusterUF/variants.* — explicitly identified experimental variants (uf_repo_keys, uf_relaxed); strictHash re-states the repo key and is used only for the applicability test and as a UF key',
  'lib/emulator.mjs': 'globalThis.fetch replacement (upstream emulation, latency, fault injection)',
  'lib/render.mjs': 'synthetic provider payload renderers (input data, not application logic)',
  'lib/pipeline.mjs': 'collectPreDedup(): replicates orchestrator steps 1-3 by calling the repository source adapters, normalizers and rankPapers; checked against the real orchestrator in section 3',
};

// 2. git: application source unmodified relative to baseline
const base = 'bf2d3a3';
try {
  const diff = execSync(`git diff --stat ${base} -- . ':!paper_exp' ':!paper'`, { cwd: root }).toString().trim();
  const tracked = execSync(`git diff --name-only ${base} -- . ':!paper_exp' ':!paper'`, { cwd: root }).toString().trim();
  out.git = { baseline: base, changedApplicationFiles: tracked ? tracked.split('\n') : [], diffStat: diff || '(no differences)' };
} catch (e) { out.git = { error: String(e.message) }; }

// 3. replicated pipeline vs real orchestrator (full set equality)
process.env.DB_NAME ||= 'rie_bench';
const { makeCorpus } = await import(expDir + 'lib/corpus.mjs');
const { installEmulator } = await import(expDir + 'lib/emulator.mjs');
const { collectPreDedup, SOURCES, toNormalized } = await import(expDir + 'lib/pipeline.mjs');
const { deduplicate } = await import(root + 'ingestion/dedupe.js');
const { rankPapers } = await import(root + 'ingestion/ranking.js');
const { searchPapers } = await import(root + 'ingestion/search-orchestrator.js');
const corpus = makeCorpus(400, 11);
const emu = installEmulator({ corpus, latency: 0, seed: 5, coverage: { openalex: 0.5, semantic_scholar: 0.5, crossref: 0.5, europe_pmc: 0.5, pubmed: 0.5, arxiv: 1 } });
const quiet = async (f) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await f(); } finally { console.log = l; console.warn = w; } };
const keyOf = (p) => `${p.source}:${p.source_id}`;
out.orchestratorEquivalence = [];
for (const [q, k] of [['query-0', 10], ['query-1', 10], ['query-2', 25]]) {
  const real = await quiet(() => searchPapers(q, SOURCES, k, 'date'));
  const pre = await quiet(() => collectPreDedup(q, SOURCES, k, 'date'));
  const mine = rankPapers(deduplicate(pre.map(p => ({ ...p, authors: [...p.authors] }))), 'date');
  const A = real.map(keyOf).sort(), B = mine.map(keyOf).sort();
  const sameOrder = JSON.stringify(real.map(keyOf)) === JSON.stringify(mine.map(keyOf));
  out.orchestratorEquivalence.push({ query: q, limit: k, realOutput: real.length, replicatedOutput: mine.length, sameRecordSet: JSON.stringify(A) === JSON.stringify(B), sameRankedOrder: sameOrder });
}
// 4. renderer -> normalizer round trip fidelity
const fields = ['title', 'doi', 'year', 'venue', 'citation_count', 'abstract', 'firstAuthor', 'nAuthors'];
const trueVal = (w, src, f) => ({ title: w.title, doi: src === 'arxiv' ? null : w.doi, year: src === 'arxiv' ? (w.preprintYear ?? w.year) : w.year, venue: src === 'arxiv' ? null : w.venue, citation_count: ['arxiv', 'pubmed'].includes(src) ? null : w.citations,
  abstract: w.abstract, firstAuthor: `${w.authors[0].given} ${w.authors[0].family}`, nAuthors: w.authors.length }[f]);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
out.roundTrip = {};
const withArx = (w) => (w.arxivId ? w : { ...w, arxivId: `2001.${String(w.wid).padStart(5, '0')}` });
for (const src of SOURCES) {
  const stats = Object.fromEntries(fields.map(f => [f, { match: 0, mismatch: 0 }]));
  let n = 0;
  for (const w0 of corpus.slice(0, 200)) {
    const w = withArx(w0);
    const p = await toNormalized(src, w, {});
    n++;
    for (const f of fields) {
      const got = f === 'firstAuthor' ? p.authors[0] : f === 'nAuthors' ? p.authors.length : p[f];
      const want = trueVal(w, src, f);
      // known, intended differences: Europe PMC renders "Family G" author strings; PubMed/EPMC/crossref abstracts are whitespace-normalised
      const ok = norm(got) === norm(want);
      stats[f][ok ? 'match' : 'mismatch']++;
    }
  }
  out.roundTrip[src] = { records: n, fieldAgreement: Object.fromEntries(fields.map(f => [f, `${stats[f].match}/${n}`])) };
}
emu.uninstall();
fs.writeFileSync(here + 'module_usage_report.json', JSON.stringify(out, null, 2));
let md = '# Module-usage and harness-fidelity report (generated by verify_module_usage.mjs)\n\n## 1. Application modules imported by each experiment script\n\n| Script | Application modules imported |\n|---|---|\n';
for (const [f, m] of Object.entries(out.imports)) md += `| ${f} | ${m.length ? m.join(', ') : '(none)'} |\n`;
md += '\nHarness-only code (not application logic):\n\n' + Object.entries(out.harnessOnlyFunctions).map(([f, d]) => `- \`${f}\`: ${d}`).join('\n') + '\n';
md += `\n## 2. Application source unmodified\n\nDiff of all tracked files outside \`paper_exp/\` against baseline commit \`${base}\`: ${out.git.changedApplicationFiles?.length ? '**CHANGED: ' + out.git.changedApplicationFiles.join(', ') + '**' : '**no differences**'}\n`;
md += '\n## 3. Replicated pre-dedup pipeline vs. real orchestrator (full record sets)\n\n| Query | k | Real output | Replicated output | Same record set | Same ranked order |\n|---|---|---|---|---|---|\n';
for (const r of out.orchestratorEquivalence) md += `| ${r.query} | ${r.limit} | ${r.realOutput} | ${r.replicatedOutput} | ${r.sameRecordSet} | ${r.sameRankedOrder} |\n`;
md += '\n## 4. Synthetic renderer -> real normalizer round trip (first 200 corpus works per provider; field agreement with ground truth)\n\n| Provider | ' + fields.join(' | ') + ' |\n|---|' + fields.map(() => '---').join('|') + '|\n';
for (const [s, r] of Object.entries(out.roundTrip)) md += `| ${s} | ${fields.map(f => r.fieldAgreement[f]).join(' | ')} |\n`;
md += '\nExpected, by construction: arXiv has no DOI/venue/citation count and its year is the preprint year; PubMed has no citation count; Europe PMC author strings are rendered as "Family G" (surname + initial), so its first-author field differs from the ground-truth "Given Family"; the PubMed normalizer yields "Given Family" from ForeName/LastName.\n';
fs.writeFileSync(here + 'module_usage_report.md', md);
console.log(JSON.stringify({ changed: out.git.changedApplicationFiles, equivalence: out.orchestratorEquivalence }, null, 1));
console.log(out.roundTrip);
process.exit(0);
