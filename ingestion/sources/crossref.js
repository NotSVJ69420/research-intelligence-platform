/**
 * Crossref Source Fetcher
 *
 * Responsibility: HTTP request to Crossref REST API + JSON parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 */

const CROSSREF_API = 'https://api.crossref.org/works';
const TIMEOUT_MS = 15000;

/**
 * Fetch raw work objects from Crossref.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch per provider.
 * @param {'date'|'citations'} _sortBy - Sort strategy.
 * @returns {Promise<object[]>} Raw Crossref work items.
 */
export async function searchPapers(query, limit = 20, _sortBy = 'date') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const email = process.env.CROSSREF_EMAIL || 'researcher@example.org';
    const encoded = encodeURIComponent(query);
    // Filter to scholarly document types: exclude components like raw figures/sub-images
    const filter = 'filter=type:journal-article,type:proceedings-article,type:posted-content,type:book-chapter,type:monograph';
    const url = `${CROSSREF_API}?query=${encoded}&${filter}&rows=${limit}&mailto=${encodeURIComponent(email)}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': `ResearchIntelligenceEngine/1.0 (mailto:${email})`,
      },
    });

    if (response.status === 429) {
      throw new Error('Crossref API rate limit exceeded (HTTP 429).');
    }

    if (!response.ok) {
      throw new Error(`Crossref HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data.message?.items) ? data.message.items : [];
  } catch (error) {
    console.warn(`[source=crossref] failed:`, error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
