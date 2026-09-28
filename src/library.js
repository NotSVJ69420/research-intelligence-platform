/**
 * Library feature: Local Research Library (Electron only).
 * Automatically scans and indexes raw_papers/ using PostgreSQL metadata,
 * while allowing manual additions as a secondary workflow.
 */
(function () {
  if (typeof window.electronAPI === 'undefined' || !window.electronAPI.library) {
    return;
  }

  const api = window.electronAPI.library;
  let selectedPdfPath = null;
  let selectedPaper = null;

  const els = {
    form: null,
    paperTitle: null,
    paperAuthors: null,
    paperYear: null,
    selectPdfBtn: null,
    pdfLabel: null,
    submitBtn: null,
    formError: null,
    refreshBtn: null,
    paperList: null,
    emptyMsg: null,
    detail: null,
    detailTitle: null,
    detailAuthors: null,
    detailYear: null,
    detailSource: null,
    detailDoi: null,
    openPdfBtn: null,
  };

  function getEl(id) {
    return document.getElementById(id);
  }

  function bindElements() {
    els.form = getEl('libraryAddForm');
    els.paperTitle = getEl('paperTitle');
    els.paperAuthors = getEl('paperAuthors');
    els.paperYear = getEl('paperYear');
    els.selectPdfBtn = getEl('librarySelectPdf');
    els.pdfLabel = getEl('libraryPdfLabel');
    els.submitBtn = getEl('librarySubmit');
    els.formError = getEl('libraryFormError');
    els.refreshBtn = getEl('libraryRefreshBtn');
    els.paperList = getEl('libraryPaperList');
    els.emptyMsg = getEl('libraryEmpty');
    els.detail = getEl('libraryDetail');
    els.detailTitle = getEl('libraryDetailTitle');
    els.detailAuthors = getEl('libraryDetailAuthors');
    els.detailYear = getEl('libraryDetailYear');
    els.detailSource = getEl('libraryDetailSource');
    els.detailDoi = getEl('libraryDetailDoi');
    els.openPdfBtn = getEl('libraryOpenPdfBtn');
  }

  function showFormError(msg) {
    if (!els.formError) return;
    els.formError.textContent = msg || '';
    els.formError.classList.toggle('hidden', !msg);
  }

  function setPdfLabel(filename) {
    if (els.pdfLabel) els.pdfLabel.textContent = filename || 'Choose PDF file';
  }

  function formatAuthors(authors) {
    if (!authors) return '—';
    if (Array.isArray(authors)) {
      if (authors.length === 0) return '—';
      return authors.map(a => (typeof a === 'string' ? a : a?.name || '?')).join(', ');
    }
    return String(authors);
  }

  function renderPapers(papers) {
    if (!els.paperList || !els.emptyMsg) return;
    els.paperList.innerHTML = '';
    if (!papers || papers.length === 0) {
      els.emptyMsg.classList.remove('hidden');
      if (els.detail) els.detail.classList.add('hidden');
      return;
    }
    els.emptyMsg.classList.add('hidden');

    papers.forEach((paper) => {
      const row = document.createElement('div');
      row.className = 'library-paper-row';
      row.setAttribute('data-id', paper.id);

      const authStr = formatAuthors(paper.authors);
      const yearStr = paper.year ? ` <span class="library-paper-year">(${escapeHtml(String(paper.year))})</span>` : '';
      const sourceBadge = paper.isExternal
        ? '<span class="fetcher-source-badge" style="opacity: 0.85;">External File</span>'
        : (paper.source ? `<span class="fetcher-source-badge">${escapeHtml(paper.source)}</span>` : '');

      row.innerHTML = `
        <div class="library-paper-title">${escapeHtml(paper.title || 'Untitled Document')}</div>
        <div class="library-paper-meta flex items-center gap-2">
          ${sourceBadge}
          <span>${escapeHtml(authStr)}</span>
          ${yearStr}
        </div>
      `;
      row.addEventListener('click', () => selectPaper(paper, row));
      els.paperList.appendChild(row);
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function selectPaper(paper, rowEl) {
    selectedPaper = paper;
    // Highlight active row
    els.paperList.querySelectorAll('.library-paper-row').forEach(r => r.classList.remove('is-active'));
    if (rowEl) rowEl.classList.add('is-active');

    if (els.detail) els.detail.classList.remove('hidden');
    if (els.detailTitle) els.detailTitle.textContent = paper.title || '—';
    if (els.detailAuthors) els.detailAuthors.textContent = formatAuthors(paper.authors);
    if (els.detailYear) els.detailYear.textContent = paper.year || '—';
    if (els.detailSource) {
      els.detailSource.textContent = paper.isExternal ? 'Unindexed (raw_papers/)' : (paper.source || 'Database');
    }
    if (els.detailDoi) els.detailDoi.textContent = paper.doi || '—';
  }

  async function loadPapers() {
    try {
      const papers = await api.getPapers();
      renderPapers(papers);
    } catch (e) {
      console.error('Library: load papers failed', e);
      showFormError('Could not load library.');
    }
  }

  async function onSelectPdf() {
    try {
      const filePath = await api.selectPdfFile();
      if (filePath) {
        selectedPdfPath = filePath;
        const name = filePath.split(/[/\\]/).pop() || filePath;
        setPdfLabel(name);
        showFormError('');
      }
    } catch (e) {
      console.error('Library: select PDF failed', e);
      showFormError('Could not select file.');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    showFormError('');
    const title = els.paperTitle?.value?.trim();
    if (!title) {
      showFormError('Title is required.');
      return;
    }
    if (!selectedPdfPath) {
      showFormError('Please choose a PDF file.');
      return;
    }
    if (els.submitBtn) els.submitBtn.disabled = true;
    try {
      await api.addPaper({
        title,
        authors: els.paperAuthors?.value?.trim() || '',
        year: els.paperYear?.value?.trim() || '',
        pdfPath: selectedPdfPath,
      });
      els.form?.reset();
      selectedPdfPath = null;
      setPdfLabel('Choose PDF file');
      await loadPapers();
    } catch (err) {
      showFormError(err?.message || 'Failed to add paper.');
    } finally {
      if (els.submitBtn) els.submitBtn.disabled = false;
    }
  }

  async function onOpenPdf() {
    const pdfPath = selectedPaper?.local_pdf_path || selectedPaper?.pdfPath;
    if (!pdfPath) return;
    try {
      await api.openPdf(pdfPath);
    } catch (e) {
      console.error('Library: open PDF failed', e);
      showFormError('Could not open PDF.');
    }
  }

  function init() {
    bindElements();
    if (!els.paperList) return;

    loadPapers();

    if (els.selectPdfBtn) els.selectPdfBtn.addEventListener('click', onSelectPdf);
    if (els.form) els.form.addEventListener('submit', onSubmit);
    if (els.openPdfBtn) els.openPdfBtn.addEventListener('click', onOpenPdf);
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => loadPapers());
  }

  // Auto-reload when switching to library view
  document.addEventListener('app:viewChanged', (e) => {
    if (e.detail?.view === 'library') {
      loadPapers();
    }
  });

  // Auto-reload when new papers are downloaded/ingested
  document.addEventListener('app:libraryUpdated', () => {
    loadPapers();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
