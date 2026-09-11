const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, Notification, dialog, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const { NoteStore } = require('./note-store.cjs');

app.setName('Nest Planner');
const testHeadless = !app.isPackaged && process.env.NEST_TEST_HEADLESS === '1';

// Native smoke tests use a separate local profile and never touch personal data.
if (!app.isPackaged && process.env.NEST_TEST_USER_DATA) {
  const testProfile = process.env.NEST_TEST_USER_DATA;
  if (!path.isAbsolute(testProfile)) throw new Error('NEST_TEST_USER_DATA must be an absolute path.');
  fs.mkdirSync(testProfile, { recursive: true });
  app.setPath('userData', testProfile);
}

let mainWindow = null;
let tray = null;
let quitting = false;
let requestedForeground = false;
let desktopSettings = { alwaysOnTop: false, trayHintSeen: false, noteWindows: Object.create(null) };
let noteStore = null;
const noteWindows = new Map();
const pendingNoteBounds = new WeakMap();
const notifications = new Set();

// A small original sprout icon, encoded as a real PNG without an image dependency.
function makeIcon() {
  const size = 64;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const distance = Math.hypot(x - 31.5, y - 31.5);
      const alpha = Math.round(Math.max(0, Math.min(1, 30.5 - distance)) * 255);
      const leafLeft = ((x - 25) / 10) ** 2 + ((y - 26) / 5.5) ** 2 < 1 && x < 32;
      const leafRight = ((x - 39) / 9) ** 2 + ((y - 20) / 5.5) ** 2 < 1 && x > 30;
      const stem = Math.abs(x - 32) < 2 && y >= 23 && y <= 46;
      const color = leafLeft || leafRight || stem ? [249, 251, 255] : [70, 94, 133];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = alpha;
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type, 'ascii');
    const body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'nest-desktop.json');
}

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const savedNotes = Object.create(null);
    if (saved.noteWindows && typeof saved.noteWindows === 'object' && !Array.isArray(saved.noteWindows)) {
      for (const [id, state] of Object.entries(saved.noteWindows).slice(0, 2000)) {
        if (!state || typeof state !== 'object') continue;
        const bounds = state.bounds;
        savedNotes[id] = { opened: state.opened === true, alwaysOnTop: state.alwaysOnTop === true,
          ...(bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) ? { bounds } : {}) };
      }
    }
    desktopSettings = { alwaysOnTop: saved.alwaysOnTop === true, trayHintSeen: saved.trayHintSeen === true, noteWindows: savedNotes };
  } catch {
    // Missing or damaged window preferences do not affect calendar data.
  }
}

function saveSettings() {
  try {
    const target = settingsPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(desktopSettings), 'utf8');
    fs.renameSync(`${target}.tmp`, target);
  } catch (error) {
    console.warn('Unable to save desktop preferences:', error.message);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (testHeadless) return true;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function secureWindow(window) {
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
}

function loadAppPage(window, query = {}) {
  const devUrl = !app.isPackaged && process.env.NEST_DEV_URL;
  if (devUrl) {
    const address = new URL(devUrl);
    if (!['http:', 'https:'].includes(address.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
      throw new Error('NEST_DEV_URL must use a local development server.');
    }
    for (const [key, value] of Object.entries(query)) address.searchParams.set(key, value);
    return window.loadURL(address.href);
  }
  return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

function trustedSender(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error('This request is not from an application window.');
  if (window === mainWindow) return { window, isMain: true, noteId: undefined };
  for (const [noteId, noteWindow] of noteWindows) {
    if (noteWindow === window) return { window, isMain: false, noteId };
  }
  throw new Error('This request is not from a registered application window.');
}

function broadcastNotes(snapshot) {
  for (const window of [mainWindow, ...noteWindows.values()]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('nest:notes-changed', snapshot);
  }
  const present = new Set(snapshot.notes.map(note => note.id));
  let settingsChanged = false;
  for (const [noteId, window] of noteWindows) {
    if (!present.has(noteId)) {
      if (!window.isDestroyed()) window.close();
      delete desktopSettings.noteWindows[noteId];
      settingsChanged = true;
    }
  }
  for (const noteId of Object.keys(desktopSettings.noteWindows)) {
    if (!present.has(noteId)) { delete desktopSettings.noteWindows[noteId]; settingsChanged = true; }
  }
  if (settingsChanged) saveSettings();
}

function rememberNoteWindow(noteId, window, opened = true) {
  if (window.isDestroyed()) return;
  desktopSettings.noteWindows[noteId] = { bounds: pendingNoteBounds.get(window) || window.getBounds(), opened, alwaysOnTop: window.isAlwaysOnTop() };
}

function visibleNoteBounds(saved) {
  const fallback = screen.getPrimaryDisplay().workArea;
  const candidate = saved || { x: fallback.x + fallback.width - 366 - (noteWindows.size % 5) * 28,
    y: fallback.y + 36 + (noteWindows.size % 5) * 28, width: 340, height: 430 };
  const workArea = screen.getDisplayMatching({ x: Math.round(candidate.x), y: Math.round(candidate.y),
    width: Math.max(1, Math.round(candidate.width)), height: Math.max(1, Math.round(candidate.height)) }).workArea;
  const width = Math.min(workArea.width, Math.max(280, Math.min(960, Math.round(candidate.width))));
  const height = Math.min(workArea.height, Math.max(360, Math.min(1200, Math.round(candidate.height))));
  return { width, height, x: Math.round(Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, candidate.x))),
    y: Math.round(Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, candidate.y))) };
}

