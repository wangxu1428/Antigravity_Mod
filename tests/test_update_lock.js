// tests/test_update_lock.js : Offline unit & harness verification for platform/mod_kit/agm_locks.js (UL1-UL7)
// Relative paths from repository root; zero network or production disk writes.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const REPO_ROOT = path.resolve(__dirname, '..');
const agmLocks = require(path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_locks.js'));
const templateYmlPath = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');

const results = [];
const L = {
  T: REPO_ROOT,
  info(m) { console.log('INFO ' + m); },
  check(id, desc, cond, detail) {
    if (cond) {
      results.push({ id, ok: true });
      console.log(`PASS ${id} ${desc}`);
    } else {
      results.push({ id, ok: false });
      const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
      console.log(`FAIL ${id} ${desc} :: ${msg}`);
    }
  },
  done() {
    const f = results.filter((r) => !r.ok).length;
    console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
    process.exitCode = f ? 1 : 0;
  },
};

function createSyntheticFixtureDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm_ul_test_'));
  const distDir = path.join(tmpDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const updaterSrc = `'use strict';
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
let _lastState = { type: 'idle' };
let _timer = null;
function broadcastState(st) { _lastState = st; }
function getLastState() { return _lastState; }
function setAutoUpdateChecking(enabled) {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (enabled) { _timer = setInterval(() => { checkForUpdates(false); }, 3600000); }
}
function checkForUpdates(isManual = false) {
    return electron_updater_1.autoUpdater.checkForUpdates();
}
function quitAndInstall() {
    return electron_updater_1.autoUpdater.quitAndInstall();
}
function applyHostUpdate() {
    if (_lastState.type === 'ready') { return quitAndInstall(); }
    checkForUpdates(true);
    return true;
}
function headlessQuitAndInstall(downloadedFilePath) {
    return electron_updater_1.autoUpdater.quitAndInstall();
}
function initAutoUpdater(isPackaged, settingsService) {
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = electron_1.app.isPackaged;
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        headlessQuitAndInstall(info && info.downloadedFile);
    });
    if (settingsService && settingsService.onSettingChanged) {
        settingsService.onSettingChanged('autoCheck', (val) => setAutoUpdateChecking(Boolean(val)));
    }
    setTimeout(() => { checkForUpdates(false); }, 15000);
}
const updateActions = {
    'Check for Updates': () => checkForUpdates(true),
    'Restart to Update': () => quitAndInstall(),
};
module.exports = {
    initAutoUpdater,
    setAutoUpdateChecking,
    checkForUpdates,
    quitAndInstall,
    applyHostUpdate,
    headlessQuitAndInstall,
    broadcastState,
    getLastState,
    updateActions,
};
`;

  const ipcSrc = `'use strict';
const electron_1 = require("electron");
const updater_1 = require("./updater");
function registerIpcHandlers(storage, opts) {
    const localOnly = (channel, fn) => {
        electron_1.ipcMain.handle(channel, fn);
    };
    localOnly('updater:quit-and-install', () => {
        return updater_1.quitAndInstall();
    });
    localOnly('updater:apply', async () => {
        updater_1.broadcastState({ type: 'ready' });
        return updater_1.applyHostUpdate();
    });
    localOnly('updater:check-for-updates', () => {
        return updater_1.checkForUpdates(true);
    });
}
module.exports = { registerIpcHandlers };
`;

  const lsSrc = `'use strict';
const child_process_1 = require("child_process");
let _lsProcess = null;
function clearLsProcess() { _lsProcess = null; }
function startLs(spawnCmd, spawnArgs, env) {
    _lsProcess = (0, child_process_1.spawn)(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
    });
}
async function killLanguageServer() {
    const proc = _lsProcess;
    const pid = proc && proc.pid;
    if (proc) {
        const exitPromise = new Promise((resolve) => {
            proc.once('exit', () => {
                resolve();
            });
        });
        if (pid) {
            try {
                process.kill(pid);
                await exitPromise;
            }
            catch {
                // Process already dead or exited
            }
        }
        clearLsProcess();
    }
}
module.exports = { startLs, killLanguageServer };
`;

  fs.writeFileSync(path.join(distDir, 'updater.js'), updaterSrc, 'utf8');
  fs.writeFileSync(path.join(distDir, 'ipcHandlers.js'), ipcSrc, 'utf8');
  fs.writeFileSync(path.join(distDir, 'languageServer.js'), lsSrc, 'utf8');
  const ymlCopy = path.join(tmpDir, 'app-update.yml');
  fs.copyFileSync(templateYmlPath, ymlCopy);

  return { tmpDir, distDir, ymlCopy };
}

(async () => {
  const { tmpDir, distDir, ymlCopy } = createSyntheticFixtureDir();
  try {
    // Verify preflight + apply on synthetic fixture
    agmLocks.apply(tmpDir, ['--update-yml', ymlCopy]);

    const calls = [];
    const logs = [];
    const handlers = {};
    const quitCbs = [];

    class FakeAutoUpdater extends EventEmitter {
      constructor() {
        super();
        this.autoDownload = true;
        this.autoInstallOnAppQuit = true;
        this.downloadedUpdateHelper = {
          file: path.join(REPO_ROOT, 'tests', 'fixtures', 'fake-installer.exe'),
          downloadedFileInfo: { isAdminRightsRequired: false },
        };
      }
      checkForUpdates() { calls.push('checkForUpdates'); return Promise.resolve(null); }
      checkForUpdatesAndNotify() { calls.push('checkForUpdatesAndNotify'); return Promise.resolve(null); }
      downloadUpdate() { calls.push('downloadUpdate'); return Promise.resolve(null); }
      doInstall() { calls.push('doInstall'); return true; }
      install() { return this.doInstall(); }
      quitAndInstall() { return this.doInstall(); }
      addQuitHandler() {
        quitCbs.push(() => {
          logs.push('Auto install update on quit');
          this.doInstall();
        });
      }
    }

    const au = new FakeAutoUpdater();
    const Module = require('module');
    const origLoad = Module._load;
    const updaterPath = path.join(distDir, 'updater.js');
    const ipcPath = path.join(distDir, 'ipcHandlers.js');

    let updaterMod = null;
    Module._load = function (req, parent, isMain) {
      if (req === 'electron') {
        return {
          app: { isPackaged: true, getVersion: () => '2.32.1', quit() { calls.push('electron.app.quit'); } },
          ipcMain: { handle(ch, fn) { handlers[ch] = fn; } },
        };
      }
      if (req === 'electron-updater') {
        return { autoUpdater: au };
      }
      if (req === './updater' && updaterMod) {
        return updaterMod;
      }
      return origLoad.apply(this, arguments);
    };

    const _st = global.setTimeout;
    global.setTimeout = (fn, ms, ...a) => _st(fn, ms >= 10000 ? 30 : ms, ...a);

    updaterMod = require(updaterPath);
    const ipcMod = require(ipcPath);

    const record = (id, desc, from, extraOk = true, extra = '') => {
      const r = calls.slice(from);
      L.check(id, desc, r.length === 0 && extraOk, { reached: r, extra });
    };

    // UL1: timer entry + setting toggles
    let savedCb = null;
    const settings = { getSetting: async () => true, onSettingChanged: (k, cb) => { savedCb = cb; } };
    let n = calls.length;
    updaterMod.initAutoUpdater(true, settings);
    await new Promise((r) => _st(r, 80));
    if (savedCb) savedCb(true);
    updaterMod.setAutoUpdateChecking(true);
    await new Promise((r) => _st(r, 30));
    record('UL1', 'timer entry (initial delayed check + setting toggles) never reaches autoUpdater', n);

    // UL2: menu entries
    n = calls.length;
    updaterMod.updateActions['Check for Updates']();
    updaterMod.updateActions['Restart to Update']();
    await new Promise((r) => _st(r, 20));
    record('UL2', 'menu entries (Check for Updates / Restart to Update) blocked', n);

    // UL3a/3b/3c: IPC entries
    ipcMod.registerIpcHandlers({}, {});
    n = calls.length;
    await handlers['updater:check-for-updates']({ sender: {} });
    record('UL3a', 'IPC updater:check-for-updates blocked', n, Boolean(handlers['updater:check-for-updates']));

    n = calls.length;
    updaterMod.broadcastState({ type: 'idle' });
    await handlers['updater:apply']({ sender: {} });
    const state3b = updaterMod.getLastState()?.type;
    record('UL3b', 'IPC updater:apply blocked (state stays non-ready)', n, state3b !== 'ready', `state=${state3b}`);

    n = calls.length;
    await handlers['updater:quit-and-install']({ sender: {} });
    record('UL3c', 'IPC updater:quit-and-install blocked', n, Boolean(handlers['updater:quit-and-install']));

    // UL4: host bridge applyHostUpdate
    n = calls.length;
    const rets = [];
    for (const s of ['idle', 'ready', 'downloading']) {
      updaterMod.broadcastState({ type: s, update: { version: '9.9.9' } });
      rets.push(updaterMod.applyHostUpdate());
    }
    record('UL4', 'host bridge applyHostUpdate returns false and never reaches autoUpdater', n, rets.every((x) => x === false));

    // UL5: direct autoUpdater methods + headless update-downloaded
    n = calls.length;
    au.quitAndInstall();
    au.install();
    au.emit('update-downloaded', { version: '9.9.9' });
    await new Promise((r) => _st(r, 30));
    record('UL5', 'direct autoUpdater.quitAndInstall/install + headless update-downloaded never launch installer', n);

    // UL6: normal app quit
    n = calls.length;
    const l0 = logs.length;
    au.addQuitHandler();
    for (const cb of quitCbs) cb(0);
    const autoLog = logs.slice(l0).some((m) => /Auto install update on quit/.test(m));
    record('UL6', 'normal app quit (exit 0) does not trigger installer', n, !autoLog);

    // UL7: autoDownload / autoInstallOnAppQuit locked to false
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    L.check('UL7', 'autoDownload / autoInstallOnAppQuit forced false, assignments ignored', au.autoDownload === false && au.autoInstallOnAppQuit === false);

    Module._load = origLoad;
    global.setTimeout = _st;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
  L.done();
})().catch((e) => {
  console.log('FAIL CRASH ' + (e && e.stack));
  process.exit(1);
});
