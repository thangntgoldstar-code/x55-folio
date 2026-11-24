const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

app.commandLine.appendSwitch('enable-gamepad-extensions');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('no-sandbox');

const PORT_BASE_DIR = process.env.X55_PORT_DIR || path.resolve(__dirname, '..', '..');
const USER_DATA_DIR = path.join(PORT_BASE_DIR, 'userdata');
try {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  app.setPath('userData', USER_DATA_DIR);
} catch {
  // Fallback to default Electron userData path
}

const STATE_FILE = path.join(app.getPath('userData'), 'library-state.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function resolveBooksRoot() {
  const candidates = [
    process.env.X55_BOOKS_DIR,
    '/storage/roms/books',
    '/roms/books',
    path.join(PORT_BASE_DIR, 'books'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      // Ignore inaccessible mount
    }
  }

  // Create default books directory so users immediately see it over ROCKNIX Wi-Fi SMB
  const fallbackTargets = ['/storage/roms/books', path.join(PORT_BASE_DIR, 'books')];
  for (const target of fallbackTargets) {
    try {
      const parent = path.dirname(target);
      if (fs.existsSync(parent)) {
        fs.mkdirSync(target, { recursive: true });
        return target;
      }
    } catch {
      // Try next fallback
    }
  }
  return path.join(PORT_BASE_DIR, 'books');
}

function makeBookId(filePath) {
  return 'x55_' + crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function stripExt(name) {
  return name.replace(/\.(pdf|epub)$/i, '');
}

function scanDirectory(dirPath, folderId, folderName, outBooks) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && /\.(pdf|epub)$/i.test(entry.name)) {
      try {
        const stat = fs.statSync(fullPath);
        const isPdf = entry.name.toLowerCase().endsWith('.pdf');
        outBooks.push({
          id: makeBookId(fullPath),
          title: stripExt(entry.name),
          author: 'Tác giả trên thẻ nhớ',
          format: isPdf ? 'pdf' : 'epub',
          folderId,
          folderName,
          fileName: entry.name,
          filePath: path.resolve(fullPath),
          fileSize: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Skip unreadable file
      }
    }
  }
}

let activeBooksRoot = resolveBooksRoot();

function scanLibrary() {
  activeBooksRoot = resolveBooksRoot();
  const folders = [];
  const books = [];

  let entries = [];
  try {
    entries = fs.readdirSync(activeBooksRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const rootBooks = [];
  scanDirectory(activeBooksRoot, 'local-root', 'Sách chung', rootBooks);
  if (rootBooks.length > 0) {
    folders.push({ id: 'local-root', name: 'Sách chung' });
    books.push(...rootBooks);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const subDir = path.join(activeBooksRoot, entry.name);
    const folderId = 'local-dir:' + entry.name;
    folders.push({ id: folderId, name: entry.name });
    scanDirectory(subDir, folderId, entry.name, books);
  }

  return {
    booksRoot: activeBooksRoot,
    folders,
    books,
  };
}

function startStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      let relPath = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
      if (relPath.startsWith('/')) relPath = relPath.slice(1);

      let filePath = path.resolve(distDir, relPath);
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function readLinuxBattery() {
  try {
    const base = '/sys/class/power_supply';
    if (!fs.existsSync(base)) return { level: null, charging: false };
    const supplies = fs.readdirSync(base);
    for (const name of supplies) {
      const dir = path.join(base, name);
      const capFile = path.join(dir, 'capacity');
      if (!fs.existsSync(capFile)) continue;
      const cap = parseInt(fs.readFileSync(capFile, 'utf8').trim(), 10);
      if (Number.isNaN(cap)) continue;
      let charging = false;
      const statusFile = path.join(dir, 'status');
      if (fs.existsSync(statusFile)) {
        const st = fs.readFileSync(statusFile, 'utf8').trim().toLowerCase();
        charging = st === 'charging' || st === 'full';
      }
      return { level: Math.max(0, Math.min(100, cap)), charging };
    }
  } catch {
    // Ignore non-Linux sysfs failure
  }
  return { level: null, charging: false };
}

ipcMain.handle('x55:scanLibrary', () => scanLibrary());

ipcMain.handle('x55:readBookBuffer', (_evt, targetPath) => {
  try {
    if (typeof targetPath !== 'string') return null;
    const resolved = path.resolve(targetPath);
    const rootResolved = path.resolve(activeBooksRoot);
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
      return null;
    }
    if (!/\.(pdf|epub)$/i.test(resolved)) return null;
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
});

ipcMain.handle('x55:loadState', () => {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
});

ipcMain.handle('x55:saveState', (_evt, state) => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Ignore disk write failure
  }
});

ipcMain.handle('x55:getBattery', () => readLinuxBattery());
ipcMain.handle('x55:quitApp', () => {
  app.quit();
});

app.whenReady().then(async () => {
  const distDir = path.join(__dirname, 'dist');
  const { server, port } = await startStaticServer(distDir);

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#12100e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL(`http://127.0.0.1:${port}/?x55=1`);

  app.on('will-quit', () => {
    try {
      server.close();
    } catch {
      // Ignore
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
