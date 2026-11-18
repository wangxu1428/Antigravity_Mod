// =============================================================================
// Hakimi i18n v1.1 - Sanitizer, Immunity Sandbox & Placeholder Protection
// =============================================================================
(function(exports) {
    'use strict';

    const IMMUNE_TAGS = new Set([
        'SCRIPT', 'STYLE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TEXTAREA', 'INPUT',
        'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'
    ]);

    const CODE_CLASS_RE = /(?:^|[\s_-])(monaco-editor|editor-instance|hljs|shiki|prism|codemirror|line-content|gutter|codeblock|code-block|code-line|view-line|view-lines|xterm|json-formatter-row)(?:$|[\s_-])/i;

    const THINK_AND_USER_CLASSES = new Set([
        'cursor-edit', 'thought-content', 'thinking-content', 'thought-box',
        'thought-container', 'conversation-container', 'chat-message-view',
        'prose', 'stream-markdown-body', 'stream-markdown',
        'path-label', 'breadcrumb', 'workspace-dropdown-item', 'folder-item',
        'user-message', 'cursor-text', 'monaco-editor', 'editor-instance',
        'xterm', 'terminal', 'token',
        'json-formatter-row', 'hljs', 'notranslate'
    ]);

    const THINK_TESTIDS = new Set([
        'thinking-collapsible-content', 'thought-content', 'thinking-content',
        'thought-box', 'user-input-step', 'agent-response', 'artifact-view',
        'user-message', 'agent-thinking-panel'
    ]);

    const OWN_PLUGIN_IDS = new Set([
        'hakimi-i18n-modal-overlay', 'hakimi-i18n-trigger',
        'hakimi-sidedock-panel', 'hakimi-sidedock-trigger'
    ]);

    const ACTION_PILL_RE = /^(Explored|Ran|Viewed|Edited|Thought|Thinking|Working)$/i;
    const PROJECT_CONTROL_LABELS = new Set(['No Project', 'No project', 'Select Project', '未选择项目', '无项目']);
    const WORKSPACE_FOLDER_CLASSES = new Set(['workspace-dropdown-item', 'folder-item']);

    function getAttrSafe(el, name) {
        if (!el) return null;
        if (typeof el.getAttribute === 'function') return el.getAttribute(name);
        if (el.attributes && el.attributes[name] !== undefined) return el.attributes[name];
        return null;
    }

    function closestSafe(el, selector) {
        if (!el) return null;
        if (typeof el.closest === 'function') {
            try { return el.closest(selector); } catch (_) { return null; }
        }
        return null;
    }

    function isPlaceholderOverlayElement(el) {
        if (!el) return false;
        if (getAttrSafe(el, 'contenteditable') === 'true') return false;
        if (getAttrSafe(el, 'aria-hidden') === 'true') return true;
        if (getAttrSafe(el, 'data-placeholder')) return true;
        if (typeof el.className === 'string' && /\bplaceholder\b|placeholder-/i.test(el.className)) return true;
        return false;
    }

    function hasClassToken(cur, targetSet) {
        if (typeof cur.className === 'string') {
            if (!cur.className) return false;
            const parts = cur.className.split(/\s+/);
            for (let i = 0; i < parts.length; i++) {
                if (targetSet.has(parts[i])) return true;
            }
            return false;
        }
        if (cur.classList) {
            for (const cls of cur.classList) {
                if (targetSet.has(cls)) return true;
            }
        }
        return false;
    }

    function judgeElement(element) {
        if (!element) return false;
        const tag = (element.tagName || '').toUpperCase();

        // 0. Explicit skip attributes & own plugin UI
        if (getAttrSafe(element, 'data-ag-localization-skip') ||
            getAttrSafe(element, 'data-immune') === 'true' ||
            getAttrSafe(element, 'translate') === 'no') {
            return true;
        }
        const elId = element.id || getAttrSafe(element, 'id');
        if (elId && OWN_PLUGIN_IDS.has(elId)) return true;

        // 1. Script / style / media / input tags
        if (IMMUNE_TAGS.has(tag)) return true;

        // 2. Inputs & rich-text editors (physical immunity, unless element itself is a pure visual placeholder overlay)
        const rawText = (element.innerText || element.textContent || '').trim();
        const isPlaceholderOverlay = isPlaceholderOverlayElement(element);
        if (getAttrSafe(element, 'contenteditable') === 'true' ||
            getAttrSafe(element, 'role') === 'textbox' ||
            getAttrSafe(element, 'data-lexical-editor') === 'true') {
            return true;
        }

        // 2.5 Allow UI action bar inside user message step (timestamps, Copy/Edit buttons)
        if (closestSafe(element, '[data-testid="user-message-actions"]')) return false;

        // 3. Allow thinking collapsible header button ("Thought for 4.2s")
        if (closestSafe(element, 'button[data-testid="thinking-collapsible-trigger"]')) return false;

        // 4. Short action pill inside CODE tag (e.g., "Viewed", "Edited", "Ran")
        const isActionPill = rawText.length > 0 && rawText.length <= 25 && ACTION_PILL_RE.test(rawText);
        if (tag === 'CODE') {
            if (!isActionPill) return true;
        }

        // 5. Code metadata attributes
        if (getAttrSafe(element, 'data-language') ||
            getAttrSafe(element, 'data-code') ||
            getAttrSafe(element, 'data-line') ||
            getAttrSafe(element, 'data-line-number')) {
            return true;
        }

        // 6. Real-time ancestor walk (no stale WeakMap cache so node moves & dynamic mutations take effect immediately)
        let cur = element;
        while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
            const curTag = (cur.tagName || '').toUpperCase();
            if (IMMUNE_TAGS.has(curTag)) return true;
            if (curTag === 'CODE' && !isActionPill) return true;

            const curId = cur.id || getAttrSafe(cur, 'id');
            if (curId && OWN_PLUGIN_IDS.has(curId)) return true;

            if (cur.classList || typeof cur.className === 'string') {
                // Allow explicit project-selector control labels ("No Project") inside dropdown/folder containers
                if (PROJECT_CONTROL_LABELS.has(rawText) &&
                    hasClassToken(cur, WORKSPACE_FOLDER_CLASSES)) {
                    cur = cur.parentElement || cur.parentNode || null;
                    continue;
                }
                if (hasClassToken(cur, THINK_AND_USER_CLASSES)) return true;
            }
            if (typeof cur.className === 'string' && CODE_CLASS_RE.test(cur.className)) {
                return true;
            }

            if (getAttrSafe(cur, 'data-message-id') ||
                getAttrSafe(cur, 'data-ag-localization-skip') ||
                getAttrSafe(cur, 'data-immune') === 'true' ||
                getAttrSafe(cur, 'translate') === 'no' ||
                getAttrSafe(cur, 'role') === 'code') {
                return true;
            }

            if (getAttrSafe(cur, 'contenteditable') === 'true' ||
                getAttrSafe(cur, 'role') === 'textbox' ||
                getAttrSafe(cur, 'data-lexical-editor') === 'true') {
                if (cur !== element && isPlaceholderOverlay) {
                    cur = cur.parentElement || cur.parentNode || null;
                    continue;
                }
                return true;
            }

            const tid = getAttrSafe(cur, 'data-testid');
            if (tid && THINK_TESTIDS.has(tid)) return true;

            cur = cur.parentElement || cur.parentNode || null;
        }

        return false;
    }

    // Check if an element or any of its ancestors is immune (live check, zero stale cache)
    function isElementImmune(el) {
        if (!el || (typeof Node !== 'undefined' ? el.nodeType !== Node.ELEMENT_NODE : el.nodeType !== 1)) {
            return false;
        }
        try {
            return judgeElement(el);
        } catch (_) {
            return false;
        }
    }

    // Placeholders and code tokens to preserve
    const PLACEHOLDER_PATTERNS = [
        /\{[a-zA-Z0-9_-]+\}/g,             // {name}, {0}, {count}
        /%[sdif]/g,                        // %s, %d
        /\$\{[^}]+\}/g,                    // ${var}
        /`[^`]+`/g,                        // `inline code`
        /https?:\/\/[^\s<>'"]+/g,          // URLs
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Emails
        /\b(?:gemini|gpt|claude|grok)-[a-zA-Z0-9.-]+\b/gi,   // Model IDs
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g  // IP:Port
    ];

    // Protect placeholders before translation by replacing them with tokens
    function maskPlaceholders(text) {
        const tokens = [];
        let masked = text;
        PLACEHOLDER_PATTERNS.forEach((regex, typeIdx) => {
            masked = masked.replace(regex, (match) => {
                const token = `__HAKIMI_TOKEN_${typeIdx}_${tokens.length}__`;
                tokens.push({ token, original: match });
                return token;
            });
        });
        return { masked, tokens };
    }

    // Restore masked placeholders
    function unmaskPlaceholders(text, tokens) {
        if (!tokens || tokens.length === 0) return text;
        let restored = text;
        for (let i = 0; i < tokens.length; i++) {
            restored = restored.replace(tokens[i].token, tokens[i].original);
        }
        return restored;
    }

    // Text safety check: whether text should even be considered for translation
    function isTranslatableText(text) {
        if (!text) return false;
        const trimmed = text.trim();
        if (trimmed.length < 2) return false;
        // Pure numbers, dates, times, or symbols
        if (/^[\d\s.,:;!?'"()\[\]{}<>/\\|@#$%^&*+=~`_-]+$/.test(trimmed)) return false;
        // Pure hex colors or hash strings
        if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(trimmed)) return false;
        // Pure code identifier like ALL_CAPS_CONST
        if (/^[A-Z0-9_]{3,}$/.test(trimmed) && !trimmed.includes(' ')) return false;
        // Contains at least one Latin alphabet character
        if (!/[a-zA-Z]/.test(trimmed)) return false;
        return true;
    }

    // Check if element or ancestor explicitly belongs to Hakimi plugins or skip zones
    function isPluginOwnElement(el) {
        if (!el || (typeof Node !== 'undefined' ? el.nodeType !== Node.ELEMENT_NODE : el.nodeType !== 1)) {
            return false;
        }
        try {
            let cur = el;
            while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
                if (getAttrSafe(cur, 'data-ag-localization-skip') ||
                    getAttrSafe(cur, 'data-immune') === 'true' ||
                    getAttrSafe(cur, 'translate') === 'no') {
                    return true;
                }
                const curId = cur.id || getAttrSafe(cur, 'id');
                if (curId && OWN_PLUGIN_IDS.has(curId)) return true;
                cur = cur.parentElement || cur.parentNode || null;
            }
        } catch (_) {}
        return false;
    }

    exports.isElementImmune = isElementImmune;
    exports.isPluginOwnElement = isPluginOwnElement;
    exports.maskPlaceholders = maskPlaceholders;
    exports.unmaskPlaceholders = unmaskPlaceholders;
    exports.isTranslatableText = isTranslatableText;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.__HakimiSanitizer = {}));
