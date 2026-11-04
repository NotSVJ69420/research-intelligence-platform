# Research Intelligence Engine (RIE) — Architecture Quick Reference

Compact map of the repo for fast orientation. Verified against commit `bf2d3a3` (app code, ~8.5k LOC excluding `paper_exp/`).

## 1. What it is

Electron 40 desktop app (Node ESM, `"type": "module"`) that:
1. **Searches** 6 scholarly APIs in parallel, normalizes → dedupes → ranks results.
2. **Stores** them in PostgreSQL (`papers` table) and downloads PDFs into a local `raw_papers/` workspace.
3. **Analyzes** papers with an LLM (Groq, `openai/gpt-oss-120b`).
4. Provides a **Markdown/LaTeX editor** window (CodeMirror + live preview; export via Pandoc).

Stack: Electron, Vite 5 + Tailwind 3 (renderer build), vanilla JS UI (no framework), `pg`, `xml2js`, `dotenv`, CodeMirror 6, markdown-it (+ footnote, KaTeX).

## 2. Process model

```
┌────────────── Renderer (Chromium, contextIsolation: true) ──────────────┐
│ index.html (SPA: home/library/fetcher/analysis views)   editor.html     │
│ src/main.js ─ router, theme, audio, settings modal      src/editor-main │
│ src/library.js  src/fetcher.js  src/analysis.js         renderer/editor/*│
│        │  window.electronAPI.*  (only bridge)                           │
└────────┼────────────────────────────────────────────────────────────────┘
         │ preload.js  (contextBridge → ipcRenderer.invoke)
┌────────▼──────────── Main process (electron-main.js) ───────────────────┐
│ ipcMain.handle(...)  ← all channels; + main/ipc/document-ipc.js          │
│   │                                                                     │
│   ├─ services/paper-service.js ─ services/db.js (pg Pool) ─ schema.js   │
│   │        └─ ingestion/search-orchestrator.js                          │
│   │              ├─ sources/*.js      (HTTP adapters)                   │
│   │              ├─ normalizers/*.js  (→ unified paper schema)          │
│   │              ├─ dedupe.js, ranking.js                               │
│   ├─ services/ai-service.js ◄─ ingestion/ai-pipeline.js                 │
│   └─ services/document-service.js (spawns `pandoc`)                     │
└──────────────────────────────────────────────────────────────────────────┘
        External: PostgreSQL · 6 scholarly APIs · Groq API · Pandoc · filesystem
```

- **Renderer never touches DB/network/filesystem directly**; everything goes through `window.electronAPI` (defined in `preload.js`) → IPC → main.
- Dev: `npm run electron:dev` (Vite on :5173 + Electron `ELECTRON_DEV=true`, loads `http://localhost:5173`). Prod: `vite build` → `dist/`, Electron loads `dist/index.html` / `dist/editor.html` (two Vite entries: `main`, `editor`).
- Startup (`app.whenReady`): load stored settings → `initializeDatabase()` → register IPC (`registerDocumentIpcHandlers`) → create main window.

## 3. Directory / file map

