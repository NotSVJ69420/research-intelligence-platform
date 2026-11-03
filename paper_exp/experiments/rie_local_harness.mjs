#!/usr/bin/env node
/**
 * RIE local evidence harness — one file, one command.   node paper_exp/experiments/rie_local_harness.mjs
 *
 * Runs on YOUR machine against the repository's real modules (ingestion/*, services/*), genuine scholarly APIs,
 * a genuine PostgreSQL server (isolated throw-away database, dropped at the end), genuine Groq inference and genuine
 * PDF downloads. It never touches your research library (separate database + separate workspace directory) and never
 * modifies application source. Every experiment is labelled with its evidence class:
 *
 *   LIVE              real services only (zero injected requests; asserted)
 *   LIVE+INJECTED     real services, with ONE explicitly injected fault (the harness says so in every row)
 *   CONTROLLED-LOCAL  synthetic inputs, no network (controlled tests; never to be reported as live measurements)
 *   STATIC            repository inspection
 *
 * Options: --quick  --only E3,E5  --skip P1  --controlled-only  --dry-run  --keep-db  --limit 10  --reps 3
 *          --queries "transformers;deep learning"  --ai-papers 8  --pdfs 3  --gap 3500  --out DIR  --settings FILE
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

// ───────────────────────────── CLI / config ─────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (flag('help') || flag('h')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
const QUICK = flag('quick'), CONTROLLED_ONLY = flag('controlled-only'), DRY = flag('dry-run');
const CFG = {
  queries: opt('queries', null)?.split(';').map(s => s.trim()).filter(Boolean) ?? (QUICK ? ['transformers', 'deep learning'] : ['transformers', 'deep learning', 'quantum computing', 'mrna vaccine', 'graph neural networks', 'compiler optimization']),
  sessionQueries: ['transformers', 'attention mechanism', 'language models', 'quantum computing', 'mrna vaccine', 'protein folding', 'graph neural networks', 'federated learning'].slice(0, QUICK ? 3 : 8),
  limit: +opt('limit', 10), ks: QUICK ? [5, 10] : [5, 10, 20, 50], reps: +opt('reps', QUICK ? 1 : 3), warmReps: QUICK ? 1 : 2,
  gap: +opt('gap', 3500), aiPapers: +opt('ai-papers', QUICK ? 3 : 8), pdfPer: +opt('pdfs', QUICK ? 1 : 3), pdfTimeout: 90000,
  hangSources: QUICK ? ['openalex'] : ['openalex', 'pubmed', 'arxiv'], hangReps: QUICK ? 1 : 2, backoffReps: QUICK ? 1 : 2,
  nWorks: QUICK ? 100 : 500, orderWorks: QUICK ? 200 : 1000, dedupSizes: QUICK ? [1e2, 1e3, 1e4] : [1e2, 1e3, 1e4, 1e5],
  libP: QUICK ? [1000] : [1000, 5000, 20000], libF: QUICK ? [0, 100] : [0, 100, 500, 1000],
  only: opt('only', null)?.split(',').map(s => s.trim().toLowerCase()), skip: (opt('skip', '') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const OUT = path.resolve(opt('out', path.join(HERE, '..', 'runs', `${stamp}-${process.platform}`)));
for (const d of ['raw', 'csv', 'analysis', 'pdfs', 'workspace', 'tests']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// ───────────────────────────── logging, stats, tables ─────────────────────────────
const T0 = performance.now(), now = () => performance.now() - T0;
const logStream = fs.createWriteStream(path.join(OUT, 'harness.log'));
const appLog = fs.createWriteStream(path.join(OUT, 'app_console.log'));
const say = (m) => { const l = `[${((now()) / 1000).toFixed(1).padStart(7)}s] ${m}`; process.stdout.write(l + '\n'); logStream.write(l + '\n'); };
for (const k of ['log', 'warn', 'error', 'info']) console[k] = (...a) => appLog.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); // app noise -> app_console.log
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b), x = (s.length - 1) * p, lo = Math.floor(x); return s[lo] + (s[Math.ceil(x)] - s[lo]) * (x - lo); };
const stats = (xs) => xs.length ? { n: xs.length, median: q(xs, .5), p25: q(xs, .25), p75: q(xs, .75), mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) } : { n: 0 };
const f = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : Number(x).toFixed(d));
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a, r) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mdTable = (h, rows) => `| ${h.join(' | ')} |\n|${h.map(() => '---').join('|')}|\n${rows.map(r => `| ${r.map(c => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`).join('\n')}\n`;
const csvOf = (h, rows) => [h, ...rows].map(r => r.map(c => /[",\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : (c ?? '')).join(',')).join('\n');
const saveRaw = (name, obj) => fs.writeFileSync(path.join(OUT, 'raw', name + '.json'), JSON.stringify(obj, null, 2));

// ───────────────────────────── environment, credentials, repo ─────────────────────────────
const nodeMajor = +process.versions.node.split('.')[0];
const ROOT = [path.resolve(HERE, '../..'), process.cwd(), path.resolve(process.cwd(), '..')].find(d => { try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === 'research-intelligence-engine'; } catch { return false; } });
const PRE = { hard: [], warn: [], info: {} };
const hard = (m) => PRE.hard.push(m), warn = (m) => PRE.warn.push(m);
const isPlaceholder = (v) => !v || /^(your|xxx|changeme|<)/i.test(v) || /your_.*_here|your_key/i.test(v);

async function loadCredentials() {
  const dotenv = (await import('dotenv')).default;
  const envFile = path.join(ROOT, '.env');
  PRE.info.envFile = fs.existsSync(envFile);
  if (PRE.info.envFile) dotenv.config({ path: envFile });
  else warn('.env not found in the repository root; using defaults and the in-app settings file (if any)');
  // the desktop app also stores keys in <userData>/settings.json (read-only fallback, never printed)
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  const cands = [opt('settings', null), ...['research-intelligence-engine', 'Research Intelligence Engine'].map(n => path.join(appData, n, 'settings.json'))].filter(Boolean);
  const map = { openalexApiKey: 'OPENALEX_API_KEY', groqApiKey: 'GROQ_API_KEY', semanticScholarApiKey: 'SEMANTIC_SCHOLAR_API_KEY', crossrefEmail: 'CROSSREF_EMAIL', pubmedApiKey: 'PUBMED_API_KEY' };
  PRE.info.settingsFile = null;
  for (const c of cands) if (fs.existsSync(c)) {
    try { const s = JSON.parse(fs.readFileSync(c, 'utf8')); PRE.info.settingsFile = c; for (const [k, e] of Object.entries(map)) if (isPlaceholder(process.env[e]) && !isPlaceholder(s[k])) process.env[e] = s[k]; break; } catch { /* ignore unreadable */ }
  }
  for (const e of Object.values(map)) if (isPlaceholder(process.env[e])) delete process.env[e];
  PRE.info.keys = Object.fromEntries(Object.values(map).map(e => [e, !!process.env[e]]));
  if (!process.env.GROQ_API_KEY) warn('GROQ_API_KEY missing (.env or in-app settings): live AI experiments (E5, E5n) will be SKIPPED');
  if (!process.env.OPENALEX_API_KEY) warn('OPENALEX_API_KEY missing: OpenAlex may answer HTTP 429 (recorded, not hidden)');
  if (!process.env.SEMANTIC_SCHOLAR_API_KEY) warn('SEMANTIC_SCHOLAR_API_KEY missing: Semantic Scholar often answers HTTP 429 (recorded, not hidden)');
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) warn('HTTPS_PROXY is set but Node ignores it unless NODE_USE_ENV_PROXY=1; live calls may fail');
}

