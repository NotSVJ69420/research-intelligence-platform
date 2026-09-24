/**
 * Fetcher feature: Paper search, retrieval & PDF download UI (Electron only).
 *
 * Pure UI integration — delegates ALL work to the existing paper service
 * via window.electronAPI.papers. Never touches ingestion or DB directly.
 *
 * Pattern: IIFE, mirrors library.js.
 */
(function () {
  // ── Guard: Electron-only ──────────────────────────────────────────────
  const hasElectron = typeof window.electronAPI !== 'undefined' && window.electronAPI.papers;

  const fallback = document.getElementById('fetcherFallback');
  const body     = document.getElementById('fetcherBody');

  if (!hasElectron) {
    if (fallback) fallback.classList.remove('hidden');
    if (body)     body.classList.add('hidden');
    return;
  }

  const papersAPI  = window.electronAPI.papers;
  const libraryAPI = window.electronAPI.library;

  // ── State ─────────────────────────────────────────────────────────────
  let _isFetching = false;
  let _cancelled  = false;
  let _results    = [];
  let _downloadDir = null;

  // ── Element refs ──────────────────────────────────────────────────────
  const els = {
    form: null,
    keyword: null,
    sourceList: null,
    limit: null,
    sortBy: null,
    dirBtn: null,
    dirLabel: null,
    formError: null,
    submitBtn: null,
    stopBtn: null,
    statusDot: null,
    statusText: null,
    detailToggle: null,
    resultList: null,
    emptyMsg: null,
  };

  function $(id) { return document.getElementById(id); }

  function bindElements() {
    els.form         = $('fetcherSearchForm');
    els.keyword      = $('fetcherKeyword');
    els.sourceList   = $('fetcherSourceList');
    els.limit        = $('fetcherLimit');
    els.sortBy       = $('fetcherSortBy');
    els.dirBtn       = $('fetcherDirBtn');
    els.dirLabel     = $('fetcherDirLabel');
    els.formError    = $('fetcherFormError');
    els.submitBtn    = $('fetcherSubmitBtn');
    els.stopBtn      = $('fetcherStopBtn');
    els.statusDot    = $('fetcherStatusDot');
    els.statusText   = $('fetcherStatusText');
    els.detailToggle = $('fetcherDetailToggle');
    els.resultList   = $('fetcherResultList');
    els.emptyMsg     = $('fetcherEmpty');
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function showError(msg) {
    if (!els.formError) return;
    els.formError.textContent = msg || '';
    els.formError.classList.toggle('hidden', !msg);
  }

  function setStatus(state, text) {
    if (els.statusDot) {
      els.statusDot.className = 'fetcher-status-dot';
      if (state) els.statusDot.classList.add('is-' + state);
    }
    if (els.statusText) els.statusText.textContent = text;
  }

  function setFetchingUI(isFetching) {
    _isFetching = isFetching;
    if (els.submitBtn) els.submitBtn.disabled = isFetching;
    if (els.stopBtn)   els.stopBtn.disabled   = !isFetching;
    if (els.keyword)   els.keyword.disabled   = isFetching;
    if (els.limit)     els.limit.disabled     = isFetching;
    if (els.sortBy)    els.sortBy.disabled    = isFetching;

    if (els.sourceList) {
      els.sourceList.querySelectorAll('input[type="checkbox"]')
        .forEach(cb => cb.disabled = isFetching);
    }
  }

  // ── Source checkboxes ─────────────────────────────────────────────────

  async function loadSources() {
    if (!els.sourceList) return;
    try {
      const sources = await papersAPI.getSources();
      els.sourceList.innerHTML = '';

      if (!Array.isArray(sources) || sources.length === 0) {
        els.sourceList.innerHTML = '<span class="font-serif text-sm text-sepia italic">No sources available.</span>';
        return;
      }

      for (const name of sources) {
        const label = document.createElement('label');
        label.className = 'fetcher-source-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'source';
        cb.value = name;
        cb.checked = true;

        const span = document.createElement('span');
        span.textContent = name;

        label.appendChild(cb);
        label.appendChild(span);
        els.sourceList.appendChild(label);
      }
    } catch (err) {
      console.warn('[fetcher] could not load sources:', err.message);
      els.sourceList.innerHTML = '<span class="font-serif text-sm text-sepia italic">Could not load sources.</span>';
    }
  }

  function getSelectedSources() {
    if (!els.sourceList) return [];
    const checked = els.sourceList.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checked).map(cb => cb.value);
  }

  // ── Directory picker ──────────────────────────────────────────────────

  async function onSelectDir() {
    try {
      const dir = await libraryAPI.selectDownloadDir();
      if (dir) {
        _downloadDir = dir;
        const short = dir.length > 40 ? '…' + dir.slice(-38) : dir;
        if (els.dirLabel) {
          els.dirLabel.textContent = short;
          els.dirLabel.title = dir;
        }
        showError('');
      }
    } catch (err) {
      console.warn('[fetcher] dir select failed:', err.message);
      showError('Could not select directory.');
    }
  }

  // ── PDF Download ──────────────────────────────────────────────────────

  async function downloadPdf(paper, statusEl) {
    if (!paper.pdf_url || !_downloadDir) return;

    if (statusEl) {
      statusEl.textContent = 'Downloading…';
      statusEl.className = 'fetcher-dl-status is-downloading';
    }

    try {
      const localPath = await papersAPI.downloadPdf(
        paper.pdf_url,
        _downloadDir,
        paper.title || 'paper'
      );
      if (statusEl) {
        statusEl.textContent = '✓ Downloaded';
        statusEl.className = 'fetcher-dl-status is-downloaded';
        statusEl.title = localPath;
      }
    } catch (err) {
      console.warn('[fetcher] PDF download failed:', err.message);
      if (statusEl) {
        statusEl.textContent = '✗ Failed (See Logs)';
        statusEl.className = 'fetcher-dl-status is-dl-error is-clickable';
        statusEl.title = 'Click to view error log';
        
        // Find or create the log container for this row
        const row = statusEl.closest('.fetcher-result-row');
        if (row) {
          let logContainer = row.querySelector('.fetcher-err-log');
          if (!logContainer) {
            logContainer = document.createElement('div');
            logContainer.className = 'fetcher-err-log hidden';
            row.appendChild(logContainer);
            
            // Toggle log on click
            statusEl.addEventListener('click', (e) => {
              e.stopPropagation();
              logContainer.classList.toggle('hidden');
            }, { once: false });
          }
          logContainer.textContent = `[Download Error] ${new Date().toLocaleTimeString()}\n${err.message}\nURL: ${paper.pdf_url}`;
        }
      }
    }
  }

  async function downloadAllPdfs() {
    if (!_downloadDir) {
      showError('Select a download directory first.');
      return;
    }

    const papersWithPdf = _results.filter(p => p.pdf_url);
    if (papersWithPdf.length === 0) {
      showError('No papers have downloadable PDFs.');
      return;
    }

    showError('');
    setStatus('fetching', `Downloading ${papersWithPdf.length} PDF${papersWithPdf.length !== 1 ? 's' : ''}…`);

    let downloaded = 0;
    let failed = 0;

    for (const paper of papersWithPdf) {
      if (_cancelled) break;

      const row = els.resultList?.querySelector(`[data-paper-id="${paper.id}"]`);
      const statusEl = row?.querySelector('.fetcher-dl-status');

      try {
        await downloadPdf(paper, statusEl);
        downloaded++;
      } catch {
        failed++;
      }

      setStatus('fetching', `Downloaded ${downloaded}/${papersWithPdf.length}…`);
    }

    if (_cancelled) {
      setStatus('', `Stopped — ${downloaded} downloaded.`);
    } else {
      setStatus('done', `Done — ${downloaded} downloaded${failed > 0 ? `, ${failed} failed` : ''}.`);
    }
  }

  // ── Render results ────────────────────────────────────────────────────

  function formatAuthors(authors) {
    if (!authors || !Array.isArray(authors) || authors.length === 0) return '—';
    return authors.map(a => (typeof a === 'string' ? a : a?.name || '?')).join(', ');
  }

  function renderResults(papers) {
    if (!els.resultList || !els.emptyMsg) return;
    els.resultList.innerHTML = '';

    if (!papers || papers.length === 0) {
      els.emptyMsg.classList.remove('hidden');
      return;
    }
    els.emptyMsg.classList.add('hidden');

    papers.forEach((paper) => {
      const row = document.createElement('div');
      row.className = 'fetcher-result-row';
      row.setAttribute('data-paper-id', paper.id || '');

      const authStr = formatAuthors(paper.authors);
      const yearStr = paper.year ? `<span class="fetcher-result-year">(${escapeHtml(String(paper.year))})</span>` : '';
      const sourceStr = paper.source ? `<span class="fetcher-source-badge">${escapeHtml(paper.source)}</span>` : '';

      // Download status indicator
      const hasPdf = !!paper.pdf_url;
      const dlStatusHtml = hasPdf
        ? '<span class="fetcher-dl-status">PDF available</span>'
        : '<span class="fetcher-dl-status is-no-pdf">No PDF</span>';

      // Detail section
      const detailParts = [];
      if (paper.abstract) {
        detailParts.push(`<dt>Abstract</dt><dd>${escapeHtml(paper.abstract)}</dd>`);
      }
      if (paper.doi) {
        detailParts.push(`<dt>DOI</dt><dd>${escapeHtml(paper.doi)}</dd>`);
      }
      if (paper.url) {
        detailParts.push(`<dt>URL</dt><dd><a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">${escapeHtml(paper.url)}</a></dd>`);
      }
      if (paper.pdf_url) {
        detailParts.push(`<dt>PDF</dt><dd><a href="${escapeHtml(paper.pdf_url)}" target="_blank" rel="noopener">${escapeHtml(paper.pdf_url)}</a></dd>`);
      }
      if (paper.citation_count != null) {
        detailParts.push(`<dt>Citations</dt><dd>${paper.citation_count}</dd>`);
      }
      if (paper.venue) {
        detailParts.push(`<dt>Venue</dt><dd>${escapeHtml(paper.venue)}</dd>`);
      }

      row.innerHTML = `
        <div class="fetcher-result-header">
          <div class="fetcher-result-title">${escapeHtml(paper.title || 'Untitled')}</div>
          ${dlStatusHtml}
        </div>
        <div class="fetcher-result-meta">
          ${sourceStr}
          <span>${escapeHtml(authStr)}</span>
          ${yearStr}
        </div>
        ${detailParts.length > 0 ? `
        <div class="fetcher-result-detail">
          <dl class="fetcher-result-detail-grid">
            ${detailParts.join('')}
          </dl>
        </div>` : ''}
      `;

      // Single-paper download on click (if PDF available and directory set)
      if (hasPdf) {
        const dlStatus = row.querySelector('.fetcher-dl-status');
        dlStatus.style.cursor = 'pointer';
        // Use a wrapper so we can toggle event listeners based on state
        const triggerDownload = (e) => {
          e.stopPropagation();
          // Don't restart if already downloading or successfully downloaded
          if (dlStatus.classList.contains('is-downloading') || dlStatus.classList.contains('is-downloaded')) return;
          
          if (!_downloadDir) {
            showError('Select a download directory first.');
            return;
          }
          downloadPdf(paper, dlStatus);
        };
        dlStatus.addEventListener('click', triggerDownload);
      }

      els.resultList.appendChild(row);
    });
  }

  // ── Search handler ────────────────────────────────────────────────────

  async function onSearch(e) {
    e.preventDefault();
    showError('');

    const keyword = els.keyword?.value?.trim();
    if (!keyword) {
      showError('Please enter a keyword.');
      return;
    }

    const sources = getSelectedSources();
    if (sources.length === 0) {
      showError('Select at least one source.');
      return;
    }

    const limit = parseInt(els.limit?.value, 10) || 20;
    const sortBy = els.sortBy?.value || 'date';

    // Start
    _cancelled = false;
    setFetchingUI(true);
    setStatus('fetching', `Fetching "${keyword}" from ${sources.join(', ')}…`);
    _results = [];
    renderResults([]);

    try {
      const res = await papersAPI.search(keyword, sources, limit, sortBy);
      const papers = Array.isArray(res) ? res : (res?.succeeded || []);
      const failed = Array.isArray(res) ? [] : (res?.failed || []);

      if (_cancelled) {
        setStatus('', 'Stopped by user.');
        setFetchingUI(false);
        return;
      }

      _results = papers;
      renderResults(papers);
      
      // Broadcast results for other components (like Analysis)
      document.dispatchEvent(new CustomEvent('app:fetcherResultsUpdated', {
        detail: { papers: _results }
      }));

      const pdfCount = papers.filter(p => p.pdf_url).length;
      const failMsg = failed.length > 0 ? `, ${failed.length} failed to store in DB` : '';
      setStatus('done', `Done — ${papers.length} paper${papers.length !== 1 ? 's' : ''} retrieved${failMsg} (${pdfCount} with PDF).`);

      // Auto-download if directory is set
      if (_downloadDir && pdfCount > 0) {
        await downloadAllPdfs();
      }
    } catch (err) {
      if (_cancelled) {
        setStatus('', 'Stopped by user.');
      } else {
        console.error('[fetcher] search error:', err);
        setStatus('error', 'Error: ' + (err.message || 'Search failed.'));
        showError(err.message || 'Search failed.');
      }
    } finally {
      setFetchingUI(false);
    }
  }

  // ── Stop handler ──────────────────────────────────────────────────────

  function onStop() {
    if (!_isFetching) return;
    _cancelled = true;
    setStatus('', 'Stopping…');
  }

  // ── Detail toggle ─────────────────────────────────────────────────────

  function onDetailToggle() {
    if (!els.detailToggle || !els.resultList) return;
    const isActive = els.detailToggle.classList.toggle('is-active');
    els.resultList.classList.toggle('is-detail-active', isActive);
  }

  // ── Init ──────────────────────────────────────────────────────────────

  function init() {
    bindElements();
    if (!els.resultList) return;

    loadSources();

    if (els.form)         els.form.addEventListener('submit', onSearch);
    if (els.stopBtn)      els.stopBtn.addEventListener('click', onStop);
    if (els.dirBtn)       els.dirBtn.addEventListener('click', onSelectDir);
    if (els.detailToggle) els.detailToggle.addEventListener('click', onDetailToggle);
  }

  document.addEventListener('app:viewChanged', (e) => {
    if (e.detail?.view === 'fetcher') {
      loadSources();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
