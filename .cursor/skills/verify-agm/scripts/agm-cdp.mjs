#!/usr/bin/env node
// agm-cdp.mjs - drive the AGM test instance started by agm-lab.ps1 over CDP.
// Node >= 22 built-ins only (global fetch + WebSocket). Windows only.
//
//   node agm-cdp.mjs <command> --run <RunId> [options]
//
// commands
//   targets                                   list CDP targets (JSON)
//   eval     --expr <js>                      evaluate in the page, print the value
//   wait     --selector <css> [--gone] [--timeout ms]   wait until element is visible (or gone)
//   click    --selector <css>                 real mouse click at the element's center
//   type     --selector <css> --text <t>      click the field, select all, insert text
//   key      --key <F5|Escape|Enter|A..Z> [--mods ctrl,shift,alt]   real key press
//   text     --selector <css> [--out <file>]  innerText of the element (proof snapshot)
//   shot     --out <file.png>                 screenshot of the page
//
// Safety: the port and PID come from C:\AGM_TestLab\VERIFY_<RunId>\state. The
// script refuses to talk to a port whose listener is not that PID (so it can
// never attach to the production IDE on 9223), and refuses --out paths outside
// <RunDir>\proof.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LAB = 'C:\\AGM_TestLab';
const PROD_PORT = 9223;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function die(msg, code = 2) { console.error('[agm-cdp] ' + msg); process.exit(code); }

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || !args.run || !/^[A-Za-z0-9_-]{1,40}$/.test(String(args.run))) {
  die('usage: node agm-cdp.mjs <targets|eval|wait|click|type|key|text|shot> --run <RunId> [...]');
}
const runDir = path.join(LAB, 'VERIFY_' + args.run);
const proofDir = path.join(runDir, 'proof');
const readState = (n) => { try { return fs.readFileSync(path.join(runDir, 'state', n), 'utf8').trim(); } catch { return null; } };
const port = Number(readState('port.txt'));
const pid = Number(readState('pid.txt'));
if (!port || !pid) die('no live instance recorded for this run (state\\port.txt / pid.txt); run agm-lab.ps1 -Action launch');
if (port === PROD_PORT) die('refusing production CDP port 9223');

function listenerPids(p) {
  const ps = `@(Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }) -join ','`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return out ? out.split(',').map(Number) : [];
}
if (!listenerPids(port).includes(pid)) die(`port ${port} is not owned by this run's PID ${pid}; refusing`);

function safeOut(p) {
  const full = path.resolve(p.includes(':') || p.startsWith('\\') ? p : path.join(proofDir, p));
  if (!full.toLowerCase().startsWith(proofDir.toLowerCase() + '\\')) die('--out must be under ' + proofDir);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

async function pickTarget() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  // the workbench is served from https://127.0.0.1:<dynamic>/ ; data: pages are splash/blank windows
  const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && /^https?:\/\/127\.0\.0\.1:/.test(String(t.url)));
  const want = args.target ? pages.filter(t => String(t.url).includes(args.target) || String(t.title).includes(args.target)) : pages;
  if (!want.length) die('no page target' + (args.target ? ' matching ' + args.target : ''));
  // prefer the workbench page that hosts the AGM sidebar entry
  for (const t of want) {
    const c = await connect(t.webSocketDebuggerUrl);
    const r = await c.send('Runtime.evaluate', { expression: "!!document.getElementById('agm-nav-hub') || !!document.getElementById('hakimi-i18n-trigger')", returnByValue: true });
    if (r.result && r.result.value === true) return c;
    c.close();
  }
  return connect(want[0].webSocketDebuggerUrl);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    ws.onerror = () => reject(new Error('CDP websocket error ' + url));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        const t = setTimeout(() => { pending.delete(i); rej(new Error('CDP timeout: ' + method)); }, 20000);
        pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

const sel = () => { if (!args.selector) die('--selector required'); return JSON.stringify(String(args.selector)); };
const rectExpr = (s) => `(() => { const e = document.querySelector(${s}); if (!e) return null; e.scrollIntoView({block:'center', inline:'center'}); const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' }; })()`;

async function waitFor(c, s, gone, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await evaluate(c, rectExpr(s));
    const vis = !!(r && r.visible);
    if (gone ? !vis : vis) return r;
    await new Promise(z => setTimeout(z, 250));
  }
  return null;
}

async function click(c, s) {
  const r = await waitFor(c, s, false, Number(args.timeout || 10000));
  if (!r) die('not visible: ' + args.selector, 1);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  return r;
}

const VK = { F5: 116, Escape: 27, Enter: 13, Tab: 9, Backspace: 8 };
async function key(c, k, mods) {
  const m = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const modifiers = String(mods || '').split(',').filter(Boolean).reduce((a, x) => a | (m[x.trim().toLowerCase()] || 0), 0);
  const code = VK[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  if (!code) die('unknown key ' + k);
  const keyName = k.length === 1 ? (modifiers & 8 ? k.toUpperCase() : k.toLowerCase()) : k;
  const codeName = k.length === 1 ? 'Key' + k.toUpperCase() : k;
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, windowsVirtualKeyCode: code, key: keyName, code: codeName });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, windowsVirtualKeyCode: code, key: keyName, code: codeName });
}

const c = cmd === 'targets' ? null : await pickTarget();
try {
  switch (cmd) {
    case 'targets': {
      console.log(JSON.stringify(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), null, 2));
      break;
    }
    case 'eval': {
      if (!args.expr) die('--expr required');
      const v = await evaluate(c, String(args.expr));
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
      break;
    }
    case 'wait': {
      const r = await waitFor(c, sel(), !!args.gone, Number(args.timeout || 15000));
      if (!r && !args.gone) die('timeout waiting for ' + args.selector, 1);
      if (args.gone && r === null) die('timeout waiting for ' + args.selector + ' to go', 1);
      console.log('ok ' + args.selector + (args.gone ? ' gone' : ' visible'));
      break;
    }
    case 'click': {
      const r = await click(c, sel());
      console.log(`clicked ${args.selector} at ${Math.round(r.x)},${Math.round(r.y)}`);
      break;
    }
    case 'type': {
      if (args.text === undefined) die('--text required');
      await click(c, sel());
      await key(c, 'A', 'ctrl');
      await c.send('Input.insertText', { text: String(args.text) });
      console.log(`typed into ${args.selector}`);
      break;
    }
    case 'key': {
      if (!args.key) die('--key required');
      await key(c, String(args.key), args.mods);
      console.log('pressed ' + (args.mods ? args.mods + '+' : '') + args.key);
      break;
    }
    case 'text': {
      const t = await evaluate(c, `(() => { const e = document.querySelector(${sel()}); return e ? e.innerText : null; })()`);
      if (t === null) die('not found: ' + args.selector, 1);
      if (args.out) { const f = safeOut(String(args.out)); fs.writeFileSync(f, `selector: ${args.selector}\ntime: ${new Date().toISOString()}\n---\n${t}\n`); console.log('wrote ' + f); }
      else console.log(t);
      break;
    }
    case 'shot': {
      if (!args.out) die('--out required');
      const f = safeOut(String(args.out));
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('wrote ' + f);
      break;
    }
    default: die('unknown command ' + cmd);
  }
} finally { if (c) c.close(); }