// ───────────────────────────── HTTP instrumentation (measurement + explicit fault injection) ─────────────────────────────
const HOST = { arxiv: 'export.arxiv.org', openalex: 'api.openalex.org', semantic_scholar: 'api.semanticscholar.org', crossref: 'api.crossref.org', europe_pmc: 'www.ebi.ac.uk', pubmed: 'eutils.ncbi.nlm.nih.gov', groq: 'api.groq.com' };
const provOf = (u) => ({ 'export.arxiv.org': 'arxiv', 'api.openalex.org': 'openalex', 'api.semanticscholar.org': 'semantic_scholar', 'www.ebi.ac.uk': 'europe_pmc', 'eutils.ncbi.nlm.nih.gov': 'pubmed', 'api.groq.com': 'groq' }[u.hostname] ?? (u.hostname === 'api.crossref.org' ? (/^\/works\/.+/.test(u.pathname) ? 'epmc_enrich' : 'crossref') : 'other'));
const HTTP = [], CTX = { exp: null }; let RULE = null, CAPTURE = null;
const realFetch = globalThis.fetch;
const setRule = (r) => { RULE = r ? { ...r, n: 0 } : null; };
globalThis.fetch = async (input, init = {}) => {   // pass-through instrumentation; query strings (API keys) are never logged
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, u = new URL(url);
  const e = { i: HTTP.length, exp: CTX.exp, t: now(), host: u.hostname, path: u.pathname, prov: provOf(u), mode: 'real' };
  HTTP.push(e);
  if (e.host === HOST.groq && typeof init.body === 'string') e.reqBody = init.body;
  const mode = RULE && u.hostname === RULE.host ? (RULE.seq[Math.min(RULE.n++, RULE.seq.length - 1)]) : 'pass';
  try {
    if (mode !== 'pass') {
      e.mode = 'INJECTED:' + mode;
      if (mode === 'neterror') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'INJECTED' } });
      if (mode === 'hang') { const sg = init.signal ?? AbortSignal.timeout(120000); await new Promise((_, rej) => sg.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true })); }
      if (mode === 'ok200') { e.status = 200; return new Response(JSON.stringify({ choices: [{ message: { content: '[controlled synthetic response]' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      const st = +mode.replace('http', ''); e.status = st;
      return new Response(JSON.stringify({ error: { message: `injected ${st}` } }), { status: st, statusText: 'Injected', headers: { 'content-type': 'application/json' } });
    }
    if (!init.signal) init = { ...init, signal: AbortSignal.timeout(120000) };   // safety net for calls the app leaves without timeout
    const res = await realFetch(input, init);
    e.status = res.status; e.bytes = +res.headers.get('content-length') || null;
    if (e.prov === 'groq') {
      const h = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-ratelimit') || k === 'retry-after'));
      e.rl = h; try { e.usage = (await res.clone().json()).usage; } catch { /* non-JSON */ }
    }
    if (CAPTURE && CAPTURE(e)) { e.captured = await res.clone().text(); }
    return res;
  } catch (err) { e.error = err.cause?.code || err.name || err.message; throw err; }
  finally { e.end = now(); e.ms = e.end - e.t; }
};
const reqsSince = (i) => HTTP.slice(i);
const counts = (rs) => { const c = {}; for (const r of rs) c[r.prov] = (c[r.prov] || 0) + 1; return c; };

// ───────────────────────────── application modules (loaded after env + isolated DB are set) ─────────────────────────────
const APP = {};
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
async function loadApp() {
  const ad = { openalex: 'openalex', arxiv: 'arxiv', semantic_scholar: 'semanticscholar', crossref: 'crossref', europe_pmc: 'europepmc', pubmed: 'pubmed' };
  APP.fetchers = {}; APP.normalizers = {};
  for (const [k, f] of Object.entries(ad)) { APP.fetchers[k] = (await imp(`ingestion/sources/${f}.js`)).searchPapers; APP.normalizers[k] = (await imp(`ingestion/normalizers/${f}.js`)).normalize; }
  APP.orch = await imp('ingestion/search-orchestrator.js'); APP.dedupe = (await imp('ingestion/dedupe.js')).deduplicate; APP.rank = (await imp('ingestion/ranking.js')).rankPapers;
  APP.svc = await imp('services/paper-service.js'); APP.db = await imp('services/db.js'); APP.schema = await imp('services/schema.js');
  APP.ai = (await imp('services/ai-service.js')).default; APP.pipeline = (await imp('ingestion/ai-pipeline.js')).default;
  APP.ALL = APP.orch.getSourceNames();
}

// ───────────────────────────── preflight ─────────────────────────────
const DBCFG = () => ({ host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres' });
let ISODB = null, ADMIN = null, USERDB = null;
async function preflight() {
  say('PREFLIGHT');
  if (nodeMajor < 18) hard(`Node.js >= 18 required (found ${process.versions.node})`);
  if (!ROOT) { hard('repository root not found (run from inside the repository; expected package.json name "research-intelligence-engine")'); return; }
  for (const d of ['pg', 'xml2js', 'dotenv']) if (!fs.existsSync(path.join(ROOT, 'node_modules', d))) hard(`dependency "${d}" missing: run "npm install" in ${ROOT}`);
  if (PRE.hard.length) return;
  process.chdir(ROOT);
  await loadCredentials();
  USERDB = process.env.DB_NAME || 'research_engine';
  const pg = (await import('pg')).default;
  ADMIN = new pg.Client({ ...DBCFG(), database: 'postgres' });
  try { await ADMIN.connect(); } catch (e) { hard(`cannot connect to PostgreSQL at ${DBCFG().host}:${DBCFG().port} as "${DBCFG().user}" (${e.message}). Start PostgreSQL and check DB_* in .env`); return; }
  PRE.info.postgres = (await ADMIN.query('show server_version')).rows[0].server_version;
  ISODB = `rie_bench_${stamp.replace('-', '_').toLowerCase()}`;
  if (ISODB === USERDB) { hard('isolated database name equals your DB_NAME'); return; }
  try { await ADMIN.query(`CREATE DATABASE ${ISODB}`); } catch (e) { hard(`cannot CREATE DATABASE (${e.message}); the DB user needs the CREATEDB privilege`); return; }
  Object.assign(process.env, { DB_NAME: ISODB, WORKSPACE_ROOT: path.join(OUT, 'workspace') });   // from here on the app talks ONLY to the isolated DB
  PRE.info.isolatedDatabase = ISODB; PRE.info.userDatabaseUntouched = USERDB;
  try { await loadApp(); await APP.schema.initializeDatabase(); } catch (e) { hard(`application modules failed to load/initialise: ${e.message}`); return; }
  try { const s = fs.statfsSync(OUT); PRE.info.freeDiskMB = Math.round(s.bavail * s.bsize / 2 ** 20); if (PRE.info.freeDiskMB < 500) warn(`only ${PRE.info.freeDiskMB} MB free disk`); } catch { /* statfs unavailable */ }
  PRE.info.providerPing = {};
  if (!CONTROLLED_ONLY) {   // one tiny real request per provider (real adapters) + Groq key check (free endpoint)
    for (const s of APP.ALL) {
      const t = performance.now(), i0 = HTTP.length; CTX.exp = 'preflight';
      let status = 'ok'; try { const r = await APP.fetchers[s]('test', 1, 'date'); status = Array.isArray(r) ? `ok (${r.length} item)` : 'ok'; } catch (e) { status = `FAILED: ${e.message}`; if (/429/.test(e.message)) RL.note(s, true); }
      const codes = HTTP.slice(i0).map(r => r.status ?? r.error); if (codes.some(c => !(c >= 200 && c < 300))) { status = `HTTP/ERR ${codes.join(',')} — ${status}`; if (codes.includes(429)) RL.note(s, true); }
      PRE.info.providerPing[s] = { status, ms: Math.round(performance.now() - t), requests: HTTP.length - i0 };
      if (/FAILED|HTTP\/ERR/.test(status)) warn(`${s} preflight: ${status}`);
      await sleep(s === 'arxiv' ? 3200 : 400);
    }
    if (process.env.GROQ_API_KEY) {
      try { const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }); PRE.info.providerPing.groq = { status: r.ok ? 'key accepted' : `HTTP ${r.status}`, httpStatus: r.status }; if (!r.ok) { warn(`Groq key rejected (HTTP ${r.status}): AI experiments will be SKIPPED`); delete process.env.GROQ_API_KEY; APP.ai.apiKey = null; } }
      catch (e) { PRE.info.providerPing.groq = { status: `FAILED: ${e.message}` }; warn('Groq unreachable'); }
    }
    if (Object.values(PRE.info.providerPing).filter(p => /FAILED|ERR/.test(p.status)).length >= 5) hard('network appears to be unreachable (5+ providers failed preflight); use --controlled-only for offline controlled tests');
  }
}

// ───────────────────────────── rate-limit handling ─────────────────────────────
const RL = { st: {}, events: [], note(s, is429) { const x = this.st[s] ??= { c: 0, until: 0 }; x.c = is429 ? x.c + 1 : 0; if (is429 && x.c >= 2) { x.until = Date.now() + 120000; this.events.push({ t: new Date().toISOString(), provider: s, event: 'cooldown 120s after repeated HTTP 429' }); say(`rate limit: ${s} excluded for 120 s`); } else if (is429) this.events.push({ t: new Date().toISOString(), provider: s, event: 'HTTP 429' }); },
  active() { return APP.ALL.filter(s => (this.st[s]?.until ?? 0) < Date.now()); } };
const note429 = (stats) => { for (const [s, v] of Object.entries(stats || {})) RL.note(s, v.status === 'failed' && /429/.test(v.error || '')); };

// ───────────────────────────── live search helper (real orchestrator) ─────────────────────────────
async function liveSearch(query, k, sources = RL.active(), { quiet = false } = {}) {
  const i0 = HTTP.length, t0 = now(), res = await APP.orch.searchPapers(query, sources, k, 'date'), ms = now() - t0, rs = reqsSince(i0);
  if (!RULE) note429(res.providerStats);   // injected faults must not feed the rate-limit logic
  const ch = {}; for (const r of rs) { const p = r.prov === 'epmc_enrich' ? 'europe_pmc' : r.prov; const c = ch[p] ??= { s: Infinity, e: 0 }; c.s = Math.min(c.s, r.t); c.e = Math.max(c.e, r.end ?? r.t); }
  /* settle time of each adapter measured from search start (includes in-adapter throttle waits, as in the model) */ const chains = Object.fromEntries(Object.entries(ch).map(([p, c]) => [p, c.e - t0])), maxChain = Math.max(0, ...Object.values(chains));
  const lastNet = Math.max(0, ...rs.filter(r => r.mode === 'real').map(r => r.end ?? 0));
  const out = { query, k, t0, ms, sources, count: res.length, papers: res, stats: res.providerStats || {}, failures: res.providerFailures || [], chains, maxChain, eps: ms - maxChain, postNetwork: t0 + ms - lastNet, reqs: rs.length, byProv: counts(rs), firstStart: Object.fromEntries(Object.entries(ch).map(([p, c]) => [p, c.s])) };
  if (!quiet) await sleep(CFG.gap);
  return out;
}

// ───────────────────────────── controlled-test building blocks (synthetic canonical records) ─────────────────────────────
const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/Ø/g, 'O');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const strictKey = (p) => sha(`${(p.title || '').toLowerCase().trim()}|${(p.authors?.[0] || '').toLowerCase().trim()}|${p.year ?? ''}`);   // restates dedupe.js key (used only by harness variants)
const parseAuthor = (s) => { const a = fold(s || '').replace(/[.,]/g, ' ').trim(); if (!a) return ['', '']; const t = a.split(/\s+/); if (t.length === 1) return [t[0].toLowerCase(), '']; const [first, last] = [t[0], t.at(-1)]; return /^[A-Z]{1,3}$/.test(last) && first.length > 1 && !/^[A-Z]{1,3}$/.test(first) ? [first.toLowerCase(), last[0].toLowerCase()] : [last.toLowerCase(), first[0].toLowerCase()]; };
const relaxedKey = (p) => `${fold(p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${parseAuthor(p.authors?.[0]).join('|')}`;
const normDoi = (d) => (d ? String(d).replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null);
function cluster(ps, keys) {   // harness-only variants: union-find over keys (transitive closure); relaxed key additionally requires |Δyear|<=1
  const par = ps.map((_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  for (const [fn, tol] of keys) {
    const bk = new Map(); ps.forEach((p, i) => { const k = fn(p); if (k) (bk.get(k) ?? bk.set(k, []).get(k)).push(i); });
    for (const ix of bk.values()) { if (ix.length < 2) continue; if (tol == null) { for (let j = 1; j < ix.length; j++) uni(ix[0], ix[j]); continue; } const s = [...ix].sort((a, b) => (ps[a].year ?? -1e9) - (ps[b].year ?? -1e9)); for (let j = 1; j < s.length; j++) { const a = ps[s[j - 1]].year, b = ps[s[j]].year; if (a == null || b == null || Math.abs(a - b) <= tol) uni(s[j - 1], s[j]); } }
  }
  const g = new Map(); ps.forEach((_, i) => (g.get(find(i)) ?? g.set(find(i), []).get(find(i))).push(i)); return [...g.values()];
}
const K = { doi: [(p) => normDoi(p.doi)], src: [(p) => (p.source_id ? `${p.source}:${p.source_id}` : null)], strict: [strictKey], relaxed: [relaxedKey, 1] };
const VARIANTS = {
  repo: (ps) => APP.dedupe(ps.map(p => ({ ...p, authors: [...p.authors] }))).length,                                   // the repository's deduplicate()
  uf_repo_keys: (ps) => cluster(ps, [K.doi, K.src, K.strict]).length,                                                  // harness variant
  uf_relaxed: (ps) => cluster(ps, [K.doi, K.src, K.relaxed]).length,                                                   // harness variant
};
const GIVEN = ['Ashish', 'Noam', 'María', 'José', 'Zoë', 'Søren', 'Wei', 'Li', 'Yuki', 'Priya', 'Elena', 'Chloé'], FAM = ['Vaswani', 'Shazeer', 'Muñoz', 'García', 'Müller', 'Nøgaard', 'Zhang', 'Wang', 'Tanaka', 'Patel', 'Petrova', 'Dupont'];
const WORDS = ['adaptive', 'scalable', 'robust', 'neural', 'graph', 'sparse', 'federated', 'causal', 'semantic', 'distributed', 'stochastic', 'latent', 'retrieval', 'inference', 'clustering', 'embedding', 'alignment', 'compression', 'attention', 'networks', 'systems', 'models'];
function makeWorks(n, seed) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  return Array.from({ length: n }, (_, i) => ({ i, title: `${Array.from({ length: 3 + Math.floor(r() * 3) }, () => pick(WORDS)).join(' ')} ${i + 1}`.replace(/\b[a-z]/g, c => c.toUpperCase()) + (r() < .5 ? `: ${pick(WORDS)} ${pick(WORDS)} approach` : ''), authors: Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ g: pick(GIVEN), f: pick(FAM) })), year: 2015 + Math.floor(r() * 10), doi: `10.5555/rie.${100000 + i}` }));
}
const AUTH = { full: (a) => `${a.g} ${a.f}`, dot: (a) => `${a.g[0]}. ${a.f}`, fam: (a) => `${a.f} ${a.g[0]}`, fold: (a) => fold(`${a.g} ${a.f}`) };
const rec = (w, o = {}) => ({ id: null, source: o.source, source_id: o.source_id ?? `${o.source}:${w.i}`, title: o.title ?? w.title, abstract: null, authors: (o.authors ?? w.authors).map(o.fmt ?? AUTH.full), year: o.year ?? w.year, venue: null, doi: o.doi === undefined ? null : o.doi, url: '', pdf_url: null, citation_count: null });
const sig = (p) => JSON.stringify([p.title, p.authors[0], p.year]);

// ───────────────────────────── experiment registry / runner ─────────────────────────────
const EXPS = [], RESULTS = {}, SHARED = {};
const exp = (id, title, cls, paperRef, needs, fn) => EXPS.push({ id, title, cls, paperRef, needs, fn });
class Skip extends Error {}
const wanted = (id) => { const l = id.toLowerCase(); return (!CFG.only || CFG.only.some(o => l === o || l.startsWith(o))) && !CFG.skip.some(s => l === s || l.startsWith(s)); };
const live = (cls) => cls === 'LIVE' || cls === 'LIVE+INJECTED';
const cmpRows = [];
const cmp = (exp, item, paper, local, verdict, basis, note = '') => cmpRows.push({ exp, item, paper, local: String(local), verdict, basis, note });
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

// ───────────────────────────── E0 — static repository audit ─────────────────────────────
exp('E0', 'Repository size and state', 'STATIC', 'Sec. V (Table III), Sec. III', [], async () => {
  const sh = (c) => { try { return execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const files = (sh('git ls-files') ?? '').split('\n').filter(x => x && !x.startsWith('paper_exp/') && !x.startsWith('paper/') && /\.(js|html)$/.test(x));
  const layer = (x) => x.startsWith('ingestion/sources/') ? 'adapters' : x.startsWith('ingestion/normalizers/') ? 'normalizers' : x.startsWith('ingestion/') ? 'orchestration' : x.startsWith('services/') ? 'services' : /^(main\/|electron-main|preload)/.test(x) ? 'electron/IPC' : x.startsWith('src/') ? 'renderer main' : x.startsWith('renderer/') ? 'renderer editor' : x.startsWith('test/') ? 'tests' : x.endsWith('.html') ? 'html' : null;
  const by = {}; let total = 0;
  for (const x of files) { const l = layer(x); if (!l) continue; const n = fs.readFileSync(path.join(ROOT, x), 'utf8').split('\n').length - (fs.readFileSync(path.join(ROOT, x), 'utf8').endsWith('\n') ? 1 : 0); (by[l] ??= { files: 0, lines: 0 }); by[l].files++; by[l].lines += n; total += n; }
  const commit = sh('git rev-parse --short HEAD'), dirty = sh('git status --porcelain -- . ":!paper_exp"');
  cmp('E0', 'application lines of code (tracked .js/.html, excl. paper_exp)', 6487, total, total === 6487 ? 'consistent' : 'differs', 'informational', `commit ${commit}${dirty ? ' (working tree has local changes)' : ''}; paper value is for bf2d3a3`);
  return { data: { commit, dirty: !!dirty, total, by }, tables: [{ name: 'size_by_layer', headers: ['layer', 'files', 'lines'], rows: Object.entries(by).map(([k, v]) => [k, v.files, v.lines]) }] };
});

// ───────────────────────────── T1 — the repository's own test scripts, live ─────────────────────────────
exp('T1', "Repository test scripts against live services", 'LIVE', 'Sec. V (78/78 assertions with network)', ['app', 'net'], async () => {
  const rows = []; let pass = 0, fail = 0;
  for (const s of ['test-all-providers', 'test-ingestion', 'test-paper-service', 'test-workspace-library']) {
    const t = performance.now(), out = [];
    const code = await new Promise((res) => { const c = spawn(process.execPath, [path.join('test', s + '.js')], { cwd: ROOT, env: process.env }); c.stdout.on('data', d => out.push(d)); c.stderr.on('data', d => out.push(d)); const to = setTimeout(() => c.kill(), 900000); c.on('close', x => { clearTimeout(to); res(x); }); c.on('error', () => res(-1)); });
    const text = Buffer.concat(out).toString('utf8'); fs.writeFileSync(path.join(OUT, 'tests', s + '.log'), text);
    const p = (text.match(/✓/g) || []).length, x = (text.match(/✗/g) || []).length; pass += p; fail += x;
    rows.push([s, p, x, code, f((performance.now() - t) / 1000, 0), [...text.matchAll(/✗[^\n]*/g)].map(m => m[0]).join('; ').slice(0, 200)]);
  }
  cmp('T1', 'repository assertions passing / failing', '78 / 0 (cloud, via proxy+shim)', `${pass} / ${fail}`, pass === 78 && fail === 0 ? 'consistent' : 'differs', 'live-vs-live', 'a failure usually means a provider returned HTTP 429/empty (see logs in tests/)');
  return { data: { pass, fail }, tables: [{ name: 'test_scripts', headers: ['script', 'pass', 'fail', 'exit code', 'seconds', 'failed assertions'], rows }] };
});

// ───────────────────────────── C0 — live collection (per-provider settle time, raw payloads) ─────────────────────────────
exp('C0', 'Live per-provider retrieval (adapters, concurrent like the orchestrator)', 'LIVE', 'E3 model inputs; Sec. VI-B', ['app', 'net'], async () => {
  CAPTURE = (e) => (e.prov === 'arxiv' || (e.prov === 'pubmed' && /efetch/.test(e.path))) && e.status === 200;
  const col = [], settle = {}, errs = [];
  for (const query of CFG.queries) {
    const srcs = RL.active(), i0 = HTTP.length;
    const rs = await Promise.all(srcs.map(async (s) => { const t = performance.now(); try { const raw = await APP.fetchers[s](query, CFG.limit, 'date'); return { s, raw, ms: performance.now() - t }; } catch (e) { return { s, raw: [], ms: performance.now() - t, error: e.message }; } }));
    const per = {}, xml = {};
    for (const r of rs) {
      (settle[r.s] ??= []).push(r.ms); if (r.error) { errs.push({ query, provider: r.s, error: r.error }); RL.note(r.s, /429/.test(r.error)); } else RL.note(r.s, false);
      const norm = r.raw.map(x => APP.normalizers[r.s](x)), pre = APP.rank(norm, 'date').slice(0, CFG.limit);
      per[r.s] = { ms: r.ms, rawCount: r.raw.length, error: r.error, raw: r.raw, norm, pre };
    }
    for (const r of reqsSince(i0)) if (r.captured) xml[r.prov] = r.captured;
    col.push({ query, per, xml }); await sleep(CFG.gap);
  }
  CAPTURE = null; SHARED.collect = col;
  const light = col.map(c => ({ query: c.query, providers: Object.fromEntries(Object.entries(c.per).map(([s, v]) => [s, { ms: Math.round(v.ms), rawCount: v.rawCount, error: v.error, records: v.pre.map(p => ({ source: p.source, source_id: p.source_id, title: p.title, doi: p.doi, year: p.year, nAuthors: p.authors.length, hasAbstract: !!p.abstract, pdfHost: p.pdf_url ? new URL(p.pdf_url).hostname : null })) }])) }));
  saveRaw('live_records', light);
  const rows = Object.entries(settle).map(([s, xs]) => { const st = stats(xs); const nerr = errs.filter(e => e.provider === s).length; return [s, st.n, f(st.median, 0), `${f(st.p25, 0)}–${f(st.p75, 0)}`, f(st.min, 0), f(st.max, 0), nerr]; });
  cmp('C0', 'provider settle times', 'not measured in cloud (emulated)', 'see table', 'info', 'informational', 'first genuine per-provider latency data; used as inputs to the E3 model check');
  return { data: { settle: Object.fromEntries(Object.entries(settle).map(([s, xs]) => [s, stats(xs)])), errors: errs }, tables: [{ name: 'provider_settle_ms', headers: ['provider', 'n', 'median ms', 'IQR ms', 'min', 'max', 'errors'], rows }, { name: 'provider_errors', headers: ['query', 'provider', 'error'], rows: errs.map(e => [e.query, e.provider, e.error]) }] };
});

// ───────────────────────────── E1 — normalization on real payloads ─────────────────────────────
exp('E1', 'Normalizer cost, XML parsing and field completeness on live payloads', 'LIVE', 'Sec. VI-D (3.1–6.6 µs/record; XML 2.4–7.4 ms/100 entries)', ['collect'], async () => {
  const { parseStringPromise } = await import('xml2js');
  const rows = [], comp = [], xmlRows = [], FIELDS = ['doi', 'abstract', 'year', 'venue', 'pdf_url', 'citation_count'], KEYS = ['id', 'source', 'source_id', 'title', 'abstract', 'authors', 'year', 'venue', 'doi', 'url', 'pdf_url', 'citation_count'];
  for (const s of APP.ALL) {
    const raws = SHARED.collect.flatMap(c => c.per[s]?.raw ?? []); if (!raws.length) { rows.push([s, 0, '–', '–']); continue; }
    const norm = APP.normalizers[s], per = [];
    for (let p = 0; p < 11; p++) { const t = performance.now(); for (const r of raws) norm(r); const dt = (performance.now() - t) / raws.length * 1000; if (p >= 2) per.push(dt); }
    const st = stats(per); rows.push([s, raws.length, f(st.median, 2), `${f(st.p25, 2)}–${f(st.p75, 2)}`]);
    const recs = raws.map(norm); const bad = recs.filter(r => KEYS.some(k => !(k in r) || r[k] === undefined) || !Array.isArray(r.authors)).length;
    comp.push([s, recs.length, ...FIELDS.map(k => f(100 * recs.filter(r => r[k] != null && r[k] !== '').length / recs.length, 0) + '%'), f(100 * recs.filter(r => r.authors.length).length / recs.length, 0) + '%', bad]);
  }
  for (const s of ['arxiv', 'pubmed']) { const xs = SHARED.collect.map(c => c.xml[s]).filter(Boolean); for (const x of xs.slice(0, 1)) { const ts = []; for (let i = 0; i < 25; i++) { const t = performance.now(); await parseStringPromise(x, { explicitArray: false }); if (i >= 5) ts.push(performance.now() - t); } xmlRows.push([s, x.length, f(stats(ts).median, 2)]); } }
  cmp('E1', 'normalize cost per record (µs, median over providers)', '3.1–6.6', rows.filter(r => r[2] !== '–').map(r => r[2]).join(', '), 'info', 'informational', 'live payloads differ from the synthetic ones used in the cloud; compare orders of magnitude only');
  return { data: {}, tables: [{ name: 'normalize_us_per_record', headers: ['provider', 'records', 'median µs', 'IQR µs'], rows }, { name: 'xml_parse', headers: ['provider', 'bytes', 'median ms'], rows: xmlRows }, { name: 'field_completeness', headers: ['provider', 'records', ...FIELDS, 'authors>0', 'schema violations'], rows: comp }] };
});

// ───────────────────────────── E2 (live) — deduplication on real multi-provider results ─────────────────────────────
exp('E2', 'Deduplication on live multi-provider results (no ground truth: candidates, overlap, order sensitivity)', 'LIVE', 'Sec. VI-C (order dependence; DOI-less duplicates)', ['collect'], async () => {
  const r = rng(11), rows = [], ex = [], ord = [];
  for (const c of SHARED.collect) {
    const provs = Object.keys(c.per).filter(s => c.per[s].pre.length), pre = provs.flatMap(s => c.per[s].pre);
    if (pre.length < 2) continue;
    const out = APP.dedupe(pre.map(p => ({ ...p, authors: [...p.authors] }))), rel = cluster(out, [K.doi, K.src, K.relaxed]);
    const doiCount = {}; for (const p of pre) if (p.doi) (doiCount[p.doi] ??= new Set()).add(p.source);
    const crossDoi = Object.values(doiCount).filter(s => s.size > 1).length, missed = rel.filter(g => g.length > 1);
    // order sensitivity of the repository deduplicator on the same real records
    const sizes = new Set(); for (let i = 0; i < 100; i++) { const pm = shuffle(provs, r); sizes.add(APP.dedupe(pm.flatMap(s => c.per[s].pre).map(p => ({ ...p, authors: [...p.authors] }))).length); }
    rows.push([c.query, provs.length, pre.length, out.length, pre.length - out.length, crossDoi, missed.length, VARIANTS.uf_repo_keys(pre), [...sizes].sort((a, b) => a - b).join('/')]);
    for (const g of missed.slice(0, 3)) ex.push([c.query, ...g.map(i => `${out[i].source}|${out[i].year}|${out[i].doi || 'no-doi'}|${out[i].title.slice(0, 60)}`)]);
    ord.push([...sizes]);
  }
  const anyOrder = ord.some(s => s.length > 1), anyMiss = rows.some(x => x[6] > 0);
  cmp('E2', 'repository dedup output size depends on provider order (live data)', 'yes on synthetic DOI-less triples (1 000 vs 2 000)', anyOrder ? 'observed on live data' : 'not observed on this live data', 'info', 'live-vs-controlled', 'absence on live data does not contradict the controlled result; it only shows how often the pattern occurs');
  cmp('E2', 'live candidate residual duplicates (records the repo kept but a relaxed key links)', 'mechanism: DOI-less pairs missed (arXiv with others)', anyMiss ? 'present' : 'none found', 'info', 'live-vs-controlled', 'candidates need manual review; there is no ground truth');
  return { data: { rows }, tables: [{ name: 'live_dedup', headers: ['query', 'providers', 'raw records', 'repo output', 'removed', 'DOIs shared across providers', 'candidate groups missed', 'union-find (repo keys) output', 'repo output sizes over 100 provider orders'], rows }, { name: 'candidate_pairs_for_manual_review', headers: ['query', 'records in candidate group (source|year|doi|title)'], rows: ex }] };
});

// ───────────────────────────── E2c — controlled deduplication tests (synthetic ground truth) ─────────────────────────────
exp('E2c', 'Controlled deduplication tests: single-factor probes, false-merge probes, order dependence', 'CONTROLLED-LOCAL', 'Sec. VI-C (Fig. 4, Table VIII, probes)', ['app'], async () => {
  const W = makeWorks(CFG.nWorks, 1);
  const PERT = [['none', (w) => ({})], ['year -1', (w) => ({ year: w.year - 1 })], ['year +1', (w) => ({ year: w.year + 1 })], ['author "A. Surname"', () => ({ fmt: AUTH.dot })], ['author "Surname A"', () => ({ fmt: AUTH.fam })], ['author order reversed', (w) => ({ authors: [...w.authors].reverse() })], ['title trailing period', (w) => ({ title: w.title + '.' })], ['title upper-cased', (w) => ({ title: w.title.toUpperCase() })], ['title ": " -> " - "', (w) => ({ title: w.title.replace(': ', ' - ') })], ['title subtitle dropped', (w) => ({ title: w.title.split(':')[0] })], ['author diacritics folded', () => ({ fmt: AUTH.fold })], ['combined (Europe PMC-like)', (w) => ({ year: w.year - 1, title: w.title + '.', fmt: AUTH.fam })]];
  const A = {}, rowsA = [];
  for (const cond of ['both_doi', 's_no_doi']) for (const [name, mk] of PERT) {
    let n = 0; const m = { repo: 0, uf_repo_keys: 0, uf_relaxed: 0 };
    for (const w of W) {
      const R = rec(w, { source: 'openalex', doi: w.doi }), o = mk(w), S = rec(w, { source: cond === 'both_doi' ? 'semantic_scholar' : 'arxiv', doi: cond === 'both_doi' ? w.doi : null, ...o }), S0 = rec(w, { source: S.source, doi: S.doi });
      if (name !== 'none' && sig(S) === sig(S0)) continue; n++;
      for (const v of Object.keys(m)) if (VARIANTS[v]([R, S]) === 1) m[v]++;
    }
    A[`${cond}|${name}`] = Object.fromEntries(Object.entries(m).map(([k, x]) => [k, n ? x / n : null])); A[`${cond}|${name}`].n = n;
    if (cond === 's_no_doi') rowsA.push([name, n, f(A[`${cond}|${name}`].repo, 2), f(A[`${cond}|${name}`].uf_repo_keys, 2), f(A[`${cond}|${name}`].uf_relaxed, 2)]);
  }
  const expectRepo = (k) => (k === 'none' || k === 'title upper-cased' ? 1 : 0), expectRel = (k) => (k === 'author order reversed' || k === 'title subtitle dropped' ? 0 : 1);
  const okA = PERT.every(([k]) => A[`s_no_doi|${k}`].repo === expectRepo(k) && A[`s_no_doi|${k}`].uf_relaxed === expectRel(k)) && PERT.every(([k]) => Object.values(A[`both_doi|${k}`]).every(v => v === 1 || v === A[`both_doi|${k}`].n));
  cmp('E2c', 'pairwise recall matrix (12 probes × 2 DOI conditions × 3 variants)', 'repo 0.00 except none/case; relaxed 1.00 except reversed/subtitle; DOI pairs 1.00', okA ? 'identical pattern' : 'DIFFERENT (see table)', okA ? 'consistent' : 'differs', 'controlled-exact');
  // B probes
  const B = {}; const pair = (a, b) => Object.fromEntries(Object.keys(VARIANTS).map(v => [v, VARIANTS[v]([a, b]) === 1]));
  const cnt = (fn) => { const t = { repo: 0, uf_repo_keys: 0, uf_relaxed: 0 }; for (const w of W) { const r = pair(...fn(w)); for (const v in t) if (r[v]) t[v]++; } return t; };
  B.distinctDoi = cnt((w) => [rec(w, { source: 'openalex', doi: w.doi }), rec(w, { source: 'crossref', doi: w.doi + '.suppl' })]);
  B.sameInitial = cnt((w) => [rec(w, { source: 'semantic_scholar', doi: w.doi, authors: [{ g: 'Wei', f: 'Zhang' }, ...w.authors.slice(1)] }), rec(w, { source: 'arxiv', doi: null, authors: [{ g: 'Wen', f: 'Zhang' }, ...w.authors.slice(1)] })]);
  const empties = Array.from({ length: 100 }, (_, i) => ({ id: null, source: 'crossref', source_id: `10.1/x${i}`, title: '', abstract: null, authors: [], year: 2020, venue: null, doi: `10.1/x${i}`, url: '', pdf_url: null, citation_count: null }));
  B.empty = Object.fromEntries(Object.keys(VARIANTS).map(v => [v, VARIANTS[v](empties)]));
  const n = W.length, okB = B.distinctDoi.repo === n && B.empty.repo === 1 && B.sameInitial.repo === 0 && B.sameInitial.uf_relaxed === n;
  cmp('E2c', 'false-merge probes (distinct DOIs; 100 empty-title records; Wei/Wen Zhang)', '500/500 merged; 100→1 record; 0/500 repo, 500/500 relaxed', `${B.distinctDoi.repo}/${n}; ${B.empty.repo}; ${B.sameInitial.repo}/${n}, ${B.sameInitial.uf_relaxed}/${n}`, okB ? 'consistent' : 'differs', 'controlled-exact');
  // C order dependence
  const NW = makeWorks(CFG.orderWorks, 3), blocks = { A: NW.map(w => rec(w, { source: 'arxiv', doi: null })), B: NW.map(w => rec(w, { source: 'semantic_scholar', doi: w.doi })), C: NW.map(w => rec(w, { source: 'europe_pmc', doi: w.doi, title: w.title + '.', fmt: AUTH.fam })) };
  const perms = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])), rowsC = [];
  for (const p of perms(['A', 'B', 'C'])) { const ps = p.flatMap(k => blocks[k]); rowsC.push([p.join(''), VARIANTS.repo(ps), VARIANTS.uf_repo_keys(ps), VARIANTS.uf_relaxed(ps)]); }
  const N = NW.length, okC = rowsC.every(r => (['ABC', 'ACB', 'CAB', 'CBA'].includes(r[0]) ? r[1] === 2 * N : r[1] === N) && r[2] === N && r[3] === N);
  cmp('E2c', `order dependence (${N} works × 3 records, 6 orders)`, 'repo 2N for ABC/ACB/CAB/CBA, N for BAC/BCA; union-find N for all', rowsC.map(r => `${r[0]}:${r[1]}`).join(' '), okC ? 'consistent' : 'differs', 'controlled-exact');
  saveRaw('E2c_matrix', { A, B, C: rowsC });
  return { data: { A, B, C: rowsC }, tables: [{ name: 'recall_no_doi', headers: ['perturbation', 'n works', 'repo', 'uf repo keys', 'uf relaxed'], rows: rowsA }, { name: 'false_merge_probes', headers: ['probe', 'repo', 'uf repo keys', 'uf relaxed'], rows: [['distinct DOIs, same title/author/year (merged)', ...Object.values(B.distinctDoi)], ['100 empty-title records (output records)', ...Object.values(B.empty)], ['same surname+initial, different person (merged)', ...Object.values(B.sameInitial)]] }, { name: 'order_dependence', headers: ['order', 'repo', 'uf repo keys', 'uf relaxed'], rows: rowsC }] };
});

