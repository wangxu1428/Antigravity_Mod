// =============================================================================
// AGM IPC Authorization Core (platform/mod_kit/agm_ipc_auth.js)
//
// Main-process-only allow-list for privileged `hakimi:*` IPC. The trust decision
// is based on the identity of the WebContents object that was registered by the
// local window factory (utils.createWindow), plus the sender frame identity,
// creation options / webPreferences inspection, and official backend markers
// (remoteWindowSecurity / windowBackends) when available. Fail-closed on any
// missing, unreadable, throwing, or uncertain backend determination.
// URLs are only an *additional* sanity check; renderer supplied flags/ids/URLs
// are never trusted.
//
// This file is intentionally dependency-free so that patch.js can embed the
// exact same source into dist/main.js and the offline tests can require() it
// directly. Keep it ES5-ish and free of Node APIs.
// =============================================================================
'use strict';

const DENY_MESSAGE = 'unauthorized';
const MARKER = 'AGM_IPC_SEC_GATE_V1';

function extractHttpHost(url) {
    if (typeof url !== 'string' || !url) return null;
    const m = /^(https?):\/\/([^/?#]+)/i.exec(url);
    if (!m) return null;
    let host = m[2].toLowerCase();
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        host = end >= 0 ? host.slice(0, end + 1) : host;
    } else {
        host = host.split(':')[0];
    }
    return host;
}

function isLoopbackHost(host) {
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
    return false;
}

function isClearlyRemoteUrl(url) {
    const host = extractHttpHost(url);
    if (!host) return false;
    return !isLoopbackHost(host);
}

function isExplicitLocalUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (/^file:\/\//i.test(url)) return true;
    const host = extractHttpHost(url);
    if (!host) return false;
    return isLoopbackHost(host);
}

function inspectAdditionalArgs(rawArgs) {
    if (rawArgs === undefined) {
        return { ok: true, explicitLocal: false, present: false };
    }
    if (!Array.isArray(rawArgs)) {
        return { ok: false, reason: 'invalid-additional-args', explicitLocal: false, present: true };
    }
    let explicitLocal = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const item = rawArgs[i];
        if (typeof item !== 'string') {
            return { ok: false, reason: 'invalid-additional-args', explicitLocal: false, present: true };
        }
        const arg = item.trim().toLowerCase();
        if (arg === '--agy-backend' || arg === '--backend') {
            if (i + 1 >= rawArgs.length || typeof rawArgs[i + 1] !== 'string') {
                return { ok: false, reason: 'remote-backend-arg', explicitLocal: false, present: true };
            }
            const nextVal = rawArgs[i + 1].trim().toLowerCase();
            if (nextVal !== 'local') {
                return { ok: false, reason: 'remote-backend-arg', explicitLocal: false, present: true };
            }
            explicitLocal = true;
            i += 1;
            continue;
        }
        const agyIdx = arg.indexOf('--agy-backend=');
        if (agyIdx >= 0) {
            const val = arg.slice(agyIdx + '--agy-backend='.length);
            if (val !== 'local') {
                return { ok: false, reason: 'remote-backend-arg', explicitLocal: false, present: true };
            }
            explicitLocal = true;
            continue;
        }
        if (arg.indexOf('--backend=') === 0) {
            const val = arg.slice('--backend='.length);
            if (val !== 'local') {
                return { ok: false, reason: 'remote-backend-arg', explicitLocal: false, present: true };
            }
            explicitLocal = true;
            continue;
        }
        if (arg === '--remote') {
            return { ok: false, reason: 'remote-flag-arg', explicitLocal: false, present: true };
        }
        if (arg.indexOf('--remote=') === 0) {
            const rVal = arg.slice('--remote='.length);
            if (rVal !== 'false' && rVal !== '0') {
                return { ok: false, reason: 'remote-flag-arg', explicitLocal: false, present: true };
            }
            continue;
        }
        if (arg === '--ssh' || arg.indexOf('--ssh=') === 0) {
            return { ok: false, reason: 'ssh-flag-arg', explicitLocal: false, present: true };
        }
    }
    return { ok: true, explicitLocal: explicitLocal, present: true };
}

