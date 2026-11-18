// =============================================================================
// AGM locks for Hakimi Mod Kit (platform/mod_kit/agm_locks.js)
//   AGM_UPDATE_LOCK    : updater.js / ipcHandlers.js  (all update entries -> blocked)
//   AGM_SIDECAR_REAPER : languageServer.js           (session sidecar cleanup)
//   app-update.yml     : updaterCacheDirName=antigravity-mod-updater, keep dead URL
// Every anchor must match EXACTLY once; otherwise the build fails (exit 2) before
// any file is written.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const MOD_CACHE_DIR = 'antigravity-mod-updater';
const DEAD_URL_RE = /^url:\s*http:\/\/127\.0\.0\.1:9\//m;

class AgmBuildError extends Error {}
function fatal(msg) { throw new AgmBuildError(msg); }

const LOCK_HELPER = `
// --- AGM_UPDATE_LOCK helper ---
function __agmLockAutoUpdater(au) {
    if (!au || au.__agmLocked) return au;
    const log = (m) => console.log('[AGM][UpdateLock] ' + m);
    const blockedP = (name) => function () { log('blocked ' + name); return Promise.resolve(null); };
    const blockedF = (name) => function () { log('blocked ' + name); return false; };
    try { Object.defineProperty(au, 'autoDownload', { configurable: true, enumerable: true, get: () => false, set: () => log('ignored autoDownload assignment') }); } catch (e) { au.autoDownload = false; }
    try { Object.defineProperty(au, 'autoInstallOnAppQuit', { configurable: true, enumerable: true, get: () => false, set: () => log('ignored autoInstallOnAppQuit assignment') }); } catch (e) { au.autoInstallOnAppQuit = false; }
    au.checkForUpdates = blockedP('checkForUpdates');
    au.checkForUpdatesAndNotify = blockedP('checkForUpdatesAndNotify');
    au.downloadUpdate = blockedP('downloadUpdate');
    au.quitAndInstall = blockedF('quitAndInstall');
    au.install = blockedF('install');
    au.doInstall = blockedF('doInstall');
    au.addQuitHandler = function () { log('blocked addQuitHandler'); };
    Object.defineProperty(au, '__agmLocked', { value: true });
    log('updater locked');
    return au;
}
// --- end AGM_UPDATE_LOCK helper ---
`;

