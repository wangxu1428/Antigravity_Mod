// tests/test_repatch_unit.js : Offline unit tests for platform/mod_kit/repatch.ps1 & restore-official.ps1 (RP1-RP13)
// Uses a synthetic fake `asar` CLI in os.tmpdir(); zero real Electron app.asar or network access.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPATCH_PS1 = path.join(REPO_ROOT, 'platform', 'mod_kit', 'repatch.ps1');
const RESTORE_PS1 = path.join(REPO_ROOT, 'platform', 'scripts', 'restore-official.ps1');
const PATCH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'patch.js');
const AGM_LOCKS_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_locks.js');
const REAPER_CORE_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_sidecar_reaper_core.js');
const TEMPLATE_YML = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');
const OFFICIAL_2321_SHA256 = '5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F';
const KNOWN_PREPATCHED_ZH_SHA256 = '98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46';

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

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (mode === 'emit_unpacked') {
    const stagedUnpacked = path.join(path.dirname(outAsar), 'app.asar.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
    fs.mkdirSync(path.dirname(stagedUnpacked), { recursive: true });
    fs.writeFileSync(stagedUnpacked, 'NEW_UNPACKED_CONTENT', 'utf8');
  }
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

function runRepatch(caseDir, fakeBinDir, tmpEnvDir, mode, extraEnv = {}, extraArgs = []) {
  const scriptPath = path.join(caseDir, 'mod_kit', 'repatch.ps1');
  const env = { ...process.env, ...extraEnv };
  env.PATH = fakeBinDir + path.delimiter + (process.env.PATH || '');
  env.TEMP = tmpEnvDir;
  env.TMP = tmpEnvDir;
  env.AGM_FAKE_ASAR_MODE = mode;

  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-TargetAppDir', caseDir, ...extraArgs],
    { encoding: 'utf8', env, timeout: 30000 }
  );
  return {
    status: res.status,
    output: (res.stdout || '') + '\n' + (res.stderr || ''),
    error: res.error,
  };
}

function runRestore(caseDir, extraEnv = {}, extraArgs = []) {
  const env = { ...process.env, ...extraEnv };
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RESTORE_PS1, '-TargetAppDir', caseDir, ...extraArgs],
    { encoding: 'utf8', env, timeout: 30000 }
  );
  return {
    status: res.status,
    output: (res.stdout || '') + '\n' + (res.stderr || ''),
    error: res.error,
  };
}

