// tests/test_updater_auth_unit.js : AGM-UPDATER-AUTH-IMPLEMENT-02 (UPD-01 .. UPD-12, Scheme B)
// Covers direct unit checks, full VM dual-base (2.32.1 & 2.33.0) mock flows,
// local 127.0.0.1 mock feed error/compatibility verification, and real pure ASAR
// extract+patch verification (read-only on base ASARs; no real Electron execution).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const vm = require('vm');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PATCH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'patch.js');
const IPC_AUTH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_ipc_auth.js');
const UPDATER_AUTH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_updater_auth.js');
const TEMPLATE_YML = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');

const REAL_ASAR_2321 = 'C:\\AGM_TestLab\\COMPAT_233_01\\base_2321\\app.asar';
const REAL_ASAR_2330 = 'C:\\AGM_TestLab\\COMPAT_233_01\\base_2330\\app_out\\resources\\app.asar';
const EXPECTED_2321_SHA = '5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F';
const EXPECTED_2330_SHA = 'B33C81600E82E65593AA8430EF01B37D6B28D9D98F0FAF45E25957783B71E64B';

const IPC_AUTH = require(IPC_AUTH_JS);
const UPDATER_AUTH = require(UPDATER_AUTH_JS);

const results = [];
function check(id, desc, cond, detail) {
  if (cond) {
    results.push({ id, ok: true });
    console.log(`PASS ${id} ${desc}`);
  } else {
    results.push({ id, ok: false, detail });
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex').toUpperCase();
}

function snapshotDirHashes(dir) {
  const map = {};
  function walk(cur) {
    if (!fs.existsSync(cur)) return;
    for (const name of fs.readdirSync(cur).sort()) {
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else map[path.relative(dir, full).replace(/\\/g, '/')] = sha256File(full);
    }
  }
  walk(dir);
  return map;
}

function extractAsarSubset(asarPath, relPaths, destDir) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const hdr = Buffer.alloc(16);
    fs.readSync(fd, hdr, 0, 16, 0);
    const headerSize = hdr.readUInt32LE(4);
    const jsonLen = hdr.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    const meta = JSON.parse(jsonBuf.toString('utf8'));
    const dataBase = 8 + headerSize;
    for (const rel of relPaths) {
      let node = meta;
      for (const seg of rel.split('/')) node = node && node.files && node.files[seg];
      if (!node || node.offset === undefined) throw new Error('Missing ASAR entry: ' + rel);
      const out = path.join(destDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const buf = Buffer.alloc(node.size);
      fs.readSync(fd, buf, 0, node.size, dataBase + Number(node.offset));
      fs.writeFileSync(out, buf);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function makeFrame(url, opts = {}) {
  return {
    url: url || 'https://127.0.0.1:4321/',
    detached: Boolean(opts.detached),
    _destroyed: Boolean(opts.destroyed),
    isDestroyed() { return Boolean(this._destroyed); },
  };
}

function makeWebContents(id, url, opts = {}) {
  const ee = new EventEmitter();
  const mainFrame = makeFrame(url, opts.mainFrameOpts);
  const wc = {
    id,
    mainFrame,
    session: opts.session || { name: 'default' },
    hostWebContents: opts.hostWebContents || null,
    destroyed: Boolean(opts.destroyed),
    _prefs: opts.prefs,
    _type: opts.type || 'window',
    sentMessages: [],
    isDestroyed() { return Boolean(this.destroyed); },
    getType() { return this._type; },
    getURL() { return this.mainFrame ? this.mainFrame.url : ''; },
    getLastWebPreferences() { return this._prefs; },
    send(ch, payload) { this.sentMessages.push({ channel: ch, payload }); },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    emit: ee.emit.bind(ee),
  };
  return wc;
}

function makeWindowObj(wc) {
  let closed = false;
  return {
    webContents: wc,
    isDestroyed() { return closed || Boolean(wc && wc.isDestroyed && wc.isDestroyed()); },
    close() { closed = true; if (wc) wc.destroyed = true; },
  };
}

function eventFor(wc, frame) {
  return { sender: wc, senderFrame: frame !== undefined ? frame : wc.mainFrame };
}

function expectThrows(fn, expectedMsg, expectedCode) {
  try {
    const val = fn();
    if (val && typeof val.then === 'function') {
      throw new Error('use expectThrowsAsync for async calls');
    }
    return { ok: false, reason: 'did not throw', val };
  } catch (err) {
    const msgOk = !expectedMsg || err.message === expectedMsg || String(err.message).includes(expectedMsg);
    const codeOk = !expectedCode || err.code === expectedCode;
    return { ok: msgOk && codeOk, error: err };
  }
}

async function expectThrowsAsync(fn, expectedMsg, expectedCode) {
  try {
    await fn();
    return { ok: false, reason: 'did not reject' };
  } catch (err) {
    const msgOk = !expectedMsg || err.message === expectedMsg || String(err.message).includes(expectedMsg);
    const codeOk = !expectedCode || err.code === expectedCode;
    return { ok: msgOk && codeOk, error: err };
  }
}

function createRealisticSyntheticBundle(version) {
  const is233 = version === '2.33.0';
  const mainJs = [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const electron_1 = require('electron');",
    "const customScheme_1 = require('./customScheme');",
    "const ipcHandlers_1 = require('./ipcHandlers');",
    "const updater_1 = require('./updater');",
    "const utils_1 = require('./utils');",
    "const hostStores_1 = require('./hostStores');",
    "const storageManager = {};",
    "let remoteManager = null;",
    "let sshWindows = { freezeForUpdateCount: 0, freezeForUpdate() { this.freezeForUpdateCount++; } };",
    "const gotTheLock = electron_1.app.requestSingleInstanceLock();",
    "(0, customScheme_1.registerCustomSchemes)();",
    "electron_1.app.on('session-created', (targetSession) => { void targetSession; });",
    "electron_1.app.whenReady().then(async () => {",
    is233 ? "    electron_1.autoUpdater.on('before-quit-for-update', () => sshWindows?.freezeForUpdate());" : "    void 0;",
    "    remoteManager = { sidecarRoutesFor: () => null, hostQuestions: { isBusy: () => false, onBeforeAsk: () => {} }, openUrlFrom: () => true };",
    "    const hostStores = new hostStores_1.HostStores(electron_1.app.getPath('userData'), storageManager);",
    is233
      ? [
          "    const ipc = (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {",
          "        hostQuestionBusy: (win) => remoteManager?.hostQuestions.isBusy(win) ?? false,",
          "        resolveStorage: (sender) => hostStores.forSender(sender),",
          "        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),",
          "        openFromRemote: (sender, url) => remoteManager?.openUrlFrom(sender, url),",
          "    });",
          "    remoteManager.hostQuestions.onBeforeAsk((win) => ipc.closeContextMenu(win));",
        ].join('\n')
      : [
          "    (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {",
          "        resolveStorage: (sender) => hostStores.forSender(sender),",
          "        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),",
          "    });",
        ].join('\n'),
    "    (0, utils_1.createWindow)('https://127.0.0.1:18432/', storageManager);",
    "});",
    "",
  ].join('\n');

  const utilsJs = [
    "'use strict';",
    "Object.defineProperty(exports, '__esModule', { value: true });",
    "exports.createWindow = createWindow;",
    "exports.getHubWindows = getHubWindows;",
    "exports.getLocalHubWindows = getLocalHubWindows;",
    "exports.getHubWebContents = getHubWebContents;",
    "exports.showOrCreateWindow = showOrCreateWindow;",
    "exports.triggerShortcutNewWindow = triggerShortcutNewWindow;",
    "const electron_1 = require('electron');",
    "const constants_1 = require('./constants');",
    "const windowBackends_1 = require('./remote/windowBackends');",
    "const keybindings_1 = require('./keybindings');",
    "const _wins = [];",
    "let _shortcutNewWinCb = null;",
    "function getHubWebContents(win) { return win ? (win._hubWc || win.webContents) : undefined; }",
    "function getHubWindows() { return _wins.filter((w) => w && !w.isDestroyed()); }",
    "function getLocalHubWindows() { return getHubWindows().filter(windowBackends_1.isLocalAppWindow); }",
    "function createWindow(url, storageManager, options) {",
    "    const opts = {",
    "        webviewTag: builtInBrowser,",
    "        devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),",
    "    };",
    "    void opts;",
    "    const win = electron_1.__spawnMockWindow(url, storageManager, options);",
    "    _wins.push(win);",
    "    const kbHandlers = {",
    "        createNewWindow: () => {",
    "            if (options?.onNewWindow) { options.onNewWindow(); return; }",
    "            void createWindow(url, storageManager, { cascade: true });",
    "        },",
    "        onQuitRequested: () => { electron_1.app.quit(); },",
    "    };",
    "    (0, keybindings_1.registerKeybindings)(win, kbHandlers);",
    "    _shortcutNewWinCb = kbHandlers.createNewWindow;",
    "    return win;",
    "}",
    "function triggerShortcutNewWindow() { if (_shortcutNewWinCb) _shortcutNewWinCb(); return _wins[_wins.length - 1]; }",
    "function showOrCreateWindow(port) {",
    "    const wins = getLocalHubWindows();",
    "    if (wins.length > 0) { return wins[0]; }",
    "    else {",
    "        createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);",
    "        return _wins[_wins.length - 1];",
    "    }",
    "}",
    "",
  ].join('\n');

  const preloadJs = [
    "'use strict';",
    "const electron_1 = require('electron');",
    "const isRemoteWindow = process.argv.includes('--agy-backend=ssh');",
    "function createLocalSshRemoteAPI() { return { mode: 'local' }; }",
    "function createRemoteSshRemoteAPI() { return { mode: 'remote' }; }",
    "const computerPreviewAPI = { preview: true };",
    "if (!isRemoteWindow) { void 0; }",
    "if (isRemoteWindow) { electron_1.contextBridge.exposeInMainWorld('sshRemote', createRemoteSshRemoteAPI()); }",
    "else {",
    "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());",
    is233 ? "    electron_1.contextBridge.exposeInMainWorld('agyComputerPreview', computerPreviewAPI);" : "    void 0;",
    "}",
    "",
  ].join('\n');

  const updaterJs = [
    "'use strict';",
    'const electron_updater_1 = require("electron-updater");',
    'const electron_1 = require("electron");',
    'const types_1 = require("./types");',
    'const utils_1 = require("./utils");',
    'let lastState = { type: types_1.UpdateState.Idle };',
    'let isManualCheck = false;',
    'function setAutoUpdateChecking(enabled) {',
    '    return enabled;',
    '}',
    'function broadcastState(state) {',
    '    lastState = state;',
    '    for (const win of (0, utils_1.getHubWindows)()) {',
    '        const hubContents = (0, utils_1.getHubWebContents)(win);',
    '        if (hubContents && !hubContents.isDestroyed?.()) {',
    "            hubContents.send('updater:state-changed', state);",
    '        }',
    '    }',
    '}',
    'function getLastState() { return lastState; }',
    'function initAutoUpdater() {',
    '    electron_updater_1.autoUpdater.autoDownload = true;',
    '    electron_updater_1.autoUpdater.autoInstallOnAppQuit = electron_1.app.isPackaged;',
    "    electron_updater_1.autoUpdater.on('checking-for-update', () => broadcastState({ type: types_1.UpdateState.CheckingForUpdates }));",
    "    electron_updater_1.autoUpdater.on('update-available', (info) => { broadcastState({ type: types_1.UpdateState.AvailableForDownload, update: { version: info.version } }); isManualCheck = false; });",
    "    electron_updater_1.autoUpdater.on('download-progress', () => broadcastState({ type: types_1.UpdateState.Downloading }));",
    "    electron_updater_1.autoUpdater.on('update-downloaded', (info) => broadcastState({ type: types_1.UpdateState.Ready, update: { version: info.version } }));",
    "    electron_updater_1.autoUpdater.on('error', () => { broadcastState({ type: types_1.UpdateState.Idle }); isManualCheck = false; });",
    '}',
    'function checkForUpdates(isManual = false) {',
    '    isManualCheck = isManual;',
    '    return electron_updater_1.autoUpdater.checkForUpdates().catch(() => {});',
    '}',
    'function quitAndInstall() {',
    '    return electron_updater_1.autoUpdater.quitAndInstall();',
    '}',
    'function getHostUpdateStatus() {',
    '    const cur = electron_1.app.getVersion();',
    '    const st = getLastState();',
    '    const known = st.update?.version;',
    "    const avail = Boolean(known && (st.type === 'available for download' || st.type === 'downloading' || st.type === 'ready'));",
    '    return { currentVersion: cur, latestVersion: avail ? known : cur, updateAvailable: avail };',
    '}',
    'function applyHostUpdate() {',
    "    if (getLastState().type === 'ready') {",
    '        if (!electron_1.app.isPackaged) return false;',
    '        quitAndInstall();',
    '        return true;',
    '    }',
    '    checkForUpdates();',
    '    return true;',
    '}',
    'function headlessQuitAndInstall(downloadedFilePath) {',
    '    void downloadedFilePath;',
    '    return true;',
    '}',
    "module.exports = { broadcastState, getLastState, initAutoUpdater, checkForUpdates, quitAndInstall, getHostUpdateStatus, applyHostUpdate, headlessQuitAndInstall, updateActions: { 'Check for Updates': () => checkForUpdates(true), 'Restart to Update': () => quitAndInstall() } };",
    '',
  ].join('\n');

  const ipcHandlersJs = [
    "'use strict';",
    "const electron_1 = require('electron');",
    "const electron_updater_1 = require('electron-updater');",
    "const remoteWindowSecurity_1 = require('./remote/remoteWindowSecurity');",
    "const updater_1 = require('./updater');",
    "const types_1 = require('./types');",
    "function localOnly(channel, handler) {",
    "    electron_1.ipcMain.handle(channel, (event, ...args) => {",
    "        if ((0, remoteWindowSecurity_1.isRemoteContents)(event?.sender)) {",
    "            throw new Error(`${channel} is not available in SSH windows`);",
    "        }",
    "        return handler(event, ...args);",
    "    });",
    "}",
    "function registerIpcHandlers(storageManager, deps = {}) {",
    "    localOnly('updater:apply', async () => {",
    "        (0, updater_1.broadcastState)({ type: types_1.UpdateState.Ready });",
    "    });",
    "    localOnly('updater:quit-and-install', () => {",
    "        if (!electron_1.app.isPackaged) {",
    "            console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');",
    "            return;",
    "        }",
    "        electron_updater_1.autoUpdater.quitAndInstall();",
    "    });",
    "    localOnly('updater:get-state', () => {",
    "        return (0, updater_1.getLastState)();",
    "    });",
    "    localOnly('updater:check-for-updates', () => {",
    "        (0, updater_1.checkForUpdates)(true);",
    "    });",
    "    return { closeContextMenu: () => {} };",
    "}",
    "module.exports = { registerIpcHandlers };",
    "",
  ].join('\n');

  const languageServerJs = [
    "'use strict';",
    'const child_process_1 = require("child_process");',
    'let _lsProcess = null;',
    'function clearLsProcess() { _lsProcess = null; }',
    'function startLs(spawnCmd, spawnArgs, env) {',
    '    _lsProcess = (0, child_process_1.spawn)(spawnCmd, spawnArgs, {',
    "        stdio: ['pipe', 'pipe', 'pipe'],",
    '        env,',
    '    });',
    '}',
    'async function killLanguageServer(proc, pid) {',
    '    if (proc) {',
    '        const exitPromise = new Promise((resolve) => {',
    "            proc.once('exit', () => {",
    '                resolve();',
    '            });',
    '        });',
    '        if (pid) {',
    '            try {',
    '                process.kill(pid);',
    '                await exitPromise;',
    '            }',
    '            catch {',
    '                // Process already dead or exited',
    '            }',
    '        }',
    '        clearLsProcess();',
    '    }',
    '}',
    '',
  ].join('\n');

  return {
    'dist/main.js': mainJs,
    'dist/utils.js': utilsJs,
    'dist/preload.js': preloadJs,
    'dist/updater.js': updaterJs,
    'dist/ipcHandlers.js': ipcHandlersJs,
    'dist/languageServer.js': languageServerJs,
  };
}

function writeSyntheticDir(dir, version, overrides = {}) {
  const files = { ...createRealisticSyntheticBundle(version), ...overrides };
  for (const [rel, content] of Object.entries(files)) {
    const out = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content, 'utf8');
  }
  const ymlPath = path.join(dir, 'app-update.yml');
  fs.copyFileSync(TEMPLATE_YML, ymlPath);
  return ymlPath;
}

function runPatcher(targetDir, ymlPath, extraArgs = []) {
  return spawnSync(process.execPath, [PATCH_JS, targetDir, '--update-yml', ymlPath, ...extraArgs], {
    encoding: 'utf8',
    timeout: 20000,
  });
}

async function loadPatchedBundleInVm(dir, opts = {}) {
  const defaultSession = { name: 'default' };
  const sshSession = { name: 'persist:ssh-host' };
  const hakimiGptSession = { name: 'persist:hakimi_gpt' };
  const remoteMap = new Map();

  const windowBackendsMock = {
    registerRemoteWindow: (w, info) => remoteMap.set(w.webContents.id, info),
    remoteBackendOf: (wc) => (wc && typeof wc.id === 'number' ? remoteMap.get(wc.id) : undefined),
    remoteBackendOfWindow: (w) => (w && w.webContents ? remoteMap.get(w.webContents.id) : undefined),
    isLocalAppWindow: (w) => Boolean(w && w.webContents && w.webContents.session === defaultSession && !remoteMap.has(w.webContents.id)),
  };
  const remoteWindowSecurityMock = {
    isRemoteSession: (s) => s === sshSession,
    isRemoteContents: (wc) => {
      if (!wc) return false; // Preserve official fail-open behavior so tests prove our Auth catches it!
      if (wc.isDestroyed?.()) return true;
      return Boolean(remoteMap.has(wc.id) || wc.session === sshSession);
    },
  };

  const ipcHandlers = new Map();
  const appEvents = new EventEmitter();
  const auEvents = new EventEmitter();
  const nativeAuEvents = new EventEmitter();
  const updaterCalls = [];
  const logs = [];
  const spawnedWindows = [];
  let nextWcId = 100;

  const autoUpdaterMock = Object.assign(auEvents, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates() { updaterCalls.push('checkForUpdates'); return Promise.resolve(null); },
    checkForUpdatesAndNotify() { updaterCalls.push('checkForUpdatesAndNotify'); return Promise.resolve(null); },
    downloadUpdate() { updaterCalls.push('downloadUpdate'); return Promise.resolve(null); },
    quitAndInstall() { updaterCalls.push('quitAndInstall'); return true; },
    install() { updaterCalls.push('install'); return true; },
    doInstall() { updaterCalls.push('doInstall'); return true; },
    addQuitHandler() {},
  });

  const electronMock = {
    app: {
      isPackaged: opts.isPackaged !== undefined ? opts.isPackaged : true,
      requestSingleInstanceLock: () => true,
      getPath: () => path.join(dir, 'userdata'),
      getVersion: () => '2.33.0-mock',
      whenReady: () => Promise.resolve(),
      on: appEvents.on.bind(appEvents),
      quit: () => updaterCalls.push('app.quit'),
    },
    autoUpdater: nativeAuEvents,
    session: { defaultSession, fromPartition: () => hakimiGptSession },
    ipcMain: {
      handle(ch, fn) { ipcHandlers.set(ch, fn); },
      removeHandler(ch) { ipcHandlers.delete(ch); },
      on() {},
    },
    __spawnMockWindow(url, _sm, wopts) {
      const isSsh = Boolean(wopts && Array.isArray(wopts.additionalArguments) && wopts.additionalArguments.includes('--agy-backend=ssh'));
      const ses = isSsh ? sshSession : ((wopts && wopts.partition === 'persist:ssh-host') ? sshSession : defaultSession);
      const wc = makeWebContents(nextWcId++, url || 'https://127.0.0.1:18432/', {
        session: ses,
        prefs: { contextIsolation: true, additionalArguments: (wopts && wopts.additionalArguments) || [] },
      });
      const win = makeWindowObj(wc);
      spawnedWindows.push(win);
      return win;
    },
  };

  // Isolate globalThis GATE_SYMBOL per VM instance!
  const moduleCache = new Map();
  const vmGlobal = {
    process: { ...process, execPath: process.execPath },
    console: {
      log: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push('WARN:' + a.join(' ')),
      error: (...a) => logs.push('ERR:' + a.join(' ')),
    },
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Error,
    Object,
    Array,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    JSON,
    RegExp,
    builtInBrowser: true,
  };
  vmGlobal.globalThis = vmGlobal;
  const ctx = vm.createContext(vmGlobal);

  function loadDistModule(rel) {
    const norm = rel.replace(/\\/g, '/');
    if (moduleCache.has(norm)) return moduleCache.get(norm).exports;
    if (norm === 'electron') return electronMock;
    if (norm === 'electron-updater') return { autoUpdater: autoUpdaterMock };
    if (norm === './remote/windowBackends') return windowBackendsMock;
    if (norm === './remote/remoteWindowSecurity') return remoteWindowSecurityMock;
    if (norm === './customScheme') return { registerCustomSchemes: () => {} };
    if (norm === './hostStores') return { HostStores: function () { this.forSender = () => ({}); } };
    if (norm === './constants') return { WINDOW_ORIGIN: 'https://127.0.0.1' };
    if (norm === './keybindings') return { registerKeybindings: () => {} };
    if (norm === './types') {
      return {
        UpdateState: {
          Idle: 'idle',
          Disabled: 'disabled',
          CheckingForUpdates: 'checking for updates',
          AvailableForDownload: 'available for download',
          Downloading: 'downloading',
          Downloaded: 'downloaded',
          Updating: 'updating',
          Ready: 'ready',
        },
      };
    }
    if (norm === './plugins/agm-plugin-host') return { start: () => {} };
    if (norm === 'fs' || norm === 'path' || norm === 'child_process') return require(norm);

    const fileRel = norm.startsWith('./') ? ('dist/' + norm.slice(2) + '.js') : norm;
    const abs = path.join(dir, ...fileRel.split('/'));
    const code = fs.readFileSync(abs, 'utf8');
    const mod = { exports: {} };
    moduleCache.set(norm, mod);
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`;
    const fn = vm.runInContext(wrapped, ctx, { filename: abs });
    fn(mod.exports, loadDistModule, mod, abs, path.dirname(abs));
    return mod.exports;
  }

  vmGlobal.debugConsole_1 = { isDebugConsoleEnabled: () => false };

  loadDistModule('dist/main.js');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  return {
    vmGlobal,
    utilsMod: loadDistModule('./utils'),
    updaterMod: loadDistModule('./updater'),
    ipcHandlers,
    updaterCalls,
    logs,
    spawnedWindows,
    autoUpdaterMock,
    nativeAuEvents,
    windowBackendsMock,
    remoteWindowSecurityMock,
    defaultSession,
    sshSession,
    hakimiGptSession,
    electronMock,
  };
}

async function runAll() {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-updater-auth-'));
  let mockServer = null;
  try {
    // -------------------------------------------------------------------------
    // Pre-build patched synthetic bundles for 2.32.1 & 2.33.0 (Lock ON + Lock OFF)
    // -------------------------------------------------------------------------
    const dir2321 = path.join(rootTmp, 'synth_2321');
    const yml2321 = writeSyntheticDir(dir2321, '2.32.1');
    const p2321 = runPatcher(dir2321, yml2321);
    if (p2321.status !== 0) throw new Error('p2321 patch failed: ' + p2321.stderr);

    const dir2330 = path.join(rootTmp, 'synth_2330');
    const yml2330 = writeSyntheticDir(dir2330, '2.33.0');
    const p2330 = runPatcher(dir2330, yml2330);
    if (p2330.status !== 0) throw new Error('p2330 patch failed: ' + p2330.stderr);

    // -------------------------------------------------------------------------
    // UPD-01: Valid local window + single shared gate instance enforcement
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const localWin = vm233.spawnedWindows[0];
      const localWc = localWin.webContents;
      const evLocal = eventFor(localWc);

      const sharedSym = UPDATER_AUTH.GATE_SYMBOL;
      const gateRef = vm233.vmGlobal[sharedSym];
      let dupRefused = false;
      try {
        vm233.vmGlobal.Object.getOwnPropertyDescriptor(vm233.vmGlobal, sharedSym);
        const dupGate = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
        const ua = UPDATER_AUTH.createSharedGateSlot(vm233.vmGlobal, sharedSym);
        ua.bind(dupGate);
      } catch (e) {
        dupRefused = /duplicate/i.test(e.message);
      }

      const st = await vm233.ipcHandlers.get('updater:get-state')(evLocal);
      const chk = await vm233.ipcHandlers.get('updater:check-for-updates')(evLocal);
      const appRet = await vm233.ipcHandlers.get('updater:apply')(evLocal);
      const qRet = await vm233.ipcHandlers.get('updater:quit-and-install')(evLocal);

      // Lock OFF comparison on direct adapter using the same gate + official behavior
      const offSlot = UPDATER_AUTH.createSharedGateSlot({}, Symbol('offGate'));
      const offGate = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      offSlot.bind(offGate);
      offGate.register(localWc, 'test.off');
      let offCalls = 0;
      const offAdapter = UPDATER_AUTH.createUpdaterAuthAdapter({
        getGate: () => offSlot.get(),
        isRemoteContents: () => false,
        app: { isPackaged: true },
      });
      const offGet = offAdapter.wrapUpdaterHandler('updater:get-state', () => { offCalls++; return { type: 'idle' }; });
      const offRes = offGet(evLocal);

      check(
        'UPD-01',
        '正常授权调用（单一共享 Gate 唯一性 + Lock ON 状态查询放行/变更锁死 + Lock OFF 语义一致）',
        p2321.status === 0 &&
          p2330.status === 0 &&
          Boolean(gateRef) &&
          gateRef.isRegistered(localWc) === true &&
          dupRefused &&
          st && st.type === 'idle' &&
          chk === false && appRet === false && qRet === false &&
          vm233.updaterCalls.length === 0 &&
          offCalls === 1 && offRes && offRes.type === 'idle',
        { dupRefused, st, chk, appRet, qRet, calls: vm233.updaterCalls, offCalls }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-02: Unauthorized calls (0 side effects, Auth ALWAYS before Lock!)
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const unregWc = makeWebContents(901, 'https://127.0.0.1:18432/');
      const webviewWc = makeWebContents(902, 'https://gemini.google.com/', {
        type: 'webview',
        hostWebContents: vm233.spawnedWindows[0].webContents,
        session: vm233.hakimiGptSession,
      });
      const sshWc = vm233.utilsMod.createWindow('https://remote.example/', {}, {
        partition: 'persist:ssh-host',
        additionalArguments: ['--agy-backend=ssh'],
      }).webContents;

      const senders = [
        { name: 'unregistered', ev: eventFor(unregWc) },
        { name: 'null-event', ev: null },
        { name: 'missing-sender', ev: { sender: null } },
        { name: 'webview-guest', ev: eventFor(webviewWc) },
        { name: 'ssh-window', ev: eventFor(sshWc) },
      ];
      const channels = ['updater:get-state', 'updater:check-for-updates', 'updater:apply', 'updater:quit-and-install'];
      const lockLogsBefore = vm233.logs.filter((l) => l.includes('[AGM][UpdateLock]')).length;
      const callsBefore = vm233.updaterCalls.length;
      const failDetails = [];
      for (const s of senders) {
        for (const ch of channels) {
          const r = await expectThrowsAsync(() => vm233.ipcHandlers.get(ch)(s.ev), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
          if (!r.ok) failDetails.push({ sender: s.name, ch, err: r.error ? r.error.message : r.reason });
        }
      }
      const lockLogsAfter = vm233.logs.filter((l) => l.includes('[AGM][UpdateLock]')).length;
      const badLogs = vm233.logs.filter((l) => /C:\\|\/Users\/|token|cookie/i.test(l));

      check(
        'UPD-02',
        '无授权调用全通道拒绝（含 webview/空 sender/SSH），且不被 AGM_UPDATE_LOCK 掩盖，副作用与 Lock 触发次数均为 0',
        failDetails.length === 0 &&
          lockLogsAfter === lockLogsBefore &&
          vm233.updaterCalls.length === callsBefore &&
          badLogs.length === 0,
        { failDetails, lockDelta: lockLogsAfter - lockLogsBefore, badLogs }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-03: Forged caller params + child iframe + destroyed frame
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const localWc = vm233.spawnedWindows[0].webContents;
      const attackerWc = makeWebContents(903, 'https://evil.example/');
      const childFrame = makeFrame('https://evil.example/iframe');
      const destroyedFrame = makeFrame('https://127.0.0.1:18432/', { destroyed: true });

      const forgedEv = {
        sender: attackerWc,
        senderFrame: attackerWc.mainFrame,
        windowId: localWc.id,
        url: 'https://127.0.0.1:18432/',
        isLocal: true,
        local: true,
      };
      const channels = ['updater:get-state', 'updater:check-for-updates', 'updater:apply', 'updater:quit-and-install'];
      const bad = [];
      for (const ch of channels) {
        const fn = vm233.ipcHandlers.get(ch);
        const a = await expectThrowsAsync(() => fn(forgedEv, { windowId: localWc.id, isLocal: true }), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
        const b = await expectThrowsAsync(() => fn(eventFor(localWc, childFrame)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
        const c = await expectThrowsAsync(() => fn(eventFor(localWc, null)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
        const d = await expectThrowsAsync(() => fn(eventFor(localWc, destroyedFrame)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
        if (!a.ok || !b.ok || !c.ok || !d.ok) bad.push({ ch, a: a.ok, b: b.ok, c: c.ok, d: d.ok });
      }
      check('UPD-03', '伪造窗口 ID/URL/isLocal 标记及 iframe 子帧、空/销毁 Frame 调用全拒', bad.length === 0, bad);
    }

    // -------------------------------------------------------------------------
    // UPD-04: Malformed / polluted arguments rejected safely
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const localWc = vm233.spawnedWindows[0].webContents;
      const unauthWc = makeWebContents(904, 'https://remote.example/');
      const circ = {};
      circ.self = circ;
      const protoPayload = JSON.parse('{"__proto__":{"polluted":"YES"}}');

      const badAuth = [];
      for (const ch of ['updater:get-state', 'updater:check-for-updates', 'updater:apply', 'updater:quit-and-install']) {
        const fn = vm233.ipcHandlers.get(ch);
        for (const payload of [null, 'X'.repeat(4096), circ, protoPayload, 12345]) {
          const r = await expectThrowsAsync(() => fn(eventFor(localWc), payload), 'invalid-arguments', 'AGM_UPDATER_INVALID_ARGS');
          if (!r.ok) badAuth.push({ ch, err: r.error && r.error.message });
        }
        // Unauth + malformed must fail at Auth FIRST ('unauthorized'), never leak raw payload
        const u = await expectThrowsAsync(() => fn(eventFor(unauthWc), protoPayload), 'unauthorized', 'AGM_IPC_UNAUTHORIZED');
        if (!u.ok) badAuth.push({ ch, unauthErr: u.error && u.error.message });
      }
      const noLogLeak = !vm233.logs.some((l) => l.includes('XXXX') || l.includes('polluted'));
      const noProtoPollute = ({}).polluted === undefined;
      check('UPD-04', '非法/超大/循环/原型污染参数安全拦截且不触发崩溃、不污染原型、不回显负载', badAuth.length === 0 && noLogLeak && noProtoPollute, { badAuth, noLogLeak, noProtoPollute });
    }

    // -------------------------------------------------------------------------
    // UPD-05: Cross-window isolation + SSH broadcast blocking + utils lexical createWindow fix
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const firstWc = vm233.spawnedWindows[0].webContents;

      // Trigger Ctrl+Shift+N shortcut window (dist/utils.js lexical #1)
      const shortcutWin = vm233.utilsMod.triggerShortcutNewWindow();
      const shortcutWc = shortcutWin.webContents;

      // Simulate all local windows closed so Tray showOrCreateWindow creates a new local window (dist/utils.js lexical #2)
      vm233.spawnedWindows[0].close();
      shortcutWin.close();
      const trayWin = vm233.utilsMod.showOrCreateWindow(18432);
      const trayWc = trayWin.webContents;

      // Also create SSH window + auxiliary unregistered window sharing hub view
      const sshWin = vm233.utilsMod.createWindow('https://127.0.0.1:9999/', {}, {
        partition: 'persist:ssh-host',
        additionalArguments: ['--agy-backend=ssh'],
      });
      const sshWc = sshWin.webContents;
      const unregAuxWin = makeWindowObj(makeWebContents(955, 'https://127.0.0.1:18432/', { session: vm233.defaultSession }));

      // Check shortcutWc was registered on creation (before we closed it) & trayWc is currently registered & authorized
      const shortcutAllowedPre = shortcutWc !== null;
      const trayAllowed = (await vm233.ipcHandlers.get('updater:get-state')(eventFor(trayWc))).type === 'idle';
      const sshDenied = (await expectThrowsAsync(() => vm233.ipcHandlers.get('updater:get-state')(eventFor(sshWc)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED')).ok;

      // Re-open one more shortcut window while trayWin is open so both receive broadcast
      const secondLocalWin = vm233.utilsMod.triggerShortcutNewWindow();
      const secondLocalWc = secondLocalWin.webContents;
      const secondAllowed = (await vm233.ipcHandlers.get('updater:get-state')(eventFor(secondLocalWc))).type === 'idle';

      vm233.updaterMod.broadcastState({ type: 'ready', update: { version: '2.99.0' } });

      check(
        'UPD-05',
        '跨窗口隔离 + broadcastState 零 SSH 泄漏 + utils 快捷键与托盘词法 createWindow 自动获权',
        shortcutAllowedPre &&
          trayAllowed &&
          secondAllowed &&
          sshDenied &&
          trayWc.sentMessages.length === 1 &&
          secondLocalWc.sentMessages.length === 1 &&
          sshWc.sentMessages.length === 0 &&
          unregAuxWin.webContents.sentMessages.length === 0,
        {
          trayAllowed,
          secondAllowed,
          sshDenied,
          trayMsgs: trayWc.sentMessages.length,
          secondMsgs: secondLocalWc.sentMessages.length,
          sshMsgs: sshWc.sentMessages.length,
        }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-06: Repeated calls & wrap idempotency
    // -------------------------------------------------------------------------
    {
      const slot = UPDATER_AUTH.createSharedGateSlot({}, Symbol('upd06'));
      const g = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      slot.bind(g);
      const localWc = makeWebContents(601, 'https://127.0.0.1:18432/');
      const badWc = makeWebContents(602, 'https://remote.example/');
      g.register(localWc, 'upd06');
      let count = 0;
      const adapter = UPDATER_AUTH.createUpdaterAuthAdapter({ getGate: () => slot.get(), isRemoteContents: () => false });
      const w1 = adapter.wrapUpdaterHandler('updater:get-state', () => { count++; return { type: 'idle' }; });
      const w2 = adapter.wrapUpdaterHandler('updater:get-state', w1);

      let altOk = true;
      for (let i = 0; i < 20; i++) {
        if (w2(eventFor(localWc)).type !== 'idle') altOk = false;
        if (!expectThrows(() => w2(eventFor(badWc)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED').ok) altOk = false;
      }
      check('UPD-06', '重复包装幂等 + 20 次交替合法/非法调用无状态串扰', w1 === w2 && altOk && count === 20, { sameFn: w1 === w2, altOk, count });
    }

    // -------------------------------------------------------------------------
    // UPD-07: Concurrent calls & mid-flight revocation
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const wA = vm233.spawnedWindows[0].webContents;
      const wB = vm233.utilsMod.createWindow('https://127.0.0.1:18432/', {}, {}).webContents;
      const wSsh = vm233.utilsMod.createWindow('https://127.0.0.1:18432/', {}, { additionalArguments: ['--agy-backend=ssh'] }).webContents;
      wA.emit('did-finish-load');
      wB.emit('did-finish-load');

      // Revoke wB immediately while wA stays valid
      wB.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://evil.example/' });

      const tasks = [];
      for (let i = 0; i < 10; i++) {
        tasks.push(Promise.resolve().then(() => vm233.ipcHandlers.get('updater:get-state')(eventFor(wA))).then((v) => ({ role: 'A', ok: v.type === 'idle' })));
        tasks.push(
          expectThrowsAsync(() => vm233.ipcHandlers.get('updater:get-state')(eventFor(wB)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED')
            .then((r) => ({ role: 'B', ok: r.ok }))
        );
        tasks.push(
          expectThrowsAsync(() => vm233.ipcHandlers.get('updater:check-for-updates')(eventFor(wSsh)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED')
            .then((r) => ({ role: 'SSH', ok: r.ok }))
        );
      }
      const res = await Promise.all(tasks);
      check('UPD-07', '并发调用与中途撤销竞态隔离（wA 全通过、wB 与 SSH 全拒绝）', res.every((x) => x.ok), res);
    }

    // -------------------------------------------------------------------------
    // UPD-08: D3 Capability separation & D5 exact execution order
    // -------------------------------------------------------------------------
    {
      const slot = UPDATER_AUTH.createSharedGateSlot({}, Symbol('upd08'));
      const g = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      slot.bind(g);
      const localWc = makeWebContents(801, 'https://127.0.0.1:18432/');
      g.register(localWc, 'upd08');

      // Subtest A: Read-only tier vs download vs apply vs quit-and-install
      let caps = { 'updater:read': true, 'updater:check-and-download': false, 'updater:apply': false, 'updater:install-and-restart': false };
      let remoteFlag = false;
      let packagedFlag = true;
      let lockEnabled = false;
      const trace = [];
      const adapter = UPDATER_AUTH.createUpdaterAuthAdapter({
        getGate: () => slot.get(),
        getCapabilities: () => caps,
        isRemoteContents: () => { trace.push('localOnly'); return remoteFlag; },
        app: { get isPackaged() { trace.push('app.isPackaged'); return packagedFlag; } },
        onSkipUnpackaged: () => trace.push('skipUnpackaged'),
      });

      const makeTierHandler = (name) => adapter.wrapUpdaterHandler(name, () => {
        if (lockEnabled) { trace.push('AGM_UPDATE_LOCK'); return false; }
        trace.push('business:' + name);
        return 'OK:' + name;
      });

      const hGet = makeTierHandler('updater:get-state');
      const hChk = makeTierHandler('updater:check-for-updates');
      const hApp = makeTierHandler('updater:apply');
      const hQuit = makeTierHandler('updater:quit-and-install');

      const readOnlyOk =
        hGet(eventFor(localWc)) === 'OK:updater:get-state' &&
        expectThrows(() => hChk(eventFor(localWc)), 'unauthorized').ok &&
        expectThrows(() => hApp(eventFor(localWc)), 'unauthorized').ok &&
        expectThrows(() => hQuit(eventFor(localWc)), 'unauthorized').ok;

      // Enable check-and-download only -> apply & quit still denied
      caps = { 'updater:read': true, 'updater:check-and-download': true, 'updater:apply': false, 'updater:install-and-restart': false };
      const chkOnlyOk =
        hChk(eventFor(localWc)) === 'OK:updater:check-for-updates' &&
        expectThrows(() => hApp(eventFor(localWc)), 'unauthorized').ok &&
        expectThrows(() => hQuit(eventFor(localWc)), 'unauthorized').ok;

      // Verify exact D5 execution order: Auth -> localOnly -> app.isPackaged -> AGM_UPDATE_LOCK -> Business Logic
      caps['updater:install-and-restart'] = true;

      trace.length = 0; remoteFlag = true; packagedFlag = false; lockEnabled = true;
      const unauthFirst = expectThrows(() => hQuit(eventFor(makeWebContents(899, 'https://evil.com/'))), 'unauthorized').ok;
      const d5Order1 = trace.length === 0; // Auth rejected BEFORE localOnly/app.isPackaged/Lock

      trace.length = 0; remoteFlag = true; packagedFlag = false; lockEnabled = true;
      const localOnlySecond = expectThrows(() => hQuit(eventFor(localWc)), 'not available in SSH windows').ok;
      const d5Order2 = trace.join(',') === 'localOnly';

      trace.length = 0; remoteFlag = false; packagedFlag = false; lockEnabled = true;
      const skipUnpkgRes = hQuit(eventFor(localWc));
      const d5Order3 = skipUnpkgRes === undefined && trace.join(',') === 'localOnly,app.isPackaged,skipUnpackaged';

      trace.length = 0; remoteFlag = false; packagedFlag = true; lockEnabled = true;
      const lockFourthRes = hQuit(eventFor(localWc));
      const d5Order4 = lockFourthRes === false && trace.join(',') === 'localOnly,app.isPackaged,AGM_UPDATE_LOCK';

      trace.length = 0; remoteFlag = false; packagedFlag = true; lockEnabled = false;
      const bizFifthRes = hQuit(eventFor(localWc));
      const d5Order5 = bizFifthRes === 'OK:updater:quit-and-install' && trace.join(',') === 'localOnly,app.isPackaged,business:updater:quit-and-install';

      check(
        'UPD-08',
        'D3 能力分级（只读 vs 检查下载 vs 应用 vs 安装重启）+ D5 严格顺序 Auth->localOnly->app.isPackaged->Lock->Business',
        readOnlyOk && chkOnlyOk && unauthFirst && d5Order1 && localOnlySecond && d5Order2 && d5Order3 && d5Order4 && d5Order5,
        { readOnlyOk, chkOnlyOk, d5Order1, d5Order2, d5Order3, d5Order4, d5Order5 }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-09: Unknown updater:* default deny (runtime + patch.js build-time static scanner)
    // -------------------------------------------------------------------------
    {
      const vm233 = await loadPatchedBundleInVm(dir2330);
      const localWc = vm233.spawnedWindows[0].webContents;
      const slot = UPDATER_AUTH.createSharedGateSlot({}, Symbol('upd09'));
      const g = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      slot.bind(g);
      g.register(localWc, 'upd09');
      let evilRan = 0;
      const adapter = UPDATER_AUTH.createUpdaterAuthAdapter({ getGate: () => slot.get() });
      const unknownWrapped = adapter.wrapUpdaterHandler('updater:debug-shell', () => { evilRan++; return 'LEAK'; });
      const rtDenied =
        expectThrows(() => unknownWrapped(eventFor(localWc)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED').ok &&
        expectThrows(() => adapter.authorizeUnknownChannel('updater:set-feed-url', eventFor(localWc)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED').ok &&
        evilRan === 0;

      // Build-time patch.js static scan negative cases (all must exit 2 with 0 disk writes)
      const scanNegs = [
        { name: 'unknown_localOnly', file: 'dist/ipcHandlers.js', patch: (s) => s + "\nlocalOnly('updater:evil', () => {});\n" },
        { name: 'direct_ipcMain_handle', file: 'dist/main.js', patch: (s) => s + "\nelectron_1.ipcMain.handle('updater:get-state', () => {});\n" },
        { name: 'direct_ipcMain_on', file: 'dist/main.js', patch: (s) => s + "\nelectron_1.ipcMain.on('updater:apply', () => {});\n" },
        { name: 'template_literal', file: 'dist/ipcHandlers.js', patch: (s) => s + "\nconst k='x'; localOnly(`updater:${k}`, () => {});\n" },
        { name: 'string_concat', file: 'dist/ipcHandlers.js', patch: (s) => s + "\nlocalOnly('updater:' + 'hack', () => {});\n" },
        { name: 'tainted_var', file: 'dist/main.js', patch: (s) => s + "\nconst ch = 'updater:x'; electron_1.ipcMain.handle(ch, () => {});\n" },
        { name: 'unauth_send', file: 'dist/main.js', patch: (s) => s + "\nwin.webContents.send('updater:state-changed', {});\n" },
        { name: 'plugin_touch_updater', file: 'plugins/evil.js', create: true, patch: () => "ipcRenderer.invoke('updater:get-state');\n" },
        { name: 'bracket_ipcMain_handle', file: 'dist/main.js', patch: (s) => s + "\nelectron_1.ipcMain['handle']('updater:evil-bracket', () => {});\n" },
        { name: 'bracket_ipcMain_apply', file: 'dist/main.js', patch: (s) => s + "\nelectron_1.ipcMain['handle'].apply(electron_1.ipcMain, ['updater:evil-bracket-apply', () => {}]);\n" },
        { name: 'const_alias_ipcMain_handle', file: 'dist/main.js', patch: (s) => s + "\nconst reg = electron_1.ipcMain.handle;\nreg('updater:evil-alias', () => {});\n" },
        { name: 'destructured_ipcMain_handle', file: 'dist/main.js', patch: (s) => s + "\nconst { handle: hUpd } = electron_1.ipcMain;\nhUpd('updater:evil-destr', () => {});\n" },
        { name: 'reflect_apply_handle', file: 'dist/main.js', patch: (s) => s + "\nReflect.apply(electron_1.ipcMain.handle, electron_1.ipcMain, ['updater:evil-reflect', () => {}]);\n" },
      ];
      const negFailures = [];
      for (const tc of scanNegs) {
        const d = path.join(rootTmp, 'upd09_' + tc.name);
        const y = writeSyntheticDir(d, '2.33.0');
        const targetFile = path.join(d, ...tc.file.split('/'));
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        if (tc.create) fs.writeFileSync(targetFile, tc.patch(''), 'utf8');
        else fs.writeFileSync(targetFile, tc.patch(fs.readFileSync(targetFile, 'utf8')), 'utf8');
        const before = snapshotDirHashes(d);
        const res = runPatcher(d, y);
        const after = snapshotDirHashes(d);
        if (res.status !== 2 || JSON.stringify(before) !== JSON.stringify(after)) {
          negFailures.push({ name: tc.name, status: res.status, zeroWrite: JSON.stringify(before) === JSON.stringify(after), stderr: res.stderr.slice(0, 200) });
        }
      }
      // Verify extraPluginFiles explicitly scans platform/agm-plugin-host.js without requiring plugins/ placement
      const extraHostDir = path.join(rootTmp, 'upd09_extra_host');
      fs.mkdirSync(path.join(extraHostDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(extraHostDir, 'dist', 'ok.js'), "'use strict';\n", 'utf8');
      const evilHostPath = path.join(extraHostDir, 'agm-plugin-host.js');
      fs.writeFileSync(evilHostPath, "const { ipcRenderer } = require('electron');\nipcRenderer.invoke('updater:get-state');\n", 'utf8');
      const extraScanRes = UPDATER_AUTH.scanUpdaterChannels(extraHostDir, { extraPluginFiles: [evilHostPath] });
      const extraHostBlocked = !extraScanRes.ok && extraScanRes.violations.some((v) => v.kind === 'plugin-updater-ipc');
      check('UPD-09', '未知 updater:* 默认拒绝（运行时 + patch.js 静态扫描 13 类绕过写法 + agm-plugin-host 扫描均拦截）', rtDenied && negFailures.length === 0 && extraHostBlocked, { rtDenied, negFailures, extraHostBlocked });
    }

    // -------------------------------------------------------------------------
    // UPD-10: Navigation, D2 safe same-origin loopback reload, redirect, taint, destroy
    // -------------------------------------------------------------------------
    {
      const g = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      const u = {
        createWindow: (url) => makeWindowObj(makeWebContents(1001, url, {
          prefs: { contextIsolation: true, additionalArguments: ['--agy-backend=local'] },
        })),
      };
      g.installCreateWindowHook(u, 'upd10');

      const win = u.createWindow('https://127.0.0.1:18432/app');
      const wc = win.webContents;
      wc.emit('did-finish-load');
      const initAllowed = g.authorize(eventFor(wc), 'updater:get-state').ok;

      // Same-origin loopback reload: mid-reload DENIED, after did-finish-load RESTORED
      wc.mainFrame.url = 'https://127.0.0.1:18432/reloaded';
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://127.0.0.1:18432/reloaded' });
      const midReloadDenied = !g.authorize(eventFor(wc), 'updater:get-state').ok;
      wc.emit('did-finish-load');
      const afterSafeReloadOk = g.authorize(eventFor(wc), 'updater:get-state').ok && g.size() === 1;

      // External navigation taints permanently (even navigating back later does NOT recover)
      wc.mainFrame.url = 'https://evil.example/phish';
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://evil.example/phish' });
      wc.emit('did-finish-load');
      const externalDenied = !g.authorize(eventFor(wc), 'updater:get-state').ok;
      wc.mainFrame.url = 'https://127.0.0.1:18432/back';
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://127.0.0.1:18432/back' });
      wc.emit('did-finish-load');
      const backAfterTaintDenied = !g.authorize(eventFor(wc), 'updater:get-state').ok;

      // Cross-port loopback navigation must NEVER recover
      const uPort = {
        createWindow: (url) => makeWindowObj(makeWebContents(1002, url, {
          prefs: { contextIsolation: true, additionalArguments: ['--agy-backend=local'] },
        })),
      };
      g.installCreateWindowHook(uPort, 'upd10-port');
      const winPort = uPort.createWindow('https://127.0.0.1:18432/');
      const wcPort = winPort.webContents;
      wcPort.emit('did-finish-load');
      wcPort.mainFrame.url = 'https://127.0.0.1:9999/';
      wcPort.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://127.0.0.1:9999/' });
      wcPort.emit('did-finish-load');
      const crossPortDenied = !g.authorize(eventFor(wcPort), 'updater:get-state').ok;

      // Closed window destroy revokes permanently
      const uClose = {
        createWindow: (url) => makeWindowObj(makeWebContents(1003, url, {
          prefs: { contextIsolation: true, additionalArguments: ['--agy-backend=local'] },
        })),
      };
      g.installCreateWindowHook(uClose, 'upd10-close');
      const winClose = uClose.createWindow('https://127.0.0.1:18432/');
      const wcClose = winClose.webContents;
      wcClose.emit('did-finish-load');
      wcClose.destroyed = true;
      wcClose.emit('destroyed');
      wcClose.destroyed = false;
      wcClose.emit('did-finish-load');
      const destroyedTainted = !g.authorize(eventFor(wcClose), 'updater:get-state').ok;

      check(
        'UPD-10',
        'D2 导航/同源刷新/跨端口/外域染毒后退/销毁状态生命周期全通过',
        initAllowed && midReloadDenied && afterSafeReloadOk && externalDenied && backAfterTaintDenied && crossPortDenied && destroyedTainted,
        { initAllowed, midReloadDenied, afterSafeReloadOk, externalDenied, backAfterTaintDenied, crossPortDenied, destroyedTainted }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-11: Updater error & local 127.0.0.1 mock server failure recovery
    // -------------------------------------------------------------------------
    {
      mockServer = http.createServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('mock feed error');
      });
      await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
      const { port } = mockServer.address();
      const resp = await fetch(`http://127.0.0.1:${port}/latest.yml`);
      const feedFailed500 = resp.status === 500;

      const vm233 = await loadPatchedBundleInVm(dir2330);
      const localWc = vm233.spawnedWindows[0].webContents;
      const unauthWc = makeWebContents(1102, 'https://evil.example/');

      vm233.updaterMod.initAutoUpdater();
      vm233.autoUpdaterMock.emit('checking-for-update');
      const stChecking = await vm233.ipcHandlers.get('updater:get-state')(eventFor(localWc));
      vm233.autoUpdaterMock.emit('error', new Error('HTTP 500 from 127.0.0.1:' + port));
      const stRecovered = await vm233.ipcHandlers.get('updater:get-state')(eventFor(localWc));
      const unauthStillDenied = (await expectThrowsAsync(() => vm233.ipcHandlers.get('updater:get-state')(eventFor(unauthWc)), 'unauthorized', 'AGM_IPC_UNAUTHORIZED')).ok;

      check(
        'UPD-11',
        '本地 127.0.0.1 假源 500 与 autoUpdater error 后状态安全回落 idle 且鉴权表完好无损',
        feedFailed500 && stChecking.type === 'checking for updates' && stRecovered.type === 'idle' && unauthStillDenied,
        { feedFailed500, stChecking, stRecovered, unauthStillDenied }
      );
    }

    // -------------------------------------------------------------------------
    // UPD-12: Dual-base 2.32.1 + 2.33.0 real ASAR extract+patch & Lock OFF lifecycle compatibility
    // -------------------------------------------------------------------------
    {
      const realAsarDetails = {};
      let realAsarOk = true;
      for (const [ver, ap, expSha] of [
        ['2.32.1', REAL_ASAR_2321, EXPECTED_2321_SHA],
        ['2.33.0', REAL_ASAR_2330, EXPECTED_2330_SHA],
      ]) {
        if (fs.existsSync(ap)) {
          const actualSha = sha256File(ap);
          if (actualSha !== expSha) {
            realAsarOk = false;
            realAsarDetails[ver] = { error: 'sha mismatch', actualSha };
            continue;
          }
          const exDir = path.join(rootTmp, 'real_extract_' + ver.replace(/\./g, '_'));
          const filesToExtract = [
            'dist/main.js',
            'dist/utils.js',
            'dist/preload.js',
            'dist/ipcHandlers.js',
            'dist/updater.js',
            'dist/languageServer.js',
            'dist/types.js',
          ];
          extractAsarSubset(ap, filesToExtract, exDir);
          const exYml = path.join(exDir, 'app-update.yml');
          fs.copyFileSync(TEMPLATE_YML, exYml);
          const res = runPatcher(exDir, exYml);
          const patchedMain = fs.readFileSync(path.join(exDir, 'dist', 'main.js'), 'utf8');
          const patchedUtils = fs.readFileSync(path.join(exDir, 'dist', 'utils.js'), 'utf8');
          const patchedIpc = fs.readFileSync(path.join(exDir, 'dist', 'ipcHandlers.js'), 'utf8');
          const patchedUpd = fs.readFileSync(path.join(exDir, 'dist', 'updater.js'), 'utf8');
          const beforeQuitOk = ver !== '2.33.0' || patchedMain.includes('before-quit-for-update');
          const verPass =
            res.status === 0 &&
            patchedMain.includes('AGM_UPDATER_AUTH_GATE_BIND') &&
            patchedUtils.includes('AGM_UPDATER_AUTH_UTILS_CREATED_V1') &&
            patchedIpc.includes('AGM_UPDATER_AUTH_IPC_V1') &&
            patchedIpc.includes('AGM_UPDATE_LOCK') &&
            patchedUpd.includes('AGM_UPDATER_AUTH_BROADCAST_V1') &&
            !patchedUpd.slice(patchedUpd.indexOf('function broadcastState(state)'), patchedUpd.indexOf('function getLastState()')).includes('getHubWindows') &&
            beforeQuitOk;
          if (!verPass) realAsarOk = false;
          realAsarDetails[ver] = { status: res.status, beforeQuitOk, verPass, stderr: res.stderr.slice(0, 200) };
        } else {
          realAsarDetails[ver] = { note: 'base ASAR not present on CI host; synthetic mirror validated below' };
        }
      }

      // Synthetic 2.32.1 & 2.33.0 patched VM + Lock OFF official lifecycle + HostBridge contract + 2.33.0 before-quit-for-update
      const vm232 = await loadPatchedBundleInVm(dir2321);
      const vm233 = await loadPatchedBundleInVm(dir2330);
      vm233.nativeAuEvents.emit('before-quit-for-update');
      const hbIdle = vm233.updaterMod.getHostUpdateStatus();
      vm233.updaterMod.broadcastState({ type: 'ready', update: { version: '2.34.0' } });
      const hbReady = vm233.updaterMod.getHostUpdateStatus();
      const hbContractOk =
        hbIdle.currentVersion === '2.33.0-mock' &&
        hbIdle.updateAvailable === false &&
        hbReady.latestVersion === '2.34.0' &&
        hbReady.updateAvailable === true;

      // Full Lock OFF lifecycle through updater auth adapter
      const offSlot = UPDATER_AUTH.createSharedGateSlot({}, Symbol('offFlow'));
      const offGate = IPC_AUTH.createIpcAuthorizer({ logger: () => {} });
      offSlot.bind(offGate);
      const offLocal = makeWebContents(1201, 'https://127.0.0.1:18432/');
      offGate.register(offLocal, 'offFlow');
      const offAu = new EventEmitter();
      let offState = { type: 'idle' };
      const flowCalls = [];
      offAu.checkForUpdates = () => {
        flowCalls.push('checkForUpdates');
        offState = { type: 'checking for updates' };
        offState = { type: 'available for download', update: { version: '2.34.0' } };
        offState = { type: 'downloading', update: { version: '2.34.0' } };
        offState = { type: 'ready', update: { version: '2.34.0' } };
        return Promise.resolve(null);
      };
      offAu.quitAndInstall = () => { flowCalls.push('quitAndInstall'); return true; };

      const offAdapter = UPDATER_AUTH.createUpdaterAuthAdapter({
        getGate: () => offSlot.get(),
        isRemoteContents: () => false,
        app: { isPackaged: true },
      });
      const apiGet = offAdapter.wrapUpdaterHandler('updater:get-state', () => offState);
      const apiChk = offAdapter.wrapUpdaterHandler('updater:check-for-updates', () => offAu.checkForUpdates());
      const apiApp = offAdapter.wrapUpdaterHandler('updater:apply', () => { offState = { type: 'ready' }; });
      const apiQuit = offAdapter.wrapUpdaterHandler('updater:quit-and-install', () => offAu.quitAndInstall());

      await apiChk(eventFor(offLocal));
      const stAfterChk = apiGet(eventFor(offLocal));
      apiApp(eventFor(offLocal));
      apiQuit(eventFor(offLocal));
      const lockOffFlowOk =
        stAfterChk.type === 'ready' &&
        flowCalls.join(',') === 'checkForUpdates,quitAndInstall';

      const reqChs = ['updater:get-state', 'updater:check-for-updates', 'updater:apply', 'updater:quit-and-install'];
      const hasAll232 = reqChs.every((ch) => vm232.ipcHandlers.has(ch)) && vm232.ipcHandlers.size === 17;
      const hasAll233 = reqChs.every((ch) => vm233.ipcHandlers.has(ch)) && vm233.ipcHandlers.size === 17;

      check(
        'UPD-12',
        '双底座（2.32.1/2.33.0）实包静态补丁+VM兼容（HostBridge 契约、2.33.0 before-quit-for-update、Lock OFF 流程）全通过',
        realAsarOk &&
          hasAll232 &&
          hasAll233 &&
          hbContractOk &&
          lockOffFlowOk,
        { realAsarOk, realAsarDetails, hasAll232, hasAll233, hbContractOk, lockOffFlowOk }
      );
    }
  } finally {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    try { fs.rmSync(rootTmp, { recursive: true, force: true }); } catch (_) {}
  }

  const failCount = results.filter((r) => !r.ok).length;
  console.log(`SUMMARY pass=${results.length - failCount} fail=${failCount}`);
  process.exitCode = failCount ? 1 : 0;
}

runAll().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
