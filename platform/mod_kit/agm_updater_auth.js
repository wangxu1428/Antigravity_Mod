// =============================================================================
// AGM Updater IPC Authorization Adapter (platform/mod_kit/agm_updater_auth.js)
//
// Implements Scheme B (D1-D5):
//   D1: Dedicated updater adapter reusing the single process-wide __agmIpcGate.
//   D2: Strict main-frame allow-list (same-origin loopback reload re-verified in agm_ipc_auth.js).
//   D3: Capability separation (read vs check-and-download vs apply vs install-and-restart).
//   D4: Safe broadcastState target filtering (never leak updater:state-changed to SSH).
//   D5: Fixed execution order:
//         Auth -> localOnly -> app.isPackaged -> AGM_UPDATE_LOCK -> Business Logic
//
// Also provides build-time static scanning (scanUpdaterChannels) to fail closed
// (exit 2) if any unknown or unprotected updater:* channel exists in dist/ or plugins/.
// =============================================================================
'use strict';

// --- AGM_UPDATER_AUTH_RUNTIME_START ---
const MARKER = 'AGM_UPDATER_AUTH_V1';
const GATE_SYMBOL = Symbol.for('agm.ipc.sharedGate.v1');
const DENY_MESSAGE = 'unauthorized';

const UPDATER_CAPABILITIES = Object.freeze({
    READ: 'updater:read',
    CHECK_AND_DOWNLOAD: 'updater:check-and-download',
    APPLY: 'updater:apply',
    INSTALL_AND_RESTART: 'updater:install-and-restart',
});

const UPDATER_CHANNEL_POLICIES = Object.freeze({
    'updater:get-state': Object.freeze({
        capability: UPDATER_CAPABILITIES.READ,
        mutating: false,
        triggersDownload: false,
        requiresPackaged: false,
        description: 'Read-only cached updater state and version query',
    }),
    'updater:check-for-updates': Object.freeze({
        capability: UPDATER_CAPABILITIES.CHECK_AND_DOWNLOAD,
        mutating: true,
        triggersDownload: true,
        requiresPackaged: false,
        description: 'Manual update check with implicit autoDownload and native dialog',
    }),
    'updater:apply': Object.freeze({
        capability: UPDATER_CAPABILITIES.APPLY,
        mutating: true,
        triggersDownload: false,
        requiresPackaged: false,
        description: 'Mutate cached updater state to Ready and broadcast to trusted local windows',
    }),
    'updater:quit-and-install': Object.freeze({
        capability: UPDATER_CAPABILITIES.INSTALL_AND_RESTART,
        mutating: true,
        triggersDownload: false,
        requiresPackaged: true,
        description: 'Quit app and execute downloaded installer (highest privilege)',
    }),
});

const UPDATER_OUTBOUND_CHANNELS = Object.freeze(['updater:state-changed']);

// Tracked separately (not Electron renderer IPC): IPC auth does NOT claim to protect these.
const NON_IPC_UPDATER_ENTRY_POINTS = Object.freeze([
    { id: 'hostBridgeServer', source: 'dist/hostBridgeServer.js', mechanism: 'Loopback HTTP + 32-byte Bearer token', ipcAuthProtected: false },
    { id: 'macOSMenu', source: 'dist/menu.js', mechanism: 'Native macOS MenuItem.click', ipcAuthProtected: false },
    { id: 'startupAndPeriodicTimer', source: 'dist/updater.js', mechanism: 'initAutoUpdater timer + settings listener', ipcAuthProtected: false },
    { id: 'headlessAutoInstall', source: 'dist/updater.js', mechanism: 'update-downloaded headlessQuitAndInstall', ipcAuthProtected: false },
    { id: 'beforeQuitForUpdate2330', source: 'dist/main.js', mechanism: 'electron.app/autoUpdater before-quit-for-update SSH freeze', ipcAuthProtected: false },
]);

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function defaultCapabilities() {
    return {
        [UPDATER_CAPABILITIES.READ]: true,
        [UPDATER_CAPABILITIES.CHECK_AND_DOWNLOAD]: true,
        [UPDATER_CAPABILITIES.APPLY]: true,
        [UPDATER_CAPABILITIES.INSTALL_AND_RESTART]: true,
    };
}

function createSharedGateSlot(carrier, key) {
    const host = carrier || {};
    const sym = key || GATE_SYMBOL;
    return {
        bind: function (gate) {
            if (!gate || typeof gate.authorize !== 'function' || typeof gate.isRegistered !== 'function') {
                throw new Error('AGM invalid IPC gate instance');
            }
            if (sym in host) {
                if (host[sym] === gate) return gate;
                throw new Error('AGM duplicate IPC gate binding refused');
            }
            Object.defineProperty(host, sym, {
                value: gate,
                writable: false,
                configurable: false,
                enumerable: false,
            });
            return gate;
        },
        get: function () {
            return (sym in host) ? host[sym] : null;
        },
    };
}

const DEFAULT_GATE_SLOT = createSharedGateSlot(globalThis, GATE_SYMBOL);

function bindSharedGate(gate) {
    return DEFAULT_GATE_SLOT.bind(gate);
}

function getSharedGate() {
    return DEFAULT_GATE_SLOT.get();
}

function isWebviewLike(wc) {
    if (!wc || typeof wc !== 'object') return false;
    try {
        if (typeof wc.getType === 'function' && wc.getType() === 'webview') return true;
    } catch (_) {
        return true;
    }
    try {
        if (wc.hostWebContents !== undefined && wc.hostWebContents !== null) return true;
    } catch (_) {
        return true;
    }
    return false;
}

function makeError(msg, code) {
    const err = new Error(msg);
    err.code = code;
    return err;
}