async function withFileLock(filePath, accessMode, shareMode, fn) {
  const psScript = [
    '$ErrorActionPreference = "Stop";',
    '$fa = [System.Enum]::Parse([System.IO.FileAccess], $env:AGM_LOCK_ACCESS);',
    '$fsMode = [System.Enum]::Parse([System.IO.FileShare], $env:AGM_LOCK_SHARE);',
    '$stream = [System.IO.FileStream]::new($env:AGM_LOCK_PATH, [System.IO.FileMode]::Open, $fa, $fsMode);',
    'try {',
    '  [Console]::Out.WriteLine("LOCKED");',
    '  [Console]::Out.Flush();',
    '  $null = [Console]::In.ReadLine();',
    '} finally {',
    '  $stream.Dispose();',
    '}',
  ].join(' ');

  const env = {
    ...process.env,
    AGM_LOCK_PATH: filePath,
    AGM_LOCK_ACCESS: accessMode,
    AGM_LOCK_SHARE: shareMode,
  };

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    let outBuf = '';
    let errBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for lock on ${filePath}: stdout=${outBuf} stderr=${errBuf}`));
    }, 10000);

    child.stdout.on('data', (chunk) => {
      outBuf += chunk.toString('utf8');
      if (outBuf.includes('LOCKED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      errBuf += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      if (!outBuf.includes('LOCKED')) {
        clearTimeout(timer);
        reject(new Error(`Locker exited early (code=${code}): stderr=${errBuf}`));
      }
    });
  });

  try {
    return await fn();
  } finally {
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write('\n');
        child.stdin.end();
      }
    } catch (_) {}

    await new Promise((resolve) => {
      let settled = false;
      const killTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill();
          } catch (_) {}
          resolve();
        }
      }, 3000);
      child.once('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(killTimer);
          resolve();
        }
      });
    });
  }
}

async function runAll() {
  // RP6: Cross-platform static contract check (runs on Ubuntu and Windows CI)
  const ps1Src = fs.readFileSync(REPATCH_PS1, 'utf8');
  const restoreSrc = fs.readFileSync(RESTORE_PS1, 'utf8');
  const requiredRepatchTokens = [
    '$LASTEXITCODE',
    '.agm_repatch_tmp_',
    '[System.IO.File]::Replace',
    '[System.IO.Directory]::Move',
    'node --check',
    'Get-FileHash',
    'restore-official.ps1',
    '-TargetAppDir',
    OFFICIAL_2321_SHA256,
    'app.asar.modded_prev_',
    'AGM_OFFICIAL_ASAR_SHA256',
  ];
  const missingRepatchTokens = requiredRepatchTokens.filter((t) => !ps1Src.includes(t));
  const hasMoveItem = /\bMove-Item\b/i.test(ps1Src);
  const requiredRestoreTokens = [
    OFFICIAL_2321_SHA256,
    '[System.IO.File]::Replace',
    'AGM_OFFICIAL_ASAR_SHA256',
  ];
  const missingRestoreTokens = requiredRestoreTokens.filter((t) => !restoreSrc.includes(t));
  check(
    'RP6',
    'repatch.ps1 & restore-official.ps1 contain atomic replace + official backup whitelist primitives without Move-Item',
    missingRepatchTokens.length === 0 && !hasMoveItem && missingRestoreTokens.length === 0,
    { missingRepatchTokens, hasMoveItem, missingRestoreTokens }
  );

  const officialArrayRe = /\$KnownOfficialAsarHashes\s*=\s*@\(([\s\S]*?)\)/;
  function officialLiterals(src) {
    const m = src.match(officialArrayRe);
    return m ? (m[1].match(/[0-9A-Fa-f]{64}/g) || []).map((h) => h.toUpperCase()) : [];
  }
  const repatchOfficial = officialLiterals(ps1Src);
  const restoreOfficial = officialLiterals(restoreSrc);
  check(
    'RP6b',
    'default official whitelist is clean 5B493943... and does not include prepatched ZH hash 98A4308C...',
    repatchOfficial.includes(OFFICIAL_2321_SHA256) &&
      restoreOfficial.includes(OFFICIAL_2321_SHA256) &&
      !repatchOfficial.includes(KNOWN_PREPATCHED_ZH_SHA256) &&
      !restoreOfficial.includes(KNOWN_PREPATCHED_ZH_SHA256),
    { repatchOfficial, restoreOfficial }
  );

  if (process.platform !== 'win32') {
    console.log('INFO Non-Windows host detected; skipping Windows PowerShell execution cases RP1-RP5, RP7-RP13.');
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'fail_pack', { AGM_OFFICIAL_ASAR_SHA256: origHash });
      const afterHash = sha256File(asarPath);
      const entries = fs.readdirSync(resDir);
      const leftovers = entries.filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = entries.filter((n) => n.startsWith('app.asar.prev_') || n.startsWith('app.asar.modded_prev_'));
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'fail_extract', { AGM_OFFICIAL_ASAR_SHA256: origHash });
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'empty_pack', { AGM_OFFICIAL_ASAR_SHA256: origHash });
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'missing_list', { AGM_OFFICIAL_ASAR_SHA256: origHash });
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', {
        AGM_FAKE_PACK_HASH_OUT: packHashFile,
        AGM_OFFICIAL_ASAR_SHA256: origHash,
      });
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
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'require_unpacked', {
        AGM_FAKE_PACK_HASH_OUT: packHashFile,
        AGM_OFFICIAL_ASAR_SHA256: origHash,
      });
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

    // RP8: P0-1 exclusive lock (FileShare.None) on target app.asar -> non-zero exit, target intact & hash unchanged
    {
      const caseDir = path.join(rootTmp, 'case_lock_exclusive');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const initRes = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedBeforeHash = sha256File(asarPath);
      const lockRes = await withFileLock(asarPath, 'ReadWrite', 'None', () =>
        runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const existsAfter = fs.existsSync(asarPath);
      const hashAfter = existsAfter ? sha256File(asarPath) : 'MISSING';
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP8',
        'exclusive lock (FileShare.None) keeps target app.asar present with unchanged SHA256 and exits non-zero',
        initRes.status === 0 &&
          lockRes.status === 10 &&
          existsAfter &&
          hashAfter === moddedBeforeHash &&
          !lockRes.output.includes('重铸完毕') &&
          leftovers.length === 0,
        { initStatus: initRes.status, lockStatus: lockRes.status, moddedBeforeHash, hashAfter, leftovers, out: lockRes.output.slice(-600) }
      );
    }

    // RP9: P0-1 read-share lock (FileShare.Read) hits File.Replace directly -> non-zero exit, target intact & hash unchanged
    {
      const caseDir = path.join(rootTmp, 'case_lock_read_share');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const initRes = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedBeforeHash = sha256File(asarPath);
      const lockRes = await withFileLock(asarPath, 'Read', 'Read', () =>
        runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const existsAfter = fs.existsSync(asarPath);
      const hashAfter = existsAfter ? sha256File(asarPath) : 'MISSING';
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP9',
        'read-share lock reaches File.Replace, fails cleanly (exit 10), preserves target app.asar & SHA256',
        initRes.status === 0 &&
          lockRes.status === 10 &&
          lockRes.output.includes('临时产物校验通过') &&
          existsAfter &&
          hashAfter === moddedBeforeHash &&
          !lockRes.output.includes('重铸完毕') &&
          leftovers.length === 0,
        { initStatus: initRes.status, lockStatus: lockRes.status, moddedBeforeHash, hashAfter, leftovers, out: lockRes.output.slice(-800) }
      );
    }

    // RP10: P0-1 locked app.asar.unpacked (FileShare.Read allows extract copy, blocks Directory.Move) -> rolls back app.asar automatically
    {
      const caseDir = path.join(rootTmp, 'case_lock_unpacked_rollback');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const unpackedLic = path.join(resDir, 'app.asar.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
      fs.mkdirSync(path.dirname(unpackedLic), { recursive: true });
      fs.writeFileSync(unpackedLic, 'ORIG_UNPACKED_CONTENT', 'utf8');
      const origHash = sha256File(asarPath);

      const lockRes = await withFileLock(unpackedLic, 'Read', 'Read', () =>
        runRepatch(caseDir, fakeBinDir, psTempDir, 'emit_unpacked', { AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const afterAsarExists = fs.existsSync(asarPath);
      const afterAsarHash = afterAsarExists ? sha256File(asarPath) : 'MISSING';
      const afterUnpackedText = fs.existsSync(unpackedLic) ? fs.readFileSync(unpackedLic, 'utf8') : 'MISSING';
      const leftovers = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'RP10',
        'locked app.asar.unpacked leaves original unpacked intact and rolls back app.asar automatically',
        lockRes.status === 10 &&
          lockRes.output.includes('已通过同卷安全备份自动恢复原 app.asar') &&
          afterAsarExists &&
          afterAsarHash === origHash &&
          afterUnpackedText === 'ORIG_UNPACKED_CONTENT' &&
          !lockRes.output.includes('重铸完毕') &&
          leftovers.length === 0,
        { status: lockRes.status, origHash, afterAsarHash, afterUnpackedText, leftovers, out: lockRes.output.slice(-800) }
      );
    }

    // RP11: P0-2 repeat repatch keeps official .bak hash/mtime intact and backs up modded app.asar to .modded_prev_
    {
      const caseDir = path.join(rootTmp, 'case_repeat_modded_prev');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res1 = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedHash1 = sha256File(asarPath);
      const bakPath = path.join(resDir, 'app.asar.bak');
      const bakMtime1 = fs.statSync(bakPath).mtimeMs;
      await sleepMs(1150);

      const res2 = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: origHash });
      const bakHash2 = sha256File(bakPath);
      const bakMtime2 = fs.statSync(bakPath).mtimeMs;
      const entries = fs.readdirSync(resDir);
      const prevs = entries.filter((n) => n.startsWith('app.asar.prev_'));
      const moddedPrevs = entries.filter((n) => n.startsWith('app.asar.modded_prev_'));
      const moddedPrevHash = moddedPrevs.length === 1 ? sha256File(path.join(resDir, moddedPrevs[0])) : 'NONE';
      check(
        'RP11',
        'repeat repatch preserves official .bak hash & mtime and archives modded target to app.asar.modded_prev_*',
        res1.status === 0 &&
          res2.status === 0 &&
          bakHash2 === origHash &&
          bakMtime2 === bakMtime1 &&
          prevs.length === 1 &&
          moddedPrevs.length === 1 &&
          moddedPrevHash === moddedHash1,
        { s1: res1.status, s2: res2.status, origHash, bakHash2, bakMtime1, bakMtime2, prevs, moddedPrevs, moddedPrevHash, moddedHash1 }
      );
    }

    // RP12: P0-2 missing .bak + non-official app.asar refuses to write .bak (exit 4)
    {
      const caseDir = path.join(rootTmp, 'case_nobak_nonofficial');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const res = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: '' });
      const bakExists = fs.existsSync(path.join(resDir, 'app.asar.bak'));
      const afterHash = sha256File(asarPath);
      check(
        'RP12',
        'missing .bak with non-official app.asar refuses to create polluted .bak and exits 4',
        res.status === 4 &&
          !bakExists &&
          afterHash === origHash &&
          res.output.includes('ALARM') &&
          !res.output.includes('重铸完毕'),
        { status: res.status, bakExists, origHash, afterHash, out: res.output.slice(-700) }
      );
    }

    // RP13: P0-2 existing polluted .bak causes ALARM and refusal in both repatch.ps1 and restore-official.ps1
    {
      const caseDir = path.join(rootTmp, 'case_polluted_bak');
      const { resDir, asarPath } = setupFakeApp(caseDir);
      const origHash = sha256File(asarPath);
      const bakPath = path.join(resDir, 'app.asar.bak');
      fs.writeFileSync(bakPath, '{"tag":"POLLUTED_MODDED_BAK"}', 'utf8');
      const pollutedBakHash = sha256File(bakPath);

      const repatchRes = runRepatch(caseDir, fakeBinDir, psTempDir, 'ok', { AGM_OFFICIAL_ASAR_SHA256: '' });
      const restoreRes = runRestore(caseDir, { AGM_OFFICIAL_ASAR_SHA256: '' });
      const afterAsarHash = sha256File(asarPath);
      const afterBakHash = sha256File(bakPath);

      check(
        'RP13',
        'existing polluted .bak triggers ALARM and exit 4 refusal in both repatch.ps1 and restore-official.ps1',
        repatchRes.status === 4 &&
          restoreRes.status === 4 &&
          repatchRes.output.includes('ALARM') &&
          restoreRes.output.includes('ALARM') &&
          !repatchRes.output.includes('直接从官方 .bak 还原') &&
          !repatchRes.output.includes('重铸完毕') &&
          afterAsarHash === origHash &&
          afterBakHash === pollutedBakHash,
        {
          repatchStatus: repatchRes.status,
          restoreStatus: restoreRes.status,
          origHash,
          afterAsarHash,
          pollutedBakHash,
          afterBakHash,
          repatchOut: repatchRes.output.slice(-600),
          restoreOut: restoreRes.output.slice(-600),
        }
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

runAll().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
