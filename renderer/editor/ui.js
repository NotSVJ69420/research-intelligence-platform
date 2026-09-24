/**
 * ui.js
 * Interaction layer for the Markdown editor.
 *
 * Responsibilities:
 *   buildEditorShell(rootEl)                        — DOM factory, returns element handles
 *   wireExports(btnMd, btnTex, btnPdf, statusEl, getContent) — binds export buttons + IPC calls
 *
 * NO CodeMirror. NO scroll logic. NO preview rendering.
 * NO imports from editor.js (getContent is injected to avoid circular deps).
 */


const DL_ICON = `<svg style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
</svg>`;

function ghostBtn(label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = DL_ICON + label;
  btn.style.cssText = `
    padding:6px 14px; border:1px solid var(--sepia); border-radius:6px;
    background:transparent; color:var(--charcoal); font-size:12px;
    font-family:'EB Garamond',serif; letter-spacing:0.06em;
    cursor:pointer; transition:all 0.15s; display:flex; align-items:center; gap:6px;
    opacity: 0.8;
  `;
  btn.addEventListener('mouseover', () => { btn.style.borderColor = 'var(--burgundy)'; btn.style.color = 'var(--burgundy)'; btn.style.opacity = '1'; });
  btn.addEventListener('mouseout',  () => { btn.style.borderColor = 'var(--sepia)'; btn.style.color = 'var(--charcoal)'; btn.style.opacity = '0.8'; });
  return btn;
}

function filledBtn(label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = DL_ICON + label;
  btn.style.cssText = `
    padding:6px 14px; border:1px solid var(--burgundy); border-radius:6px;
    background:var(--burgundy); color:var(--cream);
    font-size:12px; font-family:'EB Garamond',serif; letter-spacing:0.06em;
    cursor:pointer; transition:opacity 0.15s; display:flex; align-items:center; gap:6px;
  `;
  btn.addEventListener('mouseover', () => { btn.style.opacity = '0.85'; });
  btn.addEventListener('mouseout',  () => { btn.style.opacity = '1'; });
  return btn;
}

/**
 * Build the full editor shell inside rootEl.
 * Clears previous content. Returns DOM handles for editor.js.
 *
 * @param {HTMLElement} rootEl
 * @returns {{ cmHost: HTMLElement, previewEl: HTMLElement,
 *             btnMd: HTMLButtonElement, btnTex: HTMLButtonElement,
 *             btnPdf: HTMLButtonElement, statusEl: HTMLElement }}
 */
