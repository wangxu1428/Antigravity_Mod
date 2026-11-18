// =============================================================================
// AGM_SIDECAR_REAPER core (injected verbatim into dist/languageServer.js by patch.js)
// Rules: only processes under a C:\ mod root; record identity (pid + creation
// time + exe path + command line); graceful first, force after timeout; re-verify
// identity with a FRESH listing right before EVERY kill; single-PID kills only
// (never /T); processes without a creation time are never recorded or killed;
// historical orphans are detected and logged only, never killed.
// rev2: fixes from independent review A01 (items 3,4,5,6,7.2/7.3,13.4).
// =============================================================================
function createSidecarReaper(deps) {
    deps = deps || {};
    const cp = deps.childProcess || require('child_process');
    const pathMod = require('path');
    const log = deps.log || ((...a) => console.log('[AGM][Reaper]', ...a));
    const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const graceMs = deps.graceMs != null ? deps.graceMs : 3000;
    const pollMs = deps.pollMs != null ? deps.pollMs : 250;
    const rawRoot = deps.root != null ? String(deps.root) : pathMod.dirname(process.execPath);
    const root = pathMod.win32.resolve(rawRoot).replace(/[\\/]+$/, '');
    const rootLc = root.toLowerCase() + '\\';
    const enabled = /^c:\\./i.test(root);
    const sessionStart = deps.sessionStart || new Date();
    const registry = new Map(); // pid -> identity
    let lsIdentity = null;
    let reaping = null;
    const norm = (s) => (s == null ? '' : String(s));
    const lc = (s) => norm(s).toLowerCase();
    const agyNodeLc = rootLc + 'userdata\\bin\\agy-node.cmd';
    const sysRoot = lc(process.env.SystemRoot || 'C:\\Windows');
    const cmdPaths = [sysRoot + '\\system32\\cmd.exe', sysRoot + '\\syswow64\\cmd.exe'];
    // ISO timestamps from .NET have 7 fractional digits, JS has 3: normalise to 7 before comparing.
    const iso7 = (s) => norm(s).replace(/\.(\d{1,7})Z$/, (_, f) => '.' + f.padEnd(7, '0') + 'Z').replace(/(:\d\d)Z$/, '$1.0000000Z');
    const startIso7 = iso7(sessionStart.toISOString());

    function inScope(p) {
        if (!p || !norm(p.CreationDate)) return false;      // no creation time => no identity proof
        const exe = lc(p.ExecutablePath);
        if (!exe || exe.startsWith('d:')) return false;      // never D drive
        if (exe.startsWith(rootLc)) return true;             // exe under C mod root
        if (cmdPaths.includes(exe) && lc(p.CommandLine).includes(agyNodeLc)) return true; // agy-node wrapper shell
        return false;
    }
    function isSidecarLike(p) {
        const c = lc(p.CommandLine);
        return c.includes('agy-node.cmd') || c.includes('main.mjs') || c.includes('sidecar');
    }
    function identity(p) {
        return { pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), created: norm(p.CreationDate), exe: norm(p.ExecutablePath), cmd: norm(p.CommandLine) };
    }
    function sameIdentity(a, p) {
        return !!p && !!a.created && Number(p.ProcessId) === a.pid && norm(p.CreationDate) === a.created && lc(p.ExecutablePath) === lc(a.exe) && norm(p.CommandLine) === a.cmd;
    }
    // WQL LIKE literal escaping (\ ' [ % _), then PowerShell single-quote escaping.
    const wqlLike = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_]');
    function defaultList() {
        return new Promise((resolve, reject) => {
            const w = wqlLike(root);
            const filter = "ExecutablePath LIKE '" + w + "\\\\%' OR CommandLine LIKE '%" + w + "%'";
            const ps = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
                "$r=@(Get-CimInstance Win32_Process -Filter '" + filter.replace(/'/g, "''") + "' | " +
                "ForEach-Object { [pscustomobject]@{ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;ExecutablePath=$_.ExecutablePath;CommandLine=$_.CommandLine;" +
                "CreationDate=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''})} });" +
                "ConvertTo-Json -InputObject $r -Compress -Depth 3";
            const enc = Buffer.from(ps, 'utf16le').toString('base64');
            cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
                { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
                    if (err) return reject(err);
                    try { const j = JSON.parse(String(stdout).trim() || '[]'); resolve(Array.isArray(j) ? j : [j]); } catch (e) { reject(e); }
                });
        });
    }
    const listProcesses = deps.listProcesses || defaultList;
    // Single-PID kill only. No /T anywhere. Refuses system / invalid PIDs.
    function killArgs(pid, force) {
        const n = Number(pid);
        if (!Number.isInteger(n) || n <= 4) throw new Error('refusing invalid pid ' + pid);
        const a = ['/PID', String(n)]; if (force) a.push('/F'); return a;
    }
    function defaultKill(pid, force) {
        return new Promise((resolve) => {
            let args; try { args = killArgs(pid, force); } catch (e) { return resolve({ ok: false, out: e.message }); }
            cp.execFile('taskkill.exe', args, { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
                resolve({ ok: !err, out: (String(stdout) + String(stderr)).trim() });
            });
        });
    }
    const killPid = deps.killPid || defaultKill;

    function descendantsOf(rootPid, procs, rootCreated) {
        const byParent = new Map();
        for (const p of procs) { const k = Number(p.ParentProcessId); if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(p); }
        const created = new Map(procs.map((p) => [Number(p.ProcessId), norm(p.CreationDate)]));
        if (rootCreated) created.set(Number(rootPid), rootCreated);
        const out = []; const seen = new Set([Number(rootPid)]); const q = [Number(rootPid)];
        while (q.length) {
            const cur = q.shift();
            const pc = created.get(cur);
            if (!pc) continue; // parent creation time unknown => cannot rule out PID reuse
            for (const ch of byParent.get(cur) || []) {
                const pid = Number(ch.ProcessId);
                if (seen.has(pid)) continue;
                const cc = norm(ch.CreationDate);
                if (!cc || iso7(cc) < iso7(pc)) continue; // a child cannot be older than its parent
                seen.add(pid); out.push(ch); q.push(pid);
            }
        }
        return out;
    }
    async function onLsSpawn(lsPid) {
        if (!enabled) { log(`disabled (mod root not on C:): ${root}`); return; }
        try {
            const procs = await listProcesses();
            const p = procs.find((x) => Number(x.ProcessId) === Number(lsPid));
            lsIdentity = p && norm(p.CreationDate) ? identity(p) : null;
            log(`session LS recorded pid=${lsPid} created=${lsIdentity ? lsIdentity.created : '(unknown)'}`);
        } catch (e) { log('onLsSpawn list failed: ' + (e && e.message)); }
    }
    // Record this session's in-scope descendants of the LS (call while LS is still alive).
    async function snapshot(lsPid) {
        if (!enabled) return [];
        const procs = await listProcesses();
        const live = procs.find((x) => Number(x.ProcessId) === Number(lsPid));
        let rootCreated = live ? norm(live.CreationDate) : '';
        if (lsIdentity && lsIdentity.pid === Number(lsPid)) {
            if (live && !sameIdentity(lsIdentity, live)) { log(`snapshot: pid ${lsPid} is no longer the recorded LS, skipped`); return []; }
            rootCreated = lsIdentity.created;
        }
        if (!rootCreated) { log(`snapshot: LS pid ${lsPid} creation time unknown, nothing recorded`); return []; }
        const desc = descendantsOf(lsPid, procs, rootCreated).filter(inScope).filter((d) => iso7(d.CreationDate) >= startIso7);
        for (const d of desc) {
            const id = identity(d);
            if (!registry.has(id.pid) || registry.get(id.pid).created !== id.created) {
                registry.set(id.pid, id);
                log(`recorded session child pid=${id.pid} created=${id.created} exe=${id.exe} cmd=${id.cmd}`);
            }
        }
        return desc.map(identity);
    }
    async function verifyFresh(t) {
        const procs = await listProcesses();
        const cur = procs.find((p) => Number(p.ProcessId) === t.pid);
        if (!cur) return 'gone';
        return sameIdentity(t, cur) && inScope(cur) ? 'same' : 'mismatch';
    }
    async function doReap() {
        const result = { recorded: registry.size, exitedGracefully: [], killed: [], skipped: [], failed: [] };
        if (!enabled || registry.size === 0) { log(`reap: nothing recorded (enabled=${enabled})`); return result; }
        const targets = [...registry.values()];
        for (const t of targets) registry.delete(t.pid);
        const settle = (t, state) => {
            if (state === 'gone') result.exitedGracefully.push(t.pid);
            else { result.skipped.push({ pid: t.pid, reason: 'identity mismatch (pid reused or changed)' }); log(`SKIP pid=${t.pid}: identity mismatch, not killing`); }
        };
        // Phase 1: graceful request (taskkill without /F) after a fresh per-target identity check.
        let alive = [];
        for (const t of targets) {
            const st = await verifyFresh(t);
            if (st !== 'same') { settle(t, st); continue; }
            const r = await killPid(t.pid, false);
            log(`graceful close pid=${t.pid}: ${r && r.ok ? 'sent' : 'not accepted'}`);
            alive.push(t);
        }
        // Wait up to graceMs for them to go away.
        const deadline = Date.now() + graceMs;
        while (alive.length && Date.now() < deadline) {
            await sleep(pollMs);
            const procs = await listProcesses();
            const still = [];
            for (const t of alive) {
                const cur = procs.find((p) => Number(p.ProcessId) === t.pid);
                if (!cur) settle(t, 'gone');
                else if (!sameIdentity(t, cur) || !inScope(cur)) settle(t, 'mismatch');
                else still.push(t);
            }
            alive = still;
        }
        // Phase 2: forced single-PID kill, each preceded by its own fresh identity check.
        for (const t of alive) {
            const st = await verifyFresh(t);
            if (st !== 'same') { settle(t, st); continue; }
            const r = await killPid(t.pid, true);
            if (r && r.ok) { result.killed.push(t.pid); log(`forced single-PID kill pid=${t.pid} created=${t.created}`); }
            else { result.failed.push({ pid: t.pid, out: r && r.out }); log(`kill failed pid=${t.pid}: ${r && r.out}`); }
        }
        log(`sidecar reaped n=${result.killed.length} graceful=${result.exitedGracefully.length} skipped=${result.skipped.length} failed=${result.failed.length}`);
        return result;
    }
    // After LS exit. Serialised: concurrent callers share one run.
    function reap() {
        if (!reaping) reaping = doReap().finally(() => { reaping = null; });
        return reaping;
    }
    // Historical orphans: in-scope sidecar-like processes not from this session. Detect + log only.
    async function detectHistorical() {
        if (!enabled) return [];
        const procs = await listProcesses();
        const alivePids = new Set(procs.map((p) => Number(p.ProcessId)));
        const active = new Set();
        if (lsIdentity) for (const d of descendantsOf(lsIdentity.pid, procs, lsIdentity.created)) active.add(Number(d.ProcessId));
        const out = [];
        for (const p of procs) {
            if (!inScope(p) || !isSidecarLike(p)) continue;
            const pid = Number(p.ProcessId);
            if (registry.has(pid) || active.has(pid)) continue;
            if (iso7(p.CreationDate) >= startIso7) continue;
            out.push(identity(p));
        }
        for (const o of out) log(`historical sidecar orphan detected (NOT touched) pid=${o.pid} created=${o.created} parentAlive=${alivePids.has(o.ppid)}`);
        return out;
    }
    return { enabled, root, inScope, killArgs, descendantsOf, onLsSpawn, snapshot, reap, detectHistorical, _registry: registry, _iso7: iso7, _wqlLike: wqlLike };
}