```
.
├─ electron-main.js        Main process: windows, all IPC handlers (library/papers/ai/dialog/settings/window), PDF download streaming, settings.json in app.getPath('userData')
├─ preload.js              contextBridge → window.electronAPI {library, papers, ai, document, window, settings}
├─ index.html              Main SPA shell (views: #view-home, #view-library, #view-fetcher, #view-analysis); Tailwind classes
├─ editor.html             Editor window shell (loads src/editor-main.js)
├─ vite.config.js          base './', outDir dist, inputs: index.html + editor.html
├─ tailwind.config.js · postcss.config.js
├─ .env.example            DB_*, OPENALEX_API_KEY, GROQ_API_KEY, AI_MIN_INTERVAL, AI_MAX_RETRIES, ELECTRON_DEV
├─ package.json            scripts: dev, build, preview, electron:dev, electron:build, electron:start
├─ README.md · LICENSE (MIT) · research.code-workspace
│
├─ src/                    RENDERER (vanilla JS, bundled by Vite)
│  ├─ main.js              Entry. Router (SPA view switcher + history), theme toggle, audio toggle, settings modal; imports library/fetcher/analysis
│  ├─ fetcher.js (559)     Search UI: query, source checkboxes, limit/sort, results list, PDF download, select-for-analysis
│  ├─ library.js           Library view: list papers, add manual PDF, open PDF
│  ├─ analysis.js          AI view: prompt, run pipeline over selected papers, save analysis
│  ├─ editor-main.js       Editor window entry → mountEditor()
│  └─ style.css (1945)     Global styles (Tailwind layers + custom)
│
├─ renderer/editor/        Markdown editor module
│  ├─ editor.js            CodeMirror 6 setup, scroll sync, mount/unmount, get/set content, change callback
│  ├─ preview.js           markdown-it (+footnote, katex) render
│  └─ ui.js                Editor shell DOM + export buttons wiring (open md / export md/tex/pdf)
│
├─ main/ipc/
│  └─ document-ipc.js      IPC: document:export-md|export-tex|export-pdf|save-draft|load-draft|open-md
│
├─ services/               MAIN-PROCESS business logic
│  ├─ db.js                pg.Pool singleton from env (DB_HOST/PORT/USER/PASSWORD/NAME); exports query(text, params)
│  ├─ schema.js            initializeDatabase(): idempotent CREATE TABLE/INDEX (see §5)
│  ├─ paper-service.js     searchAndStore, downloadPaperPdf, getLibraryPapers, addManualPaper, getAllPapers, getPaperById, deletePaper, getWorkspaceConfig, ensureRawPapersDir
│  ├─ ai-service.js        Groq client singleton: analyzePaper(paper, prompt); 2 s min interval, 429 retry w/ exponential backoff
│  └─ document-service.js  writeTempFile, convertToTex/Pdf via spawned `pandoc`
│
├─ ingestion/              SEARCH PIPELINE (pure-ish modules, no Electron deps)
│  ├─ search-orchestrator.js  SOURCE_REGISTRY {fetch, normalize}; searchPapers(query, sources, limit, sortBy); getSourceNames()
│  ├─ sources/             One adapter per API: openalex, arxiv, semanticscholar, crossref, europepmc, pubmed (HTTP + per-source timeout/throttle)
│  ├─ normalizers/         One per source → unified paper object
│  ├─ dedupe.js            deduplicate(): keys DOI → source:id → SHA-256(title|first author|year)
│  ├─ ranking.js           rankPapers(papers, 'date'|'citations'); missing values last
│  └─ ai-pipeline.js       processPapers(papers, prompt): sequential aiService.analyzePaper, returns {succeeded, failed}
│
├─ test/                   Plain Node scripts (no framework); need PostgreSQL (+ network for providers)
│  ├─ test-ingestion.js · test-all-providers.js · test-paper-service.js · test-workspace-library.js
│
├─ public/                 Static assets (audio.mp3, vite.svg)
├─ paper_exp/              Research paper + reproducible experiments (NOT part of the app; see paper_exp/README.md)
└─ raw_papers/             (runtime, gitignored) downloaded PDFs under WORKSPACE_ROOT (default cwd)
```

## 4. Key flows

