import { app, BrowserWindow, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startEngine, type EngineHandle } from './engineProcess';
import { registerIpcHandlers } from './ipc/handlers';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const PROD_INDEX = path.join(__dirname, '../dist/index.html');
const PROD_DIST = path.join(__dirname, '../dist');
const APP_ORIGIN = 'avc://bundle/';
const TRUSTED_ORIGINS = DEV_URL ? [DEV_URL] : [APP_ORIGIN];
const ALLOWED_PERMISSIONS = new Set(['media', 'speaker-selection', 'fullscreen']);

let engine: EngineHandle | null = null;

function isTrustedUrl(requestUrl: string) {
  try {
    const requestOrigin = new URL(requestUrl).origin;
    return TRUSTED_ORIGINS.some((origin) => new URL(origin).origin === requestOrigin);
  } catch {
    return false;
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'avc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

async function serveBundledFile(request: Request) {
  const url = new URL(request.url);
  if (url.host !== 'bundle') return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Invalid path', { status: 400 });
  }
  const relativePath = pathname === '/' ? './index.html' : `.${pathname}`;
  const filePath = path.resolve(PROD_DIST, relativePath);
  if (!filePath.startsWith(`${PROD_DIST}${path.sep}`)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(filePath).href);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Avatar Studio',
    backgroundColor: '#090C13',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false, // keep tracking and audio scheduling smooth when the window is not focused
    },
  });

  win.once('ready-to-show', () => win.show());

  // Never open new windows; never navigate away from the app's own origin.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!TRUSTED_ORIGINS.some((origin) => url.startsWith(origin))) event.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL(`${APP_ORIGIN}${path.basename(PROD_INDEX)}`);
}

app.whenReady().then(() => {
  if (!DEV_URL) protocol.handle('avc', serveBundledFile);
  engine = startEngine(path.resolve(__dirname, '..'), app.getPath('userData'));

  // Camera, microphone, output selection and fullscreen are limited to our own pages.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl ?? wc.getURL();
    callback(isTrustedUrl(origin) && ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isTrustedUrl(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission);
  });

  registerIpcHandlers(TRUSTED_ORIGINS, () => ({ baseUrl: engine!.baseUrl, token: engine!.token, dataDir: engine!.dataDir }));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('before-quit', () => engine?.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