// ───────────────────────────── E2b — controlled scaling of deduplicate() ─────────────────────────────
exp('E2b', 'Controlled scaling of deduplicate() (synthetic records, 30 % duplicates)', 'CONTROLLED-LOCAL', 'Sec. VI-D (2.3 ms @1k, 28 ms @10k, 626 ms @100k)', ['app'], async () => {
  const rows = [], PAPER_MS = { 1000: 2.3, 10000: 28, 100000: 626 }; let okCounts = true;
  for (const n of CFG.dedupSizes) {
    const base = makeWorks(Math.ceil(n * .7), 77).map((w, i) => rec(w, { source: 'crossref', doi: i % 3 === 0 ? null : w.doi })), r = rng(5), recs = base.slice();
    while (recs.length < n) { const o = base[Math.floor(r() * base.length)]; recs.push({ ...o, source: 'arxiv', source_id: 'x' + recs.length, doi: null, authors: [...o.authors] }); }
    const input = shuffle(recs, r).slice(0, n), row = [n], reps = n >= 1e5 ? 5 : 9;
    for (const v of Object.keys(VARIANTS)) { const ts = []; let out = 0; for (let i = 0; i < reps; i++) { const t = performance.now(); out = VARIANTS[v](input); if (i >= 2) ts.push(performance.now() - t); } row.push(f(stats(ts).median, 2), out); if (v === 'repo' && out !== Math.ceil(n * .7)) okCounts = false; }
    rows.push(row);
  }
  cmp('E2b', 'output records = 70 % of n for all variants', '70 % of n (700 / 7 000 / 70 000 at n = 1k / 10k / 100k)', rows.map(r => r[2]).join(' / '), okCounts ? 'consistent' : 'differs', 'controlled-exact');
  for (const r of rows) if (PAPER_MS[r[0]]) cmp('E2b', `deduplicate() ms @ n=${r[0]}`, PAPER_MS[r[0]], r[1], 'info', 'controlled-timing', 'hardware-dependent; compare scaling shape (≈ linear), not absolute ms');
  return { data: { rows }, tables: [{ name: 'dedup_scaling', headers: ['n', 'repo ms', 'repo out', 'uf repo keys ms', 'out', 'uf relaxed ms', 'out'], rows }] };
});

