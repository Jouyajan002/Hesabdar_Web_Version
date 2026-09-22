/**
 * preload.js — پل ارتباطی امن بین Main process و renderer
 * تمام API های Electron از طریق window.electronAPI در دسترس قرار می‌گیرد
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ----- بک‌آپ محلی -----
    onAutoBackupRequest: (callback) => {
        ipcRenderer.on('request-auto-backup', (event, data) => callback(data));
    },
    saveAutoBackup: (date, data) => {
        ipcRenderer.send('save-auto-backup', { date, data });
    },
    manualBackup: (data) => ipcRenderer.invoke('manual-backup', data),
    openBackupFolder: () => ipcRenderer.invoke('open-backup-folder'),
    listBackups: () => ipcRenderer.invoke('list-backups'),
    restoreBackup: (fileName) => ipcRenderer.invoke('restore-backup', fileName),
    selectImportFile: () => ipcRenderer.invoke('select-import-file'),

    // ----- HTTP fetch (دور زدن CORS) -----
    httpFetchJson: (url) => ipcRenderer.invoke('http-fetch-json', url),

    // ----- ارسال گزارش/فرم به واتساپِ دسکتاپ (فایل واقعیِ PDF) -----
    // HTML گزارش را در Main به PDF واقعی تبدیل، فایل را در کلیپ‌بورد قرار می‌دهد و واتساپِ دسکتاپ
    // را باز می‌کند تا کاربر با انتخابِ مخاطب و Ctrl+V، خودِ فایل را ارسال کند.
    sharePdfToWhatsApp: (html, fileName) => ipcRenderer.invoke('share-pdf-whatsapp', { html, fileName }),

    // ----- Google OAuth -----
    googleSignIn: () => ipcRenderer.invoke('google-oauth-signin'),
    googleRefreshToken: (refreshToken) => ipcRenderer.invoke('google-refresh-token', refreshToken),

    // ----- آپدیت -----
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdateDownloadProgress: (callback) => {
        ipcRenderer.on('update-download-progress', (event, data) => callback(data));
    },
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, data) => callback(data));
    },
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, msg) => callback(msg));
    },
});
