# RIE — Developer Architecture Guide

Purpose: give an implementer (human or LLM) enough structure to add features correctly **without re-reading the whole repo**. Everything below was taken from the source (≈8.5k LOC). Paths are repo-relative. Ignore `paper_exp/` entirely (research material, not part of the app).

---

## 1. System in one paragraph

Electron 40 desktop app, Node **ESM** (`"type": "module"`), vanilla-JS renderer bundled by Vite 5 + Tailwind 3, no UI framework, no TypeScript, no test runner. The main process owns everything with side effects (PostgreSQL via `pg`, HTTP to 6 scholarly APIs + Groq, filesystem, `pandoc` subprocess). The renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`) and reaches the main process **only** through `window.electronAPI`, defined in `preload.js`, backed by `ipcMain.handle`.

```
RENDERER (src/*.js, index.html / editor.html)
   │  window.electronAPI.<ns>.<fn>()            ← preload.js  (contextBridge, ipcRenderer.invoke)
   ▼
MAIN  electron-main.js  ipcMain.handle('<ns>:<name>')  (+ main/ipc/document-ipc.js)
   ▼
services/*.js  (paper-service, ai-service, document-service, db, schema)
   ▼
ingestion/*.js (search-orchestrator → sources/ → normalizers/ → dedupe → ranking ; ai-pipeline)
   ▼
PostgreSQL · provider HTTP APIs · Groq · pandoc · filesystem (raw_papers/, analysis/, userData)
```

**Layering rule:** renderer → preload → IPC handler → service → ingestion/db. Never import services/ingestion from the renderer; never use Node APIs in `src/` or `renderer/`. IPC handlers should be thin (delegate to a service function).

---

## 2. Repo map (app code only)

```
electron-main.js        Main entry. `import 'dotenv/config'`. Creates windows, registers ALL ipcMain handlers (except document:*), settings.json R/W, startup sequence.
preload.js              CommonJS (`require`) — the ONLY CJS file. Exposes window.electronAPI.
main/ipc/document-ipc.js  registerDocumentIpcHandlers(): document:* channels (save dialogs, pandoc export, drafts).
index.html              Main SPA shell. Views = <div id="view-home|library|fetcher|analysis" class="app-view">. Settings modal markup (#settingsModal).
editor.html             Second window shell → src/editor-main.js.
vite.config.js          base './'; outDir dist; two inputs (index.html, editor.html). New HTML entry ⇒ add to rollupOptions.input.
tailwind.config.js · postcss.config.js · research.code-workspace

src/                    Renderer code (browser context)
  main.js               Entry: imports style.css, library.js, fetcher.js, analysis.js. Defines `Router`, theme toggle, audio toggle, settings modal, debounce.
  fetcher.js            Search/Download UI (IIFE).
  library.js            Library UI (IIFE).
  analysis.js           AI analysis UI (IIFE).
  editor-main.js        Editor window entry → mountEditor(root).
  style.css             Tailwind + custom component classes (e.g. .fetcher-status-dot, .analysis-log-entry, .app-view / .app-view--active).
renderer/editor/        editor.js (CodeMirror 6, mount/unmount/get/setEditorContent/onEditorChange), preview.js (markdown-it+footnote+katex → render()), ui.js (buildEditorShell, wireExports).

services/               Main-process logic (Node)
  db.js                 Pool singleton (env DB_*); `export function query(text, params)` — the only DB access primitive.
  schema.js             initializeDatabase(): idempotent DDL. Only place for schema changes.
  paper-service.js      searchAndStore, downloadPaperPdf, getLibraryPapers, addManualPaper, getAllPapers, getPaperById, deletePaper, getWorkspaceConfig, ensureRawPapersDir.
  ai-service.js         `export default new AIService()` (singleton). analyzePaper(paper, prompt, retries?).
  document-service.js   writeTempFile, convertToTex, convertToPdf (spawn `pandoc`, windowsHide).

ingestion/              Search pipeline, no Electron imports
  search-orchestrator.js  SOURCE_REGISTRY; searchPapers(query, sources, limit, sortBy); getSourceNames().
  sources/<id>.js         Fetch raw provider objects. normalizers/<id>.js: raw → Standard Paper. 
  dedupe.js · ranking.js · ai-pipeline.js

test/                   4 plain Node scripts (`node test/<file>.js`), custom assert/log; need running PostgreSQL (+ internet for provider ones).
public/                 static assets.  Runtime/ignored dirs: raw_papers/, analysis/, dist/, library-pdfs/, papers.json, .env
```

---

## 3. Core contracts (the things you must preserve)

### 3.1 Standard Paper object (normalizer output = DB row shape)
```js
{ id: null /* UUID assigned by orchestrator AFTER dedupe */,
  source: 'openalex',            // provider key (== SOURCE_REGISTRY key)
  source_id: 'W123',             // provider-native id; (source, source_id) is UNIQUE in DB
  title: '',                     // string, '' if missing
  abstract: null | string,
  authors: string[],             // JSON array in DB (JSONB)
  year: number | null,
  venue: string | null,
  doi: string | null,            // normalized: no https://doi.org/ prefix, lowercase
  url: '',                       // landing page
  pdf_url: string | null,
  citation_count: number | null }
