// Test-environment shim (NOT application code). The cloud sandbox's egress proxy carries HTTPS only, and
// ingestion/sources/arxiv.js calls the plain-HTTP URL http://export.arxiv.org. This preload upgrades http:// to
// https:// for outgoing fetch() calls so that the repository's unmodified test scripts can reach arXiv.
// Usage: NODE_USE_ENV_PROXY=1 node --import ./paper_exp/experiments/https_shim.mjs test/test-all-providers.js
const orig = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('http://')) input = 'https://' + input.slice(7);
  else if (input instanceof URL && input.protocol === 'http:') { input = new URL(input.href); input.protocol = 'https:'; }
  return orig(input, init);
};
