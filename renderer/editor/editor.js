/**
 * editor.js
 * Public module owning the full Markdown editor lifecycle.
 *
 * Strict API:
 *   mountEditor(rootEl)     — idempotent init, builds + wires everything inside rootEl
 *   unmountEditor()         — idempotent cleanup + content preservation
 *   getEditorContent()      — returns current markdown string
 *   onEditorChange(cb)      — register external content-change subscriber
 *
 * Owns internally:
 *   CodeMirror init
 *   Toolbar / export button bindings
 *   Scroll sync (RAF-guarded, debounced)
 *   Markdown preview rendering (debounced)
 *   IPC export calls
 *   All internal state
 *
 * main.js MUST NOT touch any of the above.
 */

import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { render as mdRender } from './preview.js';
import { buildEditorShell, wireExports } from './ui.js';

// ── Module-level state ────────────────────────────────────────────────────────

let isMounted = false;
let _view = null;                // EditorView instance
let _changeCallbacks = [];       // external onChange subscribers
let _savedContent = null;        // content preserved across unmount/remount
let _rafId = null;               // active RAF handle for scroll sync cleanup

// Scroll sync guard flags — prevent bidirectional feedback loop
let _syncFromEditor = false;
let _syncFromPreview = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function _syncEditorToPreview(editorScroller, previewEl) {
  if (_syncFromPreview) return;
  _syncFromEditor = true;
  const ratio = editorScroller.scrollTop /
    ((editorScroller.scrollHeight - editorScroller.clientHeight) || 1);
  previewEl.scrollTop = ratio * (previewEl.scrollHeight - previewEl.clientHeight);
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(() => { _syncFromEditor = false; _rafId = null; });
}

function _syncPreviewToEditor(previewEl, editorScroller) {
  if (_syncFromEditor) return;
  _syncFromPreview = true;
  const ratio = previewEl.scrollTop /
    ((previewEl.scrollHeight - previewEl.clientHeight) || 1);
  editorScroller.scrollTop = ratio * (editorScroller.scrollHeight - editorScroller.clientHeight);
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(() => { _syncFromPreview = false; _rafId = null; });
}

// ── Default starter content ───────────────────────────────────────────────────

const DEFAULT_CONTENT = [
  '# Untitled Document',
  '',
  'Start writing your research note here.',
  '',
  '## Introduction',
  '',
  'Use **bold**, *italic*, `code`, and $E = mc^2$ inline math.',
  '',
  '## Footnotes',
  '',
  'Here is a footnote reference.[^1]',
  '',
  '[^1]: This is the footnote.',
].join('\n');

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount the editor inside rootEl.
 * Idempotent — safe to call multiple times (no-op if already mounted).
 * Restores content from previous unmount if available.
 *
 * @param {HTMLElement} rootEl
 */
export async function mountEditor(rootEl) {
  if (isMounted) return;
  isMounted = true;

  try {
    // Load draft from disk if this is the very first boot (safeguard for hot-reloads)
    if (_savedContent === null && window.electronAPI?.document?.loadDraft) {
      try {
        const res = await window.electronAPI.document.loadDraft();
        if (res?.content) _savedContent = res.content;
      } catch (err) {
        console.warn('Failed to load draft:', err);
      }
    }

    const initialContent = _savedContent ?? DEFAULT_CONTENT;

    // 1. Build DOM (delegates to ui.js)
    const { cmHost, previewEl, btnOpen, btnMd, btnTex, btnPdf, statusEl } =
      buildEditorShell(rootEl);

    // 2. Debounced preview renderer (must exist before CM listener)
    const debouncedPreview = _debounce((md) => {
      previewEl.innerHTML = mdRender(md);
    }, 350);

    // 2.5 Debounced draft saver
    const debouncedSaveDraft = _debounce((md) => {
      if (window.electronAPI?.document?.saveDraft) {
        window.electronAPI.document.saveDraft(md);
      }
    }, 1000);

    // 3. Init CodeMirror 6
    _view = new EditorView({
      doc: initialContent,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const content = _view.state.doc.toString();
          _savedContent = content; // Sync local state
          _changeCallbacks.forEach(cb => cb(content));
          debouncedPreview(content);
          debouncedSaveDraft(content);
        }),
      ],
      parent: cmHost,
    });

    // 4. Initial preview render
    previewEl.innerHTML = mdRender(initialContent);

    // 5. Scroll sync — wait 1 tick for CM to render .cm-scroller
    setTimeout(() => {
      const cmScroller = cmHost.querySelector('.cm-scroller') || cmHost;
      const onEditorScroll  = _debounce(() => _syncEditorToPreview(cmScroller, previewEl), 60);
      const onPreviewScroll = _debounce(() => _syncPreviewToEditor(previewEl, cmScroller), 60);
      cmScroller.addEventListener('scroll', onEditorScroll,  { passive: true });
      previewEl.addEventListener('scroll',  onPreviewScroll, { passive: true });
    }, 0);

    // 6. Wire export buttons via ui layer (ui.js owns IPC interaction)
    wireExports(btnOpen, btnMd, btnTex, btnPdf, statusEl, getEditorContent, setEditorContent);
  } catch (err) {
    isMounted = false;
    console.error('[Editor] Failed to mount:', err);
    throw err;
  }
}

/**
 * Replace entire editor content (e.g. from Open file).
 * @param {string} content
 */
export function setEditorContent(content) {
  _savedContent = content;
  if (_view) {
    _view.dispatch({
      changes: { from: 0, to: _view.state.doc.length, insert: content }
    });
  }
}

/**
 * Unmount the editor and clean up.
 * Preserves editor content for next mountEditor() call.
 * Idempotent — safe to call multiple times (no-op if not mounted).
 */
export function unmountEditor() {
  if (!isMounted) return;
  isMounted = false;

  // Preserve content before destroying
  if (_view) {
    _savedContent = _view.state.doc.toString();
    _view.destroy();
    _view = null;
  }

  // Cancel any pending scroll-sync RAF
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

/**
 * Get current editor content as markdown string.
 * Returns empty string if editor is not mounted.
 *
 * @returns {string}
 */
export function getEditorContent() {
  if (!_view) return _savedContent ?? '';
  return _view.state.doc.toString();
}

/**
 * Register a callback fired on every content change.
 * Callbacks persist across mount/unmount cycles.
 *
 * @param {function(string): void} cb
 */
export function onEditorChange(cb) {
  _changeCallbacks.push(cb);
}
