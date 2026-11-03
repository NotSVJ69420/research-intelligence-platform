// E1: CPU cost of the repository's normalizers and of XML parsing (xml2js) on synthetic provider payloads.
// Network is not involved; this bounds the "local compute" share of a search.
import fs from 'fs';
import { parseStringPromise } from 'xml2js';
import { makeCorpus } from './lib/corpus.mjs';
import * as R from './lib/render.mjs';
import { REGISTRY } from './lib/pipeline.mjs';
import { median, summarize } from './lib/rng.mjs';

const corpus = makeCorpus(2000, 21);
const N = corpus.length;
const raws = {
  openalex: corpus.map(w => R.renderOpenAlex(w)),
  semantic_scholar: corpus.map(w => R.renderS2(w)),
  crossref: corpus.map(w => R.renderCrossref(w)),
  europe_pmc: corpus.map(w => R.renderEuropePmc(w)),
};
raws.arxiv = await Promise.all(corpus.map(async w => (await parseStringPromise(R.wrapArxivFeed([R.renderArxivEntry({ ...w, arxivId: w.arxivId || `2001.${String(w.wid).padStart(5, '0')}` })]), { explicitArray: false })).feed.entry));
raws.pubmed = await Promise.all(corpus.map(async w => (await parseStringPromise(R.wrapPubmedSet([R.renderPubmedXml(w)]), { explicitArray: false })).PubmedArticleSet.PubmedArticle));

const res = { meta: { node: process.version, records: N, passes: 9, warmupPasses: 2 }, normalize_us_per_record: {}, xml_parse_ms: [] };
for (const [src, items] of Object.entries(raws)) {
  const norm = REGISTRY[src].normalize;
  const per = [];
  for (let pass = 0; pass < 11; pass++) {
    const t = performance.now();
    for (const it of items) norm(it);
    const dt = (performance.now() - t) / items.length * 1000;
    if (pass >= 2) per.push(dt);
  }
  res.normalize_us_per_record[src] = summarize(per);
}

for (const n of [10, 30, 100]) {
  const ws = corpus.slice(0, n).map(w => ({ ...w, arxivId: w.arxivId || `2001.${String(w.wid).padStart(5, '0')}` }));
  const feeds = {
    arxiv: R.wrapArxivFeed(ws.map(w => R.renderArxivEntry(w))),
    pubmed: R.wrapPubmedSet(ws.map(w => R.renderPubmedXml(w))),
  };
  for (const [src, xml] of Object.entries(feeds)) {
    const ts = [];
    for (let i = 0; i < 25; i++) {
      const t = performance.now();
      await parseStringPromise(xml, { explicitArray: false });
      if (i >= 5) ts.push(performance.now() - t);
    }
    res.xml_parse_ms.push({ source: src, entries: n, bytes: xml.length, ...summarize(ts) });
  }
}
fs.writeFileSync(new URL('../results/e1_normalizers.json', import.meta.url), JSON.stringify(res, null, 2));
for (const [k, v] of Object.entries(res.normalize_us_per_record)) console.log(k.padEnd(18), v.median.toFixed(2), 'us/record (median)  sd', v.sd.toFixed(2));
for (const r of res.xml_parse_ms) console.log(r.source, r.entries, 'entries', r.bytes, 'B', r.median.toFixed(2), 'ms (median)');