function applyRestoredNoteBounds(window, target) {
  const fields = ['x', 'y', 'width', 'height'];
  const [minWidth, minHeight] = window.getMinimumSize();
  const distance = bounds => fields.reduce((sum, field) => sum + Math.abs(bounds[field] - target[field]), 0);
  let command = { ...target };
  window.setBounds(command, false);
  let actual = window.getBounds();
  let best = { command: { ...command }, distance: distance(actual) };
  const seen = new Set([JSON.stringify(command)]);
  // Fractional display scaling can add one DIP even through setBounds. Use at
  // most two correction trials, retaining the best command if rounding oscillates.
  for (let attempt = 0; attempt < 2 && distance(actual) > 0; attempt += 1) {
    const next = Object.fromEntries(fields.map(field => [field, Math.round(command[field] + target[field] - actual[field])]));
    next.width = Math.max(minWidth, next.width);
    next.height = Math.max(minHeight, next.height);
    const key = JSON.stringify(next);
    if (seen.has(key)) break;
    seen.add(key);
    command = next;
    window.setBounds(command, false);
    actual = window.getBounds();
    const error = distance(actual);
    if (error < best.distance) best = { command: { ...command }, distance: error };
  }
  if (distance(actual) > best.distance) window.setBounds(best.command, false);
}

async function openNote(noteId, { restore = false } = {}) {
  if (typeof noteId !== 'string' || !noteStore.has(noteId)) return { ok: false, reason: '这张便签已不存在。' };
  const existing = noteWindows.get(noteId);
  if (existing && !existing.isDestroyed()) {
    if (!testHeadless) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
    return { ok: true };
  }
  if (noteWindows.size >= 30) return { ok: false, reason: '最多同时打开 30 张桌面便签，请先收起几张。' };
  const state = desktopSettings.noteWindows[noteId] || {};
  const targetBounds = visibleNoteBounds(state.bounds);
  const acrylic = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
  const window = new BrowserWindow({
    title: '栖时 · 桌面便签', ...targetBounds, minWidth: 280, minHeight: 360,
    frame: false, resizable: true, movable: true, maximizable: false, fullscreenable: false,
    show: false, skipTaskbar: false, autoHideMenuBar: true, hasShadow: true,
    // Native acrylic stays resizable; a translucent CSS surface keeps text readable.
    transparent: false, backgroundColor: acrylic ? '#00000000' : '#f2f5fb',
    ...(acrylic ? { backgroundMaterial: 'acrylic' } : {}),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    icon: makeIcon(), alwaysOnTop: state.alwaysOnTop === true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false },
  });
  // On scaled Windows displays, frameless constructor dimensions include a
  // different non-client rounding path. Reapply saved outer bounds after paint,
  // and never persist those temporary constructor dimensions.
  pendingNoteBounds.set(window, targetBounds);
  let geometryReady = false;
  const readyToShow = new Promise(resolve => {
    window.once('ready-to-show', () => resolve(true));
    window.once('closed', () => resolve(false));
  });
  noteWindows.set(noteId, window);
  secureWindow(window);
  let saveTimer;
  const remember = () => { if (!geometryReady) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    if (!window.isDestroyed()) { rememberNoteWindow(noteId, window); saveSettings(); }
  }, 180); };
  window.on('move', remember);
  window.on('resize', remember);
  window.on('close', () => {
    clearTimeout(saveTimer);
    rememberNoteWindow(noteId, window, quitting);
    saveSettings();
  });
  window.on('closed', () => { clearTimeout(saveTimer); if (noteWindows.get(noteId) === window) noteWindows.delete(noteId); });
  window.on('query-session-end', () => { quitting = true; rememberNoteWindow(noteId, window); saveSettings(); });
  window.on('session-end', () => { quitting = true; });
  try {
    await loadAppPage(window, { note: noteId });
    if (!(await readyToShow) || window.isDestroyed()) return { ok: false, reason: '便签窗口已关闭。' };
    applyRestoredNoteBounds(window, targetBounds);
    geometryReady = true;
    pendingNoteBounds.delete(window);
    rememberNoteWindow(noteId, window);
    saveSettings();
    if (!testHeadless) {
      if (restore) window.showInactive(); else { window.show(); window.focus(); }
    }
    return { ok: true };
  } catch (error) {
    if (!window.isDestroyed()) window.close();
    return { ok: false, reason: `桌面便签暂时无法打开：${error.message}` };
  }
}

