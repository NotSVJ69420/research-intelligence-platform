# Research Intelligence Engine

A desktop platform and scholarly authoring apparatus built with Electron, PostgreSQL, and Large Language Model (LLM) synthesis.

---

## 1. System Overview

The Research Intelligence Engine is a desktop application for academic research. The system integrates academic discovery APIs, local relational storage, automated AI synthesis, and a scholarly document editor into a single workflow.

### Core Capabilities
- **Academic Paper Search**: Parallel multi-source querying across arXiv and OpenAlex APIs.
- **Automated Ingestion**: Schema normalization, citation normalization, and relational deduplication.
- **AI Paper Analysis**: Structured synthesis, key contribution extraction, and methodology extraction powered by Groq (Llama-3.3-70B).
- **Relational Library**: PostgreSQL persistence with connection pooling, transaction isolation, and indexed full-text fields.
- **Dedicated Scholarly Editor**: Split-pane Markdown and LaTeX authoring environment with synchronized scrolling, KaTeX mathematics rendering, and Pandoc export pipelines.
- **In-App Settings Management**: Graphic interface for runtime API configuration and persistence across user sessions.

---

## 2. Architecture

The system uses Electron multi-process architecture with strict context isolation.

```
[ Electron Main Process ]
  ├── App Lifecycle & Window Management
  ├── IPC Handlers (document, library, papers, ai, settings)
  ├── External Tool Bridge (Pandoc CLI, Local File System)
  └── PostgreSQL Connection Pool (pg.Pool)
          │
          │  contextBridge (preload.js)
          ▼
[ Renderer Process ]
  ├── Main Window (SPA Router, Tailwind CSS, Vite)
  │     ├── Discovery & Query Orchestration
  │     ├── Library & Paper Viewer
  │     └── In-App Settings Modal
  └── Editor Window (CodeMirror 6, KaTeX, Split Pane)
```

---

## 3. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | Electron 40, Node.js |
| **Frontend UI** | HTML5, Tailwind CSS, Vite 5, Garamond Typography |
| **Editor** | CodeMirror 6, markdown-it, markdown-it-katex, KaTeX |
| **Database** | PostgreSQL 14+, `pg` (Connection Pooling) |
| **Academic Sources**| arXiv API (XML/Atom), OpenAlex API (REST JSON) |
| **AI Inference** | Groq API (`llama-3.3-70b-versatile`) |
| **Document Export** | Pandoc CLI, pdflatex / xelatex |

---

## 4. Prerequisites

Install the following software before you start:

1. **Node.js**: Version 18.0.0 or higher.
2. **PostgreSQL**: Version 14 or higher (active database instance).
3. **Pandoc** *(Optional, for PDF and LaTeX exports)*: Available in system `PATH`.
4. **LaTeX Distribution** *(Optional, for Pandoc PDF compilation)*: TeX Live, MacTeX, or MiKTeX.

---

## 5. Installation and Setup

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/research-intelligence-engine.git
cd research-intelligence-engine
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy the sample environment configuration file:
```bash
cp .env.example .env
```

Open `.env` and specify your credentials:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=research_engine

# AI Synthesis (Groq API key from https://console.groq.com)
GROQ_API_KEY=gsk_your_groq_api_key

# Academic APIs (Optional)
OPENALEX_API_KEY=your_openalex_api_key
```

> **Note**: You can also enter and update API keys directly inside the application using the top-left **Settings** button.

### Step 4: Initialize the Database
The application automatically creates the required tables (`papers`, `analyses`, `collections`) on first startup. Ensure that the database specified in `DB_NAME` exists on your PostgreSQL server:

```sql
CREATE DATABASE research_engine;
```

---

## 6. Execution Commands

### Development Mode
Start the Vite development server and Electron shell with hot reload:
```bash
npm run electron:dev
```

### Build Frontend
Compile the production frontend assets:
```bash
npm run build
```

### Production Shell
Run the Electron shell using compiled production assets:
```bash
npm run electron:start
```

---

## 7. Project Structure

```
├── electron-main.js        # Main process entry, window lifecycle, IPC handlers
├── preload.js              # Secure contextBridge API exposures
├── index.html              # Main scholarly research workbench interface
├── editor.html             # Dedicated LaTeX & Markdown authoring workspace
├── services/               # Database and AI service modules
│   ├── db.js               # PostgreSQL connection pool and initialization
│   ├── paper-service.js    # Relational CRUD and search storage operations
│   └── ai-service.js       # Groq API client with rate limit throttling
├── ingestion/              # Multi-source paper retrieval system
│   ├── orchestrator.js     # Parallel dispatch and record deduplication
│   ├── ai-pipeline.js      # Batch paper summarization pipeline
│   └── sources/            # Source adapters (arXiv, OpenAlex)
├── main/                   # IPC implementation modules
│   └── ipc/                # Document conversion and file I/O handlers
├── src/                    # Main window frontend modules
│   ├── main.js             # SPA router, settings modal, interaction layer
│   ├── library.js          # Local library management view
│   ├── fetcher.js          # Search trigger and query execution view
│   └── analysis.js         # AI synthesis viewer
└── renderer/               # Editor window frontend modules
    ├── editor.js           # CodeMirror 6 setup and live preview synchronizer
    └── style.css           # Editor-specific typography and layout styles
```

---

## 8. License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
