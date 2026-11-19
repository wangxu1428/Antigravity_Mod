// tests/test_fault_injection.js : Offline fault injection tests for atomic replace, app.asar.unpacked rollback,
// restore-official.ps1 safety recovery, and app-update.yml transactional consistency.
// Cross-platform static/agm_locks checks run everywhere; Windows PowerShell execution scenarios run on win32.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPATCH_PS1 = path.join(REPO_ROOT, 'platform', 'mod_kit', 'repatch.ps1');
const RESTORE_PS1 = path.join(REPO_ROOT, 'platform', 'scripts', 'restore-official.ps1');
const INSTALLER_PS1 = path.join(REPO_ROOT, 'platform', 'scripts', 'install-or-update.ps1');
const PATCH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'patch.js');
const AGM_LOCKS_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_locks.js');
const AGM_IPC_AUTH_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_ipc_auth.js');
const REAPER_CORE_JS = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_sidecar_reaper_core.js');
const TEMPLATE_YML = path.join(REPO_ROOT, 'platform', 'mod_kit', 'app-update.template.yml');

const agmLocks = require(AGM_LOCKS_JS);

const results = [];
const fiEvidenceRecords = [];
const fiLogDir = process.env.AGM_FI_LOG_DIR ? path.resolve(process.env.AGM_FI_LOG_DIR) : null;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sha256File(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 'MISSING';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function parseStatusOutput(output) {
  const map = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.includes('[AGM][Status]') && !line.includes('[AGM][Installer][Status]')) continue;
    const re = /([A-Z0-9_]+)=([^\s]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      map[m[1]] = m[2];
    }
  }
  return map;
}

function recordEvidence(id, meta) {
  fiEvidenceRecords.push({ id, ...meta });
  if (!fiLogDir) return;
  ensureDir(fiLogDir);
  const logLines = [
    `=== Fault Injection Scenario: ${id} ===`,
    `Timestamp : ${new Date().toISOString()}`,
    `Command   : ${meta.command || ''}`,
    `ExitCode  : ${meta.exitCode}`,
    `StatusMap : ${JSON.stringify(meta.statusMap || {})}`,
    `Extra     : ${JSON.stringify(meta.extra || {})}`,
    '--- RAW OUTPUT ---',
    meta.rawOutput || '',
  ];
  fs.writeFileSync(path.join(fiLogDir, `${id}.txt`), logLines.join('\n'), 'utf8');
}

function check(id, desc, cond, detail, evidenceMeta) {
  if (cond) {
    results.push({ id, ok: true });
    console.log(`PASS ${id} ${desc}`);
  } else {
    results.push({ id, ok: false });
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
  if (evidenceMeta) {
    recordEvidence(id, { passed: Boolean(cond), desc, ...evidenceMeta });
  }
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

if (cmd === '--version') { console.log('v0.0.0-fake'); process.exit(0); }

if (cmd === 'extract') {
  const srcAsar = process.argv[3];
  const destDir = process.argv[4];
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
  const files = {};
  collectFiles(srcDir, srcDir, files);
  fs.writeFileSync(outAsar, JSON.stringify({ tag: 'SYNTHETIC_PATCHED_ASAR', files }, null, 2), 'utf8');
  if (mode === 'emit_unpacked') {
    const stagedUnpacked = path.join(path.dirname(outAsar), 'app.asar.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
    fs.mkdirSync(path.dirname(stagedUnpacked), { recursive: true });
    fs.writeFileSync(stagedUnpacked, 'NEW_UNPACKED_CONTENT', 'utf8');
  }
  process.exit(0);
}

if (cmd === 'list') {
  const asarFile = process.argv[3];
  const bundle = JSON.parse(fs.readFileSync(asarFile, 'utf8'));
  for (const rel of Object.keys(bundle.files).sort()) {
    console.log('\\\\' + rel.split('/').join('\\\\'));
  }
  process.exit(0);
}

process.exit(2);
`;
  const cmdSource = `@echo off\r\n"${process.execPath}" "%~dp0fake_asar.js" %*\r\n`;
  fs.writeFileSync(jsPath, fakeAsarSource, 'utf8');
  fs.writeFileSync(cmdPath, cmdSource, 'utf8');
}

function setupFakeApp(caseDir, opts = {}) {
  const modKitDir = path.join(caseDir, 'mod_kit');
  const resDir = path.join(caseDir, 'resources');
  ensureDir(modKitDir);
  ensureDir(resDir);

  fs.copyFileSync(REPATCH_PS1, path.join(modKitDir, 'repatch.ps1'));
  fs.copyFileSync(PATCH_JS, path.join(modKitDir, 'patch.js'));
  fs.copyFileSync(AGM_LOCKS_JS, path.join(modKitDir, 'agm_locks.js'));
  fs.copyFileSync(AGM_IPC_AUTH_JS, path.join(modKitDir, 'agm_ipc_auth.js'));
  fs.copyFileSync(REAPER_CORE_JS, path.join(modKitDir, 'agm_sidecar_reaper_core.js'));
  fs.copyFileSync(TEMPLATE_YML, path.join(modKitDir, 'app-update.template.yml'));
  if (!opts.omitUpdateYml) {
    if (opts.updateYmlContent !== undefined) {
      fs.writeFileSync(path.join(resDir, 'app-update.yml'), opts.updateYmlContent, 'utf8');
    } else {
      fs.copyFileSync(TEMPLATE_YML, path.join(resDir, 'app-update.yml'));
    }
  }

  const asarPath = path.join(resDir, 'app.asar');
  fs.writeFileSync(asarPath, createSyntheticBundleJson(), 'utf8');
  const origHash = sha256File(asarPath);

  let unpackedLic = null;
  if (opts.withUnpacked) {
    unpackedLic = path.join(resDir, 'app.asar.unpacked', 'node_modules', 'chrome-devtools-mcp', 'LICENSE');
    ensureDir(path.dirname(unpackedLic));
    fs.writeFileSync(unpackedLic, 'ORIG_UNPACKED_CONTENT', 'utf8');
  }

  return { modKitDir, resDir, asarPath, origHash, ymlPath: path.join(resDir, 'app-update.yml'), unpackedLic };
}

function runPs1(scriptPath, args, fakeBinDir, tmpEnvDir, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (fakeBinDir) {
    env.PATH = fakeBinDir + path.delimiter + (process.env.PATH || '');
  }
  if (tmpEnvDir) {
    env.TEMP = tmpEnvDir;
    env.TMP = tmpEnvDir;
  }
  const fullArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args];
  const res = spawnSync('powershell.exe', fullArgs, { encoding: 'utf8', env, timeout: 45000 });
  const rawOutput = (res.stdout || '') + '\n' + (res.stderr || '');
  return {
    command: `powershell.exe ${fullArgs.join(' ')}`,
    status: res.status,
    rawOutput,
    statusMap: parseStatusOutput(rawOutput),
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
      if (outBuf.includes('LOCKED')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { errBuf += chunk.toString('utf8'); });
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
          try { child.kill(); } catch (_) {}
          resolve();
        }
      }, 3000);
      child.once('close', () => {
        if (!settled) { settled = true; clearTimeout(killTimer); resolve(); }
      });
    });
  }
}

async function withRunningProcessInDir(caseDir, fn) {
  const comSpec = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const dummyExe = path.join(caseDir, 'agm_dummy_proc.exe');
  fs.copyFileSync(comSpec, dummyExe);

  const child = spawn(dummyExe, ['/c', 'echo READY & set /p _agm_hold='], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    let outBuf = '';
    let errBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for dummy process in ${caseDir}: stdout=${outBuf} stderr=${errBuf}`));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      outBuf += chunk.toString('utf8');
      if (outBuf.includes('READY')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { errBuf += chunk.toString('utf8'); });
    child.once('exit', (code) => {
      if (!outBuf.includes('READY')) {
        clearTimeout(timer);
        reject(new Error(`Dummy process exited early (code=${code}): stderr=${errBuf}`));
      }
    });
  });

  try {
    return await fn(child.pid, dummyExe);
  } finally {
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write('\r\n');
        child.stdin.end();
      }
    } catch (_) {}
    await new Promise((resolve) => {
      let settled = false;
      const killTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { child.kill(); } catch (_) {}
          resolve();
        }
      }, 2500);
      child.once('close', () => {
        if (!settled) { settled = true; clearTimeout(killTimer); resolve(); }
      });
    });
    try { fs.rmSync(dummyExe, { force: true }); } catch (_) {}
  }
}

