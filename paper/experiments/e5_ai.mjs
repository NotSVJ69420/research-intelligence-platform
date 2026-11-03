// E5: AI-analysis path (services/ai-service.js + ingestion/ai-pipeline.js) against an EMULATED chat-completions endpoint.
// The real Groq API is unreachable from the sandbox, so model latency L is an injected parameter; what is measured is
// the repository code's scheduling (rate limiting, retry/backoff, failure isolation) and request construction.
// A dummy API key is used; no real credential is involved.
// Usage: node e5_ai.mjs <spacing|backoff|errors|prompt>
import fs from 'fs';
import { installEmulator } from './lib/emulator.mjs';
import { summarize } from './lib/rng.mjs';

process.env.GROQ_API_KEY = 'dummy-key-for-emulator';
const mode = process.argv[2];
const ai = (await import('../../services/ai-service.js')).default;
const { processPapers } = await import('../../ingestion/ai-pipeline.js');
const save = (name, obj) => fs.writeFileSync(new URL(`../results/${name}.json`, import.meta.url), JSON.stringify(obj, null, 2));
const quiet = async (f) => { const l = console.log, w = console.warn, e = console.error; console.log = () => {}; console.warn = () => {}; console.error = () => {}; try { return await f(); } finally { console.log = l; console.warn = w; console.error = e; } };
const ok = (txt = 'Synthetic analysis.') => new Response(JSON.stringify({ choices: [{ message: { content: txt } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status) => new Response(JSON.stringify({ error: { message: `emulated ${status}` } }), { status, statusText: 'ERR', headers: { 'content-type': 'application/json' } });
const papers = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: `Paper ${i}`, abstract: `Abstract ${i}.` }));
const base = { corpus: [], seed: 1 };
const meta = { minRequestInterval_ms: ai.minRequestInterval, maxRetries: ai.maxRetries, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b (default in ai-service.js)' };

if (mode === 'spacing') {
  const N = 6; const rows = [];
  for (const L of [200, 1000, 2000, 3000]) {
    const emu = installEmulator({ ...base, latency: L, groq: { handler: () => ok() } });
    ai.lastRequestTime = 0;
    const t = performance.now();
    const r = await quiet(() => processPapers(papers(N), 'Summarize.'));
    const total = performance.now() - t;
    const starts = emu.log.map(e => e.t);                 // request arrival times at the emulator
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    emu.uninstall();
    rows.push({ L, N, succeeded: r.succeeded.length, total_ms: Math.round(total), startGaps_ms: summarize(gaps), model_total_ms: Math.round((N - 1) * Math.max(L, ai.minRequestInterval) + L), perPaper_ms: total / N });
    console.log('L', L, 'total', Math.round(total), 'gaps median', summarize(gaps).median.toFixed(0), 'model', (N - 1) * Math.max(L, ai.minRequestInterval) + L);
  }
  save('e5_spacing', { meta, rows });
}

if (mode === 'backoff') {
  const rows = [];
  for (const k of [1, 2, 3, 4]) for (let rep = 0; rep < 3; rep++) {
    let n = 0;
    const emu = installEmulator({ ...base, latency: 0, groq: { handler: () => (++n <= k ? err(429) : ok()) } });
    ai.lastRequestTime = 0;
    const t = performance.now(); let outcome = 'ok';
    try { await quiet(() => ai.analyzePaper({ title: 'T', abstract: 'A' }, 'Summarize.')); } catch (e) { outcome = 'threw: ' + e.message; }
    const total = performance.now() - t;
    const starts = emu.log.map(e => e.t); const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    emu.uninstall();
    rows.push({ consecutive429: k, rep, requestsIssued: emu.log.length, outcome, total_ms: Math.round(total), waitsBetweenAttempts_ms: gaps.map(Math.round) });
    console.log(JSON.stringify(rows.at(-1)));
  }
  save('e5_backoff', { meta, nominalWaits_ms: 'attempt a waits 2^a * 1000 + U[0,500) ms (ai-service.js l.81)', rows });
}

if (mode === 'errors') {
  const rows = [];
  for (const status of [400, 401, 500, 503]) {
    let n = 0;
    const emu = installEmulator({ ...base, latency: 0, groq: { handler: () => { n++; return err(status); } } });
    ai.lastRequestTime = 0; let outcome = 'ok';
    const t = performance.now();
    try { await quiet(() => ai.analyzePaper({ title: 'T', abstract: 'A' }, 'S')); } catch (e) { outcome = e.message; }
    emu.uninstall();
    rows.push({ status, requestsIssued: n, retried: n > 1, total_ms: Math.round(performance.now() - t), outcome });
  }
  // failure isolation inside processPapers: paper #3 fails with 400, others succeed
  let i = 0;
  const emu2 = installEmulator({ ...base, latency: 0, groq: { handler: () => (++i === 3 ? err(400) : ok()) } });
  ai.lastRequestTime = 0;
  const r = await quiet(() => processPapers(papers(5), 'S'));
  emu2.uninstall();
  console.log(rows, r.succeeded.length, r.failed.length);
  save('e5_errors', { meta, perStatus: rows, isolation: { papers: 5, injectedFailureAtIndex: 3, succeeded: r.succeeded.length, failed: r.failed.length, failedTitles: r.failed.map(f => f.title) } });
}

if (mode === 'prompt') {
  const captured = [];
  const emu = installEmulator({ ...base, latency: 0, groq: { handler: (url, init) => { captured.push(JSON.parse(init.body)); return ok(); } } });
  const cases = { nullAbstract: { title: 'Has no abstract', abstract: null }, undefinedAbstract: { title: 'Undefined abstract' }, longAbstract: { title: 'Long', abstract: 'word '.repeat(20000) } };
  const out = {};
  for (const [name, p] of Object.entries(cases)) {
    ai.lastRequestTime = 0;
    await quiet(() => ai.analyzePaper(p, 'Extract the methodology.'));
    const b = captured.at(-1);
    out[name] = { userMessageFirst120: b.messages[1].content.slice(0, 120), userMessageChars: b.messages[1].content.length, model: b.model, temperature: b.temperature, max_tokens: b.max_tokens, roles: b.messages.map(m => m.role) };
  }
  emu.uninstall();
  console.log(JSON.stringify(out, null, 1));
  save('e5_prompt', { meta, out });
}
process.exit(0);
