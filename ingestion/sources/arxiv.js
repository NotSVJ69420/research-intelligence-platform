/**
 * arXiv Source Fetcher
 *
 * Responsibility: HTTP request to arXiv API + XML parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 */

import { parseStringPromise } from 'xml2js';

const ARXIV_API = 'http://export.arxiv.org/api/query';
const TIMEOUT_MS = 30000;
const RATE_LIMIT_MS = 3000;

let lastRequestTime = 0;

/**
 * Fetch raw entry objects from arXiv.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch.
 * @param {'date'|'citations'} sortBy - Sort strategy (arXiv supports 'submittedDate' and 'relevance').
 * @returns {Promise<object[]>} Raw arXiv entry objects (parsed from XML).
 */
export async function searchPapers(query, limit = 20, sortBy = 'date') {
  // Respect ArXiv rate limit (1 request per 3s)
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < RATE_LIMIT_MS) {
    const delay = RATE_LIMIT_MS - timeSinceLast;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // arXiv sort: relevance for keyword search gives much better precision.
    // submittedDate only used when user explicitly sorts by date AND relevance already applied.
    const arxivSort = sortBy === 'date'
      ? '&sortBy=submittedDate&sortOrder=descending'
      : '&sortBy=relevance&sortOrder=descending';

    // Use title OR abstract field search (far more precise than all: which is full-text).
    // "ti:X OR abs:X" = must appear in title or abstract — not buried in references/footnotes.
    const encoded = encodeURIComponent(query);
    const searchQuery = `ti:${encoded}+OR+abs:${encoded}`;

    // Fetch 3x limit so our ranker can pick the most relevant subset.
    const fetchLimit = limit * 3;
    const url = `${ARXIV_API}?search_query=${searchQuery}&max_results=${fetchLimit}${arxivSort}`;

    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'ResearchIntelligenceEngine/1.0 (mailto:research-engine@example.com)'
      }
    });

    if (!response.ok) {
      console.warn(`[source=arxiv] HTTP ${response.status}: ${response.statusText}`);
      return [];
    }

    const xml = await response.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false });

    const feed = parsed?.feed;
    if (!feed || !feed.entry) return [];

    // xml2js may return a single object instead of array for one entry
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    return entries;
  } catch (error) {
    console.warn(`[source=arxiv] failed:`, error.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

