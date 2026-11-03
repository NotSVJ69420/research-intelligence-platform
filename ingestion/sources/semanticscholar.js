/**
 * Semantic Scholar Source Fetcher
 *
 * Responsibility: HTTP request to Semantic Scholar Graph API + JSON parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 */

const S2_API = 'https://api.semanticscholar.org/graph/v1/paper/search';
const TIMEOUT_MS = 15000;

/**
 * Fetch raw paper objects from Semantic Scholar.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch per provider.
 * @param {'date'|'citations'} _sortBy - Sort strategy.
 * @returns {Promise<object[]>} Raw Semantic Scholar paper objects.
 */
export async function searchPapers(query, limit = 20, _sortBy = 'date', retryCount = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fields = 'paperId,title,abstract,authors,year,venue,externalIds,url,openAccessPdf,citationCount';
    const encoded = encodeURIComponent(query);
    const url = `${S2_API}?query=${encoded}&limit=${limit}&fields=${fields}`;

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'ResearchIntelligenceEngine/1.0 (mailto:researcher@example.org)',
    };

    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || '';
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (response.status === 429) {
      if (retryCount > 0) {
        clearTimeout(timer);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return searchPapers(query, limit, _sortBy, retryCount - 1);
      }
      throw new Error('Semantic Scholar rate limit exceeded (HTTP 429). Configure an API key in Settings for dedicated allowance.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Semantic Scholar authentication error (HTTP ${response.status}): invalid or inactive API key.`);
    }

    if (!response.ok) {
      throw new Error(`Semantic Scholar HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    console.warn(`[source=semantic_scholar] failed:`, error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
