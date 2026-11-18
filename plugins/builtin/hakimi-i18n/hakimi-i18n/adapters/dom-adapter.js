// =============================================================================
// Hakimi i18n v1.1 - DOM & Dynamic Content Adapter (Enhanced Production Grade)
// =============================================================================
(function(exports) {
    'use strict';

    class DOMAdapter {
        constructor(engine, sanitizer) {
            this.engine = engine;
            this.sanitizer = sanitizer;
            this.observer = null;
            this.shadowObservers = new WeakMap();
            this.shadowObserverList = new Set();
            this.timers = new Set();
            this.isTranslating = false;
            this.batchScheduled = false;
            this.active = false;
            this.scanEpoch = 1;

            // Translatable attribute names (DELIBERATELY EXCLUDING aria-label for Antigravity state safety)
            this.TRANSLATABLE_ATTRS = ['placeholder', 'title', 'data-tooltip', 'data-placeholder', 'aria-placeholder'];
            // Structural/immunity context attributes whose mutations require re-evaluating the element subtree
            this.CONTEXT_ATTRS = new Set(['class', 'data-testid', 'contenteditable', 'role', 'data-immune', 'translate', 'data-ag-localization-skip']);
            this.OBSERVED_ATTRS = [...this.TRANSLATABLE_ATTRS, ...this.CONTEXT_ATTRS];

            // Pending mutations queues
            this.pendingAdded = new Set();
            this.pendingText = new Set();
            this.pendingAttrs = new Map();

            // Circuit breaker
            this.burstCount = 0;
            this.burstWindowStart = 0;
            this.BURST_LIMIT = 400;
            this.BURST_WINDOW = 3000;
            this.COOLDOWN = 800;

            this.boundProcessBatch = this.processBatch.bind(this);
            this.boundHandleMutations = this.handleMutations.bind(this);
            this.boundPopstateScan = null;
            this.boundFocusScan = null;

            // Saved host prototypes/descriptors for leak-free teardown restoration
            this.origPushState = null;
            this.origReplaceState = null;
            this.historyHookedByUs = false;
            this.origAttachShadow = null;
            this.attachShadowHookedByUs = false;
            this.origTitleOwnDesc = undefined;
            this.origTitleProtoSet = null;
            this.titleHookedByUs = false;
        }

        scheduleTimer(fn, delay) {
            const id = setTimeout(() => {
                this.timers.delete(id);
                fn();
            }, delay);
            this.timers.add(id);
            return id;
        }

        clearAllTimers() {
            for (const id of this.timers) {
                clearTimeout(id);
            }
            this.timers.clear();
        }

        start() {
            if (this.active) {
                this.scanEpoch += 1;
                this.safeScan();
                return;
            }
            this.active = true;
            this.scanEpoch += 1;

            // 1. Initial scan
            this.safeScan();

            // 2. Set up MutationObserver on documentElement
            if (typeof MutationObserver !== 'undefined') {
                this.observer = new MutationObserver(this.boundHandleMutations);
                try {
                    this.observer.observe(document.documentElement || document.body, {
                        childList: true,
                        subtree: true,
                        characterData: true,
                        characterDataOldValue: true,
                        attributes: true,
                        attributeFilter: this.OBSERVED_ATTRS
                    });
                } catch (e) {
                    console.warn('[Hakimi i18n] Failed to observe documentElement:', e);
                }
            }

            // 3. Progressive delayed rescans for asynchronous React / SPA rendering
            const delays = [50, 150, 300, 600, 1200, 2500, 5000];
            delays.forEach(d => {
                this.scheduleTimer(() => {
                    if (this.active) this.safeScan();
                }, d);
            });

            // 4. Focus & visibility change hooks (deduped)
            if (this.boundFocusScan) {
                window.removeEventListener('focus', this.boundFocusScan);
                document.removeEventListener('visibilitychange', this.boundFocusScan);
            }
            this.boundFocusScan = () => { if (this.active) this.safeScan(); };
            window.addEventListener('focus', this.boundFocusScan);
            document.addEventListener('visibilitychange', this.boundFocusScan);

            // 5. SPA route transitions
            this.hookHistory();

            // 6. Hook Shadow DOM
            this.hookShadowDOM();

            // 7. Hook Title setter
            this.hookTitle();
        }

        stop() {
            this.clearAllTimers();

            if (this.observer) {
                try { this.observer.disconnect(); } catch (_) {}
                this.observer = null;
            }
            for (const obs of this.shadowObserverList) {
                try { obs.disconnect(); } catch (_) {}
            }
            this.shadowObserverList.clear();
            this.shadowObservers = new WeakMap();

            if (this.boundFocusScan) {
                window.removeEventListener('focus', this.boundFocusScan);
                document.removeEventListener('visibilitychange', this.boundFocusScan);
                this.boundFocusScan = null;
            }
            if (this.boundPopstateScan) {
                window.removeEventListener('popstate', this.boundPopstateScan);
                this.boundPopstateScan = null;
            }

            this.unhookHistory();
            this.unhookShadowDOM();
            this.unhookTitle();

            this.pendingAdded.clear();
            this.pendingText.clear();
            this.pendingAttrs.clear();
            this.active = false;
        }

        safeScan() {
            if (!this.active) return;
            const root = document.body || document.documentElement;
            if (root) {
                try {
                    this.translateTree(root);
                    this.translateDocumentTitle();
                } catch (e) {
                    console.warn('[Hakimi i18n] safeScan error:', e);
                }
            }
        }

        restoreTextNode(node) {
            if (!node || node.nodeType !== 3) return;
            if (node.__agyOrigText !== undefined) {
                if (node.__agyTranslated) {
                    node.nodeValue = node.__agyOrigText;
                }
                delete node.__agyOrigText;
                delete node.__agyTranslated;
                delete node.__agyTranslatedText;
                delete node.__agyEpoch;
            }
        }

        // Restore translated text nodes inside a subtree that became immune (e.g. moved from Settings into Chat)
        restoreImmuneSubtree(root) {
            if (!root) return;
            if (root.nodeType === 3) {
                this.restoreTextNode(root);
                return;
            }
            if (root.nodeType !== 1) return;
            try {
                const walker = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                let n;
                while ((n = walker.nextNode())) {
                    this.restoreTextNode(n);
                }
            } catch (_) {}
        }

        restoreElementAttributes(el) {
            if (!el || el.nodeType !== 1 || !el.__agyOrigAttrs) return;
            for (const [attr, origVal] of Object.entries(el.__agyOrigAttrs)) {
                el.setAttribute(attr, origVal);
            }
            delete el.__agyOrigAttrs;
            delete el.__agyTranslatedAttrs;
            delete el.__agyAttrEpoch;
        }

        // Restore 100% original English across the entire document
        restoreEnglish(root = document.body || document.documentElement, isNestedShadow = false) {
            if (!isNestedShadow) {
                this.stop();
            }
            if (!root) return;

            if (root.nodeType === 1) {
                this.restoreElementAttributes(root);
                if (root.shadowRoot) {
                    this.restoreEnglish(root.shadowRoot, true);
                }
            }

            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let node;
            while ((node = walker.nextNode())) {
                if (node.nodeType === 3) {
                    this.restoreTextNode(node);
                } else if (node.nodeType === 1) {
                    this.restoreElementAttributes(node);
                    if (node.shadowRoot) {
                        this.restoreEnglish(node.shadowRoot, true);
                    }
                }
            }

            if (!isNestedShadow && document.__agyOrigTitle !== undefined) {
                document.title = document.__agyOrigTitle;
                delete document.__agyOrigTitle;
            }
        }

        handleMutations(mutations) {
            if (!this.active || this.isTranslating) return;

            for (let i = 0; i < mutations.length; i++) {
                const mut = mutations[i];
                if (mut.type === 'childList') {
                    for (let j = 0; j < mut.addedNodes.length; j++) {
                        const n = mut.addedNodes[j];
                        this.pendingAdded.add(n);
                    }
                } else if (mut.type === 'characterData') {
                    const target = mut.target;
                    if (target.__agyTranslated && target.nodeValue === target.__agyTranslatedText) {
                        continue;
                    }
                    delete target.__agyEpoch;
                    this.pendingText.add(target);
                } else if (mut.type === 'attributes') {
                    const target = mut.target;
                    if (this.CONTEXT_ATTRS.has(mut.attributeName)) {
                        this.pendingAdded.add(target);
                        continue;
                    }
                    if (target.__agyAttrEpoch) {
                        delete target.__agyAttrEpoch[mut.attributeName];
                    }
                    let set = this.pendingAttrs.get(target);
                    if (!set) {
                        set = new Set();
                        this.pendingAttrs.set(target, set);
                    }
                    set.add(mut.attributeName);
                }
            }

            this.scheduleBatch();
        }

        scheduleBatch() {
            if (this.batchScheduled) return;
            this.batchScheduled = true;
            const run = () => {
                this.batchScheduled = false;
                this.processBatch();
            };
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(run);
            } else if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(run);
            } else {
                this.scheduleTimer(run, 0);
            }
        }

        processBatch() {
            if (!this.active || this.isTranslating) return;

            // Circuit breaker
            const now = Date.now();
            if (now - this.burstWindowStart > this.BURST_WINDOW) {
                this.burstWindowStart = now;
                this.burstCount = 0;
            }
            if (++this.burstCount > this.BURST_LIMIT) {
                if (this.observer) this.observer.disconnect();
                this.scheduleTimer(() => {
                    if (this.active && this.observer) {
                        try {
                            this.observer.observe(document.documentElement || document.body, {
                                childList: true, subtree: true, characterData: true, attributes: true,
                                attributeFilter: this.OBSERVED_ATTRS
                            });
                        } catch (_) {}
                        this.safeScan();
                    }
                }, this.COOLDOWN);
                this.burstCount = 0;
                return;
            }

            this.isTranslating = true;
            try {
                // 1. Process attributes
                if (this.pendingAttrs.size > 0) {
                    this.pendingAttrs.forEach((attrs, target) => {
                        if (target && target.isConnected) {
                            attrs.forEach(attrName => this.translateElementAttr(target, attrName));
                        }
                    });
                    this.pendingAttrs.clear();
                }

                // 2. Process text characterData
                if (this.pendingText.size > 0) {
                    this.pendingText.forEach(node => {
                        if (node && node.isConnected) {
                            this.translateTextNode(node);
                        }
                    });
                    this.pendingText.clear();
                }

                // 3. Process added nodes with ancestor pruning (eliminates O(N^2) redundant scans)
                if (this.pendingAdded.size > 0) {
                    const roots = [];
                    this.pendingAdded.forEach(node => {
                        let p = node.parentElement;
                        let covered = false;
                        while (p) {
                            if (this.pendingAdded.has(p)) {
                                covered = true;
                                break;
                            }
                            p = p.parentElement;
                        }
                        if (!covered) roots.push(node);
                    });
                    this.pendingAdded.clear();

                    for (let i = 0; i < roots.length; i++) {
                        const node = roots[i];
                        if (node && node.isConnected) {
                            if (node.nodeType === 3) {
                                this.translateTextNode(node);
                            } else if (node.nodeType === 1) {
                                this.translateTree(node);
                            }
                        }
                    }
                }

                this.translateDocumentTitle();
            } catch (err) {
                console.error('[Hakimi i18n] Error during processBatch:', err);
            } finally {
                this.isTranslating = false;
            }
        }

        observeShadowRoot(shadow) {
            if (!shadow || this.shadowObservers.has(shadow) || typeof MutationObserver === 'undefined') return;
            try {
                const shadowObs = new MutationObserver(this.boundHandleMutations);
                shadowObs.observe(shadow, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: this.OBSERVED_ATTRS
                });
                this.shadowObservers.set(shadow, shadowObs);
                this.shadowObserverList.add(shadowObs);
            } catch (_) {}
        }

        handleImmuneContainerOverlays(el) {
            if (!el || typeof el.querySelectorAll !== 'function') return;
            if (this.sanitizer.isPluginOwnElement && this.sanitizer.isPluginOwnElement(el)) return;
            try {
                const attrNodes = el.querySelectorAll('[placeholder],[data-placeholder],[aria-placeholder],[title],[data-tooltip]');
                for (let i = 0; i < attrNodes.length; i++) {
                    this.translateElementAttrs(attrNodes[i]);
                }
                const overlayNodes = el.querySelectorAll('[aria-hidden="true"],[data-placeholder],[class*="placeholder"]');
                for (let i = 0; i < overlayNodes.length; i++) {
                    const ov = overlayNodes[i];
                    if (!this.sanitizer.isElementImmune(ov)) {
                        this.translateTree(ov);
                    }
                }
            } catch (_) {}
        }

        translateTree(root) {
            if (!root || !root.isConnected) return;
            if (this.sanitizer.isElementImmune(root)) {
                this.restoreImmuneSubtree(root);
                if (root.nodeType === 1) {
                    this.translateElementAttrs(root);
                    this.handleImmuneContainerOverlays(root);
                    if (root.shadowRoot && !(this.sanitizer.isPluginOwnElement && this.sanitizer.isPluginOwnElement(root))) {
                        this.observeShadowRoot(root.shadowRoot);
                        this.translateTree(root.shadowRoot);
                    }
                }
                try {
                    if (root.getAttribute && root.getAttribute('data-testid') === 'user-input-step') {
                        const bar = root.querySelector('[data-testid="user-message-actions"]');
                        if (bar) this.translateTree(bar);
                    }
                } catch (_) {}
                return;
            }

            if (root.nodeType === 1) {
                this.translateElementAttrs(root);
                if (root.shadowRoot) {
                    this.observeShadowRoot(root.shadowRoot);
                    this.translateTree(root.shadowRoot);
                }
            }

            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        if (node.nodeType === 1) {
                            if (this.sanitizer.isElementImmune(node)) {
                                this.restoreImmuneSubtree(node);
                                this.translateElementAttrs(node);
                                this.handleImmuneContainerOverlays(node);
                                if (node.shadowRoot && !(this.sanitizer.isPluginOwnElement && this.sanitizer.isPluginOwnElement(node))) {
                                    this.observeShadowRoot(node.shadowRoot);
                                    this.translateTree(node.shadowRoot);
                                }
                                try {
                                    if (node.getAttribute && node.getAttribute('data-testid') === 'user-input-step') {
                                        const bar = node.querySelector('[data-testid="user-message-actions"]');
                                        if (bar) this.scheduleTimer(() => { if (this.active) this.translateTree(bar); }, 0);
                                    }
                                } catch (_) {}
                                return NodeFilter.FILTER_REJECT;
                            }
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        if (node.nodeType === 3) {
                            const p = node.parentElement;
                            if (p && this.sanitizer.isElementImmune(p)) {
                                this.restoreTextNode(node);
                                return NodeFilter.FILTER_REJECT;
                            }
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                },
                false
            );

            let node;
            while ((node = walker.nextNode())) {
                if (node.nodeType === 3) {
                    this.translateTextNode(node);
                } else if (node.nodeType === 1) {
                    this.translateElementAttrs(node);
                    if (node.shadowRoot) {
                        this.observeShadowRoot(node.shadowRoot);
                        this.translateTree(node.shadowRoot);
                    }
                }
            }
        }

        translateTextNode(node) {
            if (!node || !node.isConnected) return;
            const parent = node.parentElement;
            if (parent && this.sanitizer.isElementImmune(parent)) {
                this.restoreTextNode(node);
                return;
            }

            const text = node.nodeValue;
            if (!this.sanitizer.isTranslatableText(text)) return;

            // React reuse / text mutation check:
            // If previously translated and current nodeValue still matches our translation, skip.
            if (node.__agyTranslated) {
                if (text === node.__agyTranslatedText) {
                    return;
                }
                // Host/React overwrote nodeValue with new text -> reset state and re-translate
                delete node.__agyTranslated;
                delete node.__agyTranslatedText;
                delete node.__agyOrigText;
                delete node.__agyEpoch;
            }

            if (node.__agyEpoch === this.scanEpoch && text === node.__agyOrigText) {
                return;
            }

            const orig = node.__agyOrigText !== undefined ? node.__agyOrigText : text;
            node.__agyOrigText = orig;
            node.__agyEpoch = this.scanEpoch;

            const translated = this.engine.translate(orig, { element: parent, attrName: null });
            if (translated && translated !== orig) {
                node.nodeValue = translated;
                node.__agyTranslated = true;
                node.__agyTranslatedText = translated;
            }
        }

        translateElementAttrs(el) {
            if (!el || el.nodeType !== 1) return;
            if (this.sanitizer.isPluginOwnElement && this.sanitizer.isPluginOwnElement(el)) return;
            for (let i = 0; i < this.TRANSLATABLE_ATTRS.length; i++) {
                this.translateElementAttr(el, this.TRANSLATABLE_ATTRS[i]);
            }
        }

        translateElementAttr(el, attr) {
            if (!el || el.nodeType !== 1 || !el.hasAttribute(attr)) return;
            const val = el.getAttribute(attr);
            if (!val || !this.sanitizer.isTranslatableText(val)) return;

            if (!el.__agyOrigAttrs) el.__agyOrigAttrs = {};
            if (!el.__agyTranslatedAttrs) el.__agyTranslatedAttrs = {};
            if (!el.__agyAttrEpoch) el.__agyAttrEpoch = {};

            // Detect host/React dynamically changing the attribute value on an existing element
            if (el.__agyTranslatedAttrs[attr] !== undefined && val !== el.__agyTranslatedAttrs[attr]) {
                el.__agyOrigAttrs[attr] = val;
                delete el.__agyTranslatedAttrs[attr];
                delete el.__agyAttrEpoch[attr];
            } else if (el.__agyOrigAttrs[attr] === undefined) {
                el.__agyOrigAttrs[attr] = val;
            }

            const orig = el.__agyOrigAttrs[attr];
            if (el.__agyAttrEpoch[attr] === this.scanEpoch &&
                (val === orig || val === el.__agyTranslatedAttrs[attr])) {
                return;
            }
            el.__agyAttrEpoch[attr] = this.scanEpoch;

            const zh = this.engine.translate(orig, { element: el, attrName: attr });
            if (zh && zh !== orig) {
                el.setAttribute(attr, zh);
                el.__agyTranslatedAttrs[attr] = zh;
            }
        }

        translateDocumentTitle() {
            if (!document.title) return;
            if (document.__agyTranslatedTitle && document.title !== document.__agyTranslatedTitle) {
                document.__agyOrigTitle = document.title;
            } else if (document.__agyOrigTitle === undefined) {
                document.__agyOrigTitle = document.title;
            }
            const zh = this.engine.translate(document.__agyOrigTitle, { attrName: 'title' });
            if (zh && zh !== document.title) {
                document.__agyTranslatedTitle = zh;
                if (this.origTitleProtoSet) {
                    this.origTitleProtoSet.call(document, zh);
                } else {
                    document.title = zh;
                }
            }
        }

        hookHistory() {
            const self = this;
            // Routers (e.g. TanStack) may invoke history methods unbound: `(c ? h.pushState : h.replaceState)(...)`.
            // Re-bind to `history` so the native method never sees a foreign/undefined receiver (Illegal invocation).
            const recv = (ctx) => (typeof History !== 'undefined' && ctx instanceof History) ? ctx : history;
            try {
                if (typeof history !== 'undefined' && !history.__agyHooked) {
                    this.origPushState = history.pushState;
                    this.origReplaceState = history.replaceState;
                    if (typeof this.origPushState === 'function') {
                        this.hookedPushState = function() {
                            const r = self.origPushState.apply(recv(this), arguments);
                            self.scheduleTimer(() => { if (self.active) self.safeScan(); }, 50);
                            return r;
                        };
                        history.pushState = this.hookedPushState;
                    }
                    if (typeof this.origReplaceState === 'function') {
                        this.hookedReplaceState = function() {
                            const r = self.origReplaceState.apply(recv(this), arguments);
                            self.scheduleTimer(() => { if (self.active) self.safeScan(); }, 50);
                            return r;
                        };
                        history.replaceState = this.hookedReplaceState;
                    }
                    history.__agyHooked = true;
                    this.historyHookedByUs = true;
                }
                if (this.boundPopstateScan) {
                    window.removeEventListener('popstate', this.boundPopstateScan);
                }
                this.boundPopstateScan = () => self.scheduleTimer(() => { if (self.active) self.safeScan(); }, 50);
                window.addEventListener('popstate', this.boundPopstateScan);
            } catch (_) {}
        }

        unhookHistory() {
            try {
                if (this.historyHookedByUs && typeof history !== 'undefined') {
                    // Only restore if our wrapper is still installed; never clobber a router's later override.
                    if (this.origPushState && history.pushState === this.hookedPushState) history.pushState = this.origPushState;
                    if (this.origReplaceState && history.replaceState === this.hookedReplaceState) history.replaceState = this.origReplaceState;
                    delete history.__agyHooked;
                    this.origPushState = null;
                    this.origReplaceState = null;
                    this.hookedPushState = null;
                    this.hookedReplaceState = null;
                    this.historyHookedByUs = false;
                }
            } catch (_) {}
        }

        hookShadowDOM() {
            const self = this;
            try {
                if (typeof Element === 'undefined' || !Element.prototype) return;
                const origAttach = Element.prototype.attachShadow;
                if (origAttach && !origAttach.__agyHooked) {
                    this.origAttachShadow = origAttach;
                    Element.prototype.attachShadow = function(init) {
                        const shadow = self.origAttachShadow.call(this, init);
                        try {
                            self.observeShadowRoot(shadow);
                            self.translateTree(shadow);
                        } catch (_) {}
                        return shadow;
                    };
                    Element.prototype.attachShadow.__agyHooked = true;
                    this.attachShadowHookedByUs = true;
                }
            } catch (_) {}
        }

        unhookShadowDOM() {
            try {
                if (this.attachShadowHookedByUs && typeof Element !== 'undefined' && Element.prototype && this.origAttachShadow) {
                    Element.prototype.attachShadow = this.origAttachShadow;
                    this.origAttachShadow = null;
                    this.attachShadowHookedByUs = false;
                }
            } catch (_) {}
        }

        hookTitle() {
            const self = this;
            try {
                if (typeof Document === 'undefined') return;
                const docTitleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title') ||
                                     (typeof HTMLDocument !== 'undefined' ? Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'title') : null);
                if (docTitleDesc && docTitleDesc.set && !docTitleDesc.set.__agyHooked) {
                    this.origTitleOwnDesc = Object.getOwnPropertyDescriptor(document, 'title');
                    this.origTitleProtoSet = docTitleDesc.set;
                    Object.defineProperty(document, 'title', {
                        configurable: true,
                        enumerable: true,
                        get: function() {
                            return docTitleDesc.get.call(document);
                        },
                        set: function(val) {
                            document.__agyOrigTitle = val;
                            let zh = val;
                            try { zh = self.engine.translate(val, { attrName: 'title' }) || val; } catch (_) {}
                            docTitleDesc.set.call(document, zh);
                            if (zh !== val) document.__agyTranslatedTitle = zh;
                        }
                    });
                    docTitleDesc.set.__agyHooked = true;
                    this.titleHookedByUs = true;
                }
            } catch (_) {}
        }

        unhookTitle() {
            try {
                if (this.titleHookedByUs) {
                    if (this.origTitleProtoSet) {
                        delete this.origTitleProtoSet.__agyHooked;
                    }
                    if (this.origTitleOwnDesc) {
                        Object.defineProperty(document, 'title', this.origTitleOwnDesc);
                    } else {
                        delete document.title;
                    }
                    delete document.__agyTranslatedTitle;
                    this.origTitleOwnDesc = undefined;
                    this.origTitleProtoSet = null;
                    this.titleHookedByUs = false;
                }
            } catch (_) {}
        }
    }

    exports.DOMAdapter = DOMAdapter;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.__HakimiDOMAdapter = {}));
