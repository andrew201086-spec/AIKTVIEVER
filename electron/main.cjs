'use strict';

const { app, BrowserWindow, protocol, shell, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const isDev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL;

/**
 * Cross-origin isolation, without a listening socket.
 *
 * The decoding workers write straight into the volume buffer when
 * SharedArrayBuffer is available, and the browser hands that out only to a
 * cross-origin isolated page — which needs COOP and COEP on the document. A
 * file:// page cannot carry headers at all (and blocks ES modules besides), so
 * the built files are served over a scheme of our own that can.
 *
 * The alternative, a local HTTP server, would open a port on the machine. This
 * program's promise is that the scan never leaves the computer, and a scheme
 * handler keeps that literally true: nothing is listening.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Same-origin subresources still have to opt in, or COEP blocks them.
  'Cross-Origin-Resource-Policy': 'same-origin',
  /**
   * Nothing here comes from the network, and this says so: the program can
   * load only what shipped inside it, plus the blob and data URLs it makes
   * itself — decoding workers, the WASM codecs, canvas snapshots, the STL and
   * PNG it hands back. 'wasm-unsafe-eval' is what compiling those codecs
   * needs; plain 'unsafe-eval' stays out.
   */
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "object-src 'none'",
    "frame-src 'none'",
  ].join('; '),
};

function serveDist() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);

    // Anything that is not a file in dist is the single-page app itself.
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || !path.extname(relative)) relative = 'index.html';

    // Never let a crafted path climb out of dist.
    const target = path.join(DIST, relative);
    if (!target.startsWith(DIST + path.sep) && target !== DIST) {
      return new Response('Not found', { status: 404 });
    }

    const response = await net.fetch(pathToFileURL(target).toString());
    if (!response.ok) return response;

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(ISOLATION)) headers.set(key, value);
    return new Response(response.body, { status: 200, headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Просмотр КЛКТ',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // The viewer is plain web code and asks the operating system for
      // nothing — no preload script, no bridge to widen.
      sandbox: true,
    },
  });

  // A dark window that paints white while the volume engine starts is worse
  // than a moment of nothing.
  win.once('ready-to-show', () => win.show());

  // Links to anything outside the program open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadURL('app://viewer/index.html');
  }

  return win;
}

app.whenReady().then(() => {
  serveDist();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
