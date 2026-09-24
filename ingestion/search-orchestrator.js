/**
 * Search Orchestrator
 *
 * Coordinates the full ingestion pipeline:
 *   1. Dispatch to sources in parallel (Promise.allSettled)
 *   2. Normalize results via matching normalizers
 *   3. Merge into flat array
 *   4. Deduplicate
 *   5. Assign UUIDs (AFTER dedup)
 *   6. Rank
 *   7. Trim to limit
 *   8. Return Paper[]
 *
 * Never throws. Returns [] on total failure.
 */

import crypto from 'crypto';

import { searchPapers as fetchOpenAlex } from './sources/openalex.js';
import { searchPapers as fetchArxiv } from './sources/arxiv.js';
import { normalize as normalizeOpenAlex } from './normalizers/openalex.js';
import { normalize as normalizeArxiv } from './normalizers/arxiv.js';
import { deduplicate } from './dedupe.js';
import { rankPapers } from './ranking.js';

/**
 * Registry mapping source names to their fetcher + normalizer.
 * To add a new source, add an entry here with the corresponding modules.
 */
const SOURCE_REGISTRY = {
  openalex: { fetch: fetchOpenAlex, normalize: normalizeOpenAlex },
  arxiv:    { fetch: fetchArxiv,    normalize: normalizeArxiv },
};

/**
 * Return the list of registered source names.
 * Used by the UI so it never needs to hardcode source names.
 * @returns {string[]}
 */
export function getSourceNames() {
  return Object.keys(SOURCE_REGISTRY);
}

/**
 * Search for research papers across multiple sources.
 *
 * @param {string} query - Search query string.
 * @param {string[]} sources - Array of source names (e.g., ["openalex", "arxiv"]).
 * @param {number} limit - Maximum number of results to return.
 * @param {'date'|'citations'} sortBy - Sort strategy (default: 'date').
 * @returns {Promise<object[]>} Clean, deduplicated, ranked Paper objects with UUIDs.
 */
export async function searchPapers(query, sources = ['openalex', 'arxiv'], limit = 20, sortBy = 'date') {
  // Step 1: Identify valid sources
  const validSources = sources.filter(name => {
    if (SOURCE_REGISTRY[name]) return true;
    console.warn(`[orchestrator] unknown source: "${name}" — skipping`);
    return false;
  });

  if (validSources.length === 0) {
    console.warn('[orchestrator] no valid sources provided — returning empty');
    return [];
  }

  // Step 2: Dispatch all sources in parallel
  const fetchPromises = validSources.map(name => ({
    name,
    promise: SOURCE_REGISTRY[name].fetch(query, limit, sortBy),
  }));

  const results = await Promise.allSettled(
    fetchPromises.map(fp => fp.promise)
  );

  // Step 3: Collect successful results + normalize
  let allPapers = [];

  for (let i = 0; i < results.length; i++) {
    const sourceName = fetchPromises[i].name;
    const result = results[i];

    if (result.status === 'rejected') {
      console.warn(`[source=${sourceName}] failed:`, result.reason?.message || result.reason);
      continue;
    }

    const rawItems = result.value;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      continue;
    }

    const normalizeFn = SOURCE_REGISTRY[sourceName].normalize;
    const normalized = rawItems.map(raw => normalizeFn(raw));
    allPapers = allPapers.concat(normalized);
  }

  if (allPapers.length === 0) return [];

  // Step 4: Deduplicate (in-memory)
  const deduped = deduplicate(allPapers);

  // Step 5: Assign UUIDs AFTER dedup
  for (const paper of deduped) {
    paper.id = crypto.randomUUID();
  }

  // Step 6: Rank
  const ranked = rankPapers(deduped, sortBy);

  // Step 7: Trim to limit
  return ranked.slice(0, limit);
}