async function runAll() {
  // FI-S1: Cross-platform static contract check on R3 hardening tokens
  {
    const repatchSrc = fs.readFileSync(REPATCH_PS1, 'utf8');
    const restoreSrc = fs.readFileSync(RESTORE_PS1, 'utf8');
    const installerSrc = fs.readFileSync(INSTALLER_PS1, 'utf8');
    const requiredCommon = [
      'UNKNOWN/NEEDS_RECOVERY',
      'FAILED_NEEDS_MANUAL_RECOVERY',
      'RECOVERED_AUTO',
      'CLEAN_NO_CHANGE',
      'ABORTED_PROCESS_RUNNING',
      '[AGM][Status]',
      'Get-Sha256Upper',
    ];
    const missRepatch = requiredCommon.concat(['RESTORE_FAILED_BACKUP_RETAINED', 'mustRetainForUnpacked', 'UNCHANGED_ALREADY_CONFORMANT', 'ABORTED_PROCESS_RUNNING_BACKUP_CREATED'])
      .filter((t) => !repatchSrc.includes(t));
    const missRestore = requiredCommon.concat(['mustRetain', 'app.asar.replace_bak'])
      .filter((t) => !restoreSrc.includes(t));
    const missInstaller = ['Get-Sha256Upper', 'Build-DesiredUpdateYmlPlan', 'StagedUpdateYmlPath', 'ALREADY_CONFORMANT', 'SURGICAL_UPDATE', 'ABORTED_PROCESS_RUNNING', 'ABORTED_PROCESS_RUNNING_BACKUP_CREATED']
      .filter((t) => !installerSrc.includes(t));
    const hasMoveItem = /\bMove-Item\b/i.test(repatchSrc);
    const hasGetFileHash = /\bGet-FileHash\b/i.test(repatchSrc) || /\bGet-FileHash\b/i.test(restoreSrc) || /\bGet-FileHash\b/i.test(installerSrc);
    const hasStaleNothingChanged = repatchSrc.includes('Nothing was changed.') || restoreSrc.includes('Nothing was changed.') || installerSrc.includes('Nothing was changed.');

    check(
      'FI-S1',
      'R3 recovery state machine, truthful exit-3 states, physical retain guards, .NET SHA256, and zero Move-Item/Get-FileHash tokens present across scripts',
      missRepatch.length === 0 && missRestore.length === 0 && missInstaller.length === 0 && !hasMoveItem && !hasGetFileHash && !hasStaleNothingChanged,
      { missRepatch, missRestore, missInstaller, hasMoveItem, hasGetFileHash, hasStaleNothingChanged },
      { command: 'static-contract-check', exitCode: 0, statusMap: {}, extra: { missRepatch, missRestore, missInstaller, hasMoveItem, hasGetFileHash, hasStaleNothingChanged } }
    );
  }

  // FI-S2: Cross-platform agm_locks.js transactional YAML behavior
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agm_fi_s2_'));
    try {
      const ymlPath = path.join(tmp, 'app-update.yml');
      const customLocked = '# keep comment\nprovider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: antigravity-mod-updater\ncustomKey: keep-value\n';
      fs.writeFileSync(ymlPath, customLocked, 'utf8');
      const past = new Date(Date.now() - 15000);
      fs.utimesSync(ymlPath, past, past);
      const mtime0 = fs.statSync(ymlPath).mtimeMs;
      const sha0 = sha256File(ymlPath);
      const rNoop = agmLocks.lockUpdateYml(ymlPath);
      const mtime1 = fs.statSync(ymlPath).mtimeMs;
      const sha1 = sha256File(ymlPath);

      const nonDefault = '# keep comment\nprovider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: custom-cache\ncustomKey: keep-value\n';
      fs.writeFileSync(ymlPath, nonDefault, 'utf8');
      const srcSha = sha256File(ymlPath);
      const stagedPath = path.join(tmp, 'staged.yml');
      const rStage = agmLocks.lockUpdateYml(ymlPath, { outPath: stagedPath });
      const srcShaAfter = sha256File(ymlPath);
      const stagedTxt = fs.readFileSync(stagedPath, 'utf8');

      check(
        'FI-S2',
        'agm_locks.js performs no-op on conformant YAML and stages updates without mutating active YAML',
        rNoop.changed === false &&
          mtime0 === mtime1 &&
          sha0 === sha1 &&
          rStage.changed === true &&
          srcSha === srcShaAfter &&
          stagedTxt.includes('updaterCacheDirName: antigravity-mod-updater') &&
          stagedTxt.includes('customKey: keep-value'),
        { rNoop, mtime0, mtime1, sha0, sha1, rStage, srcSha, srcShaAfter },
        { command: 'agm_locks.lockUpdateYml', exitCode: 0, statusMap: {}, extra: { sha0, sha1, srcSha, srcShaAfter } }
      );
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    }
  }

  if (process.platform !== 'win32') {
    console.log('INFO Non-Windows host detected; skipping Windows PowerShell/Win32 File.Replace fault injection scenarios FI-R1..FI-R8b, FI-U1..FI-U5b, FI-Y1..FI-Y6, FI-P1..FI-P3.');
    const f = results.filter((r) => !r.ok).length;
    console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
    process.exitCode = f ? 1 : 0;
    return;
  }

  const rootTmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agm_fi_win_')));
  try {
    const fakeBinDir = path.join(rootTmp, 'fakebin');
    const psTempDir = path.join(rootTmp, 'pstemp');
    ensureDir(fakeBinDir);
    ensureDir(psTempDir);
    writeFakeAsarCli(fakeBinDir);

    // =========================================================================
    // Group A: Atomic Replace & Abnormal Recovery (FI-R1 .. FI-R8b)
    // =========================================================================

    // FI-R1: Exception after File.Replace succeeded -> auto rollback, target restored, temp cleaned
    {
      const caseDir = path.join(rootTmp, 'fi_r1_post_replace_exc');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'post_replace_exception' }
      );
      const afterHash = sha256File(asarPath);
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      check(
        'FI-R1',
        'post-File.Replace exception automatically rolls back app.asar to original SHA256 and cleans temp',
        res.status === 9 &&
          res.statusMap.RECOVERY_STATE === 'RECOVERED_AUTO' &&
          afterHash === origHash &&
          bakHash === origHash &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, origHash, afterHash, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, bakHash, tmpDirs } }
      );
    }

    // FI-R2: Partial failure during replace (corrupts target + throws IOException) -> does not assume unchanged, recovers
    {
      const caseDir = path.join(rootTmp, 'fi_r2_partial_fail');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'replace_partial_fail' }
      );
      const afterHash = sha256File(asarPath);
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = fs.readdirSync(resDir).filter((n) => n.startsWith('app.asar.prev_'));
      check(
        'FI-R2',
        'partial replace failure (IOException + corrupted target) detects mismatch and rolls back from verified backup',
        res.status === 10 &&
          res.statusMap.RECOVERY_STATE === 'RECOVERED_AUTO' &&
          afterHash === origHash &&
          prevs.length === 1 &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, origHash, afterHash, prevs, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, prevs, tmpDirs } }
      );
    }

    // FI-R3: Target locked after File.Replace -> retains trusted recovery materials, reports UNKNOWN/NEEDS_RECOVERY
    {
      const caseDir = path.join(rootTmp, 'fi_r3_post_locked');
      const { modKitDir, resDir, origHash } = setupFakeApp(caseDir);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'post_replace_target_locked' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = fs.readdirSync(resDir).filter((n) => n.startsWith('app.asar.prev_'));
      const stageBak = tmpDirs.length === 1 ? path.join(resDir, tmpDirs[0], 'app.asar.replace_bak') : '';
      const stageBakHash = sha256File(stageBak);
      const prevHash = prevs.length === 1 ? sha256File(path.join(resDir, prevs[0])) : 'MISSING';
      check(
        'FI-R3',
        'post-replace target lock retains trusted recovery materials and reports UNKNOWN/NEEDS_RECOVERY',
        res.status === 10 &&
          res.statusMap.RECOVERY_STATE === 'UNKNOWN/NEEDS_RECOVERY' &&
          tmpDirs.length === 1 &&
          stageBakHash === origHash &&
          prevHash === origHash,
        { status: res.status, statusMap: res.statusMap, tmpDirs, stageBakHash, prevHash, origHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, stageBakHash, prevHash, tmpDirs } }
      );
    }

    // FI-R4: Rollback itself fails again -> retains unique recovery backups, reports FAILED_NEEDS_MANUAL_RECOVERY
    {
      const caseDir = path.join(rootTmp, 'fi_r4_rollback_fail');
      const { modKitDir, resDir, origHash } = setupFakeApp(caseDir);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'post_replace_exception,rollback_asar_fail' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = fs.readdirSync(resDir).filter((n) => n.startsWith('app.asar.prev_'));
      const stageBak = tmpDirs.length === 1 ? path.join(resDir, tmpDirs[0], 'app.asar.replace_bak') : '';
      const stageBakHash = sha256File(stageBak);
      const prevHash = prevs.length === 1 ? sha256File(path.join(resDir, prevs[0])) : 'MISSING';
      check(
        'FI-R4',
        'secondary rollback failure retains stage & prev backups and reports FAILED_NEEDS_MANUAL_RECOVERY',
        res.status === 11 &&
          res.statusMap.RECOVERY_STATE === 'FAILED_NEEDS_MANUAL_RECOVERY' &&
          tmpDirs.length === 1 &&
          stageBakHash === origHash &&
          prevHash === origHash,
        { status: res.status, statusMap: res.statusMap, tmpDirs, stageBakHash, prevHash, origHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, stageBakHash, prevHash, tmpDirs } }
      );
    }

    // FI-R5: Backup exists, File.Replace throws & target state unreadable -> retains backup, reports UNKNOWN/NEEDS_RECOVERY
    {
      const caseDir = path.join(rootTmp, 'fi_r5_unconfirmed_target');
      const { modKitDir, resDir, origHash } = setupFakeApp(caseDir);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'replace_throw_target_unreadable' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const prevs = fs.readdirSync(resDir).filter((n) => n.startsWith('app.asar.prev_'));
      const prevHash = prevs.length === 1 ? sha256File(path.join(resDir, prevs[0])) : 'MISSING';
      check(
        'FI-R5',
        'unconfirmed target state after replace error retains prev backup and reports UNKNOWN/NEEDS_RECOVERY',
        res.status === 10 &&
          res.statusMap.RECOVERY_STATE === 'UNKNOWN/NEEDS_RECOVERY' &&
          tmpDirs.length === 1 &&
          prevs.length === 1 &&
          prevHash === origHash &&
          !res.rawOutput.includes('原文件未被覆写'),
        { status: res.status, statusMap: res.statusMap, tmpDirs, prevs, prevHash, origHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, prevHash, tmpDirs } }
      );
    }

    // FI-R6: restore-official.ps1 partial replace failure -> safely rolls back to pre-restore active hash
    {
      const caseDir = path.join(rootTmp, 'fi_r6_restore_partial');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const prep = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedHash = sha256File(asarPath);
      const res = runPs1(
        RESTORE_PS1,
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'restore_replace_partial_fail' }
      );
      const afterHash = sha256File(asarPath);
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_restore_tmp_'));
      check(
        'FI-R6',
        'restore-official.ps1 partial failure rolls back atomically to pre-restore modded SHA256',
        prep.status === 0 &&
          res.status === 10 &&
          res.statusMap.RECOVERY_STATE === 'RECOVERED_AUTO' &&
          afterHash === moddedHash &&
          bakHash === origHash &&
          tmpDirs.length === 0,
        { prepStatus: prep.status, status: res.status, statusMap: res.statusMap, moddedHash, afterHash, bakHash, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { moddedHash, afterHash, bakHash, tmpDirs } }
      );
    }

    // FI-R7: restore-official.ps1 post-restore hash mismatch -> safely rolls back to pre-restore active hash
    {
      const caseDir = path.join(rootTmp, 'fi_r7_restore_mismatch');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const prep = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedHash = sha256File(asarPath);
      const res = runPs1(
        RESTORE_PS1,
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'restore_post_hash_mismatch' }
      );
      const afterHash = sha256File(asarPath);
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_restore_tmp_'));
      check(
        'FI-R7',
        'restore-official.ps1 post-replace hash mismatch rolls back atomically to pre-restore SHA256',
        prep.status === 0 &&
          res.status === 4 &&
          res.statusMap.RECOVERY_STATE === 'RECOVERED_AUTO' &&
          afterHash === moddedHash &&
          bakHash === origHash &&
          tmpDirs.length === 0,
        { prepStatus: prep.status, status: res.status, statusMap: res.statusMap, moddedHash, afterHash, bakHash, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { moddedHash, afterHash, bakHash, tmpDirs } }
      );
    }

    // FI-R8a: restore-official.ps1 target locked after replace -> retains recovery materials, UNKNOWN/NEEDS_RECOVERY
    {
      const caseDir = path.join(rootTmp, 'fi_r8a_restore_locked');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const prep = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedHash = sha256File(asarPath);
      const res = runPs1(
        RESTORE_PS1,
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'restore_post_target_locked' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_restore_tmp_'));
      const stageBakHash = tmpDirs.length === 1 ? sha256File(path.join(resDir, tmpDirs[0], 'app.asar.replace_bak')) : 'MISSING';
      const bakHash = sha256File(path.join(resDir, 'app.asar.bak'));
      check(
        'FI-R8a',
        'restore-official.ps1 target locked after replace retains recovery materials and reports UNKNOWN/NEEDS_RECOVERY',
        prep.status === 0 &&
          res.status === 10 &&
          res.statusMap.RECOVERY_STATE === 'UNKNOWN/NEEDS_RECOVERY' &&
          tmpDirs.length === 1 &&
          stageBakHash === moddedHash &&
          bakHash === origHash,
        { status: res.status, statusMap: res.statusMap, tmpDirs, stageBakHash, moddedHash, bakHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { moddedHash, stageBakHash, bakHash, tmpDirs } }
      );
    }

    // FI-R8b: restore-official.ps1 hash mismatch + rollback fail -> retains all recovery materials, FAILED_NEEDS_MANUAL_RECOVERY
    {
      const caseDir = path.join(rootTmp, 'fi_r8b_restore_rollback_fail');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const prep = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const moddedHash = sha256File(asarPath);
      const res = runPs1(
        RESTORE_PS1,
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'restore_post_hash_mismatch,restore_rollback_fail' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_restore_tmp_'));
      const stageBakHash = tmpDirs.length === 1 ? sha256File(path.join(resDir, tmpDirs[0], 'app.asar.replace_bak')) : 'MISSING';
      const displacedDirs = fs.readdirSync(caseDir).filter((n) => n.startsWith('displaced_mod_'));
      const displacedHash = displacedDirs.length === 1 ? sha256File(path.join(caseDir, displacedDirs[0], 'app.asar.mod_patched')) : 'MISSING';
      check(
        'FI-R8b',
        'restore-official.ps1 secondary rollback failure retains stage_bak & displaced archive and reports FAILED_NEEDS_MANUAL_RECOVERY',
        prep.status === 0 &&
          res.status === 11 &&
          res.statusMap.RECOVERY_STATE === 'FAILED_NEEDS_MANUAL_RECOVERY' &&
          tmpDirs.length === 1 &&
          stageBakHash === moddedHash &&
          displacedHash === moddedHash,
        { status: res.status, statusMap: res.statusMap, tmpDirs, stageBakHash, displacedHash, moddedHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { moddedHash, stageBakHash, displacedHash, tmpDirs } }
      );
    }

    // =========================================================================
    // Group B: app.asar.unpacked Directory Rollback (FI-U1 .. FI-U5b)
    // =========================================================================

    // FI-U1: First directory move fails -> original unpacked untouched, app.asar auto-rolled back
    {
      const caseDir = path.join(rootTmp, 'fi_u1_first_move_fail');
      const { modKitDir, resDir, asarPath, origHash, unpackedLic } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'unpacked_first_move_fail' }
      );
      const afterHash = sha256File(asarPath);
      const licText = fs.existsSync(unpackedLic) ? fs.readFileSync(unpackedLic, 'utf8') : 'MISSING';
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'FI-U1',
        'first unpacked directory move failure preserves original unpacked and rolls back app.asar consistently',
        res.status === 9 &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          res.statusMap.RECOVERY_STATE === 'RECOVERED_AUTO' &&
          afterHash === origHash &&
          licText === 'ORIG_UNPACKED_CONTENT' &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, afterHash, origHash, licText, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, licText, tmpDirs } }
      );
    }

    // FI-U2: Second directory move fails -> restores original unpacked first & rolls back app.asar
    {
      const caseDir = path.join(rootTmp, 'fi_u2_second_move_fail');
      const { modKitDir, resDir, asarPath, origHash, unpackedLic } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'unpacked_second_move_fail' }
      );
      const afterHash = sha256File(asarPath);
      const licText = fs.existsSync(unpackedLic) ? fs.readFileSync(unpackedLic, 'utf8') : 'MISSING';
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'FI-U2',
        'second unpacked move failure prioritizes restoring original unpacked and rolling back app.asar',
        res.status === 9 &&
          res.statusMap.UNPACKED_STATE === 'RESTORED_ORIG' &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          afterHash === origHash &&
          licText === 'ORIG_UNPACKED_CONTENT' &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, afterHash, origHash, licText, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, licText, tmpDirs } }
      );
    }

    // FI-U3: Restoring original unpacked fails -> finally MUST NOT delete unique old backup dir; manual instructions printed
    {
      const caseDir = path.join(rootTmp, 'fi_u3_restore_fail');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'unpacked_second_move_fail,unpacked_restore_fail' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const retainedLic = tmpDirs.length === 1
        ? path.join(resDir, tmpDirs[0], 'app.asar.unpacked.orig_bak', 'node_modules', 'chrome-devtools-mcp', 'LICENSE')
        : '';
      const retainedContent = retainedLic && fs.existsSync(retainedLic) ? fs.readFileSync(retainedLic, 'utf8') : 'MISSING';
      const afterHash = sha256File(asarPath);
      check(
        'FI-U3',
        'unpacked restore failure retains unique old unpacked backup (never deleted by finally) and prints manual recovery instructions',
        res.status === 11 &&
          res.statusMap.UNPACKED_STATE === 'RESTORE_FAILED_BACKUP_RETAINED' &&
          res.statusMap.RECOVERY_STATE === 'FAILED_NEEDS_MANUAL_RECOVERY' &&
          res.statusMap.CONSISTENCY_STATE === 'INCONSISTENT_ASAR_UNPACKED' &&
          tmpDirs.length === 1 &&
          retainedContent === 'ORIG_UNPACKED_CONTENT' &&
          afterHash === origHash &&
          res.rawOutput.includes('[System.IO.Directory]::Move'),
        { status: res.status, statusMap: res.statusMap, tmpDirs, retainedContent, afterHash, origHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, retainedContent, tmpDirs } }
      );
    }

    // FI-U4: New unpacked moved in, then post-verify fails -> removes new, restores orig unpacked & rolls back app.asar
    {
      const caseDir = path.join(rootTmp, 'fi_u4_post_verify_fail');
      const { modKitDir, resDir, asarPath, origHash, unpackedLic } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'unpacked_post_verify_fail' }
      );
      const afterHash = sha256File(asarPath);
      const licText = fs.existsSync(unpackedLic) ? fs.readFileSync(unpackedLic, 'utf8') : 'MISSING';
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'FI-U4',
        'post-swap unpacked verification failure restores original unpacked and rolls back app.asar consistently',
        res.status === 9 &&
          res.statusMap.UNPACKED_STATE === 'RESTORED_ORIG' &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          afterHash === origHash &&
          licText === 'ORIG_UNPACKED_CONTENT' &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, afterHash, origHash, licText, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, licText, tmpDirs } }
      );
    }

    // FI-U5a: Real FileStream lock inside app.asar.unpacked -> exit 10, original unpacked intact, app.asar rolled back
    {
      const caseDir = path.join(rootTmp, 'fi_u5a_real_unpacked_lock');
      const { modKitDir, resDir, asarPath, origHash, unpackedLic } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = await withFileLock(unpackedLic, 'Read', 'Read', () =>
        runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const afterHash = sha256File(asarPath);
      const licText = fs.existsSync(unpackedLic) ? fs.readFileSync(unpackedLic, 'utf8') : 'MISSING';
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      check(
        'FI-U5a',
        'real FileStream lock on app.asar.unpacked exits 10, keeps original unpacked, and rolls back app.asar',
        res.status === 10 &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          afterHash === origHash &&
          licText === 'ORIG_UNPACKED_CONTENT' &&
          tmpDirs.length === 0,
        { status: res.status, statusMap: res.statusMap, afterHash, origHash, licText, tmpDirs },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, afterHash, licText, tmpDirs } }
      );
    }

    // FI-U5b: Unpacked directory occupied during rollback -> retains unique old backup directory safely
    {
      const caseDir = path.join(rootTmp, 'fi_u5b_restore_locked');
      const { modKitDir, resDir, origHash } = setupFakeApp(caseDir, { withUnpacked: true });
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'unpacked_second_move_fail,unpacked_restore_locked' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const retainedLic = tmpDirs.length === 1
        ? path.join(resDir, tmpDirs[0], 'app.asar.unpacked.orig_bak', 'node_modules', 'chrome-devtools-mcp', 'LICENSE')
        : '';
      const retainedContent = retainedLic && fs.existsSync(retainedLic) ? fs.readFileSync(retainedLic, 'utf8') : 'MISSING';
      check(
        'FI-U5b',
        'locked directory during unpacked rollback retains old unpacked backup safely without data loss',
        res.status === 11 &&
          res.statusMap.UNPACKED_STATE === 'RESTORE_FAILED_BACKUP_RETAINED' &&
          res.statusMap.RECOVERY_STATE === 'FAILED_NEEDS_MANUAL_RECOVERY' &&
          tmpDirs.length === 1 &&
          retainedContent === 'ORIG_UNPACKED_CONTENT',
        { status: res.status, statusMap: res.statusMap, tmpDirs, retainedContent },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { retainedContent, tmpDirs } }
      );
    }

    // =========================================================================
    // Group C: app-update.yml Transactional Consistency (FI-Y1 .. FI-Y6)
    // =========================================================================

    // FI-Y1: Non-default updaterCacheDirName + idempotent no-op + first-install missing YAML
    {
      const customNonDefault = '# user comment\nprovider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: custom-cache-dir\ncustomFlag: keep-user-config\n';
      const caseDir = path.join(rootTmp, 'fi_y1_nondefault_and_noop');
      const { modKitDir, origHash, ymlPath } = setupFakeApp(caseDir, { updateYmlContent: customNonDefault });
      const shaPre1 = sha256File(ymlPath);
      const r1 = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const shaPost1 = sha256File(ymlPath);
      const txtPost1 = fs.readFileSync(ymlPath, 'utf8');

      // Re-run on now-conformant YAML -> must be strict no-op (mtime & SHA256 unchanged)
      const past = new Date(Date.now() - 10000);
      fs.utimesSync(ymlPath, past, past);
      const mtimePre2 = fs.statSync(ymlPath).mtimeMs;
      const r2 = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const mtimePost2 = fs.statSync(ymlPath).mtimeMs;
      const shaPost2 = sha256File(ymlPath);

      // Missing YAML (first install)
      const caseFresh = path.join(rootTmp, 'fi_y1_first_install_no_yml');
      const freshSetup = setupFakeApp(caseFresh, { omitUpdateYml: true });
      const rFresh = runPs1(path.join(freshSetup.modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseFresh], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: freshSetup.origHash });
      const freshYmlSha = sha256File(freshSetup.ymlPath);

      check(
        'FI-Y1',
        'non-default updaterCacheDirName updates preserving custom keys, repeat run is true no-op, missing YAML supported on first install',
        r1.status === 0 &&
          shaPre1 !== shaPost1 &&
          txtPost1.includes('updaterCacheDirName: antigravity-mod-updater') &&
          txtPost1.includes('customFlag: keep-user-config') &&
          r2.status === 0 &&
          r2.statusMap.YAML_STATE === 'UNCHANGED_ALREADY_CONFORMANT' &&
          mtimePre2 === mtimePost2 &&
          shaPost1 === shaPost2 &&
          rFresh.status === 0 &&
          rFresh.statusMap.YAML_PRE_EXISTS === 'False' &&
          rFresh.statusMap.YAML_STATE === 'CREATED_ATOMICALLY' &&
          freshYmlSha !== 'MISSING',
        { r1: r1.status, shaPre1, shaPost1, r2Map: r2.statusMap, mtimePre2, mtimePost2, shaPost2, rFreshMap: rFresh.statusMap, freshYmlSha },
        {
          command: `${r1.command} | ${r2.command} | ${rFresh.command}`,
          exitCode: rFresh.status,
          statusMap: r1.statusMap,
          rawOutput: r1.rawOutput + '\n--- RUN2 ---\n' + r2.rawOutput + '\n--- FRESH ---\n' + rFresh.rawOutput,
          extra: { shaPre1, shaPost1, shaPost2, freshYmlSha },
        }
      );
    }

    // FI-Y2: pack failure leaves active app-update.yml untouched (both non-default existing & missing first-install)
    {
      const nonDefYml = 'provider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: pre-pack-fail\ncustomKey: safe\n';
      const caseDir = path.join(rootTmp, 'fi_y2_pack_fail');
      const { modKitDir, origHash, ymlPath } = setupFakeApp(caseDir, { updateYmlContent: nonDefYml });
      const shaPre = sha256File(ymlPath);
      const r1 = runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'fail_pack', AGM_OFFICIAL_ASAR_SHA256: origHash });
      const shaPost = sha256File(ymlPath);

      const caseFresh = path.join(rootTmp, 'fi_y2_pack_fail_missing_yml');
      const freshSetup = setupFakeApp(caseFresh, { omitUpdateYml: true });
      const r2 = runPs1(path.join(freshSetup.modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseFresh], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'fail_pack', AGM_OFFICIAL_ASAR_SHA256: freshSetup.origHash });
      const freshExists = fs.existsSync(freshSetup.ymlPath);

      check(
        'FI-Y2',
        'pack failure leaves active app-update.yml untouched (non-default & missing YAML cases)',
        r1.status === 17 && shaPre === shaPost && r2.status === 17 && !freshExists,
        { r1: r1.status, shaPre, shaPost, r2: r2.status, freshExists },
        {
          command: r1.command,
          exitCode: r1.status,
          statusMap: r1.statusMap,
          rawOutput: r1.rawOutput + '\n--- MISSING YML ---\n' + r2.rawOutput,
          extra: { shaPre, shaPost, freshExists },
        }
      );
    }

    // FI-Y3: File.Replace failure (real FileStream read lock) leaves active app-update.yml untouched
    {
      const nonDefYml = 'provider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: pre-replace-fail\ncustomKey: safe\n';
      const caseDir = path.join(rootTmp, 'fi_y3_replace_fail');
      const { modKitDir, asarPath, origHash, ymlPath } = setupFakeApp(caseDir, { updateYmlContent: nonDefYml });
      const shaPre = sha256File(ymlPath);
      const res = await withFileLock(asarPath, 'Read', 'Read', () =>
        runPs1(path.join(modKitDir, 'repatch.ps1'), ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const shaPost = sha256File(ymlPath);
      const asarAfter = sha256File(asarPath);
      check(
        'FI-Y3',
        'File.Replace failure under real file lock leaves active app-update.yml and app.asar untouched',
        res.status === 10 && shaPre === shaPost && asarAfter === origHash,
        { status: res.status, statusMap: res.statusMap, shaPre, shaPost, asarAfter, origHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { shaPre, shaPost, origHash, asarAfter } }
      );
    }

    // FI-Y4: YAML write failure (both clean fail & partial corrupt fail) rolls back YAML, app.asar, and unpacked
    {
      const nonDefYml = 'provider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: pre-yaml-write-fail\ncustomKey: safe\n';
      const case1 = path.join(rootTmp, 'fi_y4a_yaml_write_fail');
      const s1 = setupFakeApp(case1, { updateYmlContent: nonDefYml, withUnpacked: true });
      const shaPre1 = sha256File(s1.ymlPath);
      const r1 = runPs1(
        path.join(s1.modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', case1],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: s1.origHash, AGM_TEST_FAULT_INJECT: 'yaml_write_fail' }
      );
      const shaPost1 = sha256File(s1.ymlPath);

      const case2 = path.join(rootTmp, 'fi_y4b_yaml_partial_fail');
      const s2 = setupFakeApp(case2, { updateYmlContent: nonDefYml, withUnpacked: true });
      const shaPre2 = sha256File(s2.ymlPath);
      const r2 = runPs1(
        path.join(s2.modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', case2],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'emit_unpacked', AGM_OFFICIAL_ASAR_SHA256: s2.origHash, AGM_TEST_FAULT_INJECT: 'yaml_write_partial_fail' }
      );
      const shaPost2 = sha256File(s2.ymlPath);
      const asarPost2 = sha256File(s2.asarPath);
      const licPost2 = fs.readFileSync(s2.unpackedLic, 'utf8');

      check(
        'FI-Y4',
        'YAML write failure (clean & partial) rolls back YAML, app.asar, and app.asar.unpacked consistently',
        r1.status === 12 && shaPre1 === shaPost1 && r2.status === 12 && r2.statusMap.YAML_STATE === 'RECOVERED_AUTO' && r2.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' && shaPre2 === shaPost2 && asarPost2 === s2.origHash && licPost2 === 'ORIG_UNPACKED_CONTENT',
        { r1Status: r1.status, shaPre1, shaPost1, r2Status: r2.status, r2Map: r2.statusMap, shaPre2, shaPost2, asarPost2, licPost2 },
        {
          command: r2.command,
          exitCode: r2.status,
          statusMap: r2.statusMap,
          rawOutput: r1.rawOutput + '\n--- PARTIAL ---\n' + r2.rawOutput,
          extra: { shaPre1, shaPost1, shaPre2, shaPost2, asarPost2 },
        }
      );
    }

    // FI-Y5: YAML restore failure retains YAML backup & temp dir and reports FAILED_NEEDS_MANUAL_RECOVERY
    {
      const nonDefYml = 'provider: generic\nurl: http://127.0.0.1:9/agm-update-disabled/\nupdaterCacheDirName: pre-yaml-restore-fail\ncustomKey: safe\n';
      const caseDir = path.join(rootTmp, 'fi_y5_yaml_restore_fail');
      const { modKitDir, resDir, origHash, ymlPath } = setupFakeApp(caseDir, { updateYmlContent: nonDefYml });
      const shaPre = sha256File(ymlPath);
      const res = runPs1(
        path.join(modKitDir, 'repatch.ps1'),
        ['-TargetAppDir', caseDir],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash, AGM_TEST_FAULT_INJECT: 'yaml_write_partial_fail,yaml_restore_fail' }
      );
      const tmpDirs = fs.readdirSync(resDir).filter((n) => n.startsWith('.agm_repatch_tmp_'));
      const retainedYamlBakHash = tmpDirs.length === 1 ? sha256File(path.join(resDir, tmpDirs[0], 'app-update.yml.orig_bak')) : 'MISSING';
      check(
        'FI-Y5',
        'YAML restore failure retains app-update.yml.orig_bak and reports FAILED_NEEDS_MANUAL_RECOVERY',
        res.status === 11 &&
          res.statusMap.RECOVERY_STATE === 'FAILED_NEEDS_MANUAL_RECOVERY' &&
          res.statusMap.CONSISTENCY_STATE === 'INCONSISTENT_YAML' &&
          tmpDirs.length === 1 &&
          retainedYamlBakHash === shaPre,
        { status: res.status, statusMap: res.statusMap, tmpDirs, shaPre, retainedYamlBakHash },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { shaPre, retainedYamlBakHash, tmpDirs } }
      );
    }

    // FI-Y6: install-or-update.ps1 calling repatch.ps1 fails -> preserves original YAML (existing custom & missing), no .bak_* created; -SkipRepatch preserves conformant custom YAML
    {
      // Subcase A: existing custom upstream YAML + repatch fail_pack
      const customUpstreamYml = '# custom user note\nprovider: generic\nurl: https://upstream.example.invalid/releases/\nupdaterCacheDirName: user-custom-cache\ncustomChannel: beta\n';
      const caseA = path.join(rootTmp, 'fi_y6_installer_fail_existing');
      const sA = setupFakeApp(caseA, { updateYmlContent: customUpstreamYml });
      const shaPreA = sha256File(sA.ymlPath);
      const resA = runPs1(
        INSTALLER_PS1,
        ['-TargetAppDir', caseA],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'fail_pack', AGM_OFFICIAL_ASAR_SHA256: sA.origHash }
      );
      const shaPostA = sha256File(sA.ymlPath);
      const bakFilesA = fs.readdirSync(sA.resDir).filter((n) => n.startsWith('app-update.yml.bak_'));
      const tmpInstallA = fs.readdirSync(sA.resDir).filter((n) => n.startsWith('.agm_install_tmp_'));

      // Subcase B: missing YAML (first install) + repatch fail_pack
      const caseB = path.join(rootTmp, 'fi_y6_installer_fail_missing');
      const sB = setupFakeApp(caseB, { omitUpdateYml: true });
      const resB = runPs1(
        INSTALLER_PS1,
        ['-TargetAppDir', caseB],
        fakeBinDir,
        psTempDir,
        { AGM_FAKE_ASAR_MODE: 'fail_pack', AGM_OFFICIAL_ASAR_SHA256: sB.origHash }
      );
      const existsAfterB = fs.existsSync(sB.ymlPath);

      // Subcase C: -SkipRepatch with already conformant custom YAML -> no-op, custom keys & mtime preserved
      const customConformant = '# custom user note\nprovider: generic\nurl: http://127.0.0.1:9/custom-dead/\nupdaterCacheDirName: antigravity-mod-updater\ncustomChannel: beta\n';
      const caseC = path.join(rootTmp, 'fi_y6_installer_skiprepatch_custom');
      const sC = setupFakeApp(caseC, { updateYmlContent: customConformant });
      const pastC = new Date(Date.now() - 10000);
      fs.utimesSync(sC.ymlPath, pastC, pastC);
      const mtimePreC = fs.statSync(sC.ymlPath).mtimeMs;
      const shaPreC = sha256File(sC.ymlPath);
      const resC = runPs1(
        INSTALLER_PS1,
        ['-TargetAppDir', caseC, '-SkipRepatch'],
        fakeBinDir,
        psTempDir,
        {}
      );
      const mtimePostC = fs.statSync(sC.ymlPath).mtimeMs;
      const shaPostC = sha256File(sC.ymlPath);

      check(
        'FI-Y6',
        'install-or-update.ps1 preserves original/missing YAML on repatch failure and preserves custom conformant YAML on -SkipRepatch',
        resA.status === 17 &&
          shaPreA === shaPostA &&
          bakFilesA.length === 0 &&
          tmpInstallA.length === 0 &&
          resB.status === 17 &&
          !existsAfterB &&
          resC.status === 0 &&
          shaPreC === shaPostC &&
          mtimePreC === mtimePostC,
        { resAStatus: resA.status, shaPreA, shaPostA, bakFilesA, tmpInstallA, resBStatus: resB.status, existsAfterB, resCStatus: resC.status, shaPreC, shaPostC, mtimePreC, mtimePostC },
        {
          command: resA.command,
          exitCode: resA.status,
          statusMap: resA.statusMap,
          rawOutput: resA.rawOutput + '\n--- MISSING ---\n' + resB.rawOutput + '\n--- SKIPREPATCH ---\n' + resC.rawOutput,
          extra: { shaPreA, shaPostA, existsAfterB, shaPreC, shaPostC },
        }
      );
    }

    // =========================================================================
    // Group D: Process Running exit 3 Truthful Status (FI-P1 .. FI-P3)
    // =========================================================================

    // FI-P1: repatch.ps1 creates trusted official .bak first, then aborts exit 3 due to running process -> truthful backup-created message & ABORTED_PROCESS_RUNNING_BACKUP_CREATED
    {
      const caseDir = path.join(rootTmp, 'fi_p1_exit3_bak_created');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const bakPath = path.join(resDir, 'app.asar.bak');
      const res = await withRunningProcessInDir(caseDir, () =>
        runPs1(
          path.join(modKitDir, 'repatch.ps1'),
          ['-TargetAppDir', caseDir],
          fakeBinDir,
          psTempDir,
          { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash }
        )
      );
      const bakExists = fs.existsSync(bakPath);
      const bakHash = sha256File(bakPath);
      const afterAsarHash = sha256File(asarPath);
      check(
        'FI-P1',
        'repatch.ps1 exit 3 after creating trusted .bak truthfully reports backup creation and ABORTED_PROCESS_RUNNING_BACKUP_CREATED',
        res.status === 3 &&
          res.statusMap.RECOVERY_STATE === 'ABORTED_PROCESS_RUNNING_BACKUP_CREATED' &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          bakExists &&
          bakHash === origHash &&
          afterAsarHash === origHash &&
          res.rawOutput.includes('已创建可信官方备份') &&
          res.rawOutput.includes(bakPath) &&
          !res.rawOutput.includes('CLEAN_NO_CHANGE') &&
          !res.rawOutput.includes('Nothing was changed') &&
          !res.rawOutput.includes('没有变更'),
        { status: res.status, statusMap: res.statusMap, bakExists, bakHash, origHash, afterAsarHash, out: res.rawOutput.slice(-800) },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, bakHash, afterAsarHash, bakPath } }
      );
    }

    // FI-P2: repatch.ps1 with pre-existing trusted .bak aborts exit 3 -> reports retained backup & ABORTED_PROCESS_RUNNING
    {
      const caseDir = path.join(rootTmp, 'fi_p2_exit3_bak_retained');
      const { modKitDir, resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const bakPath = path.join(resDir, 'app.asar.bak');
      fs.copyFileSync(asarPath, bakPath);
      const res = await withRunningProcessInDir(caseDir, () =>
        runPs1(
          path.join(modKitDir, 'repatch.ps1'),
          ['-TargetAppDir', caseDir],
          fakeBinDir,
          psTempDir,
          { AGM_FAKE_ASAR_MODE: 'ok', AGM_OFFICIAL_ASAR_SHA256: origHash }
        )
      );
      const bakHash = sha256File(bakPath);
      const afterAsarHash = sha256File(asarPath);
      check(
        'FI-P2',
        'repatch.ps1 exit 3 with pre-existing trusted .bak reports retained backup and ABORTED_PROCESS_RUNNING',
        res.status === 3 &&
          res.statusMap.RECOVERY_STATE === 'ABORTED_PROCESS_RUNNING' &&
          res.statusMap.CONSISTENCY_STATE === 'CONSISTENT_ORIG' &&
          bakHash === origHash &&
          afterAsarHash === origHash &&
          res.rawOutput.includes('已保留') &&
          res.rawOutput.includes(bakPath) &&
          !res.rawOutput.includes('已创建可信官方备份') &&
          !res.rawOutput.includes('CLEAN_NO_CHANGE') &&
          !res.rawOutput.includes('Nothing was changed') &&
          !res.rawOutput.includes('没有变更'),
        { status: res.status, statusMap: res.statusMap, bakHash, origHash, afterAsarHash, out: res.rawOutput.slice(-800) },
        { command: res.command, exitCode: res.status, statusMap: res.statusMap, rawOutput: res.rawOutput, extra: { origHash, bakHash, afterAsarHash, bakPath } }
      );
    }

    // FI-P3: restore-official.ps1 & install-or-update.ps1 exit 3 truthful prompt & ABORTED_PROCESS_RUNNING (with & without .bak)
    {
      const caseDir = path.join(rootTmp, 'fi_p3_exit3_restore_and_installer');
      const { resDir, asarPath, origHash } = setupFakeApp(caseDir);
      const bakPath = path.join(resDir, 'app.asar.bak');

      // Subcase A: install-or-update.ps1 without .bak -> no mention of backup, ABORTED_PROCESS_RUNNING
      const instNoBak = await withRunningProcessInDir(caseDir, () =>
        runPs1(INSTALLER_PS1, ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, {})
      );
      const bakAfterInstNoBak = fs.existsSync(bakPath);

      // Subcase B & C: pre-create trusted .bak, run restore-official.ps1 and install-or-update.ps1 -> retained backup, ABORTED_PROCESS_RUNNING
      fs.copyFileSync(asarPath, bakPath);
      const restoreRes = await withRunningProcessInDir(caseDir, () =>
        runPs1(RESTORE_PS1, ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, { AGM_OFFICIAL_ASAR_SHA256: origHash })
      );
      const instWithBak = await withRunningProcessInDir(caseDir, () =>
        runPs1(INSTALLER_PS1, ['-TargetAppDir', caseDir], fakeBinDir, psTempDir, {})
      );

      const noStale = (txt) =>
        !txt.includes('CLEAN_NO_CHANGE') && !txt.includes('Nothing was changed') && !txt.includes('没有变更');

      check(
        'FI-P3',
        'restore-official.ps1 and install-or-update.ps1 exit 3 report ABORTED_PROCESS_RUNNING and truthful backup state (omitted when absent, retained when present)',
        instNoBak.status === 3 &&
          instNoBak.statusMap.RECOVERY_STATE === 'ABORTED_PROCESS_RUNNING' &&
          !bakAfterInstNoBak &&
          instNoBak.rawOutput.includes('未替换 app.asar') &&
          !instNoBak.rawOutput.includes('备份') &&
          noStale(instNoBak.rawOutput) &&
          restoreRes.status === 3 &&
          restoreRes.statusMap.RECOVERY_STATE === 'ABORTED_PROCESS_RUNNING' &&
          restoreRes.rawOutput.includes('已保留') &&
          restoreRes.rawOutput.includes(bakPath) &&
          noStale(restoreRes.rawOutput) &&
          instWithBak.status === 3 &&
          instWithBak.statusMap.RECOVERY_STATE === 'ABORTED_PROCESS_RUNNING' &&
          instWithBak.rawOutput.includes('已保留') &&
          instWithBak.rawOutput.includes(bakPath) &&
          noStale(instWithBak.rawOutput),
        {
          instNoBakStatus: instNoBak.status,
          instNoBakMap: instNoBak.statusMap,
          bakAfterInstNoBak,
          restoreStatus: restoreRes.status,
          restoreMap: restoreRes.statusMap,
          instWithBakStatus: instWithBak.status,
          instWithBakMap: instWithBak.statusMap,
        },
        {
          command: `${instNoBak.command} | ${restoreRes.command} | ${instWithBak.command}`,
          exitCode: restoreRes.status,
          statusMap: restoreRes.statusMap,
          rawOutput: instNoBak.rawOutput + '\n--- RESTORE ---\n' + restoreRes.rawOutput + '\n--- INSTALLER_WITH_BAK ---\n' + instWithBak.rawOutput,
          extra: { origHash, bakPath, bakAfterInstNoBak },
        }
      );
    }
  } finally {
    try { fs.rmSync(rootTmp, { recursive: true, force: true }); } catch (_) {}
  }

  if (fiLogDir) {
    ensureDir(fiLogDir);
    fs.writeFileSync(path.join(fiLogDir, 'fault_injection_matrix.json'), JSON.stringify(fiEvidenceRecords, null, 2), 'utf8');
  }

  const f = results.filter((r) => !r.ok).length;
  console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
  process.exitCode = f ? 1 : 0;
}

runAll().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
