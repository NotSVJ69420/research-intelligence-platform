import 'dotenv/config';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './services/schema.js';
import * as paperService from './services/paper-service.js';
import { getSourceNames } from './ingestion/search-orchestrator.js';
import aiService from './services/ai-service.js';
import aiPipeline from './ingestion/ai-pipeline.js';
import { registerDocumentIpcHandlers } from './main/ipc/document-ipc.js';

console.log('[main] aiService defined:', !!aiService);
console.log('[main] aiPipeline defined:', !!aiPipeline);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV === 'development';

// Library storage paths (userData is persistent and app-specific)
function getLibraryPaths() {
  const userData = app.getPath('userData');
  const libraryDir = path.join(userData, 'library-pdfs');
  const papersPath = path.join(userData, 'papers.json');
  return { userData, libraryDir, papersPath };
}

async function ensureLibraryDir() {
  const { libraryDir } = getLibraryPaths();
  await fs.mkdir(libraryDir, { recursive: true });
}

async function readPapers() {
  const { papersPath } = getLibraryPaths();
  try {
    const data = await fs.readFile(papersPath, 'utf-8');
    const json = JSON.parse(data);
    return Array.isArray(json.papers) ? json.papers : [];
  } catch {
    return [];
  }
}

async function writePapers(papers) {
  const { papersPath } = getLibraryPaths();
  await fs.writeFile(papersPath, JSON.stringify({ papers }, null, 2), 'utf-8');
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
    title: 'Research Intelligence Engine',
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// ---------- IPC: Library ----------
ipcMain.handle('library:getPapers', async () => {
  return readPapers();
});

ipcMain.handle('library:addPaper', async (_event, { title, authors, year, pdfPath }) => {
  if (!title || !pdfPath) {
    throw new Error('Title and PDF are required');
  }
  await ensureLibraryDir();
  const papers = await readPapers();
  const id = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const ext = path.extname(pdfPath) || '.pdf';
  const destPath = path.join(getLibraryPaths().libraryDir, `${id}${ext}`);
  await fs.copyFile(pdfPath, destPath);
  const paper = {
    id,
    title: String(title).trim(),
    authors: String(authors || '').trim(),
    year: year ? String(year).trim() : '',
    pdfPath: destPath,
  };
  papers.push(paper);
  await writePapers(papers);
  return paper;
});

ipcMain.handle('library:openPdf', async (_event, pdfPath) => {
  if (!pdfPath) return;
  const pdfWin = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'PDF Viewer',
    webPreferences: { nodeIntegration: false },
  });
  const fileUrl = 'file://' + pdfPath.replace(/\\/g, '/');
  pdfWin.loadURL(fileUrl);
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select download directory',
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectPdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

// ---------- IPC: Papers (Service Layer) ----------
ipcMain.handle('papers:getSources', async () => {
  return getSourceNames();
});

ipcMain.handle('papers:search', async (_event, { query, sources, limit, sortBy }) => {
  return paperService.searchAndStore(query, sources, limit, sortBy);
});

ipcMain.handle('papers:downloadPdf', async (_event, { url, directory, filename }) => {
  if (!url || !directory) throw new Error('URL and directory are required');

  // Sanitize filename: strip non-filesystem-safe chars, add .pdf
  const safeName = (filename || 'paper')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  const destPath = path.join(directory, `${safeName}.pdf`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Invalid content-type "${contentType}": URL returned HTML instead of PDF`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Magic-byte check: all valid PDF files begin with '%PDF-'
    if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') {
      throw new Error('Downloaded file is not a valid PDF (missing %PDF- header)');
    }

    await fs.writeFile(destPath, buffer);
    return destPath;
  } catch (err) {
    // Clean up partial file
    await fs.unlink(destPath).catch(() => {});
    throw new Error(`Download failed: ${err.message}`);
  }
});

ipcMain.handle('papers:getAll', async (_event, limit) => {
  return paperService.getAllPapers(limit);
});

ipcMain.handle('papers:getById', async (_event, id) => {
  return paperService.getPaperById(id);
});

ipcMain.handle('papers:delete', async (_event, id) => {
  return paperService.deletePaper(id);
});

// ---------- IPC: AI Pipeline ----------
ipcMain.handle('ai:analyzePaper', async (_event, { paper, prompt }) => {
  return aiService.analyzePaper(paper, prompt);
});

ipcMain.handle('ai:processPipeline', async (_event, { papers, prompt }) => {
  return aiPipeline.processPapers(papers, prompt);
});

ipcMain.handle('ai:saveAnalysis', async (_event, { title, content }) => {
  const analysisDir = path.join(app.getPath('userData'), 'analysis');
  await fs.mkdir(analysisDir, { recursive: true });
  
  const safeTitle = title.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 100);
  const filePath = path.join(analysisDir, `${safeTitle}.md`);
  
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
});

// ---------- IPC: Window Management ----------
ipcMain.handle('window:openEditor', () => {
  const editorWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Markdown Editor - Research Intelligence Engine',
  });

  if (isDev) {
    editorWin.loadURL('http://localhost:5173/editor.html');
  } else {
    editorWin.loadFile(path.join(__dirname, 'dist', 'editor.html'));
  }
});

// ---------- IPC: Settings ----------
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const data = await fs.readFile(getSettingsPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

ipcMain.handle('settings:get', async () => {
  const stored = await readSettings();
  return {
    openalexApiKey: stored.openalexApiKey || process.env.OPENALEX_API_KEY || '',
    groqApiKey: stored.groqApiKey || process.env.GROQ_API_KEY || '',
    arxivApiKey: stored.arxivApiKey || '',
  };
});

ipcMain.handle('settings:save', async (_event, settings) => {
  const current = await readSettings();
  const updated = { ...current, ...settings };
  await writeSettings(updated);

  if (updated.openalexApiKey !== undefined) {
    process.env.OPENALEX_API_KEY = updated.openalexApiKey;
  }
  if (updated.groqApiKey !== undefined) {
    process.env.GROQ_API_KEY = updated.groqApiKey;
    if (aiService) aiService.apiKey = updated.groqApiKey;
  }

  return { success: true };
});

app.whenReady().then(async () => {
  try {
    const stored = await readSettings();
    if (stored.openalexApiKey) process.env.OPENALEX_API_KEY = stored.openalexApiKey;
    if (stored.groqApiKey) {
      process.env.GROQ_API_KEY = stored.groqApiKey;
      if (aiService) aiService.apiKey = stored.groqApiKey;
    }
  } catch (err) {
    console.warn('[startup] Failed to load stored settings:', err.message);
  }
  try {
    await initializeDatabase();
  } catch (err) {
    console.warn('[startup] Database init failed:', err.message);
  }
  ensureLibraryDir().catch(() => {});
  registerDocumentIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
