// =============================================================================
// Hakimi i18n v1.1 - Untranslated UI Copy Discovery & Classification Engine
// =============================================================================
(function(exports) {
    'use strict';

    const CATEGORIES = {
        UI_COPY: { id: 'ui_copy', label: 'UI 文案' },
        TERMINOLOGY: { id: 'terminology', label: '专业术语' },
        PROPER_NOUN: { id: 'proper_noun', label: '专有名词' },
        DYNAMIC_DATA: { id: 'dynamic_data', label: '动态内容' },
        USER_CONTENT: { id: 'user_content', label: '用户内容' }
    };

    const CODE_EDITOR_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
        'INPUT', 'TEXTAREA', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'
    ]);

    const CODE_EDITOR_CLASSES = [
        'monaco-editor', 'monaco-mouse-cursor-text', 'editor-instance',
        'view-lines', 'view-line', 'line-content', 'gutter',
        'xterm', 'terminal', 'hljs', 'shiki', 'prism', 'codemirror',
        'codeblock', 'code-block', 'code-line', 'token', 'json-formatter-row'
    ];

    const CHAT_USER_CLASSES = [
        'cursor-edit', 'thought-content', 'thinking-content', 'thought-box',
        'thought-container', 'conversation-container', 'chat-message-view',
        'prose', 'stream-markdown-body', 'stream-markdown',
        'path-label', 'breadcrumb', 'workspace-dropdown-item', 'folder-item',
        'user-message', 'cursor-text', 'notranslate'
    ];

    const CHAT_USER_TESTIDS = new Set([
        'user-input-step', 'agent-response', 'artifact-view',
        'thinking-collapsible-content', 'thought-content', 'thinking-content',
        'thought-box', 'menu-option-label', 'user-message', 'agent-thinking-panel'
    ]);

    const CHAT_USER_IDS = new Set([
        'hakimi-i18n-modal-overlay', 'hakimi-i18n-trigger',
        'hakimi-sidedock-panel', 'hakimi-sidedock-trigger'
    ]);

    const CODE_CLASS_RE = /(?:^|[\s_-])(monaco-editor|editor-instance|hljs|shiki|prism|codemirror|line-content|gutter|codeblock|code-block|code-line|view-line|view-lines|xterm|json-formatter-row)(?:$|[\s_-])/i;

    // Default proper nouns: fonts, brands, models, tools, platforms (case-insensitive matching)
    const PROPER_NOUN_LIST = [
        // Fonts
        'Google Sans', 'Google Sans Mono', 'Google Sans Text', 'Segoe UI',
        'Microsoft YaHei', 'Microsoft YaHei UI', 'JetBrains Mono', 'Fira Code',
        'Cascadia Code', 'Cascadia Mono', 'Consolas', 'SF Pro', 'SF Mono',
        'Roboto', 'Roboto Mono', 'Inter', 'Helvetica', 'Helvetica Neue',
        'Arial', 'Menlo', 'Monaco', 'Courier New', 'PingFang SC', 'Noto Sans',
        // Products / Models / Brands / Platforms
        'Antigravity', 'OpenCodex', 'Google', 'Google Cloud', 'Google Workspace',
        'Google Maps', 'Google Drive', 'Google Docs', 'Google Sheets',
        'Gemini', 'Gemini Flash', 'Gemini Pro', 'ChatGPT', 'OpenAI', 'Codex',
        'Grok', 'xAI', 'Claude', 'Anthropic', 'Orchestrator', 'Argon',
        'GitHub', 'GitLab', 'Bitbucket', 'Docker', 'Kubernetes', 'Electron',
        'Chromium', 'Node.js', 'TypeScript', 'JavaScript', 'Python', 'Rust',
        'PowerShell', 'Bash', 'Windows', 'macOS', 'Linux', 'Ubuntu', 'WSL',
        'BigQuery', 'Firestore', 'Firebase', 'AlloyDB', 'MCP', 'VS Code',
        'Cursor', 'Windsurf', 'Linear', 'Jira', 'Figma', 'Vercel', 'Netlify'
    ];
    const PROPER_NOUN_SET = new Set(PROPER_NOUN_LIST.map(s => s.toLowerCase()));

    // Regex detectors
    const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
    const HAS_LETTERS_RE = /[a-zA-Z]{2,}/;
    const URL_PROTOCOL_RE = /^(?:https?|file|ws|wss|ftp|mailto|chrome|edge|about|data|blob|vscode|antigravity):\/\//i;
    const CONTAINS_URL_RE = /\bhttps?:\/\/\S+/i;
    const WWW_RE = /^www\.\S+/i;
    const PATH_START_RE = /^(?:~[/\\]|\.{1,2}[/\\]|[/\\][a-zA-Z0-9_.-]+|[a-zA-Z]:[/\\])/;
    const PATH_SEP_RE = /^[a-zA-Z0-9_.~@-]+(?:[/\\][a-zA-Z0-9_.@-]+)+[/\\]?$/;
    const FILENAME_RE = /^[\w.-]+\.(?:js|ts|jsx|tsx|mjs|cjs|json|md|txt|py|ps1|bat|cmd|sh|css|scss|html|xml|yml|yaml|toml|ini|log|lock|exe|dll|asar|bak|png|jpg|jpeg|svg|webp|mp4|pdf|pb|db|sql)$/i;

    const SHORTCUT_COMBO_RE = /^(?:(?:Ctrl|Control|Alt|Shift|Meta|Cmd|Command|Opt|Option|Win|Super|Fn|⌘|⌥|⇧|⌃)\s*[+\-]\s*)+(?:[A-Za-z0-9]|F(?:1[0-2]|[1-9])|Esc|Escape|Tab|Enter|Return|Space|Backspace|Delete|Del|Insert|Ins|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Up|Down|Left|Right|[-=[\]\\;',./`~])$/i;
    const SHORTCUT_SINGLE_RE = /^(?:F[1-9]|F1[0-2]|Esc|Escape|CapsLock|PageUp|PageDown|Backspace)$/i;

    // 6a / 6b Precise dynamic metrics, KV status & date/time rules (replaces overly broad /\d/)
    const COLON_KV_RE = /^[A-Za-z][A-Za-z0-9\s_-]{0,28}[:：]\s*\S+/;
    const PURE_NUM_SYM_RE = /^[\d\s.,:%+\-/<>()[\]]+$/;
    const SEMVER_RE = /^v\d+(?:\.\d+)+(?:-[\w.]+)?$/i;
    const DATE_TIME_RE = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i;
    const METRIC_UNIT_RE = /\b\d[\d,.]*\s*(?:%|tokens?|chars?|characters?|words?|lines?|files?|folders?|bytes?|[KMGT]i?B|ms|s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?|mo|months?|yr|years?|px|rem|em|vh|vw|fps|Hz|kHz|MHz|GHz|credits?|items?|results?|matches|conversations?|agents?|tools?|steps?|errors?|warnings?|times?|ago|active)\b/i;

    // 8 Versioned product/model/language proper nouns
    const PROPER_NOUN_VERSION_RE = /^(?:GPT|ChatGPT|Python|Claude|Gemini|Grok|Llama|Mistral|Qwen|DeepSeek|Node(?:\.js)?|Electron|Chromium|TypeScript|JavaScript|Windows|macOS|Ubuntu|Android|iOS|Xcode|VS\s*Code|OpenCodex|Antigravity)(?:[\s\-/]+v?\d+(?:\.\d+)*(?:[\s\-]+(?:Pro|Flash|Ultra|Mini|Nano|Turbo|Sonnet|Opus|Haiku|Preview|Exp|Beta|RC))?)?$/i;

    const PLACEHOLDER_RE = /\{[a-zA-Z0-9_.-]+\}|\$\{[^}]+\}|%[sdif]|<[a-zA-Z][^>]*>/;
    const CODE_SYNTAX_CHAR_RE = /[;{}()[\]=<>`~$^|\\]/;
    const CAMEL_CASE_RE = /[a-z][A-Z]/;
    const SNAKE_CASE_RE = /[a-zA-Z]_[a-zA-Z]/;
    const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
    const CONST_IDENT_RE = /^[A-Z][A-Z0-9_]{2,}$/;
    const CLI_FLAG_RE = /^--?[a-zA-Z0-9-]+/;

    const CONVERSATIONAL_RE = /\b(?:I|I'm|I've|I'd|I'll|my|me|we|we're|we've|our|you|you're|you've|your|hey|hello|hi|thanks|thank\s+you|please\s+help|can\s+you|could\s+you|would\s+you|will\s+you|let's|what\s+should|where\s+should|how\s+do\s+I|help\s+me)\b/i;

    function getAttrSafe(el, name) {
        if (!el) return null;
        if (typeof el.getAttribute === 'function') return el.getAttribute(name);
        if (el.attributes && el.attributes[name] !== undefined) return el.attributes[name];
        return null;
    }

    function hasClassSafe(el, cls) {
        if (!el) return false;
        if (typeof el.className === 'string') {
            return el.className ? el.className.split(/\s+/).includes(cls) : false;
        }
        if (el.classList && typeof el.classList.contains === 'function') {
            return el.classList.contains(cls);
        }
        return false;
    }

    function matchesSelectorSafe(el, selector) {
        if (!el || typeof el.matches !== 'function') return false;
        try {
            return el.matches(selector);
        } catch (_) {
            return false;
        }
    }

    function classifyDOMSource(el, attrName) {
        // Pure-text / test mock flags without real element
        if (el && el.isUserContent) {
            return { allowed: false, category: CATEGORIES.USER_CONTENT.label, reason: 'user_dom' };
        }
        if (el && el.isCodeContext) {
            return { allowed: false, category: CATEGORIES.DYNAMIC_DATA.label, reason: 'code_dom' };
        }

        if (!el || (el.nodeType !== 1 && !el.tagName)) {
            if (attrName === 'placeholder' || attrName === 'data-placeholder') {
                return { allowed: true, source: 'placeholder' };
            }
            if (attrName === 'title' || attrName === 'data-tooltip') {
                return { allowed: true, source: 'tooltip' };
            }
            return { allowed: true, source: 'ui-control' };
        }

        // Walk ancestors to strictly filter code/chat/user containers
        let cur = el;
        let detectedSource = null;

        while (cur) {
            if (cur.nodeType && cur.nodeType !== 1 && !cur.tagName) break;
            const tag = (cur.tagName || '').toUpperCase();
            const tid = getAttrSafe(cur, 'data-testid');
            const id = cur.id || getAttrSafe(cur, 'id');
            const role = getAttrSafe(cur, 'role');

            // 1. Strict Code / Editor / Terminal DOM exclusions
            if (CODE_EDITOR_TAGS.has(tag)) {
                return { allowed: false, category: CATEGORIES.DYNAMIC_DATA.label, reason: 'code_or_editor_dom' };
            }
            if (role === 'code' ||
                getAttrSafe(cur, 'data-language') ||
                getAttrSafe(cur, 'data-code') ||
                getAttrSafe(cur, 'data-line') ||
                getAttrSafe(cur, 'data-line-number')) {
                return { allowed: false, category: CATEGORIES.DYNAMIC_DATA.label, reason: 'code_or_editor_dom' };
            }
            if (typeof cur.className === 'string' && CODE_CLASS_RE.test(cur.className)) {
                return { allowed: false, category: CATEGORIES.DYNAMIC_DATA.label, reason: 'code_or_editor_dom' };
            }
            for (let i = 0; i < CODE_EDITOR_CLASSES.length; i++) {
                if (hasClassSafe(cur, CODE_EDITOR_CLASSES[i])) {
                    return { allowed: false, category: CATEGORIES.DYNAMIC_DATA.label, reason: 'code_or_editor_dom' };
                }
            }

            // 2. Strict User Chat / Agent Output / Thinking / Path / Own UI exclusions
            if (getAttrSafe(cur, 'contenteditable') === 'true' ||
                role === 'textbox' ||
                getAttrSafe(cur, 'data-lexical-editor') === 'true' ||
                getAttrSafe(cur, 'data-ag-localization-skip') ||
                getAttrSafe(cur, 'data-immune') === 'true' ||
                getAttrSafe(cur, 'translate') === 'no' ||
                getAttrSafe(cur, 'data-message-id')) {
                return { allowed: false, category: CATEGORIES.USER_CONTENT.label, reason: 'chat_or_user_dom' };
            }
            if (tid && CHAT_USER_TESTIDS.has(tid)) {
                return { allowed: false, category: CATEGORIES.USER_CONTENT.label, reason: 'chat_or_user_dom' };
            }
            if (id && CHAT_USER_IDS.has(id)) {
                return { allowed: false, category: CATEGORIES.USER_CONTENT.label, reason: 'chat_or_user_dom' };
            }
            for (let i = 0; i < CHAT_USER_CLASSES.length; i++) {
                if (hasClassSafe(cur, CHAT_USER_CLASSES[i])) {
                    return { allowed: false, category: CATEGORIES.USER_CONTENT.label, reason: 'chat_or_user_dom' };
                }
            }

            // 3. Identify UI Control Source (outermost/nearest control wins)
            if (!detectedSource) {
                if (attrName === 'placeholder' || attrName === 'data-placeholder') {
                    detectedSource = 'placeholder';
                } else if (attrName === 'title' || attrName === 'data-tooltip') {
                    detectedSource = 'tooltip';
                } else if (tag === 'BUTTON' || role === 'button') {
                    detectedSource = 'button';
                } else if (role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio' || role === 'menu' || role === 'menubar') {
                    detectedSource = 'menu';
                } else if (role === 'tab' || role === 'tablist') {
                    detectedSource = 'tab';
                } else if (tag === 'LABEL' || tag === 'SELECT' || tag === 'OPTION' ||
                    role === 'switch' || role === 'checkbox' || role === 'radio' ||
                    role === 'combobox' || role === 'listbox' || role === 'option' ||
                    (tid && tid.toLowerCase().includes('setting'))) {
                    detectedSource = 'setting';
                } else if (role === 'dialog' || role === 'alertdialog' ||
                    tag === 'HEADER' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' ||
                    tag === 'TH' || tag === 'DT' || tag === 'LEGEND' || tag === 'SUMMARY') {
                    detectedSource = 'dialog/header';
                } else if (tag === 'NAV' || role === 'navigation' || tag === 'ASIDE' ||
                    matchesSelectorSafe(cur, 'nav, [role="navigation"]')) {
                    detectedSource = 'nav';
                }
            }

            if (tag === 'BODY' || tag === 'HTML') break;
            cur = cur.parentElement || cur.parentNode || null;
        }

        if (!detectedSource) {
            if (attrName === 'placeholder' || attrName === 'data-placeholder') detectedSource = 'placeholder';
            else if (attrName === 'title' || attrName === 'data-tooltip') detectedSource = 'tooltip';
            else detectedSource = 'ui-element';
        }

        return { allowed: true, source: detectedSource };
    }

    class UntranslatedDiscovery {
        constructor(options = {}) {
            this.maxRecords = options.maxRecords || 500;
            this.records = new Map(); // lowerKey -> { text, category, categoryId, count, sources: Set, lastSeen }
        }

        classify(rawText, domContext = null, dictChecker = null, options = {}) {
            if (!rawText || typeof rawText !== 'string') {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'invalid' };
            }

            const norm = rawText.replace(/\s+/g, ' ').trim();
            if (norm.length < 2 || norm.length > 80 || norm.includes('__HAKIMI_TOKEN_')) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'invalid_or_token' };
            }

            // 1. Check DOM Source Exclusion
            const domCheck = classifyDOMSource(
                domContext && domContext.element !== undefined ? domContext.element : domContext,
                domContext ? domContext.attrName : null
            );
            if (!domCheck.allowed) {
                const catId = domCheck.category === CATEGORIES.USER_CONTENT.label ? CATEGORIES.USER_CONTENT.id : CATEGORIES.DYNAMIC_DATA.id;
                return { captured: false, category: domCheck.category, categoryId: catId, reason: domCheck.reason };
            }

            // 2. Pure CJK / Non-Latin check (before dictionary checks to classify Chinese chat sentences properly)
            if (CJK_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.USER_CONTENT.label, categoryId: CATEGORIES.USER_CONTENT.id, reason: 'contains_cjk' };
            }
            if (!HAS_LETTERS_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'no_letters' };
            }

            // 3. Dictionary / Exclusions deduplication check
            if (dictChecker) {
                if (typeof dictChecker.isExcluded === 'function' && dictChecker.isExcluded(norm)) {
                    return { captured: false, category: CATEGORIES.PROPER_NOUN.label, categoryId: CATEGORIES.PROPER_NOUN.id, reason: 'in_exclusions' };
                }
                if (typeof dictChecker.isInDiyDict === 'function' && dictChecker.isInDiyDict(norm)) {
                    return { captured: false, category: CATEGORIES.UI_COPY.label, categoryId: CATEGORIES.UI_COPY.id, reason: 'in_diy_dict' };
                }
                if (!options.skipOfficialDictCheck && typeof dictChecker.isInOfficialDict === 'function' && dictChecker.isInOfficialDict(norm)) {
                    return { captured: false, category: CATEGORIES.UI_COPY.label, categoryId: CATEGORIES.UI_COPY.id, reason: 'in_official_dict' };
                }
            }

            // 4. URL and File Paths
            if (URL_PROTOCOL_RE.test(norm) || CONTAINS_URL_RE.test(norm) || WWW_RE.test(norm) ||
                PATH_START_RE.test(norm) || PATH_SEP_RE.test(norm) || FILENAME_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'url_or_path' };
            }

            // 5. Keyboard Shortcuts
            if (SHORTCUT_COMBO_RE.test(norm) || SHORTCUT_SINGLE_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'keyboard_shortcut' };
            }

            // 6a / 6b. Key-Value Dynamic Status & Dynamic Numbers/Units/Dates/Versions (preserves valid UI copy like "Model 3.5")
            if (COLON_KV_RE.test(norm) || PURE_NUM_SYM_RE.test(norm) || SEMVER_RE.test(norm) ||
                DATE_TIME_RE.test(norm) || METRIC_UNIT_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'dynamic_metric' };
            }

            // 7. Explicit Placeholders, Syntax Brackets, CLI Flags
            if (PLACEHOLDER_RE.test(norm) || CODE_SYNTAX_CHAR_RE.test(norm) || CLI_FLAG_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'code_or_identifier' };
            }

            // 8. Proper Nouns / Fonts / Brands / Versioned Products ("Google Sans", "GPT-4.1", "Python 3.12")
            if (PROPER_NOUN_SET.has(norm.toLowerCase()) || PROPER_NOUN_VERSION_RE.test(norm)) {
                return { captured: false, category: CATEGORIES.PROPER_NOUN.label, categoryId: CATEGORIES.PROPER_NOUN.id, reason: 'proper_noun' };
            }

            // 9. User Conversational English Sentences / Truncated Chat Titles
            const words = norm.split(/\s+/);
            if (words.length > 6 || CONVERSATIONAL_RE.test(norm) ||
                /[?!]$/.test(norm) || /(?:\.{3}|…)$/.test(norm)) {
                return { captured: false, category: CATEGORIES.USER_CONTENT.label, categoryId: CATEGORIES.USER_CONTENT.id, reason: 'user_sentence' };
            }

            // 10. Technical Identifiers (camelCase, snake_case, kebab-case, ALL_CAPS_CONST)
            if (SNAKE_CASE_RE.test(norm) || KEBAB_CASE_RE.test(norm) || CONST_IDENT_RE.test(norm) ||
                (words.length === 1 && (CAMEL_CASE_RE.test(norm) || /^[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*$/.test(norm)))) {
                return { captured: false, category: CATEGORIES.DYNAMIC_DATA.label, categoryId: CATEGORIES.DYNAMIC_DATA.id, reason: 'code_or_identifier' };
            }

            // 10. Qualified Candidate: Terminology (1 word) vs UI Copy (2-6 words)
            if (words.length === 1) {
                return {
                    captured: true,
                    text: norm,
                    category: CATEGORIES.TERMINOLOGY.label,
                    categoryId: CATEGORIES.TERMINOLOGY.id,
                    source: domCheck.source,
                    reason: 'qualified_terminology'
                };
            }

            return {
                captured: true,
                text: norm,
                category: CATEGORIES.UI_COPY.label,
                categoryId: CATEGORIES.UI_COPY.id,
                source: domCheck.source,
                reason: 'qualified_ui_copy'
            };
        }

        record(rawText, domContext = null, dictChecker = null, options = {}) {
            try {
                const res = this.classify(rawText, domContext, dictChecker, options);
                if (!res || !res.captured) {
                    return res;
                }

                const key = res.text.toLowerCase();
                if (this.records.has(key)) {
                    const existing = this.records.get(key);
                    existing.count += 1;
                    existing.lastSeen = Date.now();
                    if (res.source) existing.sources.add(res.source);
                } else {
                    if (this.records.size >= this.maxRecords) {
                        const firstKey = this.records.keys().next().value;
                        this.records.delete(firstKey);
                    }
                    const sources = new Set();
                    if (res.source) sources.add(res.source);
                    this.records.set(key, {
                        text: res.text,
                        category: res.category,
                        categoryId: res.categoryId,
                        count: 1,
                        sources: sources,
                        lastSeen: Date.now()
                    });
                }
                return res;
            } catch (_) {
                return { captured: false, reason: 'error_isolated' };
            }
        }

        remove(rawText) {
            if (!rawText) return;
            const key = String(rawText).replace(/\s+/g, ' ').trim().toLowerCase();
            this.records.delete(key);
        }

        clear() {
            this.records.clear();
        }

        getList(filterMode = 'default') {
            const list = [];
            for (const entry of this.records.values()) {
                if (filterMode === 'default' &&
                    entry.categoryId !== CATEGORIES.UI_COPY.id &&
                    entry.categoryId !== CATEGORIES.TERMINOLOGY.id) {
                    continue;
                }
                list.push({
                    text: entry.text,
                    category: entry.category,
                    categoryId: entry.categoryId,
                    count: entry.count,
                    sources: Array.from(entry.sources),
                    lastSeen: entry.lastSeen
                });
            }
            return list.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
        }
    }

    exports.CATEGORIES = CATEGORIES;
    exports.PROPER_NOUN_SET = PROPER_NOUN_SET;
    exports.classifyDOMSource = classifyDOMSource;
    exports.UntranslatedDiscovery = UntranslatedDiscovery;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.__HakimiDiscovery = {}));
