// tests/test_reaper_unit.js : pure unit tests of platform/mod_kit/agm_sidecar_reaper_core.js with mock deps (RU1-RU16)
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const results = [];
const L = {
  T: REPO_ROOT,
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

const CORE_PATH = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_sidecar_reaper_core.js');
const CORE_SRC = fs.readFileSync(CORE_PATH, 'utf8');
const createSidecarReaper = new Function(
  'require',
  'process',
  'console',
  CORE_SRC + '\nreturn createSidecarReaper;'
)(require, process, console);

const MOCK_ROOT = 'C:\\Antigravity_Mod_Mock';
const SESSION_START = new Date('2026-11-18T12:00:00.000Z');
const allKillCalls = [];

function makeBaseTree() {
  return [
    {
      ProcessId: 100,
      ParentProcessId: 50,
      ExecutablePath: 'C:\\Antigravity_Mod_Mock\\resources\\bin\\language_server.exe',
      CommandLine: '"C:\\Antigravity_Mod_Mock\\resources\\bin\\language_server.exe" --server',
      CreationDate: '2026-11-18T12:00:01.0000000Z',
    },
    {
      ProcessId: 101,
      ParentProcessId: 100,
      ExecutablePath: 'C:\\Windows\\System32\\cmd.exe',
      CommandLine: 'C:\\Windows\\System32\\cmd.exe /d /s /c "C:\\Antigravity_Mod_Mock\\UserData\\bin\\agy-node.cmd" sidecar',
      CreationDate: '2026-11-18T12:00:02.0000000Z',
    },
    {
      ProcessId: 102,
      ParentProcessId: 101,
      ExecutablePath: 'C:\\Antigravity_Mod_Mock\\Antigravity.exe',
      CommandLine: '"C:\\Antigravity_Mod_Mock\\Antigravity.exe" "C:\\Antigravity_Mod_Mock\\resources\\app\\main.mjs"',
      CreationDate: '2026-11-18T12:00:03.0000000Z',
    },
    {
      ProcessId: 103,
      ParentProcessId: 101,
      ExecutablePath: 'C:\\Windows\\System32\\conhost.exe',
      CommandLine: '\\??\\C:\\Windows\\system32\\conhost.exe 0x4',
      CreationDate: '2026-11-18T12:00:03.0000000Z',
    },
    {
      ProcessId: 200,
      ParentProcessId: 100,
      ExecutablePath: 'D:\\Official_Antigravity_Mock\\Antigravity.exe',
      CommandLine: '"D:\\Official_Antigravity_Mock\\Antigravity.exe" "D:\\Official_Antigravity_Mock\\resources\\app\\main.mjs"',
      CreationDate: '2026-11-18T12:00:02.0000000Z',
    },
    {
      ProcessId: 300,
      ParentProcessId: 9999,
      ExecutablePath: 'C:\\Windows\\System32\\cmd.exe',
      CommandLine: 'C:\\Windows\\System32\\cmd.exe /c "C:\\Antigravity_Mod_Mock\\UserData\\bin\\agy-node.cmd" orphan',
      CreationDate: '2026-11-18T11:00:00.0000000Z',
    },
    {
      ProcessId: 301,
      ParentProcessId: 300,
      ExecutablePath: 'C:\\Antigravity_Mod_Mock\\Antigravity.exe',
      CommandLine: '"C:\\Antigravity_Mod_Mock\\Antigravity.exe" "C:\\Antigravity_Mod_Mock\\resources\\app\\main.mjs"',
      CreationDate: '2026-11-18T11:00:01.0000000Z',
    },
  ];
}

function createHarness(opts) {
  opts = opts || {};
  let procs = makeBaseTree();
  const killCalls = [];
  const logs = [];
  let listCount = 0;

  const listProcesses = async () => {
    listCount += 1;
    if (opts.onList) procs = opts.onList(listCount, procs);
    return procs.map((p) => ({ ...p }));
  };

  const killPid = async (pid, force) => {
    const rec = { pid: Number(pid), force: !!force };
    killCalls.push(rec);
    allKillCalls.push(rec);
    const shouldExit = opts.obedient ? true : !!force;
    if (shouldExit) {
      procs = procs.filter((p) => Number(p.ProcessId) !== Number(pid));
      return { ok: true, out: 'SUCCESS' };
    }
    return { ok: true, out: 'IGNORED_GRACEFUL' };
  };

  const reaper = createSidecarReaper({
    root: opts.root !== undefined ? opts.root : MOCK_ROOT,
    listProcesses,
    killPid,
    log: (...a) => logs.push(a.join(' ')),
    sleep: () => new Promise((r) => setTimeout(r, 5)),
    graceMs: opts.graceMs !== undefined ? opts.graceMs : 40,
    pollMs: opts.pollMs !== undefined ? opts.pollMs : 10,
    sessionStart: SESSION_START,
  });

  return {
    reaper,
    killCalls,
    logs,
    getProcs: () => procs,
    setProcs: (next) => { procs = next; },
    removePid: (pid) => { procs = procs.filter((p) => Number(p.ProcessId) !== Number(pid)); },
  };
}

function eqArr(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function sortedPids(arr) {
  return arr.slice().sort((a, b) => a - b);
}

async function runTests() {
  // RU1: root on C: => enabled; root on D: => disabled, reap/snapshot/detectHistorical never call killPid
  {
    const hC = createHarness({ root: MOCK_ROOT });
    const hD = createHarness({ root: 'D:\\Official_Antigravity_Mock' });
    await hD.reaper.onLsSpawn(100);
    const snapD = await hD.reaper.snapshot(100);
    hD.removePid(100);
    const reapD = await hD.reaper.reap();
    const histD = await hD.reaper.detectHistorical();
    const ok =
      hC.reaper.enabled === true &&
      hD.reaper.enabled === false &&
      snapD.length === 0 &&
      reapD.recorded === 0 &&
      reapD.killed.length === 0 &&
      histD.length === 0 &&
      hD.killCalls.length === 0;
    L.check('RU1', 'C: root enabled; D: root disabled and never calls killPid', ok, {
      cEnabled: hC.reaper.enabled,
      dEnabled: hD.reaper.enabled,
      dKills: hD.killCalls.length,
    });
  }

  // RU2: snapshot(100) records exactly 101 and 102
  {
    const h = createHarness();
    await h.reaper.onLsSpawn(100);
    const snap = await h.reaper.snapshot(100);
    const snapPids = sortedPids(snap.map((x) => x.pid));
    const regPids = sortedPids([...h.reaper._registry.keys()]);
    L.check(
      'RU2',
      'snapshot(100) records exactly 101 and 102 (excludes 100, 103 conhost, 200 D:, 300/301)',
      eqArr(snapPids, [101, 102]) && eqArr(regPids, [101, 102]),
      { snapPids, regPids }
    );
  }

  // RU3: obedient sidecars exit on graceful killPid(..., false), no force kill issued
  {
    const h = createHarness({ obedient: true });
    await h.reaper.onLsSpawn(100);
    await h.reaper.snapshot(100);
    h.removePid(100);
    const res = await h.reaper.reap();
    const gracefulPids = sortedPids(res.exitedGracefully);
    const noForce = h.killCalls.length === 2 && h.killCalls.every((c) => c.force === false);
    L.check(
      'RU3',
      'obedient sidecars: exitedGracefully=[101,102], killed empty, no force kill issued',
      eqArr(gracefulPids, [101, 102]) && res.killed.length === 0 && res.skipped.length === 0 && noForce,
      { res, killCalls: h.killCalls }
    );
  }

  // RU4: stubborn sidecars ignore graceful => force-killed 101 and 102 only, single-PID, no /T
  {
    const h = createHarness({ obedient: false });
    await h.reaper.onLsSpawn(100);
    await h.reaper.snapshot(100);
    h.removePid(100);
    const res = await h.reaper.reap();
    const killedPids = sortedPids(res.killed);
    const forceCalls = h.killCalls.filter((c) => c.force === true);
    const forcePids = sortedPids(forceCalls.map((c) => c.pid));
    const argsOk =
      eqArr(h.reaper.killArgs(101, true), ['/PID', '101', '/F']) &&
      eqArr(h.reaper.killArgs(102, true), ['/PID', '102', '/F']) &&
      !h.reaper.killArgs(101, true).some((a) => /\/t/i.test(a)) &&
      !h.reaper.killArgs(102, false).some((a) => /\/t/i.test(a));
    L.check(
      'RU4',
      'stubborn sidecars: force-kills 101 and 102 only, single-PID killArgs without /T',
      eqArr(killedPids, [101, 102]) &&
        eqArr(forcePids, [101, 102]) &&
        forceCalls.length === 2 &&
        res.exitedGracefully.length === 0 &&
        argsOk,
      { res, forceCalls }
    );
  }

  function runMutationSkipTest(id, desc, mutate102) {
    const h = createHarness({
      obedient: false,
      graceMs: 40,
      onList: (count, procs) => {
        if (count >= 3) {
          return procs.map((p) => (p.ProcessId === 102 ? mutate102(p) : p));
        }
        return procs;
      },
    });
    return (async () => {
      await h.reaper.onLsSpawn(100);
      await h.reaper.snapshot(100);
      h.removePid(100);
      const res = await h.reaper.reap();
      const skippedPids = res.skipped.map((s) => s.pid);
      const force102 = h.killCalls.some((c) => c.pid === 102 && c.force === true);
      L.check(
        id,
        desc,
        skippedPids.includes(102) && !res.killed.includes(102) && !force102 && eqArr(res.killed, [101]),
        { res, killCalls: h.killCalls }
      );
    })();
  }

  // RU5: PID reuse (different CreationDate) => not killed, reported in skipped
  await runMutationSkipTest('RU5', 'PID reuse (CreationDate changed) => pid 102 skipped, not force-killed', (p) => ({
    ...p,
    CreationDate: '2026-11-18T12:05:00.0000000Z',
  }));

  // RU6: exe path changed for recorded pid => skipped
  await runMutationSkipTest('RU6', 'exe path changed for recorded pid 102 => skipped, not force-killed', (p) => ({
    ...p,
    ExecutablePath: 'C:\\Antigravity_Mod_Mock\\other_binary.exe',
  }));

  // RU7: command line changed for recorded pid => skipped
  await runMutationSkipTest('RU7', 'command line changed for recorded pid 102 => skipped, not force-killed', (p) => ({
    ...p,
    CommandLine: '"C:\\Antigravity_Mod_Mock\\Antigravity.exe" --mutated-cmd',
  }));

  // RU8: detectHistorical() returns 300 and 301 and killPid is never called for them
  {
    const h = createHarness({ obedient: false });
    await h.reaper.onLsSpawn(100);
    await h.reaper.snapshot(100);
    const histBefore = sortedPids((await h.reaper.detectHistorical()).map((x) => x.pid));
    h.removePid(100);
    await h.reaper.reap();
    const histAfter = sortedPids((await h.reaper.detectHistorical()).map((x) => x.pid));
    const touchedHist = h.killCalls.some((c) => c.pid === 300 || c.pid === 301);
    L.check(
      'RU8',
      'detectHistorical returns [300, 301] and killPid is never called for them (before or after reap)',
      eqArr(histBefore, [300, 301]) && eqArr(histAfter, [300, 301]) && !touchedHist,
      { histBefore, histAfter, killCalls: h.killCalls }
    );
  }

  // RU9: D: process 200 is never passed to killPid in any test
  {
    const touched200 = allKillCalls.some((c) => c.pid === 200);
    L.check(
      'RU9',
      'D: process 200 is never passed to killPid in any test',
      allKillCalls.length > 0 && !touched200,
      { totalKillCalls: allKillCalls.length, touched200 }
    );
  }

  // RU10: descendantsOf ignores a child whose CreationDate is older than its parent
  {
    const h = createHarness();
    const procs = [
      {
        ProcessId: 100,
        ParentProcessId: 50,
        ExecutablePath: 'C:\\Antigravity_Mod_Mock\\resources\\bin\\language_server.exe',
        CommandLine: 'language_server.exe',
        CreationDate: '2026-11-18T12:00:10.0000000Z',
      },
      {
        ProcessId: 101,
        ParentProcessId: 100,
        ExecutablePath: 'C:\\Windows\\System32\\cmd.exe',
        CommandLine: 'cmd.exe /c C:\\Antigravity_Mod_Mock\\UserData\\bin\\agy-node.cmd',
        CreationDate: '2026-11-18T12:00:11.0000000Z',
      },
      {
        ProcessId: 104,
        ParentProcessId: 100,
        ExecutablePath: 'C:\\Antigravity_Mod_Mock\\Antigravity.exe',
        CommandLine: 'Antigravity.exe main.mjs',
        CreationDate: '2026-11-18T11:59:00.0000000Z',
      },
      {
        ProcessId: 105,
        ParentProcessId: 104,
        ExecutablePath: 'C:\\Antigravity_Mod_Mock\\Antigravity.exe',
        CommandLine: 'Antigravity.exe main.mjs',
        CreationDate: '2026-11-18T12:00:12.0000000Z',
      },
    ];
    const descPids = sortedPids(h.reaper.descendantsOf(100, procs).map((p) => Number(p.ProcessId)));
    L.check(
      'RU10',
      'descendantsOf ignores child whose CreationDate is older than parent (PID-reuse guard)',
      eqArr(descPids, [101]),
      { descPids }
    );
  }

  // RU11: PID reuse during phase 2 is caught by per-kill fresh check
  {
    let mutated = false; const killCalls = [];
    let procs = makeBaseTree();
    const r = createSidecarReaper({ root: MOCK_ROOT, sessionStart: SESSION_START, graceMs: 30, pollMs: 10, sleep: () => new Promise((x) => setTimeout(x, 2)), log: () => {},
      listProcesses: async () => procs.map((p) => ({ ...p })),
      killPid: async (pid, force) => { killCalls.push({ pid, force }); allKillCalls.push({ pid, force });
        if (force) { procs = procs.filter((p) => p.ProcessId !== pid); if (pid === 101 && !mutated) { mutated = true; procs = procs.map((p) => (p.ProcessId === 102 ? { ...p, CreationDate: '2026-11-18T12:09:00.0000000Z', CommandLine: 'unrelated.exe' } : p)); } }
        return { ok: true }; } });
    await r.onLsSpawn(100); await r.snapshot(100); procs = procs.filter((p) => p.ProcessId !== 100);
    const res = await r.reap();
    L.check('RU11', 'PID reused between two forced kills => second target skipped (fresh check before every kill)', res.killed.join() === '101' && res.skipped.some((s) => s.pid === 102) && !killCalls.some((c) => c.pid === 102 && c.force), { res, killCalls });
  }
  // RU12: .NET 7-digit vs JS 3-digit timestamps compare correctly inside the same millisecond
  {
    const r = createSidecarReaper({ root: MOCK_ROOT, listProcesses: async () => [] });
    const a = r._iso7('2026-11-18T12:00:00.5009999Z'), b = r._iso7('2026-11-18T12:00:00.500Z');
    L.check('RU12', 'iso7 normalisation: 12:00:00.5009999Z >= 12:00:00.500Z', a >= b && b === '2026-11-18T12:00:00.5000000Z', { a, b });
  }
  // RU13: WQL LIKE escaping of \ ' [ % _
  {
    const r = createSidecarReaper({ root: MOCK_ROOT, listProcesses: async () => [] });
    const e = r._wqlLike("C:\\A_B[x]%'y");
    L.check('RU13', 'WQL LIKE escaping: backslash, quote, [, %, _', e === "C:\\\\A[_]B[[]x]%".replace('%', '[%]') + "\\'y", e);
  }
  // RU14: killArgs refuses system / invalid PIDs
  {
    const r = createSidecarReaper({ root: MOCK_ROOT, listProcesses: async () => [] });
    const bad = [0, 4, -1, NaN, 1.5, 'x'].filter((p) => { try { r.killArgs(p, true); return true; } catch (_) { return false; } });
    L.check('RU14', 'killArgs throws for pid 0/4/-1/NaN/1.5/"x"', bad.length === 0, bad);
  }
  // RU15: children without CreationDate are never recorded
  {
    let procs = makeBaseTree().map((p) => (p.ProcessId === 102 ? { ...p, CreationDate: '' } : p));
    const r = createSidecarReaper({ root: MOCK_ROOT, sessionStart: SESSION_START, log: () => {}, listProcesses: async () => procs, killPid: async () => ({ ok: true }) });
    await r.onLsSpawn(100); const snap = await r.snapshot(100);
    L.check('RU15', 'process with empty CreationDate is not recorded', snap.map((x) => x.pid).join() === '101', snap.map((x) => x.pid));
  }
  // RU16: LS pid already reused before snapshot => nothing recorded
  {
    let procs = makeBaseTree();
    const r = createSidecarReaper({ root: MOCK_ROOT, sessionStart: SESSION_START, log: () => {}, listProcesses: async () => procs, killPid: async () => ({ ok: true }) });
    await r.onLsSpawn(100); procs = procs.map((p) => (p.ProcessId === 100 ? { ...p, CreationDate: '2026-11-18T12:30:00.0000000Z' } : p));
    const snap = await r.snapshot(100);
    L.check('RU16', 'LS pid reused before snapshot => snapshot records nothing', snap.length === 0 && r._registry.size === 0, snap);
  }
  L.done();
}

runTests().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
