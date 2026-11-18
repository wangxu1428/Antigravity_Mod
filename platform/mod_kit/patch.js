// =============================================================================
// Hakimi Mod Kit - JS Patcher (platform/mod_kit/patch.js)
// Accurately patches main.js, utils.js, and preload.js with zero escaping issues.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetDir = process.argv[2];
if (!targetDir || !fs.existsSync(targetDir)) {
    console.error('Usage: node patch.js <unpacked_temp_dir>');
    process.exit(1);
}

const mainJsPath = path.join(targetDir, 'dist', 'main.js');
const utilsJsPath = path.join(targetDir, 'dist', 'utils.js');
const preloadJsPath = path.join(targetDir, 'dist', 'preload.js');

console.log('[Patch] Patching target dir:', targetDir);

// --- AGM: preflight every lock anchor BEFORE writing anything; missing anchor => build fails ---
const agmLocks = require('./agm_locks');
try {
    agmLocks.preflight(targetDir);
    const agmYi = process.argv.indexOf('--update-yml');
    if (agmYi >= 0) agmLocks.checkUpdateYml(process.argv[agmYi + 1]);
} catch (e) {
    console.error('[Patch][AGM] FATAL: ' + e.message);
    console.error('[Patch][AGM] Build aborted: AGM_UPDATE_LOCK / AGM_SIDECAR_REAPER could not be injected. Nothing was written.');
    process.exit(2);
}

// --- Read source files into memory before any write ---
if (!fs.existsSync(mainJsPath) || !fs.existsSync(utilsJsPath) || !fs.existsSync(preloadJsPath)) {
    console.error('[Patch][Hakimi] FATAL: missing dist/main.js, dist/utils.js, or dist/preload.js');
    process.exit(2);
}

let mainJs = fs.readFileSync(mainJsPath, 'utf8');
let utilsJs = fs.readFileSync(utilsJsPath, 'utf8');
let preloadJs = fs.readFileSync(preloadJsPath, 'utf8');

function countLiteral(src, needle) {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = src.indexOf(needle, idx)) !== -1) {
        count++;
        idx += needle.length;
    }
    return count;
}

function countRegex(src, re) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    return (src.match(g) || []).length;
}

const readyTargetRe = /    \(0, ipcHandlers_1\.registerIpcHandlers\)\(storageManager, \{\r?\n        resolveStorage: \(sender\) => hostStores\.forSender\(sender\),\r?\n        sidecarRoutesFor: \(sender\) => remoteManager\?\.sidecarRoutesFor\(sender\),\r?\n    \}\);/;
const bridgeMarkerRe = /    electron_1\.contextBridge\.exposeInMainWorld\('sshRemote', createLocalSshRemoteAPI\(\)\);\r?\n\}/;

function preflightHakimiAnchors(mJs, uJs, pJs) {
    const problems = [];
    const checkLit = (fileLabel, src, name, marker, anchor) => {
        if (src.includes(marker)) return; // idempotent: already patched
        const n = countLiteral(src, anchor);
        if (n !== 1) problems.push(`${fileLabel}: anchor "${name}" matched ${n} times (expected 1)`);
    };
    const checkRe = (fileLabel, src, name, marker, re) => {
        if (src.includes(marker)) return; // idempotent: already patched
        const n = countRegex(src, re);
        if (n !== 1) problems.push(`${fileLabel}: anchor "${name}" matched ${n} times (expected 1)`);
    };

    checkLit('dist/main.js', mJs, 'H_MAIN_1 requestSingleInstanceLock', 'Hakimi Portable UserData Lock', 'const gotTheLock = electron_1.app.requestSingleInstanceLock();');
    checkLit('dist/main.js', mJs, 'H_MAIN_2 registerCustomSchemes', 'registerHakimiIpcHandlers', '(0, customScheme_1.registerCustomSchemes)();');
    checkLit('dist/main.js', mJs, 'H_MAIN_3 session-created', 'configureHakimiSession(targetSession);', "electron_1.app.on('session-created', (targetSession) => {");
    checkRe('dist/main.js', mJs, 'H_MAIN_4 registerIpcHandlers', 'Register Hakimi IPC and Sessions', readyTargetRe);

    checkLit('dist/utils.js', uJs, 'H_UTILS_1 webviewTag', 'webviewTag: true,', 'webviewTag: builtInBrowser,');
    checkLit('dist/utils.js', uJs, 'H_UTILS_2 devTools', 'devTools: true,', 'devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),');

    checkRe('dist/preload.js', pJs, 'H_PRELOAD_1 exposeInMainWorld sshRemote', "exposeInMainWorld('hakimiHost'", bridgeMarkerRe);
    if (!pJs.includes('HakimiPluginHost Initializer')) {
        const n = countLiteral(pJs, 'if (!isRemoteWindow)');
        if (n < 1) problems.push(`dist/preload.js: anchor "H_PRELOAD_2 isRemoteWindow" matched ${n} times (expected >= 1)`);
    }

    if (problems.length > 0) {
        console.error('[Patch][Hakimi] FATAL: anchor missing/ambiguous:\n  - ' + problems.join('\n  - '));
        console.error('[Patch][Hakimi] Build aborted. Nothing was written.');
        process.exit(2);
    }
}

