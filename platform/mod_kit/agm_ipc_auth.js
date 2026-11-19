// =============================================================================
// AGM IPC Authorization Core (platform/mod_kit/agm_ipc_auth.js)
//
// Main-process-only allow-list for privileged `hakimi:*` IPC. The trust decision
// is based on the identity of the WebContents object that was registered by the
// local window factory (utils.createWindow), plus the sender frame identity.
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

function isClearlyRemoteUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    const m = /^(https?):\/\/([^/?#]+)/i.exec(url);
    if (!m) return false;
    let host = m[2].toLowerCase();
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        host = end >= 0 ? host.slice(0, end + 1) : host;
    } else {
        host = host.split(':')[0];
    }
    if (host === 'localhost' || host.endsWith('.localhost')) return false;
    if (host === '127.0.0.1' || host === '[::1]' || host === '::1') return false;
    return true;
}

function createIpcAuthorizer(options) {
    const opts = options || {};
    const registry = new Map();
    const attached = typeof WeakSet === 'function' ? new WeakSet() : null;
    const logger = typeof opts.logger === 'function' ? opts.logger : function () {};
    const ipcState = new WeakMap();

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
        const id = wc.id;
        if (id === undefined || id === null) return false;
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

    function hasRemoteBackendFlag(wc) {
        try {
            const prefs = typeof wc.getLastWebPreferences === 'function' ? wc.getLastWebPreferences() : null;
            const extra = prefs && Array.isArray(prefs.additionalArguments) ? prefs.additionalArguments : [];
            for (const arg of extra) {
                if (String(arg).toLowerCase().indexOf('--agy-backend=ssh') >= 0) return true;
            }
        } catch (_) {}
        return false;
    }

    function installCreateWindowHook(utilsModule, source) {
        if (!utilsModule || typeof utilsModule.createWindow !== 'function') return false;
        const current = utilsModule.createWindow;
        if (current.__agmIpcSecWrapped) return true;
        const original = current;
        const wrapped = function () {
            const args = Array.prototype.slice.call(arguments);
            const result = original.apply(this, args);
            const initialUrl = args.filter(function (a) { return typeof a === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(a); })[0] || '';
            const registerWindow = function (win) {
                if (!win) return;
                const wc = win.webContents || (win.id !== undefined && win.mainFrame ? win : null);
                if (!wc) return;
                if (isClearlyRemoteUrl(initialUrl)) return;
                // The remote (SSH) backend is marked by the main process via
                // webPreferences.additionalArguments; never register those.
                if (hasRemoteBackendFlag(wc)) return;
                register(wc, typeof source === 'string' ? source : 'utils.createWindow');
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
            const entry = registry.get(wc.id);
            return !!(entry && entry.wc === wc);
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
    createIpcAuthorizer: createIpcAuthorizer,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
