// Deterministic fetch() emulator for the six scholarly APIs and the Groq endpoint.
//
// Installed by replacing globalThis.fetch BEFORE the repository modules issue requests.
// No application source file is modified. All latencies are *injected parameters*, not
// measurements of the real services (the sandbox's egress policy blocks them).
import { makeRng, hashSeed } from './rng.mjs';
import { renderOpenAlex, renderS2, renderCrossref, renderEuropePmc, renderPubmedXml, renderArxivEntry, wrapArxivFeed, wrapPubmedSet } from './render.mjs';

const HOSTS = {
  arxiv: 'export.arxiv.org',
  openalex: 'api.openalex.org',
  semantic_scholar: 'api.semanticscholar.org',
  crossref: 'api.crossref.org',
  europe_pmc: 'www.ebi.ac.uk',
  pubmed: 'eutils.ncbi.nlm.nih.gov',
  groq: 'api.groq.com',
};
const hostToSource = Object.fromEntries(Object.entries(HOSTS).map(([k, v]) => [v, k]));

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })); }, { once: true });
});

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, statusText: status === 200 ? 'OK' : 'ERR', headers: { 'content-type': 'application/json' } });
const xml = (s) => new Response(s, { status: 200, headers: { 'content-type': 'application/xml' } });

/**
 * @param {object} cfg
 *  - corpus: ground-truth works
 *  - coverage: {source: probability a work is a member of that source}
 *  - latency: number | {source: ms}   injected per-request latency
 *  - faults: {source: 'http500'|'http429'|'hang'|'neterror'|{mode, times}}
 *  - groq: {latency, handler}  (see e5)
 *  - styles: per-source style overrides passed to renderers
 */
export function installEmulator(cfg) {
  const realFetch = globalThis.fetch;
  const log = [];            // request log: {t, source, url, kind}
  const members = {};        // source -> array of works (membership fixed by seed)
  const rng0 = makeRng(hashSeed('membership') ^ (cfg.seed ?? 7));
  for (const s of Object.keys(HOSTS)) {
    if (s === 'groq') continue;
    const p = cfg.coverage?.[s] ?? 0.6;
    members[s] = cfg.corpus.filter(w => {
      if (s === 'arxiv' && !w.arxivId) return false;
      return rng0.chance(p);
    });
  }
  const faultCounters = {};
  const t0 = performance.now();

  const latencyOf = (s) => (typeof cfg.latency === 'number' ? cfg.latency : (cfg.latency?.[s] ?? 0));

  function ranked(source, query, n) {
    const r = makeRng(hashSeed(source + '|' + query) ^ (cfg.seed ?? 7));
    return r.shuffle(members[source]).slice(0, n);
  }

  async function fakeFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const source = hostToSource[url.hostname];
    const signal = init.signal;
    if (!source) {
      log.push({ t: performance.now() - t0, source: 'unknown', url: url.href, kind: 'neterror' });
      throw new TypeError('fetch failed');
    }
    const kind = classify(source, url);
    const entry = { t: performance.now() - t0, source, url: url.href, kind };
    log.push(entry);

    // --- fault injection ---
    const f = cfg.faults?.[source];
    if (f) {
      const mode = typeof f === 'string' ? f : f.mode;
      const times = typeof f === 'string' ? Infinity : (f.times ?? Infinity);
      faultCounters[source] = (faultCounters[source] || 0) + 1;
      if (faultCounters[source] <= times) {
        if (mode === 'hang') { await sleep(1e9, signal); }
        if (mode === 'neterror') { await sleep(latencyOf(source), signal); throw new TypeError('fetch failed'); }
        if (mode === 'http500') { await sleep(latencyOf(source), signal); return json({}, 500); }
        if (mode === 'http429') { await sleep(latencyOf(source), signal); return json({}, 429); }
      }
    }

    await sleep(latencyOf(source), signal);
    entry.tResp = performance.now() - t0;

    if (source === 'groq') return cfg.groq.handler(url, init, entry);

    const st = cfg.styles?.[source] || {};
    const lim = (name, dflt) => parseInt(url.searchParams.get(name) || dflt, 10);
    const q = url.searchParams.get('query') || url.searchParams.get('search') || url.searchParams.get('term') || url.searchParams.get('search_query') || '';
    switch (source) {
      case 'openalex':
        return json({ results: ranked('openalex', q, lim('per_page', 25)).map(w => renderOpenAlex(w, st)) });
      case 'semantic_scholar':
        return json({ data: ranked('semantic_scholar', q, lim('limit', 100)).map(w => renderS2(w, st)) });
      case 'crossref':
        if (kind === 'enrich') return json({ message: { link: [{ 'content-type': 'application/pdf', URL: 'https://example.org/x.pdf' }] } });
        return json({ message: { items: ranked('crossref', q, lim('rows', 20)).map(w => renderCrossref(w, st)) } });
      case 'europe_pmc':
        return json({ resultList: { result: ranked('europe_pmc', q, lim('pageSize', 25)).map(w => renderEuropePmc(w, st)) } });
      case 'arxiv': {
        const n = lim('max_results', 10);
        return xml(wrapArxivFeed(ranked('arxiv', q, n).map(w => renderArxivEntry(w, st))));
      }
      case 'pubmed':
        if (kind === 'esearch') {
          const ws = ranked('pubmed', q, lim('retmax', 20));
          return json({ esearchresult: { idlist: ws.map(w => w.pmid) } });
        } else {
          const ids = new Set((url.searchParams.get('id') || '').split(','));
          const ws = members.pubmed.filter(w => ids.has(w.pmid));
          return xml(wrapPubmedSet(ws.map(w => renderPubmedXml(w, st))));
        }
    }
    throw new Error('unreachable');
  }

  function classify(source, url) {
    if (source === 'pubmed') return url.pathname.includes('esearch') ? 'esearch' : 'efetch';
    if (source === 'crossref' && /\/works\/.+/.test(url.pathname)) return 'enrich';
    return 'search';
  }

  globalThis.fetch = fakeFetch;
  return {
    log,
    members,
    uninstall() { globalThis.fetch = realFetch; },
    countBySource() {
      const c = {};
      for (const e of log) c[e.source] = (c[e.source] || 0) + 1;
      return c;
    },
    reset() { log.length = 0; for (const k of Object.keys(faultCounters)) delete faultCounters[k]; },
    setFaults(f) { cfg.faults = f; for (const k of Object.keys(faultCounters)) delete faultCounters[k]; },
    setLatency(l) { cfg.latency = l; },
  };
}