export function buildEditorShell(rootEl) {
  rootEl.innerHTML = '';

  // ── Outer shell — fills parent, column layout ──────────────────────────────
  const shell = document.createElement('div');
  shell.className = 'editor-view-shell';
  // No position:fixed — let the parent (#view-editor.app-view--active) handle placement
  shell.style.cssText = `
    display:flex; flex-direction:column;
    width:100%; height:100%;
    background:var(--parchment);
  `;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    flex-shrink:0; padding:14px 24px 12px; background:var(--cream);
    border-bottom:1px solid var(--quote-bg); display:flex; align-items:center; gap:14px;
    box-shadow: var(--header-shadow); z-index:2;
  `;
  toolbar.insertAdjacentHTML('beforeend', `
    <svg style="width:18px;height:18px;color:var(--burgundy);flex-shrink:0;" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
    <div>
      <h2 style="font-family:'EB Garamond',serif;font-size:18px;font-weight:600;
                 color:var(--burgundy);letter-spacing:0.08em;margin:0;line-height:1;">
        MARKDOWN EDITOR
      </h2>
      <p style="font-family:'EB Garamond',serif;font-size:12px;color:var(--sepia);
                margin:2px 0 0;font-style:italic;opacity:0.8;">
        CodeMirror 6 · Live Preview · Export MD / TEX / PDF
      </p>
    </div>
  `);

  const btnOpen = ghostBtn('Open MD');
  const btnMd  = ghostBtn('Export MD');
  const btnTex = ghostBtn('Export TEX');
  const btnPdf = filledBtn('Export PDF');

  const statusEl = document.createElement('span');
  statusEl.style.cssText = `
    font-size:12px; color:var(--forest-green); min-width:160px;
    font-family:'EB Garamond',serif; font-style:italic;
  `;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-left:auto;display:flex;gap:8px;align-items:center;';
  btnRow.append(btnOpen, btnMd, btnTex, btnPdf, statusEl);
  toolbar.appendChild(btnRow);

  // ── Split pane ─────────────────────────────────────────────────────────────
  const pane = document.createElement('div');
  pane.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0;';

  const cmHost = document.createElement('div');
  cmHost.id = 'editorCmHost';
  cmHost.style.cssText = `
    flex:1; overflow:auto; min-width:0;
    background:transparent; position:relative;
  `;

  const gutter = document.createElement('div');
  gutter.style.cssText = 'width:1px;background:var(--sepia);opacity:0.2;flex-shrink:0;';

  const previewEl = document.createElement('div');
  previewEl.id = 'editorPreviewHost';
  previewEl.style.cssText = `
    flex:1; overflow:auto; min-width:0;
    padding:28px 48px; background:transparent;
    color:var(--charcoal); font-family:'EB Garamond',Georgia,serif;
    font-size:18px; line-height:1.8;
  `;

  pane.append(cmHost, gutter, previewEl);
  shell.append(toolbar, pane);
  rootEl.appendChild(shell);

  return { cmHost, previewEl, btnOpen, btnMd, btnTex, btnPdf, statusEl };
}

// ── Export interaction ────────────────────────────────────────────────────────

function _setStatus(statusEl, msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? '#f87171' : 'var(--forest-green)';
  clearTimeout(statusEl._timer);
  statusEl._timer = setTimeout(() => { statusEl.textContent = ''; }, 5000);
}

/**
 * Bind export button click handlers.
 * Called by editor.js after buildEditorShell — keeps IPC out of the editing engine.
 *
 * @param {HTMLButtonElement} btnOpen
 * @param {HTMLButtonElement} btnMd
 * @param {HTMLButtonElement} btnTex
 * @param {HTMLButtonElement} btnPdf
 * @param {HTMLElement}       statusEl
 * @param {function(): string} getContent — injected from editor.js, avoids circular import
 * @param {function(string): void} setContent — injected from editor.js to load opened files
 */
export function wireExports(btnOpen, btnMd, btnTex, btnPdf, statusEl, getContent, setContent) {
  const api = window.electronAPI?.document;
  let busy = false;

  async function doExport(fn, label) {
    if (busy) return;
    busy = true;
    _setStatus(statusEl, `${label}…`);
    try {
      const result = await fn(getContent());
      if (result?.cancelled) _setStatus(statusEl, 'Export cancelled.');
      else if (result?.success) _setStatus(statusEl, `${label} saved ✓`);
    } catch (err) {
      _setStatus(statusEl, `Export failed: ${err.message}`, true);
      console.error('[ui] export error:', err);
    } finally {
      busy = false;
    }
  }

  if (api) {
    btnOpen.addEventListener('click', async () => {
      if (busy) return;
      if (!api.openMd) {
        _setStatus(statusEl, 'Restart app to enable Open', true);
        return;
      }
      busy = true;
      try {
        const res = await api.openMd();
        if (res?.success) {
          setContent(res.content);
          _setStatus(statusEl, 'File opened ✓');
        }
      } catch (e) {
        _setStatus(statusEl, 'Open failed', true);
      } finally {
        busy = false;
      }
    });

    btnMd.addEventListener('click',  () => doExport(api.exportMd,  'MD'));
    btnTex.addEventListener('click', () => doExport(api.exportTex, 'TEX'));
    btnPdf.addEventListener('click', () => doExport(api.exportPdf, 'PDF'));
  } else {
    // Browser fallback: MD blob download only
    btnOpen.addEventListener('click', () => _setStatus(statusEl, 'Open requires Electron.', true));
    btnMd.addEventListener('click', () => {
      const blob = new Blob([getContent()], { type: 'text/markdown' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'document.md',
      });
      a.click();
      URL.revokeObjectURL(a.href);
      _setStatus(statusEl, 'MD downloaded ✓');
    });
    [btnTex, btnPdf].forEach(btn =>
      btn.addEventListener('click', () =>
        _setStatus(statusEl, 'TEX/PDF export requires Electron.', true)
      )
    );
  }
}
