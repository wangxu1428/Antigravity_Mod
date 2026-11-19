// tests/test_compat_233_unit.js : Synthetic offline tests for Antigravity 2.32.1 / 2.33.0 compatibility
// Uses only minimal handwritten synthetic fixtures (zero official code snippets or asar binaries).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PATCH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'patch.js');
const AGM_LOCKS_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_locks.js');
const AGM_IPC_AUTH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_ipc_auth.js');
const AGM_UPDATER_AUTH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_updater_auth.js');
const REAPER_CORE_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_sidecar_reaper_core.js');
const TEMPLATE_YML = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');
const REPATCH_PS1 = path.join(REPO_ROOT, 'platform', 'mod_kit', 'repatch.ps1');
const RESTORE_PS1 = path.join(REPO_ROOT, 'platform', 'scripts', 'restore-official.ps1');
const WORKFLOW_YML = path.join(REPO_ROOT, '.github', 'workflows', 'test.yml');
const MANIFEST_JSON = path.join(REPO_ROOT, 'manifest.repo.json');

const OFFICIAL_2321_SHA256 = '5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F';
const OFFICIAL_2330_SHA256 = 'B33C81600E82E65593AA8430EF01B37D6B28D9D98F0FAF45E25957783B71E64B';
const KNOWN_PREPATCHED_ZH_SHA256 = '98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46';

