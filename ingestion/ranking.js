/**
 * Rank papers by strategy ('date' or 'citations').
 * @param {object[]} papers
 * @param {'date'|'citations'} sortBy
 * @returns {object[]}
 */
export function rankPapers(papers, sortBy = 'date') {
  if (!Array.isArray(papers)) return [];

  const val = (n) => (typeof n === 'number' ? n : -Infinity);
  return [...papers].sort((a, b) => {
    const dYear = val(b.year) - val(a.year);
    const dCit = val(b.citation_count) - val(a.citation_count);
    return sortBy === 'date' ? dYear || dCit : dCit || dYear;
  });
}
