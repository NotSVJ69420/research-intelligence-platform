#!/usr/bin/env python3
"""Architecture (Fig. 1) and search/analysis data-flow (Fig. 2) diagrams. Structure is taken from the
repository source (electron-main.js, preload.js, services/*, ingestion/*); nothing is invented."""
import os
from figlib import *

HERE = os.path.dirname(os.path.abspath(__file__))


def architecture():
    W, H = 740, 418
    s = SVG(W, H)
    # --- renderer
    s.rect(4, 2, 732, 62, fill="#fafafa", stroke=GRID, rx=4)
    s.text(10, 13, "Renderer processes (contextIsolation = true, nodeIntegration = false)", size=8.5, fill=MUTED, weight="bold")
    s.box(10, 19, 400, 40, "Main window  (index.html, Vite, Tailwind)", ["src/main.js · fetcher.js · library.js · analysis.js"], fill=FILL["blue"])
    s.box(420, 19, 310, 40, "Editor window  (editor.html)", ["renderer/editor/*: CodeMirror 6, markdown-it + KaTeX"], fill=FILL["blue"])
    # --- preload
    s.rect(10, 74, 720, 26, fill=FILL["grey"])
    s.text(18, 91, "preload.js — contextBridge → window.electronAPI", size=10, weight="bold")
    s.text(722, 91, "{library, papers, ai, document, window, settings}", size=8.5, anchor="end", fill=MUTED, family=MONO)
    # --- main process
    s.rect(4, 108, 732, 40, fill="#fafafa", stroke=GRID, rx=4)
    s.text(10, 119, "Electron main process", size=8.5, fill=MUTED, weight="bold")
    s.box(10, 123, 720, 21, "electron-main.js · ipcMain.handle()  library:* · papers:* · ai:* · settings:* · window:*   +   main/ipc/document-ipc.js  document:*", [], fill=FILL["orange"], tsize=9)
    # arrows renderer->preload->main
    for x in (210, 575):
        s.line(x, 59, x, 74, arrow=True)
    s.line(370, 100, 370, 123, arrow=True)
    # --- lanes
    lanes = [164, 222, 280, 338]
    col1, col2, col3 = (10, 180), (258, 222), (540, 190)
    s.text(10, 160, "Services and ingestion layer", size=8.5, fill=MUTED, weight="bold")
    for y in lanes:
        s.line(100, 144 if y == lanes[0] else y - 10, 100, y, arrow=True, grey=True) if False else None
    s.line(100, 144, 100, 164, arrow=True)
    # lane 1: paper-service -> ingestion -> scholarly APIs
    s.box(col1[0], lanes[0], col1[1], 48, "services/paper-service.js", ["searchAndStore · downloadPaperPdf", "getLibraryPapers · addManualPaper"], fill=FILL["green"])
    s.box(col2[0], lanes[0], col2[1], 48, "ingestion/  search-orchestrator.js", ["6 adapters → 6 normalizers → dedupe → rank"], fill=FILL["green"])
    s.box(col3[0], lanes[0], col3[1], 48, "Scholarly APIs (HTTPS)", ["arXiv · OpenAlex · Semantic Scholar", "Crossref · Europe PMC · PubMed"], fill="white", dash="4 3")
    s.line(col1[0] + col1[1], lanes[0] + 24, col2[0], lanes[0] + 24, arrow=True)
    s.line(col2[0] + col2[1], lanes[0] + 24, col3[0], lanes[0] + 24, arrow=True)
    s.text((col2[0] + col2[1] + col3[0]) / 2, lanes[0] + 19, "fetch()", size=8, anchor="middle", fill=MUTED, family=MONO)
    # lane 2: db -> PostgreSQL ; paper-service -> filesystem
    s.box(col1[0], lanes[1], col1[1], 48, "services/db.js · schema.js", ["pg.Pool · idempotent DDL at start-up"], fill=FILL["green"])
    s.box(col2[0], lanes[1], col2[1], 48, "PostgreSQL 14+", ["table papers (JSONB authors,", "UNIQUE(source, source_id), DOI index)"], fill="white", dash="4 3")
    s.box(col3[0], lanes[1], col3[1], 48, "Local filesystem", ["raw_papers/*.pdf · analysis/*.md", "userData: settings.json, draft.md"], fill="white", dash="4 3")
    s.line(100, lanes[0] + 48, 100, lanes[1], arrow=True)
    s.line(col1[0] + col1[1], lanes[1] + 24, col2[0], lanes[1] + 24, arrow=True)
    s.text((col1[0] + col1[1] + col2[0]) / 2, lanes[1] + 19, "SQL", size=8, anchor="middle", fill=MUTED, family=MONO)
    s.path(f"M{col1[0] + 150},{lanes[0] + 48} L{col1[0] + 150},{lanes[1] - 5} L{col3[0] + 95},{lanes[1] - 5} L{col3[0] + 95},{lanes[1]}", arrow=True, grey=True, dash="3 2")
    # lane 3: AI
    s.box(col1[0], lanes[2], col1[1], 48, "ingestion/ai-pipeline.js", ["processPapers(): serial loop,", "per-paper failure isolation"], fill=FILL["green"])
    s.box(col2[0], lanes[2], col2[1], 48, "services/ai-service.js", ["2 s minimum request interval", "429 → exponential back-off (≤ 3 retries)"], fill=FILL["green"])
    s.box(col3[0], lanes[2], col3[1], 48, "Groq chat-completions API", ["model: openai/gpt-oss-120b", "T = 0.3, max_tokens = 1024"], fill="white", dash="4 3")
    s.line(100, lanes[1] + 48, 100, lanes[2], arrow=True, grey=True) if False else None
    s.line(col1[0] + col1[1], lanes[2] + 24, col2[0], lanes[2] + 24, arrow=True)
    s.line(col2[0] + col2[1], lanes[2] + 24, col3[0], lanes[2] + 24, arrow=True)
    s.text((col2[0] + col2[1] + col3[0]) / 2, lanes[2] + 19, "POST", size=8, anchor="middle", fill=MUTED, family=MONO)
    # lane 4: document export
    s.box(col1[0], lanes[3], col1[1], 48, "services/document-service.js", ["spawn('pandoc') — md → tex / pdf"], fill=FILL["green"])
    s.box(col3[0], lanes[3], col3[1], 48, "Pandoc + pdflatex (optional)", ["external binaries on PATH"], fill="white", dash="4 3")
    s.line(col1[0] + col1[1], lanes[3] + 24, col3[0], lanes[3] + 24, arrow=True)
    s.text(380, lanes[3] + 19, "child process", size=8, anchor="middle", fill=MUTED, family=MONO)
    # IPC -> lanes (3 and 4) on the left margin
    s.path(f"M6,144 L6,{lanes[2] + 24} L{col1[0]},{lanes[2] + 24}", arrow=True, grey=True, dash="3 2") if False else None
    s.text(10, 404, "Solid arrows: calls implemented in the repository.  Dashed boxes: external systems.  Green: modules evaluated in this paper.", size=8, fill=MUTED)
    s.save(os.path.join(HERE, "fig_architecture.svg"))


