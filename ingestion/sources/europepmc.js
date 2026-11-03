/**
 * Europe PMC Source Fetcher
 *
 * Responsibility: HTTP request to Europe PMC REST API + JSON parsing ONLY.
 * Does NOT normalize, generate IDs, or deduplicate.
 */

const EUROPE_PMC_API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const TIMEOUT_MS = 15000;

/**
 * Fetch raw article objects from Europe PMC.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to fetch per provider.
 * @param {'date'|'citations'} _sortBy - Sort strategy.
 * @returns {Promise<object[]>} Raw Europe PMC article items.
 */
export async function searchPapers(query, limit = 20, _sortBy = 'date') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const encoded = encodeURIComponent(query);
    const url = `${EUROPE_PMC_API}?query=${encoded}&resultType=core&pageSize=${limit}&format=json`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ResearchIntelligenceEngine/1.0 (mailto:researcher@example.org)',
      },
    });

    if (response.status === 429) {
      throw new Error('Europe PMC API rate limit exceeded (HTTP 429).');
    }

    if (!response.ok) {
      throw new Error(`Europe PMC HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const items = Array.isArray(data.resultList?.result) ? data.resultList.result : [];

    // Europe PMC returns internal render URLs that are blocked by Cloudflare (HTTP 403).
    // Concurrently enrich items that have a DOI by querying Crossref for direct publisher PDF links.
    await Promise.allSettled(
      items.map(async item => {
        if (!item?.doi) return;
        const normDoi = String(item.doi).replace(/^https?:\/\/doi\.org\//i, '').trim();
        if (!normDoi) return;

        try {
          const email = process.env.CROSSREF_EMAIL || 'researcher@example.org';
          const crRes = await fetch(`https://api.crossref.org/works/${encodeURIComponent(normDoi)}?mailto=${encodeURIComponent(email)}`, {
            signal: AbortSignal.timeout(3000),
            headers: { 'Accept': 'application/json' },
          });
          if (!crRes.ok) return;
          const crData = await crRes.json();
          const links = crData.message?.link || [];
          const BOT_WALLED_HOSTS = ['sciencedirect.com', 'royalsocietypublishing.org', 'mdpi.com', 'wiley.com'];
          const directPdf = links.find(l => {
            const ct = String(l?.['content-type'] || '').toLowerCase();
            const u = String(l?.URL || '').toLowerCase();
            const isPdf = ct.includes('pdf') || u.includes('/pdf') || u.endsWith('.pdf');
            const isBlocked = BOT_WALLED_HOSTS.some(h => u.includes(h));
            return isPdf && !isBlocked;
          });

          if (directPdf?.URL) {
            if (!item.fullTextUrlList) item.fullTextUrlList = { fullTextUrl: [] };
            if (!Array.isArray(item.fullTextUrlList.fullTextUrl)) {
              item.fullTextUrlList.fullTextUrl = [item.fullTextUrlList.fullTextUrl].filter(Boolean);
            }
            item.fullTextUrlList.fullTextUrl.unshift({
              documentStyle: 'pdf',
              url: directPdf.URL,
            });
          }
        } catch {
          // Best effort enrichment — ignore errors
        }
      })
    );

    return items;
  } catch (error) {
    console.warn(`[source=europe_pmc] failed:`, error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