// [file, name, regex, replacement(fn of match)]
const UPDATE_ANCHORS = [
    ['dist/updater.js', 'U1 require electron-updater',
        /const electron_updater_1 = require\("electron-updater"\);\n/,
        (m) => m + LOCK_HELPER],
    ['dist/updater.js', 'U2 initAutoUpdater autoDownload/autoInstallOnAppQuit',
        /electron_updater_1\.autoUpdater\.autoDownload = true;\n(\s*)electron_updater_1\.autoUpdater\.autoInstallOnAppQuit = electron_1\.app\.isPackaged;\n/,
        (m, ind) => `// AGM_UPDATE_LOCK: auto download / install-on-quit disabled\n${ind}__agmLockAutoUpdater(electron_updater_1.autoUpdater);\n`],
    ['dist/updater.js', 'U3 setAutoUpdateChecking (timer entry)',
        /function setAutoUpdateChecking\(enabled\) \{\n/,
        (m) => m + `    if (enabled) { console.log('[AGM][UpdateLock] blocked periodic update checks'); }\n    enabled = false; // AGM_UPDATE_LOCK\n`],
    ['dist/updater.js', 'U4 checkForUpdates (menu / IPC check entry)',
        /function checkForUpdates\(isManual = false\) \{\n/,
        (m) => m + `    console.log('[AGM][UpdateLock] blocked checkForUpdates manual=' + isManual); return; // AGM_UPDATE_LOCK\n`],
    ['dist/updater.js', 'U5 quitAndInstall (menu Restart to Update)',
        /function quitAndInstall\(\) \{\n/,
        (m) => m + `    console.log('[AGM][UpdateLock] blocked quitAndInstall'); return false; // AGM_UPDATE_LOCK\n`],
    ['dist/updater.js', 'U6 applyHostUpdate (language server / host bridge entry)',
        /function applyHostUpdate\(\) \{\n/,
        (m) => m + `    console.log('[AGM][UpdateLock] blocked applyHostUpdate'); return false; // AGM_UPDATE_LOCK\n`],
    ['dist/updater.js', 'U7 headlessQuitAndInstall (headless install path)',
        /function headlessQuitAndInstall\(downloadedFilePath\) \{\n/,
        (m) => m + `    console.log('[AGM][UpdateLock] blocked headlessQuitAndInstall'); return; // AGM_UPDATE_LOCK\n`],
    ['dist/ipcHandlers.js', 'I1 IPC updater:quit-and-install',
        /(localOnly\('updater:quit-and-install', \(\) => \{\n)/,
        (m) => m + `        console.log('[AGM][UpdateLock] blocked IPC updater:quit-and-install'); return false; // AGM_UPDATE_LOCK\n`],
    ['dist/ipcHandlers.js', 'I2 IPC updater:apply',
        /(localOnly\('updater:apply', async \(\) => \{\n)/,
        (m) => m + `        console.log('[AGM][UpdateLock] blocked IPC updater:apply'); return false; // AGM_UPDATE_LOCK\n`],
    ['dist/ipcHandlers.js', 'I3 IPC updater:check-for-updates',
        /(localOnly\('updater:check-for-updates', \(\) => \{\n)/,
        (m) => m + `        console.log('[AGM][UpdateLock] blocked IPC updater:check-for-updates'); return false; // AGM_UPDATE_LOCK\n`],
];

function reaperBlock() {
    const core = fs.readFileSync(path.join(__dirname, 'agm_sidecar_reaper_core.js'), 'utf8');
    return `\n// --- AGM_SIDECAR_REAPER ---\nconst __agmReaper = (function () {\n${core}\n    try { return createSidecarReaper({}); } catch (e) { console.error('[AGM][Reaper] init failed', e); return null; }\n})();\nlet __agmHistoricalChecked = false;\n// --- end AGM_SIDECAR_REAPER ---\n`;
}
const REAPER_ANCHORS = [
    ['dist/languageServer.js', 'R1 module state (_lsProcess declaration)',
        /let _lsProcess = null;\n/,
        (m) => m + reaperBlock()],
    ['dist/languageServer.js', 'R2 LS spawn',
        /(\s*)_lsProcess = \(0, child_process_1\.spawn\)\(spawnCmd, spawnArgs, \{\n\s*stdio: \['pipe', 'pipe', 'pipe'\],\n\s*env,\n\s*\}\);\n/,
        (m, ind) => m + `${ind.replace(/^\n+/, '')}// AGM_SIDECAR_REAPER: record LS identity, detect (log-only) historical orphans once\n${ind.replace(/^\n+/, '')}if (__agmReaper && _lsProcess && _lsProcess.pid) { const __p = _lsProcess.pid; void __agmReaper.onLsSpawn(__p).then(() => { if (!__agmHistoricalChecked) { __agmHistoricalChecked = true; return __agmReaper.detectHistorical(); } }).catch((e) => console.error('[AGM][Reaper]', e)); const __agmTimer = setInterval(() => { if (_lsProcess && _lsProcess.pid === __p) { void __agmReaper.snapshot(__p).catch(() => {}); } else { clearInterval(__agmTimer); } }, 60000); if (__agmTimer.unref) __agmTimer.unref(); }\n`],
    ['dist/languageServer.js', 'R3 killLanguageServer pre-SIGTERM snapshot (after exit listener)',
        /(        const exitPromise = new Promise\(\(resolve\) => \{\n            proc\.once\('exit', \(\) => \{\n                resolve\(\);\n            \}\);\n        \}\);\n)/,
        (m) => m + `        // AGM_SIDECAR_REAPER: record this session's sidecar tree while the LS is still alive\n        if (__agmReaper && pid !== undefined) { try { await __agmReaper.snapshot(pid); } catch (e) { console.error('[AGM][Reaper] snapshot failed', e); } }\n`],
    ['dist/languageServer.js', 'R4 killLanguageServer post-exit reap',
        /(            catch \{\n                \/\/ Process already dead or exited\n            \}\n        \}\n        clearLsProcess\(\);\n    \}\n)/,
        (m) => m + `    // AGM_SIDECAR_REAPER: graceful first, then verified single-PID kill of leftovers (runs even if LS already gone)\n    if (__agmReaper) { try { await __agmReaper.reap(); } catch (e) { console.error('[AGM][Reaper] reap failed', e); } }\n`],
];
const ALL = [...UPDATE_ANCHORS, ...REAPER_ANCHORS];
const MARKERS = { 'dist/updater.js': 'AGM_UPDATE_LOCK helper', 'dist/ipcHandlers.js': 'blocked IPC updater:quit-and-install', 'dist/languageServer.js': 'AGM_SIDECAR_REAPER ---' };

function countMatches(src, re) { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); return (src.match(g) || []).length; }

function preflight(targetDir) {
    const problems = [];
    const files = {};
    for (const [rel, name, re] of ALL) {
        const p = path.join(targetDir, ...rel.split('/'));
        if (!(rel in files)) files[rel] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
        const src = files[rel];
        if (src == null) { problems.push(`${rel}: file missing (${name})`); continue; }
        if (src.includes(MARKERS[rel]) || src.includes('AGM_UPDATE_LOCK') || src.includes('AGM_SIDECAR_REAPER')) { problems.push(`${rel}: input is already patched (expected a pristine app.asar.bak extract)`); continue; }
        const n = countMatches(src, re);
        if (n !== 1) problems.push(`${rel}: anchor "${name}" matched ${n} times (expected 1)`);
    }
    try { fs.accessSync(path.join(__dirname, 'agm_sidecar_reaper_core.js'), fs.constants.R_OK); } catch (e) { problems.push('agm_sidecar_reaper_core.js not readable'); }
    if (problems.length) fatal('AGM lock injection anchors missing/ambiguous:\n  - ' + problems.join('\n  - '));
    return files;
}

function apply(targetDir, argv) {
    const files = preflight(targetDir);
    const yi = argv.indexOf('--update-yml');
    if (yi >= 0) checkUpdateYml(argv[yi + 1]); // validate BEFORE writing any JS file
    for (const rel of Object.keys(files)) {
        let src = files[rel];
        for (const [r, name, re, rep] of ALL) {
            if (r !== rel) continue;
            src = src.replace(re, rep);
            console.log(`[Patch][AGM] ${rel}: injected ${name}`);
        }
        if (!src.includes(MARKERS[rel])) fatal(`${rel}: post-check failed, marker missing`);
        fs.writeFileSync(path.join(targetDir, ...rel.split('/')), src, 'utf8');
    }
    const i = argv.indexOf('--update-yml');
    if (i >= 0) lockUpdateYml(argv[i + 1]);
    return Object.keys(files).map((rel) => path.join(targetDir, ...rel.split('/')));
}

function checkUpdateYml(ymlPath) {
    if (!ymlPath || !fs.existsSync(ymlPath)) fatal(`app-update.yml not found: ${ymlPath}`);
    const y = fs.readFileSync(ymlPath, 'utf8');
    if (!DEAD_URL_RE.test(y)) fatal(`app-update.yml url is not the invalidated 127.0.0.1:9 address; refusing to build (${ymlPath})`);
    if (!/^updaterCacheDirName:/m.test(y)) fatal('app-update.yml has no updaterCacheDirName line');
    return y;
}

function lockUpdateYml(ymlPath) {
    let y = checkUpdateYml(ymlPath);
    y = y.replace(/^updaterCacheDirName:.*$/m, `updaterCacheDirName: ${MOD_CACHE_DIR}`);
    fs.writeFileSync(ymlPath, y, 'utf8');
    console.log(`[Patch][AGM] app-update.yml: updaterCacheDirName=${MOD_CACHE_DIR}, dead URL kept`);
}

module.exports = { preflight, apply, checkUpdateYml, lockUpdateYml, AgmBuildError, MOD_CACHE_DIR, ALL };