def dataflow():
    W, H = 740, 322
    s = SVG(W, H)
    # stage boxes along the top
    y0, h = 8, 74
    stages = [
        ("1  Validate", ["unknown source names", "warn + skipped;", "none valid → []"], FILL["white"]),
        ("2  Dispatch", ["Promise.allSettled", "over all adapters;", "per-host timeouts"], FILL["blue"]),
        ("3  Normalize", ["6 normalizers →", "canonical schema;", "rank, keep top-limit", "per provider"], FILL["blue"]),
        ("4  Deduplicate", ["keys: DOI | source:id |", "SHA-256(title|author|yr);", "first wins; merge fields"], FILL["orange"]),
        ("5  UUID + rank", ["crypto.randomUUID()", "after dedup; global", "sort by year or cites"], FILL["white"]),
        ("6  Persist", ["INSERT … ON CONFLICT", "DO NOTHING; SELECT row;", "replace id by DB id"], FILL["green"]),
    ]
    bw, gap = 112, 9.6
    xs = []
    for i, (t, sub, f) in enumerate(stages):
        x = 8 + i * (bw + gap)
        xs.append(x)
        s.box(x, y0, bw, h, t, sub, fill=f, tsize=10, ssize=8.0)
        if i:
            s.line(xs[i - 1] + bw, y0 + h / 2, x, y0 + h / 2, arrow=True)
    # provider lanes (detail of stage 2)
    s.text(8, 108, "Stage 2 detail — one adapter per provider (all issued concurrently; the search returns when every adapter has settled)", size=9, weight="bold")
    rows = [
        ("openalex", "1 GET  per_page = 3·limit  (relevance)", "15 s", None),
        ("arxiv", "1 GET  3·limit; adapter-level 3 s throttle", "30 s", "HTTP error / timeout → [ ]  (reported as success)"),
        ("semantic_scholar", "1 GET  limit; one retry after 2 s on 429", "15 s", None),
        ("crossref", "1 GET  rows = limit; type filter", "15 s", None),
        ("europe_pmc", "1 GET  + up to limit Crossref look-ups for PDF", "15 s / 3 s", None),
        ("pubmed", "ESearch → 350 ms spacing → EFetch (XML)", "25 s", None),
    ]
    ty = 118
    s.text(150, ty + 4, "requests issued per search", size=8.2, fill=MUTED)
    s.text(432, ty + 4, "timeout", size=8.2, fill=MUTED, anchor="middle")
    for i, (name, req, to, note) in enumerate(rows):
        yy = ty + 10 + i * 17
        s.rect(8, yy, 130, 14, fill=FILL["blue"], stroke=INK, sw=0.8, rx=2)
        s.text(14, yy + 10.5, name, size=8.8, family=MONO)
        s.text(150, yy + 10.5, req, size=8.6)
        s.text(432, yy + 10.5, to, size=8.6, anchor="middle")
        if note:
            s.text(472, yy + 10.5, note, size=8.2, fill=C["verm"])
    # consumers
    s.text(8, 246, "Downstream use of the result list", size=9, weight="bold")
    s.box(8, 254, 214, 58, "PDF acquisition (optional)", ["fetch(pdf_url) → %PDF- header check →", "temp file → copy to raw_papers/<title>--<uuid>.pdf", "→ UPDATE papers.local_pdf_path"], fill=FILL["green"], tsize=9.6, ssize=8.4)
    s.box(250, 254, 230, 58, "AI analysis (user-triggered, serial)", ["ai:analyzePaper per paper → Groq POST", "prompt = title + abstract + free-text task;", "answer written to analysis/<title>.md"], fill=FILL["green"], tsize=9.6, ssize=8.4)
    s.box(508, 254, 224, 58, "Library view", ["scan raw_papers/ + SELECT * FROM papers;", "match by UUID suffix, stored path or", "source_id substring; else 'External File'"], fill=FILL["green"], tsize=9.6, ssize=8.4)
    # arrow from stage 6 down to consumers
    s.path(f"M{xs[5] + bw / 2},{y0 + h + 6} L{xs[5] + bw / 2},{100} ", arrow=False) if False else None
    s.line(124, 246, 124, 254, arrow=True, grey=True) if False else None
    s.save(os.path.join(HERE, "fig_dataflow.svg"))


if __name__ == "__main__":
    architecture()
    dataflow()
    print("ok")