function autoLaunchState() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return { supported: false, enabled: false, reason: '开机启动仅在 Windows 桌面发布版中可用。' };
  }
  try {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const settings = app.getLoginItemSettings({ path: executable, args: ['--background'] });
    return { supported: true, enabled: settings.openAtLogin };
  } catch {
    return { supported: false, enabled: false, reason: '暂时无法读取 Windows 的开机启动设置。' };
  }
}

function installBridge() {
  const handle = (channel, callback, allWindows = false) => ipcMain.handle(channel, (event, ...args) => {
    const context = trustedSender(event);
    if (!allWindows && !context.isMain) throw new Error('This operation is only available in the main application window.');
    return callback(context, ...args);
  });
  handle('nest:version', () => app.getVersion(), true);
  handle('nest:show-window', showWindow, true);
  handle('nest:get-always-on-top', () => mainWindow.isAlwaysOnTop());
  handle('nest:set-always-on-top', (_context, enabled) => {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
    mainWindow.setAlwaysOnTop(enabled);
    desktopSettings.alwaysOnTop = mainWindow.isAlwaysOnTop();
    saveSettings();
    return desktopSettings.alwaysOnTop;
  });
  handle('nest:get-auto-launch', autoLaunchState);
  handle('nest:set-auto-launch', (_context, enabled) => {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
    const current = autoLaunchState();
    if (!current.supported) return current;
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
        args: ['--background'],
      });
      const result = autoLaunchState();
      if (result.enabled !== enabled) return { ...result, reason: 'Windows 未应用设置，请检查系统的启动应用列表。' };
      return result;
    } catch {
      return { ...current, reason: '无法更新开机启动设置，请检查 Windows 的应用权限。' };
    }
  });
  handle('nest:notify', (_context, title, body) => {
    if (typeof title !== 'string' || typeof body !== 'string') return { ok: false, reason: '通知内容格式不正确。' };
    if (testHeadless) return { ok: true, testMode: true };
    if (!Notification.isSupported()) return { ok: false, reason: '当前系统不支持桌面通知。' };
    return new Promise((resolve) => {
      let settled = false;
      let notification;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => finish({ ok: false, reason: '系统未确认通知已显示，请检查 Windows 通知设置。' }), 4000);
      try {
        notification = new Notification({ title: title.slice(0, 120), body: body.slice(0, 1000), icon: makeIcon() });
        notifications.add(notification);
        notification.once('show', () => finish({ ok: true }));
        notification.once('failed', () => {
          notifications.delete(notification);
          finish({ ok: false, reason: '桌面通知未能显示，请检查 Windows 通知设置。' });
        });
        notification.once('click', showWindow);
        notification.once('close', () => notifications.delete(notification));
        const cleanup = setTimeout(() => notifications.delete(notification), 60000);
        cleanup.unref();
        notification.show();
      } catch {
        if (notification) notifications.delete(notification);
        finish({ ok: false, reason: '桌面通知暂时不可用。' });
      }
    });
  });

  ipcMain.on('nest:notes-initialize', (event, initialNotes) => {
    try {
      const context = trustedSender(event);
      const before = noteStore.initialized;
      const snapshot = context.isMain ? noteStore.initialize(initialNotes) : noteStore.list();
      event.returnValue = snapshot;
      if (!before && noteStore.initialized) broadcastNotes(snapshot);
    } catch (error) { event.returnValue = { __nestError: error.message }; }
  });
  handle('nest:notes-list', () => noteStore.list(), true);
  handle('nest:notes-mutate', (context, request) => {
    const snapshot = noteStore.mutate(request, context.isMain ? {} : { noteId: context.noteId });
    broadcastNotes(snapshot);
    return snapshot;
  }, true);
  handle('nest:open-note', (context, noteId) => {
    if (!context.isMain && context.noteId !== noteId) return { ok: false, reason: '请从主窗口打开其他便签。' };
    return openNote(noteId);
  }, true);
  handle('nest:close-note', context => {
    if (context.isMain) throw new Error('只有桌面便签可以关闭自身窗口。');
    // Reply before destroying the sender so ipcRenderer.invoke can settle.
    setImmediate(() => { if (!context.window.isDestroyed()) context.window.close(); });
  }, true);
  handle('nest:get-note-always-on-top', context => {
    if (context.isMain) throw new Error('这项设置只适用于桌面便签。');
    return context.window.isAlwaysOnTop();
  }, true);
  handle('nest:set-note-always-on-top', (context, enabled) => {
    if (context.isMain) throw new Error('这项设置只适用于桌面便签。');
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
    context.window.setAlwaysOnTop(enabled);
    rememberNoteWindow(context.noteId, context.window);
    saveSettings();
    return context.window.isAlwaysOnTop();
  }, true);
  handle('nest:show-main', () => { showWindow(); }, true);
}

