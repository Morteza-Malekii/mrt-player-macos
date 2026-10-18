import { app, BrowserWindow, ipcMain, powerSaveBlocker, protocol, safeStorage, session, shell, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { Session, type Vault } from '../../runtime/session';
import { FileLibraryStore, atomicWrite, exists, remove } from '../../runtime/storage';
import { AppError } from '../../core/errors';
import { MediaGateway } from './media';
import { ImageGateway } from './images';
import { DownloadManager } from './downloads';
import { RecordingManager } from './recordings';
import type { Action, Credentials } from '../../core/models';

protocol.registerSchemesAsPrivileged([{ scheme: 'kiyi', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
class MacVault implements Vault {
  constructor(private file: string) {}
  exists() { return exists(this.file); }
  clear() { return remove(this.file); }
  async save(credentials: Credentials) {
    if (!safeStorage.isEncryptionAvailable()) throw new AppError('KEYCHAIN', 'macOS Anahtar Zinciri kullanılamıyor. Kaydetmeden giriş yapabilirsiniz.');
    await atomicWrite(this.file, safeStorage.encryptString(JSON.stringify(credentials)));
  }
  async load(): Promise<Credentials> {
    try { return JSON.parse(safeStorage.decryptString(await promisify(fs.readFile)(this.file))); }
    catch { throw new AppError('KEYCHAIN', 'Güvenli kayıt açılamadı. Anahtar Zinciri erişimini kontrol edin veya tekrar giriş yapın.'); }
  }
}
let window: BrowserWindow | null = null;
app.setName('MRT-Player');
// Reuse the previous profile when upgrading so saved accounts and preferences remain available.
const previousData = path.join(app.getPath('appData'), 'Kıyı Player');
if (fs.existsSync(previousData)) app.setPath('userData', previousData);
// Automated release validation uses a disposable profile path; no credentials are passed in env.
if (process.env.KIYI_TEST_MODE === '1' && process.env.KIYI_TEST_DATA && path.isAbsolute(process.env.KIYI_TEST_DATA)) app.setPath('userData', process.env.KIYI_TEST_DATA);
app.whenReady().then(async () => {
  const gateway = new MediaGateway(), images = new ImageGateway(), data = app.getPath('userData');
  const downloadsFolder = () => process.env.KIYI_TEST_MODE === '1' && process.env.KIYI_TEST_DOWNLOADS && path.isAbsolute(process.env.KIYI_TEST_DOWNLOADS) ? process.env.KIYI_TEST_DOWNLOADS : path.join(app.getPath('downloads'), 'MRT-Player');
  const downloads = new DownloadManager(downloadsFolder, file => shell.showItemInFolder(file), file => shell.trashItem(file), path.join(data, 'downloads.json'));
  // The MP4 converter ships next to the app (scripts/build.mjs copies it); inside a packaged app it sits
  // beside the archive, not in it, because a program cannot run from inside an asar file.
  let blocker = -1;
  const recordings = new RecordingManager({
    folder: downloadsFolder, index: path.join(data, 'recordings.json'), downloads, show: file => shell.showItemInFolder(file),
    ffmpeg: path.join(__dirname, 'ffmpeg').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
    // A recording needs the Mac awake; this keeps it from being suspended while one runs or is planned.
    keepAwake: on => { if (on && blocker < 0) blocker = powerSaveBlocker.start('prevent-app-suspension'); else if (!on && blocker >= 0) { powerSaveBlocker.stop(blocker); blocker = -1; } },
    tickMs: process.env.KIYI_TEST_MODE === '1' ? 500 : 5000
  });
  app.on('before-quit', () => recordings.shutdown());
  const runtime = new Session(new MacVault(path.join(data, 'account.enc')), new FileLibraryStore(data), 'mac', gateway.add, gateway.clear, gateway.stats, gateway.useLimit, downloads, recordings);
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: kiyi:; media-src kiyi: blob:; connect-src kiyi:; worker-src blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
  protocol.handle('kiyi', async request => {
    const url = new URL(request.url);
    if (url.host === 'media') return gateway.handle(request);
    if (url.host === 'local') return downloads.serve(request);
    if (url.host === 'image') return images.handle(request, runtime.posterUrl);
    if (url.host !== 'app') return new Response(null, { status: 404 });
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'app.js', 'app.css'].includes(name)) return new Response(null, { status: 404 });
    try {
      return new Response(await promisify(fs.readFile)(path.join(__dirname, 'app', name)), { headers: { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript', 'Content-Security-Policy': csp } });
    } catch { return new Response(null, { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle('kiyi:call', (event, action: Action, payload?: unknown) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).host !== 'app') return { ok: false, error: { code: 'DENIED', message: 'Erişim reddedildi.' } };
    return runtime.call(action, payload);
  });
  const create = () => {
    // A player keeps decoding while it sits behind another window or on a second display, so
    // the renderer must not be throttled the way a background page would be. AudioVideoTracks is
    // what lets the page list and switch the dubs inside a film; Chromium keeps it off by default.
    window = new BrowserWindow({ width: 1360, height: 900, minWidth: 960, minHeight: 650, backgroundColor: '#0c111b', title: 'MRT-Player', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false, enableBlinkFeatures: 'AudioVideoTracks' } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', e => e.preventDefault());
    window.on('closed', () => { window = null; void runtime.call('logout'); });
    void window.loadURL('kiyi://app/index.html');
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'MRT-Player', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }, { label: 'Düzen', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }, { label: 'Pencere', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }] }]));
  create(); app.on('activate', () => { if (!window) create(); });
});
app.on('window-all-closed', () => app.quit());
