// =============================================================================
// Hakimi i18n v1.1 - Translation Engine (Multi-stage Waterfall Pipeline)
// =============================================================================
(function(exports) {
    'use strict';

    let DiscoveryLib = null;
    let SanitizerLib = null;

    try {
        if (typeof require === 'function') {
            DiscoveryLib = require('./discovery.js');
            SanitizerLib = require('./sanitizer.js');
        }
    } catch (_) {}

    function getDiscoveryLib() {
        return DiscoveryLib || (typeof window !== 'undefined' && window.__HakimiDiscovery) || null;
    }

    function getSanitizerLib() {
        return SanitizerLib || (typeof window !== 'undefined' && window.__HakimiSanitizer) || null;
    }

    class TranslationEngine {
        constructor(deps = {}) {
            this.config = {
                enabled: true,
                language: 'zh-CN',
                preset: 'full', // 'full', 'basic', 'tech', 'custom'
                scope: {
                    menu: true,
                    settings: true,
                    agent: true,
                    models: true,
                    requests: true,
                    errors: true,
                    native: true,
                    plugins: true
                },
                customOverrides: {},
                exclusions: [],
                glossary: {}
            };

            // Dictionaries
            this.officialExact = {};
            this.officialPrefix = {};
            this.officialRegex = [];
            this.officialCore = {};
            this.menuMap = {};

            // O(1) Fast Indexes
            this.officialNormDict = new Map();
            this.officialLowerDict = new Map();
            this.overrideNormDict = new Map();
            this.overrideLowerDict = new Map();
            this.glossaryNormDict = new Map();
            this.glossaryLowerDict = new Map();
            this.glossaryLowerSet = new Set();
            this.glossaryEntriesSorted = [];
            this.exclusionSet = new Set();
            this.prefixList = [];
            this.regexCompiled = [];

            // Performance Caches
            this.positiveCache = new Map(); // rawText -> translatedText
            this.negativeCache = new Set(); // rawText -> null

            // Untranslated UI Copy Discovery Engine (v1.1)
            const DLib = deps.DiscoveryLib || getDiscoveryLib();
            if (deps.discovery) {
                this.discovery = deps.discovery;
            } else if (DLib && typeof DLib.UntranslatedDiscovery === 'function') {
                this.discovery = new DLib.UntranslatedDiscovery({ maxRecords: 500 });
            } else {
                this.discovery = null;
            }
            this.sanitizer = deps.sanitizer || getSanitizerLib();

            // Backward-compatible map facade
            this.untranslatedLogs = this.discovery ? this.discovery.records : new Map();
            this.maxUntranslated = 500;
        }

        // Set official dictionary data
        loadOfficialData(data) {
            this.officialExact = data.exact || {};
            this.officialPrefix = data.prefix || {};
            this.officialRegex = data.regex || [];
            this.officialCore = data.core || {};
            this.menuMap = data.menu || {};

            this.rebuildIndexes();
            this.clearCache();
        }

        // Update active configuration
        updateConfig(newConfig) {
            if (!newConfig) return;
            this.config = {
                ...this.config,
                ...newConfig,
                scope: { ...this.config.scope, ...(newConfig.scope || {}) },
                customOverrides: newConfig.customOverrides !== undefined
                    ? { ...newConfig.customOverrides }
                    : { ...this.config.customOverrides },
                exclusions: newConfig.exclusions !== undefined
                    ? Array.from(new Set(newConfig.exclusions))
                    : Array.from(new Set(this.config.exclusions || [])),
                glossary: newConfig.glossary !== undefined
                    ? { ...newConfig.glossary }
                    : { ...this.config.glossary }
            };

            this.rebuildIndexes();
            this.clearCache();

            // Purge any newly added DIY or exclusion items from existing discovery candidates
            if (this.discovery) {
                for (const key of Object.keys(this.config.customOverrides)) {
                    this.discovery.remove(key);
                }
                for (const key of Object.keys(this.config.glossary)) {
                    this.discovery.remove(key);
                }
                for (const term of this.config.exclusions) {
                    this.discovery.remove(term);
                }
            }
        }

        // Rebuild fast search indexes
        rebuildIndexes() {
            this.officialNormDict.clear();
            this.officialLowerDict.clear();
            this.overrideNormDict.clear();
            this.overrideLowerDict.clear();
            this.glossaryNormDict.clear();
            this.glossaryLowerDict.clear();
            this.glossaryLowerSet.clear();
            this.glossaryEntriesSorted = [];
            this.exclusionSet.clear();
            this.prefixList = [];
            this.regexCompiled = [];

            // 1. Exclusions
            (this.config.exclusions || []).forEach(term => {
                if (term) this.exclusionSet.add(String(term).trim().toLowerCase());
            });

            // 2. Official Dictionaries
            const addOfficial = (k, v) => {
                if (!k || !v) return;
                const norm = k.replace(/\s+/g, ' ').trim();
                const lower = norm.toLowerCase();
                if (!this.officialNormDict.has(norm)) this.officialNormDict.set(norm, v);
                if (!this.officialLowerDict.has(lower)) this.officialLowerDict.set(lower, v);
            };
            for (const [k, v] of Object.entries(this.officialCore)) addOfficial(k, v);
            for (const [k, v] of Object.entries(this.officialExact)) addOfficial(k, v);
            for (const [k, v] of Object.entries(this.menuMap)) addOfficial(k, v);

            // 3. Prefix rules (longest prefix first)
            for (const [k, v] of Object.entries(this.officialPrefix || {})) {
                if (k && v) this.prefixList.push([k, v]);
            }
            this.prefixList.sort((a, b) => b[0].length - a[0].length);

            // 4. User Custom Overrides (Highest translation priority, even above Exclusions)
            for (const [k, v] of Object.entries(this.config.customOverrides || {})) {
                if (k && v) {
                    const norm = k.replace(/\s+/g, ' ').trim();
                    const lower = norm.toLowerCase();
                    this.overrideNormDict.set(norm, v);
                    this.overrideLowerDict.set(lower, v);
                }
            }

            // 5. User Glossary exact & word-boundary lookup (longest term first)
            for (const [k, v] of Object.entries(this.config.glossary || {})) {
                if (k && v) {
                    const norm = k.replace(/\s+/g, ' ').trim();
                    const lower = norm.toLowerCase();
                    this.glossaryNormDict.set(norm, v);
                    this.glossaryLowerDict.set(lower, v);
                    this.glossaryLowerSet.add(lower);
                    this.glossaryEntriesSorted.push([norm, v]);
                }
            }
            this.glossaryEntriesSorted.sort((a, b) => b[0].length - a[0].length);

            // 6. Compile Regex Rules
            (this.officialRegex || []).forEach(r => {
                try {
                    this.regexCompiled.push({
                        re: new RegExp(r.pattern),
                        rp: r.replacement
                    });
                } catch (_) {}
            });
        }

        clearCache() {
            this.positiveCache.clear();
            this.negativeCache.clear();
        }

        // Lookup helper following: User Override -> User Glossary -> Official Exact
        lookupExactPriority(text) {
            if (!text) return null;
            const norm = text.replace(/\s+/g, ' ').trim();
            const lower = norm.toLowerCase();
            return this.overrideNormDict.get(norm) ||
                   this.overrideLowerDict.get(lower) ||
                   this.glossaryNormDict.get(norm) ||
                   this.glossaryLowerDict.get(lower) ||
                   this.officialNormDict.get(norm) ||
                   this.officialLowerDict.get(lower) ||
                   null;
        }

        // Helpers for UntranslatedDiscovery deduplication checks
        isExcluded(normText) {
            if (!normText) return false;
            return this.exclusionSet.has(normText.toLowerCase());
        }

        isInDiyDict(normText) {
            if (!normText) return false;
            const lower = normText.toLowerCase();
            return this.overrideNormDict.has(normText) ||
                   this.overrideLowerDict.has(lower) ||
                   this.glossaryNormDict.has(normText) ||
                   this.glossaryLowerDict.has(lower) ||
                   this.glossaryLowerSet.has(lower);
        }

        isInOfficialDict(normText) {
            if (!normText) return false;
            const lower = normText.toLowerCase();
            if (this.officialNormDict.has(normText) || this.officialLowerDict.has(lower)) {
                return true;
            }
            for (let i = 0; i < this.prefixList.length; i++) {
                if (normText.startsWith(this.prefixList[i][0])) return true;
            }
            for (let i = 0; i < this.regexCompiled.length; i++) {
                if (this.regexCompiled[i].re.test(normText)) return true;
            }
            return false;
        }

        zhPunct(tail) {
            const map = { '.': '。', '?': '？', '!': '！', ':': '：', ';': '；', ',': '，', '…': '……' };
            let out = '';
            for (let i = 0; i < tail.length; i++) {
                out += (map[tail[i]] || tail[i]);
            }
            return out;
        }

        // Translate text using the strict priority waterfall pipeline:
        // Stage 1: User Overrides
        // > Stage 2: Exclusions
        // > Stage 3a: User Glossary (Exact)
        // > Stage 3b: Official Exact Dict (+Tail/Lead Punct)
        // > Stage 4: Regex Rules (anchored)
        // > Stage 5: Prefix Rules (longest first)
        // > Stage 6: User Glossary (Word-Boundary with placeholder masking)
        // > Stage 7: Untranslated Discovery
        translate(rawText, options = {}) {
            if (!this.config.enabled || this.config.language !== 'zh-CN') {
                return null;
            }
            if (!rawText || typeof rawText !== 'string') return null;

            // Check O(1) Caches first
            if (this.positiveCache.has(rawText)) {
                return this.positiveCache.get(rawText);
            }
            if (this.negativeCache.has(rawText)) {
                if (options && options.element) {
                    this.recordUntranslated(rawText.trim(), options, options);
                }
                return null;
            }

            const trimmed = rawText.trim();
            if (trimmed.length < 2) {
                this.negativeCache.add(rawText);
                return null;
            }

            const norm = trimmed.replace(/\s+/g, ' ');
            const lower = norm.toLowerCase();

            // Stage 1: User Custom Overrides (FINAL HIGHEST PRIORITY, beats Exclusions)
            if (this.overrideNormDict.has(norm)) {
                const res = this.applyWhitespace(rawText, this.overrideNormDict.get(norm));
                this.positiveCache.set(rawText, res);
                return res;
            }
            if (this.overrideLowerDict.has(lower)) {
                const res = this.applyWhitespace(rawText, this.overrideLowerDict.get(lower));
                this.positiveCache.set(rawText, res);
                return res;
            }

            // Stage 2: Exclusions (永远保留英文, blocks Glossary / Official / Regex / Prefix)
            if (this.exclusionSet.has(lower)) {
                this.negativeCache.add(rawText);
                return null;
            }

            // Stage 3a: User Glossary Exact Match (beats Official Exact Dict on term conflict)
            if (this.glossaryNormDict.has(norm)) {
                const res = this.applyWhitespace(rawText, this.glossaryNormDict.get(norm));
                this.positiveCache.set(rawText, res);
                return res;
            }
            if (this.glossaryLowerDict.has(lower)) {
                const res = this.applyWhitespace(rawText, this.glossaryLowerDict.get(lower));
                this.positiveCache.set(rawText, res);
                return res;
            }

            // Stage 3b: Official Exact Normalized & Lowercase Match
            if (this.officialNormDict.has(norm)) {
                const res = this.applyWhitespace(rawText, this.officialNormDict.get(norm));
                this.positiveCache.set(rawText, res);
                return res;
            }
            if (this.officialLowerDict.has(lower)) {
                const res = this.applyWhitespace(rawText, this.officialLowerDict.get(lower));
                this.positiveCache.set(rawText, res);
                return res;
            }

            // Stage 3.5: Tail & Leading Punctuation Strip Match ("Save." -> "保存。", ", / for actions" -> "， / 执行操作")
            const tailMatch = norm.match(/^(.*?)([.!?,:;…]+)$/);
            if (tailMatch && tailMatch[1]) {
                const body = tailMatch[1].trim();
                const tail = tailMatch[2];
                if (this.overrideNormDict.has(body) || this.overrideLowerDict.has(body.toLowerCase())) {
                    const hit = this.overrideNormDict.get(body) || this.overrideLowerDict.get(body.toLowerCase());
                    const res = this.applyWhitespace(rawText, hit + this.zhPunct(tail));
                    this.positiveCache.set(rawText, res);
                    return res;
                }
                if (!this.exclusionSet.has(body.toLowerCase())) {
                    const hit = this.glossaryNormDict.get(body) ||
                                this.glossaryLowerDict.get(body.toLowerCase()) ||
                                this.officialNormDict.get(body) ||
                                this.officialLowerDict.get(body.toLowerCase());
                    if (hit) {
                        const res = this.applyWhitespace(rawText, hit + this.zhPunct(tail));
                        this.positiveCache.set(rawText, res);
                        return res;
                    }
                }
            }

            const leadMatch = norm.match(/^([.!?,:;…]+)(\s*)(.+)$/);
            if (leadMatch && leadMatch[3]) {
                const leadPunct = leadMatch[1];
                const sepSpace = leadMatch[2];
                const body = leadMatch[3].trim();
                if (!this.exclusionSet.has(body.toLowerCase())) {
                    const hit = this.lookupExactPriority(body);
                    if (hit) {
                        const res = this.applyWhitespace(rawText, this.zhPunct(leadPunct) + sepSpace + hit);
                        this.positiveCache.set(rawText, res);
                        return res;
                    }
                }
            }

            // Stage 4: Regex Rules (anchored pattern matching takes priority over Prefix clipping)
            for (let i = 0; i < this.regexCompiled.length; i++) {
                const { re, rp } = this.regexCompiled[i];
                if (re.test(norm)) {
                    const replaced = norm.replace(re, rp);
                    if (replaced !== norm) {
                        const res = this.applyWhitespace(rawText, replaced);
                        this.positiveCache.set(rawText, res);
                        return res;
                    }
                }
            }

            // Stage 5: Prefix Rules (longest first)
            for (let i = 0; i < this.prefixList.length; i++) {
                const prefix = this.prefixList[i][0];
                const replacement = this.prefixList[i][1];
                if (norm.startsWith(prefix)) {
                    const remainder = norm.slice(prefix.length);
                    const remainderZh = remainder ? (this.translate(remainder) || remainder) : '';
                    const res = this.applyWhitespace(rawText, replacement + remainderZh);
                    this.positiveCache.set(rawText, res);
                    return res;
                }
            }

            // Stage 6: User Glossary Word-Boundary Replacement (with placeholder & exclusion protection)
            if (this.glossaryEntriesSorted.length > 0) {
                const sanitizer = this.sanitizer || getSanitizerLib();
                let masked = norm;
                let tokens = [];
                if (sanitizer && typeof sanitizer.maskPlaceholders === 'function') {
                    const maskedObj = sanitizer.maskPlaceholders(norm);
                    masked = maskedObj.masked;
                    tokens = maskedObj.tokens;
                }

                let replaced = masked;
                let hasReplaced = false;
                for (let i = 0; i < this.glossaryEntriesSorted.length; i++) {
                    const enTerm = this.glossaryEntriesSorted[i][0];
                    const zhTerm = this.glossaryEntriesSorted[i][1];
                    if (this.exclusionSet.has(enTerm.toLowerCase())) continue;
                    const escaped = enTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const termRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
                    if (termRegex.test(replaced)) {
                        replaced = replaced.replace(termRegex, zhTerm);
                        hasReplaced = true;
                    }
                }
                if (hasReplaced && replaced !== masked) {
                    const finalStr = (sanitizer && typeof sanitizer.unmaskPlaceholders === 'function')
                        ? sanitizer.unmaskPlaceholders(replaced, tokens)
                        : replaced;
                    const res = this.applyWhitespace(rawText, finalStr);
                    this.positiveCache.set(rawText, res);
                    return res;
                }
            }

            // Stage 7: No translation found -> filtered Untranslated UI Discovery
            this.recordUntranslated(trimmed, options, options);
            this.negativeCache.add(rawText);
            return null;
        }

        // Preserve original leading and trailing whitespace
        applyWhitespace(original, translated) {
            const leadingMatch = original.match(/^(\s*)/);
            const trailingMatch = original.match(/(\s*)$/);
            const leading = leadingMatch ? leadingMatch[1] : '';
            const trailing = trailingMatch ? trailingMatch[1] : '';
            return leading + translated + trailing;
        }

        // Filtered Untranslated Discovery recording (isolated from main pipeline errors)
        recordUntranslated(text, domContext = {}, options = {}) {
            try {
                if (!this.discovery) return { captured: false, reason: 'no_discovery' };
                const dictChecker = {
                    isExcluded: (t) => this.isExcluded(t),
                    isInDiyDict: (t) => this.isInDiyDict(t),
                    isInOfficialDict: (t) => this.isInOfficialDict(t)
                };
                return this.discovery.record(text, domContext, dictChecker, options);
            } catch (_) {
                return { captured: false, reason: 'error_isolated' };
            }
        }

        removeUntranslated(text) {
            if (this.discovery) {
                this.discovery.remove(text);
            }
        }

        clearUntranslated() {
            if (this.discovery) {
                this.discovery.clear();
            }
        }

        // Get sorted & filtered list of untranslated candidates (defaults to UI copy & terminology)
        getUntranslatedList(filterMode = 'default') {
            if (this.discovery) {
                return this.discovery.getList(filterMode);
            }
            return [];
        }
    }

    exports.TranslationEngine = TranslationEngine;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.__HakimiEngine = {}));