// ───────────────────────────── E3 — live orchestrator: latency model, throttles, request counts, failures ─────────────────────────────
exp('E3', 'Live orchestrator latency vs. model, adapter throttles, request counts, natural failures', 'LIVE', 'Sec. VI-B (Fig. 3, Tab. VI; model T = max T_s + ε)', ['app', 'net'], async () => {
  const S = []; let idx = 0;
  for (const k of CFG.ks) for (let r = 0; r < CFG.reps; r++) { const s = await liveSearch(CFG.queries[idx++ % CFG.queries.length], k); S.push(s); say(`  E3 k=${k} rep ${r + 1}/${CFG.reps}: ${f(s.ms, 0)} ms, ${s.count} papers, ${s.reqs} requests`); }
  const sweep = CFG.ks.map(k => { const x = S.filter(s => s.k === k); return [k, x.length, f(stats(x.map(s => s.ms)).median, 0), f(stats(x.map(s => s.maxChain)).median, 0), f(stats(x.map(s => s.eps)).median, 0), f(stats(x.map(s => s.count)).median, 0), f(stats(x.map(s => s.reqs)).median, 0), f(stats(x.map(s => s.count / (s.ms / 1000))).median, 1)]; });
  // warm start (arXiv adapter throttle)
  const warm = [];
  for (const gap of [0, 1000, 2000, 3500]) for (let r = 0; r < CFG.warmReps; r++) {
    const a = await liveSearch(CFG.queries[r % CFG.queries.length], CFG.limit, RL.active(), { quiet: true }); await sleep(gap);
    const b = await liveSearch(CFG.queries[(r + 1) % CFG.queries.length], CFG.limit, RL.active(), { quiet: true });
    const aS = a.firstStart.arxiv, bS = b.firstStart.arxiv; const waitObs = bS != null ? bS - b.t0 : null, pred = aS != null ? Math.max(0, 3000 - (b.t0 - aS)) : null;
    warm.push([gap, f(a.ms, 0), f(b.ms, 0), f(waitObs, 0), f(pred, 0), waitObs != null && pred != null ? f(Math.abs(waitObs - pred), 0) : '–']); await sleep(CFG.gap);
  }
  // throttle invariants over every adapter call made so far (real or injected)
  const gaps = (p) => { const t = HTTP.filter(r => r.prov === p).map(r => r.t).sort((a, b) => a - b); return t.slice(1).map((x, i) => x - t[i]); };
  const gA = gaps('arxiv'), gP = gaps('pubmed'), minA = Math.min(...gA), minP = Math.min(...gP);
  // request amplification
  const amp = S.map(s => { const enr = s.byProv.epmc_enrich || 0, raw = s.stats.europe_pmc?.raw ?? 0; return [s.k, s.query, s.reqs, enr, raw, enr <= raw ? 'ok' : 'VIOLATION']; });
  // natural failures
  const fail = {}; for (const s of S) for (const [p, v] of Object.entries(s.stats)) { const x = (fail[p] ??= { ok: 0, empty: 0, failed: 0, e429: 0 }); if (v.status === 'failed') { x.failed++; if (/429/.test(v.error || '')) x.e429++; } else if (v.raw === 0) x.empty++; else x.ok++; }
  const modelErr = S.map(s => s.eps);
  cmp('E3', 'ε = observed − max adapter chain (live, ms median)', '4–11 ms (emulated)', f(stats(modelErr).median, 0), stats(modelErr).median < 150 ? 'consistent' : 'differs', 'live-vs-emulated qualitative', 'model T = max T_s + ε holds if ε is small relative to T');
  cmp('E3', 'min gap between consecutive arXiv adapter calls (ms)', '≥ 3000', f(minA, 0), minA >= 2950 ? 'consistent' : 'differs', 'live-vs-code', 'verifies the 3 s adapter throttle on real traffic');
  cmp('E3', 'min gap between consecutive PubMed requests (ms)', '≥ 350', f(minP, 0), minP >= 320 ? 'consistent' : 'differs', 'live-vs-code');
  cmp('E3', 'Europe PMC → Crossref look-ups ≤ Europe PMC hits (all searches)', 'N_req = 7 + n (n ≤ k)', amp.every(a => a[5] === 'ok') ? 'holds' : 'VIOLATED', amp.every(a => a[5] === 'ok') ? 'consistent' : 'differs', 'live-vs-code');
  const wErr = warm.map(w => +w[5]).filter(x => !Number.isNaN(x)); if (wErr.length) cmp('E3', 'arXiv throttle wait: |observed − predicted| (ms, median)', '≈0 (emulated)', f(stats(wErr).median, 0), stats(wErr).median < 150 ? 'consistent' : 'differs', 'live-vs-emulated qualitative');
  return { data: { searches: S.map(({ papers, ...r }) => r), minArxivGap: minA, minPubmedGap: minP }, tables: [
    { name: 'sweep', headers: ['k', 'searches', 'total ms', 'max adapter chain ms', 'ε ms', 'papers', 'requests', 'papers/s'], rows: sweep },
    { name: 'warm_start', headers: ['idle gap ms', 'search A ms', 'search B ms', 'arXiv wait observed ms', 'predicted ms', '|err| ms'], rows: warm },
    { name: 'request_counts', headers: ['k', 'query', 'HTTP requests', 'EPMC→Crossref look-ups', 'EPMC hits', 'check'], rows: amp },
    { name: 'natural_provider_outcomes', headers: ['provider', 'ok', 'empty (success, 0)', 'failed', 'of which HTTP 429'], rows: Object.entries(fail).map(([p, v]) => [p, v.ok, v.empty, v.failed, v.e429]) }] };
});