preflightHakimiAnchors(mainJs, utilsJs, preloadJs);

// -----------------------------------------------------------------------------
// 1. Patch dist/main.js
// -----------------------------------------------------------------------------

// Portable UserData Lock
const lockTarget = 'const gotTheLock = electron_1.app.requestSingleInstanceLock();';
const lockReplacement = `// --- Hakimi Portable UserData Lock ---
try {
    const exeDir = path.dirname(process.execPath);
    const portableUserData = path.join(exeDir, 'UserData');
    if (fs.existsSync(portableUserData)) {
        electron_1.app.setPath('userData', portableUserData);
    }
} catch (err) {
    console.error('[Hakimi] Failed to set portable userData:', err);
}
// -------------------------------------
const gotTheLock = electron_1.app.requestSingleInstanceLock();`;

if (mainJs.includes(lockTarget) && !mainJs.includes('Hakimi Portable UserData Lock')) {
    mainJs = mainJs.replace(lockTarget, lockReplacement);
    console.log('[Patch] main.js: Injected Portable UserData Lock.');
}

// Session & IPC Management
const schemesTarget = '(0, customScheme_1.registerCustomSchemes)();';
const schemesReplacement = `// --- Hakimi Webview & Header Management ---
function configureHakimiSession(sess) {
    if (!sess || !sess.webRequest) return;
    try {
        sess.webRequest.onBeforeSendHeaders((details, callback) => {
            const requestHeaders = { ...details.requestHeaders };
            for (const k of Object.keys(requestHeaders)) {
                if (k.toLowerCase() === 'user-agent') {
                    requestHeaders[k] = requestHeaders[k]
                        .replace(/Electron\\/[^\\s]+\\s*/gi, '')
                        .replace(/Antigravity\\/[^\\s]+\\s*/gi, '');
                }
            }
            callback({ cancel: false, requestHeaders });
        });
    } catch (_) {}
    try {
        sess.webRequest.onHeadersReceived((details, callback) => {
            if (!details.responseHeaders) return callback({ cancel: false });
            const responseHeaders = { ...details.responseHeaders };
            for (const key of Object.keys(responseHeaders)) {
                const lower = key.toLowerCase();
                if (lower === 'x-frame-options') {
                    delete responseHeaders[key];
                } else if (lower === 'content-security-policy') {
                    responseHeaders[key] = responseHeaders[key].map(csp => 
                        csp.replace(/frame-ancestors\\s+[^;]+(;?)/gi, '')
                    );
                }
            }
            callback({ cancel: false, responseHeaders });
        });
    } catch (_) {}
}

function registerHakimiIpcHandlers() {
    const getPluginsDir = () => path.join(path.dirname(process.execPath), 'plugins');

    const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
    const assertSafeId = (id) => {
        if (typeof id !== 'string' || !SAFE_ID_RE.test(id) || id.includes('..')) {
            throw new Error('Invalid plugin ID: ' + String(id));
        }
        return id;
    };
    const resolveConfined = (baseDir, ...parts) => {
        const base = path.resolve(baseDir);
        const target = path.resolve(base, ...parts);
        if (target !== base && !target.startsWith(base + path.sep)) {
            throw new Error('Path traversal blocked: ' + target);
        }
        return target;
    };
    const assertNotSymlink = (p) => {
        try {
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) {
                throw new Error('Symbolic link or junction refused: ' + p);
            }
            return true;
        } catch (err) {
            if (err && err.code === 'ENOENT') return false;
            throw err;
        }
    };
    const assertNoSymlinkChain = (baseDir, targetPath) => {
        const base = path.resolve(baseDir);
        const target = path.resolve(targetPath);
        assertNotSymlink(base);
        const rel = path.relative(base, target);
        if (!rel || rel === '.') return;
        const segments = rel.split(path.sep).filter(Boolean);
        let cur = base;
        for (const seg of segments) {
            cur = path.join(cur, seg);
            assertNotSymlink(cur);
        }
    };
    const validateTreeNoSymlink = (dirPath) => {
        assertNotSymlink(dirPath);
        const rootSt = fs.lstatSync(dirPath);
        if (!rootSt.isDirectory()) {
            throw new Error('Expected directory: ' + dirPath);
        }
        const entries = fs.readdirSync(dirPath);
        for (const name of entries) {
            const full = path.join(dirPath, name);
            const st = fs.lstatSync(full);
            if (st.isSymbolicLink()) {
                throw new Error('Symbolic link or junction refused inside package: ' + full);
            }
            if (st.isDirectory()) {
                validateTreeNoSymlink(full);
            } else if (!st.isFile()) {
                throw new Error('Unsupported file type inside package: ' + full);
            }
        }
    };
    const copyTreeNoSymlink = (srcDir, dstDir) => {
        fs.mkdirSync(dstDir, { recursive: true });
        const entries = fs.readdirSync(srcDir);
        for (const name of entries) {
            const srcPath = path.join(srcDir, name);
            const dstPath = path.join(dstDir, name);
            const st = fs.lstatSync(srcPath);
            if (st.isSymbolicLink()) {
                throw new Error('Symbolic link or junction refused during copy: ' + srcPath);
            }
            if (st.isDirectory()) {
                copyTreeNoSymlink(srcPath, dstPath);
            } else if (st.isFile()) {
                fs.copyFileSync(srcPath, dstPath);
            } else {
                throw new Error('Unsupported file type during copy: ' + srcPath);
            }
        }
    };
    const atomicWriteUtf8 = (filePath, text) => {
        assertNotSymlink(filePath);
        const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
        fs.writeFileSync(tmpPath, text, 'utf8');
        fs.renameSync(tmpPath, filePath);
    };

    electron_1.ipcMain.handle('hakimi:get-plugins-dir', () => {
        return getPluginsDir();
    });

    electron_1.ipcMain.handle('hakimi:list-plugins', () => {
        try {
            const pDir = getPluginsDir();
            if (!fs.existsSync(pDir)) {
                fs.mkdirSync(pDir, { recursive: true });
                return [];
            }
            const files = fs.readdirSync(pDir);
            return files
                .filter(f => f.endsWith('.js'))
                .sort((a, b) => (a === 'agm-plugin-host.js' ? (b === 'agm-plugin-host.js' ? 0 : -1) : (b === 'agm-plugin-host.js' ? 1 : 0)));
        } catch (e) {
            console.error('[Hakimi IPC] list-plugins error:', e);
            return [];
        }
    });

    electron_1.ipcMain.handle('hakimi:read-plugin', (_event, filename) => {
        try {
            const safeName = path.basename(filename);
            const pPath = path.join(getPluginsDir(), safeName);
            if (fs.existsSync(pPath)) {
                return fs.readFileSync(pPath, 'utf8');
            }
            return null;
        } catch (e) {
            console.error('[Hakimi IPC] read-plugin error:', e);
            return null;
        }
    });

    electron_1.ipcMain.handle('hakimi:read-config', () => {
        try {
            const cfgPath = path.join(getPluginsDir(), 'config.json');
            if (fs.existsSync(cfgPath)) {
                return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            }
            return {};
        } catch (e) {
            console.error('[Hakimi IPC] read-config error:', e);
            return {};
        }
    });

    electron_1.ipcMain.handle('hakimi:save-config', (_event, config) => {
        try {
            const pDir = getPluginsDir();
            if (!fs.existsSync(pDir)) {
                fs.mkdirSync(pDir, { recursive: true });
            }
            const cfgPath = path.join(pDir, 'config.json');
            let current = {};
            if (fs.existsSync(cfgPath)) {
                try { current = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
            }
            const updated = { ...current, ...config };
            fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[Hakimi IPC] save-config error:', e);
            return false;
        }
    });

    electron_1.ipcMain.handle('hakimi:launch-desktop-gpt', async () => {
        const cp = require('child_process');
        const existsOrAlias = (p) => {
            try {
                return fs.existsSync(p) || !!fs.lstatSync(p);
            } catch (_) {
                return false;
            }
        };
        const localAppData = process.env.LOCALAPPDATA || '';
        const appData = process.env.APPDATA || '';
        const userProfile = process.env.USERPROFILE || '';
        const programFiles = process.env.ProgramFiles || '';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
        const candidatePaths = [
            path.join(localAppData, 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe'),
            path.join(localAppData, 'Microsoft', 'WindowsApps', 'OpenAI.Codex_2p2nqsd0c76g0', 'chatgpt-desktop.exe'),
            path.join(localAppData, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
            path.join(localAppData, 'Programs', 'chatgpt-desktop', 'ChatGPT.exe'),
            path.join(programFiles, 'ChatGPT', 'ChatGPT.exe'),
            path.join(programFilesX86, 'ChatGPT', 'ChatGPT.exe'),
            path.join(userProfile, 'Desktop', 'ChatGPT.lnk'),
            path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ChatGPT.lnk'),
        ];
        for (const p of candidatePaths) {
            if (existsOrAlias(p)) {
                try {
                    cp.spawn('cmd.exe', ['/c', 'start', '""', p], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true,
                    }).unref();
                    return { success: true, method: 'executable', path: p };
                } catch (_) {}
            }
        }
        try {
            const appId = cp.execFileSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-Command',
                    "(Get-StartApps | Where-Object { $_.Name -eq 'ChatGPT' -or $_.AppID -match 'OpenAI\\\\.(Codex|ChatGPT)' } | Select-Object -First 1 -ExpandProperty AppID)",
                ],
                { encoding: 'utf8', windowsHide: true, timeout: 4000 }
            ).trim();
            if (appId) {
                cp.spawn('explorer.exe', [\`shell:AppsFolder\\\\\${appId}\`], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                }).unref();
                return { success: true, method: 'appsFolder', appId };
            }
        } catch (e) {
            return { success: false, error: e ? e.message : String(e) };
        }
        return { success: false, error: '未检测到已安装的 ChatGPT 桌面端' };
    });

    // --- AGM Plugin Host v2 IPC Primitives (Confined to <exeDir>/plugins/{repo,packages,state}) ---
    electron_1.ipcMain.handle('hakimi:get-host-info', () => {
        return {
            appVersion: electron_1.app.getVersion(),
            electronVersion: process.versions.electron,
            nodeVersion: process.versions.node,
            pluginsDir: getPluginsDir(),
            hostSocketVersion: '2.0.0',
        };
    });

    electron_1.ipcMain.handle('hakimi:list-packages', (_event, source) => {
        if (source !== 'repo' && source !== 'installed') {
            throw new Error('Invalid package source: ' + String(source));
        }
        const pDir = getPluginsDir();
        if (!fs.existsSync(pDir)) {
            fs.mkdirSync(pDir, { recursive: true });
        }
        assertNotSymlink(pDir);
        const subDir = source === 'repo' ? 'repo' : 'packages';
        const baseDir = resolveConfined(pDir, subDir);
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
            return [];
        }
        assertNotSymlink(baseDir);
        const results = [];
        const entries = fs.readdirSync(baseDir);
        for (const id of entries) {
            if (!SAFE_ID_RE.test(id) || id.includes('..')) continue;
            const pkgDir = resolveConfined(baseDir, id);
            try {
                const st = fs.lstatSync(pkgDir);
                if (st.isSymbolicLink()) {
                    results.push({ id, source, manifest: null, valid: false, error: 'Symbolic link or junction refused' });
                    continue;
                }
                if (!st.isDirectory()) continue;
                const manifestPath = resolveConfined(pkgDir, 'manifest.json');
                if (!fs.existsSync(manifestPath)) {
                    results.push({ id, source, manifest: null, valid: false, error: 'manifest.json missing' });
                    continue;
                }
                const mst = fs.lstatSync(manifestPath);
                if (mst.isSymbolicLink() || !mst.isFile()) {
                    results.push({ id, source, manifest: null, valid: false, error: 'Invalid manifest.json file' });
                    continue;
                }
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                results.push({ id, source, manifest, valid: true, error: null });
            } catch (err) {
                results.push({ id, source, manifest: null, valid: false, error: err ? err.message : String(err) });
            }
        }
        return results;
    });

    electron_1.ipcMain.handle('hakimi:read-package-entry', (_event, pluginId, entryRel) => {
        try {
            assertSafeId(pluginId);
            if (typeof entryRel !== 'string' || !entryRel.trim() || path.isAbsolute(entryRel) || entryRel.includes('..') || !entryRel.endsWith('.js')) {
                throw new Error('Invalid package entry path: ' + String(entryRel));
            }
            const pDir = getPluginsDir();
            const packagesBase = resolveConfined(pDir, 'packages');
            const pkgDir = resolveConfined(packagesBase, pluginId);
            assertNoSymlinkChain(pDir, pkgDir);
            if (!fs.existsSync(pkgDir) || !fs.lstatSync(pkgDir).isDirectory()) {
                return { ok: false, error: 'Package not installed: ' + pluginId };
            }
            const entryPath = resolveConfined(pkgDir, entryRel);
            assertNoSymlinkChain(pkgDir, entryPath);
            if (!fs.existsSync(entryPath) || !fs.lstatSync(entryPath).isFile()) {
                return { ok: false, error: 'Entry file not found: ' + entryRel };
            }
            const code = fs.readFileSync(entryPath, 'utf8');
            return { ok: true, code };
        } catch (err) {
            return { ok: false, error: err ? err.message : String(err) };
        }
    });

    electron_1.ipcMain.handle('hakimi:install-package', (_event, pluginId) => {
        let dstDir = null;
        let createdDst = false;
        try {
            assertSafeId(pluginId);
            const pDir = getPluginsDir();
            const repoBase = resolveConfined(pDir, 'repo');
            const packagesBase = resolveConfined(pDir, 'packages');
            if (!fs.existsSync(packagesBase)) {
                fs.mkdirSync(packagesBase, { recursive: true });
            }
            assertNoSymlinkChain(pDir, repoBase);
            assertNoSymlinkChain(pDir, packagesBase);
            const srcDir = resolveConfined(repoBase, pluginId);
            dstDir = resolveConfined(packagesBase, pluginId);
            if (!assertNotSymlink(srcDir)) {
                return { ok: false, error: 'Package not found in repo: ' + pluginId };
            }
            validateTreeNoSymlink(srcDir);
            const manifestPath = resolveConfined(srcDir, 'manifest.json');
            if (!fs.existsSync(manifestPath) || !fs.lstatSync(manifestPath).isFile()) {
                return { ok: false, error: 'manifest.json missing in repo/' + pluginId };
            }
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest || manifest.id !== pluginId) {
                return { ok: false, error: 'manifest.id mismatch for ' + pluginId };
            }
            if (typeof manifest.entry !== 'string' || !manifest.entry.trim() || path.isAbsolute(manifest.entry) || manifest.entry.includes('..') || !manifest.entry.endsWith('.js')) {
                return { ok: false, error: 'Invalid manifest.entry: ' + String(manifest.entry) };
            }
            const entryPath = resolveConfined(srcDir, manifest.entry);
            assertNoSymlinkChain(srcDir, entryPath);
            if (!fs.existsSync(entryPath) || !fs.lstatSync(entryPath).isFile()) {
                return { ok: false, error: 'Entry file missing: ' + manifest.entry };
            }
            if (fs.existsSync(dstDir)) {
                assertNotSymlink(dstDir);
                fs.rmSync(dstDir, { recursive: true, force: true });
            }
            createdDst = true;
            copyTreeNoSymlink(srcDir, dstDir);
            return { ok: true, manifest };
        } catch (err) {
            if (createdDst && dstDir && fs.existsSync(dstDir)) {
                try {
                    assertNotSymlink(dstDir);
                    fs.rmSync(dstDir, { recursive: true, force: true });
                } catch (_) {}
            }
            return { ok: false, error: err ? err.message : String(err) };
        }
    });

    electron_1.ipcMain.handle('hakimi:uninstall-package', (_event, pluginId) => {
        try {
            assertSafeId(pluginId);
            const pDir = getPluginsDir();
            const packagesBase = resolveConfined(pDir, 'packages');
            assertNoSymlinkChain(pDir, packagesBase);
            const target = resolveConfined(packagesBase, pluginId);
            if (assertNotSymlink(target)) {
                fs.rmSync(target, { recursive: true, force: true });
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err ? err.message : String(err) };
        }
    });

    electron_1.ipcMain.handle('hakimi:read-state', (_event, category, key) => {
        const pDir = getPluginsDir();
        const stateDir = resolveConfined(pDir, 'state');
        assertNoSymlinkChain(pDir, stateDir);
        if (category === 'registry') {
            const regPath = resolveConfined(stateDir, 'registry.json');
            assertNoSymlinkChain(stateDir, regPath);
            if (!fs.existsSync(regPath)) {
                return { version: 1, settings: {}, plugins: {} };
            }
            try {
                return JSON.parse(fs.readFileSync(regPath, 'utf8'));
            } catch (_) {
                return { version: 1, settings: {}, plugins: {} };
            }
        }
        if (category === 'config') {
            assertSafeId(key);
            const configsDir = resolveConfined(stateDir, 'configs');
            const cfgPath = resolveConfined(configsDir, key + '.json');
            assertNoSymlinkChain(stateDir, cfgPath);
            if (!fs.existsSync(cfgPath)) return null;
            try {
                return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            } catch (_) {
                return null;
            }
        }
        if (category === 'log') {
            assertSafeId(key);
            const logsDir = resolveConfined(stateDir, 'logs');
            const logPath = resolveConfined(logsDir, key + '.log');
            assertNoSymlinkChain(stateDir, logPath);
            if (!fs.existsSync(logPath)) return '';
            return fs.readFileSync(logPath, 'utf8');
        }
        throw new Error('Invalid state category: ' + String(category));
    });

    electron_1.ipcMain.handle('hakimi:write-state', (_event, category, key, data) => {
        const pDir = getPluginsDir();
        const stateDir = resolveConfined(pDir, 'state');
        const configsDir = resolveConfined(stateDir, 'configs');
        const logsDir = resolveConfined(stateDir, 'logs');
        fs.mkdirSync(configsDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });
        assertNoSymlinkChain(pDir, stateDir);
        assertNotSymlink(configsDir);
        assertNotSymlink(logsDir);

        if (category === 'registry') {
            const regPath = resolveConfined(stateDir, 'registry.json');
            atomicWriteUtf8(regPath, JSON.stringify(data || { version: 1, settings: {}, plugins: {} }, null, 2));
            return { ok: true };
        }
        if (category === 'config') {
            assertSafeId(key);
            const cfgPath = resolveConfined(configsDir, key + '.json');
            if (data === null) {
                if (fs.existsSync(cfgPath)) {
                    assertNotSymlink(cfgPath);
                    fs.unlinkSync(cfgPath);
                }
                return { ok: true };
            }
            atomicWriteUtf8(cfgPath, JSON.stringify(data, null, 2));
            return { ok: true };
        }
        if (category === 'log') {
            assertSafeId(key);
            const logPath = resolveConfined(logsDir, key + '.log');
            assertNotSymlink(logPath);
            const line = String(data == null ? '' : data).replace(/[\\r\\n]+$/, '') + '\\n';
            fs.appendFileSync(logPath, line, 'utf8');
            const st = fs.statSync(logPath);
            if (st.size > 128 * 1024) {
                const buf = fs.readFileSync(logPath);
                let tail = buf.subarray(buf.length - 64 * 1024).toString('utf8');
                const nl = tail.indexOf('\\n');
                if (nl >= 0) tail = tail.slice(nl + 1);
                atomicWriteUtf8(logPath, tail);
            }
            return { ok: true };
        }
        if (category === 'clear-log') {
            assertSafeId(key);
            const logPath = resolveConfined(logsDir, key + '.log');
            assertNotSymlink(logPath);
            if (fs.existsSync(logPath)) {
                atomicWriteUtf8(logPath, '');
            }
            return { ok: true };
        }
        throw new Error('Invalid state category: ' + String(category));
    });
}
// ---------------------------------------------
(0, customScheme_1.registerCustomSchemes)();`;

