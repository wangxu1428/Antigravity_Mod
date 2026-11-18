// =============================================================================
// AGM Plugin Host v2.1.0 - External Plugin Runtime, Permission Gateway & Hub UI
// Runs outside app.asar; loaded first by preload HakimiPluginHost Initializer.
// Pure functions are exported for Node.js unit testing when module.exports exists.
// =============================================================================
(function (root) {
    'use strict';

    const HOST_VERSION = '2.1.0';
    const DEFAULT_SETTINGS = {
        executionTimeoutMs: 2500,
        logRetentionLines: 200,
        autoEnableOnInstall: false,
        showTriggerPill: false, // v2.1: sidebar entry is primary; pill is opt-in
    };

    const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
    const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\+[\w.]+)?$/;

    const PERMISSIONS_CATALOG = {
        'ui:toast': { title: '弹出轻量通知', risk: '低', description: '在插件中心展示提示通知' },
        'ui:banner': { title: '更新插件状态横幅', risk: '低', description: '在插件详情/卡片区域展示状态横幅' },
        'config:read': { title: '读取本插件配置', risk: '低', description: '读取当前插件的配置项' },
        'config:write': { title: '修改本插件配置', risk: '中', description: '经 Schema 校验后修改当前插件配置' },
        'storage:read': { title: '读取插件私有存储', risk: '低', description: '读取当前插件独立 KV 存储' },
        'storage:write': { title: '写入插件私有存储', risk: '低', description: '写入当前插件独立 KV 存储（上限 64 KB）' },
        'clipboard:read': { title: '读取系统剪贴板', risk: '中', description: '读取当前系统剪贴板文本' },
        'clipboard:write': { title: '写入系统剪贴板', risk: '中', description: '向系统剪贴板写入文本' },
        'shell:launchDesktopGpt': { title: '拉起外部桌面 GPT 应用', risk: '高', description: '请求宿主拉起本地 ChatGPT 桌面端' },
    };

    const CAPABILITY_TO_PERMISSION = {
        'ui.showToast': 'ui:toast',
        'ui.setBanner': 'ui:banner',
        'config.get': 'config:read',
        'config.getAll': 'config:read',
        'config.set': 'config:write',
        'storage.get': 'storage:read',
        'storage.set': 'storage:write',
        'clipboard.readText': 'clipboard:read',
        'clipboard.writeText': 'clipboard:write',
        'shell.launchDesktopGpt': 'shell:launchDesktopGpt',
    };

    const LEGACY_METADATA = {
        'hakimi-i18n': {
            id: 'hakimi-i18n',
            name: 'Hakimi i18n Deep Localization Engine',
            author: 'Hakimi Tech Lab',
            version: '1.1.0',
            description: '内置深度本地化引擎（DOM MutationObserver + 六级瀑布流翻译 + 词典配置中心）。',
            permissions: ['dom:observe', 'dom:mutate', 'config:read', 'config:write'],
            configSection: 'i18n',
            hasOwnConfigUI: true,
            liveDisableSupported: true,
        },
        'ai-sidedock': {
            id: 'ai-sidedock',
            name: 'AI Side-Dock Three-Titan',
            author: 'Hakimi Tech Lab',
            version: '1.1.0',
            description: '内置三巨头 AI 侧边舱（Gemini / ChatGPT / Grok 视口挤压分屏）。',
            permissions: ['dom:mutate', 'webview:embed', 'config:read', 'config:write', 'shell:launchDesktopGpt'],
            configSection: 'sidedock',
            hasOwnConfigUI: false,
            liveDisableSupported: false,
        },
    };

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function parseSemver(ver) {
        if (typeof ver !== 'string') return null;
        const m = SEMVER_RE.exec(ver.trim());
        if (!m) return null;
        return {
            major: Number(m[1]),
            minor: Number(m[2]),
            patch: Number(m[3]),
            pre: m[4] || '',
        };
    }

    function compareSemver(aStr, bStr) {
        const a = typeof aStr === 'string' ? parseSemver(aStr) : aStr;
        const b = typeof bStr === 'string' ? parseSemver(bStr) : bStr;
        if (!a || !b) return 0;
        if (a.major !== b.major) return a.major > b.major ? 1 : -1;
        if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
        if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
        if (!a.pre && b.pre) return 1;
        if (a.pre && !b.pre) return -1;
        if (a.pre === b.pre) return 0;
        return a.pre > b.pre ? 1 : -1;
    }

    function satisfiesRange(actualStr, rangeStr) {
        if (typeof rangeStr !== 'string' || !rangeStr.trim()) return false;
        const trimmed = rangeStr.trim();
        if (trimmed === '*') return true;
        const actual = parseSemver(actualStr);
        if (!actual) return false;

        const parts = trimmed.split(/\s+/).filter(Boolean);
        for (const part of parts) {
            const m = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(part);
            if (!m) return false;
            const op = m[1] || '=';
            const target = parseSemver(m[2]);
            if (!target) return false;
            const cmp = compareSemver(actual, target);
            if (op === '>=' && cmp < 0) return false;
            if (op === '<=' && cmp > 0) return false;
            if (op === '>' && cmp <= 0) return false;
            if (op === '<' && cmp >= 0) return false;
            if (op === '=' && cmp !== 0) return false;
            if (op === '^') {
                if (cmp < 0) return false;
                if (target.major > 0) {
                    if (actual.major !== target.major) return false;
                } else if (target.minor > 0) {
                    if (actual.major !== 0 || actual.minor !== target.minor) return false;
                } else {
                    if (actual.major !== 0 || actual.minor !== 0 || actual.patch !== target.patch) return false;
                }
            }
        }
        return true;
    }

    function checkCompatibility(compatibility, hostInfo) {
        const appVer = (hostInfo && hostInfo.appVersion) ? String(hostInfo.appVersion) : '1.0.0';
        const hostVer = (hostInfo && hostInfo.hostVersion) ? String(hostInfo.hostVersion) : HOST_VERSION;
        if (!isPlainObject(compatibility)) {
            return {
                compatible: false,
                reasons: ['compatibility 字段缺失或格式无效'],
                appCheck: { required: '', actual: appVer, ok: false },
                hostCheck: { required: '', actual: hostVer, ok: false },
            };
        }
        const reqApp = typeof compatibility.appVersion === 'string' ? compatibility.appVersion : '';
        const reqHost = typeof compatibility.hostVersion === 'string' ? compatibility.hostVersion : '';
        const appOk = reqApp ? satisfiesRange(appVer, reqApp) : false;
        const hostOk = reqHost ? satisfiesRange(hostVer, reqHost) : false;
        const reasons = [];
        if (!appOk) reasons.push(`appVersion 不兼容（要求 ${reqApp || '未声明'}，当前 ${appVer}）`);
        if (!hostOk) reasons.push(`hostVersion 不兼容（要求 ${reqHost || '未声明'}，当前 ${hostVer}）`);
        return {
            compatible: appOk && hostOk,
            reasons,
            appCheck: { required: reqApp, actual: appVer, ok: appOk },
            hostCheck: { required: reqHost, actual: hostVer, ok: hostOk },
        };
    }

    function normalizeEnumOptions(options) {
        if (!Array.isArray(options)) return [];
        return options.map(opt => {
            if (isPlainObject(opt) && typeof opt.value === 'string') {
                return { value: opt.value, label: typeof opt.label === 'string' ? opt.label : opt.value };
            }
            if (typeof opt === 'string') {
                return { value: opt, label: opt };
            }
            return null;
        }).filter(Boolean);
    }

    function validateManifest(manifest, expectedDirId) {
        const errors = [];
        if (!isPlainObject(manifest)) {
            return { valid: false, errors: ['manifest.json 必须是 JSON 对象'] };
        }
        if (manifest.manifestVersion !== 1) {
            errors.push('manifestVersion 必须为 1');
        }
        if (typeof manifest.id !== 'string' || !MANIFEST_ID_RE.test(manifest.id) || manifest.id.includes('..')) {
            errors.push('id 格式非法（需匹配 /^[a-z0-9][a-z0-9._-]{1,63}$/ 且不含 ..）');
        } else if (expectedDirId && manifest.id !== expectedDirId) {
            errors.push(`manifest.id (${manifest.id}) 必须与目录名 (${expectedDirId}) 一致`);
        }
        if (typeof manifest.name !== 'string' || manifest.name.trim().length < 1 || manifest.name.length > 64) {
            errors.push('name 必须为 1~64 字符的非空字符串');
        }
        if (typeof manifest.author !== 'string' || manifest.author.trim().length < 1 || manifest.author.length > 64) {
            errors.push('author 必须为 1~64 字符的非空字符串');
        }
        if (typeof manifest.version !== 'string' || !parseSemver(manifest.version)) {
            errors.push('version 必须符合语义化版本格式 (x.y.z)');
        }
        if (manifest.description !== undefined && typeof manifest.description !== 'string') {
            errors.push('description 必须为字符串');
        }
        if (!isPlainObject(manifest.compatibility) ||
            typeof manifest.compatibility.appVersion !== 'string' ||
            typeof manifest.compatibility.hostVersion !== 'string') {
            errors.push('compatibility 必须包含 appVersion 和 hostVersion 字符串');
        }
        if (typeof manifest.entry !== 'string' ||
            !manifest.entry.trim() ||
            manifest.entry.includes('..') ||
            manifest.entry.startsWith('/') ||
            manifest.entry.startsWith('\\') ||
            /^[a-zA-Z]:/.test(manifest.entry) ||
            !manifest.entry.endsWith('.js')) {
            errors.push('entry 必须为包内相对 .js 路径且禁止 .. 或绝对路径');
        }
        if (!Array.isArray(manifest.permissions) || manifest.permissions.some(p => typeof p !== 'string' || !p.trim())) {
            errors.push('permissions 必须为字符串数组');
        }
        if (manifest.actions !== undefined) {
            if (!Array.isArray(manifest.actions)) {
                errors.push('actions 必须为数组');
            } else {
                manifest.actions.forEach((act, idx) => {
                    if (!isPlainObject(act) || typeof act.id !== 'string' || !act.id.trim() || typeof act.label !== 'string' || !act.label.trim()) {
                        errors.push(`actions[${idx}] 必须包含非空 id 和 label`);
                    }
                });
            }
        }
        if (!isPlainObject(manifest.configSchema)) {
            errors.push('configSchema 必须为对象');
        } else {
            for (const [key, field] of Object.entries(manifest.configSchema)) {
                if (!isPlainObject(field)) {
                    errors.push(`configSchema.${key} 必须为对象`);
                    continue;
                }
                if (!['boolean', 'string', 'number', 'enum'].includes(field.type)) {
                    errors.push(`configSchema.${key}.type 不支持: ${String(field.type)}`);
                    continue;
                }
                if (typeof field.title !== 'string' || !field.title.trim()) {
                    errors.push(`configSchema.${key}.title 必须为非空字符串`);
                }
                if (field.type === 'enum') {
                    const opts = normalizeEnumOptions(field.options);
                    if (opts.length === 0) {
                        errors.push(`configSchema.${key}.options 不能为空`);
                    } else if (field.default === undefined || !opts.some(o => o.value === field.default)) {
                        errors.push(`configSchema.${key}.default 必须在 options 中`);
                    }
                }
                if (field.type === 'string' && field.pattern) {
                    try {
                        new RegExp(field.pattern);
                    } catch (_) {
                        errors.push(`configSchema.${key}.pattern 不是合法正则表达式`);
                    }
                }
                if (field.type === 'boolean' && field.default !== undefined && typeof field.default !== 'boolean') {
                    errors.push(`configSchema.${key}.default 必须为 boolean`);
                }
                if (field.type === 'number' && field.default !== undefined && (typeof field.default !== 'number' || !Number.isFinite(field.default))) {
                    errors.push(`configSchema.${key}.default 必须为有限数字`);
                }
                if (field.type === 'string' && field.default !== undefined && typeof field.default !== 'string') {
                    errors.push(`configSchema.${key}.default 必须为 string`);
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }

    function defaultsFromSchema(schema) {
        const out = {};
        if (!isPlainObject(schema)) return out;
        for (const [key, field] of Object.entries(schema)) {
            if (!isPlainObject(field)) continue;
            if (field.default !== undefined) {
                out[key] = field.default;
            } else if (field.type === 'boolean') {
                out[key] = false;
            } else if (field.type === 'string') {
                out[key] = '';
            } else if (field.type === 'number') {
                out[key] = typeof field.min === 'number' ? field.min : 0;
            } else if (field.type === 'enum') {
                const opts = normalizeEnumOptions(field.options);
                out[key] = opts.length > 0 ? opts[0].value : '';
            }
        }
        return out;
    }

    function validateConfigBySchema(schema, rawValues) {
        const errors = {};
        const normalized = {};
        if (!isPlainObject(schema)) {
            return { ok: true, errors, normalized };
        }
        const input = isPlainObject(rawValues) ? rawValues : {};
        for (const [key, field] of Object.entries(schema)) {
            if (!isPlainObject(field)) continue;
            const val = input[key] !== undefined ? input[key] : field.default;
            if (field.type === 'boolean') {
                if (typeof val !== 'boolean') {
                    errors[key] = `${field.title || key} 必须为布尔开关`;
                } else {
                    normalized[key] = val;
                }
            } else if (field.type === 'string') {
                if (typeof val !== 'string') {
                    errors[key] = `${field.title || key} 必须为文本`;
                    continue;
                }
                if (field.required && val.trim().length === 0) {
                    errors[key] = `${field.title || key} 不能为空`;
                    continue;
                }
                if (typeof field.minLength === 'number' && val.length < field.minLength) {
                    errors[key] = `${field.title || key} 长度不能少于 ${field.minLength} 个字符`;
                    continue;
                }
                if (typeof field.maxLength === 'number' && val.length > field.maxLength) {
                    errors[key] = `${field.title || key} 长度不能超过 ${field.maxLength} 个字符`;
                    continue;
                }
                if (field.pattern) {
                    try {
                        const re = new RegExp(field.pattern);
                        if (!re.test(val)) {
                            errors[key] = `${field.title || key} 格式不符合要求`;
                            continue;
                        }
                    } catch (_) {
                        errors[key] = `${field.title || key} 校验正则无效`;
                        continue;
                    }
                }
                normalized[key] = val;
            } else if (field.type === 'number') {
                if (typeof val !== 'number' || !Number.isFinite(val)) {
                    errors[key] = `${field.title || key} 必须为有效数字`;
                    continue;
                }
                if (field.integer && !Number.isInteger(val)) {
                    errors[key] = `${field.title || key} 必须为整数`;
                    continue;
                }
                if (typeof field.min === 'number' && val < field.min) {
                    errors[key] = `${field.title || key} 不能小于 ${field.min}`;
                    continue;
                }
                if (typeof field.max === 'number' && val > field.max) {
                    errors[key] = `${field.title || key} 不能大于 ${field.max}`;
                    continue;
                }
                normalized[key] = val;
            } else if (field.type === 'enum') {
                const opts = normalizeEnumOptions(field.options);
                if (typeof val !== 'string' || !opts.some(o => o.value === val)) {
                    errors[key] = `${field.title || key} 必须是有效可选项`;
                    continue;
                }
                normalized[key] = val;
            }
        }
        return {
            ok: Object.keys(errors).length === 0,
            errors,
            normalized,
        };
    }

    function checkPermission(grantedPermissions, capability) {
        const requiredPerm = CAPABILITY_TO_PERMISSION[capability] || null;
        if (!requiredPerm) {
            return {
                allowed: false,
                code: 'E_PERMISSION_DENIED',
                requiredPerm: null,
                error: `未知宿主能力 "${String(capability)}"`,
            };
        }
        const grantedSet = grantedPermissions instanceof Set
            ? grantedPermissions
            : new Set(Array.isArray(grantedPermissions) ? grantedPermissions : []);
        if (!grantedSet.has(requiredPerm)) {
            return {
                allowed: false,
                code: 'E_PERMISSION_DENIED',
                requiredPerm,
                error: `未声明权限 "${requiredPerm}"`,
            };
        }
        return {
            allowed: true,
            code: null,
            requiredPerm,
            error: null,
        };
    }

    const pureExports = {
        HOST_VERSION,
        DEFAULT_SETTINGS,
        MANIFEST_ID_RE,
        SEMVER_RE,
        PERMISSIONS_CATALOG,
        CAPABILITY_TO_PERMISSION,
        LEGACY_METADATA,
        parseSemver,
        compareSemver,
        satisfiesRange,
        checkCompatibility,
        validateManifest,
        defaultsFromSchema,
        validateConfigBySchema,
        checkPermission,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pureExports;
    }

    // Do not run browser runtime or UI under plain Node.js
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    // =========================================================================
    // Browser Runtime & Plugin Center UI
    // =========================================================================
    if (typeof window.__agmHostTeardown === 'function') {
        try {
            window.__agmHostTeardown();
        } catch (e) {
            console.warn('[AGMPluginHost] Previous teardown error:', e);
        }
    }

    const hakimiHost = window.hakimiHost || null;
    const prevHost = window.HakimiPluginHost || {};
    const bootCtx = prevHost.__bootContext || {};

    let hostInfo = bootCtx.hostInfo || {
        appVersion: '1.0.0',
        electronVersion: '',
        nodeVersion: '',
        pluginsDir: '',
        hostSocketVersion: '2.0.0',
    };

    function normalizeRegistry(raw) {
        const reg = isPlainObject(raw) ? raw : {};
        return {
            version: 1,
            settings: {
                ...DEFAULT_SETTINGS,
                ...(isPlainObject(reg.settings) ? reg.settings : {}),
            },
            plugins: isPlainObject(reg.plugins) ? { ...reg.plugins } : {},
        };
    }

    let registry = normalizeRegistry(bootCtx.registry);
    const legacyRecords = new Map();
    const packageRecords = new Map();
    const repoRecords = new Map();
    const toasts = [];
    let isDisposed = false;
    let discoverPromise = null;

    // UI State
    const uiState = {
        isOpen: false,
        activeTab: 'installed', // 'installed' | 'repository' | 'settings'
        detailPluginId: null,
        detailTab: '', // '' | 'overview' | 'config' | 'logs' | 'panel:<id>'
        pageId: null, // registered hub page id
        searchInstalled: '',
        filterStatus: 'all', // 'all' | 'ACTIVE' | 'DISABLED' | 'ERROR'
        searchRepo: '',
        draftConfig: {},
        formErrors: {},
        formFeedback: null, // { type, message }
        settingsFeedback: null,
        logsText: '',
        actionResult: null,
    };

    let triggerEl = null;
    let overlayEl = null;
    let toastWrapEl = null;
    let keydownHandler = null;

    function nowStamp() {
        return new Date().toISOString();
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function markImmune(el) {
        if (!el || !el.setAttribute) return el;
        el.setAttribute('data-ag-localization-skip', 'true');
        el.setAttribute('data-immune', 'true');
        el.setAttribute('translate', 'no');
        return el;
    }

    async function persistRegistry() {
        if (!hakimiHost || typeof hakimiHost.writeState !== 'function') return false;
        try {
            await hakimiHost.writeState('registry', '', registry);
            return true;
        } catch (err) {
            console.error('[AGMPluginHost] persistRegistry failed:', err);
            return false;
        }
    }

    async function appendLog(pluginId, level, tag, message) {
        const line = `[${nowStamp()}] [${level}] [${tag}] ${message}`;
        if (!hakimiHost || typeof hakimiHost.writeState !== 'function') return;
        try {
            await hakimiHost.writeState('log', pluginId, line);
        } catch (err) {
            console.warn('[AGMPluginHost] writeState log failed:', err);
        }
    }

    function showToast(pluginId, message, level = 'info') {
        const entry = {
            id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            pluginId,
            message: String(message || ''),
            level: String(level || 'info'),
            timestamp: nowStamp(),
        };
        toasts.push(entry);
        if (toasts.length > 30) toasts.shift();

        if (!toastWrapEl) {
            toastWrapEl = document.createElement('div');
            toastWrapEl.id = 'agm-pc-toast-container';
            markImmune(toastWrapEl);
            document.body.appendChild(toastWrapEl);
        }
        const item = document.createElement('div');
        item.className = `agm-pc-toast agm-pc-toast-${entry.level}`;
        markImmune(item);
        item.textContent = `[${pluginId}] ${entry.message}`;
        toastWrapEl.appendChild(item);
        setTimeout(() => {
            try { item.remove(); } catch (_) {}
        }, 3500);
    }

    function getLegacyRecord(id) {
        if (legacyRecords.has(id)) return legacyRecords.get(id);
        const meta = LEGACY_METADATA[id] || {
            id,
            name: id,
            author: 'Hakimi Tech Lab',
            version: '1.0.0',
            description: '内置主世界插件',
            permissions: ['dom:mutate'],
            configSection: id,
            hasOwnConfigUI: false,
            liveDisableSupported: false,
        };
        const rec = {
            ...meta,
            isLegacy: true,
            pluginObj: null,
            state: 'DISABLED',
            lastError: null,
            pendingReload: false,
            deniedCount: 0,
        };
        legacyRecords.set(id, rec);
        return rec;
    }

    function isLegacyEnabledInRegistry(id) {
        const entry = registry.plugins[id];
        // Absence of registry entry => enabled (identical to pre-v2 behaviour)
        return entry ? entry.enabled !== false : true;
    }

    function runVerifiedLegacyTeardown(id) {
        if (id === 'hakimi-i18n') {
            if (window.__HAKIMI_I18N__ && typeof window.__HAKIMI_I18N__.restoreEnglish === 'function') {
                window.__HAKIMI_I18N__.restoreEnglish();
            }
            if (typeof window.__hakimiI18nTeardown === 'function') {
                window.__hakimiI18nTeardown();
            }
            return { complete: true };
        }
        if (id === 'ai-sidedock') {
            if (typeof window.__hakimiSideDockTeardown === 'function') {
                window.__hakimiSideDockTeardown();
            }
            // __hakimiSideDockTeardown detaches listeners/timers, while #hakimi-sidedock-root/trigger stay until reload
            return { complete: false };
        }
        return { complete: false };
    }

    // -------------------------------------------------------------------------
    // Web Worker Sandbox Management (NO main-world fallback for packages!)
    // -------------------------------------------------------------------------
    function buildWorkerBootstrap(pluginId, pluginCode) {
        const head = [
            "'use strict';",
            "(function() {",
            "  var __blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts'];",
            "  for (var i = 0; i < __blocked.length; i++) {",
            "    var k = __blocked[i];",
            "    try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); }",
            "    catch (_) { try { self[k] = undefined; } catch (__) {} }",
            "  }",
            "  var __rpcSeq = 1;",
            "  var __pendingRpc = new Map();",
            "  function __rpc(capability, args) {",
            "    return new Promise(function(resolve, reject) {",
            "      var callId = 'rpc_' + (__rpcSeq++);",
            "      __pendingRpc.set(callId, { resolve: resolve, reject: reject });",
            "      self.postMessage({ type: 'host:rpc', callId: callId, capability: capability, args: args || [] });",
            "    });",
            "  }",
            "  var __api = {",
            "    ui: {",
            "      showToast: function(message, level) { return __rpc('ui.showToast', [message, level]); },",
            "      setBanner: function(text, style) { return __rpc('ui.setBanner', [text, style]); }",
            "    },",
            "    config: {",
            "      get: function(key) { return __rpc('config.get', [key]); },",
            "      getAll: function() { return __rpc('config.getAll', []); },",
            "      set: function(key, value) { return __rpc('config.set', [key, value]); }",
            "    },",
            "    storage: {",
            "      get: function(key) { return __rpc('storage.get', [key]); },",
            "      set: function(key, value) { return __rpc('storage.set', [key, value]); }",
            "    },",
            "    clipboard: {",
            "      readText: function() { return __rpc('clipboard.readText', []); },",
            "      writeText: function(text) { return __rpc('clipboard.writeText', [text]); }",
            "    },",
            "    shell: {",
            "      launchDesktopGpt: function() { return __rpc('shell.launchDesktopGpt', []); }",
            "    }",
            "  };",
            "  var __ctx = { pluginId: " + JSON.stringify(pluginId) + ", api: __api };",
            "  var module = { exports: {} };",
            "  var exports = module.exports;",
            "  var __plugin = null;",
            "  try {",
        ].join('\n');

        const tail = [
            "    __plugin = (module.exports && (typeof module.exports.activate === 'function' || typeof module.exports.invoke === 'function' || typeof module.exports.deactivate === 'function' || typeof module.exports.onConfigChange === 'function'))",
            "      ? module.exports",
            "      : (self.__AGM_PLUGIN__ || module.exports);",
            "  } catch (loadErr) {",
            "    self.postMessage({ type: 'worker:boot-error', error: loadErr && loadErr.message ? loadErr.message : String(loadErr), stack: loadErr && loadErr.stack ? loadErr.stack : '' });",
            "    return;",
            "  }",
            "  self.onerror = function(msg, _src, _line, _col, err) {",
            "    self.postMessage({ type: 'worker:uncaught', error: (err && err.message) || String(msg), stack: err && err.stack ? err.stack : '' });",
            "  };",
            "  self.onunhandledrejection = function(ev) {",
            "    var r = ev && ev.reason;",
            "    self.postMessage({ type: 'worker:uncaught', error: (r && r.message) || String(r), stack: r && r.stack ? r.stack : '' });",
            "  };",
            "  self.onmessage = async function(ev) {",
            "    var msg = ev && ev.data;",
            "    if (!msg || typeof msg !== 'object') return;",
            "    if (msg.type === 'host:rpc-reply') {",
            "      var p = __pendingRpc.get(msg.callId);",
            "      if (!p) return;",
            "      __pendingRpc.delete(msg.callId);",
            "      if (msg.ok) { p.resolve(msg.result); }",
            "      else {",
            "        var rpcErr = new Error(msg.error || 'RPC failed');",
            "        if (msg.code) rpcErr.code = msg.code;",
            "        p.reject(rpcErr);",
            "      }",
            "      return;",
            "    }",
            "    if (msg.type === 'host:call') {",
            "      var callId = msg.callId;",
            "      try {",
            "        var result = null;",
            "        if (msg.method === 'activate') {",
            "          if (__plugin && typeof __plugin.activate === 'function') result = await __plugin.activate(__ctx, msg.config || {});",
            "        } else if (msg.method === 'invoke') {",
            "          if (!__plugin || typeof __plugin.invoke !== 'function') throw new Error('Plugin does not export invoke');",
            "          result = await __plugin.invoke(msg.actionId, msg.payload, __ctx);",
            "        } else if (msg.method === 'onConfigChange') {",
            "          if (__plugin && typeof __plugin.onConfigChange === 'function') result = await __plugin.onConfigChange(msg.config || {}, __ctx);",
            "        } else if (msg.method === 'deactivate') {",
            "          if (__plugin && typeof __plugin.deactivate === 'function') result = await __plugin.deactivate(__ctx);",
            "        } else {",
            "          throw new Error('Unknown lifecycle method: ' + msg.method);",
            "        }",
            "        self.postMessage({ type: 'worker:reply', callId: callId, ok: true, result: result });",
            "      } catch (err) {",
            "        self.postMessage({",
            "          type: 'worker:reply',",
            "          callId: callId,",
            "          ok: false,",
            "          code: (err && err.code) || 'E_PLUGIN_THROW',",
            "          error: err && err.message ? err.message : String(err),",
            "          stack: err && err.stack ? err.stack : ''",
            "        });",
            "      }",
            "    }",
            "  };",
            "  self.postMessage({ type: 'worker:ready' });",
            "})();",
        ].join('\n');

        return head + '\n' + pluginCode + '\n' + tail;
    }

    function terminateWorker(rec) {
        if (!rec) return;
        if (rec.pendingCalls) {
            for (const [, pending] of rec.pendingCalls.entries()) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Worker terminated'));
            }
            rec.pendingCalls.clear();
        }
        if (rec.worker) {
            try { rec.worker.terminate(); } catch (_) {}
            rec.worker = null;
        }
        if (rec.blobUrl) {
            try { URL.revokeObjectURL(rec.blobUrl); } catch (_) {}
            rec.blobUrl = null;
        }
    }

    async function handleWorkerRpc(rec, msg) {
        const callId = msg.callId;
        const capability = msg.capability;
        const args = Array.isArray(msg.args) ? msg.args : [];
        const granted = rec.manifest ? rec.manifest.permissions : [];
        const permCheck = checkPermission(granted, capability);
        if (!permCheck.allowed) {
            rec.deniedCount = (rec.deniedCount || 0) + 1;
            const errMsg = `[PermissionDenied] 插件 "${rec.id}" 调用 "${capability}" 被拒绝：${permCheck.error}`;
            await appendLog(rec.id, 'WARN', 'permission', errMsg);
            if (rec.worker) {
                rec.worker.postMessage({
                    type: 'host:rpc-reply',
                    callId,
                    ok: false,
                    code: 'E_PERMISSION_DENIED',
                    error: errMsg,
                });
            }
            refreshDetailPanelsIfActive(rec.id);
            return;
        }

        try {
            let result = null;
            if (capability === 'ui.showToast') {
                showToast(rec.id, args[0], args[1] || 'info');
                result = true;
            } else if (capability === 'ui.setBanner') {
                rec.banner = {
                    text: String(args[0] || ''),
                    style: String(args[1] || 'info'),
                    updatedAt: nowStamp(),
                };
                result = true;
                refreshDetailPanelsIfActive(rec.id);
            } else if (capability === 'config.get') {
                const key = args[0];
                result = rec.config && Object.prototype.hasOwnProperty.call(rec.config, key) ? rec.config[key] : undefined;
            } else if (capability === 'config.getAll') {
                result = { ...(rec.config || {}) };
            } else if (capability === 'config.set') {
                const key = args[0];
                const candidate = { ...(rec.config || {}), [key]: args[1] };
                const check = validateConfigBySchema(rec.manifest.configSchema, candidate);
                if (!check.ok) {
                    throw new Error('Schema validation failed: ' + JSON.stringify(check.errors));
                }
                rec.config = check.normalized;
                if (hakimiHost && typeof hakimiHost.writeState === 'function') {
                    await hakimiHost.writeState('config', rec.id, { config: rec.config, storage: rec.storage || {} });
                }
                result = { ...rec.config };
            } else if (capability === 'storage.get') {
                const key = String(args[0] || '');
                result = rec.storage && Object.prototype.hasOwnProperty.call(rec.storage, key) ? rec.storage[key] : undefined;
            } else if (capability === 'storage.set') {
                const key = String(args[0] || '');
                const nextStorage = { ...(rec.storage || {}) };
                if (args[1] === undefined) {
                    delete nextStorage[key];
                } else {
                    nextStorage[key] = args[1];
                }
                const serialized = JSON.stringify(nextStorage);
                const byteLen = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(serialized).length : serialized.length * 2;
                if (byteLen > 65536) {
                    throw new Error('Plugin storage limit (64 KB) exceeded');
                }
                rec.storage = nextStorage;
                if (hakimiHost && typeof hakimiHost.writeState === 'function') {
                    await hakimiHost.writeState('config', rec.id, { config: rec.config || {}, storage: rec.storage });
                }
                result = true;
            } else if (capability === 'clipboard.readText') {
                if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
                    throw new Error('Clipboard read API unavailable');
                }
                result = await navigator.clipboard.readText();
            } else if (capability === 'clipboard.writeText') {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                    throw new Error('Clipboard write API unavailable');
                }
                await navigator.clipboard.writeText(String(args[0] || ''));
                result = true;
            } else if (capability === 'shell.launchDesktopGpt') {
                if (!hakimiHost || typeof hakimiHost.launchDesktopGpt !== 'function') {
                    throw new Error('launchDesktopGpt IPC unavailable');
                }
                result = await hakimiHost.launchDesktopGpt();
            }
            if (rec.worker) {
                rec.worker.postMessage({ type: 'host:rpc-reply', callId, ok: true, result });
            }
        } catch (err) {
            if (rec.worker) {
                rec.worker.postMessage({
                    type: 'host:rpc-reply',
                    callId,
                    ok: false,
                    code: (err && err.code) || 'E_RPC_ERROR',
                    error: err && err.message ? err.message : String(err),
                });
            }
        }
    }

    function spawnSandboxWorker(rec, bootstrapCode) {
        const tryUrl = (mode) => new Promise((resolve, reject) => {
            let worker = null;
            let blobUrl = null;
            let settled = false;
            const readyTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                if (worker) { try { worker.terminate(); } catch (_) {} }
                if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
                reject(new Error(`Worker (${mode}) ready timeout`));
            }, 2000);

            try {
                if (mode === 'blob') {
                    const blob = new Blob([bootstrapCode], { type: 'application/javascript' });
                    blobUrl = URL.createObjectURL(blob);
                    worker = new Worker(blobUrl);
                } else {
                    const dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(bootstrapCode);
                    worker = new Worker(dataUrl);
                }
            } catch (syncErr) {
                clearTimeout(readyTimeout);
                if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
                reject(syncErr);
                return;
            }

            worker.onerror = (ev) => {
                const errMsg = (ev && ev.message) || `Worker (${mode}) error`;
                if (!settled) {
                    settled = true;
                    clearTimeout(readyTimeout);
                    try { worker.terminate(); } catch (_) {}
                    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
                    reject(new Error(errMsg));
                    return;
                }
                void appendLog(rec.id, 'ERROR', 'worker', errMsg);
            };

            worker.onmessage = (ev) => {
                const msg = ev && ev.data;
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'worker:ready') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(readyTimeout);
                        resolve({ worker, blobUrl });
                    }
                    return;
                }
                if (msg.type === 'worker:boot-error') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(readyTimeout);
                        try { worker.terminate(); } catch (_) {}
                        if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
                        const e = new Error(msg.error || 'Worker boot error');
                        e.isPluginCodeError = true;
                        reject(e);
                    }
                    return;
                }
                if (msg.type === 'worker:uncaught') {
                    void appendLog(rec.id, 'ERROR', 'uncaught', msg.error || 'Uncaught error');
                    return;
                }
                if (msg.type === 'host:rpc') {
                    void handleWorkerRpc(rec, msg);
                    return;
                }
                if (msg.type === 'worker:reply') {
                    const p = rec.pendingCalls.get(msg.callId);
                    if (!p) return;
                    rec.pendingCalls.delete(msg.callId);
                    clearTimeout(p.timer);
                    if (msg.ok) {
                        p.resolve(msg.result);
                    } else {
                        const err = new Error(msg.error || 'Plugin call failed');
                        if (msg.code) err.code = msg.code;
                        if (msg.stack) err.stack = msg.stack;
                        p.reject(err);
                    }
                }
            };
        });

        return tryUrl('blob').catch((blobErr) => {
            if (blobErr && blobErr.isPluginCodeError) throw blobErr;
            return tryUrl('data').catch((dataErr) => {
                if (dataErr && dataErr.isPluginCodeError) throw dataErr;
                const e = new Error('沙箱不可用 (Worker 被页面策略阻止)');
                e.code = 'E_SANDBOX_UNAVAILABLE';
                e.cause = { blobErr: blobErr && blobErr.message, dataErr: dataErr && dataErr.message };
                throw e;
            });
        });
    }

    function callWorker(rec, payload, timeoutMs) {
        if (!rec.worker) {
            return Promise.reject(new Error('Sandbox worker is not running'));
        }
        const effectiveTimeout = Math.max(200, Number(timeoutMs) || registry.settings.executionTimeoutMs || 2500);
        return new Promise((resolve, reject) => {
            const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            const timer = setTimeout(() => {
                rec.pendingCalls.delete(callId);
                terminateWorker(rec);
                rec.state = 'ERROR';
                rec.banner = null;
                rec.lastError = `执行超时 (${effectiveTimeout}ms)，已强制终止沙箱线程 (worker.terminate)`;
                void appendLog(rec.id, 'ERROR', 'isolation', `Worker terminated after ${effectiveTimeout}ms timeout`);
                const timeoutErr = new Error(rec.lastError);
                timeoutErr.code = 'E_EXECUTION_TIMEOUT';
                reject(timeoutErr);
                renderPluginCenter();
            }, effectiveTimeout);

            rec.pendingCalls.set(callId, { resolve, reject, timer });
            rec.worker.postMessage({ type: 'host:call', callId, ...payload });
        });
    }

    async function loadPackageStateFromDisk(rec) {
        const defaults = rec.manifest && rec.manifest.configSchema
            ? defaultsFromSchema(rec.manifest.configSchema)
            : {};
        let diskState = null;
        if (hakimiHost && typeof hakimiHost.readState === 'function') {
            try {
                diskState = await hakimiHost.readState('config', rec.id);
            } catch (_) {}
        }
        if (isPlainObject(diskState) && isPlainObject(diskState.config)) {
            const merged = { ...defaults, ...diskState.config };
            const check = rec.manifest ? validateConfigBySchema(rec.manifest.configSchema, merged) : { ok: true, normalized: merged };
            rec.config = check.ok ? check.normalized : defaults;
            rec.storage = isPlainObject(diskState.storage) ? { ...diskState.storage } : {};
        } else {
            rec.config = defaults;
            rec.storage = {};
            if (hakimiHost && typeof hakimiHost.writeState === 'function') {
                await hakimiHost.writeState('config', rec.id, { config: rec.config, storage: rec.storage });
            }
        }
    }

    async function activatePackagePlugin(id) {
        const rec = packageRecords.get(id);
        if (!rec) throw new Error('Plugin not installed: ' + id);
        if (!rec.valid) {
            rec.state = 'ERROR';
            rec.lastError = 'Manifest 无效: ' + (rec.error || '校验失败');
            await appendLog(id, 'ERROR', 'activate', rec.lastError);
            return { ok: false, error: rec.lastError };
        }
        if (!rec.compat || !rec.compat.compatible) {
            rec.state = 'ERROR';
            rec.lastError = (rec.compat && rec.compat.reasons.join('; ')) || '兼容性校验失败';
            await appendLog(id, 'ERROR', 'activate', rec.lastError);
            return { ok: false, error: rec.lastError };
        }
        if (!hakimiHost || typeof hakimiHost.readPackageEntry !== 'function') {
            rec.state = 'ERROR';
            rec.lastError = '缺少 readPackageEntry IPC';
            return { ok: false, error: rec.lastError };
        }

        terminateWorker(rec);
        rec.state = 'ACTIVATING';
        rec.lastError = null;
        rec.banner = null;
        renderPluginCenter();

        try {
            await loadPackageStateFromDisk(rec);
            const entryRes = await hakimiHost.readPackageEntry(id, rec.manifest.entry);
            if (!entryRes || !entryRes.ok || typeof entryRes.code !== 'string') {
                throw new Error((entryRes && entryRes.error) || '读取插件入口失败');
            }
            const bootstrap = buildWorkerBootstrap(id, entryRes.code);
            const spawned = await spawnSandboxWorker(rec, bootstrap);
            rec.worker = spawned.worker;
            rec.blobUrl = spawned.blobUrl;

            await callWorker(rec, { method: 'activate', config: { ...rec.config } }, registry.settings.executionTimeoutMs);
            rec.state = 'ACTIVE';
            rec.lastError = null;
            await appendLog(id, 'INFO', 'lifecycle', 'Plugin activated in Web Worker sandbox');
            renderPluginCenter();
            return { ok: true };
        } catch (err) {
            terminateWorker(rec);
            rec.state = 'ERROR';
            rec.banner = null;
            rec.lastError = err && err.message ? err.message : String(err);
            await appendLog(id, 'ERROR', 'activate', rec.lastError);
            renderPluginCenter();
            return { ok: false, error: rec.lastError, code: err && err.code };
        }
    }

    async function deactivatePackagePlugin(id) {
        const rec = packageRecords.get(id);
        if (!rec) return { ok: true };
        if (rec.worker) {
            rec.state = 'DEACTIVATING';
            renderPluginCenter();
            try {
                await callWorker(rec, { method: 'deactivate' }, 1000);
            } catch (_) {}
            terminateWorker(rec);
        }
        rec.banner = null;
        rec.state = 'DISABLED';
        await appendLog(id, 'INFO', 'lifecycle', 'Plugin deactivated and worker terminated');
        renderPluginCenter();
        return { ok: true };
    }

    // -------------------------------------------------------------------------
    // Public Host Operations
    // -------------------------------------------------------------------------
    async function discoverAll() {
        if (!hakimiHost) return { repo: [], installed: [], legacy: Array.from(legacyRecords.values()) };

        if (typeof hakimiHost.getHostInfo === 'function') {
            try {
                const info = await hakimiHost.getHostInfo();
                if (info) hostInfo = info;
            } catch (_) {}
        }

        const repoRaw = typeof hakimiHost.listPackages === 'function' ? await hakimiHost.listPackages('repo') : [];
        const instRaw = typeof hakimiHost.listPackages === 'function' ? await hakimiHost.listPackages('installed') : [];

        repoRecords.clear();
        for (const item of (Array.isArray(repoRaw) ? repoRaw : [])) {
            let valid = !!item.valid;
            let error = item.error || null;
            let compat = { compatible: false, reasons: ['Manifest 未通过校验'] };
            if (valid && item.manifest) {
                const mRes = validateManifest(item.manifest, item.id);
                if (!mRes.valid) {
                    valid = false;
                    error = mRes.errors.join('; ');
                } else {
                    compat = checkCompatibility(item.manifest.compatibility, { ...hostInfo, hostVersion: HOST_VERSION });
                }
            }
            repoRecords.set(item.id, {
                id: item.id,
                manifest: item.manifest,
                valid,
                error,
                compat,
            });
        }

        const seenInstalled = new Set();
        for (const item of (Array.isArray(instRaw) ? instRaw : [])) {
            seenInstalled.add(item.id);
            let valid = !!item.valid;
            let error = item.error || null;
            let compat = { compatible: false, reasons: ['Manifest 未通过校验'] };
            if (valid && item.manifest) {
                const mRes = validateManifest(item.manifest, item.id);
                if (!mRes.valid) {
                    valid = false;
                    error = mRes.errors.join('; ');
                } else {
                    compat = checkCompatibility(item.manifest.compatibility, { ...hostInfo, hostVersion: HOST_VERSION });
                }
            }
            const existing = packageRecords.get(item.id);
            if (existing) {
                existing.manifest = item.manifest;
                existing.valid = valid;
                existing.error = error;
                existing.compat = compat;
            } else {
                packageRecords.set(item.id, {
                    id: item.id,
                    manifest: item.manifest,
                    valid,
                    error,
                    compat,
                    state: 'DISABLED',
                    lastError: error,
                    worker: null,
                    blobUrl: null,
                    pendingCalls: new Map(),
                    banner: null,
                    lastActionResult: null,
                    config: item.manifest ? defaultsFromSchema(item.manifest.configSchema) : {},
                    storage: {},
                    deniedCount: 0,
                });
            }
        }
        for (const [id, rec] of Array.from(packageRecords.entries())) {
            if (!seenInstalled.has(id)) {
                terminateWorker(rec);
                packageRecords.delete(id);
            }
        }

        renderPluginCenter();
        return {
            repo: Array.from(repoRecords.values()),
            installed: Array.from(packageRecords.values()),
            legacy: Array.from(legacyRecords.values()),
        };
    }

    async function installPlugin(id) {
        const repoEntry = repoRecords.get(id);
        if (repoEntry) {
            if (!repoEntry.valid) {
                return { ok: false, error: 'Manifest 校验失败: ' + (repoEntry.error || '格式非法') };
            }
            if (!repoEntry.compat || !repoEntry.compat.compatible) {
                return { ok: false, error: '版本不兼容: ' + (repoEntry.compat ? repoEntry.compat.reasons.join('; ') : '') };
            }
        }
        if (!hakimiHost || typeof hakimiHost.installPackage !== 'function') {
            return { ok: false, error: 'installPackage IPC unavailable' };
        }
        const res = await hakimiHost.installPackage(id);
        if (!res || !res.ok) {
            return { ok: false, error: (res && res.error) || '安装失败' };
        }
        const autoEnable = !!registry.settings.autoEnableOnInstall;
        registry.plugins[id] = {
            type: 'package',
            enabled: autoEnable,
            version: res.manifest && res.manifest.version ? res.manifest.version : '1.0.0',
            installedAt: nowStamp(),
        };
        await persistRegistry();
        await discoverAll();
        const rec = packageRecords.get(id);
        if (rec) {
            await loadPackageStateFromDisk(rec);
            await appendLog(id, 'INFO', 'install', `Installed from local repo (autoEnable=${autoEnable})`);
            if (autoEnable) {
                await activatePackagePlugin(id);
            }
        }
        renderPluginCenter();
        return { ok: true, manifest: res.manifest };
    }

    async function uninstallPlugin(id) {
        if (legacyRecords.has(id) || id === 'hakimi-i18n' || id === 'ai-sidedock') {
            return { ok: false, error: '核心内置 (不可卸载)' };
        }
        const rec = packageRecords.get(id);
        if (rec) {
            if (rec.worker || rec.state === 'ACTIVE' || rec.state === 'ACTIVATING') {
                await deactivatePackagePlugin(id);
            } else {
                terminateWorker(rec);
            }
        }
        if (!hakimiHost || typeof hakimiHost.uninstallPackage !== 'function') {
            return { ok: false, error: 'uninstallPackage IPC unavailable' };
        }
        const res = await hakimiHost.uninstallPackage(id);
        if (!res || !res.ok) {
            return { ok: false, error: (res && res.error) || '卸载失败' };
        }
        delete registry.plugins[id];
        await persistRegistry();
        if (typeof hakimiHost.writeState === 'function') {
            try { await hakimiHost.writeState('config', id, null); } catch (_) {}
        }
        await appendLog(id, 'INFO', 'uninstall', 'Package uninstalled and config removed');
        packageRecords.delete(id);
        if (uiState.detailPluginId === id) {
            uiState.detailPluginId = null;
        }
        await discoverAll();
        return { ok: true };
    }

    async function enablePlugin(id) {
        if (legacyRecords.has(id)) {
            const rec = legacyRecords.get(id);
            registry.plugins[id] = { type: 'legacy', enabled: true, updatedAt: nowStamp() };
            await persistRegistry();
            if (rec.pluginObj && typeof rec.pluginObj.init === 'function') {
                try {
                    rec.pluginObj.init(window.HakimiPluginHost.config);
                    rec.state = 'ACTIVE';
                    rec.lastError = null;
                    rec.pendingReload = false;
                    await appendLog(id, 'INFO', 'legacy', 'Legacy plugin enabled live');
                } catch (err) {
                    rec.state = 'ERROR';
                    rec.lastError = err && err.message ? err.message : String(err);
                    await appendLog(id, 'ERROR', 'legacy', 'Live enable failed: ' + rec.lastError);
                    renderPluginCenter();
                    return { ok: false, error: rec.lastError };
                }
            } else {
                rec.pendingReload = true;
            }
            renderPluginCenter();
            return { ok: true, pendingReload: rec.pendingReload };
        }

        if (!packageRecords.has(id)) {
            await discoverAll();
        }
        registry.plugins[id] = {
            ...(registry.plugins[id] || { type: 'package' }),
            type: 'package',
            enabled: true,
            updatedAt: nowStamp(),
        };
        await persistRegistry();
        return await activatePackagePlugin(id);
    }

    async function disablePlugin(id) {
        if (legacyRecords.has(id)) {
            const rec = legacyRecords.get(id);
            registry.plugins[id] = { type: 'legacy', enabled: false, updatedAt: nowStamp() };
            await persistRegistry();
            const td = runVerifiedLegacyTeardown(id);
            rec.state = 'DISABLED';
            rec.lastError = null;
            rec.pendingReload = !td.complete;
            await appendLog(id, 'INFO', 'legacy', td.complete ? 'Legacy plugin disabled live' : 'Legacy plugin disabled (partial teardown; full unload on reload)');
            renderPluginCenter();
            return { ok: true, pendingReload: rec.pendingReload };
        }

        registry.plugins[id] = {
            ...(registry.plugins[id] || { type: 'package' }),
            type: 'package',
            enabled: false,
            updatedAt: nowStamp(),
        };
        await persistRegistry();
        return await deactivatePackagePlugin(id);
    }

    async function reloadPlugin(id) {
        if (legacyRecords.has(id)) {
            const rec = legacyRecords.get(id);
            const enabled = isLegacyEnabledInRegistry(id);
            runVerifiedLegacyTeardown(id);
            if (enabled && rec.pluginObj && typeof rec.pluginObj.init === 'function') {
                try {
                    rec.pluginObj.init(window.HakimiPluginHost.config);
                    rec.state = 'ACTIVE';
                    rec.lastError = null;
                    rec.pendingReload = false;
                    await appendLog(id, 'INFO', 'legacy', 'Legacy plugin reloaded');
                } catch (err) {
                    rec.state = 'ERROR';
                    rec.lastError = err && err.message ? err.message : String(err);
                    renderPluginCenter();
                    return { ok: false, error: rec.lastError };
                }
            } else {
                rec.state = 'DISABLED';
                rec.pendingReload = !enabled && !rec.liveDisableSupported;
            }
            renderPluginCenter();
            return { ok: true };
        }

        await discoverAll();
        const rec = packageRecords.get(id);
        if (!rec) return { ok: false, error: 'Plugin not installed: ' + id };
        if (rec.worker) {
            try { await callWorker(rec, { method: 'deactivate' }, 1000); } catch (_) {}
            terminateWorker(rec);
        }
        await loadPackageStateFromDisk(rec);
        const enabled = registry.plugins[id] ? registry.plugins[id].enabled === true : false;
        if (!enabled) {
            rec.state = 'DISABLED';
            rec.banner = null;
            renderPluginCenter();
            return { ok: true };
        }
        return await activatePackagePlugin(id);
    }

    async function invokePlugin(id, actionId, payload) {
        const rec = packageRecords.get(id);
        if (!rec) {
            return { ok: false, error: 'Plugin not installed or is legacy: ' + id };
        }
        if (rec.state !== 'ACTIVE' || !rec.worker) {
            return { ok: false, error: `插件当前状态为 ${rec.state}，仅 ACTIVE 状态可调用动作` };
        }
        await appendLog(id, 'INFO', 'invoke', `Invoking action "${actionId}"`);
        try {
            const result = await callWorker(rec, { method: 'invoke', actionId, payload: payload || {} }, registry.settings.executionTimeoutMs);
            rec.lastActionResult = { ok: true, actionId, result, timestamp: nowStamp() };
            await appendLog(id, 'INFO', 'invoke', `Action "${actionId}" succeeded: ${JSON.stringify(result)}`);
            refreshDetailPanelsIfActive(id);
            return { ok: true, result };
        } catch (err) {
            const errMsg = err && err.message ? err.message : String(err);
            rec.lastActionResult = {
                ok: false,
                actionId,
                code: (err && err.code) || 'E_PLUGIN_THROW',
                error: errMsg,
                timestamp: nowStamp(),
            };
            await appendLog(id, 'ERROR', 'invoke', `Action "${actionId}" failed: ${errMsg}`);
            refreshDetailPanelsIfActive(id);
            return { ok: false, code: rec.lastActionResult.code, error: errMsg };
        }
    }

    async function getPluginConfig(id) {
        if (legacyRecords.has(id)) {
            const rec = legacyRecords.get(id);
            const hostCfg = window.HakimiPluginHost && window.HakimiPluginHost.config ? window.HakimiPluginHost.config : {};
            return { readOnly: true, values: hostCfg[rec.configSection] || {} };
        }
        const rec = packageRecords.get(id);
        if (!rec) return null;
        await loadPackageStateFromDisk(rec);
        return { readOnly: false, values: { ...(rec.config || {}) }, storage: { ...(rec.storage || {}) } };
    }

    async function savePluginConfig(id, rawValues) {
        if (legacyRecords.has(id)) {
            return { ok: false, error: '内置主世界插件配置在插件中心为只读（不写 plugins/config.json）' };
        }
        const rec = packageRecords.get(id);
        if (!rec || !rec.manifest) {
            return { ok: false, error: 'Plugin not installed: ' + id };
        }
        const check = validateConfigBySchema(rec.manifest.configSchema, rawValues);
        if (!check.ok) {
            return { ok: false, errors: check.errors };
        }
        rec.config = check.normalized;
        if (hakimiHost && typeof hakimiHost.writeState === 'function') {
            await hakimiHost.writeState('config', id, { config: rec.config, storage: rec.storage || {} });
        }
        await appendLog(id, 'INFO', 'config', 'Configuration saved: ' + JSON.stringify(rec.config));
        if (rec.state === 'ACTIVE' && rec.worker) {
            try {
                await callWorker(rec, { method: 'onConfigChange', config: { ...rec.config } }, registry.settings.executionTimeoutMs);
            } catch (err) {
                await appendLog(id, 'ERROR', 'onConfigChange', err && err.message ? err.message : String(err));
            }
        }
        renderPluginCenter();
        return { ok: true, config: { ...rec.config } };
    }

    async function resetPluginConfig(id) {
        if (legacyRecords.has(id)) {
            return { ok: false, error: '内置主世界插件配置在插件中心为只读' };
        }
        const rec = packageRecords.get(id);
        if (!rec || !rec.manifest) {
            return { ok: false, error: 'Plugin not installed: ' + id };
        }
        const defaults = defaultsFromSchema(rec.manifest.configSchema);
        return await savePluginConfig(id, defaults);
    }

    async function getPluginLogs(id) {
        if (!hakimiHost || typeof hakimiHost.readState !== 'function') return '';
        try {
            const raw = await hakimiHost.readState('log', id);
            if (!raw) return '';
            const limit = Number(registry.settings.logRetentionLines) || 200;
            const lines = raw.split(/\r?\n/).filter(Boolean);
            return lines.slice(-limit).join('\n');
        } catch (_) {
            return '';
        }
    }

    async function clearPluginLogs(id) {
        if (!hakimiHost || typeof hakimiHost.writeState !== 'function') return false;
        try {
            await hakimiHost.writeState('clear-log', id, '');
            return true;
        } catch (_) {
            return false;
        }
    }

    async function saveSettings(newSettings) {
        const timeoutMs = Number(newSettings.executionTimeoutMs);
        const logLines = Number(newSettings.logRetentionLines);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) {
            return { ok: false, error: '沙箱执行超时阈值必须为 500 ~ 15000 ms 的整数' };
        }
        if (!Number.isInteger(logLines) || logLines < 20 || logLines > 2000) {
            return { ok: false, error: '日志保留行数必须为 20 ~ 2000 的整数' };
        }
        registry.settings = {
            executionTimeoutMs: timeoutMs,
            logRetentionLines: logLines,
            autoEnableOnInstall: Boolean(newSettings.autoEnableOnInstall),
            showTriggerPill: newSettings.showTriggerPill !== false,
        };
        await persistRegistry();
        syncTriggerVisibility();
        return { ok: true, settings: { ...registry.settings } };
    }

    async function resetSettings() {
        registry.settings = { ...DEFAULT_SETTINGS };
        await persistRegistry();
        syncTriggerVisibility();
        return { ok: true, settings: { ...registry.settings } };
    }

    function getState(pluginId) {
        if (pluginId) {
            if (legacyRecords.has(pluginId)) {
                const r = legacyRecords.get(pluginId);
                return {
                    id: r.id,
                    isLegacy: true,
                    state: r.state,
                    lastError: r.lastError,
                    pendingReload: r.pendingReload,
                    version: r.version,
                };
            }
            const p = packageRecords.get(pluginId);
            if (!p) return null;
            return {
                id: p.id,
                isLegacy: false,
                state: p.state,
                lastError: p.lastError,
                valid: p.valid,
                compat: p.compat,
                deniedCount: p.deniedCount || 0,
                banner: p.banner,
                lastActionResult: p.lastActionResult,
                config: p.config ? { ...p.config } : {},
                storage: p.storage ? { ...p.storage } : {},
            };
        }
        const pkgs = {};
        for (const [id, p] of packageRecords.entries()) {
            pkgs[id] = getState(id);
        }
        const leg = {};
        for (const [id] of legacyRecords.entries()) {
            leg[id] = getState(id);
        }
        return {
            version: HOST_VERSION,
            hostInfo: { ...hostInfo },
            settings: { ...registry.settings },
            legacy: leg,
            packages: pkgs,
            repo: Array.from(repoRecords.values()).map(r => ({
                id: r.id,
                valid: r.valid,
                error: r.error,
                compat: r.compat,
                version: r.manifest ? r.manifest.version : null,
            })),
        };
    }

    // -------------------------------------------------------------------------
    // AGM Hub UI v2.1 — sidebar-native entry + in-place page layer
    // Replaces the v2.0 floating pill + fullscreen modal. The pill survives as
    // an opt-in fallback (settings.showTriggerPill, default false).
    // Integration rules: never remove/replace React-owned nodes; only append
    // immune nodes and overlay a fixed layer tracking the native main panel.
    // -------------------------------------------------------------------------
    const HUB_SEL = {
        sidebar: '[role="navigation"][aria-label="Sidebar"]',
        navItems: '[data-testid="sidebar-navigation-items"]',
        mainBody: '[data-main-content-body="true"]',
        sidebarToggle: '[data-testid="sidebar-toggle"]',
        sidebarSearch: '[data-testid="sidebar-search-button"]',
        navigateAway: [
            '#root a[href]',
            '[data-testid="automations-button"]',
            '[data-testid="settings-button"]',
            '[data-testid="conversation-row-sidebar"]',
            '[data-testid="app-icon-new-conversation-button"]',
        ].join(','),
    };
    const NAV_CLS_IDLE_FALLBACK = 'agy-button agy-button-custom inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 flex-grow w-full justify-start select-none font-normal min-w-0 gap-1.5 px-2 rounded-lg py-1.5 bg-transparent text-secondary-foreground hover:bg-sidebar-muted hover:text-foreground';
    const NAV_CLS_ACTIVE_FALLBACK = 'agy-button agy-button-custom inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 flex-grow w-full justify-start select-none font-normal min-w-0 gap-1.5 px-2 rounded-lg py-[5px] border border-border text-foreground bg-sidebar-secondary';
    const HUB_NAV_ID = 'agm-nav-hub';
    const HUB_RAIL_BTN_ID = 'agm-hub-rail-btn';
    const HUB_ROOT_ID = 'agm-hub';

    const ICON_PATHS = {
        plugins: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/><path d="M17 2.9l4.1 4.1-4.1 4.1-4.1-4.1z"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>',
        bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
        chevron: '<path d="M9 6l6 6-6 6"/>',
        sidedock: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M14.5 4.5v15"/>',
        dot: '<circle cx="12" cy="12" r="3.5"/>',
        box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5"/><path d="M12 12v9"/>',
        trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>',
        download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    };
    function svgIcon(name, size) {
        const s = size || 16;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.dot}</svg>`;
    }

    const TILE_PRESETS = {
        'hakimi-i18n': { hue: 252, glyph: '文A' },
        'ai-sidedock': { hue: 199, icon: 'sidedock' },
    };

    // UI extension registries (main-world plugins contribute nav items, pages, detail panels)
    const uiExt = {
        navItems: new Map(),
        pages: new Map(),
        panels: new Map(),
    };
    let mountedPanel = null; // { key, node, def }
    let navClassCache = { idle: null, active: null };
    let hubObserver = null;
    let hubResizeObs = null;
    let hubObservedTarget = null;
    let hubRafPending = false;
    let hubLocationTimer = null;
    let hubLastHref = '';
    let hubDocClickHandler = null;
    let hubWinResizeHandler = null;
    let renderScheduled = false;

    function injectStyles() {
        if (document.getElementById('agm-plugin-center-style')) return;
        const style = document.createElement('style');
        style.id = 'agm-plugin-center-style';
        style.textContent = `
            #agm-plugin-center-trigger {
                position: fixed;
                right: calc(108px + var(--hakimi-dock-offset, 0px));
                bottom: 20px;
                z-index: 99998;
                display: flex;
                align-items: center;
                gap: 6px;
                background: rgba(24, 26, 32, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.12);
                backdrop-filter: blur(12px);
                color: #e5e7eb;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                user-select: none;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
                transition: transform 0.16s, background 0.16s, right 0.16s;
                -webkit-app-region: no-drag;
            }
            #agm-plugin-center-trigger:hover { background: rgba(38, 42, 54, 0.96); transform: translateY(-2px); }
            #agm-pc-toast-container {
                position: fixed;
                top: 48px;
                right: calc(20px + var(--hakimi-dock-offset, 0px));
                z-index: 100001;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            }
            .agm-pc-toast {
                background: var(--card, #131317);
                color: var(--foreground, #fff);
                border: 1px solid color-mix(in srgb, var(--foreground, #fff) 14%, transparent);
                border-radius: 10px;
                padding: 9px 14px;
                font-size: 12px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            }
            .agm-pc-toast-error { border-color: rgba(239, 68, 68, 0.55); color: #fecaca; }
            .agm-pc-toast-warn { border-color: rgba(245, 158, 11, 0.55); color: #fde68a; }

            /* ---------- Sidebar integration ---------- */
            html[data-agm-hub="open"] ${HUB_SEL.navItems} > .border-border:not([data-agm-nav]) {
                border-color: transparent !important;
                background-color: transparent !important;
                color: var(--secondary-foreground) !important;
            }
            [data-agm-nav] .agm-nav-dot {
                margin-left: auto;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #ef4444;
                flex-shrink: 0;
            }
            [data-agm-nav] .agm-nav-dot[hidden] { display: none; }
            [data-agm-nav] .agm-nav-emoji { font-size: 13px; line-height: 16px; width: 16px; text-align: center; }

            /* ---------- Hub layer ---------- */
            #agm-hub {
                --agm-fg: var(--foreground, #fff);
                --agm-bg: var(--background, #070708);
                --agm-card: var(--card, #131317);
                --agm-border: var(--border, rgba(255,255,255,0.06));
                --agm-muted: var(--muted, rgba(255,255,255,0.042));
                --agm-muted-fg: var(--muted-foreground, #87888F);
                --agm-sec: var(--secondary, rgba(255,255,255,0.075));
                --agm-sec-fg: var(--secondary-foreground, #BCBDC6);
                --agm-hover: color-mix(in srgb, var(--agm-fg) 4%, transparent);
                --agm-strong-border: color-mix(in srgb, var(--agm-fg) 16%, transparent);
                position: fixed;
                left: 0; top: 0; width: 0; height: 0;
                z-index: 45;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border-radius: 12px;
                background: var(--agm-bg);
                color: var(--agm-fg);
                font-family: inherit;
                font-size: 13px;
                line-height: 1.45;
                -webkit-app-region: no-drag;
            }
            #agm-hub.agm-hub-enter { animation: agm-hub-in 0.16s ease-out; }
            @keyframes agm-hub-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
            #agm-hub *, #agm-hub *::before, #agm-hub *::after { box-sizing: border-box; }
            #agm-hub button { font-family: inherit; }
            .agm-hub-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
            .agm-hub-inner {
                max-width: 980px;
                margin: 0 auto;
                padding: 28px 32px 56px;
                display: flex;
                flex-direction: column;
                gap: 18px;
            }
            #agm-hub.agm-narrow .agm-hub-inner { padding: 20px 18px 40px; }

            .agm-hub-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
            .agm-hub-head-text { min-width: 0; }
            .agm-hub-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.1px; color: var(--agm-fg); }
            .agm-hub-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--agm-muted-fg); }
            .agm-hub-head-actions { display: flex; gap: 8px; flex-shrink: 0; }

            .agm-btn {
                display: inline-flex; align-items: center; justify-content: center; gap: 6px;
                height: 30px; padding: 0 12px;
                border-radius: 8px;
                border: 1px solid var(--agm-border);
                background: var(--agm-sec);
                color: var(--agm-fg);
                font-size: 12.5px; font-weight: 500;
                cursor: pointer; white-space: nowrap; user-select: none;
                transition: background 0.12s, border-color 0.12s, opacity 0.12s;
            }
            .agm-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--agm-fg) 12%, transparent); }
            .agm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
            .agm-btn-primary { background: var(--agm-fg); color: var(--agm-bg); border-color: transparent; }
            .agm-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--agm-fg) 86%, var(--agm-bg)); }
            .agm-btn-ghost { background: transparent; border-color: transparent; color: var(--agm-sec-fg); }
            .agm-btn-danger { background: transparent; color: #f87171; border-color: rgba(248, 113, 113, 0.28); }
            .agm-btn-danger:hover:not(:disabled) { background: rgba(248, 113, 113, 0.1); }
            .agm-btn-sm { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 7px; }

            .agm-seg {
                display: inline-flex; align-self: flex-start; gap: 2px; padding: 3px;
                border-radius: 10px;
                background: var(--agm-muted);
                border: 1px solid var(--agm-border);
            }
            .agm-seg-item {
                display: inline-flex; align-items: center; gap: 6px;
                height: 28px; padding: 0 14px;
                border: none; border-radius: 7px;
                background: transparent;
                color: var(--agm-muted-fg);
                font-size: 12.5px; font-weight: 500;
                cursor: pointer;
                transition: color 0.12s, background 0.12s;
            }
            .agm-seg-item:hover { color: var(--agm-fg); }
            .agm-seg-item.active {
                background: var(--agm-sec);
                color: var(--agm-fg);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 0 0 1px var(--agm-border);
            }
            .agm-count { font-size: 11px; color: var(--agm-muted-fg); font-variant-numeric: tabular-nums; }

            .agm-hub-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            .agm-search {
                flex: 1; min-width: 200px;
                display: flex; align-items: center; gap: 8px;
                height: 32px; padding: 0 10px;
                border-radius: 8px;
                background: var(--agm-muted);
                border: 1px solid var(--agm-border);
                color: var(--agm-muted-fg);
                cursor: text;
            }
            .agm-search:focus-within { border-color: var(--agm-strong-border); }
            .agm-search input {
                flex: 1; min-width: 0; height: 100%;
                background: transparent; border: none; outline: none;
                color: var(--agm-fg); font: inherit; font-size: 12.5px;
            }
            .agm-search input::placeholder { color: var(--agm-muted-fg); }
            .agm-chips { display: flex; gap: 6px; flex-wrap: wrap; }
            .agm-chip {
                height: 28px; padding: 0 11px;
                border-radius: 999px;
                border: 1px solid var(--agm-border);
                background: transparent;
                color: var(--agm-sec-fg);
                font-size: 12px; cursor: pointer;
                transition: background 0.12s, color 0.12s, border-color 0.12s;
            }
            .agm-chip:hover { color: var(--agm-fg); }
            .agm-chip.active { background: var(--agm-sec); color: var(--agm-fg); border-color: var(--agm-strong-border); }

            .agm-groups { display: flex; flex-direction: column; gap: 20px; }
            .agm-group { display: flex; flex-direction: column; gap: 8px; }
            .agm-group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 4px; }
            .agm-group-title { font-size: 12.5px; font-weight: 600; color: var(--agm-sec-fg); }
            .agm-group-hint { font-size: 11.5px; color: var(--agm-muted-fg); }
            .agm-list {
                display: flex; flex-direction: column;
                border: 1px solid var(--agm-border);
                border-radius: 12px;
                background: var(--agm-card);
                overflow: hidden;
            }
            .agm-row {
                display: flex; align-items: center; gap: 14px;
                padding: 14px 16px;
                outline: none;
                transition: background 0.12s;
            }
            .agm-row[data-pc-op] { cursor: pointer; }
            .agm-row + .agm-row { border-top: 1px solid var(--agm-border); }
            .agm-row[data-pc-op]:hover, .agm-row:focus-visible { background: var(--agm-hover); }
            .agm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            .agm-row-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .agm-row-name { font-size: 13.5px; font-weight: 500; color: var(--agm-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .agm-row-desc { font-size: 12px; color: var(--agm-muted-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .agm-row-desc.agm-error-text { color: #f87171; }
            .agm-row-side { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
            .agm-row-meta { font-size: 11.5px; color: var(--agm-muted-fg); font-variant-numeric: tabular-nums; }
            .agm-row-chev { display: flex; color: var(--agm-muted-fg); opacity: 0.55; }
            #agm-hub.agm-narrow .agm-row-meta { display: none; }

            .agm-tile {
                --h: 220;
                width: 36px; height: 36px; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                border-radius: 10px;
                background: hsl(var(--h) 70% 60% / 0.14);
                color: hsl(var(--h) 90% 76%);
                box-shadow: inset 0 0 0 1px hsl(var(--h) 70% 60% / 0.22);
                font-size: 12.5px; font-weight: 600; letter-spacing: -0.2px;
                user-select: none;
            }
            .agm-tile-lg { width: 52px; height: 52px; border-radius: 14px; font-size: 17px; }

            .agm-tag {
                display: inline-flex; align-items: center; flex-shrink: 0;
                height: 18px; padding: 0 6px;
                border-radius: 5px;
                font-size: 10.5px; font-weight: 500;
                background: color-mix(in srgb, var(--agm-fg) 7%, transparent);
                color: var(--agm-sec-fg);
            }
            .agm-tag-blue { background: rgba(47, 113, 227, 0.16); color: #8cb4f5; }
            .agm-tag-green { background: rgba(34, 197, 94, 0.14); color: #86efac; }
            .agm-tag-red { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
            .agm-tag-amber { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }

            .agm-switch, .agm-switch-input {
                -webkit-appearance: none; appearance: none;
                position: relative; flex-shrink: 0;
                width: 34px; height: 20px; margin: 0; padding: 0;
                border: none; border-radius: 999px;
                background: color-mix(in srgb, var(--agm-fg) 16%, transparent);
                cursor: pointer;
                transition: background 0.15s;
            }
            .agm-switch::after, .agm-switch-input::after {
                content: '';
                position: absolute; top: 2px; left: 2px;
                width: 16px; height: 16px;
                border-radius: 50%;
                background: color-mix(in srgb, var(--agm-fg) 72%, var(--agm-bg));
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
                transition: transform 0.15s, background 0.15s;
            }
            .agm-switch.on, .agm-switch-input:checked { background: var(--agm-fg); }
            .agm-switch.on::after, .agm-switch-input:checked::after { transform: translateX(14px); background: var(--agm-bg); }
            .agm-switch:disabled, .agm-switch-input:disabled { opacity: 0.4; cursor: not-allowed; }
            .agm-switch:focus-visible, .agm-switch-input:focus-visible { outline: 2px solid var(--agm-strong-border); outline-offset: 2px; }

            .agm-note {
                padding: 10px 12px;
                border-radius: 10px;
                font-size: 12px; line-height: 1.55;
                background: var(--agm-muted);
                border: 1px solid var(--agm-border);
                color: var(--agm-sec-fg);
                word-break: break-word;
            }
            .agm-note:empty { display: none; }
            .agm-note-warn { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.24); color: #fcd34d; }
            .agm-note-error { background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.26); color: #fca5a5; }
            .agm-note-ok { background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.24); color: #86efac; }
            .agm-note-info { background: rgba(47, 113, 227, 0.08); border-color: rgba(47, 113, 227, 0.26); color: #a5c4f7; }

            .agm-empty {
                display: flex; flex-direction: column; align-items: center; gap: 8px;
                padding: 48px 16px;
                border: 1px dashed var(--agm-border);
                border-radius: 12px;
                color: var(--agm-muted-fg);
                text-align: center;
            }
            .agm-empty-icon { opacity: 0.5; }
            .agm-empty-title { font-size: 13.5px; font-weight: 500; color: var(--agm-sec-fg); }
            .agm-empty-hint { font-size: 12px; }

            .agm-crumbs { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--agm-muted-fg); }
            .agm-crumbs button {
                background: none; border: none; padding: 2px 6px; border-radius: 6px;
                color: inherit; font-size: inherit; cursor: pointer;
            }
            .agm-crumbs button:hover { color: var(--agm-fg); background: var(--agm-muted); }
            .agm-crumbs .agm-crumb-sep { opacity: 0.5; }
            .agm-crumbs .agm-crumb-cur { color: var(--agm-sec-fg); padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

            .agm-detail-head { display: flex; align-items: flex-start; gap: 16px; }
            .agm-detail-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
            .agm-detail-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 18px; font-weight: 600; color: var(--agm-fg); }
            .agm-detail-meta { font-size: 12px; color: var(--agm-muted-fg); }
            .agm-detail-desc { font-size: 12.5px; color: var(--agm-sec-fg); line-height: 1.6; }
            .agm-detail-actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
            #agm-hub.agm-narrow .agm-detail-head { flex-wrap: wrap; }
            #agm-hub.agm-narrow .agm-detail-actions { width: 100%; justify-content: flex-start; }

            .agm-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--agm-border); overflow-x: auto; scrollbar-width: none; }
            .agm-tab {
                position: relative; flex-shrink: 0;
                height: 36px; padding: 0 12px;
                background: none; border: none;
                color: var(--agm-muted-fg);
                font-size: 13px; cursor: pointer;
                transition: color 0.12s;
            }
            .agm-tab:hover { color: var(--agm-fg); }
            .agm-tab.active { color: var(--agm-fg); font-weight: 500; }
            .agm-tab.active::after {
                content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px;
                height: 2px; border-radius: 2px; background: var(--agm-fg);
            }

            .agm-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
            #agm-hub.agm-narrow .agm-grid { grid-template-columns: minmax(0, 1fr); }
            .agm-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
            .agm-card {
                display: flex; flex-direction: column; gap: 12px;
                padding: 16px;
                border-radius: 12px;
                background: var(--agm-card);
                border: 1px solid var(--agm-border);
                min-width: 0;
            }
            .agm-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--agm-fg); }
            .agm-card-title-text { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
            .agm-card-sub { font-size: 11.5px; font-weight: 400; color: var(--agm-muted-fg); }
            .agm-kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px 12px; margin: 0; font-size: 12px; }
            .agm-kv-wide { grid-template-columns: 120px minmax(0, 1fr); }
            .agm-kv dt { color: var(--agm-muted-fg); }
            .agm-kv dd { margin: 0; color: var(--agm-sec-fg); word-break: break-all; }
            .agm-kv kbd {
                display: inline-block; padding: 1px 6px; border-radius: 5px;
                border: 1px solid var(--agm-border); background: var(--agm-muted);
                font-family: inherit; font-size: 11px; color: var(--agm-sec-fg);
            }
            .agm-path {
                padding: 8px 10px; border-radius: 8px;
                background: var(--agm-muted); border: 1px solid var(--agm-border);
                font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px;
                color: var(--agm-sec-fg); word-break: break-all;
            }
            .agm-perms { display: flex; flex-wrap: wrap; gap: 6px; }
            .agm-perm {
                display: inline-flex; align-items: center; gap: 6px;
                height: 24px; padding: 0 8px;
                border-radius: 6px;
                background: var(--agm-muted); border: 1px solid var(--agm-border);
                font-size: 11.5px; color: var(--agm-sec-fg);
            }
            .agm-perm-risk { font-size: 10.5px; padding: 0 4px; border-radius: 4px; }
            .agm-risk-low { background: rgba(34, 197, 94, 0.14); color: #86efac; }
            .agm-risk-mid { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
            .agm-risk-high { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
            .agm-pre {
                margin: 0; padding: 12px;
                border-radius: 10px;
                background: color-mix(in srgb, var(--agm-bg) 70%, black);
                border: 1px solid var(--agm-border);
                font-family: "JetBrains Mono", Consolas, monospace;
                font-size: 11.5px; line-height: 1.6;
                color: var(--agm-sec-fg);
                white-space: pre-wrap; word-break: break-all;
                max-height: 460px; overflow: auto;
            }

            .agm-form { display: flex; flex-direction: column; }
            .agm-field { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px 0; }
            .agm-field + .agm-field { border-top: 1px solid var(--agm-border); }
            .agm-field:first-child { padding-top: 2px; }
            .agm-field-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .agm-field-label { font-size: 13px; color: var(--agm-fg); }
            .agm-field-key { font-size: 11px; color: var(--agm-muted-fg); font-family: "JetBrains Mono", Consolas, monospace; margin-left: 6px; }
            .agm-field-hint { font-size: 11.5px; color: var(--agm-muted-fg); }
            .agm-field-error { font-size: 11.5px; color: #f87171; }
            .agm-field-error:empty { display: none; }
            .agm-field-control { flex-shrink: 0; width: 240px; display: flex; justify-content: flex-end; }
            #agm-hub.agm-narrow .agm-field { flex-wrap: wrap; }
            #agm-hub.agm-narrow .agm-field-control { width: 100%; justify-content: flex-start; }
            .agm-input, .agm-select {
                width: 100%; height: 32px; padding: 0 10px;
                border-radius: 8px;
                background: var(--agm-muted);
                border: 1px solid var(--agm-border);
                color: var(--agm-fg);
                font: inherit; font-size: 12.5px;
                outline: none;
            }
            .agm-input:focus, .agm-select:focus { border-color: var(--agm-strong-border); }
            .agm-select option { background: var(--agm-card); color: var(--agm-fg); }
            .agm-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
            .agm-actions-end { justify-content: flex-end; }
            .agm-panel-slot { min-width: 0; }
        `;
        document.head.appendChild(style);
    }

    function syncTriggerVisibility() {
        if (!triggerEl) return;
        triggerEl.style.display = registry.settings.showTriggerPill === true ? 'flex' : 'none';
    }

    function mountTriggerPill() {
        injectStyles();
        const existing = document.getElementById('agm-plugin-center-trigger');
        if (existing) existing.remove();
        const pill = document.createElement('div');
        pill.id = 'agm-plugin-center-trigger';
        pill.setAttribute('data-testid', 'plugin-center-trigger');
        pill.title = '打开插件中心 (Ctrl+Shift+M)';
        markImmune(pill);
        pill.innerHTML = '<span>🧩</span><span>插件中心</span>';
        pill.addEventListener('click', () => togglePluginCenter());
        document.body.appendChild(pill);
        triggerEl = pill;
        syncTriggerVisibility();
    }

    // ---------------------------------------------------------------------
    // View-model helpers
    // ---------------------------------------------------------------------
    // Returns a tag tone ('green' | 'red' | 'amber' | '') for tagHtml()/agm-tag-<tone>.
    function stateBadgeClass(state) {
        if (state === 'ACTIVE') return 'green';
        if (state === 'ERROR') return 'red';
        if (state === 'ACTIVATING') return 'amber';
        return '';
    }

    function stateLabel(state) {
        return ({ ACTIVE: '运行中', ACTIVATING: '启动中', DISABLED: '已禁用', ERROR: '异常' })[state] || String(state || '未知');
    }

    function tagHtml(text, tone, extraAttrs) {
        return `<span class="agm-tag ${tone ? 'agm-tag-' + tone : ''}" ${extraAttrs || ''}>${escapeHtml(text)}</span>`;
    }

    function hashHue(s) {
        let h = 0;
        for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return h % 360;
    }

    function initialsOf(name) {
        const parts = String(name || '').split(/[\s_\-.]+/).filter(Boolean);
        if (!parts.length) return '?';
        if (/[\u4e00-\u9fa5]/.test(parts[0][0])) return parts[0][0];
        return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    function tileHtml(id, name, large) {
        const p = TILE_PRESETS[id] || {};
        const hue = typeof p.hue === 'number' ? p.hue : hashHue(id);
        const inner = p.icon ? svgIcon(p.icon, large ? 24 : 18) : escapeHtml(p.glyph || initialsOf(name || id));
        return `<div class="agm-tile ${large ? 'agm-tile-lg' : ''}" style="--h:${hue}" aria-hidden="true">${inner}</div>`;
    }

    function pluginView(rec, isLegacy) {
        const m = (!isLegacy && rec.manifest) || {};
        return {
            id: rec.id,
            isLegacy,
            name: isLegacy ? rec.name : (m.name || rec.id),
            author: isLegacy ? rec.author : (m.author || '-'),
            version: isLegacy ? rec.version : (m.version || '-'),
            desc: isLegacy ? rec.description : (m.description || ''),
            permissions: isLegacy ? (rec.permissions || []) : (m.permissions || []),
            state: rec.state,
            compatOk: isLegacy ? true : !!(rec.valid && rec.compat && rec.compat.compatible),
            pendingReload: !!rec.pendingReload,
            lastError: rec.lastError || null,
        };
    }

    function groupHtml(title, hint, rowsHtml) {
        return `
            <section class="agm-group">
                <div class="agm-group-head"><span class="agm-group-title">${escapeHtml(title)}</span>${hint ? `<span class="agm-group-hint">${escapeHtml(hint)}</span>` : ''}</div>
                <div class="agm-list">${rowsHtml}</div>
            </section>`;
    }

    function emptyStateHtml(title, hint) {
        return `
            <div class="agm-empty">
                <span class="agm-empty-icon">${svgIcon('plugins', 28)}</span>
                <div class="agm-empty-title">${escapeHtml(title)}</div>
                ${hint ? `<div class="agm-empty-hint">${escapeHtml(hint)}</div>` : ''}
            </div>`;
    }

    function sortedPanels(pluginId) {
        const m = uiExt.panels.get(pluginId);
        if (!m) return [];
        return Array.from(m.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    function sortedNavItems() {
        return Array.from(uiExt.navItems.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    // ---------------------------------------------------------------------
    // List view
    // ---------------------------------------------------------------------
    function installedRowHtml(rec, isLegacy) {
        const v = pluginView(rec, isLegacy);
        const eid = escapeHtml(v.id);
        const on = v.state === 'ACTIVE' || v.state === 'ACTIVATING';
        const tags = [isLegacy ? tagHtml('内置') : tagHtml('沙箱', 'blue')];
        if (v.state === 'ERROR') tags.push(tagHtml('异常', 'red'));
        if (v.state === 'ACTIVATING') tags.push(tagHtml('启动中', 'amber'));
        if (!v.compatOk) tags.push(tagHtml('不兼容', 'red', `data-testid="plugin-compat-${eid}"`));
        if (v.pendingReload) tags.push(tagHtml('重载后生效', 'amber'));
        const descText = v.lastError ? v.lastError : (v.desc || '暂无描述');
        return `
            <div class="agm-row" role="button" tabindex="0" data-pc-op="detail" data-plugin-id="${eid}" data-state="${escapeHtml(v.state)}" data-testid="plugin-card-${eid}">
                ${tileHtml(v.id, v.name, false)}
                <div class="agm-row-main">
                    <div class="agm-row-title"><span class="agm-row-name">${escapeHtml(v.name)}</span>${tags.join('')}</div>
                    <div class="agm-row-desc ${v.lastError ? 'agm-error-text' : ''}" title="${escapeHtml(descText)}">${escapeHtml(descText)}</div>
                </div>
                <div class="agm-row-side">
                    <span class="agm-row-meta">v${escapeHtml(v.version)}</span>
                    <button class="agm-switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" title="${on ? '禁用' : '启用'}" data-pc-op="toggle" data-plugin-id="${eid}" data-testid="btn-toggle-${eid}"></button>
                    <span class="agm-row-chev">${svgIcon('chevron', 14)}</span>
                </div>
            </div>`;
    }

    function buildInstalledCardsHtml() {
        const q = uiState.searchInstalled.trim().toLowerCase();
        const f = uiState.filterStatus;
        const match = (rec, isLegacy) => {
            if (f !== 'all' && rec.state !== f) return false;
            if (!q) return true;
            const v = pluginView(rec, isLegacy);
            return [v.id, v.name, v.author, v.desc].join(' ').toLowerCase().includes(q);
        };
        const legacy = Array.from(legacyRecords.values()).filter(r => match(r, true));
        const pkgs = Array.from(packageRecords.values()).filter(r => match(r, false));
        if (!legacy.length && !pkgs.length) {
            const filtered = !!q || f !== 'all';
            return emptyStateHtml(filtered ? '没有匹配的插件' : '还没有安装任何插件', filtered ? '换个关键词或筛选条件试试' : '前往「插件仓库」安装本地插件包');
        }
        let html = '';
        if (legacy.length) html += groupHtml('内置插件', '主世界运行 · 随宿主启动', legacy.map(r => installedRowHtml(r, true)).join(''));
        if (pkgs.length) html += groupHtml('已安装插件', 'Worker 沙箱隔离 · 按权限声明调用', pkgs.map(r => installedRowHtml(r, false)).join(''));
        return html;
    }

    function repoRowHtml(item) {
        const id = item.id;
        const eid = escapeHtml(id);
        const m = item.manifest || {};
        const installed = packageRecords.has(id);
        const compatOk = !!(item.valid && item.compat && item.compat.compatible);
        const canInstall = item.valid && compatOk && !installed;
        const tags = [tagHtml('本地源包', 'blue')];
        if (!item.valid) tags.push(tagHtml('MANIFEST_INVALID', 'red', `data-testid="repo-compat-${eid}"`));
        else if (!compatOk) tags.push(tagHtml('不兼容', 'red', `data-testid="repo-compat-${eid}"`));
        if (installed) tags.push(tagHtml('已安装', 'green'));
        let descText = m.description || '暂无描述';
        let isErr = false;
        if (!item.valid) { descText = item.error || 'Manifest 无效'; isErr = true; }
        else if (!compatOk) { descText = (item.compat && item.compat.reasons && item.compat.reasons.join('; ')) || '版本不兼容'; isErr = true; }
        const actionHtml = installed
            ? `<button class="agm-btn agm-btn-sm" data-pc-op="detail" data-plugin-id="${eid}" data-testid="btn-repo-detail-${eid}">打开</button>`
            : `<button class="agm-btn agm-btn-sm agm-btn-primary" data-pc-op="install" data-plugin-id="${eid}" data-testid="btn-install-${eid}" ${canInstall ? '' : 'disabled'}>${svgIcon('download', 13)}安装</button>`;
        return `
            <div class="agm-row" data-testid="repo-card-${eid}">
                ${tileHtml(id, m.name || id, false)}
                <div class="agm-row-main">
                    <div class="agm-row-title"><span class="agm-row-name">${escapeHtml(m.name || id)}</span>${tags.join('')}</div>
                    <div class="agm-row-desc ${isErr ? 'agm-error-text' : ''}" title="${escapeHtml(descText)}">${escapeHtml(descText)}</div>
                </div>
                <div class="agm-row-side">
                    <span class="agm-row-meta">${escapeHtml(id)} · v${escapeHtml(m.version || '-')}</span>
                    ${actionHtml}
                </div>
            </div>`;
    }

    function buildRepoCardsHtml() {
        const q = uiState.searchRepo.trim().toLowerCase();
        const items = Array.from(repoRecords.values()).filter(item => {
            if (!q) return true;
            const m = item.manifest || {};
            return [item.id, m.name || '', m.author || '', m.description || ''].join(' ').toLowerCase().includes(q);
        });
        if (!items.length) {
            return q
                ? emptyStateHtml('没有匹配的插件包', '换个关键词试试')
                : emptyStateHtml('本地仓库为空', '将插件包放入 plugins\\repo\\ 后点击「刷新本地源」');
        }
        return groupHtml('本地仓库', 'plugins\\repo\\', items.map(repoRowHtml).join(''));
    }

    function settingsFieldHtml(label, hint, controlHtml) {
        return `
            <div class="agm-field">
                <div class="agm-field-text">
                    <span class="agm-field-label">${escapeHtml(label)}</span>
                    ${hint ? `<span class="agm-field-hint">${escapeHtml(hint)}</span>` : ''}
                </div>
                <div class="agm-field-control">${controlHtml}</div>
            </div>`;
    }

    function buildSettingsHtml() {
        const s = registry.settings;
        const fb = uiState.settingsFeedback;
        return `
            <section class="agm-card">
                <div class="agm-card-title"><span class="agm-card-title-text">宿主设置<span class="agm-card-sub">保存至 plugins\\state\\registry.json</span></span></div>
                <div data-testid="settings-feedback" class="agm-note ${fb ? (fb.type === 'error' ? 'agm-note-error' : 'agm-note-ok') : ''}">${fb ? escapeHtml(fb.message) : ''}</div>
                <div class="agm-form">
                    ${settingsFieldHtml('沙箱执行超时 (ms)', '单次沙箱调用的最长等待时间，范围 500 ~ 15000', `<input type="number" class="agm-input" data-testid="setting-timeout-ms" id="agm-setting-timeout" value="${escapeHtml(String(s.executionTimeoutMs))}" />`)}
                    ${settingsFieldHtml('日志显示行数', '详情页「日志」保留显示的行数，范围 20 ~ 2000', `<input type="number" class="agm-input" data-testid="setting-log-retention" id="agm-setting-log-retention" value="${escapeHtml(String(s.logRetentionLines))}" />`)}
                    ${settingsFieldHtml('安装后自动启用', '从本地仓库安装插件后立即启用', `<input type="checkbox" class="agm-switch-input" data-testid="setting-auto-enable" id="agm-setting-auto-enable" ${s.autoEnableOnInstall ? 'checked' : ''} />`)}
                    ${settingsFieldHtml('显示右下角悬浮入口', '旧版「🧩 插件中心」悬浮胶囊；侧边栏入口与 Ctrl+Shift+M 始终可用', `<input type="checkbox" class="agm-switch-input" data-testid="setting-show-pill" id="agm-setting-show-pill" ${s.showTriggerPill === true ? 'checked' : ''} />`)}
                </div>
                <div class="agm-actions agm-actions-end">
                    <button class="agm-btn" id="agm-pc-reset-settings" data-testid="btn-reset-settings" data-pc-op="reset-settings">恢复默认</button>
                    <button class="agm-btn agm-btn-primary" id="agm-pc-save-settings" data-testid="btn-save-settings" data-pc-op="save-settings">保存设置</button>
                </div>
            </section>
            <section class="agm-card" data-testid="host-info-panel">
                <div class="agm-card-title">宿主环境</div>
                <dl class="agm-kv agm-kv-wide">
                    <dt>宿主版本</dt><dd>HakimiPluginHost v${HOST_VERSION} (Socket v${escapeHtml(hostInfo.hostSocketVersion || '2.0.0')})</dd>
                    <dt>应用版本</dt><dd>${escapeHtml(hostInfo.appVersion || '-')}</dd>
                    <dt>Electron / Node</dt><dd>${escapeHtml(hostInfo.electronVersion || '-')} / ${escapeHtml(hostInfo.nodeVersion || '-')}</dd>
                    <dt>远程仓库</dt><dd>未接入（仅本地 plugins\\repo\\）</dd>
                    <dt>插件根目录</dt><dd>${escapeHtml(hostInfo.pluginsDir || '-')}</dd>
                    <dt>状态存储目录</dt><dd>${escapeHtml(hostInfo.pluginsDir ? hostInfo.pluginsDir + '\\state' : '-')}</dd>
                </dl>
            </section>
            <section class="agm-card">
                <div class="agm-card-title">快捷键</div>
                <dl class="agm-kv agm-kv-wide">
                    <dt><kbd>Ctrl+Shift+M</kbd></dt><dd>打开 / 关闭插件中心</dd>
                    <dt><kbd>Esc</kbd></dt><dd>返回上一级；在列表页时关闭插件中心</dd>
                    <dt><kbd>Ctrl+R</kbd></dt><dd>热重载全部插件</dd>
                </dl>
            </section>`;
    }

    function buildListHtml() {
        const tab = uiState.activeTab;
        const segs = [
            ['installed', '已安装', legacyRecords.size + packageRecords.size],
            ['repository', '插件仓库', repoRecords.size],
            ['settings', '设置', null],
        ].map(([k, label, count]) => `<button class="agm-seg-item ${tab === k ? 'active' : ''}" role="tab" aria-selected="${tab === k}" data-pc-op="switch-tab" data-tab="${k}" data-testid="tab-${k}">${label}${count !== null ? `<span class="agm-count">${count}</span>` : ''}</button>`).join('');

        let body = '';
        if (tab === 'installed') {
            const chip = (k, label) => `<button class="agm-chip ${uiState.filterStatus === k ? 'active' : ''}" data-pc-op="filter" data-filter="${k}" data-testid="filter-${k === 'all' ? 'all' : k.toLowerCase()}">${label}</button>`;
            body = `
                <div class="agm-hub-toolbar">
                    <label class="agm-search">${svgIcon('search', 14)}<input type="text" id="agm-pc-search" data-testid="installed-search" placeholder="搜索插件名称、ID 或作者" value="${escapeHtml(uiState.searchInstalled)}" /></label>
                    <div class="agm-chips">${chip('all', '全部')}${chip('ACTIVE', '已启用')}${chip('DISABLED', '已禁用')}${chip('ERROR', '异常')}</div>
                </div>
                <div class="agm-groups" id="agm-pc-card-list">${buildInstalledCardsHtml()}</div>`;
        } else if (tab === 'repository') {
            body = `
                <div class="agm-note agm-note-info" data-testid="remote-repo-banner">远程仓库：未接入。当前仅扫描本地插件源目录 plugins\\repo\\，不展示任何伪造的远程数据。</div>
                <div class="agm-hub-toolbar">
                    <label class="agm-search">${svgIcon('search', 14)}<input type="text" data-testid="repo-search" id="agm-repo-search" placeholder="搜索本地仓库插件" value="${escapeHtml(uiState.searchRepo)}" /></label>
                    <button class="agm-btn" id="agm-pc-refresh-repo" data-testid="btn-refresh-repo" data-pc-op="refresh-repo">${svgIcon('refresh', 14)}刷新本地源</button>
                </div>
                <div class="agm-groups" id="agm-repo-card-list">${buildRepoCardsHtml()}</div>`;
        } else {
            body = buildSettingsHtml();
        }

        return `
            <header class="agm-hub-head">
                <div class="agm-hub-head-text">
                    <h1 class="agm-hub-title">插件中心</h1>
                    <p class="agm-hub-sub">管理 Antigravity_Mod 的内置插件与沙箱插件包 · HakimiPluginHost v${HOST_VERSION}</p>
                </div>
                <div class="agm-hub-head-actions">
                    <button class="agm-btn" data-pc-op="refresh-all" data-testid="btn-refresh-all">${svgIcon('refresh', 14)}刷新</button>
                    <button class="agm-btn agm-btn-primary" data-pc-op="reload-all" data-testid="btn-reload-all">${svgIcon('bolt', 14)}热重载全部</button>
                </div>
            </header>
            <div class="agm-seg" role="tablist">${segs}</div>
            ${body}`;
    }

    // ---------------------------------------------------------------------
    // Detail view
    // ---------------------------------------------------------------------
    function detailTabsFor(id, isLegacy, rec) {
        const tabs = sortedPanels(id).map(p => ({ key: 'panel:' + p.id, label: p.title || p.id }));
        const hasPanels = tabs.length > 0;
        tabs.push({ key: 'overview', label: '概览' });
        const schema = !isLegacy && rec.manifest && isPlainObject(rec.manifest.configSchema) ? rec.manifest.configSchema : null;
        if (schema && Object.keys(schema).length) tabs.push({ key: 'config', label: '配置' });
        else if (isLegacy && !hasPanels) tabs.push({ key: 'config', label: '配置' });
        tabs.push({ key: 'logs', label: '日志' });
        return tabs;
    }

    function resolveDetailTab(tabs) {
        const want = uiState.detailTab;
        if (want && tabs.some(t => t.key === want)) return want;
        if (want && !want.startsWith('panel:') && tabs.some(t => t.key === 'panel:' + want)) return 'panel:' + want;
        return tabs[0].key;
    }

    function permissionChipsHtml(permissions) {
        if (!permissions.length) return '<span class="agm-field-hint">无声明权限</span>';
        return permissions.map(p => {
            const cat = PERMISSIONS_CATALOG[p];
            const riskCls = cat ? ({ '低': 'agm-risk-low', '中': 'agm-risk-mid', '高': 'agm-risk-high' })[cat.risk] || '' : '';
            const title = cat ? `${cat.title} · ${cat.description}` : p;
            return `<span class="agm-perm" title="${escapeHtml(title)}">${escapeHtml(p)}${cat ? `<span class="agm-perm-risk ${riskCls}">${escapeHtml(cat.risk)}</span>` : ''}</span>`;
        }).join('');
    }

    function buildOverviewTabHtml(id, isLegacy, rec, v) {
        const compatText = isLegacy
            ? `兼容 ✓（内置主世界插件 · 应用 v${escapeHtml(hostInfo.appVersion)}）`
            : (rec.compat && rec.compat.compatible
                ? `兼容 ✓（app ${escapeHtml(rec.manifest.compatibility.appVersion)} vs ${escapeHtml(hostInfo.appVersion)}，host ${escapeHtml(rec.manifest.compatibility.hostVersion)} vs ${HOST_VERSION}）`
                : `不兼容 ✗（${escapeHtml((rec.compat && rec.compat.reasons.join('; ')) || rec.error || '未知原因')}）`);
        const actions = !isLegacy && rec.manifest && Array.isArray(rec.manifest.actions) ? rec.manifest.actions : [];
        const ar = uiState.actionResult;
        const actionsHtml = actions.length ? `
            <div class="agm-card-sub">插件动作</div>
            <div class="agm-actions">
                ${actions.map(a => `<button class="agm-btn agm-btn-sm" title="${escapeHtml(a.description || '')}" data-testid="detail-action-${escapeHtml(a.id)}" data-pc-op="invoke-action" data-plugin-id="${escapeHtml(id)}" data-action-id="${escapeHtml(a.id)}" ${rec.state === 'ACTIVE' ? '' : 'disabled'}>${escapeHtml(a.label)}</button>`).join('')}
            </div>
            <div id="agm-detail-action-result" data-testid="detail-action-result" class="agm-note ${ar ? (ar.ok ? 'agm-note-ok' : 'agm-note-error') : ''}">${ar ? escapeHtml(JSON.stringify(ar)) : '尚未调用动作'}</div>` : '';
        const bannerHtml = !isLegacy && rec.banner && rec.banner.text
            ? `<div class="agm-note agm-note-info" data-testid="detail-plugin-banner">${escapeHtml(rec.banner.text)}</div>`
            : '';
        const pluginsDir = hostInfo.pluginsDir || 'plugins';
        const configLoc = isLegacy
            ? `${pluginsDir}\\config.json › "${rec.configSection || id}"`
            : `${pluginsDir}\\state\\configs\\`;
        return `
            <div class="agm-grid">
                <div class="agm-col">
                    <section class="agm-card" data-testid="detail-meta-card">
                        <div class="agm-card-title">运行状态</div>
                        <dl class="agm-kv">
                            <dt>状态</dt><dd>${tagHtml(stateLabel(rec.state), stateBadgeClass(rec.state), 'data-testid="detail-runtime-state"')}${rec.pendingReload ? ' ' + tagHtml('重载后生效', 'amber') : ''}</dd>
                            <dt>兼容性</dt><dd data-testid="detail-compat-status">${compatText}</dd>
                        </dl>
                        ${v.lastError ? `<div class="agm-note agm-note-error" data-testid="detail-last-error">${escapeHtml(v.lastError)}</div>` : ''}
                        ${bannerHtml}
                        ${actionsHtml}
                    </section>
                    <section class="agm-card" data-testid="detail-permissions-panel">
                        <div class="agm-card-title">
                            <span>权限声明</span>
                            <span class="agm-tag ${rec.deniedCount > 0 ? 'agm-tag-red' : ''}" data-testid="detail-denied-count">越权拦截 ${rec.deniedCount || 0} 次</span>
                        </div>
                        <div class="agm-perms">${permissionChipsHtml(v.permissions)}</div>
                    </section>
                </div>
                <aside class="agm-col">
                    <section class="agm-card">
                        <div class="agm-card-title">插件信息</div>
                        <dl class="agm-kv">
                            <dt>名称</dt><dd>${escapeHtml(v.name)}</dd>
                            <dt>ID</dt><dd>${escapeHtml(id)}</dd>
                            <dt>版本</dt><dd>v${escapeHtml(v.version)}</dd>
                            <dt>作者</dt><dd>${escapeHtml(v.author)}</dd>
                            <dt>运行环境</dt><dd>${isLegacy ? '主世界（无沙箱隔离）' : 'Web Worker 沙箱'}</dd>
                        </dl>
                    </section>
                    <section class="agm-card">
                        <div class="agm-card-title">数据位置</div>
                        <div class="agm-card-sub">配置</div>
                        <div class="agm-path">${escapeHtml(configLoc)}</div>
                        <div class="agm-card-sub">日志</div>
                        <div class="agm-path">${escapeHtml(pluginsDir + '\\state\\logs\\' + id + '.log')}</div>
                    </section>
                </aside>
            </div>`;
    }

    function schemaFieldHtml(key, field) {
        const val = Object.prototype.hasOwnProperty.call(uiState.draftConfig, key) ? uiState.draftConfig[key] : field.default;
        const err = uiState.formErrors[key] || '';
        const ek = escapeHtml(key);
        let controlHtml = '';
        if (field.type === 'boolean') {
            controlHtml = `<input type="checkbox" class="agm-switch-input agm-schema-input" data-key="${ek}" data-testid="config-input-${ek}" ${val ? 'checked' : ''} />`;
        } else if (field.type === 'string') {
            controlHtml = `<input type="text" class="agm-input agm-schema-input" data-key="${ek}" data-testid="config-input-${ek}" value="${escapeHtml(val == null ? '' : val)}" />`;
        } else if (field.type === 'number') {
            const numDisplay = (typeof val === 'number' && Number.isFinite(val)) ? String(val) : (typeof val === 'string' ? val : '');
            controlHtml = `<input type="number" class="agm-input agm-schema-input" data-key="${ek}" data-testid="config-input-${ek}" value="${escapeHtml(numDisplay)}" />`;
        } else if (field.type === 'enum') {
            const opts = normalizeEnumOptions(field.options);
            controlHtml = `<select class="agm-select agm-schema-input" data-key="${ek}" data-testid="config-input-${ek}">
                ${opts.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === val ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>`;
        }
        const hints = [];
        if (field.required) hints.push('必填');
        if (field.type === 'string') {
            if (field.minLength !== undefined) hints.push(`最短 ${field.minLength}`);
            if (field.maxLength !== undefined) hints.push(`最长 ${field.maxLength}`);
            if (field.pattern) hints.push(`格式 ${field.pattern}`);
        }
        if (field.type === 'number') {
            if (field.min !== undefined) hints.push(`最小 ${field.min}`);
            if (field.max !== undefined) hints.push(`最大 ${field.max}`);
            if (field.integer) hints.push('整数');
        }
        const hintText = [field.description || '', hints.join(' · ')].filter(Boolean).join(' — ');
        return `
            <div class="agm-field">
                <div class="agm-field-text">
                    <label class="agm-field-label">${escapeHtml(field.title || key)}<span class="agm-field-key">${ek}</span></label>
                    ${hintText ? `<span class="agm-field-hint">${escapeHtml(hintText)}</span>` : ''}
                    <span class="agm-field-error" data-error-for="${ek}" data-testid="config-error-${ek}">${escapeHtml(err)}</span>
                </div>
                <div class="agm-field-control">${controlHtml}</div>
            </div>`;
    }

    function buildConfigTabHtml(id, isLegacy, rec) {
        if (isLegacy) {
            const hostCfg = window.HakimiPluginHost && window.HakimiPluginHost.config ? window.HakimiPluginHost.config : {};
            const sectionVal = hostCfg[rec.configSection] || {};
            const hint = rec.hasOwnConfigUI
                ? (rec.state === 'ACTIVE' ? '插件尚未向插件中心注册配置面板，请尝试「重载」该插件。' : '启用插件后，可在此直接编辑其配置。')
                : '该内置插件没有独立的配置界面，相关选项可在插件自身的界面中调整。';
            return `
                <section class="agm-card" data-testid="detail-legacy-config-readonly">
                    <div class="agm-card-title"><span class="agm-card-title-text">当前配置<span class="agm-card-sub">只读 · plugins\\config.json › "${escapeHtml(rec.configSection || id)}"</span></span></div>
                    <div class="agm-note">${escapeHtml(hint)}</div>
                    <pre class="agm-pre">${escapeHtml(JSON.stringify(sectionVal, null, 2))}</pre>
                </section>`;
        }
        const schema = rec.manifest.configSchema;
        const fb = uiState.formFeedback;
        return `
            <section class="agm-card" id="agm-detail-schema-form" data-testid="detail-config-form">
                <div class="agm-card-title"><span class="agm-card-title-text">插件配置<span class="agm-card-sub">由 configSchema 自动生成 · 保存前校验</span></span></div>
                <div id="agm-detail-form-feedback" data-testid="detail-config-feedback" class="agm-note ${fb ? (fb.type === 'error' ? 'agm-note-error' : 'agm-note-ok') : ''}">${fb ? escapeHtml(fb.message) : ''}</div>
                <div class="agm-form">${Object.entries(schema).map(([k, f]) => schemaFieldHtml(k, f)).join('')}</div>
                <div class="agm-actions agm-actions-end">
                    <button class="agm-btn" id="agm-btn-reset-config" data-testid="btn-reset-config" data-pc-op="reset-config" data-plugin-id="${escapeHtml(id)}">恢复默认</button>
                    <button class="agm-btn agm-btn-primary" id="agm-btn-save-config" data-testid="btn-save-config" data-pc-op="save-config" data-plugin-id="${escapeHtml(id)}">保存</button>
                </div>
            </section>`;
    }

    function buildLogsTabHtml(id) {
        return `
            <section class="agm-card" data-testid="detail-logs-panel">
                <div class="agm-card-title">
                    <span class="agm-card-title-text">运行日志<span class="agm-card-sub">plugins\\state\\logs\\${escapeHtml(id)}.log</span></span>
                    <span class="agm-actions">
                        <button class="agm-btn agm-btn-sm" data-testid="btn-refresh-logs" data-pc-op="refresh-logs" data-plugin-id="${escapeHtml(id)}">${svgIcon('refresh', 13)}刷新</button>
                        <button class="agm-btn agm-btn-sm agm-btn-ghost" data-testid="btn-clear-logs" data-pc-op="clear-logs" data-plugin-id="${escapeHtml(id)}">清空</button>
                    </span>
                </div>
                <pre class="agm-pre" id="agm-detail-logs" data-testid="detail-logs-content">${escapeHtml(uiState.logsText || '(暂无日志)')}</pre>
            </section>`;
    }

    function buildDetailHtml(id) {
        const isLegacy = legacyRecords.has(id);
        const rec = isLegacy ? legacyRecords.get(id) : packageRecords.get(id);
        const fromTab = uiState.activeTab === 'repository' ? '插件仓库' : '已安装';
        if (!rec) {
            return `
                <nav class="agm-crumbs"><button data-pc-op="back-to-list" data-testid="btn-detail-back">插件中心</button><span class="agm-crumb-sep">/</span><button data-pc-op="back-to-list">${fromTab}</button></nav>
                <div class="agm-note agm-note-error">未找到插件 "${escapeHtml(id)}"。</div>`;
        }
        const v = pluginView(rec, isLegacy);
        const isEnabled = rec.state === 'ACTIVE' || rec.state === 'ACTIVATING';
        const tabs = detailTabsFor(id, isLegacy, rec);
        const cur = resolveDetailTab(tabs);
        uiState.detailTab = cur;

        const tags = [isLegacy ? tagHtml('内置 · 主世界') : tagHtml('Worker 沙箱', 'blue')];
        tags.push(tagHtml(stateLabel(rec.state), stateBadgeClass(rec.state)));
        if (!v.compatOk) tags.push(tagHtml('不兼容', 'red'));

        let tabBody = '';
        if (cur.startsWith('panel:')) {
            tabBody = `<div class="agm-panel-slot" data-agm-panel-slot="panel:${escapeHtml(id)}:${escapeHtml(cur.slice(6))}"></div>`;
        } else if (cur === 'config') {
            tabBody = buildConfigTabHtml(id, isLegacy, rec);
        } else if (cur === 'logs') {
            tabBody = buildLogsTabHtml(id);
        } else {
            tabBody = buildOverviewTabHtml(id, isLegacy, rec, v);
        }

        return `
            <nav class="agm-crumbs">
                <button data-pc-op="back-to-list" data-testid="btn-detail-back">插件中心</button>
                <span class="agm-crumb-sep">/</span>
                <button data-pc-op="back-to-list">${fromTab}</button>
                <span class="agm-crumb-sep">/</span>
                <span class="agm-crumb-cur">${escapeHtml(v.name)}</span>
            </nav>
            <header class="agm-detail-head">
                ${tileHtml(id, v.name, true)}
                <div class="agm-detail-id">
                    <div class="agm-detail-name"><span>${escapeHtml(v.name)}</span>${tags.join('')}</div>
                    <div class="agm-detail-meta">${escapeHtml(id)} · v${escapeHtml(v.version)} · ${escapeHtml(v.author)}</div>
                    ${v.desc ? `<div class="agm-detail-desc">${escapeHtml(v.desc)}</div>` : ''}
                </div>
                <div class="agm-detail-actions">
                    <button class="agm-btn" data-testid="detail-btn-reload" data-pc-op="reload" data-plugin-id="${escapeHtml(id)}">${svgIcon('refresh', 14)}重载</button>
                    <button class="agm-btn ${isEnabled ? '' : 'agm-btn-primary'}" data-testid="detail-btn-toggle" data-pc-op="toggle" data-plugin-id="${escapeHtml(id)}">${isEnabled ? '禁用' : '启用'}</button>
                    ${isLegacy ? '' : `<button class="agm-btn agm-btn-danger" data-testid="detail-btn-uninstall" data-pc-op="uninstall" data-plugin-id="${escapeHtml(id)}">${svgIcon('trash', 14)}卸载</button>`}
                </div>
            </header>
            <div class="agm-tabs" role="tablist">
                ${tabs.map(t => `<button class="agm-tab ${t.key === cur ? 'active' : ''}" role="tab" aria-selected="${t.key === cur}" data-pc-op="detail-tab" data-tab="${escapeHtml(t.key)}" data-testid="detail-tab-${escapeHtml(t.key.replace(':', '-'))}">${escapeHtml(t.label)}</button>`).join('')}
            </div>
            <div data-testid="plugin-detail-view">${tabBody}</div>`;
    }

    function buildPageHtml(pageId) {
        const def = uiExt.pages.get(pageId);
        if (!def) return emptyStateHtml('页面不可用', '提供该页面的插件可能已被禁用或卸载');
        return `
            <header class="agm-hub-head">
                <div class="agm-hub-head-text">
                    <h1 class="agm-hub-title">${escapeHtml(def.title || pageId)}</h1>
                    ${def.subtitle ? `<p class="agm-hub-sub">${escapeHtml(def.subtitle)}</p>` : ''}
                </div>
            </header>
            <div class="agm-panel-slot" data-agm-panel-slot="page:${escapeHtml(pageId)}"></div>`;
    }

    // ---------------------------------------------------------------------
    // Rendering core (with focus / scroll / contributed-panel preservation)
    // ---------------------------------------------------------------------
    function currentViewKey() {
        if (uiState.pageId) return 'page:' + uiState.pageId;
        if (uiState.detailPluginId) return 'detail:' + uiState.detailPluginId + ':' + (uiState.detailTab || '');
        return 'list:' + uiState.activeTab;
    }

    function resolvePanelDef(key) {
        if (key.startsWith('page:')) return uiExt.pages.get(key.slice(5)) || null;
        if (key.startsWith('panel:')) {
            const rest = key.slice(6);
            const sep = rest.indexOf(':');
            if (sep < 0) return null;
            const m = uiExt.panels.get(rest.slice(0, sep));
            return m ? (m.get(rest.slice(sep + 1)) || null) : null;
        }
        return null;
    }

    function teardownMountedPanel() {
        if (!mountedPanel) return;
        const { node, def } = mountedPanel;
        mountedPanel = null;
        try {
            if (def && typeof def.onLeave === 'function') def.onLeave(node);
        } catch (e) {
            console.warn('[AGMPluginHost] panel onLeave error:', e);
        }
        try { node.remove(); } catch (_) {}
    }

    function mountPanelSlot() {
        const slot = overlayEl ? overlayEl.querySelector('[data-agm-panel-slot]') : null;
        const key = slot ? slot.getAttribute('data-agm-panel-slot') : null;
        if (!key) {
            teardownMountedPanel();
            return;
        }
        if (mountedPanel && mountedPanel.key === key) {
            slot.appendChild(mountedPanel.node);
            return;
        }
        teardownMountedPanel();
        const def = resolvePanelDef(key);
        if (!def) {
            slot.innerHTML = '<div class="agm-note agm-note-error">该面板当前不可用。</div>';
            return;
        }
        const node = document.createElement('div');
        node.className = 'agm-panel-host';
        markImmune(node);
        slot.appendChild(node);
        mountedPanel = { key, node, def };
        try {
            def.render(node, { host: window.HakimiPluginHost, close: closePluginCenter, back: backToList });
        } catch (e) {
            console.error('[AGMPluginHost] panel render error:', e);
            node.innerHTML = `<div class="agm-note agm-note-error">面板渲染失败：${escapeHtml(e && e.message ? e.message : String(e))}</div>`;
        }
    }

    function renderPluginCenter() {
        if (!uiState.isOpen || !overlayEl) return;
        renderScheduled = false;

        const active = document.activeElement;
        let focusTestId = null;
        let selStart = null;
        let selEnd = null;
        const keepNode = mountedPanel ? mountedPanel.node : null;
        const focusInPanel = !!(keepNode && active && keepNode.contains(active));
        if (active && overlayEl.contains(active) && !focusInPanel) {
            focusTestId = active.getAttribute('data-testid');
            if (typeof active.selectionStart === 'number') {
                selStart = active.selectionStart;
                selEnd = active.selectionEnd;
            }
        }
        const prevView = overlayEl.getAttribute('data-view');
        const prevScroller = overlayEl.querySelector('.agm-hub-scroll');
        const prevScroll = prevScroller ? prevScroller.scrollTop : 0;
        if (keepNode && keepNode.parentNode) keepNode.parentNode.removeChild(keepNode);

        let html;
        if (uiState.pageId) html = buildPageHtml(uiState.pageId);
        else if (uiState.detailPluginId) html = buildDetailHtml(uiState.detailPluginId);
        else html = buildListHtml();

        const viewKey = currentViewKey();
        overlayEl.setAttribute('data-view', viewKey);
        overlayEl.innerHTML = `<div class="agm-hub-scroll"><div class="agm-hub-inner">${html}</div></div>`;
        mountPanelSlot();

        const scroller = overlayEl.querySelector('.agm-hub-scroll');
        if (scroller && prevView === viewKey) scroller.scrollTop = prevScroll;
        if (focusInPanel && active && active.isConnected) {
            try { active.focus({ preventScroll: true }); } catch (_) {}
        } else if (focusTestId) {
            const el = overlayEl.querySelector(`[data-testid="${CSS.escape(focusTestId)}"]`);
            if (el) {
                try {
                    el.focus({ preventScroll: true });
                    if (selStart !== null && typeof el.setSelectionRange === 'function') el.setSelectionRange(selStart, selEnd);
                } catch (_) {}
            }
        }
        updateNavIndicators();
    }

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        Promise.resolve().then(() => {
            if (renderScheduled) renderPluginCenter();
            renderScheduled = false;
        });
    }

    function refreshDetailPanelsIfActive(pluginId) {
        if (!uiState.isOpen || !overlayEl || uiState.detailPluginId !== pluginId) return;
        renderPluginCenter();
    }

    function updateDraftFromDom() {
        if (!overlayEl || !uiState.detailPluginId) return;
        const rec = packageRecords.get(uiState.detailPluginId);
        if (!rec || !rec.manifest || !rec.manifest.configSchema) return;
        const schema = rec.manifest.configSchema;
        overlayEl.querySelectorAll('.agm-schema-input').forEach(el => {
            const key = el.getAttribute('data-key');
            const field = schema[key];
            if (!key || !field) return;
            if (field.type === 'boolean') {
                uiState.draftConfig[key] = Boolean(el.checked);
            } else if (field.type === 'number') {
                const raw = String(el.value).trim();
                uiState.draftConfig[key] = raw === '' ? NaN : Number(raw);
            } else {
                uiState.draftConfig[key] = String(el.value);
            }
        });
    }

    function updateFormErrorsDom() {
        if (!overlayEl) return;
        overlayEl.querySelectorAll('[data-error-for]').forEach(el => {
            const key = el.getAttribute('data-error-for');
            el.textContent = uiState.formErrors[key] || '';
        });
        const fb = overlayEl.querySelector('#agm-detail-form-feedback');
        if (fb) {
            if (uiState.formFeedback) {
                fb.className = `agm-note ${uiState.formFeedback.type === 'error' ? 'agm-note-error' : 'agm-note-ok'}`;
                fb.textContent = uiState.formFeedback.message;
            } else {
                fb.className = 'agm-note';
                fb.textContent = '';
            }
        }
    }

    async function openDetailView(id, tab) {
        uiState.pageId = null;
        uiState.detailPluginId = id;
        uiState.detailTab = tab || '';
        uiState.formErrors = {};
        uiState.formFeedback = null;
        uiState.actionResult = null;
        uiState.logsText = '';
        const rec = packageRecords.get(id);
        if (rec) uiState.draftConfig = { ...(rec.config || {}) };
        renderPluginCenter(); // paint immediately; refine after async state loads
        if (rec) {
            await loadPackageStateFromDisk(rec);
            uiState.draftConfig = { ...(rec.config || {}) };
            uiState.actionResult = rec.lastActionResult || null;
        } else {
            uiState.draftConfig = {};
        }
        uiState.logsText = await getPluginLogs(id);
        renderPluginCenter();
    }

    function backToList() {
        uiState.detailPluginId = null;
        uiState.detailTab = '';
        uiState.pageId = null;
        renderPluginCenter();
        ensureSidebarEntries();
    }

    async function handleModalClick(ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-pc-op]') : null;
        if (!btn || !overlayEl || !overlayEl.contains(btn) || btn.disabled) return;
        const op = btn.getAttribute('data-pc-op');
        const pluginId = btn.getAttribute('data-plugin-id');

        if (op === 'close') {
            closePluginCenter();
        } else if (op === 'switch-tab') {
            uiState.detailPluginId = null;
            uiState.pageId = null;
            uiState.activeTab = btn.getAttribute('data-tab') || 'installed';
            renderPluginCenter();
            if (uiState.activeTab === 'repository' || uiState.activeTab === 'installed') {
                await discoverAll();
                renderPluginCenter();
            }
        } else if (op === 'filter') {
            uiState.filterStatus = btn.getAttribute('data-filter') || 'all';
            renderPluginCenter();
        } else if (op === 'refresh-all') {
            await discoverAll();
            renderPluginCenter();
            showToast('插件中心', '插件列表已刷新');
        } else if (op === 'reload-all') {
            window.HakimiPluginHost.reloadPlugins();
        } else if (op === 'refresh-repo') {
            await discoverAll();
            renderPluginCenter();
        } else if (op === 'install') {
            const res = await installPlugin(pluginId);
            if (!res.ok) showToast(pluginId, res.error || '安装失败', 'error');
            renderPluginCenter();
        } else if (op === 'uninstall') {
            const res = await uninstallPlugin(pluginId);
            if (!res.ok) showToast(pluginId, res.error || '卸载失败', 'error');
            renderPluginCenter();
        } else if (op === 'toggle') {
            const isLegacy = legacyRecords.has(pluginId);
            const rec = isLegacy ? legacyRecords.get(pluginId) : packageRecords.get(pluginId);
            const isActive = rec && (rec.state === 'ACTIVE' || rec.state === 'ACTIVATING');
            const res = isActive ? await disablePlugin(pluginId) : await enablePlugin(pluginId);
            if (res && !res.ok && res.error) showToast(pluginId, res.error, 'error');
            if (uiState.detailPluginId === pluginId) {
                uiState.logsText = await getPluginLogs(pluginId);
            }
            renderPluginCenter();
        } else if (op === 'reload') {
            await reloadPlugin(pluginId);
            if (uiState.detailPluginId === pluginId) {
                const rec = packageRecords.get(pluginId);
                if (rec) uiState.draftConfig = { ...(rec.config || {}) };
                uiState.logsText = await getPluginLogs(pluginId);
            }
            renderPluginCenter();
            showToast(pluginId, '已重载');
        } else if (op === 'detail') {
            await openDetailView(pluginId);
        } else if (op === 'detail-tab') {
            uiState.detailTab = btn.getAttribute('data-tab') || 'overview';
            if (uiState.detailTab === 'logs' && uiState.detailPluginId) {
                uiState.logsText = await getPluginLogs(uiState.detailPluginId);
            }
            renderPluginCenter();
        } else if (op === 'back-to-list') {
            backToList();
        } else if (op === 'invoke-first') {
            const rec = packageRecords.get(pluginId);
            const firstAction = rec && rec.manifest && Array.isArray(rec.manifest.actions) && rec.manifest.actions[0];
            if (firstAction) {
                await invokePlugin(pluginId, firstAction.id, {});
            }
        } else if (op === 'invoke-action') {
            const actionId = btn.getAttribute('data-action-id');
            uiState.actionResult = await invokePlugin(pluginId, actionId, {});
            uiState.logsText = await getPluginLogs(pluginId);
            renderPluginCenter();
        } else if (op === 'save-config') {
            updateDraftFromDom();
            const res = await savePluginConfig(pluginId, uiState.draftConfig);
            if (!res.ok) {
                uiState.formErrors = res.errors || {};
                uiState.formFeedback = { type: 'error', message: res.error || '配置校验失败，未写入磁盘' };
                updateFormErrorsDom();
            } else {
                uiState.formErrors = {};
                uiState.draftConfig = { ...res.config };
                uiState.formFeedback = { type: 'ok', message: '配置已校验并保存' };
                uiState.logsText = await getPluginLogs(pluginId);
                renderPluginCenter();
            }
        } else if (op === 'reset-config') {
            const res = await resetPluginConfig(pluginId);
            if (res.ok) {
                uiState.formErrors = {};
                uiState.draftConfig = { ...res.config };
                uiState.formFeedback = { type: 'ok', message: '已恢复为 Schema 默认配置' };
                uiState.logsText = await getPluginLogs(pluginId);
            } else {
                uiState.formFeedback = { type: 'error', message: res.error || '重置失败' };
            }
            renderPluginCenter();
        } else if (op === 'refresh-logs') {
            uiState.logsText = await getPluginLogs(pluginId);
            renderPluginCenter();
        } else if (op === 'clear-logs') {
            await clearPluginLogs(pluginId);
            uiState.logsText = '';
            renderPluginCenter();
        } else if (op === 'open-legacy-ui') {
            const panels = sortedPanels(pluginId);
            if (panels.length) {
                uiState.detailTab = 'panel:' + panels[0].id;
                renderPluginCenter();
            } else if (pluginId === 'hakimi-i18n' && window.__HAKIMI_I18N__ && typeof window.__HAKIMI_I18N__.toggleUI === 'function') {
                closePluginCenter();
                window.__HAKIMI_I18N__.toggleUI();
            }
        } else if (op === 'save-settings') {
            const timeoutEl = overlayEl.querySelector('#agm-setting-timeout');
            const logEl = overlayEl.querySelector('#agm-setting-log-retention');
            const autoEl = overlayEl.querySelector('#agm-setting-auto-enable');
            const pillEl = overlayEl.querySelector('#agm-setting-show-pill');
            const res = await saveSettings({
                executionTimeoutMs: Number(timeoutEl ? timeoutEl.value : 2500),
                logRetentionLines: Number(logEl ? logEl.value : 200),
                autoEnableOnInstall: Boolean(autoEl && autoEl.checked),
                showTriggerPill: Boolean(pillEl && pillEl.checked),
            });
            uiState.settingsFeedback = res.ok
                ? { type: 'ok', message: '宿主设置已保存至 plugins\\state\\registry.json' }
                : { type: 'error', message: res.error || '保存设置失败' };
            renderPluginCenter();
        } else if (op === 'reset-settings') {
            await resetSettings();
            uiState.settingsFeedback = { type: 'ok', message: '宿主设置已恢复为默认值' };
            renderPluginCenter();
        }
    }

    function handleModalInput(ev) {
        const target = ev.target;
        if (!target || !overlayEl) return;
        if (mountedPanel && mountedPanel.node.contains(target)) return;
        const testId = target.getAttribute('data-testid');
        if (testId === 'installed-search') {
            uiState.searchInstalled = target.value || '';
            const list = overlayEl.querySelector('#agm-pc-card-list');
            if (list) list.innerHTML = buildInstalledCardsHtml();
            return;
        }
        if (testId === 'repo-search') {
            uiState.searchRepo = target.value || '';
            const list = overlayEl.querySelector('#agm-repo-card-list');
            if (list) list.innerHTML = buildRepoCardsHtml();
            return;
        }
        if (target.classList && target.classList.contains('agm-schema-input')) {
            updateDraftFromDom();
            const rec = packageRecords.get(uiState.detailPluginId);
            if (rec && rec.manifest && rec.manifest.configSchema) {
                const check = validateConfigBySchema(rec.manifest.configSchema, uiState.draftConfig);
                uiState.formErrors = check.errors || {};
                uiState.formFeedback = null;
                updateFormErrorsDom();
            }
        }
    }

    function handleHubKeydown(ev) {
        const t = ev.target;
        if ((ev.key === 'Enter' || ev.key === ' ') && t && t.classList && t.classList.contains('agm-row') && t.hasAttribute('data-pc-op')) {
            ev.preventDefault();
            t.click();
        }
    }

    // ---------------------------------------------------------------------
    // Hub layer geometry & lifecycle
    // ---------------------------------------------------------------------
    function ensureHubRoot() {
        if (overlayEl && overlayEl.isConnected) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.id = HUB_ROOT_ID;
        overlayEl.className = 'agm-hub-enter';
        overlayEl.setAttribute('data-testid', 'plugin-center-overlay');
        overlayEl.setAttribute('role', 'region');
        overlayEl.setAttribute('aria-label', '插件中心');
        markImmune(overlayEl);
        overlayEl.addEventListener('click', (e) => { void handleModalClick(e); });
        overlayEl.addEventListener('input', handleModalInput);
        overlayEl.addEventListener('change', handleModalInput);
        overlayEl.addEventListener('keydown', handleHubKeydown);
        overlayEl.addEventListener('animationend', () => { if (overlayEl) overlayEl.classList.remove('agm-hub-enter'); }, { once: true });
        document.body.appendChild(overlayEl);
        return overlayEl;
    }

    function findMainTarget() {
        let best = null;
        let bestArea = 0;
        document.querySelectorAll(HUB_SEL.mainBody).forEach(el => {
            if (overlayEl && overlayEl.contains(el)) return;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            if (r.width > 160 && r.height > 160 && area > bestArea) {
                best = el;
                bestArea = area;
            }
        });
        return best;
    }

    function computeHubRect() {
        const t = findMainTarget();
        if (t) {
            const r = t.getBoundingClientRect();
            return { target: t, left: r.left, top: r.top, width: r.width, height: r.height, radius: getComputedStyle(t).borderRadius || '12px' };
        }
        const sb = document.querySelector(HUB_SEL.sidebar);
        const sr = sb ? sb.getBoundingClientRect() : null;
        const left = sr && sr.width > 0 ? Math.round(sr.right) + 1 : 8;
        const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hakimi-dock-offset')) || 0;
        const top = 75;
        return {
            target: null,
            left,
            top,
            width: Math.max(320, window.innerWidth - left - dock - 8),
            height: Math.max(240, window.innerHeight - top - 8),
            radius: '12px',
        };
    }

    function syncHubGeometry() {
        if (!uiState.isOpen || !overlayEl) return;
        const g = computeHubRect();
        const s = overlayEl.style;
        const px = (n) => Math.round(n) + 'px';
        if (s.left !== px(g.left)) s.left = px(g.left);
        if (s.top !== px(g.top)) s.top = px(g.top);
        if (s.width !== px(g.width)) s.width = px(g.width);
        if (s.height !== px(g.height)) s.height = px(g.height);
        if (s.borderRadius !== g.radius) s.borderRadius = g.radius;
        overlayEl.classList.toggle('agm-narrow', g.width < 760);
        if (g.target !== hubObservedTarget) {
            if (hubResizeObs) {
                hubResizeObs.disconnect();
                if (g.target) hubResizeObs.observe(g.target);
            }
            hubObservedTarget = g.target;
        }
    }

    function startLocationWatch() {
        stopLocationWatch();
        hubLastHref = location.href;
        hubLocationTimer = setInterval(() => {
            if (uiState.isOpen && location.href !== hubLastHref) closePluginCenter();
        }, 400);
    }

    function stopLocationWatch() {
        if (hubLocationTimer) {
            clearInterval(hubLocationTimer);
            hubLocationTimer = null;
        }
    }

    function showHubLayer() {
        injectStyles();
        uiState.isOpen = true;
        ensureHubRoot();
        document.documentElement.setAttribute('data-agm-hub', 'open');
        syncHubGeometry();
        startLocationWatch();
    }

    async function openPluginCenter(tab, pluginId, detailTab) {
        if (tab) uiState.activeTab = tab;
        uiState.pageId = null;
        showHubLayer();
        if (pluginId) {
            if (!legacyRecords.has(pluginId) && !packageRecords.has(pluginId)) await discoverAll();
            if (!uiState.isOpen) return;
            await openDetailView(pluginId, detailTab);
        } else {
            uiState.detailPluginId = null;
            uiState.detailTab = '';
            renderPluginCenter();
            ensureSidebarEntries();
            await discoverAll();
            if (uiState.isOpen) renderPluginCenter();
        }
        ensureSidebarEntries();
    }

    async function openPluginDetail(pluginId, detailTab) {
        return openPluginCenter(null, pluginId, detailTab);
    }

    function openPage(pageId) {
        if (!uiExt.pages.has(pageId)) return false;
        uiState.detailPluginId = null;
        uiState.detailTab = '';
        uiState.pageId = pageId;
        showHubLayer();
        renderPluginCenter();
        ensureSidebarEntries();
        return true;
    }

    function closePluginCenter() {
        const wasOpen = uiState.isOpen;
        uiState.isOpen = false;
        uiState.pageId = null;
        uiState.detailPluginId = null;
        uiState.detailTab = '';
        teardownMountedPanel();
        if (overlayEl) {
            overlayEl.remove();
            overlayEl = null;
        }
        document.documentElement.removeAttribute('data-agm-hub');
        stopLocationWatch();
        if (hubResizeObs) hubResizeObs.disconnect();
        hubObservedTarget = null;
        if (wasOpen && !isDisposed) ensureSidebarEntries();
    }

    function togglePluginCenter() {
        if (uiState.isOpen) {
            closePluginCenter();
        } else {
            void openPluginCenter();
        }
    }

    // ---------------------------------------------------------------------
    // Sidebar entries (native-styled nav items + collapsed-sidebar rail button)
    // ---------------------------------------------------------------------
    function getNavClasses(nav) {
        if (nav) {
            for (const el of nav.children) {
                if (el.hasAttribute('data-agm-nav')) continue;
                const c = typeof el.className === 'string' ? el.className : '';
                if (!c.includes('agy-button')) continue;
                if (/(^|\s)border-border(\s|$)/.test(c)) {
                    if (!navClassCache.active) navClassCache.active = c;
                } else if (!navClassCache.idle) {
                    navClassCache.idle = c;
                }
            }
        }
        return {
            idle: navClassCache.idle || NAV_CLS_IDLE_FALLBACK,
            active: navClassCache.active || NAV_CLS_ACTIVE_FALLBACK,
        };
    }

    function normalizeNavIcon(icon) {
        if (typeof icon === 'string') {
            const t = icon.trim();
            if (t.startsWith('<svg')) return t;
            if (t) return `<span class="agm-nav-emoji">${escapeHtml(t)}</span>`;
        }
        return svgIcon('dot', 16);
    }

    function createNavButton(spec) {
        const el = document.createElement('button');
        el.type = 'button';
        el.id = spec.domId;
        el.setAttribute('data-agm-nav', spec.domId);
        markImmune(el);
        el.innerHTML = `<span class="shrink-0 flex items-center">${spec.iconHtml}</span><span class="truncate">${escapeHtml(spec.label)}</span><span class="agm-nav-dot" hidden></span>`;
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const fn = el.__agmOnClick;
            if (typeof fn === 'function') fn();
        });
        return el;
    }

    function ensureSidebarEntries() {
        if (isDisposed) return;
        const nav = document.querySelector(HUB_SEL.navItems);
        if (nav) {
            const cls = getNavClasses(nav);
            const wanted = [{
                domId: HUB_NAV_ID,
                label: '插件中心',
                iconHtml: svgIcon('plugins', 16),
                active: uiState.isOpen && !uiState.pageId,
                onClick: () => {
                    if (uiState.isOpen && !uiState.pageId && !uiState.detailPluginId) return;
                    if (uiState.isOpen) backToList();
                    else void openPluginCenter();
                },
            }];
            for (const item of sortedNavItems()) {
                wanted.push({
                    domId: 'agm-nav-x-' + item.id,
                    label: item.label,
                    iconHtml: normalizeNavIcon(item.icon),
                    active: !!(item.pageId && uiState.isOpen && uiState.pageId === item.pageId),
                    onClick: () => {
                        if (item.pageId) openPage(item.pageId);
                        else if (typeof item.onClick === 'function') {
                            try { item.onClick(); } catch (e) { console.error('[AGMPluginHost] nav item error:', e); }
                        }
                    },
                });
            }
            nav.querySelectorAll(':scope > [data-agm-nav]').forEach(el => {
                if (!wanted.some(w => w.domId === el.id)) el.remove();
            });
            for (const w of wanted) {
                let el = document.getElementById(w.domId);
                if (el && el.parentElement !== nav) {
                    el.remove();
                    el = null;
                }
                if (!el) el = createNavButton(w);
                const c = w.active ? cls.active : cls.idle;
                if (el.className !== c) el.className = c;
                const cur = w.active ? 'page' : 'false';
                if (el.getAttribute('aria-current') !== cur) el.setAttribute('aria-current', cur);
                el.__agmOnClick = w.onClick;
                if (!el.isConnected) nav.appendChild(el);
            }
            // Keep our entries contiguous at the end, in declared order.
            const children = Array.from(nav.children);
            const firstOurs = children.findIndex(el => el.hasAttribute('data-agm-nav'));
            const tail = firstOurs >= 0 ? children.slice(firstOurs) : [];
            const inOrder = tail.length === wanted.length && tail.every((el, i) => el.id === wanted[i].domId);
            if (!inOrder) wanted.forEach(w => { const el = document.getElementById(w.domId); if (el) nav.appendChild(el); });
        }
        ensureRailButton();
        updateNavIndicators();
    }

    function ensureRailButton() {
        const toggle = document.querySelector(HUB_SEL.sidebarToggle);
        const collapsed = !!toggle && toggle.getAttribute('aria-expanded') === 'false';
        const search = document.querySelector(HUB_SEL.sidebarSearch);
        let btn = document.getElementById(HUB_RAIL_BTN_ID);
        if (!collapsed || !search || !search.parentElement) {
            if (btn) btn.remove();
            return;
        }
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = HUB_RAIL_BTN_ID;
            btn.setAttribute('data-agm-nav', 'rail');
            btn.setAttribute('aria-label', '插件中心');
            btn.title = '插件中心 (Ctrl+Shift+M)';
            markImmune(btn);
            btn.innerHTML = svgIcon('plugins', 16);
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                togglePluginCenter();
            });
        }
        const c = typeof search.className === 'string' ? search.className : '';
        if (btn.className !== c) btn.className = c;
        if (btn.parentElement !== search.parentElement || btn.previousElementSibling !== search) {
            search.insertAdjacentElement('afterend', btn);
        }
    }

    function updateNavIndicators() {
        const el = document.getElementById(HUB_NAV_ID);
        if (!el) return;
        const dot = el.querySelector('.agm-nav-dot');
        if (!dot) return;
        let hasError = false;
        for (const r of legacyRecords.values()) if (r.state === 'ERROR') hasError = true;
        for (const r of packageRecords.values()) if (r.state === 'ERROR') hasError = true;
        if (dot.hidden === hasError) dot.hidden = !hasError;
        const title = hasError ? '插件中心 · 有插件运行异常' : '插件中心 (Ctrl+Shift+M)';
        if (el.title !== title) el.title = title;
    }

    function scheduleHubTick() {
        if (hubRafPending || isDisposed) return;
        hubRafPending = true;
        requestAnimationFrame(() => {
            hubRafPending = false;
            if (isDisposed) return;
            ensureSidebarEntries();
            if (uiState.isOpen) {
                syncHubGeometry();
                if (location.href !== hubLastHref) closePluginCenter();
            }
        });
    }

    function startHubIntegration() {
        injectStyles();
        if (!hubObserver) {
            hubObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    const t = m.target;
                    if (overlayEl && (t === overlayEl || overlayEl.contains(t))) continue;
                    if (toastWrapEl && (t === toastWrapEl || toastWrapEl.contains(t))) continue;
                    scheduleHubTick();
                    return;
                }
            });
            hubObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
        }
        if (!hubResizeObs && typeof ResizeObserver === 'function') {
            hubResizeObs = new ResizeObserver(() => scheduleHubTick());
        }
        if (!hubWinResizeHandler) {
            hubWinResizeHandler = () => scheduleHubTick();
            window.addEventListener('resize', hubWinResizeHandler);
        }
        if (!hubDocClickHandler) {
            hubDocClickHandler = (ev) => {
                if (!uiState.isOpen) return;
                const t = ev.target;
                if (!t || !t.closest) return;
                if (t.closest('[data-agm-nav]') || (overlayEl && overlayEl.contains(t))) return;
                if (t.closest(HUB_SEL.navigateAway)) closePluginCenter();
            };
            document.addEventListener('click', hubDocClickHandler, true);
        }
        ensureSidebarEntries();
    }

    function stopHubIntegration() {
        if (hubObserver) {
            hubObserver.disconnect();
            hubObserver = null;
        }
        if (hubResizeObs) {
            hubResizeObs.disconnect();
            hubResizeObs = null;
        }
        if (hubWinResizeHandler) {
            window.removeEventListener('resize', hubWinResizeHandler);
            hubWinResizeHandler = null;
        }
        if (hubDocClickHandler) {
            document.removeEventListener('click', hubDocClickHandler, true);
            hubDocClickHandler = null;
        }
        stopLocationWatch();
        document.querySelectorAll('[data-agm-nav]').forEach(el => {
            try { el.remove(); } catch (_) {}
        });
        document.documentElement.removeAttribute('data-agm-hub');
    }

    function bindShortcuts() {
        if (keydownHandler) {
            window.removeEventListener('keydown', keydownHandler, true);
        }
        keydownHandler = (e) => {
            const key = (e.key || '').toLowerCase();
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === 'm') {
                e.preventDefault();
                e.stopPropagation();
                togglePluginCenter();
            } else if (key === 'escape' && uiState.isOpen && !e.defaultPrevented) {
                // Let native popups (menus / dialogs) and the legacy i18n modal consume Esc first.
                if (document.querySelector('[role="menu"], [role="dialog"], #hakimi-i18n-modal-overlay.active')) return;
                if (uiState.detailPluginId) backToList();
                else closePluginCenter();
            }
        };
        window.addEventListener('keydown', keydownHandler, true);
    }

    // ---------------------------------------------------------------------
    // UI extension API (main-world plugins)
    // ---------------------------------------------------------------------
    const UI_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

    const uiApi = {
        version: '1.0.0',
        open: (opts) => openPluginCenter(opts && opts.tab, opts && opts.pluginId, opts && opts.detailTab),
        close: () => closePluginCenter(),
        toggle: () => togglePluginCenter(),
        isOpen: () => uiState.isOpen,
        openPluginDetail: (pluginId, detailTab) => openPluginDetail(pluginId, detailTab),
        registerNavItem(def) {
            if (!def || !UI_ID_RE.test(String(def.id || '')) || !def.label) throw new Error('registerNavItem: invalid id/label');
            uiExt.navItems.set(def.id, {
                id: def.id,
                label: String(def.label),
                icon: def.icon,
                order: Number(def.order) || 0,
                pageId: def.pageId || null,
                onClick: def.onClick,
            });
            scheduleHubTick();
            return () => uiApi.unregisterNavItem(def.id);
        },
        unregisterNavItem(id) {
            uiExt.navItems.delete(id);
            scheduleHubTick();
        },
        registerPage(def) {
            if (!def || !UI_ID_RE.test(String(def.id || '')) || typeof def.render !== 'function') throw new Error('registerPage: invalid id/render');
            uiExt.pages.set(def.id, { id: def.id, title: def.title || def.id, subtitle: def.subtitle || '', render: def.render, onLeave: def.onLeave });
            return () => uiApi.unregisterPage(def.id);
        },
        unregisterPage(id) {
            uiExt.pages.delete(id);
            if (mountedPanel && mountedPanel.key === 'page:' + id) teardownMountedPanel();
            if (uiState.isOpen && uiState.pageId === id) backToList();
        },
        openPage: (id) => openPage(id),
        registerDetailPanel(pluginId, def) {
            if (!UI_ID_RE.test(String(pluginId || '')) || !def || !UI_ID_RE.test(String(def.id || '')) || typeof def.render !== 'function') {
                throw new Error('registerDetailPanel: invalid pluginId/id/render');
            }
            if (!uiExt.panels.has(pluginId)) uiExt.panels.set(pluginId, new Map());
            uiExt.panels.get(pluginId).set(def.id, { id: def.id, title: def.title || def.id, order: Number(def.order) || 0, render: def.render, onLeave: def.onLeave });
            if (uiState.isOpen && uiState.detailPluginId === pluginId) scheduleRender();
            return () => uiApi.unregisterDetailPanel(pluginId, def.id);
        },
        unregisterDetailPanel(pluginId, panelId) {
            const m = uiExt.panels.get(pluginId);
            if (!m || !m.has(panelId)) return;
            m.delete(panelId);
            if (!m.size) uiExt.panels.delete(pluginId);
            if (mountedPanel && mountedPanel.key === `panel:${pluginId}:${panelId}`) teardownMountedPanel();
            if (uiState.isOpen && uiState.detailPluginId === pluginId) scheduleRender();
        },
    };

    // -------------------------------------------------------------------------
    // Upgrade window.HakimiPluginHost In-Place (v1.1.0 -> v2.0.0)
    // -------------------------------------------------------------------------
    const hostApi = {
        version: HOST_VERSION,
        config: prevHost.config || bootCtx.config || {},
        plugins: prevHost.plugins || {},
        __bootContext: bootCtx,
        register: function (name, pluginObj) {
            this.plugins[name] = pluginObj;
            const rec = getLegacyRecord(name);
            rec.pluginObj = pluginObj;
            if (pluginObj && pluginObj.name) rec.name = pluginObj.name;
            if (pluginObj && pluginObj.version) rec.version = pluginObj.version;

            const enabled = isLegacyEnabledInRegistry(name);
            if (!enabled) {
                runVerifiedLegacyTeardown(name);
                rec.state = 'DISABLED';
                rec.lastError = null;
                rec.pendingReload = false;
                console.log('[HakimiPluginHost] Gated disabled legacy plugin at register():', name);
                void appendLog(name, 'INFO', 'legacy', 'Skipped init at register() because disabled in registry');
                renderPluginCenter();
                return;
            }

            console.log('[HakimiPluginHost] Registered plugin:', name);
            if (pluginObj && typeof pluginObj.init === 'function') {
                try {
                    pluginObj.init(this.config);
                    rec.state = 'ACTIVE';
                    rec.lastError = null;
                    rec.pendingReload = false;
                    void appendLog(name, 'INFO', 'legacy', 'Legacy plugin initialized at register()');
                } catch (e) {
                    rec.state = 'ERROR';
                    rec.lastError = e && e.message ? e.message : String(e);
                    console.error('[HakimiPluginHost] Init failed in ' + name, e);
                    void appendLog(name, 'ERROR', 'legacy', 'Init failed: ' + rec.lastError);
                }
            } else {
                rec.state = 'ACTIVE';
            }
            renderPluginCenter();
        },
        reloadPlugins: function () {
            window.dispatchEvent(new CustomEvent('hakimi:reload-plugins'));
        },
        reload: function () {
            window.location.reload();
        },
        // v2 Extensions
        getState,
        discoverAll,
        installPlugin,
        uninstallPlugin,
        enablePlugin,
        disablePlugin,
        reloadPlugin,
        invokePlugin,
        getPluginConfig,
        savePluginConfig,
        resetPluginConfig,
        getPluginLogs,
        clearPluginLogs,
        getSettings: () => ({ ...registry.settings }),
        saveSettings,
        resetSettings,
        openPluginCenter,
        closePluginCenter,
        togglePluginCenter,
        openPluginDetail,
        ui: uiApi,
        getBanner: (id) => {
            const p = packageRecords.get(id);
            return p ? p.banner : null;
        },
        getToasts: () => toasts.slice(),
        __pure: pureExports,
    };

    window.HakimiPluginHost = hostApi;

    window.__agmHostTeardown = () => {
        isDisposed = true;
        if (keydownHandler) {
            window.removeEventListener('keydown', keydownHandler, true);
            keydownHandler = null;
        }
        for (const rec of packageRecords.values()) {
            terminateWorker(rec);
        }
        closePluginCenter();
        stopHubIntegration();
        if (triggerEl) {
            try { triggerEl.remove(); } catch (_) {}
            triggerEl = null;
        }
        if (toastWrapEl) {
            try { toastWrapEl.remove(); } catch (_) {}
            toastWrapEl = null;
        }
        const styleEl = document.getElementById('agm-plugin-center-style');
        if (styleEl) styleEl.remove();
    };

    // Mount UI pill + shortcuts immediately, then discover & activate enabled packages
    if (document.body) {
        mountTriggerPill();
        startHubIntegration();
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            if (isDisposed) return;
            mountTriggerPill();
            startHubIntegration();
        }, { once: true });
    }
    bindShortcuts();

    discoverPromise = Promise.resolve().then(async () => {
        if (isDisposed) return;
        await discoverAll();
        if (isDisposed) return;
        for (const [id, rec] of packageRecords.entries()) {
            const regEntry = registry.plugins[id];
            const shouldEnable = regEntry ? regEntry.enabled === true : false;
            if (shouldEnable) {
                await activatePackagePlugin(id);
            } else {
                await loadPackageStateFromDisk(rec);
                rec.state = 'DISABLED';
            }
        }
        renderPluginCenter();
        updateNavIndicators();
    });
    hostApi.ready = discoverPromise;
})(typeof globalThis !== 'undefined' ? globalThis : this);