// ───────────────────────────── E3f — fault injection into live searches ─────────────────────────────
exp('E3f', 'Fault injection into one provider while the others are live', 'LIVE+INJECTED', 'Sec. VI-B (Tab. VII: status reporting, containment, hang = adapter timeout)', ['app', 'net'], async () => {
  const base = await liveSearch(CFG.queries[0], CFG.limit, APP.ALL), bs = Object.fromEntries(Object.entries(base.stats).map(([p, v]) => [p, v.status]));
  const rows = [], runs = [];
  const run = async (p, seq, label) => {
    setRule({ host: HOST[p], seq }); const s = await liveSearch(CFG.queries[1 % CFG.queries.length], CFG.limit, APP.ALL); setRule(null);
    const st = s.stats[p], listed = s.failures.some(x => x.source === p), others = Object.entries(s.stats).filter(([k]) => k !== p).every(([k, v]) => v.status === bs[k]);
    runs.push({ p, label, status: st?.status, raw: st?.raw, listed, others, ms: s.ms, reqs: s.reqs }); rows.push([p, label, st?.status, st?.raw, listed ? 'yes' : 'NO', others ? 'yes' : 'no', f(s.ms / 1000, 2), s.reqs]); say(`  E3f ${p} ${label}: reported ${st?.status}, listed=${listed}, ${f(s.ms, 0)} ms`);
  };
  for (const p of APP.ALL) for (const m of ['http500', 'neterror']) await run(p, [m], m);
  await run('semantic_scholar', ['http429'], 'http429');
  for (const p of CFG.hangSources) for (let i = 0; i < CFG.hangReps; i++) { await sleep(CFG.gap); await run(p, ['hang'], `hang #${i + 1}`); }
  const okStatus = runs.filter(r => /^http500|neterror|http429/.test(r.label)).every(r => r.p === 'arxiv' ? (r.status === 'success' && r.raw === 0 && !r.listed) : (r.status === 'failed' && r.listed));
  cmp('E3f', 'status reporting under injected HTTP 500 / network error / 429', 'five providers failed+listed; arXiv success, 0 items, not listed', okStatus ? 'same behaviour' : 'DIFFERENT (see table)', okStatus ? 'consistent' : 'differs', 'controlled-exact (live others)');
  cmp('E3f', 'containment: other providers unchanged vs. un-injected baseline', 'unchanged', runs.every(r => r.others) ? 'unchanged in all runs' : 'changed in some runs (natural 429s?)', runs.every(r => r.others) ? 'consistent' : 'info', 'controlled (live others)', 'naturally rate-limited providers can fluctuate between runs');
  const PT = { openalex: 15.02, pubmed: 25.03, arxiv: 30.03 };
  for (const p of CFG.hangSources) { const x = runs.filter(r => r.p === p && r.label.startsWith('hang')).map(r => r.ms / 1000); cmp('E3f', `hang → search time until adapter timeout, ${p} (s, median)`, PT[p], f(stats(x).median, 2), approx(stats(x).median, PT[p], 1.5) ? 'consistent' : 'differs', 'controlled-timing', 'whole result set is held back until the adapter timeout (no global deadline)'); }
  return { data: { baseline: bs, runs }, tables: [{ name: 'fault_runs', headers: ['provider (faulted)', 'injected fault', 'reported status', 'raw count', 'listed in providerFailures', 'others = baseline', 'search s', 'requests'], rows }] };
});