function inspectOptionsObject(obj) {
    try {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return { ok: false, reason: 'invalid-options', explicitLocal: false, hasLocalUrl: false };
        }
        let explicitLocal = false;
        let hasLocalUrl = false;

        const inspectFields = function (target) {
            if (target.additionalArguments !== undefined) {
                const argsCheck = inspectAdditionalArgs(target.additionalArguments);
                if (!argsCheck.ok) return argsCheck;
                if (argsCheck.explicitLocal) explicitLocal = true;
            }
            const backendKeys = ['backend', 'backendType', 'windowBackend'];
            for (let i = 0; i < backendKeys.length; i++) {
                const val = target[backendKeys[i]];
                if (val !== undefined) {
                    if (typeof val !== 'string' || val.trim().toLowerCase() !== 'local') {
                        return { ok: false, reason: 'remote-backend-option' };
                    }
                    explicitLocal = true;
                }
            }
            const remoteBoolKeys = [
                'remote', 'isRemote', 'isRemoteWindow', 'remoteBackend',
                'ssh', 'isSsh', 'sshHost', 'remoteHost', 'remoteSession', 'hostId',
            ];
            for (let i = 0; i < remoteBoolKeys.length; i++) {
                const val = target[remoteBoolKeys[i]];
                if (val !== undefined && val !== false) {
                    return { ok: false, reason: 'remote-flag-option' };
                }
            }
            const localBoolKeys = ['isLocal', 'local', 'localBackend'];
            for (let i = 0; i < localBoolKeys.length; i++) {
                const val = target[localBoolKeys[i]];
                if (val !== undefined) {
                    if (val !== true) {
                        return { ok: false, reason: 'non-local-option' };
                    }
                    explicitLocal = true;
                }
            }
            if (target.partition !== undefined) {
                if (typeof target.partition !== 'string' || target.partition.trim() !== '') {
                    return { ok: false, reason: 'non-default-partition' };
                }
            }
            if (target.titleSuffix !== undefined && typeof target.titleSuffix === 'string') {
                if (/\bssh\b/i.test(target.titleSuffix)) {
                    return { ok: false, reason: 'remote-title-option' };
                }
            }
            const urlKeys = ['url', 'initialUrl'];
            for (let i = 0; i < urlKeys.length; i++) {
                const u = target[urlKeys[i]];
                if (u !== undefined) {
                    if (typeof u !== 'string' || !isExplicitLocalUrl(u)) {
                        return { ok: false, reason: 'non-local-url-option' };
                    }
                    hasLocalUrl = true;
                }
            }
            return { ok: true };
        };

        const topRes = inspectFields(obj);
        if (!topRes.ok) {
            return { ok: false, reason: topRes.reason, explicitLocal: false, hasLocalUrl: false };
        }
        if (obj.webPreferences !== undefined) {
            const wp = obj.webPreferences;
            if (!wp || typeof wp !== 'object' || Array.isArray(wp)) {
                return { ok: false, reason: 'invalid-web-preferences', explicitLocal: false, hasLocalUrl: false };
            }
            const wpRes = inspectFields(wp);
            if (!wpRes.ok) {
                return { ok: false, reason: wpRes.reason, explicitLocal: false, hasLocalUrl: false };
            }
        }
        return { ok: true, explicitLocal: explicitLocal, hasLocalUrl: hasLocalUrl };
    } catch (_) {
        return { ok: false, reason: 'options-inspection-error', explicitLocal: false, hasLocalUrl: false };
    }
}

