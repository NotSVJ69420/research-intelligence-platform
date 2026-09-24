/**
 * Analysis feature: Process fetched papers with Gemini AI.
 */
(function () {
  const hasAI = typeof window.electronAPI !== 'undefined' && window.electronAPI.ai;
  if (!hasAI) return;

  const aiAPI = window.electronAPI.ai;

  // ── State ─────────────────────────────────────────────────────────────
  let _papers = [];
  let _isAnalyzing = false;

  // ── Element refs ──────────────────────────────────────────────────────
  const els = {
    paperCount: document.getElementById('analysisPaperCount'),
    promptInput: document.getElementById('analysisPrompt'),
    startBtn: document.getElementById('analysisStartBtn'),
    statusDot: document.getElementById('analysisStatusDot'),
    statusText: document.getElementById('analysisStatusText'),
    log: document.getElementById('analysisLog'),
  };

  function setStatus(state, text) {
    if (els.statusDot) {
      els.statusDot.className = 'fetcher-status-dot';
      if (state) els.statusDot.classList.add('is-' + state);
    }
    if (els.statusText) els.statusText.textContent = text;
  }

  function log(msg, type = 'info') {
    if (!els.log) return;
    const entry = document.createElement('div');
    entry.className = `analysis-log-entry is-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    els.log.appendChild(entry);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function updatePaperCount() {
    if (els.paperCount) {
      els.paperCount.textContent = `${_papers.length} Papers Available`;
    }
  }

  async function onRunAnalysis() {
    if (_isAnalyzing) return;
    if (_papers.length === 0) {
      log('No papers to analyze. Fetch some papers first.', 'error');
      return;
    }

    const prompt = els.promptInput.value.trim();
    _isAnalyzing = true;
    els.startBtn.disabled = true;
    setStatus('fetching', 'Processing with Groq...');
    log(`Starting analysis for ${_papers.length} papers...`);

    try {
      // Process papers one by one to show progress
      let count = 0;
      for (const paper of _papers) {
        log(`Analyzing paper: ${paper.title}...`);
        try {
          const analysis = await aiAPI.analyzePaper(paper, prompt);
          log(`Analysis complete for: ${paper.title}. Saving...`, 'success');
          
          const filePath = await aiAPI.saveAnalysis(paper.title, analysis);
          log(`Saved to: ${filePath}`, 'success');
          count++;
        } catch (err) {
          log(`Failed to analyze "${paper.title}": ${err.message}`, 'error');
        }
      }

      setStatus('done', `Finished. Processed ${count}/${_papers.length} papers.`);
      log(`Pipeline complete. Results stored in research/analysis/`, 'success');
    } catch (err) {
      log(`Critical error: ${err.message}`, 'error');
      setStatus('error', 'Pipeline failed.');
    } finally {
      _isAnalyzing = false;
      els.startBtn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────

  function init() {
    if (els.startBtn) {
      els.startBtn.addEventListener('click', onRunAnalysis);
    }

    document.addEventListener('app:fetcherResultsUpdated', (e) => {
      _papers = e.detail?.papers || [];
      updatePaperCount();
      log(`Received ${_papers.length} papers from Fetcher.`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