if (mainJs.includes(schemesTarget) && !mainJs.includes('registerHakimiIpcHandlers')) {
    mainJs = mainJs.replace(schemesTarget, schemesReplacement);
    console.log('[Patch] main.js: Injected IPC handlers and session manager.');
}

const sessTarget = "electron_1.app.on('session-created', (targetSession) => {";
const sessReplacement = `electron_1.app.on('session-created', (targetSession) => {\n    configureHakimiSession(targetSession);`;
if (mainJs.includes(sessTarget) && !mainJs.includes('configureHakimiSession(targetSession);')) {
    mainJs = mainJs.replace(sessTarget, sessReplacement);
    console.log('[Patch] main.js: Hooked session-created.');
}

const readyReplacement = `    (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {
        resolveStorage: (sender) => hostStores.forSender(sender),
        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),
    });
    // --- Register Hakimi IPC and Sessions ---
    try {
        registerHakimiIpcHandlers();
        configureHakimiSession(electron_1.session.defaultSession);
        const hakimiPartitions = ['persist:hakimi_gemini', 'persist:hakimi_gpt', 'persist:hakimi_grok'];
        for (const p of hakimiPartitions) {
            configureHakimiSession(electron_1.session.fromPartition(p));
        }
    } catch (err) {
        console.error('[Hakimi] Setup error in whenReady:', err);
    }
    // ----------------------------------------`;