const results = [];
function record(id, status, desc, detail) {
  results.push({ id, status });
  if (status === 'PASS') {
    console.log(`PASS ${id} ${desc}`);
  } else if (status === 'SKIP') {
    console.log(`SKIP ${id} ${desc} :: ${detail === undefined ? 'not run' : detail}`);
  } else {
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function check(id, desc, cond, detail) {
  if (cond) record(id, 'PASS', desc);
  else record(id, 'FAIL', desc, detail);
}

// SKIP 只允许在非 Windows 出现；Windows 上任何 Windows 专用用例走到 SKIP 一律判 FAIL。
function skip(id, desc, reason) {
  if (process.platform === 'win32') {
    check(id, desc, false, 'Windows 上不允许 SKIP：' + reason);
    return;
  }
  record(id, 'SKIP', desc, reason);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function snapshotDirHashes(dirPath) {
  const out = {};
  const walk = (cur) => {
    for (const name of fs.readdirSync(cur).sort()) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out[path.relative(dirPath, full).split(path.sep).join('/')] = sha256File(full);
    }
  };
  walk(dirPath);
  return out;
}

// Minimal lexical JS block scanner (handles strings, template strings, line/block comments)
function skipWsAndComments(src, pos) {
  let i = pos;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function scanQuoted(src, pos, quote) {
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      i = findMatchingBrace(src, i + 1);
      if (i < 0) return src.length;
      i++;
      continue;
    }
    if (ch === quote) return i;
    i++;
  }
  return src.length;
}

function findMatchingBrace(src, openIdx) {
  if (src[openIdx] !== '{') return -1;
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = scanQuoted(src, i, ch) + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function findMatchingParen(src, openIdx) {
  if (src[openIdx] !== '(') return -1;
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = scanQuoted(src, i, ch) + 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function extractIfElseBlocks(src, conditionExpr) {
  const idx = src.indexOf(`if (${conditionExpr})`);
  if (idx < 0) return null;
  const openParen = src.indexOf('(', idx);
  const closeParen = findMatchingParen(src, openParen);
  if (closeParen < 0) return null;
  const ifBraceOpen = skipWsAndComments(src, closeParen + 1);
  if (src[ifBraceOpen] !== '{') return null;
  const ifBraceClose = findMatchingBrace(src, ifBraceOpen);
  if (ifBraceClose < 0) return null;
  const afterIf = skipWsAndComments(src, ifBraceClose + 1);
  if (!src.startsWith('else', afterIf)) return null;
  const elseBraceOpen = skipWsAndComments(src, afterIf + 4);
  if (src[elseBraceOpen] !== '{') return null;
  const elseBraceClose = findMatchingBrace(src, elseBraceOpen);
  if (elseBraceClose < 0) return null;
  return {
    ifStart: ifBraceOpen,
    ifEnd: ifBraceClose,
    ifBody: src.slice(ifBraceOpen + 1, ifBraceClose),
    elseStart: elseBraceOpen,
    elseEnd: elseBraceClose,
    elseBody: src.slice(elseBraceOpen + 1, elseBraceClose),
  };
}

function createSyntheticMainJs(version) {
  const lines = [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const electron_1 = require('electron');",
    "const customScheme_1 = require('./customScheme');",
    "const ipcHandlers_1 = require('./ipcHandlers');",
    "const utils_1 = require('./utils');",
    "const hostStores_1 = require('./hostStores');",
    "const storageManager = {};",
    "let remoteManager = null;",
    "const gotTheLock = electron_1.app.requestSingleInstanceLock();",
    "(0, customScheme_1.registerCustomSchemes)();",
    "electron_1.app.on('session-created', (targetSession) => {",
    "    void targetSession;",
    "});",
    "electron_1.app.whenReady().then(async () => {",
    "    remoteManager = { sidecarRoutesFor: () => null, hostQuestions: { isBusy: () => false, onBeforeAsk: (cb) => { globalThis.__onBeforeAsk = cb; } }, openUrlFrom: () => true };",
    "    const hostStores = new hostStores_1.HostStores(electron_1.app.getPath('userData'), storageManager);",
  ];
  if (version === '2.33.0') {
    lines.push(
      "    const ipc = (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {",
      "        hostQuestionBusy: (win) => remoteManager?.hostQuestions.isBusy(win) ?? false,",
      "        resolveStorage: (sender) => hostStores.forSender(sender),",
      "        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),",
      "        openFromRemote: (sender, url) => remoteManager?.openUrlFrom(sender, url),",
      "    });",
      "    remoteManager.hostQuestions.onBeforeAsk((win) => ipc.closeContextMenu(win));"
    );
  } else {
    lines.push(
      "    (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {",
      "        resolveStorage: (sender) => hostStores.forSender(sender),",
      "        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),",
      "    });"
    );
  }
  lines.push(
    "    (0, utils_1.createWindow)('http://127.0.0.1:1/', storageManager);",
    "});",
    ""
  );
  return lines.join('\n');
}

function createSyntheticPreloadJs(version) {
  const lines = [
    "'use strict';",
    "const electron_1 = require('electron');",
    "const isRemoteWindow = process.argv.includes('--agy-backend=ssh');",
    "function createLocalSshRemoteAPI() { return { mode: 'local' }; }",
    "function createRemoteSshRemoteAPI() { return { mode: 'remote' }; }",
    "const computerPreviewAPI = { preview: true };",
    "if (!isRemoteWindow) {",
    "    void 0;",
    "}",
    "if (isRemoteWindow) {",
    "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createRemoteSshRemoteAPI());",
    "}",
    "else {",
    "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());",
  ];
  if (version === '2.33.0') {
    lines.push("    electron_1.contextBridge.exposeInMainWorld('agyComputerPreview', computerPreviewAPI);");
  }
  lines.push(
    "}",
    "if (!isRemoteWindow) {",
    "    void 0;",
    "}",
    ""
  );
  return lines.join('\n');
}

function createSyntheticSupportFiles() {
  return {
    'dist/utils.js': [
      "'use strict';",
      'const winOpts = {',
      '    webviewTag: builtInBrowser,',
      '    devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),',
      '};',
      '',
    ].join('\n'),
    'dist/updater.js': [
      "'use strict';",
      'const electron_1 = require("electron");',
      'const electron_updater_1 = require("electron-updater");',
      'function setAutoUpdateChecking(enabled) {',
      '    return enabled;',
      '}',
      'function checkForUpdates(isManual = false) {',
      '    return electron_updater_1.autoUpdater.checkForUpdates();',
      '}',
      'function quitAndInstall() {',
      '    return electron_updater_1.autoUpdater.quitAndInstall();',
      '}',
      'function applyHostUpdate() {',
      '    return true;',
      '}',
      'function headlessQuitAndInstall(downloadedFilePath) {',
      '    return true;',
      '}',
      'function initAutoUpdater() {',
      '    electron_updater_1.autoUpdater.autoDownload = true;',
      '    electron_updater_1.autoUpdater.autoInstallOnAppQuit = electron_1.app.isPackaged;',
      '}',
      '',
    ].join('\n'),
    'dist/ipcHandlers.js': [
      "'use strict';",
      'function registerIpcHandlers() {',
      '    const localOnly = (_c, fn) => fn;',
      "    localOnly('updater:quit-and-install', () => {",
      '        return true;',
      '    });',
      "    localOnly('updater:apply', async () => {",
      '        return true;',
      '    });',
      "    localOnly('updater:check-for-updates', () => {",
      '        return true;',
      '    });',
      '}',
      '',
    ].join('\n'),
    'dist/languageServer.js': [
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
    ].join('\n'),
  };
}

function writeSyntheticTargetDir(dir, version, overrides = {}) {
  const support = createSyntheticSupportFiles();
  const files = {
    'dist/main.js': createSyntheticMainJs(version),
    'dist/preload.js': createSyntheticPreloadJs(version),
    ...support,
    ...overrides,
  };
  for (const [rel, content] of Object.entries(files)) {
    const outPath = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
  }
  const ymlPath = path.join(dir, 'app-update.yml');
  fs.writeFileSync(
    ymlPath,
    'provider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: antigravity\n',
    'utf8'
  );
  return ymlPath;
}

function runPatcher(targetDir, ymlPath) {
  const args = [PATCH_JS, targetDir];
  if (ymlPath) args.push('--update-yml', ymlPath);
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function nodeCheckFile(filePath) {
  const res = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
  return res.status === 0;
}

function runPreloadInVm(preloadSrc, isRemote) {
  const exposed = [];
  const exposedMap = new Map();
  const ipcInvokes = [];
  const listeners = [];
  const argv = isRemote ? ['electron', 'preload.js', '--agy-backend=ssh'] : ['electron', 'preload.js'];
  const fakeWindow = {
    addEventListener: (ev, fn) => listeners.push({ target: 'window', ev, fn }),
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { reload: () => {} },
  };
  const fakeDoc = {
    readyState: 'loading',
    addEventListener: (ev, fn) => listeners.push({ target: 'document', ev, fn }),
    removeEventListener: () => {},
  };
  const mockElectron = {
    contextBridge: {
      exposeInMainWorld: (key, api) => {
        exposed.push({ key, api });
        exposedMap.set(key, (exposedMap.get(key) || 0) + 1);
      },
    },
    ipcRenderer: {
      invoke: (ch, ...args) => {
        ipcInvokes.push({ ch, args });
        return Promise.resolve(null);
      },
      on: () => {},
      removeListener: () => {},
    },
    webFrame: { executeJavaScript: () => Promise.resolve(null) },
  };
  const ctx = vm.createContext({
    require: (id) => {
      if (id === 'electron') return mockElectron;
      throw new Error('Unexpected require in synthetic preload: ' + id);
    },
    process: { ...process, argv },
    window: fakeWindow,
    document: fakeDoc,
    CustomEvent: function CustomEvent(name) { this.type = name; },
    console,
    setTimeout,
    clearTimeout,
    URL,
  });
  vm.runInContext(preloadSrc, ctx, { filename: 'preload.js' });
  const duplicateKeys = [];
  for (const [k, cnt] of exposedMap.entries()) {
    if (cnt > 1) duplicateKeys.push({ key: k, count: cnt });
  }
  return { exposed, exposedMap, duplicateKeys, ipcInvokes, listeners };
}

function runMainInVm(mainSrc) {
  const timeline = [];
  const ipcHandlers = new Map();
  const sessionConfigured = [];
  let readyPromise = null;
  let beforeAskCb = null;
  let capturedIpcOpts = null;
  let closeContextMenuCalls = 0;

  const makeSession = (label) => ({
    label,
    webRequest: {
      onBeforeSendHeaders: () => {},
      onHeadersReceived: () => {},
    },
  });

  const mockElectron = {
    app: {
      requestSingleInstanceLock: () => true,
      getPath: () => os.tmpdir(),
      on: () => {},
      whenReady: () => ({
        then: (fn) => {
          readyPromise = fn();
          return readyPromise;
        },
      }),
    },
    ipcMain: {
      handle: (ch, fn) => {
        timeline.push(`ipc:${ch}`);
        ipcHandlers.set(ch, fn);
      },
    },
    session: {
      defaultSession: makeSession('default'),
      fromPartition: (p) => {
        sessionConfigured.push(p);
        return makeSession(p);
      },
    },
  };

  const mockErrors = [];
  const mockConsole = {
    log: () => {},
    error: (...args) => mockErrors.push(args.join(' ')),
  };

  const ctx = vm.createContext({
    require: (id) => {
      if (id === 'fs') return fs;
      if (id === 'path') return path;
      if (id === 'electron') return mockElectron;
      if (id === './customScheme') return { registerCustomSchemes: () => timeline.push('registerCustomSchemes') };
      if (id === './ipcHandlers') {
        return {
          registerIpcHandlers: (_storage, opts) => {
            timeline.push('registerIpcHandlers');
            capturedIpcOpts = opts;
            return {
              closeContextMenu: (win) => {
                closeContextMenuCalls++;
                timeline.push(`closeContextMenu:${win && win.id}`);
              },
            };
          },
        };
      }
      if (id === './utils') {
        return {
          createWindow: () => timeline.push('createWindow'),
        };
      }
      if (id === './hostStores') {
        return {
          HostStores: function HostStores() {
            this.forSender = () => ({});
          },
        };
      }
      throw new Error('Unexpected require: ' + id);
    },
    process,
    console: mockConsole,
    globalThis: {},
  });
  ctx.globalThis = ctx;
  vm.runInContext(mainSrc, ctx, { filename: 'main.js' });
  beforeAskCb = ctx.__onBeforeAsk;
  return {
    readyPromise,
    timeline,
    ipcHandlers,
    sessionConfigured,
    capturedIpcOpts,
    mockErrors,
    triggerBeforeAsk: (win) => beforeAskCb && beforeAskCb(win),
    getCloseContextMenuCalls: () => closeContextMenuCalls,
  };
}

async function runAll() {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agm_compat_233_'));
  try {
    // C233-1: patch.js syntax check
    check('C233-1', 'patch.js passes node --check syntax validation', nodeCheckFile(PATCH_JS));

    // C233-2: 2.32.1 synthetic full patch
    const dir2321 = path.join(rootTmp, 's2321');
    const yml2321 = writeSyntheticTargetDir(dir2321, '2.32.1');
    const res2321 = runPatcher(dir2321, yml2321);
    const sixFiles = ['dist/main.js', 'dist/utils.js', 'dist/preload.js', 'dist/updater.js', 'dist/ipcHandlers.js', 'dist/languageServer.js'];
    const syntax2321 = sixFiles.every((f) => nodeCheckFile(path.join(dir2321, ...f.split('/'))));
    const m2321 = fs.readFileSync(path.join(dir2321, 'dist', 'main.js'), 'utf8');
    const p2321 = fs.readFileSync(path.join(dir2321, 'dist', 'preload.js'), 'utf8');
    const u2321 = fs.readFileSync(path.join(dir2321, 'dist', 'utils.js'), 'utf8');
    check(
      'C233-2',
      '2.32.1 synthetic fixture patches cleanly (exit 0) and passes node --check on all 6 files',
      res2321.status === 0 &&
        syntax2321 &&
        m2321.includes('Hakimi Portable UserData Lock') &&
        m2321.includes('Register Hakimi IPC and Sessions') &&
        u2321.includes('webviewTag: true,') &&
        u2321.includes('devTools: true,') &&
        p2321.includes("exposeInMainWorld('hakimiHost'") &&
        p2321.includes('HakimiPluginHost Initializer'),
      { status: res2321.status, syntax2321, stderr: res2321.stderr }
    );

    // C233-3: 2.33.0 synthetic full patch + lexical scope & order verification
    const dir2330 = path.join(rootTmp, 's2330');
    const yml2330 = writeSyntheticTargetDir(dir2330, '2.33.0');
    const res2330 = runPatcher(dir2330, yml2330);
    const syntax2330 = sixFiles.every((f) => nodeCheckFile(path.join(dir2330, ...f.split('/'))));
    const m2330 = fs.readFileSync(path.join(dir2330, 'dist', 'main.js'), 'utf8');
    const p2330 = fs.readFileSync(path.join(dir2330, 'dist', 'preload.js'), 'utf8');

    const whenReadyIdx = m2330.indexOf('electron_1.app.whenReady().then(async () => {');
    const whenReadyOpen = m2330.indexOf('{', whenReadyIdx);
    const whenReadyClose = findMatchingBrace(m2330, whenReadyOpen);
    const whenReadyBody = m2330.slice(whenReadyOpen + 1, whenReadyClose);
    const posIpcDecl = whenReadyBody.indexOf('const ipc = (0, ipcHandlers_1.registerIpcHandlers)(storageManager,');
    const posHakimiInit = whenReadyBody.indexOf('registerHakimiIpcHandlers();');
    const posOnBeforeAsk = whenReadyBody.indexOf('remoteManager.hostQuestions.onBeforeAsk((win) => ipc.closeContextMenu(win));');
    const posCreateWin = whenReadyBody.indexOf('(0, utils_1.createWindow)(');

    check(
      'C233-3',
      '2.33.0 synthetic fixture preserves const ipc, hostQuestionBusy, openFromRemote, onBeforeAsk in same whenReady scope before createWindow',
      res2330.status === 0 &&
        syntax2330 &&
        whenReadyOpen > 0 &&
        whenReadyClose > whenReadyOpen &&
        posIpcDecl >= 0 &&
        posHakimiInit > posIpcDecl &&
        posOnBeforeAsk > posHakimiInit &&
        posCreateWin > posOnBeforeAsk &&
        whenReadyBody.includes('hostQuestionBusy:') &&
        whenReadyBody.includes('openFromRemote:'),
      { status: res2330.status, syntax2330, posIpcDecl, posHakimiInit, posOnBeforeAsk, posCreateWin }
    );

    // C233-4: VM execution of patched 2.33.0 synthetic main.js
    const mainVm = runMainInVm(m2330);
    await mainVm.readyPromise;
    mainVm.triggerBeforeAsk({ id: 99 });
    const firstWinIdx = mainVm.timeline.indexOf('createWindow');
    const hakimiOrderOk = ['hakimi:get-plugins-dir', 'hakimi:write-state'].every((ch) => {
      const idx = mainVm.timeline.indexOf(`ipc:${ch}`);
      return idx >= 0 && idx < firstWinIdx;
    });
    const hostBusyVal = mainVm.capturedIpcOpts && typeof mainVm.capturedIpcOpts.hostQuestionBusy === 'function' ? mainVm.capturedIpcOpts.hostQuestionBusy({}) : 'MISSING';
    const openRemoteVal = mainVm.capturedIpcOpts && typeof mainVm.capturedIpcOpts.openFromRemote === 'function' ? mainVm.capturedIpcOpts.openFromRemote({}, 'https://x') : 'MISSING';
    check(
      'C233-4',
      '2.33.0 synthetic main.js executes whenReady in VM without ReferenceError and registers hakimi:* IPC before createWindow',
      mainVm.mockErrors.length === 0 &&
        mainVm.getCloseContextMenuCalls() === 1 &&
        hakimiOrderOk &&
        hostBusyVal === false &&
        openRemoteVal === true &&
        mainVm.ipcHandlers.size === 13,
      { errors: mainVm.mockErrors, closeCalls: mainVm.getCloseContextMenuCalls(), hakimiOrderOk, ipcCount: mainVm.ipcHandlers.size }
    );

    // C233-5: 2.32.1 preload lexical scope check (hakimiHost inside else, remote branch untouched)
    const origPre2321 = createSyntheticPreloadJs('2.32.1');
    const origBlocks2321 = extractIfElseBlocks(origPre2321, 'isRemoteWindow');
    const patchedBlocks2321 = extractIfElseBlocks(p2321, 'isRemoteWindow');
    const outsideAfterElse2321 = p2321.slice(patchedBlocks2321.elseEnd + 1);
    check(
      'C233-5',
      '2.32.1 preload.js places hakimiHost strictly inside local else {} block and leaves if(isRemoteWindow) unchanged',
      Boolean(patchedBlocks2321) &&
        patchedBlocks2321.ifBody === origBlocks2321.ifBody &&
        !patchedBlocks2321.ifBody.includes('hakimiHost') &&
        patchedBlocks2321.elseBody.includes("exposeInMainWorld('hakimiHost', hakimiHostAPI)") &&
        !outsideAfterElse2321.includes('hakimiHost'),
      { ifUnchanged: patchedBlocks2321 && patchedBlocks2321.ifBody === origBlocks2321.ifBody }
    );

    // C233-6: 2.33.0 preload lexical scope check (hakimiHost inside else, agyComputerPreview preserved, remote branch untouched)
    const origPre2330 = createSyntheticPreloadJs('2.33.0');
    const origBlocks2330 = extractIfElseBlocks(origPre2330, 'isRemoteWindow');
    const patchedBlocks2330 = extractIfElseBlocks(p2330, 'isRemoteWindow');
    const outsideAfterElse2330 = p2330.slice(patchedBlocks2330.elseEnd + 1);
    check(
      'C233-6',
      '2.33.0 preload.js places hakimiHost inside local else {}, preserves agyComputerPreview, and leaves if(isRemoteWindow) unchanged',
      Boolean(patchedBlocks2330) &&
        patchedBlocks2330.ifBody === origBlocks2330.ifBody &&
        !patchedBlocks2330.ifBody.includes('hakimiHost') &&
        patchedBlocks2330.elseBody.includes("exposeInMainWorld('hakimiHost', hakimiHostAPI)") &&
        patchedBlocks2330.elseBody.includes("exposeInMainWorld('agyComputerPreview', computerPreviewAPI)") &&
        !outsideAfterElse2330.includes('hakimiHost'),
      { ifUnchanged: patchedBlocks2330 && patchedBlocks2330.ifBody === origBlocks2330.ifBody }
    );

    // C233-7: 2.32.1 preload VM simulation (local vs remote)
    const vm2321Local = runPreloadInVm(p2321, false);
    const vm2321Remote = runPreloadInVm(p2321, true);
    const hakimiEntry2321 = vm2321Local.exposed.find((e) => e.key === 'hakimiHost');
    check(
      'C233-7',
      '2.32.1 synthetic preload VM: exposes hakimiHost (13 methods) when local, blocks hakimiHost when isRemoteWindow=true',
      Boolean(hakimiEntry2321) &&
        Object.keys(hakimiEntry2321.api).length === 13 &&
        vm2321Local.duplicateKeys.length === 0 &&
        !vm2321Remote.exposedMap.has('hakimiHost') &&
        vm2321Remote.exposedMap.get('sshRemote') === 1 &&
        vm2321Remote.duplicateKeys.length === 0,
      { localKeys: [...vm2321Local.exposedMap.entries()], remoteKeys: [...vm2321Remote.exposedMap.entries()] }
    );

    // C233-8: 2.33.0 preload VM simulation (local vs remote)
    const vm2330Local = runPreloadInVm(p2330, false);
    const vm2330Remote = runPreloadInVm(p2330, true);
    const hakimiEntry2330 = vm2330Local.exposed.find((e) => e.key === 'hakimiHost');
    check(
      'C233-8',
      '2.33.0 synthetic preload VM: exposes hakimiHost + agyComputerPreview when local, blocks both when isRemoteWindow=true',
      Boolean(hakimiEntry2330) &&
        Object.keys(hakimiEntry2330.api).length === 13 &&
        vm2330Local.exposedMap.get('agyComputerPreview') === 1 &&
        vm2330Local.duplicateKeys.length === 0 &&
        !vm2330Remote.exposedMap.has('hakimiHost') &&
        !vm2330Remote.exposedMap.has('agyComputerPreview') &&
        vm2330Remote.exposedMap.get('sshRemote') === 1 &&
        vm2330Remote.duplicateKeys.length === 0,
      { localKeys: [...vm2330Local.exposedMap.entries()], remoteKeys: [...vm2330Remote.exposedMap.entries()] }
    );

    // C233-9: Idempotency (Hakimi-layer second run exit 0 zero diff; full-patched second run exit 2 zero diff)
    let idemOk = true;
    const idemDetails = {};
    for (const [ver, patchedDir] of [['2.32.1', dir2321], ['2.33.0', dir2330]]) {
      const hakimiOnlyDir = path.join(rootTmp, `idem_hakimi_${ver}`);
      const support = createSyntheticSupportFiles();
      const ymlIdem = writeSyntheticTargetDir(hakimiOnlyDir, ver, {
        'dist/main.js': fs.readFileSync(path.join(patchedDir, 'dist', 'main.js'), 'utf8'),
        'dist/utils.js': fs.readFileSync(path.join(patchedDir, 'dist', 'utils.js'), 'utf8'),
        'dist/preload.js': fs.readFileSync(path.join(patchedDir, 'dist', 'preload.js'), 'utf8'),
        'dist/updater.js': support['dist/updater.js'],
        'dist/ipcHandlers.js': support['dist/ipcHandlers.js'],
        'dist/languageServer.js': support['dist/languageServer.js'],
      });
      const beforeHakimi = ['dist/main.js', 'dist/utils.js', 'dist/preload.js'].map((f) => sha256File(path.join(hakimiOnlyDir, ...f.split('/'))));
      const rHakimi = runPatcher(hakimiOnlyDir, ymlIdem);
      const afterHakimi = ['dist/main.js', 'dist/utils.js', 'dist/preload.js'].map((f) => sha256File(path.join(hakimiOnlyDir, ...f.split('/'))));

      const beforeFull = snapshotDirHashes(patchedDir);
      const rFull = runPatcher(patchedDir, path.join(patchedDir, 'app-update.yml'));
      const afterFull = snapshotDirHashes(patchedDir);

      const okThis =
        rHakimi.status === 0 &&
        JSON.stringify(beforeHakimi) === JSON.stringify(afterHakimi) &&
        rFull.status === 2 &&
        rFull.stderr.includes('already patched') &&
        JSON.stringify(beforeFull) === JSON.stringify(afterFull);
      if (!okThis) idemOk = false;
      idemDetails[ver] = { rHakimiStatus: rHakimi.status, rFullStatus: rFull.status, okThis };
    }
    check('C233-9', 'idempotency: Hakimi-layer rerun exits 0 byte-identical and full-patched rerun fails cleanly (exit 2) without writing', idemOk, idemDetails);

    // C233-10: Negative H_MAIN_4 mutated signature
    {
      const negDir = path.join(rootTmp, 'neg_main4_mut');
      const mutMain = createSyntheticMainJs('2.33.0').replace(
        /const ipc = \(0, ipcHandlers_1\.registerIpcHandlers\)[\s\S]*?\n    \}\);/,
        '    const { closeContextMenu } = registerIpcHandlers(storageManager, hostStores);'
      );
      const ymlNeg = writeSyntheticTargetDir(negDir, '2.33.0', { 'dist/main.js': mutMain });
      const before = snapshotDirHashes(negDir);
      const res = runPatcher(negDir, ymlNeg);
      const after = snapshotDirHashes(negDir);
      check(
        'C233-10',
        'negative H_MAIN_4 mutation exits non-zero (2), names H_MAIN_4, and writes nothing to disk',
        res.status === 2 &&
          res.stderr.includes('H_MAIN_4 registerIpcHandlers') &&
          res.stderr.includes('Nothing was written') &&
          JSON.stringify(before) === JSON.stringify(after),
        { status: res.status, stderr: res.stderr }
      );
    }

    // C233-11: Negative H_MAIN_4 cross-statement broad-regex guard
    {
      const negDir = path.join(rootTmp, 'neg_main4_cross_stmt');
      const crossMain = createSyntheticMainJs('2.33.0').replace(
        /const ipc = \(0, ipcHandlers_1\.registerIpcHandlers\)[\s\S]*?\n    \}\);/,
        [
          '    const ipc = (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {',
          '        nested: { broken: true };',
          '    // missing close here, unrelated block below:',
          '    unrelatedCall({',
          '        foo: 1',
          '    });',
        ].join('\n')
      );
      const ymlNeg = writeSyntheticTargetDir(negDir, '2.33.0', { 'dist/main.js': crossMain });
      const before = snapshotDirHashes(negDir);
      const res = runPatcher(negDir, ymlNeg);
      const after = snapshotDirHashes(negDir);
      check(
        'C233-11',
        'negative H_MAIN_4 rejects cross-statement partial syntax (exit 2) without writing',
        res.status === 2 &&
          res.stderr.includes('H_MAIN_4 registerIpcHandlers') &&
          JSON.stringify(before) === JSON.stringify(after),
        { status: res.status, stderr: res.stderr }
      );
    }

    // C233-12: Negative H_PRELOAD_1 missing createLocalSshRemoteAPI
    {
      const negDir = path.join(rootTmp, 'neg_preload1_missing');
      const mutPre = createSyntheticPreloadJs('2.33.0').replace(
        "exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());",
        "exposeInMainWorld('sshRemote', createRenamedLocalSshAPI());"
      );
      const ymlNeg = writeSyntheticTargetDir(negDir, '2.33.0', { 'dist/preload.js': mutPre });
      const before = snapshotDirHashes(negDir);
      const res = runPatcher(negDir, ymlNeg);
      const after = snapshotDirHashes(negDir);
      check(
        'C233-12',
        'negative H_PRELOAD_1 missing createLocalSshRemoteAPI exits non-zero (2), names H_PRELOAD_1, and writes nothing',
        res.status === 2 &&
          res.stderr.includes('H_PRELOAD_1 exposeInMainWorld sshRemote') &&
          res.stderr.includes('Nothing was written') &&
          JSON.stringify(before) === JSON.stringify(after),
        { status: res.status, stderr: res.stderr }
      );
    }

    // C233-13: Negative H_PRELOAD_1 ambiguous duplicate anchor
    {
      const negDir = path.join(rootTmp, 'neg_preload1_dup');
      const dupPre = createSyntheticPreloadJs('2.33.0').replace(
        "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());",
        "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());\n    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());"
      );
      const ymlNeg = writeSyntheticTargetDir(negDir, '2.33.0', { 'dist/preload.js': dupPre });
      const before = snapshotDirHashes(negDir);
      const res = runPatcher(negDir, ymlNeg);
      const after = snapshotDirHashes(negDir);
      check(
        'C233-13',
        'negative H_PRELOAD_1 rejects ambiguous duplicate match (matched 2 times) without writing',
        res.status === 2 &&
          res.stderr.includes('H_PRELOAD_1 exposeInMainWorld sshRemote') &&
          res.stderr.includes('matched 2 times (expected 1)') &&
          JSON.stringify(before) === JSON.stringify(after),
        { status: res.status, stderr: res.stderr }
      );
    }

    // C233-14: Whitelist & CI/manifest static contract
    {
      const repatchSrc = fs.readFileSync(REPATCH_PS1, 'utf8');
      const restoreSrc = fs.readFileSync(RESTORE_PS1, 'utf8');
      const workflowSrc = fs.readFileSync(WORKFLOW_YML, 'utf8');
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf8'));
      const extractHashes = (src) => {
        const m = src.match(/\$KnownOfficialAsarHashes\s*=\s*@\(([\s\S]*?\r?\n)\)/);
        return m ? (m[1].match(/[0-9A-Fa-f]{64}/g) || []).map((h) => h.toUpperCase()) : [];
      };
      const repHashes = extractHashes(repatchSrc);
      const resHashes = extractHashes(restoreSrc);
      const registeredInManifest = Array.isArray(manifest.files) && manifest.files.some((f) => f.path === 'tests/test_compat_233_unit.js');
      check(
        'C233-14',
        'repatch.ps1 & restore-official.ps1 whitelists contain 2.32.1 & 2.33.0 hashes, CI & manifest include test_compat_233_unit.js',
        repHashes.length === 2 &&
          resHashes.length === 2 &&
          repHashes.includes(OFFICIAL_2321_SHA256) &&
          repHashes.includes(OFFICIAL_2330_SHA256) &&
          resHashes.includes(OFFICIAL_2321_SHA256) &&
          resHashes.includes(OFFICIAL_2330_SHA256) &&
          !repHashes.includes(KNOWN_PREPATCHED_ZH_SHA256) &&
          !resHashes.includes(KNOWN_PREPATCHED_ZH_SHA256) &&
          workflowSrc.includes('node tests/test_compat_233_unit.js') &&
          registeredInManifest,
        { repHashes, resHashes, hasCiStep: workflowSrc.includes('node tests/test_compat_233_unit.js'), registeredInManifest }
      );
    }

    // C233-15: Windows-only synthetic repatch.ps1 & restore-official.ps1 repeat + unknown hash rejection
    if (process.platform !== 'win32') {
      skip(
        'C233-15',
        'Windows synthetic 2.33.0 repatch.ps1 repeat & unknown hash rejection',
        'requires win32 + powershell.exe; process.platform=' + process.platform
      );
    } else {
      const fakeBin = path.join(rootTmp, 'fakebin');
      const psTmp = path.join(rootTmp, 'pstmp');
      fs.mkdirSync(fakeBin, { recursive: true });
      fs.mkdirSync(psTmp, { recursive: true });
      const fakeAsarJs = `'use strict';
const fs = require('fs');
const path = require('path');
const cmd = process.argv[2];
function collect(root, cur, out) {
  for (const n of fs.readdirSync(cur)) {
    const f = path.join(cur, n);
    if (fs.statSync(f).isDirectory()) collect(root, f, out);
    else out[path.relative(root, f).split(path.sep).join('/')] = fs.readFileSync(f, 'utf8');
  }
}
if (cmd === '--version') { console.log('v0.0.0-fake'); process.exit(0); }
if (cmd === 'extract') {
  const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  for (const r of Object.keys(b.files)) {
    const p = path.join(process.argv[4], ...r.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, b.files[r], 'utf8');
  }
  process.exit(0);
}
if (cmd === 'pack') {
  const files = {};
  collect(process.argv[3], process.argv[3], files);
  fs.mkdirSync(path.dirname(process.argv[4]), { recursive: true });
  fs.writeFileSync(process.argv[4], JSON.stringify({ tag: 'PATCHED', files }, null, 2), 'utf8');
  process.exit(0);
}
if (cmd === 'list') {
  const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  for (const r of Object.keys(b.files).sort()) console.log('\\\\' + r.split('/').join('\\\\'));
  process.exit(0);
}
process.exit(2);
`;
      fs.writeFileSync(path.join(fakeBin, 'fake_asar.js'), fakeAsarJs, 'utf8');
      fs.writeFileSync(path.join(fakeBin, 'asar.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake_asar.js" %*\r\n`, 'utf8');

      const appDir = path.join(rootTmp, 'ps_app');
      const modKit = path.join(appDir, 'mod_kit');
      const resDir = path.join(appDir, 'resources');
      fs.mkdirSync(modKit, { recursive: true });
      fs.mkdirSync(resDir, { recursive: true });
      fs.copyFileSync(REPATCH_PS1, path.join(modKit, 'repatch.ps1'));
      fs.copyFileSync(PATCH_JS, path.join(modKit, 'patch.js'));
      fs.copyFileSync(AGM_LOCKS_JS, path.join(modKit, 'agm_locks.js'));
      fs.copyFileSync(AGM_IPC_AUTH_JS, path.join(modKit, 'agm_ipc_auth.js'));
      fs.copyFileSync(AGM_UPDATER_AUTH_JS, path.join(modKit, 'agm_updater_auth.js'));
      fs.copyFileSync(REAPER_CORE_JS, path.join(modKit, 'agm_sidecar_reaper_core.js'));
      fs.copyFileSync(TEMPLATE_YML, path.join(resDir, 'app-update.yml'));

      const bundle2330 = JSON.stringify({
        tag: 'SYNTH_2330',
        files: {
          'dist/main.js': createSyntheticMainJs('2.33.0'),
          'dist/preload.js': createSyntheticPreloadJs('2.33.0'),
          ...createSyntheticSupportFiles(),
        },
      }, null, 2);
      const asarPath = path.join(resDir, 'app.asar');
      fs.writeFileSync(asarPath, bundle2330, 'utf8');
      const synthHash = sha256File(asarPath);

      const psEnv = {
        ...process.env,
        PATH: fakeBin + path.delimiter + (process.env.PATH || ''),
        TEMP: psTmp,
        TMP: psTmp,
      };
      const runPs = (script, extraEnv, extraArgs = []) => spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-TargetAppDir', appDir, ...extraArgs],
        { encoding: 'utf8', env: { ...psEnv, ...extraEnv }, timeout: 30000 }
      );

      // Unknown unwhitelisted hash must fail with exit 4 on repatch and restore (-VerifyOnly)
      const unkRepatch = runPs(path.join(modKit, 'repatch.ps1'), { AGM_OFFICIAL_ASAR_SHA256: '' });
      const bakPath = path.join(resDir, 'app.asar.bak');
      fs.writeFileSync(bakPath, '{"unknown":true}', 'utf8');
      const unkRestore = runPs(RESTORE_PS1, { AGM_OFFICIAL_ASAR_SHA256: '' }, ['-VerifyOnly']);
      fs.unlinkSync(bakPath);

      // Allowed synthetic hash: round 1 + round 2 repeat
      const r1 = runPs(path.join(modKit, 'repatch.ps1'), { AGM_OFFICIAL_ASAR_SHA256: synthHash });
      const bakHash1 = fs.existsSync(bakPath) ? sha256File(bakPath) : 'MISSING';
      const r2 = runPs(path.join(modKit, 'repatch.ps1'), { AGM_OFFICIAL_ASAR_SHA256: synthHash });
      const bakHash2 = fs.existsSync(bakPath) ? sha256File(bakPath) : 'MISSING';
      const moddedPrevs = fs.readdirSync(resDir).filter((n) => n.startsWith('app.asar.modded_prev_'));
      const packed = JSON.parse(fs.readFileSync(asarPath, 'utf8'));
      const mainHasIpc = packed.files['dist/main.js'].includes('const ipc = (0, ipcHandlers_1.registerIpcHandlers)');
      const preBlocks = extractIfElseBlocks(packed.files['dist/preload.js'], 'isRemoteWindow');

      check(
        'C233-15',
        'Windows synthetic 2.33.0 repatch.ps1 succeeds twice (preserving .bak and const ipc) and rejects unknown hashes (exit 4)',
        unkRepatch.status === 4 &&
          unkRestore.status === 4 &&
          r1.status === 0 &&
          r2.status === 0 &&
          bakHash1 === synthHash &&
          bakHash2 === synthHash &&
          moddedPrevs.length === 1 &&
          mainHasIpc &&
          Boolean(preBlocks) &&
          preBlocks.elseBody.includes("exposeInMainWorld('hakimiHost', hakimiHostAPI)") &&
          preBlocks.elseBody.includes("exposeInMainWorld('agyComputerPreview', computerPreviewAPI)"),
        {
          unkRepatch: unkRepatch.status,
          unkRestore: unkRestore.status,
          r1: r1.status,
          r2: r2.status,
          bakHash1,
          bakHash2,
          moddedPrevs,
          mainHasIpc,
        }
      );
    }
  } finally {
    try { fs.rmSync(rootTmp, { recursive: true, force: true }); } catch (_) {}
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;
  console.log(`SUMMARY pass=${passCount} fail=${failCount} skip=${skipCount}`);
  if (process.platform === 'win32' && skipCount > 0) {
    console.error('FATAL: SKIP is not allowed on Windows for Windows-only cases.');
    process.exitCode = 1;
  } else {
    process.exitCode = failCount ? 1 : 0;
  }
}

runAll().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
