const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  library: {
    getPapers: () => ipcRenderer.invoke('library:getPapers'),
    addPaper: (paper) => ipcRenderer.invoke('library:addPaper', paper),
    openPdf: (pdfPath) => ipcRenderer.invoke('library:openPdf', pdfPath),
    selectPdfFile: () => ipcRenderer.invoke('dialog:selectPdf'),
    selectDownloadDir: () => ipcRenderer.invoke('dialog:selectDirectory'),
  },
  papers: {
    getWorkspaceConfig: () => ipcRenderer.invoke('papers:getWorkspaceConfig'),
    getSources: () => ipcRenderer.invoke('papers:getSources'),
    search: (query, sources, limit, sortBy) => ipcRenderer.invoke('papers:search', { query, sources, limit, sortBy }),
    downloadPdf: (param1, param2, param3) => {
      const payload = (typeof param1 === 'object' && param1 !== null)
        ? param1
        : { url: param1, directory: param2, filename: param3 };
      return ipcRenderer.invoke('papers:downloadPdf', payload);
    },
    getAll: (limit) => ipcRenderer.invoke('papers:getAll', limit),
    getById: (id) => ipcRenderer.invoke('papers:getById', id),
    delete: (id) => ipcRenderer.invoke('papers:delete', id),
  },
  ai: {
    analyzePaper: (paper, prompt) => ipcRenderer.invoke('ai:analyzePaper', { paper, prompt }),
    processPipeline: (papers, prompt) => ipcRenderer.invoke('ai:processPipeline', { papers, prompt }),
    saveAnalysis: (title, content) => ipcRenderer.invoke('ai:saveAnalysis', { title, content }),
  },
  // ---- Document export (Markdown Editor) ----
  document: {
    exportMd:  (content) => ipcRenderer.invoke('document:export-md',  content),
    exportTex: (content) => ipcRenderer.invoke('document:export-tex', content),
    exportPdf: (content) => ipcRenderer.invoke('document:export-pdf', content),
    saveDraft: (content) => ipcRenderer.invoke('document:save-draft', content),
    loadDraft: () => ipcRenderer.invoke('document:load-draft'),
    openMd:    () => ipcRenderer.invoke('document:open-md'),
  },
  // ---- Window Management ----
  window: {
    openEditor: () => ipcRenderer.invoke('window:openEditor')
  },
  // ---- Settings ----
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  }
});
