/**
 * document-ipc.js
 * IPC handlers for document export (md / tex / pdf).
 * Calls document-service only. No business logic here.
 * Import this in electron-main.js to register handlers.
 */

import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import {
  writeTempFile,
  convertToTex,
  convertToPdf,
} from '../../services/document-service.js';

/**
 * Show a save dialog and return chosen path, or null if cancelled.
 */
async function getSavePath(defaultName, filters) {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

export function registerDocumentIpcHandlers() {
  // ---- Export as Markdown ----
  ipcMain.handle('document:export-md', async (_event, content) => {
    const savePath = await getSavePath('document.md', [
      { name: 'Markdown', extensions: ['md', 'markdown'] }
    ]);
    if (!savePath) return { cancelled: true };

    await fs.writeFile(savePath, content, 'utf-8');
    return { success: true, path: savePath };
  });

  // ---- Export as LaTeX ----
  ipcMain.handle('document:export-tex', async (_event, content) => {
    const savePath = await getSavePath('document.tex', [
      { name: 'LaTeX', extensions: ['tex'] }
    ]);
    if (!savePath) return { cancelled: true };

    const tmpMd = await writeTempFile(content);
    try {
      await convertToTex(tmpMd, savePath);
      return { success: true, path: savePath };
    } finally {
      fs.unlink(tmpMd).catch(() => {});
    }
  });

  // ---- Export as PDF ----
  ipcMain.handle('document:export-pdf', async (_event, content) => {
    const savePath = await getSavePath('document.pdf', [
      { name: 'PDF', extensions: ['pdf'] }
    ]);
    if (!savePath) return { cancelled: true };

    const tmpMd = await writeTempFile(content);
    try {
      await convertToPdf(tmpMd, savePath);
      return { success: true, path: savePath };
    } finally {
      fs.unlink(tmpMd).catch(() => {});
    }
  });

  // ---- Draft Persistence ----
  ipcMain.handle('document:save-draft', async (_event, content) => {
    const draftPath = path.join(app.getPath('userData'), 'draft.md');
    await fs.writeFile(draftPath, content, 'utf-8');
    return { success: true };
  });

  ipcMain.handle('document:load-draft', async () => {
    const draftPath = path.join(app.getPath('userData'), 'draft.md');
    try {
      const content = await fs.readFile(draftPath, 'utf-8');
      return { content };
    } catch (e) {
      return { content: null };
    }
  });

  // ---- Open Markdown File ----
  ipcMain.handle('document:open-md', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    
    const content = await fs.readFile(result.filePaths[0], 'utf-8');
    return { success: true, content, path: result.filePaths[0] };
  });
}
