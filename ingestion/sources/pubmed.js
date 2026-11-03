/**
 * PubMed / NCBI Source Fetcher
 *
 * Responsibility: E-utilities (esearch + efetch) request & XML parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 */

import { parseStringPromise } from 'xml2js';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TIMEOUT_MS = 25000;
const RATE_LIMIT_MS = 350; // Respect NCBI 3 req/sec unauthenticated ceiling

let lastRequestTime = 0;

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < RATE_LIMIT_MS) {
    const delay = RATE_LIMIT_MS - timeSinceLast;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch raw PubMed articles.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch per provider.
 * @param {'date'|'citations'} _sortBy - Sort strategy.
 * @returns {Promise<object[]>} Raw PubMed article XML parsed objects.
 */
export async function searchPapers(query, limit = 20, _sortBy = 'date') {
  await throttle();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const apiKey = process.env.PUBMED_API_KEY || '';
    const authParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '';
    const encoded = encodeURIComponent(query);

    // 1. ESearch: get list of PMIDs
    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encoded}&retmax=${limit}&retmode=json${authParam}`;
    const searchRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ResearchIntelligenceEngine/1.0 (mailto:researcher@example.org)',
      },
    });

    if (searchRes.status === 429) {
      throw new Error('PubMed/NCBI rate limit exceeded (HTTP 429).');
    }

    if (!searchRes.ok) {
      throw new Error(`PubMed ESearch HTTP ${searchRes.status}: ${searchRes.statusText}`);
    }

    const searchData = await searchRes.json();
    const idList = searchData?.esearchresult?.idlist;
    if (!Array.isArray(idList) || idList.length === 0) {
      return [];
    }

    // 2. EFetch: fetch full XML for PMIDs
    await throttle();
    const fetchUrl = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${idList.join(',')}&retmode=xml${authParam}`;
    const fetchRes = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ResearchIntelligenceEngine/1.0 (mailto:researcher@example.org)',
      },
    });

    if (fetchRes.status === 429) {
      throw new Error('PubMed/NCBI rate limit exceeded (HTTP 429).');
    }

    if (!fetchRes.ok) {
      throw new Error(`PubMed EFetch HTTP ${fetchRes.status}: ${fetchRes.statusText}`);
    }

    const xmlText = await fetchRes.text();
    const parsed = await parseStringPromise(xmlText, { explicitArray: false });

    const articleSet = parsed?.PubmedArticleSet?.PubmedArticle;
    if (!articleSet) return [];

    return Array.isArray(articleSet) ? articleSet : [articleSet];
  } catch (error) {
    console.warn(`[source=pubmed] failed:`, error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
