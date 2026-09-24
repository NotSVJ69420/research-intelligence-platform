import aiService from '../services/ai-service.js';

/**
 * Process multiple papers for analysis or summarization.
 * @param {Array<Object>} papers - List of papers to process.
 * @param {string} prompt - Specific instruction for analysis.
 */
export async function processPapers(papers, prompt) {
  console.log(`Starting AI pipeline for ${papers.length} papers...`);
  const succeeded = [];
  const failed = [];
  for (const paper of papers) {
    try {
      console.log(`Analyzing paper: ${paper.title}...`);
      const analysis = await aiService.analyzePaper(paper, prompt);
      succeeded.push({ id: paper.id, title: paper.title, analysis });
    } catch (error) {
      console.error(`Failed to analyze paper "${paper.title}":`, error.message);
      failed.push({ id: paper.id, title: paper.title, error: error.message });
    }
  }
  return { succeeded, failed };
}

export default { processPapers };