function createUpdaterAuthAdapter(options) {
    const opts = options || {};
    const logger = typeof opts.logger === 'function' ? opts.logger : function () {};

    function resolveGate() {
        try {
            if (typeof opts.getGate === 'function') return opts.getGate();
            if (opts.gate) return opts.gate;
            return getSharedGate();
        } catch (_) {
            return null;
        }
    }

    function resolveCapabilities() {
        let raw = null;
        try {
            raw = typeof opts.getCapabilities === 'function' ? opts.getCapabilities() : opts.capabilities;
        } catch (_) {
            return {};
        }
        if (!raw || typeof raw !== 'object') return defaultCapabilities();
        return raw;
    }

    function checkAuthorizedAndValid(event, channel, extraArgs) {
        if (typeof channel !== 'string' || !hasOwn(UPDATER_CHANNEL_POLICIES, channel)) {
            logger(String(channel || 'updater:unknown'), 'unknown-updater-channel');
            throw makeError(DENY_MESSAGE, 'AGM_IPC_UNAUTHORIZED');
        }
        const gate = resolveGate();
        if (!gate || typeof gate.authorize !== 'function') {
            logger(channel, 'missing-auth-gate');
            throw makeError(DENY_MESSAGE, 'AGM_IPC_UNAUTHORIZED');
        }
        const authRes = gate.authorize(event, channel);
        if (!authRes || authRes.ok !== true) {
            throw makeError(DENY_MESSAGE, 'AGM_IPC_UNAUTHORIZED');
        }
        const policy = UPDATER_CHANNEL_POLICIES[channel];
        const caps = resolveCapabilities();
        if (caps[policy.capability] !== true) {
            logger(channel, 'capability-denied:' + policy.capability);
            throw makeError(DENY_MESSAGE, 'AGM_IPC_UNAUTHORIZED');
        }
        // None of the 4 official updater IPC channels accept renderer arguments.
        if (extraArgs && extraArgs.length > 0) {
            for (let i = 0; i < extraArgs.length; i++) {
                if (extraArgs[i] !== undefined) {
                    logger(channel, 'invalid-arguments');
                    throw makeError('invalid-arguments', 'AGM_UPDATER_INVALID_ARGS');
                }
            }
        }
        return policy;
    }

    function wrapUpdaterHandler(channel, handler) {
        if (typeof handler !== 'function') {
            throw new Error('invalid updater handler for ' + String(channel));
        }
        if (handler.__agmUpdaterAuthWrapped === true) {
            return handler;
        }
        const wrapped = function (event) {
            const extraArgs = arguments.length > 1 ? Array.prototype.slice.call(arguments, 1) : [];

            // Step 1 (D5): Auth (whitelist + single shared gate + capability + args)
            const policy = checkAuthorizedAndValid(event, channel, extraArgs);

            // Step 2 (D5): localOnly defense-in-depth (preserve SSH denylist)
            if (typeof opts.isRemoteContents === 'function') {
                let isRemote = true;
                try {
                    isRemote = opts.isRemoteContents(event ? event.sender : undefined);
                } catch (_) {
                    isRemote = true;
                }
                if (isRemote !== false) {
                    logger(channel, 'remote-contents');
                    throw new Error(channel + ' is not available in SSH windows');
                }
            }

            // Step 3 (D5): app.isPackaged guard (for quit-and-install)
            if (policy.requiresPackaged === true && opts.app) {
                let packaged = false;
                try { packaged = opts.app.isPackaged === true; } catch (_) { packaged = false; }
                if (!packaged) {
                    if (typeof opts.onSkipUnpackaged === 'function') {
                        try { opts.onSkipUnpackaged(channel); } catch (_) {}
                    } else if (typeof console !== 'undefined' && console.log) {
                        console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');
                    }
                    return undefined;
                }
            }

            // Step 4 & 5 (D5): AGM_UPDATE_LOCK (inside handler) -> Business Logic
            return handler.call(this, event);
        };
        try {
            Object.defineProperty(wrapped, '__agmUpdaterAuthWrapped', { value: true, enumerable: false });
            Object.defineProperty(wrapped, '__agmUpdaterChannel', { value: channel, enumerable: false });
        } catch (_) {
            wrapped.__agmUpdaterAuthWrapped = true;
            wrapped.__agmUpdaterChannel = channel;
        }
        return wrapped;
    }

    function authorizeUnknownChannel(channel, event) {
        const extraArgs = arguments.length > 2 ? Array.prototype.slice.call(arguments, 2) : [];
        return checkAuthorizedAndValid(event, channel, extraArgs);
    }

    return {
        MARKER: MARKER,
        wrapUpdaterHandler: wrapUpdaterHandler,
        authorizeUnknownChannel: authorizeUnknownChannel,
        resolveGate: resolveGate,
    };
}