function createWindow() {
  const windowsGlass = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
  const window = new BrowserWindow({
    title: '栖时 · Nest',
    width: 1500, height: 980, minWidth: 1050, minHeight: 720,
    backgroundColor: '#ffffff', show: false, autoHideMenuBar: true,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#303642', height: 52 } } : {}),
    ...(windowsGlass ? { backgroundMaterial: 'mica' } : {}),
    icon: makeIcon(), alwaysOnTop: desktopSettings.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  secureWindow(window);
  window.once('ready-to-show', () => {
    if (!tray || requestedForeground || !process.argv.includes('--background')) showWindow();
  });
  window.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    if (testHeadless) { window.hide(); return; }
    if (!desktopSettings.trayHintSeen) {
      desktopSettings.trayHintSeen = true;
      saveSettings();
      void dialog.showMessageBox(window, {
        type: 'info', title: '栖时会在托盘陪着你',
        message: '关闭窗口后，栖时会继续在系统托盘运行。',
        detail: '专注倒计时会继续。点击托盘中的绿色小树可以回来；右键选择「退出栖时」才会完全退出。',
        buttons: ['知道了'], defaultId: 0,
      }).then(() => { if (!window.isDestroyed() && !quitting) window.hide(); });
    } else {
      window.hide();
    }
  });
  window.on('query-session-end', () => { quitting = true; });
  window.on('session-end', () => { quitting = true; });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });

  void loadAppPage(window).catch((error) => {
    if (testHeadless) console.error('Unable to load the application:', error.message);
    else dialog.showErrorBox('栖时暂时无法打开', `请重新启动应用。开发环境请先构建页面。\n\n${error.message}`);
    app.quit();
  });
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    requestedForeground = true;
    if (app.isReady()) showWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
    for (const [noteId, window] of noteWindows) rememberNoteWindow(noteId, window);
    saveSettings();
  });
  app.on('will-quit', () => {
    if (tray) { tray.destroy(); tray = null; }
    notifications.clear();
  });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('activate', () => { if (app.isReady()) showWindow(); });
  void app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('local.nest.planner');
    readSettings();
    noteStore = new NoteStore(path.join(app.getPath('userData'), 'notes.json'));
    installBridge();
    try {
      tray = new Tray(makeIcon());
      tray.setToolTip('栖时 · Nest');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开栖时', click: showWindow },
        { type: 'separator' },
        { label: '退出栖时', click: () => app.quit() },
      ]));
      tray.on('click', showWindow);
      tray.on('double-click', showWindow);
    } catch (error) {
      console.warn('System tray is unavailable:', error.message);
    }
    createWindow();
    for (const [noteId, state] of Object.entries(desktopSettings.noteWindows)) {
      if (state.opened) void openNote(noteId, { restore: true }).catch(error => console.warn('Unable to restore desktop note:', error.message));
    }
  }).catch((error) => {
    if (testHeadless) console.error('Unable to start the application:', error.message);
    else dialog.showErrorBox('栖时启动失败', error.message);
    app.quit();
  });
}