if (readyTargetRe.test(mainJs) && !mainJs.includes('Register Hakimi IPC and Sessions')) {
    mainJs = mainJs.replace(readyTargetRe, readyReplacement);
    console.log('[Patch] main.js: Hooked whenReady.');
}

// -----------------------------------------------------------------------------
// 2. Patch dist/utils.js
// -----------------------------------------------------------------------------
if (!utilsJs.includes('webviewTag: true,')) {
    utilsJs = utilsJs.replace('webviewTag: builtInBrowser,', 'webviewTag: true,');
}
if (!utilsJs.includes('devTools: true,')) {
    utilsJs = utilsJs.replace('devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),', 'devTools: true,');
}
console.log('[Patch] utils.js: Enabled webviewTag & devTools.');

// -----------------------------------------------------------------------------
// 3. Patch dist/preload.js
// -----------------------------------------------------------------------------

// Expose hakimiHost via contextBridge
const hakimiBridgeCode = `\n// --- Expose Hakimi Host API ---
const hakimiHostAPI = {
    getPluginsDir: () => electron_1.ipcRenderer.invoke('hakimi:get-plugins-dir'),
    listPlugins: () => electron_1.ipcRenderer.invoke('hakimi:list-plugins'),
    readPlugin: (name) => electron_1.ipcRenderer.invoke('hakimi:read-plugin', name),
    readConfig: () => electron_1.ipcRenderer.invoke('hakimi:read-config'),
    saveConfig: (cfg) => electron_1.ipcRenderer.invoke('hakimi:save-config', cfg),
    launchDesktopGpt: () => electron_1.ipcRenderer.invoke('hakimi:launch-desktop-gpt'),
    getHostInfo: () => electron_1.ipcRenderer.invoke('hakimi:get-host-info'),
    listPackages: (source) => electron_1.ipcRenderer.invoke('hakimi:list-packages', source),
    readPackageEntry: (pluginId, entryRel) => electron_1.ipcRenderer.invoke('hakimi:read-package-entry', pluginId, entryRel),
    installPackage: (pluginId) => electron_1.ipcRenderer.invoke('hakimi:install-package', pluginId),
    uninstallPackage: (pluginId) => electron_1.ipcRenderer.invoke('hakimi:uninstall-package', pluginId),
    readState: (category, key) => electron_1.ipcRenderer.invoke('hakimi:read-state', category, key),
    writeState: (category, key, data) => electron_1.ipcRenderer.invoke('hakimi:write-state', category, key, data),
};
electron_1.contextBridge.exposeInMainWorld('hakimiHost', hakimiHostAPI);
// ------------------------------`;