```
DB-only extra: `local_pdf_path` (relative to workspace root, forward slashes), `created_at`.
Normalizers **never throw** (try/catch returning an empty-ish paper); missing → `null`.

### 3.2 Source adapter contract (`ingestion/sources/<id>.js`)
`export async function searchPapers(query, limit = 20, sortBy = 'date') → Promise<rawObject[]>`
- HTTP + parsing only. No normalizing, no IDs, no dedupe.
- Own `AbortController` timeout (`TIMEOUT_MS`: openalex 15 s, arxiv 30 s, S2/crossref/europepmc 15 s, pubmed 25 s).
- **Throw on failure** (orchestrator turns rejection into `providerStats[src].status='failed'`). Typical pattern: `console.warn('[source=x] failed:', msg); throw error;` with `finally { clearTimeout }`.
- Over-fetches (OpenAlex/arXiv use 3×limit) because the orchestrator re-ranks and trims.
- Keys from `process.env` read at call time (so Settings-modal changes apply): `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`, `CROSSREF_EMAIL`, `PUBMED_API_KEY`.

### 3.3 Orchestrator
`searchPapers(query, sources, limit, sortBy)`:
1. filter to known sources (unknown → warn+skip) → 2. `Promise.allSettled` all adapters → 3. per provider: `normalize` each raw → `rankPapers(...).slice(0, limit)` → 4. concat → `deduplicate()` → 5. `crypto.randomUUID()` for each → 6. `rankPapers` globally.
Returns a **plain array with extra properties** `providerStats` `{src:{status,raw,count,error?}}` and `providerFailures` `[{source,error}]` (properties on the array object; `JSON`/IPC structured clone of an array **drops them** — that's why `searchAndStore` copies them into a real object).

### 3.4 `searchAndStore` return (what IPC `papers:search` returns to the renderer)
`{ succeeded: Paper[], failed: [{paper,error}], providerFailures, providerStats }`
Insert: `INSERT_SQL` (13 params, `ON CONFLICT DO NOTHING`), then re-`SELECT` by `(source,source_id)` or DOI to replace `paper.id` with the canonical DB id and copy `local_pdf_path`. **Always use the returned `paper.id`**, not the orchestrator's UUID.

### 3.5 Ranking / dedupe
- `rankPapers(papers, 'date'|'citations')`: copy+sort; primary key year (date) or citations, tiebreak the other; non-numbers sort last.
- `deduplicate(papers)`: lookup chain DOI → `source:source_id` → SHA-256(`title|firstAuthor|year`, lowercased/trimmed); first occurrence wins. Input order matters.

### 3.6 AI
- `aiService.analyzePaper(paper, prompt)` → string. Needs `GROQ_API_KEY`; else throws `'AI service not initialized…'`. Model `process.env.GROQ_MODEL || 'openai/gpt-oss-120b'`, temperature 0.3, `max_tokens` 1024. Min spacing `AI_MIN_INTERVAL` (2000 ms); retries **only** HTTP 429, backoff `2^attempt·1000 + rand(0..500)` ms, up to `AI_MAX_RETRIES` (3). Key can be hot-swapped: `aiService.apiKey = …` (done by `settings:save`).
- User prompt is built as `Paper Title: ${title}\nAbstract: ${paper.abstract}\n\nTask: ${prompt}` (null abstract prints "null").
- `aiPipeline.processPapers(papers, prompt)` → sequential; returns `{ succeeded:[{id,title,analysis}], failed:[{id,title,error}] }` (never throws per-paper).

### 3.7 PDF download (`downloadPaperPdf({paperId,url,targetDirectory,filename})`)
Returns `{ localPath, relativePath, filename, alreadyExists }`, but the IPC handler `papers:downloadPdf` returns only **`localPath` (a string)**; renderer code accepts string or object. Validates `%PDF-` header, atomic temp→rename, reuses existing file, updates `papers.local_pdf_path` when `paperId` is known. Filenames: `<sanitized-title>--<uuid>.pdf`. `fetch` has no timeout.

### 3.8 Library
`getLibraryPapers()` scans `<WORKSPACE_ROOT or cwd>/raw_papers/*.pdf`, reads `SELECT * FROM papers`, matches file→row by (1) `--<uuid>.pdf` suffix, (2) `local_pdf_path`/basename, (3) filename contains sanitized `source_id`; unmatched PDFs surface as "External File". `addManualPaper` copies PDF in and inserts with `source='manual'`, `source_id=<uuid>`.
Note `getWorkspaceConfig()` uses `process.env.WORKSPACE_ROOT || process.cwd()`, whereas `ai:saveAnalysis` writes to `path.join(process.cwd(),'analysis',<safeTitle>.md)` (not WORKSPACE_ROOT).

---

## 4. Database

Single table, created in `services/schema.js` (run at startup, also by tests):

```sql
papers(
  id UUID PRIMARY KEY, source VARCHAR(50) NOT NULL, source_id VARCHAR(255) NOT NULL,
  title TEXT NOT NULL, abstract TEXT, authors JSONB DEFAULT '[]', year INTEGER, venue TEXT,
  doi VARCHAR(255), url TEXT, pdf_url TEXT, citation_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(), local_pdf_path TEXT,
  UNIQUE(source, source_id) )
UNIQUE INDEX idx_papers_doi ON papers(doi) WHERE doi IS NOT NULL
INDEX idx_papers_created_at ON papers(created_at DESC)
```
- Access only via `query(sql, params)` from `services/db.js` (parameterized, `$1…`). No ORM, no transactions helper (use `pool` additions in db.js if you need one).
- **Migrations:** none. Add tables with `CREATE TABLE IF NOT EXISTS` and columns with `ALTER TABLE … ADD COLUMN IF NOT EXISTS` inside `initializeDatabase()` (it must stay idempotent). If you add a column, also update `INSERT_SQL`/its param array in `paper-service.js` and the Standard Paper contract if it comes from providers.
- Because DOI is unique-indexed and `ON CONFLICT DO NOTHING` has no target, a DOI collision with a different `(source, source_id)` silently skips the insert; the follow-up SELECT then resolves the existing row.
- Config: `DB_HOST/PORT/USER/PASSWORD/NAME` (defaults localhost/5432/postgres/postgres/research_engine). Tests/other tools can point at another DB with `DB_NAME`.

---

## 5. IPC surface (current)

Pattern: `preload.js` → `ipcRenderer.invoke('ns:name', payload)`; main → `ipcMain.handle('ns:name', async (_e, payload) => …)`. Handlers receive a **single payload argument** (wrap multiple args in an object). Errors thrown in a handler reject the renderer promise.

| `window.electronAPI.` | Channel | Handler → |
|---|---|---|
| `library.getPapers()` | `library:getPapers` | `paperService.getLibraryPapers` |
| `library.addPaper(p)` | `library:addPaper` | `addManualPaper` |
| `library.openPdf(path)` | `library:openPdf` | opens a new BrowserWindow on `file://` URL |
| `library.selectPdfFile()` / `selectDownloadDir()` | `dialog:selectPdf` / `dialog:selectDirectory` | native dialogs |
| `papers.getWorkspaceConfig()` | `papers:getWorkspaceConfig` | `getWorkspaceConfig` |
| `papers.getSources()` | `papers:getSources` | `getSourceNames` |
| `papers.search(query,sources,limit,sortBy)` | `papers:search` | `searchAndStore` |
| `papers.downloadPdf({paperId,url,targetDirectory\|directory,filename})` | `papers:downloadPdf` | `downloadPaperPdf` → returns `localPath` |
| `papers.getAll(limit)` / `getById(id)` / `delete(id)` | `papers:getAll/getById/delete` | CRUD |
| `ai.analyzePaper(paper,prompt)` / `processPipeline(papers,prompt)` / `saveAnalysis(title,content)` | `ai:*` | aiService / aiPipeline / writes `analysis/<title>.md`, returns path |
| `document.exportMd/exportTex/exportPdf(content)`, `saveDraft(content)`, `loadDraft()`, `openMd()` | `document:export-md\|export-tex\|export-pdf\|save-draft\|load-draft\|open-md` | `main/ipc/document-ipc.js` |
| `window.openEditor()` | `window:openEditor` | second BrowserWindow (`editor.html`) |
| `settings.get()` / `save(s)` | `settings:get` / `settings:save` | `userData/settings.json` |

Settings keys: `openalexApiKey, groqApiKey, arxivApiKey, semanticScholarApiKey, crossrefEmail, pubmedApiKey` (stored values override `.env`; on save they are copied into `process.env`; on startup `app.whenReady` loads them before DB init).

Startup order (`app.whenReady`): load settings → `initializeDatabase()` (failure only logged) → `ensureLibraryDir()` → `registerDocumentIpcHandlers()` → `createWindow()`.

Legacy: `getLibraryPaths/readPapers/writePapers/ensureLibraryDir` in `electron-main.js` (`userData/papers.json`, `library-pdfs/`) are leftover from the pre-PostgreSQL library; only `ensureLibraryDir` is still called.

---

## 6. Renderer conventions

- **Feature module pattern** (`fetcher.js`, `library.js`, `analysis.js`): an IIFE; guard `window.electronAPI?.<ns>` and bail/show fallback outside Electron; `els` object + `bindElements()` caching `getElementById`; local state variables; `init()` on `DOMContentLoaded` (or immediately if already loaded); `escapeHtml()` before any `innerHTML` with data. Imported for side effects from `src/main.js`.
- **Router** (`Router` in `src/main.js`): views are `<div id="view-NAME" class="app-view">`; activate via `.app-view--active`, `aria-hidden` toggled; navigation by any element with `data-nav-view="NAME"` (special value `editor` opens the editor window); history stack with Alt+←/→. On every switch it dispatches `document` CustomEvent **`app:viewChanged`** `{detail:{view}}` — modules refresh themselves on it.
- **Cross-module events (no shared store):** `app:viewChanged`, `app:libraryUpdated` (fired by fetcher after a PDF download; library listens), `app:fetcherResultsUpdated` `{detail:{papers}}` (fetcher → analysis).
- Status UI classes: `fetcher-status-dot is-<state>`, `analysis-log-entry is-<type>`; styles live in `src/style.css`.
- Theme/audio/settings-modal logic: `initThemeToggle`, `initAudioToggle`, `initSettingsModal` in `src/main.js`.

---

## 7. Recipes

**Add an IPC feature (e.g. `papers:exportBibtex`)**
1. Implement logic in `services/<x>.js` (exported async fn, uses `query()` / fs).
2. `electron-main.js`: `ipcMain.handle('papers:exportBibtex', async (_e, payload) => service.fn(payload))` (or a new `main/ipc/*-ipc.js` with a `register…Handlers()` called in `app.whenReady`).
3. `preload.js`: add `exportBibtex: (p) => ipcRenderer.invoke('papers:exportBibtex', p)` under the right namespace.
4. Renderer: call `window.electronAPI.papers.exportBibtex(...)` inside a feature module, with the Electron guard.

**Add a new provider (e.g. `core`)**
1. `ingestion/sources/core.js` → `searchPapers(query, limit, sortBy)` per §3.2.
2. `ingestion/normalizers/core.js` → `export function normalize(raw)` per §3.1 (`source: 'core'`, never throw, normalize DOI).
3. Register in `SOURCE_REGISTRY` in `search-orchestrator.js` (two imports + one entry). `getSourceNames()` feeds the UI checkbox list automatically (`papers:getSources` → `fetcher.js loadSources`). Check `fetcher.js loadSources` for any hard-coded label map.
4. Optional key: read from `process.env` in the adapter; add field to `settings:get/save`, the preload settings flow, the `#settingsModal` form and `initSettingsModal` in `src/main.js`.
5. Add the provider to `test/test-all-providers.js`; `source` column is VARCHAR(50).

**Add a DB column/table**: edit `initializeDatabase()` (idempotent DDL) → update `INSERT_SQL` + param order in `paper-service.js` → surface it in `getLibraryPapers` result mapping if the UI needs it.

**Add a new view/page**: add `<div id="view-foo" class="app-view" aria-hidden="true">` in `index.html`, a trigger `<button data-nav-view="foo">`, a `src/foo.js` IIFE imported in `src/main.js`, and listen for `app:viewChanged` to lazy-load.

**Add a second window**: add the HTML file to `vite.config.js` `rollupOptions.input`, create window in main with the same `webPreferences` (preload + contextIsolation), and load `http://localhost:5173/<file>` in dev vs `dist/<file>` in prod (see `window:openEditor`).

**Change AI behavior**: edit prompt/params in `ai-service.js` (single place); batching/concurrency belongs in `ingestion/ai-pipeline.js` (currently strictly sequential, so rate limiting is naturally honoured).

---

## 8. Run / build / test

```bash
npm install
npm run electron:dev     # concurrently: vite (:5173) + wait-on → electron with ELECTRON_DEV=true
npm run build            # vite build → dist/
npm run electron:start   # run Electron against dist/
node test/test-ingestion.js            # ingestion pipeline checks (see file header for network needs)
node test/test-all-providers.js        # live provider calls
node test/test-paper-service.js        # needs PostgreSQL
node test/test-workspace-library.js    # needs PostgreSQL + network for PDFs
```
Prereqs: Node ≥ 18, PostgreSQL with DB `research_engine` (user/password per `.env`), `pandoc` on PATH (+ a LaTeX engine for PDF export), optional `GROQ_API_KEY`. Tests are standalone scripts (no jest/mocha, no CI) — add new test scripts in the same style (import `initializeDatabase`, run steps, print pass/fail, exit non-zero on failure). `.env` keys: `DB_*`, `OPENALEX_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `AI_MIN_INTERVAL`, `AI_MAX_RETRIES`, `ELECTRON_DEV`, `WORKSPACE_ROOT`, `SEMANTIC_SCHOLAR_API_KEY`, `CROSSREF_EMAIL`, `PUBMED_API_KEY`.

---

## 9. Pitfalls / things that will bite a new feature

1. **Mixed module systems:** everything is ESM except `preload.js` (CJS `require`). Don't `import` in preload; don't `require` elsewhere. Relative imports need the `.js` extension.
2. **Array-with-properties:** `providerStats`/`providerFailures` live as properties on the orchestrator's returned array; they vanish on IPC cloning of the bare array. Return plain objects across IPC.
3. **IPC takes one payload arg**; the preload wrapper is where positional args are packed.
4. **Use DB ids:** after `searchAndStore`, `paper.id` is the canonical row id (may differ from the orchestrator UUID when the paper already existed).
5. **Dedupe is order-dependent and DOI mismatch doesn't veto a title-hash match** — don't build features that assume exact dedup.
6. **Unique DOI index + `ON CONFLICT DO NOTHING`** can silently drop a row whose DOI already exists under another `(source, source_id)`.
7. **`process.cwd()` vs `WORKSPACE_ROOT`:** PDFs follow `WORKSPACE_ROOT`; analysis files use `cwd`. In packaged apps `cwd` is not the repo — resolve paths deliberately (`app.getPath('userData')`) for new features.
8. **Secrets** (API keys) are stored as plaintext JSON in `userData/settings.json` and `.env`; `settings:get` returns keys to the renderer. Don't log them; consider this before adding more sensitive settings.
9. **Provider quirks:** arXiv uses plain `http://`, a module-global 3 s throttle and swallows errors (returns `[]` instead of throwing); PubMed enforces 350 ms spacing and exposes no PDF link; Europe PMC adds per-hit Crossref DOI lookups (3 s timeout); S2 retries once after 2 s on 429. Search latency ≈ slowest adapter.
10. **AI prompt** interpolates abstract directly (`null` text when absent); AI calls have no timeout; `analysis.js` header comment still says "Gemini" (stale — it's Groq).
11. **PDF download** has no timeout/size cap; only `%PDF-` magic is validated.
12. **README is partially stale** (claims 2 sources, Llama-3.3-70B, `analyses`/`collections` tables). Trust the code.
13. **Renderer security:** keep `contextIsolation: true`, `nodeIntegration: false`; the PDF viewer window (`library:openPdf`) has no preload and loads `file://` from a renderer-supplied path — validate paths if you touch it.
14. **Schema changes at startup:** `initializeDatabase()` failure is only logged; the app still opens. Handle "DB unavailable" in new service calls (library code already catches and warns).