// ───────────────────────────── E4 — PostgreSQL with live data ─────────────────────────────
const dbRows = async () => (await APP.db.query('SELECT source, source_id, title, authors, year, doi FROM papers')).rows.map(r => ({ ...r, authors: Array.isArray(r.authors) ? r.authors : [] }));
exp('E4', 'searchAndStore on live data: post-network phase, ID stability', 'LIVE', 'Sec. VI-D (Tab. X: ≈0.5–0.7 ms/paper on loopback with emulated data)', ['app', 'net'], async () => {
  const rows = [], idOk = [];
  for (const k of QUICK ? [10, 25] : [10, 25, 50]) {
    await APP.db.query('TRUNCATE papers'); const qy = CFG.queries[0];
    const i0 = HTTP.length, t0 = now(), r1 = await APP.svc.searchAndStore(qy, RL.active(), k, 'date'), tot = now() - t0, rs = reqsSince(i0), lastNet = Math.max(0, ...rs.filter(x => x.mode === 'real').map(x => x.end ?? 0)), post = t0 + tot - lastNet; note429(r1.providerStats);
    const rowsAfter = +(await APP.db.query('SELECT count(*)::int n FROM papers')).rows[0].n, ids1 = new Map(r1.succeeded.map(p => [`${p.source}:${p.source_id}`, p.id]));
    await sleep(CFG.gap); const t1 = now(), r2 = await APP.svc.searchAndStore(qy, RL.active(), k, 'date'), tot2 = now() - t1; await sleep(CFG.gap);
    let common = 0, same = 0; for (const p of r2.succeeded) { const id = ids1.get(`${p.source}:${p.source_id}`); if (id) { common++; if (id === p.id) same++; } }
    const exist = +(await APP.db.query('SELECT count(*)::int n FROM papers WHERE id = ANY($1::uuid[])', [r1.succeeded.map(p => p.id)])).rows[0].n;
    rows.push([k, r1.succeeded.length, r1.failed.length, f(tot, 0), f(post, 1), f(r1.succeeded.length ? post / r1.succeeded.length : NaN, 2), f(tot2, 0), rowsAfter, `${same}/${common}`, `${exist}/${r1.succeeded.length}`]); idOk.push(same === common && exist === r1.succeeded.length && r1.failed.length === 0);
  }
  cmp('E4', 'IDs stable across repeated live search; returned IDs exist in DB; no failed inserts', 'stable (emulated data)', idOk.every(Boolean) ? 'stable' : 'NOT stable', idOk.every(Boolean) ? 'consistent' : 'differs', 'live-vs-emulated qualitative');
  cmp('E4', 'post-network phase per paper (ms; normalize+dedup+rank+persist)', '≈0.5–0.7 ms DB only (emulated, loopback)', rows.map(r => r[5]).join(' / '), 'info', 'informational', 'includes local compute and your PostgreSQL; not directly comparable');
  return { data: { rows }, tables: [{ name: 'search_and_store', headers: ['k', 'papers stored', 'failed inserts', 'total ms (live search+store)', 'post-network ms', 'post-network ms/paper', 'repeat search ms', 'rows in table', 'stable ids (same/common)', 'returned ids found in DB'], rows }] };
});
exp('E4b', 'Persisted duplicates over a multi-query live session', 'LIVE', 'Sec. VI-D (12.6 % duplicate rows, DOI-less arXiv rows)', ['app', 'net'], async () => {
  await APP.db.query('TRUNCATE papers'); const steps = [];
  for (const qy of CFG.sessionQueries) {
    const r = await APP.svc.searchAndStore(qy, RL.active(), 20, 'date'); note429(r.providerStats); const rs = await dbRows(), cl = cluster(rs, [K.doi, K.src, K.relaxed]);
    steps.push([steps.length + 1, qy, rs.length, cl.length, rs.length - cl.length, rs.filter(x => !x.doi).length]); await sleep(CFG.gap);
  }
  const by = (await APP.db.query('SELECT source, count(*)::int n, count(doi)::int with_doi FROM papers GROUP BY source ORDER BY source')).rows, last = steps.at(-1);
  cmp('E4b', 'candidate duplicate rows / rows (relaxed-key clusters; no ground truth)', '12.6 % (synthetic, ground truth)', `${last[4]}/${last[2]} = ${f(100 * last[4] / last[2], 1)} %`, 'info', 'live-vs-controlled', 'live value is an estimate by the relaxed key and may over/under-count');
  return { data: { steps, by }, tables: [{ name: 'session', headers: ['after query #', 'query', 'rows', 'clusters (relaxed)', 'candidate duplicate rows', 'rows without DOI'], rows: steps }, { name: 'rows_by_source', headers: ['source', 'rows', 'with DOI'], rows: by.map(b => [b.source, b.n, b.with_doi]) }] };
});
exp('E4c', 'Controlled library-scan scaling (bulk-loaded rows + stub PDF files, real PostgreSQL and filesystem)', 'CONTROLLED-LOCAL', 'Sec. VI-D (Fig. 5b; ≈47–52 ns per row–file pair)', ['app'], async () => {
  const rows = [], res = {}; const raw = path.join(OUT, 'workspace', 'raw_papers');
  for (const P of CFG.libP) {
    await APP.db.query('TRUNCATE papers');
    await APP.db.query(`INSERT INTO papers (id, source, source_id, title, authors, year, doi, url, local_pdf_path) SELECT gen_random_uuid(), 'crossref', 'sid-' || g, 'Synthetic ' || g, '["A B"]'::jsonb, 2020, '10.9/' || g, '', NULL FROM generate_series(1, $1) g`, [P]);
    for (const F of CFG.libF) {
      fs.rmSync(raw, { recursive: true, force: true }); fs.mkdirSync(raw, { recursive: true }); for (let i = 0; i < F; i++) fs.writeFileSync(path.join(raw, `external_document_${i}.pdf`), '%PDF-1.4\n');
      const ts = []; for (let r = 0; r < 6; r++) { const t = performance.now(), lib = await APP.svc.getLibraryPapers(); if (r) ts.push(performance.now() - t); if (!r && lib.length !== F) throw new Error(`library size ${lib.length} != ${F}`); }
      res[`${P}|${F}`] = stats(ts).median; rows.push([P, F, f(res[`${P}|${F}`], 1)]);
    }
  }
  fs.rmSync(raw, { recursive: true, force: true }); await APP.db.query('TRUNCATE papers');
  const ns = CFG.libP.flatMap(P => { const F = CFG.libF.at(-1); return F ? [(res[`${P}|${F}`] - res[`${P}|0`]) * 1e6 / (P * F)] : []; });
  cmp('E4c', 'library scan: ns per (row × unmatched file) pair', '47–52', ns.map(x => f(x, 0)).join(' / '), ns.every(x => x > 5 && x < 500) ? 'consistent' : 'differs', 'controlled-timing', 'hardware-dependent; the product-of-rows-and-files scaling is the claim');
  return { data: { res, ns }, tables: [{ name: 'library_scan_ms', headers: ['DB rows P', 'PDF files F', 'getLibraryPapers() median ms'], rows }] };
});

// ───────────────────────────── P1 — real PDF acquisition ─────────────────────────────
exp('P1', 'PDF acquisition with the application\'s downloadPaperPdf (real hosts)', 'LIVE', 'Sec. VI-F (live: PDF retrieval worked for OpenAlex and arXiv)', ['app', 'net', 'collect'], async () => {
  const picks = {}; for (const c of SHARED.collect) for (const [s, v] of Object.entries(c.per)) for (const p of v.pre) if (p.pdf_url && (picks[s] ??= []).length < CFG.pdfPer && !picks[s].some(x => x.pdf_url === p.pdf_url)) picks[s].push(p);
  const rows = [], dir = path.join(OUT, 'pdfs'); let okN = 0, tot = 0, bytes = 0, secs = 0;
  for (const [s, ps] of Object.entries(picks)) for (const p of ps) {
    tot++; const host = new URL(p.pdf_url).hostname, t = performance.now(); let st = 'ok', size = 0, again = '', msFirst = null;
    try { const r = await APP.svc.downloadPaperPdf({ paperId: null, url: p.pdf_url, targetDirectory: dir, filename: p.title }); msFirst = performance.now() - t; size = fs.statSync(r.localPath).size; const head = Buffer.alloc(5); const fd = fs.openSync(r.localPath, 'r'); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd); if (head.toString('ascii') !== '%PDF-') st = 'INVALID (no %PDF- header)'; const r2 = await APP.svc.downloadPaperPdf({ paperId: null, url: p.pdf_url, targetDirectory: dir, filename: p.title }); again = r2.alreadyExists ? 'dedup ok' : 're-downloaded'; }
    catch (e) { st = 'FAILED: ' + e.message.slice(0, 90); }
    const ms = msFirst ?? performance.now() - t; if (st === 'ok') { okN++; bytes += size; secs += ms / 1000; }
    rows.push([s, host, st, f(ms, 0), f(size / 1024, 0), again, p.title.slice(0, 50)]); await sleep(1000);
  }
  if (!tot) throw new Skip('no retrieved record carried a pdf_url');
  cmp('P1', 'PDF retrieval success (per provider with candidates)', 'worked for OpenAlex and arXiv (user-recorded live session)', `${okN}/${tot} ok; ` + [...new Set(rows.filter(r => r[2] === 'ok').map(r => r[0]))].join(', '), okN > 0 ? 'consistent' : 'differs', 'live-vs-live', 'success depends on publisher bot-walls; failures are recorded with their reason');
  return { data: { okN, tot, MBps: secs ? bytes / 2 ** 20 / secs : null }, tables: [{ name: 'pdf_downloads', headers: ['provider', 'host', 'result', 'download ms (first call)', 'KiB', 'second call', 'title'], rows }] };
});

