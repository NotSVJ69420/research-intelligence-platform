/**
 * OpenAlex Source Fetcher
 *
 * Responsibility: HTTP request to OpenAlex API + response parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 *
 * Authentication: uses OPENALEX_API_KEY from .env (free tier, 100k credits/day).
 * Falls back to unauthenticated (limited to 100 credits/day for testing).
 */

const OPENALEX_API = 'https://api.openalex.org/works';
const TIMEOUT_MS = 15000;

/**
 * Fetch raw work objects from OpenAlex.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch.
 * @param {'date'|'citations'} sortBy - Sort strategy.
 * @returns {Promise<object[]>} Raw OpenAlex work objects.
 */
export async function searchPapers(query, limit = 20, sortBy = 'date') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // OpenAlex: use `search=` param (BM25 relevance scoring) instead of filter=default.search.
    // Always request relevance sort from server; our local ranker re-sorts by date/citations after.
    const sortParam = '&sort=relevance_score:desc';

    // API key from environment (mandatory since Feb 2025)
    const apiKey = process.env.OPENALEX_API_KEY || '';
    const authParam = apiKey ? `&api_key=${apiKey}` : '';

    // Fetch 3x limit so our ranker can pick the most relevant subset.
    const fetchLimit = limit * 3;
    const searchParam = `?search=${encodeURIComponent(query)}`;

    const url = `${OPENALEX_API}${searchParam}&per_page=${fetchLimit}${sortParam}${authParam}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ResearchEngine/1.0 (mailto:research-engine@example.com)',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAlex HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch (error) {
    console.warn(`[source=openalex] failed:`, error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