**Search** — `fetcher.js` → `electronAPI.papers.search(query, sources, limit, sortBy)` → IPC `papers:search` → `paper-service.searchAndStore` → `orchestrator.searchPapers`:
1. For each selected source: adapter fetch (parallel, `Promise.allSettled`) → normalize → per-provider `rankPapers` + `slice(0, limit)`.
2. Merge → `deduplicate()` → assign UUIDs → final rank.
3. `searchAndStore` inserts rows (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT` to get the canonical row) and returns papers + per-provider status (`providerStats`).
Latency ≈ slowest adapter. Provider failures are isolated (one failing source doesn't fail the search).

**PDF download** — `papers:downloadPdf` → `paperService.downloadPaperPdf`: fetch (no timeout), validate `%PDF-` magic, atomic temp-file → rename into `raw_papers/` (or chosen dir), link `local_pdf_path` in DB; reuses existing file if present.

**Library** — `library:getPapers` → `getLibraryPapers`: reads DB rows, scans `raw_papers/` to map files to rows (substring match on `source_id`), surfaces unindexed PDFs; `addManualPaper` for user PDFs.

**AI analysis** — `ai:processPipeline` → `ai-pipeline.processPapers` → sequential `aiService.analyzePaper` (Groq chat completions, T=0.3, ≥2 s between calls, retries only on HTTP 429). `ai:saveAnalysis` writes `<cwd>/analysis/<sanitized_title>.md` (note: `process.cwd()`, not `WORKSPACE_ROOT`).

**Editor/export** — `window:openEditor` opens a second BrowserWindow (`editor.html`). Content → `document:export-md|tex|pdf` → `document-service` writes a temp file and spawns `pandoc` (must be on PATH) for `.tex`/`.pdf`; drafts saved/loaded via `document:save-draft|load-draft`.

**Settings** — `settings:get|save` read/write plaintext `settings.json` in Electron `userData` (keys: `openalexApiKey`, `groqApiKey`, `arxivApiKey`, `semanticScholarApiKey`, `crossrefEmail`, `pubmedApiKey`); stored values override `.env` and are copied into `process.env` at startup / on save. (Plaintext storage is a known weakness.)

## 5. Data model

Single table `papers` (created in `services/schema.js`):

| column | type | notes |
|---|---|---|
| id | UUID PK | assigned after dedupe |
| source | VARCHAR(50) | provider name |
| source_id | VARCHAR(255) | provider-native id; `UNIQUE(source, source_id)` |
| title | TEXT NOT NULL | |
| abstract | TEXT | |
| authors | JSONB | default `[]` |
| year | INTEGER | |
| venue | TEXT | |
| doi | VARCHAR(255) | partial unique index `idx_papers_doi WHERE doi IS NOT NULL` |
| url / pdf_url | TEXT | |
| citation_count | INTEGER | |
| created_at | TIMESTAMP | default NOW(); index DESC |
| local_pdf_path | TEXT | added by `ALTER TABLE … IF NOT EXISTS` |

Unified paper object (normalizer output) mirrors these columns: `title, abstract, authors[], year, venue, doi, url, pdf_url, citation_count, source, source_id`.

## 6. IPC channels (all via `ipcRenderer.invoke`)

| Namespace | Channels |
|---|---|
| library | `library:getPapers`, `library:addPaper`, `library:openPdf`, `dialog:selectPdf`, `dialog:selectDirectory` |
| papers | `papers:getWorkspaceConfig`, `papers:getSources`, `papers:search`, `papers:downloadPdf`, `papers:getAll`, `papers:getById`, `papers:delete` |
| ai | `ai:analyzePaper`, `ai:processPipeline`, `ai:saveAnalysis` |
| document | `document:export-md`, `document:export-tex`, `document:export-pdf`, `document:save-draft`, `document:load-draft`, `document:open-md` |
| window | `window:openEditor` |
| settings | `settings:get`, `settings:save` |

## 7. Providers

| id | API | notable behavior |
|---|---|---|
| openalex | OpenAlex works | relevance sort, 3×limit candidates, optional `OPENALEX_API_KEY`, 15 s timeout |
| arxiv | arXiv Atom (XML) | plain `http://`, 3 s module-global throttle, errors swallowed → `[]`, 30 s timeout |
| semantic_scholar | Graph API | one retry after 2 s on 429, 15 s timeout |
| crossref | Crossref works | 15 s timeout |
| europe_pmc | Europe PMC REST | DOI look-ups to Crossref for hits with DOI (3 s timeout), 15 s timeout |
| pubmed | NCBI E-utilities (esearch+efetch XML) | 350 ms spacing, no PDF link, 25 s timeout |

## 8. Configuration

`.env` (loaded by `dotenv/config` in `electron-main.js` and `services/db.js`): `DB_HOST/PORT/USER/PASSWORD/NAME` (defaults localhost:5432, postgres/postgres, `research_engine`), `OPENALEX_API_KEY` (optional), `GROQ_API_KEY` (needed for AI), optional `SEMANTIC_SCHOLAR_API_KEY`, `CROSSREF_EMAIL`, `PUBMED_API_KEY`, `AI_MIN_INTERVAL` (ms, default 2000), `AI_MAX_RETRIES`, `ELECTRON_DEV`, `WORKSPACE_ROOT` (default `process.cwd()`). Keys can also be saved via the in-app Settings modal.

## 9. Commands

```bash
npm install
npm run electron:dev        # Vite + Electron (hot reload)
npm run build && npm run electron:start   # production-style
node test/test-ingestion.js # tests: plain scripts, need Postgres (+ internet)
```
Prereqs: Node ≥ 18, PostgreSQL with DB `research_engine`, `pandoc` (+ LaTeX engine for PDF export), `GROQ_API_KEY`.

## 10. Conventions / gotchas

- ESM everywhere in app code, **except `preload.js`, which uses `require`** (Electron sandboxed preload).
- Layering: renderer → preload → IPC → `services/` → `ingestion/` / `db`. Keep renderer free of Node APIs.
- Dedup is order-dependent (first match wins; duplicates' keys aren't registered) and a DOI conflict never vetoes a title-hash match.
- AI prompt interpolates `${paper.abstract}` literally → "null" when abstract missing.
- No migrations framework: schema is `CREATE IF NOT EXISTS` + `ALTER … IF NOT EXISTS`.
- README is partially stale (mentions 2 sources, Llama-3.3-70B, `analyses`/`collections` tables that don't exist); `src/analysis.js` has a Gemini comment — code is the source of truth.
- Tests are scripts, not a test runner; there is no CI config.
- `paper_exp/` is self-contained research material (paper, experiments, local harness `experiments/rie_local_harness.mjs`); ignore it when learning the app.