function createIpcAuthorizer(options) {
    const opts = options || {};
    const registry = new Map();
    const attached = typeof WeakSet === 'function' ? new WeakSet() : null;
    const logger = typeof opts.logger === 'function' ? opts.logger : function () {};
    const ipcState = new WeakMap();
    const hasRemoteSecurityOpt = opts.remoteWindowSecurity !== undefined && opts.remoteWindowSecurity !== null;
    const remoteWindowSecurity = opts.remoteWindowSecurity;
    const hasWindowBackendsOpt = opts.windowBackends !== undefined && opts.windowBackends !== null;
    const windowBackends = opts.windowBackends;
    const requireOfficialBackendChecks = opts.requireOfficialBackendChecks === true;

    function safeIsDestroyed(wc) {
        try {
            return !!(wc && typeof wc.isDestroyed === 'function' && wc.isDestroyed());
        } catch (_) {
            return true;
        }
    }

    function frameDestroyed(frame) {
        try {
            if (frame && typeof frame.isDestroyed === 'function' && frame.isDestroyed()) return true;
            if (frame && frame.detached === true) return true;
        } catch (_) {
            return true;
        }
        return false;
    }

    function mainFrameUrl(wc) {
        try {
            if (wc && wc.mainFrame && typeof wc.mainFrame.url === 'string') return wc.mainFrame.url;
        } catch (_) {}
        try {
            if (wc && typeof wc.getURL === 'function') return wc.getURL();
        } catch (_) {}
        return '';
    }

    function checkOfficialBackend(wc, win) {
        let confirmedLocal = false;
        if (hasRemoteSecurityOpt) {
            if (typeof remoteWindowSecurity !== 'object' || typeof remoteWindowSecurity.isRemoteContents !== 'function') {
                return { ok: false, reason: 'remote-check-unavailable', confirmedLocal: false };
            }
            let isRemote;
            try {
                isRemote = remoteWindowSecurity.isRemoteContents(wc);
            } catch (_) {
                return { ok: false, reason: 'remote-check-failed', confirmedLocal: false };
            }
            if (isRemote !== false) {
                return {
                    ok: false,
                    reason: isRemote === true ? 'remote-sender' : 'remote-check-uncertain',
                    confirmedLocal: false,
                };
            }
            if (typeof remoteWindowSecurity.isRemoteSession === 'function') {
                let ses;
                try {
                    ses = wc.session;
                } catch (_) {
                    return { ok: false, reason: 'remote-check-failed', confirmedLocal: false };
                }
                if (ses !== undefined && ses !== null) {
                    let remoteSes;
                    try {
                        remoteSes = remoteWindowSecurity.isRemoteSession(ses);
                    } catch (_) {
                        return { ok: false, reason: 'remote-check-failed', confirmedLocal: false };
                    }
                    if (remoteSes !== false) {
                        return {
                            ok: false,
                            reason: remoteSes === true ? 'remote-session' : 'remote-check-uncertain',
                            confirmedLocal: false,
                        };
                    }
                }
            }
            confirmedLocal = true;
        }
        if (hasWindowBackendsOpt) {
            const hasRemoteBackendOf = typeof windowBackends === 'object' && typeof windowBackends.remoteBackendOf === 'function';
            const hasIsLocalAppWindow = typeof windowBackends === 'object' && typeof windowBackends.isLocalAppWindow === 'function';
            if (!hasRemoteBackendOf && !hasIsLocalAppWindow) {
                return { ok: false, reason: 'backend-check-unavailable', confirmedLocal: false };
            }
            if (hasRemoteBackendOf) {
                let rb;
                try {
                    rb = windowBackends.remoteBackendOf(wc);
                } catch (_) {
                    return { ok: false, reason: 'backend-check-failed', confirmedLocal: false };
                }
                if (rb !== undefined && rb !== null) {
                    return { ok: false, reason: 'remote-sender', confirmedLocal: false };
                }
            }
            if (win && win !== wc && typeof windowBackends.remoteBackendOfWindow === 'function') {
                let rbw;
                try {
                    rbw = windowBackends.remoteBackendOfWindow(win);
                } catch (_) {
                    return { ok: false, reason: 'backend-check-failed', confirmedLocal: false };
                }
                if (rbw !== undefined && rbw !== null) {
                    return { ok: false, reason: 'remote-sender', confirmedLocal: false };
                }
            }
            if (win && hasIsLocalAppWindow) {
                let isLocalWin;
                try {
                    isLocalWin = windowBackends.isLocalAppWindow(win);
                } catch (_) {
                    return { ok: false, reason: 'backend-check-failed', confirmedLocal: false };
                }
                if (isLocalWin !== true) {
                    return { ok: false, reason: 'non-local-window', confirmedLocal: false };
                }
                confirmedLocal = true;
            } else if (hasRemoteBackendOf) {
                confirmedLocal = true;
            }
        }
        if (requireOfficialBackendChecks && !confirmedLocal) {
            return { ok: false, reason: 'backend-check-unavailable', confirmedLocal: false };
        }
        return { ok: true, reason: null, confirmedLocal: confirmedLocal };
    }

    function inspectWebPreferences(wc) {
        let getter;
        try {
            getter = wc.getLastWebPreferences;
        } catch (_) {
            return { ok: false, reason: 'webprefs-unavailable', available: false, hasArgs: false, explicitLocal: false };
        }
        if (getter === undefined) {
            return { ok: true, reason: null, available: false, hasArgs: false, explicitLocal: false };
        }
        if (typeof getter !== 'function') {
            return { ok: false, reason: 'webprefs-unavailable', available: false, hasArgs: false, explicitLocal: false };
        }
        let prefs;
        try {
            prefs = getter.call(wc);
        } catch (_) {
            return { ok: false, reason: 'webprefs-error', available: true, hasArgs: false, explicitLocal: false };
        }
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
            return { ok: false, reason: 'webprefs-missing', available: true, hasArgs: false, explicitLocal: false };
        }
        const optCheck = inspectOptionsObject(prefs);
        if (!optCheck.ok) {
            return { ok: false, reason: optCheck.reason, available: true, hasArgs: false, explicitLocal: false };
        }
        let hasArgs = false;
        try {
            hasArgs = Array.isArray(prefs.additionalArguments);
        } catch (_) {
            return { ok: false, reason: 'webprefs-error', available: true, hasArgs: false, explicitLocal: false };
        }
        return { ok: true, reason: null, available: true, hasArgs: hasArgs, explicitLocal: optCheck.explicitLocal };
    }

    function revoke(target, reason) {
        const wc = target && typeof target === 'object' ? target : null;
        const id = wc ? wc.id : target;
        const entry = registry.get(id);
        if (entry && (!wc || entry.wc === wc)) {
            registry.delete(id);
            return true;
        }
        return false;
    }

    function attach(wc, id) {
        if (!wc || typeof wc.on !== 'function') return;
        if (attached) {
            if (attached.has(wc)) return;
            attached.add(wc);
        }

        const navigationInfo = function (args) {
            const ev = args[0];
            let url = args[1];
            let isInPlace = args[2];
            let isMainFrame = args[3];
            if (ev && typeof ev === 'object') {
                if (typeof ev.isMainFrame === 'boolean') isMainFrame = ev.isMainFrame;
                if (typeof ev.isSameDocument === 'boolean') isInPlace = ev.isSameDocument;
                if (typeof ev.url === 'string') url = ev.url;
            }
            return { url: url, isInPlace: isInPlace, isMainFrame: isMainFrame };
        };

        const onNavigation = function () {
            const info = navigationInfo(Array.prototype.slice.call(arguments));
            // Only a cross-document navigation of the main frame invalidates trust.
            if (info.isMainFrame === false) return;
            if (info.isInPlace === true) return;
            const entry = registry.get(id);
            if (!entry || entry.wc !== wc) return;
            // The very first navigation is the window's initial load, not a
            // post-trust navigation. Everything after the first completed load
            // revokes the registration. A first navigation that is already a
            // clearly remote origin (e.g. an initial redirect) is revoked too.
            if (!entry.loaded) {
                if (isClearlyRemoteUrl(info.url)) registry.delete(id);
                return;
            }
            registry.delete(id);
        };

        const onRedirect = function () {
            const info = navigationInfo(Array.prototype.slice.call(arguments));
            if (info.isMainFrame === false) return;
            if (!isClearlyRemoteUrl(info.url)) return;
            const entry = registry.get(id);
            if (entry && entry.wc === wc) registry.delete(id);
        };

        const onFinished = function () {
            const entry = registry.get(id);
            if (!entry || entry.wc !== wc) return;
            entry.loaded = true;
            // Additional sanity check only: a trusted local window that ends up
            // on a clearly remote http(s) origin loses its authorization.
            if (isClearlyRemoteUrl(mainFrameUrl(wc))) {
                registry.delete(id);
            }
        };

        const onDestroyed = function () {
            const entry = registry.get(id);
            if (entry && entry.wc === wc) registry.delete(id);
        };

        try { wc.on('did-start-navigation', onNavigation); } catch (_) {}
        try { wc.on('will-redirect', onRedirect); } catch (_) {}
        try { wc.on('did-finish-load', onFinished); } catch (_) {}
        try {
            if (typeof wc.once === 'function') wc.once('destroyed', onDestroyed);
            else wc.on('destroyed', onDestroyed);
        } catch (_) {}
    }

    function register(wc, source) {
        if (!wc || typeof wc !== 'object') return false;
        if (safeIsDestroyed(wc)) return false;
        let id;
        try {
            id = wc.id;
        } catch (_) {
            return false;
        }
        if (id === undefined || id === null) return false;
        const officialCheck = checkOfficialBackend(wc, null);
        if (!officialCheck.ok) return false;
        const existing = registry.get(id);
        if (existing && existing.wc === wc) return true;
        registry.set(id, { wc: wc, loaded: false, source: typeof source === 'string' ? source : 'explicit' });
        attach(wc, id);
        return true;
    }

    function denyReason(event) {
        if (!event || typeof event !== 'object') return 'missing-event';
        let sender;
        try { sender = event.sender; } catch (_) { return 'sender-unavailable'; }
        if (!sender) return 'missing-sender';
        if (safeIsDestroyed(sender)) return 'sender-destroyed';
        let senderId;
        try { senderId = sender.id; } catch (_) { return 'sender-unavailable'; }
        const entry = registry.get(senderId);
        if (!entry || entry.wc !== sender) return 'untrusted-sender';
        const officialCheck = checkOfficialBackend(sender, null);
        if (!officialCheck.ok) {
            registry.delete(senderId);
            return officialCheck.reason;
        }
        let frame;
        try { frame = event.senderFrame; } catch (_) { return 'frame-unavailable'; }
        if (frame === null || frame === undefined) return 'missing-frame';
        if (frameDestroyed(frame)) return 'frame-destroyed';
        let mainFrame;
        try { mainFrame = sender.mainFrame; } catch (_) { return 'main-frame-unavailable'; }
        if (!mainFrame) return 'missing-main-frame';
        if (frame !== mainFrame) return 'not-main-frame';
        return null;
    }

    function authorize(event, channel) {
        const reason = denyReason(event);
        if (reason) {
            logger(String(channel || 'unknown'), reason);
            return { ok: false, reason: reason };
        }
        return { ok: true, reason: null };
    }

    function unauthorizedError() {
        const err = new Error(DENY_MESSAGE);
        err.code = 'AGM_IPC_UNAUTHORIZED';
        return err;
    }

    function stateFor(ipcMain) {
        let st = ipcState.get(ipcMain);
        if (!st) {
            st = { handlers: new Set(), listeners: new Map() };
            ipcState.set(ipcMain, st);
        }
        return st;
    }

    function wrapHandle(ipcMain, channel, handler) {
        if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('invalid ipcMain');
        if (typeof handler !== 'function') throw new Error('invalid handler');
        const wrapped = function (event) {
            if (!authorize(event, channel).ok) throw unauthorizedError();
            const args = Array.prototype.slice.call(arguments);
            return handler.apply(this, args);
        };
        wrapped.__agmIpcSecWrapped = true;
        wrapped.__agmIpcSecChannel = channel;
        const st = stateFor(ipcMain);
        if (st.handlers.has(channel) && typeof ipcMain.removeHandler === 'function') {
            ipcMain.removeHandler(channel);
        }
        ipcMain.handle(channel, wrapped);
        st.handlers.add(channel);
        return wrapped;
    }

    function wrapOn(ipcMain, channel, handler) {
        if (!ipcMain || typeof ipcMain.on !== 'function') throw new Error('invalid ipcMain');
        if (typeof handler !== 'function') throw new Error('invalid handler');
        const wrapped = function (event) {
            if (!authorize(event, channel).ok) return undefined;
            const args = Array.prototype.slice.call(arguments);
            return handler.apply(this, args);
        };
        wrapped.__agmIpcSecWrapped = true;
        wrapped.__agmIpcSecChannel = channel;
        const st = stateFor(ipcMain);
        const previous = st.listeners.get(channel);
        if (previous && typeof ipcMain.removeListener === 'function') {
            try { ipcMain.removeListener(channel, previous); } catch (_) {}
        }
        ipcMain.on(channel, wrapped);
        st.listeners.set(channel, wrapped);
        return wrapped;
    }

    function evaluateCreatedWindow(args, win, hookSource) {
        if (!win) return;
        let wc = null;
        try {
            wc = win.webContents || (win.id !== undefined && win.mainFrame ? win : null);
        } catch (_) {
            return;
        }
        if (!wc || safeIsDestroyed(wc)) return;

        let hasLocalInitialUrl = false;
        let hasExplicitLocalOption = false;
        try {
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (typeof a === 'string') {
                    if (a.length > 0) {
                        if (!isExplicitLocalUrl(a)) return;
                        hasLocalInitialUrl = true;
                    }
                } else if (a !== undefined && a !== null && typeof a === 'object') {
                    const optRes = inspectOptionsObject(a);
                    if (!optRes.ok) return;
                    if (optRes.explicitLocal) hasExplicitLocalOption = true;
                    if (optRes.hasLocalUrl) hasLocalInitialUrl = true;
                }
            }
        } catch (_) {
            return;
        }

        const wpCheck = inspectWebPreferences(wc);
        if (!wpCheck.ok) return;
        if (wpCheck.explicitLocal) hasExplicitLocalOption = true;

        const officialCheck = checkOfficialBackend(wc, win);
        if (!officialCheck.ok) return;

        if (isClearlyRemoteUrl(mainFrameUrl(wc))) return;

        // Fail closed when Electron omits additionalArguments from getLastWebPreferences()
        // (observed on Electron 44.9.1) unless official backend checks or explicit local options confirm locality.
        if (wpCheck.available && !wpCheck.hasArgs && !officialCheck.confirmedLocal && !hasExplicitLocalOption) {
            return;
        }

        // Fail closed when no reliable locality determination source is available.
        if (!officialCheck.confirmedLocal && !hasExplicitLocalOption && !hasLocalInitialUrl) {
            return;
        }

        register(wc, typeof hookSource === 'string' ? hookSource : 'utils.createWindow');
    }

    function installCreateWindowHook(utilsModule, source) {
        if (!utilsModule || typeof utilsModule.createWindow !== 'function') return false;
        const current = utilsModule.createWindow;
        if (current.__agmIpcSecWrapped) return true;
        const hookSource = typeof source === 'string' ? source : 'utils.createWindow';
        const original = current;
        const wrapped = function () {
            const args = Array.prototype.slice.call(arguments);
            const result = original.apply(this, args);
            const registerWindow = function (win) {
                evaluateCreatedWindow(args, win, hookSource);
            };
            try {
                if (result && typeof result.then === 'function') {
                    result.then(registerWindow, function () {});
                } else {
                    registerWindow(result);
                }
            } catch (_) {}
            return result;
        };
        wrapped.__agmIpcSecWrapped = true;
        try {
            utilsModule.createWindow = wrapped;
        } catch (_) {
            return false;
        }
        return utilsModule.createWindow === wrapped;
    }

    return {
        DENY_MESSAGE: DENY_MESSAGE,
        register: register,
        revoke: revoke,
        isRegistered: function (wc) {
            if (!wc) return false;
            try {
                const entry = registry.get(wc.id);
                return !!(entry && entry.wc === wc);
            } catch (_) {
                return false;
            }
        },
        size: function () { return registry.size; },
        denyReason: denyReason,
        authorize: authorize,
        wrapHandle: wrapHandle,
        wrapOn: wrapOn,
        installCreateWindowHook: installCreateWindowHook,
    };
}

const api = {
    MARKER: MARKER,
    DENY_MESSAGE: DENY_MESSAGE,
    isClearlyRemoteUrl: isClearlyRemoteUrl,
    isExplicitLocalUrl: isExplicitLocalUrl,
    createIpcAuthorizer: createIpcAuthorizer,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