if (!preloadJs.includes("exposeInMainWorld('hakimiHost'")) {
    preloadJs = preloadJs.replace(bridgeMarkerRe, (m) => m + hakimiBridgeCode);
    console.log('[Patch] preload.js: Exposed hakimiHost API.');
}

// HakimiPluginHost Initializer
const hostRunnerCode = `
// --- HakimiPluginHost Initializer ---
if (!isRemoteWindow) {
    let hakimiReloading = false;
    const initHakimiHost = async (isReload = false) => {
        if (hakimiReloading) return;
        hakimiReloading = true;
        try {
            const config = await electron_1.ipcRenderer.invoke('hakimi:read-config');
            const files = await electron_1.ipcRenderer.invoke('hakimi:list-plugins');
            let registry = { version: 1, settings: {}, plugins: {} };
            let hostInfo = null;
            try { registry = await electron_1.ipcRenderer.invoke('hakimi:read-state', 'registry', ''); } catch (_) {}
            try { hostInfo = await electron_1.ipcRenderer.invoke('hakimi:get-host-info'); } catch (_) {}
            console.log('[HakimiPluginHost]' + (isReload ? ' Hot-reloading plugins:' : ' Found plugins:'), files);

            const cfgJson = JSON.stringify(config || {});
            const bootCtxJson = JSON.stringify({
                config: config || {},
                registry: registry || { version: 1, settings: {}, plugins: {} },
                hostInfo: hostInfo || null,
                isReload: !!isReload
            });
            const hostInitScript = [
                '(function() {',
                '    var cfg = ' + cfgJson + ';',
                '    var bootCtx = ' + bootCtxJson + ';',
                '    if (!window.HakimiPluginHost) {',
                '        window.HakimiPluginHost = {',
                '            version: "1.1.0",',
                '            config: cfg,',
                '            plugins: {},',
                '            __bootContext: bootCtx,',
                '            register: function(name, pluginObj) {',
                '                this.plugins[name] = pluginObj;',
                '                console.log("[HakimiPluginHost] Registered plugin:", name);',
                '                if (pluginObj && typeof pluginObj.init === "function") {',
                '                    try { pluginObj.init(this.config); } catch (e) { console.error("[HakimiPluginHost] Init failed in " + name, e); }',
                '                }',
                '            },',
                '            reloadPlugins: function() {',
                '                window.dispatchEvent(new CustomEvent("hakimi:reload-plugins"));',
                '            },',
                '            reload: function() {',
                '                window.location.reload();',
                '            }',
                '        };',
                '    } else {',
                '        window.HakimiPluginHost.config = cfg;',
                '        window.HakimiPluginHost.__bootContext = bootCtx;',
                '    }',
                '})();'
            ].join('\\n');
            await electron_1.webFrame.executeJavaScript(hostInitScript);

            if (Array.isArray(files)) {
                for (const file of files) {
                    try {
                        const code = await electron_1.ipcRenderer.invoke('hakimi:read-plugin', file);
                        if (code) {
                            console.log('[HakimiPluginHost] Injecting plugin:', file);
                            await electron_1.webFrame.executeJavaScript(
                                '(function() {\\ntry {\\n/* [Plugin] ' + file + ' */\\n' + code + '\\n} catch(err) { console.error("[HakimiPluginHost] Error in ' + file + ':", err); }\\n})();'
                            );
                        }
                    } catch (err) {
                        console.error('[HakimiPluginHost] Failed to load plugin ' + file, err);
                    }
                }
            }
        } catch (e) {
            console.error('[HakimiPluginHost] Error in initHakimiHost:', e);
        } finally {
            hakimiReloading = false;
        }
    };

    window.addEventListener('hakimi:reload-plugins', () => {
        void initHakimiHost(true);
    });

    window.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
        if (mod && key === 'r') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                window.location.reload();
            } else {
                void initHakimiHost(true);
            }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'f5') {
            e.preventDefault();
            e.stopPropagation();
            void initHakimiHost(true);
        }
    }, true);

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => { void initHakimiHost(false); });
    } else {
        void initHakimiHost(false);
    }
}
`;

