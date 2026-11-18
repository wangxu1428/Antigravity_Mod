// =============================================================================
// Hakimi Side-Dock Plugin: ai-sidedock.js
// Three-Titan Lazy-Loaded Assistant Panel (Gemini / ChatGPT / Grok)
// =============================================================================
(function () {
    console.log('[SideDock] Initializing Hakimi Side-Dock Plugin...');

    const TABS_DEF = {
        gemini: {
            id: 'gemini',
            name: '云端本喵',
            icon: '🐾',
            url: 'https://gemini.google.com/app',
            partition: 'persist:hakimi_gemini'
        },
        gpt: {
            id: 'gpt',
            name: 'GPT网页',
            icon: '💬',
            url: 'https://chatgpt.com',
            partition: 'persist:hakimi_gpt'
        },
        grok: {
            id: 'grok',
            name: 'Grok',
            icon: '⚡',
            url: 'https://grok.com',
            partition: 'persist:hakimi_grok'
        }
    };

    let config = {
        width: 450,
        collapsed: true,
        activeTab: 'gemini'
    };

    const loadedWebviews = {};
    let isResizing = false;
    let currentWidth = 450;
    let isCollapsed = true;
    let activeTabId = 'gemini';
    let lazyMountTimer = null;
    let toastTimer = null;

    function clampWidth(w) {
        const minW = 340;
        const maxW = Math.max(380, Math.floor(window.innerWidth * 0.65));
        return Math.round(Math.max(minW, Math.min(Number(w) || 450, maxW)));
    }

    function syncDockOffset() {
        const offset = isCollapsed ? '0px' : `${currentWidth}px`;
        document.documentElement.style.setProperty('--hakimi-dock-offset', offset);
    }

    function injectStyles() {
        let style = document.getElementById('hakimi-sidedock-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'hakimi-sidedock-styles';
            document.head.appendChild(style);
        }
        style.textContent = `
            .agy-inset-shell {
                width: calc(100% - var(--hakimi-dock-offset, 0px)) !important;
                max-width: calc(100% - var(--hakimi-dock-offset, 0px)) !important;
                transition: width 0.16s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.16s cubic-bezier(0.16, 1, 0.3, 1);
            }
            body.hakimi-sidedock-resizing .agy-inset-shell {
                transition: none !important;
            }
            #hakimi-sidedock-root {
                position: fixed;
                top: 35px;
                right: 0;
                bottom: 0;
                z-index: 99998;
                display: flex;
                flex-direction: row;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                box-sizing: border-box;
                pointer-events: auto;
                user-select: none;
                -webkit-app-region: no-drag;
                will-change: transform;
                transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #hakimi-sidedock-root.collapsed {
                transform: translateX(100%);
            }
            #hakimi-sidedock-root.collapsed #hakimi-sidedock-resizer {
                display: none;
            }
            #hakimi-sidedock-root.resizing {
                transition: none !important;
            }
            #hakimi-sidedock-trigger {
                position: fixed;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 32px;
                height: 84px;
                background: var(--vscode-sideBar-background, #1f1f23);
                color: var(--vscode-foreground, #e4e4e7);
                border: 1px solid var(--vscode-sideBar-border, #3f3f46);
                border-right: none;
                border-radius: 8px 0 0 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 99997;
                box-shadow: -2px 0 8px rgba(0,0,0,0.25);
                transition: background 0.15s, opacity 0.2s, width 0.15s;
                opacity: 0.9;
                padding: 4px 0;
                gap: 4px;
                -webkit-app-region: no-drag;
            }
            #hakimi-sidedock-trigger:hover {
                background: var(--vscode-list-hoverBackground, #27272a);
                opacity: 1;
                width: 36px;
            }
            #hakimi-sidedock-trigger span.icon {
                font-size: 16px;
            }
            #hakimi-sidedock-trigger span.label {
                font-size: 11px;
                writing-mode: vertical-rl;
                letter-spacing: 2px;
                font-weight: 500;
            }
            #hakimi-sidedock-resizer {
                position: absolute;
                top: 0;
                bottom: 0;
                left: -6px;
                width: 12px;
                cursor: col-resize;
                background: transparent;
                z-index: 10000;
                touch-action: none;
                -webkit-app-region: no-drag;
            }
            #hakimi-sidedock-resizer::after {
                content: "";
                position: absolute;
                top: 0;
                bottom: 0;
                left: 5px;
                width: 2px;
                background: transparent;
                transition: background 0.12s;
            }
            #hakimi-sidedock-resizer:hover::after,
            #hakimi-sidedock-resizer.resizing::after {
                background: var(--vscode-focusBorder, #3b82f6);
            }
            #hakimi-sidedock-root.resizing,
            #hakimi-sidedock-root.resizing * {
                user-select: none !important;
            }
            #hakimi-sidedock-root.resizing #hakimi-sidedock-content,
            #hakimi-sidedock-root.resizing webview {
                pointer-events: none !important;
            }
            #hakimi-sidedock-resize-shield {
                display: none;
                position: fixed;
                top: 35px;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 2147483647;
                cursor: col-resize;
                background: rgba(0, 0, 0, 0.002);
            }
            #hakimi-sidedock-resize-shield.active {
                display: block;
            }
            #hakimi-sidedock-panel {
                display: flex;
                flex-direction: column;
                height: 100%;
                padding-left: 2px;
                box-sizing: border-box;
                will-change: width;
                contain: layout style;
                background: var(--vscode-sideBar-background, #18181b);
                color: var(--vscode-foreground, #f4f4f5);
                border-left: 1px solid var(--vscode-sideBar-border, #27272a);
                box-shadow: -4px 0 16px rgba(0,0,0,0.3);
                overflow: hidden;
            }
            #hakimi-sidedock-header {
                height: 40px;
                min-height: 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 6px;
                background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,0.03));
                border-bottom: 1px solid var(--vscode-sideBar-border, #27272a);
                gap: 4px;
                overflow: hidden;
            }
            .hakimi-tab-group {
                display: flex;
                align-items: center;
                gap: 2px;
                min-width: 0;
            }
            .hakimi-tab-btn {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 4px;
                color: var(--vscode-descriptionForeground, #a1a1aa);
                font-size: 11px;
                padding: 4px 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 2px;
                transition: background 0.15s ease, color 0.15s ease;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .hakimi-tab-btn:hover {
                background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
                color: var(--vscode-foreground, #ffffff);
            }
            .hakimi-tab-btn.active {
                background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.12));
                color: var(--vscode-foreground, #ffffff);
                font-weight: 600;
                border-bottom: 2px solid var(--vscode-focusBorder, #3b82f6);
            }
            .hakimi-action-group {
                display: flex;
                align-items: center;
                gap: 2px;
                flex-shrink: 0;
            }
            .hakimi-icon-btn {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 4px;
                color: var(--vscode-foreground, #d4d4d8);
                font-size: 11px;
                padding: 4px 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 2px;
                transition: background 0.15s, color 0.15s;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .hakimi-icon-btn:hover {
                background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.08));
                color: #ffffff;
            }
            #hakimi-sidedock-content {
                flex: 1;
                position: relative;
                width: 100%;
                height: calc(100% - 40px);
                overflow: hidden;
                background: var(--vscode-editor-background, #121214);
            }
            #hakimi-sidedock-toast {
                position: absolute;
                bottom: 16px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: rgba(24, 24, 27, 0.92);
                color: #f4f4f5;
                border: 1px solid rgba(255,255,255,0.15);
                backdrop-filter: blur(8px);
                padding: 6px 14px;
                border-radius: 6px;
                font-size: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s, transform 0.2s;
                z-index: 100;
                white-space: nowrap;
            }
            #hakimi-sidedock-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        `;
    }

    function showToast(msg) {
        let toast = document.getElementById('hakimi-sidedock-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'hakimi-sidedock-toast';
            const root = document.getElementById('hakimi-sidedock-root');
            if (root) root.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2600);
    }

    function saveConfigState() {
        if (window.hakimiHost && typeof window.hakimiHost.saveConfig === 'function') {
            window.hakimiHost.saveConfig({
                sidedock: {
                    width: currentWidth,
                    collapsed: isCollapsed,
                    activeTab: activeTabId
                }
            });
        }
    }

    function mountWebviewNow(tabId) {
        const content = document.getElementById('hakimi-sidedock-content');
        if (!content) return;

        Object.keys(loadedWebviews).forEach(id => {
            if (loadedWebviews[id]) {
                loadedWebviews[id].style.display = id === tabId ? 'flex' : 'none';
            }
        });

        if (!loadedWebviews[tabId]) {
            const existing = content.querySelector(`#hakimi-wv-${tabId}`);
            if (existing) {
                existing.style.display = 'flex';
                loadedWebviews[tabId] = existing;
                return;
            }
            const def = TABS_DEF[tabId];
            if (def) {
                console.log(`[SideDock] Lazy loading webview for ${def.name} (${def.url})...`);
                const wv = document.createElement('webview');
                wv.id = `hakimi-wv-${tabId}`;
                wv.src = def.url;
                wv.setAttribute('partition', def.partition);
                wv.setAttribute('allowpopups', '');
                wv.style.cssText = 'width: 100%; height: 100%; border: none; display: flex;';
                content.appendChild(wv);
                loadedWebviews[tabId] = wv;
                showToast(`正在装载 ${def.name} 舱室... 🐾`);
            }
        }
    }

    function switchTab(tabId, opts = {}) {
        const { delayMs = 0, skipSave = false } = opts;
        activeTabId = tabId;

        if (lazyMountTimer) {
            clearTimeout(lazyMountTimer);
            lazyMountTimer = null;
        }

        const buttons = document.querySelectorAll('.hakimi-tab-btn');
        buttons.forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const existingWv = loadedWebviews[tabId] || document.getElementById(`hakimi-wv-${tabId}`);
        if (delayMs > 0 && !existingWv) {
            Object.keys(loadedWebviews).forEach(id => {
                if (loadedWebviews[id]) {
                    loadedWebviews[id].style.display = 'none';
                }
            });
            lazyMountTimer = setTimeout(() => {
                lazyMountTimer = null;
                if (!isCollapsed && activeTabId === tabId) {
                    mountWebviewNow(tabId);
                }
            }, delayMs);
        } else {
            mountWebviewNow(tabId);
        }

        if (!skipSave) {
            saveConfigState();
        }
    }

    async function feedText() {
        let text = '';
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) {
            text = sel.toString().trim();
        }
        if (!text && navigator.clipboard) {
            try {
                text = (await navigator.clipboard.readText()).trim();
            } catch (e) {
                console.warn('[SideDock] Clipboard read error:', e);
            }
        }
        if (!text) {
            showToast('请先选中页面文本或复制文字 🐾');
            return;
        }

        const wv = loadedWebviews[activeTabId];
        if (!wv) {
            showToast('当前标签尚未装载，请先点击展开 🐾');
            return;
        }

        const script = `
            (function(val) {
                const el = document.querySelector('#prompt-textarea') ||
                           document.querySelector('div.ql-editor[contenteditable="true"]') ||
                           document.querySelector('div[contenteditable="true"]') ||
                           document.querySelector('textarea') ||
                           document.activeElement;
                if (el) {
                    el.focus();
                    if (el.isContentEditable) {
                        document.execCommand('insertText', false, val);
                    } else if (typeof el.value !== 'undefined') {
                        const s = el.selectionStart || 0;
                        const e = el.selectionEnd || 0;
                        el.setRangeText(val, s, e, 'end');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            })(${JSON.stringify(text)});
        `;

        try {
            await wv.executeJavaScript(script);
            const preview = text.length > 15 ? text.substring(0, 15) + '...' : text;
            showToast(`已投喂: "${preview}" 🐾`);
        } catch (err) {
            console.error('[SideDock] Feed failed:', err);
            showToast('投喂失败: ' + err.message);
        }
    }

    async function launchDesktopGPT() {
        if (window.hakimiHost && typeof window.hakimiHost.launchDesktopGpt === 'function') {
            try {
                showToast('正在唤起官方 ChatGPT 桌面端... 🖥️');
                const res = await window.hakimiHost.launchDesktopGpt();
                if (res && res.success) {
                    showToast('已唤起 ChatGPT 桌面端 🐾');
                } else {
                    showToast('唤起失败: ' + (res?.error || '未找到桌面客户端'));
                }
            } catch (e) {
                showToast('唤起异常: ' + e.message);
            }
        }
    }

    function hotReloadPlugins() {
        if (window.HakimiPluginHost && typeof window.HakimiPluginHost.reloadPlugins === 'function') {
            window.HakimiPluginHost.reloadPlugins();
            showToast('正在热重载挂件插件... 🔄');
        } else if (window.HakimiPluginHost && typeof window.HakimiPluginHost.reload === 'function') {
            window.HakimiPluginHost.reload();
        } else {
            window.location.reload();
        }
    }

    function toggleCollapse(forceState) {
        const root = document.getElementById('hakimi-sidedock-root');
        const trigger = document.getElementById('hakimi-sidedock-trigger');
        if (!root) return;

        isCollapsed = typeof forceState === 'boolean' ? forceState : !isCollapsed;

        if (isCollapsed) {
            if (lazyMountTimer) {
                clearTimeout(lazyMountTimer);
                lazyMountTimer = null;
            }
            root.classList.add('collapsed');
            if (trigger) trigger.style.display = 'flex';
        } else {
            root.classList.remove('collapsed');
            if (trigger) trigger.style.display = 'none';
            const existingWv = loadedWebviews[activeTabId] || document.getElementById(`hakimi-wv-${activeTabId}`);
            switchTab(activeTabId, {
                delayMs: existingWv ? 0 : 160,
                skipSave: true
            });
        }
        syncDockOffset();
        saveConfigState();
    }

    function initSideDock(savedConfig) {
        if (typeof window.__hakimiSideDockTeardown === 'function') {
            try {
                window.__hakimiSideDockTeardown();
            } catch (e) {
                console.warn('[SideDock] Previous teardown error:', e);
            }
        }

        if (savedConfig && savedConfig.sidedock) {
            config = { ...config, ...savedConfig.sidedock };
        }
        currentWidth = clampWidth(config.width || 450);
        isCollapsed = config.collapsed !== undefined ? config.collapsed : true;
        activeTabId = TABS_DEF[config.activeTab] ? config.activeTab : 'gemini';

        injectStyles();
        syncDockOffset();

        // 1. Floating trigger pill
        let trigger = document.getElementById('hakimi-sidedock-trigger');
        if (trigger) trigger.remove();
        trigger = document.createElement('div');
        trigger.id = 'hakimi-sidedock-trigger';
        trigger.title = '展开 AI 挂件舱 (Side-Dock)';
        trigger.innerHTML = `
            <span class="icon">🐾</span>
            <span class="label">AI挂件</span>
        `;
        const onTriggerClick = () => toggleCollapse(false);
        trigger.addEventListener('click', onTriggerClick);
        document.body.appendChild(trigger);

        // 2. Main root container (reuse if already mounted to keep <webview> alive)
        let root = document.getElementById('hakimi-sidedock-root');
        let panel;
        let header;
        let content;
        let resizer;

        if (root && root.querySelector('#hakimi-sidedock-panel') && root.querySelector('#hakimi-sidedock-content')) {
            panel = root.querySelector('#hakimi-sidedock-panel');
            content = root.querySelector('#hakimi-sidedock-content');

            // Recover existing webviews without detaching them from DOM
            content.querySelectorAll('webview[id^="hakimi-wv-"]').forEach(wv => {
                const tid = wv.id.replace('hakimi-wv-', '');
                if (TABS_DEF[tid]) {
                    wv.style.width = '100%';
                    wv.style.minWidth = '';
                    wv.style.flexShrink = '';
                    loadedWebviews[tid] = wv;
                }
            });

            const oldResizer = root.querySelector('#hakimi-sidedock-resizer');
            if (oldResizer) oldResizer.remove();
            resizer = document.createElement('div');
            resizer.id = 'hakimi-sidedock-resizer';
            root.insertBefore(resizer, panel);

            header = panel.querySelector('#hakimi-sidedock-header');
            if (!header) {
                header = document.createElement('div');
                header.id = 'hakimi-sidedock-header';
                panel.insertBefore(header, content);
            } else {
                header.innerHTML = '';
            }
        } else {
            if (root) root.remove();
            root = document.createElement('div');
            root.id = 'hakimi-sidedock-root';

            resizer = document.createElement('div');
            resizer.id = 'hakimi-sidedock-resizer';
            root.appendChild(resizer);

            panel = document.createElement('div');
            panel.id = 'hakimi-sidedock-panel';

            header = document.createElement('div');
            header.id = 'hakimi-sidedock-header';
            panel.appendChild(header);

            content = document.createElement('div');
            content.id = 'hakimi-sidedock-content';
            panel.appendChild(content);

            root.appendChild(panel);
            document.body.appendChild(root);
        }

        panel.style.width = currentWidth + 'px';
        root.classList.remove('resizing');
        if (isCollapsed) {
            root.classList.add('collapsed');
            trigger.style.display = 'flex';
        } else {
            root.classList.remove('collapsed');
            trigger.style.display = 'none';
        }

        // Tabs
        const tabGroup = document.createElement('div');
        tabGroup.className = 'hakimi-tab-group';
        Object.keys(TABS_DEF).forEach(k => {
            const def = TABS_DEF[k];
            const btn = document.createElement('button');
            btn.className = `hakimi-tab-btn ${k === activeTabId ? 'active' : ''}`;
            btn.dataset.tab = k;
            btn.innerHTML = `<span>${def.icon}</span><span>${def.name}</span>`;
            btn.addEventListener('click', () => switchTab(k));
            tabGroup.appendChild(btn);
        });
        header.appendChild(tabGroup);

        // Actions
        const actionGroup = document.createElement('div');
        actionGroup.className = 'hakimi-action-group';

        const feedBtn = document.createElement('button');
        feedBtn.className = 'hakimi-icon-btn';
        feedBtn.title = '投喂选中/剪贴板文字到当前 Webview';
        feedBtn.innerHTML = `<span>📋</span><span>投喂</span>`;
        feedBtn.addEventListener('click', feedText);
        actionGroup.appendChild(feedBtn);

        const gptBtn = document.createElement('button');
        gptBtn.className = 'hakimi-icon-btn';
        gptBtn.title = '唤起官方 ChatGPT 桌面端应用';
        gptBtn.innerHTML = `<span>🖥️</span><span>桌面GPT</span>`;
        gptBtn.addEventListener('click', launchDesktopGPT);
        actionGroup.appendChild(gptBtn);

        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'hakimi-icon-btn';
        reloadBtn.title = '热重载挂件插件 (Ctrl+R)';
        reloadBtn.innerHTML = `<span>🔄</span>`;
        reloadBtn.addEventListener('click', hotReloadPlugins);
        actionGroup.appendChild(reloadBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'hakimi-icon-btn';
        closeBtn.title = '收起侧边栏';
        closeBtn.innerHTML = `<span>✕</span>`;
        closeBtn.addEventListener('click', () => toggleCollapse(true));
        actionGroup.appendChild(closeBtn);

        header.appendChild(actionGroup);

        // Resize shield (hidden when idle so top 35px drag region stays 100% intact)
        let shield = document.getElementById('hakimi-sidedock-resize-shield');
        if (!shield) {
            shield = document.createElement('div');
            shield.id = 'hakimi-sidedock-resize-shield';
            document.body.appendChild(shield);
        }
        shield.classList.remove('active');
        document.body.classList.remove('hakimi-sidedock-resizing');

        // rAF Outer-Split Resizing Engine (<webview> stays width:100% pinned to right edge)
        let activePointerId = null;
        let grabOffset = 0;
        let pendingWidth = null;
        let rafId = null;

        const detachDragListeners = () => {
            window.removeEventListener('pointermove', onDragMove, true);
            window.removeEventListener('mousemove', onDragMove, true);
            window.removeEventListener('pointerup', onDragEnd, true);
            window.removeEventListener('mouseup', onDragEnd, true);
            window.removeEventListener('pointercancel', onDragEnd, true);
            window.removeEventListener('blur', onWindowBlur);
        };

        const applyWidth = (w) => {
            currentWidth = w;
            panel.style.width = currentWidth + 'px';
            syncDockOffset();
        };

        const stopResize = (skipSave = false) => {
            if (!isResizing) return;
            isResizing = false;

            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (pendingWidth !== null) {
                applyWidth(pendingWidth);
                pendingWidth = null;
            }

            document.body.classList.remove('hakimi-sidedock-resizing');
            root.classList.remove('resizing');
            resizer.classList.remove('resizing');
            shield.classList.remove('active');

            if (activePointerId !== null && typeof resizer.hasPointerCapture === 'function') {
                try {
                    if (resizer.hasPointerCapture(activePointerId)) {
                        resizer.releasePointerCapture(activePointerId);
                    }
                } catch (_) {}
            }
            activePointerId = null;
            detachDragListeners();

            if (!skipSave) {
                saveConfigState();
            }
        };

        const scheduleResizeWidth = (clientX) => {
            pendingWidth = clampWidth(window.innerWidth - clientX + grabOffset);
            if (rafId === null) {
                rafId = window.requestAnimationFrame(() => {
                    rafId = null;
                    if (!isResizing || pendingWidth === null) return;
                    applyWidth(pendingWidth);
                });
            }
        };

        const onDragMove = (ev) => {
            if (!isResizing) return;
            if ((ev.buttons & 1) === 0) {
                stopResize();
                return;
            }
            scheduleResizeWidth(ev.clientX);
        };

        const onDragEnd = () => stopResize();
        const onWindowBlur = () => stopResize();

        const onPointerDown = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const startW = panel.offsetWidth || currentWidth;
            grabOffset = e.clientX - (window.innerWidth - startW);
            pendingWidth = null;
            isResizing = true;
            activePointerId = e.pointerId;

            document.body.classList.add('hakimi-sidedock-resizing');
            root.classList.add('resizing');
            resizer.classList.add('resizing');
            shield.classList.add('active');

            if (typeof resizer.setPointerCapture === 'function') {
                try {
                    resizer.setPointerCapture(e.pointerId);
                } catch (_) {}
            }

            window.addEventListener('pointermove', onDragMove, true);
            window.addEventListener('mousemove', onDragMove, true);
            window.addEventListener('pointerup', onDragEnd, true);
            window.addEventListener('mouseup', onDragEnd, true);
            window.addEventListener('pointercancel', onDragEnd, true);
            window.addEventListener('blur', onWindowBlur);
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        resizer.addEventListener('lostpointercapture', onDragEnd);

        const onWindowResize = () => {
            const clamped = clampWidth(currentWidth);
            if (clamped !== currentWidth) {
                applyWidth(clamped);
            }
        };
        window.addEventListener('resize', onWindowResize);

        window.__hakimiSideDockTeardown = () => {
            stopResize(true);
            if (lazyMountTimer) {
                clearTimeout(lazyMountTimer);
                lazyMountTimer = null;
            }
            if (toastTimer) {
                clearTimeout(toastTimer);
                toastTimer = null;
            }
            document.body.classList.remove('hakimi-sidedock-resizing');
            window.removeEventListener('resize', onWindowResize);
            resizer.removeEventListener('pointerdown', onPointerDown);
            trigger.removeEventListener('click', onTriggerClick);
        };

        if (!isCollapsed) {
            const existingWv = loadedWebviews[activeTabId];
            switchTab(activeTabId, {
                delayMs: existingWv ? 0 : 160,
                skipSave: true
            });
        }
    }

    if (window.HakimiPluginHost && typeof window.HakimiPluginHost.register === 'function') {
        window.HakimiPluginHost.register('ai-sidedock', {
            name: 'AI Side-Dock Three-Titan',
            version: '1.1.0',
            init: function (cfg) {
                initSideDock(cfg);
            }
        });
    } else {
        if (window.hakimiHost && typeof window.hakimiHost.readConfig === 'function') {
            window.hakimiHost.readConfig().then(cfg => initSideDock(cfg)).catch(() => initSideDock({}));
        } else {
            initSideDock({});
        }
    }
})();