// ───────────────────────────── E5 — AI analysis (live Groq) ─────────────────────────────
const DEFAULT_PROMPT = 'For the following research paper, provide a concise Summary, a detailed Methodology, and potential Future Work. Format the output as Markdown.';   // default text of the in-app "Analysis Directive"
const safeName = (t) => String(t).replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 100);
exp('E5', 'AI analysis of live papers with the real Groq pipeline (analyze + save, serial)', 'LIVE', 'Sec. VI-F (user-recorded: 8 papers analyzed and saved in 27 s ≈ 3.4 s/paper)', ['app', 'net', 'groq', 'collect'], async () => {
  const pool = SHARED.collect.flatMap(c => Object.values(c.per).flatMap(v => v.pre)).filter(p => p.abstract && p.abstract.length > 200); const seen = new Set(), papers = [];
  for (const p of pool) { const k = (p.doi || p.title).toLowerCase(); if (!seen.has(k) && papers.length < CFG.aiPapers) { seen.add(k); papers.push(p); } }
  if (papers.length < 1) throw new Skip('no retrieved paper has an abstract');
  const ai = APP.ai; ai.lastRequestTime = 0; const rows = [], starts = [], dur = [], T = now();
  for (const [i, p] of papers.entries()) {
    const i0 = HTTP.length, t0 = now(); let st = 'ok', len = 0;
    try { const text = await ai.analyzePaper(p, DEFAULT_PROMPT); len = text.length; fs.writeFileSync(path.join(OUT, 'analysis', `${safeName(p.title)}.md`), text, 'utf8'); } catch (e) { st = 'FAILED: ' + e.message.slice(0, 80); }
    const t1 = now(), gq = reqsSince(i0).filter(r => r.prov === 'groq'); starts.push(gq[0]?.t ?? t0); dur.push(gq.length ? gq.at(-1).end - gq[0].t : 0);
    rows.push([i + 1, f(t1 - t0, 0), st, gq.length, gq.map(r => r.status ?? r.error).join(','), gq.map(r => r.usage?.completion_tokens).filter(Boolean).at(-1) ?? '', gq.map(r => r.usage?.prompt_tokens).filter(Boolean).at(-1) ?? '', len, p.title.slice(0, 50)]);
  }
  const total = now() - T, okN = rows.filter(r => r[2] === 'ok').length, mean = total / papers.length, gaps = starts.slice(1).map((s, i) => s - starts[i]);
  const minGap = gaps.length ? Math.min(...gaps) : null;
  const pred = gaps.map((g, i) => Math.max(dur[i], ai.minRequestInterval)); const err = gaps.map((g, i) => Math.abs(g - pred[i]));
  const rlh = HTTP.filter(r => r.prov === 'groq' && r.rl && Object.keys(r.rl).length).at(-1)?.rl ?? null;
  cmp('E5', 'AI analysis + save, whole batch (live)', '27 s for 8 papers = 3.375 s/paper (user-recorded, Windows)', `${f(total / 1000, 1)} s for ${papers.length} papers = ${f(mean / 1000, 2)} s/paper (${okN} ok)`, okN === papers.length ? 'info' : 'differs', 'live-vs-live', 'timing covers processing and saving, not accuracy; depends on model, prompt and Groq load');
  if (minGap != null) cmp('E5', 'min start-to-start gap between analyses (ms)', '≥ 2000 (τ)', f(minGap, 0), minGap >= 1950 ? 'consistent' : 'differs', 'live-vs-code', 'verifies the 2 s minimum interval on real calls');
  if (err.length) cmp('E5', 'start-to-start gap vs. model max(L, τ): |error| ms (median)', '≈0 (emulated)', f(stats(err).median, 0), stats(err).median < 400 ? 'consistent' : 'differs', 'live-vs-emulated qualitative');
  return { data: { total, mean, okN, rateLimitHeaders: rlh }, tables: [{ name: 'analyses', headers: ['#', 'ms (analyze+save)', 'result', 'Groq requests', 'statuses', 'completion tokens', 'prompt tokens', 'chars', 'title'], rows }], notes: ['Markdown reports are in analysis/ for manual accuracy review; accuracy was NOT evaluated.'] };
});
exp('E5n', 'Missing abstract sent to the live model ("Abstract: null")', 'LIVE', 'Sec. VI-E (prompt construction with null abstract)', ['app', 'net', 'groq'], async () => {
  APP.ai.lastRequestTime = 0; const i0 = HTTP.length; const text = await APP.ai.analyzePaper({ title: 'A study without a recorded abstract', abstract: null }, DEFAULT_PROMPT);
  const body = JSON.parse(reqsSince(i0).find(r => r.prov === 'groq').reqBody), user = body.messages.at(-1).content; fs.writeFileSync(path.join(OUT, 'analysis', 'E5n_null_abstract_response.md'), text, 'utf8');
  const sentNull = /Abstract: null/.test(user), refusal = /(no abstract|not provided|not available|cannot|can't|unable|insufficient|missing)/i.test(text);
  cmp('E5n', 'prompt contains the literal "Abstract: null"', 'yes (request captured)', sentNull ? 'yes' : 'no', sentNull ? 'consistent' : 'differs', 'live-vs-controlled');
  return { data: { sentNull, responseChars: text.length, heuristicMentionsMissingInfo: refusal }, tables: [{ name: 'null_abstract', headers: ['request contained "Abstract: null"', 'response chars', 'response mentions missing/insufficient info (keyword heuristic)'], rows: [[sentNull, text.length, refusal]] }], notes: ['Inspect analysis/E5n_null_abstract_response.md manually: does the model fabricate content? (the keyword heuristic is only a hint)'] };
});

// ───────────────────────────── E5c — controlled AI-client tests (Groq calls injected; nothing is sent) ─────────────────────────────
exp('E5c', 'Controlled AI-client tests: 429 back-off, non-retried errors, failure isolation, prompt construction', 'CONTROLLED-LOCAL', 'Sec. VI-E (Fig. 6b; HTTP 400/401/500/503 not retried; prompt)', ['app'], async () => {
  const ai = APP.ai, savedKey = ai.apiKey; if (!ai.apiKey) ai.apiKey = 'controlled-test-key';
  const gapsOf = (i0) => { const t = reqsSince(i0).filter(r => r.prov === 'groq').map(r => r.t); return t.slice(1).map((x, i) => x - t[i]); };
  const back = [], errs = [], one = { title: 'T', abstract: 'A' }; let okBack = true;
  for (let k = 1; k <= 4; k++) for (let rep = 0; rep < CFG.backoffReps; rep++) {
    setRule({ host: HOST.groq, seq: k < 4 ? [...Array(k).fill('http429'), 'ok200'] : ['http429'] }); ai.lastRequestTime = 0; const i0 = HTTP.length, t0 = now(); let out = 'ok'; try { await ai.analyzePaper(one, 'S'); } catch (e) { out = 'threw'; } setRule(null);
    const g = gapsOf(i0), n = reqsSince(i0).length; back.push([k, rep + 1, n, out, f(now() - t0, 0), g.map(x => f(x, 0)).join(', ')]);
    const bounds = [[2000, 2600], [4000, 4600], [8000, 8600]]; if (!g.every((x, i) => x >= bounds[i][0] - 30 && x <= bounds[i][1] + 30) || (k < 4 ? out !== 'ok' || n !== k + 1 : out !== 'threw' || n !== 4)) okBack = false;
  }
  for (const st of [400, 401, 500, 503]) { setRule({ host: HOST.groq, seq: [`http${st}`] }); ai.lastRequestTime = 0; const i0 = HTTP.length; let m = ''; try { await ai.analyzePaper(one, 'S'); } catch (e) { m = e.message; } setRule(null); errs.push([st, reqsSince(i0).length, m.slice(0, 60)]); }
  const okErr = errs.every(e => e[1] === 1);
  setRule({ host: HOST.groq, seq: ['ok200', 'ok200', 'http400', 'ok200'] }); ai.lastRequestTime = 0; const iso = await APP.pipeline.processPapers(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: `Paper ${i}`, abstract: `Abstract ${i}.` })), 'S'); setRule(null);
  const okIso = iso.succeeded.length === 4 && iso.failed.length === 1;
  const prompt = []; setRule({ host: HOST.groq, seq: ['ok200'] });
  for (const [name, p] of [['null', { title: 'X', abstract: null }], ['undefined', { title: 'X' }], ['20000-word abstract', { title: 'Long', abstract: 'word '.repeat(20000) }]]) { ai.lastRequestTime = 0; const i0 = HTTP.length; await ai.analyzePaper(p, 'Extract the methodology.'); const b = JSON.parse(reqsSince(i0).find(r => r.prov === 'groq').reqBody), u = b.messages.at(-1).content; prompt.push([name, u.slice(0, 50).replace(/\n/g, '\\n'), u.length, b.model, b.temperature, b.max_tokens]); }
  setRule(null); ai.apiKey = savedKey;
  const okP = prompt[0][1].includes('Abstract: null') && prompt[1][1].includes('Abstract: undefined') && prompt[2][2] === 100060;
  cmp('E5c', 'back-off waits for 1/2/3 consecutive 429 = 2.0–2.5 / 4.0–4.5 / 8.0–8.5 s; 4th 429 throws after 4 requests', 'as stated (emulated)', okBack ? 'same behaviour' : 'DIFFERENT (see table)', okBack ? 'consistent' : 'differs', 'controlled-exact');
  cmp('E5c', 'HTTP 400/401/500/503 are not retried (1 request each)', 'yes', errs.map(e => e[1]).join('/'), okErr ? 'consistent' : 'differs', 'controlled-exact');
  cmp('E5c', 'failure isolation in processPapers (1 injected 400 among 5)', '4 succeeded / 1 failed', `${iso.succeeded.length} / ${iso.failed.length}`, okIso ? 'consistent' : 'differs', 'controlled-exact');
  cmp('E5c', 'prompt: null/undefined abstract sent literally; 20 000-word abstract not truncated (100 060 chars)', 'yes', prompt.map(p => p[2]).join('/'), okP ? 'consistent' : 'differs', 'controlled-exact');
  return { data: { back, errs, prompt }, tables: [{ name: 'backoff', headers: ['consecutive 429', 'rep', 'requests', 'outcome', 'total ms', 'gaps between requests ms'], rows: back }, { name: 'non_retried_errors', headers: ['HTTP status', 'requests', 'message'], rows: errs }, { name: 'prompt_construction', headers: ['case', 'user message start', 'chars', 'model', 'temperature', 'max_tokens'], rows: prompt }] };
});

// ───────────────────────────── runner ─────────────────────────────
const NEEDS_OK = () => ({ app: !PRE.hard.length, net: !CONTROLLED_ONLY, groq: !CONTROLLED_ONLY && !!process.env.GROQ_API_KEY, collect: !!SHARED.collect });
async function runAll() {
  const sel = EXPS.filter(e => wanted(e.id)); let n = 0;
  say(`Running ${sel.length} experiments → ${OUT}`);
  for (const e of sel) {
    n++; const base = { id: e.id, title: e.title, class: e.cls, paperRef: e.paperRef };
    const lack = e.needs.filter(x => !NEEDS_OK()[x]);
    if (lack.length) { RESULTS[e.id] = { ...base, status: 'SKIPPED', reason: `requires ${lack.join(', ')}${lack.includes('net') ? ' (disabled by --controlled-only)' : lack.includes('groq') ? ' (no valid GROQ_API_KEY)' : lack.includes('collect') ? ' (live collection C0 did not run or failed)' : ''}` }; say(`[${n}/${sel.length}] ${e.id} SKIPPED: ${RESULTS[e.id].reason}`); continue; }
    CTX.exp = e.id; const i0 = HTTP.length, t = now(); say(`[${n}/${sel.length}] ${e.id} ${e.cls} — ${e.title}`);
    try {
      const r = await Promise.race([e.fn(), sleep(30 * 60 * 1000).then(() => { throw new Error('experiment exceeded 30 min'); })]), rs = reqsSince(i0), inj = rs.filter(x => x.mode !== 'real').length;
      if (e.cls === 'LIVE' && inj > 0) throw new Error(`INTEGRITY: ${inj} injected request(s) inside a LIVE experiment`);
      if (e.cls === 'CONTROLLED-LOCAL' && rs.some(x => x.mode === 'real')) throw new Error('INTEGRITY: real network request inside a CONTROLLED-LOCAL experiment');
      RESULTS[e.id] = { ...base, status: 'OK', seconds: (now() - t) / 1000, requestsReal: rs.length - inj, requestsInjected: inj, data: r.data, tables: r.tables ?? [], notes: r.notes ?? [] };
      for (const tb of RESULTS[e.id].tables) fs.writeFileSync(path.join(OUT, 'csv', `${e.id}_${tb.name}.csv`), csvOf(tb.headers, tb.rows));
      saveRaw(e.id, RESULTS[e.id]); say(`    done in ${f((now() - t) / 1000, 1)} s (${rs.length - inj} real / ${inj} injected requests)`);
    } catch (err) {
      if (err instanceof Skip) { RESULTS[e.id] = { ...base, status: 'SKIPPED', reason: err.message }; say(`    SKIPPED: ${err.message}`); }
      else { RESULTS[e.id] = { ...base, status: 'FAILED', error: String(err.stack || err), seconds: (now() - t) / 1000 }; say(`    FAILED: ${err.message}`); }
    }
    CAPTURE = null; setRule(null); CTX.exp = null; fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify({ updated: new Date().toISOString(), done: n, of: sel.length, last: e.id, status: Object.fromEntries(Object.entries(RESULTS).map(([k, v]) => [k, v.status])) }, null, 2));
  }
}

