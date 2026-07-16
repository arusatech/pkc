require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
const { contextBridge, ipcRenderer } = require('electron');
const { randomUUID } = require('node:crypto');

contextBridge.exposeInMainWorld('windowControls', {
  close: () => ipcRenderer.invoke('window-close'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
});

/** Real OS downloads under `<tmpdir>/AcharyaAnnadata/` (accessible outside the app). */
contextBridge.exposeInMainWorld('acharyaFs', {
  getRootDir: () => ipcRenderer.invoke('acharya-fs:get-root'),
  exists: (relativePath) => ipcRenderer.invoke('acharya-fs:exists', relativePath),
  stat: (relativePath) => ipcRenderer.invoke('acharya-fs:stat', relativePath),
  readText: (relativePath) => ipcRenderer.invoke('acharya-fs:read-text', relativePath),
  writeText: (relativePath, text) => ipcRenderer.invoke('acharya-fs:write-text', relativePath, text),
  writeBytes: (relativePath, base64) =>
    ipcRenderer.invoke('acharya-fs:write-bytes', relativePath, base64),
  unlink: (relativePath) => ipcRenderer.invoke('acharya-fs:unlink', relativePath),
  downloadUrl: async (url, relativePath, onProgress) => {
    const downloadId = randomUUID();
    const handler = (_event, payload) => {
      if (!payload || payload.downloadId !== downloadId) return;
      onProgress?.({
        loaded: payload.loaded,
        total: payload.total,
        percentage: payload.percentage,
      });
    };
    ipcRenderer.on('acharya-fs:download-progress', handler);
    try {
      return await ipcRenderer.invoke('acharya-fs:download-url', {
        url,
        relativePath,
        downloadId,
      });
    } finally {
      ipcRenderer.removeListener('acharya-fs:download-progress', handler);
    }
  },
});

/** Export destinations: local Save-as + Google Drive / Dropbox OAuth upload. */
contextBridge.exposeInMainWorld('pkcExport', {
  oauthRedirectUri: () => ipcRenderer.invoke('pkc-export:oauth-redirect-uri'),
  saveDialog: (opts) => ipcRenderer.invoke('pkc-export:save-dialog', opts),
  writeAbsolute: (absolutePath, base64) =>
    ipcRenderer.invoke('pkc-export:write-absolute', { absolutePath, base64 }),
  reveal: (absolutePath) => ipcRenderer.invoke('pkc-export:reveal', absolutePath),
  authStatus: (provider) => ipcRenderer.invoke('pkc-export:auth-status', provider),
  signIn: (opts) => ipcRenderer.invoke('pkc-export:sign-in', opts),
  signOut: (provider) => ipcRenderer.invoke('pkc-export:sign-out', provider),
  uploadCloud: (opts) => ipcRenderer.invoke('pkc-export:upload-cloud', opts),
});

// Desktop llama sidecar bridge (annadataLlama / __annadataDesktop).
try {
  require('llama-cpp-pro/desktop/preload')(contextBridge, ipcRenderer);
} catch (err) {
  console.warn('[preload] llama-cpp-pro desktop preload unavailable', err);
}
