// tests/test_repatch_unit.js : Offline unit tests for platform/mod_kit/repatch.ps1 (RP1-RP7)
// Uses a synthetic fake `asar` CLI in os.tmpdir(); zero real Electron app.asar or network access.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPATCH_PS1 = path.join(REPO_ROOT, 'platform', 'mod_kit', 'repatch.ps1');
const PATCH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'patch.js');
const AGM_LOCKS_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_locks.js');
const REAPER_CORE_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_sidecar_reaper_core.js');
const TEMPLATE_YML = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');

const results = [];
function check(id, desc, cond, detail) {
  if (cond) {
    results.push({ id, ok: true });
    console.log(`PASS ${id} ${desc}`);
  } else {
    results.push({ id, ok: false });
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function createSyntheticBundleJson() {
  const files = {
    'dist/main.js': [
      "'use strict';",
      "const path = require('path');",
      "const fs = require('fs');",
      "const electron_1 = require('electron');",
      "const gotTheLock = electron_1.app.requestSingleInstanceLock();",
      "(0, customScheme_1.registerCustomSchemes)();",
      "electron_1.app.on('session-created', (targetSession) => {",
      "});",
      "function onReady() {",
      "    (0, ipcHandlers_1.registerIpcHandlers)(storageManager, {",
      "        resolveStorage: (sender) => hostStores.forSender(sender),",
      "        sidecarRoutesFor: (sender) => remoteManager?.sidecarRoutesFor(sender),",
      "    });",
      "}",
      ""
    ].join('\n'),
    'dist/utils.js': [
      "'use strict';",
      "const winOpts = {",
      "    webviewTag: builtInBrowser,",
      "    devTools: (0, debugConsole_1.isDebugConsoleEnabled)(),",
      "};",
      ""
    ].join('\n'),
    'dist/preload.js': [
      "'use strict';",
      "const electron_1 = require('electron');",
      "function exposeAll(isRemoteWindow) {",
      "    electron_1.contextBridge.exposeInMainWorld('sshRemote', createLocalSshRemoteAPI());",
      "}",
      "if (!isRemoteWindow) {",
      "    console.log('local window');",
      "}",
      ""
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
      ""
    ].join('\n'),
    'dist/ipcHandlers.js': [
      "'use strict';",
      'function registerIpcHandlers() {',
      '    const localOnly = (c, fn) => fn;',
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
      ""
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
      ""
    ].join('\n'),
  };
  return JSON.stringify({ tag: 'SYNTHETIC_CLEAN_ASAR', files }, null, 2);
}

function writeFakeAsarCli(fakeBinDir) {
  const jsPath = path.join(fakeBinDir, 'fake_asar.js');
  const cmdPath = path.join(fakeBinDir, 'asar.cmd');

  const fakeAsarSource = `'use strict';
const fs = require('fs');
const path = require('path');

const mode = process.env.AGM_FAKE_ASAR_MODE || 'ok';
const cmd = process.argv[2];

function collectFiles(rootDir, curDir, out) {
  for (const name of fs.readdirSync(curDir)) {
    const full = path.join(curDir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      collectFiles(rootDir, full, out);
    } else if (st.isFile()) {
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      out[rel] = fs.readFileSync(full, 'utf8');
    }
  }
}

if (cmd === '--version') {
  console.log('v0.0.0-fake');
  process.exit(0);
}

if (cmd === 'extract') {
  if (mode === 'fail_extract') {
    console.error('fake asar: simulated extract failure');
    process.exit(13);
  }
  const srcAsar = process.argv[3];
  const destDir = process.argv[4];
  if (mode === 'require_unpacked') {
    const reqUnpacked = path.join(srcAsar + '.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
    if (!fs.existsSync(reqUnpacked)) {
      console.error('ENOENT: missing unpacked file ' + reqUnpacked);
      process.exit(1);
    }
  }
  const bundle = JSON.parse(fs.readFileSync(srcAsar, 'utf8'));
  for (const rel of Object.keys(bundle.files)) {
    const outPath = path.join(destDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, bundle.files[rel], 'utf8');
  }
  process.exit(0);
}

if (cmd === 'pack') {
  const srcDir = process.argv[3];
  const outAsar = process.argv[4];
  fs.mkdirSync(path.dirname(outAsar), { recursive: true });
  if (mode === 'fail_pack') {
    fs.writeFileSync(outAsar, 'PARTIAL_CORRUPT_STAGING_DATA', 'utf8');
    console.error('fake asar: simulated pack failure');
    process.exit(17);
  }
  if (mode === 'empty_pack') {
    fs.writeFileSync(outAsar, Buffer.alloc(0));
    process.exit(0);
  }
  const files = {};
  collectFiles(srcDir, srcDir, files);
  fs.writeFileSync(outAsar, JSON.stringify({ tag: 'SYNTHETIC_PATCHED_ASAR', files }, null, 2), 'utf8');
  if (process.env.AGM_FAKE_PACK_HASH_OUT) {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256').update(fs.readFileSync(outAsar)).digest('hex').toUpperCase();
    fs.writeFileSync(process.env.AGM_FAKE_PACK_HASH_OUT, h, 'utf8');
  }
  process.exit(0);
}

if (cmd === 'list') {
  const asarFile = process.argv[3];
  const bundle = JSON.parse(fs.readFileSync(asarFile, 'utf8'));
  for (const rel of Object.keys(bundle.files).sort()) {
    if (mode === 'missing_list' && rel === 'dist/updater.js') continue;
    console.log('\\\\' + rel.split('/').join('\\\\'));
  }
  process.exit(0);
}

console.error('fake asar: unknown command ' + cmd);
process.exit(2);
`;

  const cmdSource = `@echo off\r\n"${process.execPath}" "%~dp0fake_asar.js" %*\r\n`;
  fs.writeFileSync(jsPath, fakeAsarSource, 'utf8');
  fs.writeFileSync(cmdPath, cmdSource, 'utf8');
}

function setupFakeApp(caseDir) {
  const modKitDir = path.join(caseDir, 'mod_kit');
  const resDir = path.join(caseDir, 'resources');
  fs.mkdirSync(modKitDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  fs.copyFileSync(REPATCH_PS1, path.join(modKitDir, 'repatch.ps1'));
  fs.copyFileSync(PATCH_JS, path.join(modKitDir, 'patch.js'));
  fs.copyFileSync(AGM_LOCKS_JS, path.join(modKitDir, 'agm_locks.js'));
  fs.copyFileSync(REAPER_CORE_JS, path.join(modKitDir, 'agm_sidecar_reaper_core.js'));
  fs.copyFileSync(TEMPLATE_YML, path.join(resDir, 'app-update.yml'));

  const asarPath = path.join(resDir, 'app.asar');
  fs.writeFileSync(asarPath, createSyntheticBundleJson(), 'utf8');
  return { modKitDir, resDir, asarPath };
}

function runRepatch(caseDir, fakeBinDir, tmpEnvDir, mode, extraEnv = {}) {
  const scriptPath = path.join(caseDir, 'mod_kit', 'repatch.ps1');
  const env = { ...process.env, ...extraEnv };
  env.PATH = fakeBinDir + path.delimiter + (process.env.PATH || '');
  env.TEMP = tmpEnvDir;
  env.TMP = tmpEnvDir;
  env.AGM_FAKE_ASAR_MODE = mode;

  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-TargetAppDir', caseDir],
    { encoding: 'utf8', env, timeout: 30000 }
  );
  return {
    status: res.status,
    output: (res.stdout || '') + '\n' + (res.stderr || ''),
    error: res.error,
  };
}

function runAll() {
  // RP6: Cross-platform static contract check
  const ps1Src = fs.readFileSync(REPATCH_PS1, 'utf8');
  const requiredTokens = [
    '$LASTEXITCODE',
    '.agm_repatch_tmp_',
    'app.asar.prev_',
    'Move-Item',
    'node --check',
    'Get-FileHash',
    'restore-official.ps1',
    '-TargetAppDir',
  ];
  const missingTokens = requiredTokens.filter((t) => !ps1Src.includes(t));
  check('RP6', 'repatch.ps1 contains required hardening primitives', missingTokens.length === 0, { missingTokens });

  if (process.platform !== 'win32') {
    console.log('INFO Non-Windows host detected; skipping Windows PowerShell execution cases RP1-RP5, RP7.');
    const f = results.filter((r) => !r.ok).length;
    console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
    process.exitCode = f ? 1 : 0;
    return;
  }

  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agm_repatch_unit_'));
  try {
    const fakeBinDir = path.join(rootTmp, 'fakebin');
    const psTempDir = path.join(rootTmp, 'pstemp');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(psTempDir, { recursive: true });
    writeFakeAsarCli(fakeBinDir);

    // RP1: simulated asar pack failure -> non-zero exit, app.asar hash unchanged, temp cleaned, no success message
    {
      const caseDir = path.join(rootTmp, 'case_fail_pack');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'fail_pack');
      const afterHash = sha256File(asarPath);
      const entries = fs.readdirSync(resDir);
      const leftovers = entries.filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = entries.filter((n) => n.startsWith('app.asar.prev_'));
      const noSuccessText = !res.output.includes('重铸完毕');
      const hasRollback = res.output.includes('restore-official.ps1');
      check(
        'RP1',
        'pack failure leaves target app.asar unchanged, exits non-zero, cleans temp dir',
        res.status === 17 &&
          afterHash === origHash &&
          leftovers.length === 0 &&
          prevs.length === 0 &&
          noSuccessText &&
          hasRollback &&
          res.output.includes('asar pack failed'),
        { status: res.status, origHash, afterHash, leftovers, prevs, noSuccessText, hasRollback, out: res.output.slice(-600) }
      );
    }

    // RP2: simulated asar extract failure
    {
      const caseDir = path.join(rootTmp, 'case_fail_extract');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'fail_extract');
      const afterHash = sha256File(asarPath);
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP2',
        'extract failure leaves target app.asar unchanged, exits non-zero, cleans temp dir',
        res.status === 13 &&
          afterHash === origHash &&
          leftovers.length === 0 &&
          !res.output.includes('重铸完毕') &&
          res.output.includes('asar extract failed'),
        { status: res.status, origHash, afterHash, leftovers, out: res.output.slice(-600) }
      );
    }

    // RP3: 0-byte staged app.asar rejected before replace
    {
      const caseDir = path.join(rootTmp, 'case_empty_pack');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'empty_pack');
      const afterHash = sha256File(asarPath);
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP3',
        '0-byte staged archive rejected before replacement',
        res.status !== 0 &&
          afterHash === origHash &&
          leftovers.length === 0 &&
          !res.output.includes('重铸完毕') &&
          res.output.includes('is empty (0 bytes)'),
        { status: res.status, origHash, afterHash, leftovers, out: res.output.slice(-600) }
      );
    }

    // RP4: staged archive missing key injected file in `asar list` rejected before replace
    {
      const caseDir = path.join(rootTmp, 'case_missing_list');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'missing_list');
      const afterHash = sha256File(asarPath);
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP4',
        'staged archive missing dist/updater.js in asar list rejected before replacement',
        res.status !== 0 &&
          afterHash === origHash &&
          leftovers.length === 0 &&
          !res.output.includes('重铸完毕') &&
          res.output.includes('missing required injected files') &&
          res.output.includes('dist/updater.js'),
        { status: res.status, origHash, afterHash, leftovers, out: res.output.slice(-600) }
      );
    }

    // RP5: valid pack succeeds, creates .bak & .prev_, replaces target with matching SHA256, cleans temp
    {
      const caseDir = path.join(rootTmp, 'case_ok');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const packHashFile = path.join(rootTmp, 'expected_pack_hash.txt');
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_FAKE_PACK_HASH_OUT: packHashFile });
      const expectedPackedHash = fs.existsSync(packHashFile) ? fs.readFileSync(packHashFile, 'utf8').trim() : 'MISSING';
      const afterHash = sha256File(asarPath);
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      const entries = fs.readdirSync(resDir);
      const leftovers = entries.filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = entries.filter((n) => n.startsWith('app.asar.prev_'));
      const prevHash = prevs.length === 1 ? sha256File(path.join(resDir, prevs[0])) : 'NONE';
      const srcTempLeftovers = fs.readdirSync(psTempDir).filter((n) => n.startsWith('agm_rp_src_'));
      check(
        'RP5',
        'valid build creates .bak & .prev_, swaps atomically with verified SHA256, cleans temps',
        res.status === 0 &&
          bakHash === origHash &&
          prevs.length === 1 &&
          prevHash === origHash &&
          afterHash === expectedPackedHash &&
          afterHash !== origHash &&
          leftovers.length === 0 &&
          srcTempLeftovers.length === 0 &&
          res.output.includes(expectedPackedHash) &&
          res.output.includes('restore-official.ps1'),
        { status: res.status, origHash, bakHash, prevHash, expectedPackedHash, afterHash, leftovers, srcTempLeftovers, out: res.output.slice(-800) }
      );
    }

    // RP7: app.asar.unpacked staged cleanly for extract when app.asar.bak.unpacked is absent
    {
      const caseDir = path.join(rootTmp, 'case_unpacked_stage');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const unpackedLic = path.join(resDir, 'app.asar.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
      fs.mkdirSync(path.dirname(unpackedLic), { recursive: true });
      fs.writeFileSync(unpackedLic, 'MIT_LICENSE_MARKER', 'utf8');
      const origHash = sha256File(asarPath);
      const packHashFile = path.join(rootTmp, 'expected_pack_hash_rp7.txt');
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'require_unpacked', { AGM_FAKE_PACK_HASH_OUT: packHashFile });
      const expectedPackedHash = fs.existsSync(packHashFile) ? fs.readFileSync(packHashFile, 'utf8').trim() : 'MISSING';
      const afterHash = sha256File(asarPath);
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      const bakUnpackedExists = fs.existsSync(path.join(resDir, 'app.asar.bak.unpacked'));
      const entries = fs.readdirSync(resDir);
      const leftovers = entries.filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const tempLeftovers = fs.readdirSync(psTempDir).filter((n) => n.startsWith('agm_rp_src_') || n.startsWith('agm_rp_in_'));
      check(
        'RP7',
        'stages app.asar.unpacked alongside temp bak copy during extract and cleans staging dirs',
        res.status === 0 &&
          bakHash === origHash &&
          afterHash === expectedPackedHash &&
          afterHash !== origHash &&
          !bakUnpackedExists &&
          leftovers.length === 0 &&
          tempLeftovers.length === 0 &&
          fs.existsSync(unpackedLic),
        { status: res.status, origHash, bakHash, afterHash, expectedPackedHash, bakUnpackedExists, leftovers, tempLeftovers, out: res.output.slice(-800) }
      );
    }
  } finally {
    try {
      fs.rmSync(rootTmp, { recursive: true, force: true });
    } catch (_) {}
  }

  const f = results.filter((r) => !r.ok).length;
  console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
  process.exitCode = f ? 1 : 0;
}

runAll();
