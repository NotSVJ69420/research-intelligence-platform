// Alternative duplicate-resolution strategies, implemented ONLY inside the experiment
// harness to quantify design trade-offs of the repository's ingestion/dedupe.js.
// Nothing here is part of the application.
import { createHash } from 'crypto';
import { foldDiacritics } from './corpus.mjs';

const normDoi = (d) => (d && typeof d === 'string' ? d.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || null : null);

// ---- keys used by the repository (copied verbatim in semantics from ingestion/dedupe.js) ----
export function strictHash(p) {
  const title = (p.title || '').toLowerCase().trim();
  const fa = (p.authors?.[0] || '').toLowerCase().trim();
  return createHash('sha256').update(`${title}|${fa}|${p.year ?? ''}`).digest('hex');
}

// ---- relaxed key (prototype) ----
export function foldTitle(t) {
  return foldDiacritics(String(t || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Parse first-author string into {surname, initial}; handles "Given Family", "G. Family", "Family G", "Family GJ". */
export function parseAuthor(s) {
  const a = foldDiacritics(String(s || '')).replace(/[.,]/g, ' ').trim();
  if (!a) return { surname: '', initial: '' };
  const toks = a.split(/\s+/);
  if (toks.length === 1) return { surname: toks[0].toLowerCase(), initial: '' };
  const last = toks[toks.length - 1];
  const first = toks[0];
  // "Family GJ" / "Family G": last token is 1-3 capital letters and first token is longer
  if (/^[A-Z]{1,3}$/.test(last) && first.length > 1 && !/^[A-Z]{1,3}$/.test(first)) {
    return { surname: first.toLowerCase(), initial: last[0].toLowerCase() };
  }
  return { surname: last.toLowerCase(), initial: first[0].toLowerCase() };
}
export function relaxedKey(p) {
  const { surname, initial } = parseAuthor(p.authors?.[0]);
  return `${foldTitle(p.title)}|${surname}|${initial}`;
}

// ---- union-find over arbitrary keys ----
class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[Math.max(a, b)] = Math.min(a, b); }
}

/**
 * Transitive-closure deduplication. keyFns: array of (paper)=>string|null. Papers sharing
 * any key are merged; `yearTol` (if set) additionally requires |year diff|<=yearTol for keys
 * flagged `yearGated`. Returns clusters (arrays of input indices); the representative is the
 * lowest index (== "first wins", as in the repository).
 */
export function clusterUF(papers, keyFns) {
  const uf = new UF(papers.length);
  for (const kf of keyFns) {
    const buckets = new Map();
    papers.forEach((p, i) => {
      const k = kf.fn(p);
      if (!k) return;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    for (const idxs of buckets.values()) {
      if (idxs.length < 2) continue;
      if (!kf.yearTol && kf.yearTol !== 0) { for (let j = 1; j < idxs.length; j++) uf.union(idxs[0], idxs[j]); continue; }
      // year-gated: link items whose years are within tolerance of some already-linked member
      const sorted = idxs.slice().sort((a, b) => (papers[a].year ?? -1e9) - (papers[b].year ?? -1e9));
      for (let j = 1; j < sorted.length; j++) {
        const ya = papers[sorted[j - 1]].year, yb = papers[sorted[j]].year;
        if (ya == null || yb == null || Math.abs(ya - yb) <= kf.yearTol) uf.union(sorted[j - 1], sorted[j]);
      }
    }
  }
  const groups = new Map();
  papers.forEach((_, i) => { const r = uf.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}

export const KEYS = {
  doi: { name: 'doi', fn: (p) => normDoi(p.doi) },
  src: { name: 'src', fn: (p) => (p.source_id ? `${p.source}:${p.source_id}` : null) },
  strict: { name: 'strict', fn: (p) => strictHash(p) },
  relaxed: { name: 'relaxed', fn: (p) => relaxedKey(p), yearTol: 1 },
};

export const variants = {
  // V1: same three keys as the repository, but transitive closure (order independent)
  uf_repo_keys: (papers) => clusterUF(papers, [KEYS.doi, KEYS.src, KEYS.strict]),
  // V2: doi + src + relaxed (folded title + first-author surname/initial, |dYear|<=1)
  uf_relaxed: (papers) => clusterUF(papers, [KEYS.doi, KEYS.src, KEYS.relaxed]),
};