function canReceiveUpdaterBroadcast(win, hubContents, deps) {
    try {
        if (!win || typeof win !== 'object') return false;
        if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
        if (!hubContents || typeof hubContents !== 'object') return false;
        if (typeof hubContents.isDestroyed === 'function' && hubContents.isDestroyed()) return false;
        if (isWebviewLike(hubContents)) return false;

        const d = deps || {};
        const wb = d.windowBackends;
        if (wb && typeof wb === 'object') {
            if (typeof wb.isLocalAppWindow === 'function' && wb.isLocalAppWindow(win) !== true) return false;
            if (typeof wb.remoteBackendOf === 'function') {
                const rb = wb.remoteBackendOf(hubContents);
                if (rb !== undefined && rb !== null) return false;
            }
            if (typeof wb.remoteBackendOfWindow === 'function') {
                const rbw = wb.remoteBackendOfWindow(win);
                if (rbw !== undefined && rbw !== null) return false;
            }
        }
        const rws = d.remoteWindowSecurity;
        if (rws && typeof rws === 'object') {
            if (typeof rws.isRemoteContents === 'function' && rws.isRemoteContents(hubContents) !== false) return false;
            if (typeof rws.isRemoteSession === 'function' && hubContents.session != null && rws.isRemoteSession(hubContents.session) !== false) {
                return false;
            }
        }

        const gate = typeof d.getGate === 'function' ? d.getGate() : (d.gate || getSharedGate());
        if (!gate || typeof gate.isRegistered !== 'function') return false;
        if (gate.isRegistered(hubContents) !== true) return false;

        let curUrl = '';
        try {
            if (hubContents.mainFrame && typeof hubContents.mainFrame.url === 'string') curUrl = hubContents.mainFrame.url;
            else if (typeof hubContents.getURL === 'function') curUrl = hubContents.getURL();
        } catch (_) {
            return false;
        }
        if (typeof curUrl === 'string' && /^https?:\/\//i.test(curUrl)) {
            const hm = /^https?:\/\/([^/?#]+)/i.exec(curUrl);
            const auth = hm ? hm[1].toLowerCase() : '';
            if (!auth || auth.indexOf('@') >= 0) return false;
            const host = auth.startsWith('[')
                ? (auth.indexOf(']') >= 0 ? auth.slice(0, auth.indexOf(']') + 1) : '')
                : auth.split(':')[0];
            if (!(host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1')) {
                return false;
            }
        }
        return true;
    } catch (_) {
        return false;
    }
}

// --- AGM_UPDATER_AUTH_RUNTIME_END ---

function getRuntimeSource() {
    if (typeof __filename === 'string') {
        const fs = require('fs');
        const full = fs.readFileSync(__filename, 'utf8');
        return extractRuntimeSource(full);
    }
    return '';
}

function extractRuntimeSource(fullSrc) {
    const startTag = '// --- AGM_UPDATER_AUTH_RUNTIME_START ---';
    const endTag = '// --- AGM_UPDATER_AUTH_RUNTIME_END ---';
    const s = fullSrc.indexOf(startTag);
    const e = fullSrc.indexOf(endTag);
    if (s < 0 || e < 0 || e <= s) {
        throw new Error('AGM updater auth runtime boundaries missing');
    }
    const core = fullSrc.slice(s, e + endTag.length);
    return [
        "'use strict';",
        core,
        "const api = {",
        "    MARKER: MARKER,",
        "    GATE_SYMBOL: GATE_SYMBOL,",
        "    DENY_MESSAGE: DENY_MESSAGE,",
        "    UPDATER_CAPABILITIES: UPDATER_CAPABILITIES,",
        "    UPDATER_CHANNEL_POLICIES: UPDATER_CHANNEL_POLICIES,",
        "    UPDATER_OUTBOUND_CHANNELS: UPDATER_OUTBOUND_CHANNELS,",
        "    NON_IPC_UPDATER_ENTRY_POINTS: NON_IPC_UPDATER_ENTRY_POINTS,",
        "    createSharedGateSlot: createSharedGateSlot,",
        "    bindSharedGate: bindSharedGate,",
        "    getSharedGate: getSharedGate,",
        "    createUpdaterAuthAdapter: createUpdaterAuthAdapter,",
        "    canReceiveUpdaterBroadcast: canReceiveUpdaterBroadcast,",
        "};",
        "if (typeof module !== 'undefined' && module.exports) { module.exports = api; }",
    ].join('\n');
}

// -----------------------------------------------------------------------------
// Build-time static scanner for patch.js (Section IV #9)
// Scans dist/**/*.js and plugins/** to reject unknown/unprotected updater:* IPC.
// -----------------------------------------------------------------------------
function analyzeJsLexical(src) {
    // Single-pass lexical scan: strips // and /*...*/ comments into spaces while
    // accurately distinguishing '...' / "..." / `...` (template literals) / regex /.../ literals.
    let out = '';
    const templates = [];
    const n = src.length;
    let i = 0;
    let prevSigToken = 'start'; // start | op | punct | id | lit

    function isRegexPrefix(prevCh, wordBefore) {
        if (!prevCh) return true;
        if ('(=,:[!&|?{};~^+-*%<>'.indexOf(prevCh) >= 0) return true;
        if (wordBefore === 'return' || wordBefore === 'throw' || wordBefore === 'case' || wordBefore === 'else' || wordBefore === 'in' || wordBefore === 'of' || wordBefore === 'typeof' || wordBefore === 'void' || wordBefore === 'delete' || wordBefore === 'await' || wordBefore === 'yield') {
            return true;
        }
        return false;
    }

    let lastNonSpace = '';
    let curWord = '';
    while (i < n) {
        const c = src[i];
        const next = i + 1 < n ? src[i + 1] : '';

        if (c === '/' && next === '/') {
            out += '  ';
            i += 2;
            while (i < n && src[i] !== '\n') {
                out += ' ';
                i++;
            }
            continue;
        }
        if (c === '/' && next === '*') {
            out += '  ';
            i += 2;
            while (i < n) {
                if (src[i] === '*' && i + 1 < n && src[i + 1] === '/') {
                    out += '  ';
                    i += 2;
                    break;
                }
                out += (src[i] === '\n' ? '\n' : ' ');
                i++;
            }
            continue;
        }
        if (c === "'" || c === '"') {
            const q = c;
            out += q;
            i++;
            while (i < n) {
                const ch = src[i];
                out += ch;
                if (ch === '\\' && i + 1 < n) {
                    out += src[i + 1];
                    i += 2;
                    continue;
                }
                i++;
                if (ch === q) break;
            }
            lastNonSpace = q;
            curWord = '';
            prevSigToken = 'lit';
            continue;
        }
        if (c === '`') {
            const tplStart = i;
            let tplRaw = '`';
            i++;
            let braceDepth = 0;
            while (i < n) {
                const ch = src[i];
                tplRaw += ch;
                if (ch === '\\' && i + 1 < n) {
                    tplRaw += src[i + 1];
                    i += 2;
                    continue;
                }
                if (braceDepth === 0 && ch === '$' && i + 1 < n && src[i + 1] === '{') {
                    tplRaw += '{';
                    braceDepth = 1;
                    i += 2;
                    continue;
                }
                if (braceDepth > 0) {
                    if (ch === '{') braceDepth++;
                    else if (ch === '}') braceDepth--;
                    i++;
                    continue;
                }
                i++;
                if (ch === '`') break;
            }
            out += tplRaw;
            templates.push({ index: tplStart, raw: tplRaw });
            lastNonSpace = '`';
            curWord = '';
            prevSigToken = 'lit';
            continue;
        }
        if (c === '/' && isRegexPrefix(lastNonSpace, prevSigToken === 'id' ? curWord : '')) {
            out += '/';
            i++;
            let inClass = false;
            while (i < n) {
                const ch = src[i];
                out += ch;
                if (ch === '\\' && i + 1 < n) {
                    out += src[i + 1];
                    i += 2;
                    continue;
                }
                if (ch === '[') inClass = true;
                else if (ch === ']') inClass = false;
                else if (ch === '/' && !inClass) {
                    i++;
                    break;
                } else if (ch === '\n') {
                    i++;
                    break;
                }
                i++;
            }
            while (i < n && /[a-z]/i.test(src[i])) {
                out += src[i];
                i++;
            }
            lastNonSpace = '/';
            curWord = '';
            prevSigToken = 'lit';
            continue;
        }

        out += c;
        if (!/\s/.test(c)) {
            if (/[A-Za-z0-9_$]/.test(c)) {
                curWord = (lastNonSpace && /[A-Za-z0-9_$]/.test(lastNonSpace)) ? (curWord + c) : c;
                prevSigToken = 'id';
            } else {
                curWord = '';
                prevSigToken = (c === ')' || c === ']') ? 'lit' : 'punct';
            }
            lastNonSpace = c;
        }
        i++;
    }
    return { code: out, templates: templates };
}

function stripCommentsKeepStrings(src) {
    return analyzeJsLexical(src).code;
}

function lineNumberAt(src, index) {
    let line = 1;
    for (let i = 0; i < index && i < src.length; i++) {
        if (src[i] === '\n') line++;
    }
    return line;
}

function splitTopLevelItems(src) {
    const items = [];
    let depth = 0;
    let start = 0;
    let quote = null;
    const n = src.length;
    for (let i = 0; i < n; i++) {
        const c = src[i];
        if (quote) {
            if (c === '\\' && i + 1 < n) {
                i++;
                continue;
            }
            if (c === quote) quote = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            quote = c;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}') {
            if (depth > 0) depth--;
        } else if (c === ',' && depth === 0) {
            items.push(src.slice(start, i).trim());
            start = i + 1;
        }
    }
    const tail = src.slice(start).trim();
    if (tail || items.length > 0) items.push(tail);
    return items;
}

function extractCallArgs(src, openParenIdx) {
    let depth = 1;
    let i = openParenIdx + 1;
    const n = src.length;
    let quote = null;
    while (i < n && depth > 0) {
        const c = src[i];
        if (quote) {
            if (c === '\\' && i + 1 < n) {
                i += 2;
                continue;
            }
            if (c === quote) quote = null;
            i++;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            quote = c;
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}') {
            if (c === ')' && depth === 1) {
                return splitTopLevelItems(src.slice(openParenIdx + 1, i));
            }
            depth--;
        }
        i++;
    }
    return splitTopLevelItems(src.slice(openParenIdx + 1));
}

function extractFirstCallArg(src, openParenIdx) {
    const args = extractCallArgs(src, openParenIdx);
    return args.length > 0 ? args[0] : '';
}

function extractFirstArrayElement(arrExpr) {
    if (!arrExpr) return '';
    const trimmed = String(arrExpr).trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return '';
    const items = splitTopLevelItems(trimmed.slice(1, -1));
    return items.length > 0 ? items[0] : '';
}

function parsePlainStringLiteral(expr) {
    if (!expr || expr.length < 2) return null;
    const q = expr[0];
    if ((q !== "'" && q !== '"') || expr[expr.length - 1] !== q) return null;
    const inner = expr.slice(1, -1);
    if (inner.indexOf(q) >= 0) {
        // Verify quotes inside are escaped
        for (let i = 0; i < inner.length; i++) {
            if (inner[i] === '\\') { i++; continue; }
            if (inner[i] === q) return null;
        }
    }
    return inner;
}

function collectIpcAliases(code, isPlugin) {
    const ipcMainObjs = new Set(['ipcMain']);
    const ipcRendererObjs = new Set(isPlugin ? ['ipcRenderer'] : []);
    const methodAliases = new Map(); // varName -> 'ipcMain' | 'localOnly' | 'ipcRenderer' | 'send'

    function stripBindSuffix(rhs) {
        return rhs.replace(/\.bind\s*\([^)]*\)\s*$/, '').trim();
    }

    function classifyTarget(expr) {
        const clean = stripBindSuffix(String(expr || '').trim().replace(/^\((.*)\)$/, '$1').trim());
        if (!clean) return null;
        if (methodAliases.has(clean)) return methodAliases.get(clean);
        if (clean === 'localOnly') return 'localOnly';

        const dotOrBracket = /^([A-Za-z_$][\w$.]*)(?:\.([A-Za-z_$][\w$]*)|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])(?:\.(?:call|apply))?$/.exec(clean);
        if (!dotOrBracket) return null;
        const base = dotOrBracket[1];
        const prop = dotOrBracket[2] || dotOrBracket[3];

        const baseTail = base.split('.').pop();
        const isIpcMainObj = ipcMainObjs.has(base) || baseTail === 'ipcMain' || /\[\s*['"]ipcMain['"]\s*\]$/.test(base);
        const isIpcRendObj = isPlugin && (ipcRendererObjs.has(base) || baseTail === 'ipcRenderer' || /\[\s*['"]ipcRenderer['"]\s*\]$/.test(base));

        if (isIpcMainObj && /^(?:handle|handleOnce|on|once)$/.test(prop)) return 'ipcMain';
        if (isIpcRendObj && /^(?:invoke|send|sendSync|on|once)$/.test(prop)) return 'ipcRenderer';
        if (/^(?:send|sendSync|postMessage)$/.test(prop)) return 'send';
        return null;
    }

    const declOrAssignRe = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)|(?:^|[;{}\r\n])\s*([A-Za-z_$][\w$]*))\s*=\s*([^;\r\n]+)/g;
    const destructRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^;\r\n]+)/g;

    for (let pass = 0; pass < 3; pass++) {
        declOrAssignRe.lastIndex = 0;
        let m;
        while ((m = declOrAssignRe.exec(code)) !== null) {
            const varName = m[1] || m[2];
            const rhs = (m[3] || '').trim();
            if (!varName || !rhs) continue;

            const rhsClean = stripBindSuffix(rhs);
            if (/^(?:[A-Za-z_$][\w$.]*\.)?ipcMain$/.test(rhsClean) || /\[\s*['"]ipcMain['"]\s*\]$/.test(rhsClean) || ipcMainObjs.has(rhsClean)) {
                ipcMainObjs.add(varName);
            } else if (isPlugin && (/^(?:[A-Za-z_$][\w$.]*\.)?ipcRenderer$/.test(rhsClean) || /\[\s*['"]ipcRenderer['"]\s*\]$/.test(rhsClean) || ipcRendererObjs.has(rhsClean))) {
                ipcRendererObjs.add(varName);
            } else {
                const kind = classifyTarget(rhsClean);
                if (kind && (kind !== 'send' || /(?:webContents|hubContents|sender)\b/i.test(rhsClean))) {
                    methodAliases.set(varName, kind);
                }
            }
        }

        destructRe.lastIndex = 0;
        while ((m = destructRe.exec(code)) !== null) {
            const fields = m[1];
            const rhs = m[2].trim();
            const rhsTail = rhs.split('.').pop();
            const isMainObj = ipcMainObjs.has(rhs) || rhsTail === 'ipcMain';
            const isRendObj = isPlugin && (ipcRendererObjs.has(rhs) || rhsTail === 'ipcRenderer');
            const isElectronSrc = /require\s*\(\s*['"]electron['"]\s*\)/.test(rhs) || /\belectron(?:_1)?$/.test(rhs);

            const parts = fields.split(',');
            for (let pi = 0; pi < parts.length; pi++) {
                const part = parts[pi].trim();
                if (!part || part.indexOf('=') >= 0) continue;
                const colonIdx = part.indexOf(':');
                const key = (colonIdx >= 0 ? part.slice(0, colonIdx) : part).trim();
                const bindName = (colonIdx >= 0 ? part.slice(colonIdx + 1) : part).trim();
                if (!/^[A-Za-z_$][\w$]*$/.test(key) || !/^[A-Za-z_$][\w$]*$/.test(bindName)) continue;
                if (isElectronSrc && key === 'ipcMain') ipcMainObjs.add(bindName);
                else if (isElectronSrc && isPlugin && key === 'ipcRenderer') ipcRendererObjs.add(bindName);
                else if (isMainObj && /^(?:handle|handleOnce|on|once)$/.test(key)) methodAliases.set(bindName, 'ipcMain');
                else if (isRendObj && /^(?:invoke|send|sendSync|on|once)$/.test(key)) methodAliases.set(bindName, 'ipcRenderer');
            }
        }
    }

    return {
        ipcMainObjs: ipcMainObjs,
        ipcRendererObjs: ipcRendererObjs,
        methodAliases: methodAliases,
        classifyTarget: classifyTarget,
    };
}

function inspectIpcChannelExpr(relPath, isPlugin, kind, callee, ln, firstArg, taintedVars, inboundFound, outboundFound, violations) {
    const isIpcMain = kind === 'ipcMain';
    const isLocalOnly = kind === 'localOnly';
    const isIpcRenderer = kind === 'ipcRenderer';
    const isSend = !isIpcMain && !isLocalOnly && !isIpcRenderer;
    const lit = parsePlainStringLiteral(firstArg);

    if (lit !== null) {
        if (/^updater:/i.test(lit)) {
            if (isPlugin) {
                violations.push({
                    file: relPath,
                    line: ln,
                    kind: 'plugin-updater-ipc',
                    detail: 'Plugin references updater channel ' + lit + ' via ' + callee,
                });
                return;
            }
            if (isIpcMain) {
                inboundFound.push({ file: relPath, line: ln, channel: lit, via: callee });
                violations.push({
                    file: relPath,
                    line: ln,
                    kind: 'unprotected-direct-ipcmain',
                    detail: 'Direct ' + callee + "('" + lit + "') bypasses localOnly updater adapter",
                });
            } else if (isLocalOnly) {
                inboundFound.push({ file: relPath, line: ln, channel: lit, via: 'localOnly' });
                if (relPath !== 'dist/ipcHandlers.js') {
                    violations.push({
                        file: relPath,
                        line: ln,
                        kind: 'unexpected-updater-location',
                        detail: 'localOnly(' + lit + ') outside dist/ipcHandlers.js',
                    });
                } else if (!hasOwn(UPDATER_CHANNEL_POLICIES, lit)) {
                    violations.push({
                        file: relPath,
                        line: ln,
                        kind: 'unknown-updater-channel',
                        detail: 'Unregistered updater channel in localOnly: ' + lit,
                    });
                }
            } else if (isSend) {
                outboundFound.push({ file: relPath, line: ln, channel: lit, via: callee });
                if (relPath !== 'dist/updater.js' || lit !== 'updater:state-changed') {
                    violations.push({
                        file: relPath,
                        line: ln,
                        kind: relPath !== 'dist/updater.js' ? 'unexpected-updater-send-location' : 'unknown-updater-send',
                        detail: 'Unexpected updater outbound ' + callee + "('" + lit + "') in " + relPath,
                    });
                }
            }
        }
        return;
    }

    const looksDynamicUpdater =
        /`/.test(firstArg) ||
        /\+/.test(firstArg) ||
        /\.concat\s*\(/.test(firstArg) ||
        /\.join\s*\(/.test(firstArg) ||
        /\bupdater/i.test(firstArg) ||
        taintedVars.has(firstArg);

    if (looksDynamicUpdater) {
        if (isIpcMain || isLocalOnly || isSend || isPlugin) {
            violations.push({
                file: relPath,
                line: ln,
                kind: 'dynamic-updater-registration',
                detail: 'Dynamic/non-literal updater channel expression in ' + callee + '(' + firstArg.slice(0, 80) + ')',
            });
        }
    }
}

function scanUpdaterSource(relPath, rawSrc, opts) {
    const isPlugin = opts && opts.isPlugin === true;
    const violations = [];
    const inboundFound = [];
    const outboundFound = [];

    const lex = analyzeJsLexical(rawSrc);
    const code = lex.code;

    // Collect variables / properties assigned an updater:* string/template/concat expression
    const taintedVars = new Set();
    const assignRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\r\n;]+)/g;
    let am;
    while ((am = assignRe.exec(code)) !== null) {
        const rhs = am[2];
        if (/['"`][^'"`\r\n]*updater:/i.test(rhs) ||
            /['"]updater['"]\s*[\+,]/.test(rhs) ||
            /['"]updater['"]\s*\]\s*\.join\s*\(/i.test(rhs)) {
            taintedVars.add(am[1]);
        }
    }

    // 1. Detect template literals mentioning updater: accurately via lexer (never matches regex literals)
    for (let ti = 0; ti < lex.templates.length; ti++) {
        const tpl = lex.templates[ti];
        if (/updater:/i.test(tpl.raw)) {
            const ctxStart = Math.max(0, tpl.index - 40);
            const ctxBefore = code.slice(ctxStart, tpl.index);
            if (/\bconsole\.\w+\s*\(\s*$/.test(ctxBefore) || /\bnew\s+Error\s*\(\s*$/.test(ctxBefore)) {
                continue;
            }
            violations.push({
                file: relPath,
                line: lineNumberAt(code, tpl.index),
                kind: 'template-literal-updater-channel',
                detail: 'Template literal containing updater: detected (' + tpl.raw.slice(0, 60) + ')',
            });
        }
    }

    // 2. Detect string concatenation / array join forming updater:
    const concatPatterns = [
        { kind: 'dynamic-concat-updater-channel', re: /['"]updater:?['"]\s*\+\s*(?![\*\/])/gi },
        { kind: 'dynamic-concat-updater-channel', re: /\+\s*['"]:?(?:get-state|check-for-updates|apply|quit-and-install|state-changed|[a-z-]*updater)['"]/gi },
        { kind: 'dynamic-concat-updater-channel', re: /['"]updater:?['"]\s*\.concat\s*\(/gi },
        { kind: 'dynamic-concat-updater-channel', re: /\[\s*['"]updater['"]\s*,[^\]]*\]\s*\.join\s*\(/gi },
        { kind: 'dynamic-concat-updater-channel', re: /['"]update['"]\s*\+\s*['"]r:/gi },
    ];
    for (let pi = 0; pi < concatPatterns.length; pi++) {
        const pat = concatPatterns[pi];
        let cm;
        while ((cm = pat.re.exec(code)) !== null) {
            violations.push({
                file: relPath,
                line: lineNumberAt(code, cm.index),
                kind: pat.kind,
                detail: 'Dynamic updater channel string construction detected: ' + cm[0],
            });
        }
    }

    // Collect single-file aliases for SB-02 (const reg = ipcMain.handle, destructuring, obj aliases)
    const aliasInfo = collectIpcAliases(code, isPlugin);

    // 3. Inspect direct dot & bracket IPC call sites (including .call / .apply chaining) for SB-01
    const ipcMainMethodPart = '(?:(?:[A-Za-z_$][\\w$.]*\\.)?(?:ipcMain|\\[\\s*[\'"]ipcMain[\'"]\\s*\\])(?:\\.(?:handle|handleOnce|on|once)|\\[\\s*[\'"](?:handle|handleOnce|on|once)[\'"]\\s*\\]))';
    const ipcRendMethodPart = '(?:(?:[A-Za-z_$][\\w$.]*\\.)?(?:ipcRenderer|\\[\\s*[\'"]ipcRenderer[\'"]\\s*\\])(?:\\.(?:invoke|send|sendSync|on|once)|\\[\\s*[\'"](?:invoke|send|sendSync|on|once)[\'"]\\s*\\]))';
    const genericSendPart = '(?:[A-Za-z_$][\\w$.]*(?:\\.(?:send|sendSync|postMessage)|\\[\\s*[\'"](?:send|sendSync|postMessage)[\'"]\\s*\\]))';
    const baseCallee = isPlugin
        ? '(?:' + ipcMainMethodPart + '|localOnly|' + ipcRendMethodPart + '|' + genericSendPart + ')'
        : '(?:' + ipcMainMethodPart + '|localOnly|' + genericSendPart + ')';
    const callRe = new RegExp('\\b(' + baseCallee + '(?:\\.(?:call|apply))?)\\s*\\(', 'g');

    let m;
    while ((m = callRe.exec(code)) !== null) {
        const callee = m[1];
        const openIdx = m.index + m[0].length - 1;
        const args = extractCallArgs(code, openIdx);
        const ln = lineNumberAt(code, m.index);

        const isApply = /\.apply$/.test(callee);
        const isDotCall = !isApply && /\.call$/.test(callee);
        const baseName = callee.replace(/\.(?:call|apply)$/, '');
        let firstArg = '';
        if (isApply) {
            firstArg = extractFirstArrayElement(args[1] || '') || (args[1] || '');
        } else if (isDotCall) {
            firstArg = args[1] || '';
        } else {
            firstArg = args[0] || '';
        }

        const isIpcMain = /(?:^|\.|[\['"])ipcMain[\]'".\[]/i.test(baseName) || /(?:^|\.)ipcMain(?:\.|\[)/.test(baseName);
        const isLocalOnly = baseName === 'localOnly';
        const isIpcRenderer = isPlugin && /(?:^|\.|[\['"])ipcRenderer[\]'".\[]/.test(baseName);
        const kind = isIpcMain ? 'ipcMain' : (isLocalOnly ? 'localOnly' : (isIpcRenderer ? 'ipcRenderer' : 'send'));

        // Ignore function declaration forwarders inside localOnly(channel, handler) helper
        if (isIpcMain && relPath === 'dist/ipcHandlers.js' && firstArg === 'channel') {
            const prefixCtx = code.slice(Math.max(0, m.index - 120), m.index);
            if (/function\s+localOnly\s*\(\s*channel\s*,/.test(prefixCtx)) {
                continue;
            }
        }

        inspectIpcChannelExpr(relPath, isPlugin, kind, callee, ln, firstArg, taintedVars, inboundFound, outboundFound, violations);
    }

    // 4. Inspect aliased IPC method calls (SB-02: e.g., const reg = ipcMain.handle; reg(...), im.handle(...))
    if (aliasInfo.methodAliases.size > 0) {
        const escapedNames = Array.from(aliasInfo.methodAliases.keys()).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const aliasCallRe = new RegExp('\\b(' + escapedNames.join('|') + ')(?:\\.(call|apply))?\\s*\\(', 'g');
        while ((m = aliasCallRe.exec(code)) !== null) {
            const prefixBefore = code.slice(Math.max(0, m.index - 20), m.index);
            if (/\.\s*$/.test(prefixBefore) || /(?:function|const|let|var)\s+$/.test(prefixBefore)) {
                continue;
            }
            const aliasName = m[1];
            const callMode = m[2] || '';
            const openIdx = m.index + m[0].length - 1;
            const args = extractCallArgs(code, openIdx);
            const ln = lineNumberAt(code, m.index);
            const firstArg = callMode === 'apply'
                ? (extractFirstArrayElement(args[1] || '') || (args[1] || ''))
                : (callMode === 'call' ? (args[1] || '') : (args[0] || ''));
            const kind = aliasInfo.methodAliases.get(aliasName);
            inspectIpcChannelExpr(relPath, isPlugin, kind, 'alias:' + aliasName + (callMode ? '.' + callMode : ''), ln, firstArg, taintedVars, inboundFound, outboundFound, violations);
        }
    }

    // Also inspect calls on aliased ipcMain/ipcRenderer objects (e.g., const im = ipcMain; im.handle(...))
    const extraObjNames = [];
    aliasInfo.ipcMainObjs.forEach((n) => { if (n !== 'ipcMain') extraObjNames.push(n); });
    aliasInfo.ipcRendererObjs.forEach((n) => { if (n !== 'ipcRenderer') extraObjNames.push(n); });
    if (extraObjNames.length > 0) {
        const escObjs = extraObjNames.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const objCallRe = new RegExp('\\b((' + escObjs.join('|') + ')(?:\\.(?:handle|handleOnce|on|once|invoke|send|sendSync)|\\[\\s*[\'"](?:handle|handleOnce|on|once|invoke|send|sendSync)[\'"]\\s*\\])(?:\\.(?:call|apply))?)\\s*\\(', 'g');
        while ((m = objCallRe.exec(code)) !== null) {
            const callee = m[1];
            const objName = m[2];
            const openIdx = m.index + m[0].length - 1;
            const args = extractCallArgs(code, openIdx);
            const ln = lineNumberAt(code, m.index);
            const isApply = /\.apply$/.test(callee);
            const isDotCall = !isApply && /\.call$/.test(callee);
            const firstArg = isApply ? (extractFirstArrayElement(args[1] || '') || (args[1] || '')) : (isDotCall ? (args[1] || '') : (args[0] || ''));
            const kind = aliasInfo.ipcMainObjs.has(objName) ? 'ipcMain' : 'ipcRenderer';
            inspectIpcChannelExpr(relPath, isPlugin, kind, 'objAlias:' + callee, ln, firstArg, taintedVars, inboundFound, outboundFound, violations);
        }
    }

    // 5. Inspect Reflect.apply(target, thisArg, [channel, ...]) calls for SB-03
    const reflectRe = /\bReflect\.apply\s*\(/g;
    while ((m = reflectRe.exec(code)) !== null) {
        const openIdx = m.index + m[0].length - 1;
        const args = extractCallArgs(code, openIdx);
        const targetExpr = (args[0] || '').trim();
        const kind = aliasInfo.classifyTarget(targetExpr);
        if (!kind) continue;
        const ln = lineNumberAt(code, m.index);
        const argArr = (args[2] || '').trim();
        const firstArg = extractFirstArrayElement(argArr) || argArr;
        inspectIpcChannelExpr(relPath, isPlugin, kind, 'Reflect.apply(' + targetExpr + ')', ln, firstArg, taintedVars, inboundFound, outboundFound, violations);
    }

    return {
        violations: violations,
        inboundFound: inboundFound,
        outboundFound: outboundFound,
    };
}

function collectJsFilesRecursive(fs, path, rootDir, curDir, basePrefix, out) {
    if (!fs.existsSync(curDir)) return;
    const entries = fs.readdirSync(curDir, { withFileTypes: true });
    entries.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    for (let i = 0; i < entries.length; i++) {
        const ent = entries[i];
        const full = path.join(curDir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '__mocks__') continue;
            collectJsFilesRecursive(fs, path, rootDir, full, basePrefix, out);
        } else if (ent.isFile() && /\.(?:js|cjs|mjs)$/i.test(ent.name)) {
            const rel = path.relative(rootDir, full).split(path.sep).join('/');
            out.push({ abs: full, rel: basePrefix ? (basePrefix + '/' + rel) : rel });
        }
    }
}

function scanUpdaterChannels(targetDir, opts) {
    const fs = require('fs');
    const path = require('path');
    const cfg = opts || {};

    const distFiles = [];
    const distDir = path.join(targetDir, 'dist');
    collectJsFilesRecursive(fs, path, targetDir, distDir, '', distFiles);

    const pluginRoots = [];
    const inTargetPlugins = path.join(targetDir, 'plugins');
    if (fs.existsSync(inTargetPlugins)) pluginRoots.push(inTargetPlugins);
    if (typeof cfg.pluginsDir === 'string' && cfg.pluginsDir && fs.existsSync(cfg.pluginsDir)) {
        const resolved = path.resolve(cfg.pluginsDir);
        if (pluginRoots.indexOf(resolved) < 0) pluginRoots.push(resolved);
    }

    const pluginFiles = [];
    for (let i = 0; i < pluginRoots.length; i++) {
        collectJsFilesRecursive(fs, path, pluginRoots[i], pluginRoots[i], 'plugins', pluginFiles);
    }

    // Deduplicate explicit extraPluginFiles (e.g. repo-root platform/agm-plugin-host.js)
    const seenRealPaths = new Set();
    let hasPluginHostScanned = false;
    for (let i = 0; i < pluginFiles.length; i++) {
        const item = pluginFiles[i];
        let realP = path.resolve(item.abs);
        try { realP = fs.realpathSync(item.abs); } catch (_) {}
        seenRealPaths.add(realP);
        if (path.basename(item.abs) === 'agm-plugin-host.js') {
            hasPluginHostScanned = true;
        }
    }
    if (Array.isArray(cfg.extraPluginFiles)) {
        for (let i = 0; i < cfg.extraPluginFiles.length; i++) {
            const ep = cfg.extraPluginFiles[i];
            if (typeof ep !== 'string' || !ep || !fs.existsSync(ep)) continue;
            let realP = path.resolve(ep);
            try { realP = fs.realpathSync(ep); } catch (_) {}
            if (seenRealPaths.has(realP)) continue;
            if (path.basename(ep) === 'agm-plugin-host.js' && hasPluginHostScanned) continue;
            seenRealPaths.add(realP);
            if (path.basename(ep) === 'agm-plugin-host.js') hasPluginHostScanned = true;
            pluginFiles.push({ abs: ep, rel: 'plugins/' + path.basename(ep) });
        }
    }

    const allViolations = [];
    const inboundFound = [];
    const outboundFound = [];

    for (let i = 0; i < distFiles.length; i++) {
        const item = distFiles[i];
        const src = fs.readFileSync(item.abs, 'utf8');
        const res = scanUpdaterSource(item.rel, src, { isPlugin: false });
        Array.prototype.push.apply(allViolations, res.violations);
        Array.prototype.push.apply(inboundFound, res.inboundFound);
        Array.prototype.push.apply(outboundFound, res.outboundFound);
    }
    for (let i = 0; i < pluginFiles.length; i++) {
        const item = pluginFiles[i];
        const src = fs.readFileSync(item.abs, 'utf8');
        const res = scanUpdaterSource(item.rel, src, { isPlugin: true });
        Array.prototype.push.apply(allViolations, res.violations);
    }

    return {
        ok: allViolations.length === 0,
        scannedFiles: distFiles.length + pluginFiles.length,
        distFilesCount: distFiles.length,
        pluginFilesCount: pluginFiles.length,
        inboundFound: inboundFound,
        outboundFound: outboundFound,
        violations: allViolations,
    };
}

const api = {
    MARKER: MARKER,
    GATE_SYMBOL: GATE_SYMBOL,
    DENY_MESSAGE: DENY_MESSAGE,
    UPDATER_CAPABILITIES: UPDATER_CAPABILITIES,
    UPDATER_CHANNEL_POLICIES: UPDATER_CHANNEL_POLICIES,
    UPDATER_OUTBOUND_CHANNELS: UPDATER_OUTBOUND_CHANNELS,
    NON_IPC_UPDATER_ENTRY_POINTS: NON_IPC_UPDATER_ENTRY_POINTS,
    createSharedGateSlot: createSharedGateSlot,
    bindSharedGate: bindSharedGate,
    getSharedGate: getSharedGate,
    createUpdaterAuthAdapter: createUpdaterAuthAdapter,
    canReceiveUpdaterBroadcast: canReceiveUpdaterBroadcast,
    extractRuntimeSource: extractRuntimeSource,
    getRuntimeSource: getRuntimeSource,
    stripCommentsKeepStrings: stripCommentsKeepStrings,
    scanUpdaterSource: scanUpdaterSource,
    scanUpdaterChannels: scanUpdaterChannels,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