// ───────────────────────────── environment + report ─────────────────────────────
function environment() {
  const sh = (c) => { try { return execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const v = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return null; } };
  return { startedAt: new Date(Date.now() - now()).toISOString(), platform: `${os.type()} ${os.release()} ${os.arch()}`, platformName: process.platform, cpu: os.cpus()[0]?.model, vcpus: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), node: process.versions.node, v8: process.versions.v8, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, packages: { pg: v('pg'), xml2js: v('xml2js'), dotenv: v('dotenv'), electron: v('electron') }, postgres: PRE.info.postgres, repoCommit: sh('git rev-parse --short HEAD'), gitBranch: sh('git rev-parse --abbrev-ref HEAD'), keysPresent: PRE.info.keys, envFileFound: PRE.info.envFile, appSettingsFileUsed: !!PRE.info.settingsFile, providerPreflight: PRE.info.providerPing, isolatedDatabase: PRE.info.isolatedDatabase, userDatabaseUntouched: PRE.info.userDatabaseUntouched, config: { ...CFG, only: CFG.only ?? null }, flags: { quick: QUICK, controlledOnly: CONTROLLED_ONLY }, hostHash: crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 10) };
}
function report() {
  const env = environment(); fs.writeFileSync(path.join(OUT, 'environment.json'), JSON.stringify(env, null, 2));
  fs.writeFileSync(path.join(OUT, 'http_log.csv'), csvOf(['i', 'experiment', 't_ms', 'provider', 'host', 'path', 'mode', 'status', 'ms_to_headers', 'error', 'prompt_tokens', 'completion_tokens'], HTTP.map(r => [r.i, r.exp, Math.round(r.t), r.prov, r.host, r.path, r.mode, r.status ?? '', Math.round(r.ms ?? 0), r.error ?? '', r.usage?.prompt_tokens ?? '', r.usage?.completion_tokens ?? ''])));
  fs.writeFileSync(path.join(OUT, 'comparison_with_paper.csv'), csvOf(['experiment', 'item', 'paper', 'this run', 'verdict', 'basis', 'note'], cmpRows.map(c => [c.exp, c.item, c.paper, c.local, c.verdict, c.basis, c.note])));
  const R = Object.values(RESULTS), ok = R.filter(r => r.status === 'OK').length, fl = R.filter(r => r.status === 'FAILED'), sk = R.filter(r => r.status === 'SKIPPED');
  const real = HTTP.filter(r => r.mode === 'real').length, inj = HTTP.length - real;
  const sum = { runId: path.basename(OUT), ok, failed: fl.length, skipped: sk.length, httpRequestsReal: real, httpRequestsInjected: inj, comparisons: cmpRows.length, consistent: cmpRows.filter(c => c.verdict === 'consistent').length, differs: cmpRows.filter(c => c.verdict === 'differs').length, info: cmpRows.filter(c => c.verdict === 'info').length, rateLimitEvents: RL.events.length, warnings: PRE.warn };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(sum, null, 2));
  let m = `# RIE local evidence run — ${sum.runId}\n\nGenerated ${new Date().toISOString()} on **${env.platform}** (${env.cpu}, ${env.vcpus} vCPU, ${env.memGB} GB), Node ${env.node}, PostgreSQL ${env.postgres}, repo commit \`${env.repoCommit}\` (${env.gitBranch}).\n\n`;
  m += `**Evidence classes.** \`LIVE\` = real services, zero injected requests (asserted). \`LIVE+INJECTED\` = real services with one explicitly injected fault per run. \`CONTROLLED-LOCAL\` = synthetic inputs, no network — **never report these as live measurements**. \`STATIC\` = repository inspection.\n\n`;
  m += `**Safety.** Isolated database \`${env.isolatedDatabase}\` (dropped at the end${flag('keep-db') ? ' — kept, --keep-db' : ''}); your database \`${env.userDatabaseUntouched}\` was not touched. Workspace/PDF/analysis files are inside this directory. API keys are never written (only presence flags).\n\n`;
  m += `## Summary\n\n${mdTable(['experiments OK', 'failed', 'skipped', 'real HTTP requests', 'injected', 'paper comparisons', 'consistent', 'differs', 'informational', 'rate-limit events'], [[ok, fl.length, sk.length, real, inj, sum.comparisons, sum.consistent, sum.differs, sum.info, RL.events.length]])}\n`;
  if (PRE.warn.length) m += `### Preflight warnings\n\n${PRE.warn.map(w => `- ${w}`).join('\n')}\n\n`;
  m += `## Experiment index\n\n${mdTable(['ID', 'class', 'status', 'seconds', 'real req', 'injected req', 'paper reference', 'title'], R.map(r => [r.id, r.class, r.status === 'SKIPPED' ? `SKIPPED — ${r.reason}` : r.status, f(r.seconds, 1), r.requestsReal ?? '', r.requestsInjected ?? '', r.paperRef, r.title]))}\n`;
  m += `## Comparison with the paper\n\nVerdicts: *consistent* = same behaviour/pattern as reported; *differs* = investigate before reusing the paper's claim; *info* = not directly comparable (live vs emulated, or hardware-dependent). Basis tells how comparable the two numbers are.\n\n${mdTable(['exp', 'item', 'paper', 'this run', 'verdict', 'basis', 'note'], cmpRows.map(c => [c.exp, c.item, c.paper, c.local, c.verdict.toUpperCase(), c.basis, c.note]))}\n`;
  for (const r of R) {
    m += `## ${r.id} — ${r.title}\n\nClass: **${r.class}** · Paper: ${r.paperRef} · Status: **${r.status}**${r.seconds != null ? ` · ${f(r.seconds, 1)} s` : ''}\n\n`;
    if (r.status !== 'OK') { m += r.status === 'SKIPPED' ? `Skipped: ${r.reason}\n\n` : `\`\`\`\n${r.error}\n\`\`\`\n\n`; continue; }
    for (const t of r.tables) m += `**${t.name}**\n\n${t.rows.length ? mdTable(t.headers, t.rows) : '_(no rows)_\n'}\n`;
    for (const n of r.notes) m += `> ${n}\n\n`;
  }
  if (RL.events.length) m += `## Rate-limit events\n\n${mdTable(['time', 'provider', 'event'], RL.events.map(e => [e.t, e.provider, e.event]))}\n`;
  m += `## Files\n\n\`environment.json\`, \`summary.json\`, \`progress.json\`, \`comparison_with_paper.csv\`, \`http_log.csv\` (every HTTP request: provider, status, time; no query strings), \`raw/*.json\` (per experiment; \`live_records.json\` = normalised live records without abstracts), \`csv/*.csv\` (every table), \`tests/*.log\` (repository test output), \`analysis/\` (AI Markdown outputs for manual review), \`pdfs/\`, \`harness.log\`, \`app_console.log\`.\n\n## How to use this for the paper\n\nSend the whole run directory (or at least \`REPORT.md\`, \`summary.json\`, \`environment.json\`, \`comparison_with_paper.csv\`, \`raw/\`, \`csv/\`, \`http_log.csv\`). Live (\`LIVE\`) results can be reported as measurements on this machine; \`LIVE+INJECTED\` and \`CONTROLLED-LOCAL\` results must be reported as controlled tests.\n`;
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), m); return sum;
}

// ───────────────────────────── main ─────────────────────────────
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (ISODB && ADMIN && !flag('keep-db')) { try { await ADMIN.query(`DROP DATABASE IF EXISTS ${ISODB} WITH (FORCE)`); say(`isolated database ${ISODB} dropped`); } catch (e) { try { await ADMIN.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${ISODB}'`); await ADMIN.query(`DROP DATABASE IF EXISTS ${ISODB}`); say(`isolated database ${ISODB} dropped`); } catch (e2) { say(`WARNING: could not drop ${ISODB}: ${e2.message} — drop it manually`); } } }
  try { await ADMIN?.end(); } catch { /* closed */ }
}
process.on('SIGINT', async () => { say('interrupted — writing partial report and cleaning up'); try { report(); } catch { /* best effort */ } await cleanup(); process.exit(130); });
try {
  say(`RIE local evidence harness · output: ${OUT}${QUICK ? ' · QUICK mode' : ''}${CONTROLLED_ONLY ? ' · CONTROLLED-ONLY (no network)' : ''}`);
  await preflight();
  fs.writeFileSync(path.join(OUT, 'preflight.json'), JSON.stringify(PRE, null, 2));
  for (const w of PRE.warn) say(`  warning: ${w}`);
  if (PRE.hard.length) { for (const h of PRE.hard) say(`  PREFLIGHT FAILED: ${h}`); await cleanup(); process.exit(2); }
  say(`preflight OK · isolated database ${ISODB} on PostgreSQL ${PRE.info.postgres} · keys: ${Object.entries(PRE.info.keys).map(([k, v]) => `${k.replace('_API_KEY', '')}=${v ? 'yes' : 'no'}`).join(' ')}`);
  if (DRY) { say('--dry-run: nothing executed. Planned: ' + EXPS.filter(e => wanted(e.id)).map(e => `${e.id}[${e.cls}]`).join(' ')); await cleanup(); process.exit(0); }
  await runAll();
  const sum = report(); await cleanup();
  say(`DONE · ${sum.ok} OK, ${sum.failed} failed, ${sum.skipped} skipped · ${sum.consistent} consistent / ${sum.differs} differ / ${sum.info} informational vs. paper`);
  say(`Report: ${path.join(OUT, 'REPORT.md')}`);
  process.exit(sum.failed ? 1 : 0);
} catch (e) { say(`FATAL: ${e.stack || e}`); try { report(); } catch { /* best effort */ } await cleanup(); process.exit(1); }