if (!preloadJs.includes('HakimiPluginHost Initializer')) {
    preloadJs += hostRunnerCode;
    console.log('[Patch] preload.js: Appended HakimiPluginHost Initializer.');
}

// --- Post-check BEFORE writing any patched file ---
const requiredMainMarkers = [
    'Hakimi Portable UserData Lock',
    'registerHakimiIpcHandlers',
    'configureHakimiSession(targetSession);',
    'Register Hakimi IPC and Sessions',
    'hakimi:get-plugins-dir',
    'hakimi:list-plugins',
    'hakimi:read-plugin',
    'hakimi:read-config',
    'hakimi:save-config',
    'hakimi:launch-desktop-gpt',
    'hakimi:get-host-info',
    'hakimi:list-packages',
    'hakimi:read-package-entry',
    'hakimi:install-package',
    'hakimi:uninstall-package',
    'hakimi:read-state',
    'hakimi:write-state',
];
const requiredPreloadMarkers = [
    "exposeInMainWorld('hakimiHost'",
    'HakimiPluginHost Initializer',
    '__bootContext',
    'getHostInfo',
    'listPackages',
    'readPackageEntry',
    'installPackage',
    'uninstallPackage',
    'readState',
    'writeState',
];
const missingPost = [];
for (const m of requiredMainMarkers) if (!mainJs.includes(m)) missingPost.push('main.js:' + m);
if (!utilsJs.includes('webviewTag: true,')) missingPost.push('utils.js:webviewTag');
if (!utilsJs.includes('devTools: true,')) missingPost.push('utils.js:devTools');
for (const m of requiredPreloadMarkers) if (!preloadJs.includes(m)) missingPost.push('preload.js:' + m);

if (missingPost.length > 0) {
    console.error('[Patch][Hakimi] FATAL: post-check failed:\n  - ' + missingPost.join('\n  - '));
    process.exit(2);
}

// -----------------------------------------------------------------------------
// 4. Write Files & Validate All Files (including AGM locks)
// -----------------------------------------------------------------------------
// --- AGM: inject AGM_UPDATE_LOCK + AGM_SIDECAR_REAPER (+ optional --update-yml <path>) ---
let agmFiles = [];
try {
    agmFiles = agmLocks.apply(targetDir, process.argv.slice(3));
} catch (e) {
    console.error('[Patch][AGM] FATAL: ' + e.message);
    process.exit(2);
}

fs.writeFileSync(mainJsPath, mainJs, 'utf8');
fs.writeFileSync(utilsJsPath, utilsJs, 'utf8');
fs.writeFileSync(preloadJsPath, preloadJs, 'utf8');

console.log('[Patch] Validating syntax with node --check...');
execSync(`node --check "${mainJsPath}"`);
execSync(`node --check "${utilsJsPath}"`);
execSync(`node --check "${preloadJsPath}"`);
for (const f of agmFiles) execSync(`node --check "${f}"`);
console.log('[Patch] All files passed syntax check successfully!');
