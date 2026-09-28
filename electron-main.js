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
  return paperService.getLibraryPapers();
});

ipcMain.handle('library:addPaper', async (_event, payload) => {
  return paperService.addManualPaper(payload);
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
ipcMain.handle('papers:getWorkspaceConfig', async () => {
  return paperService.getWorkspaceConfig();
});

ipcMain.handle('papers:getSources', async () => {
  return getSourceNames();
});

ipcMain.handle('papers:search', async (_event, { query, sources, limit, sortBy }) => {
  return paperService.searchAndStore(query, sources, limit, sortBy);
});

ipcMain.handle('papers:downloadPdf', async (_event, params) => {
  const payload = typeof params === 'object' && params !== null ? params : {};
  const downloadResult = await paperService.downloadPaperPdf({
    paperId: payload.paperId || null,
    url: payload.url,
    targetDirectory: payload.targetDirectory || payload.directory || null,
    filename: payload.filename,
  });
  return downloadResult.localPath;
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
  const analysisDir = path.join(process.cwd(), 'analysis');
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
  paperService.ensureRawPapersDir().catch(err => {
    console.warn('[startup] Failed to create raw_papers dir:', err.message);
  });
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
