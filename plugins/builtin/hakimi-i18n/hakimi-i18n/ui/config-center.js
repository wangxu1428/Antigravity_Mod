// =============================================================================
// Hakimi i18n - Configuration Center & DIY Manager UI
// =============================================================================
(function(exports) {
    'use strict';

    class ConfigCenterUI {
        constructor(engine, domAdapter, onSaveCallback) {
            this.engine = engine;
            this.domAdapter = domAdapter;
            this.onSave = onSaveCallback;
            this.activeTab = 'general';
            this.modalEl = null;
            this.triggerEl = null;
            this.isOpen = false;
            this.boundKeydown = null;
            this.closeTimer = null;
            this.editingCandidate = null;
            this.editingZhValue = '';
            this.quickEditStatus = null;
            this.isSavingQuick = false;
            this.addedCandidates = new Map();
            this.prefillOverrideEn = '';
            // AGM Hub integration (HakimiPluginHost >= 2.1): embedded config panel instead of pill + modal
            this.embeddedEl = null;
            this.hubPanelOff = null;
        }

        getHubUi() {
            const host = window.HakimiPluginHost;
            const ui = host && host.ui;
            return ui && typeof ui.registerDetailPanel === 'function' && typeof ui.openPluginDetail === 'function' ? ui : null;
        }

        init() {
            this.injectStyles();
            const hub = this.getHubUi();
            if (hub) {
                try {
                    this.hubPanelOff = hub.registerDetailPanel('hakimi-i18n', {
                        id: 'config',
                        title: '本地化配置',
                        order: 0,
                        render: (container) => this.mountEmbedded(container),
                        onLeave: () => this.unmountEmbedded(),
                    });
                } catch (e) {
                    console.warn('[Hakimi i18n] Hub panel registration failed, falling back to pill:', e);
                    this.hubPanelOff = null;
                }
            }
            if (!this.hubPanelOff) this.createTriggerPill();
            this.bindGlobalShortcuts();
        }

        destroy() {
            if (this.hubPanelOff) {
                const off = this.hubPanelOff;
                this.hubPanelOff = null;
                try { off(); } catch (_) {}
            }
            this.unmountEmbedded();
            if (this.closeTimer) {
                clearTimeout(this.closeTimer);
                this.closeTimer = null;
            }
            if (this.boundKeydown) {
                window.removeEventListener('keydown', this.boundKeydown);
                this.boundKeydown = null;
            }
            if (this.modalEl) {
                this.modalEl.remove();
                this.modalEl = null;
            }
            if (this.triggerEl) {
                this.triggerEl.remove();
                this.triggerEl = null;
            }
            const style = document.getElementById('hakimi-i18n-style');
            if (style) style.remove();
            this.isOpen = false;
        }

        bindGlobalShortcuts() {
            if (this.boundKeydown) {
                window.removeEventListener('keydown', this.boundKeydown);
            }
            this.boundKeydown = (e) => {
                // Ctrl+Shift+L: Toggle Hakimi i18n Configuration Center
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
                    e.preventDefault();
                    this.toggle();
                }
            };
            window.addEventListener('keydown', this.boundKeydown);
        }

        createTriggerPill() {
            if (document.getElementById('hakimi-i18n-trigger')) return;
            const pill = document.createElement('div');
            pill.id = 'hakimi-i18n-trigger';
            pill.setAttribute('data-ag-localization-skip', 'true');
            pill.setAttribute('data-immune', 'true');
            pill.title = 'Hakimi i18n 本地化配置中心 (Ctrl+Shift+L)';
            pill.innerHTML = `
                <span class="icon">🐾</span>
                <span class="label">中/EN</span>
            `;
            pill.addEventListener('click', () => this.toggle());
            document.body.appendChild(pill);
            this.triggerEl = pill;
        }

        toggle() {
            const hub = this.hubPanelOff ? this.getHubUi() : null;
            if (hub) {
                if (this.embeddedEl && this.embeddedEl.isConnected && hub.isOpen()) hub.close();
                else this.open();
                return;
            }
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        open() {
            const hub = this.hubPanelOff ? this.getHubUi() : null;
            if (hub) {
                void hub.openPluginDetail('hakimi-i18n', 'config');
                return;
            }
            if (this.closeTimer) {
                clearTimeout(this.closeTimer);
                this.closeTimer = null;
            }
            if (this.isOpen) return;
            this.isOpen = true;
            this.renderModal();
        }

        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            if (this.closeTimer) {
                clearTimeout(this.closeTimer);
                this.closeTimer = null;
            }
            if (this.modalEl) {
                this.modalEl.classList.remove('active');
                this.closeTimer = setTimeout(() => {
                    this.closeTimer = null;
                    if (this.modalEl) this.modalEl.remove();
                    this.modalEl = null;
                }, 200);
            }
        }

        buildDialogHtml(embedded) {
            return `
                <div class="hakimi-i18n-dialog">
                    <div class="hakimi-header">
                        <div class="title-area">
                            <span class="cat-badge">🐾 Hakimi i18n</span>
                            <h2>本地化与 DIY 词典配置中心</h2>
                        </div>
                        <button class="close-btn" id="hakimi-close-btn">&times;</button>
                    </div>

                    <div class="hakimi-tabs">
                        <button class="tab-btn ${this.activeTab === 'general' ? 'active' : ''}" data-tab="general">常规设置</button>
                        <button class="tab-btn ${this.activeTab === 'overrides' ? 'active' : ''}" data-tab="overrides">DIY 词条覆盖</button>
                        <button class="tab-btn ${this.activeTab === 'exclusions' ? 'active' : ''}" data-tab="exclusions">永远保留英文</button>
                        <button class="tab-btn ${this.activeTab === 'glossary' ? 'active' : ''}" data-tab="glossary">专业术语表</button>
                        <button class="tab-btn ${this.activeTab === 'untranslated' ? 'active' : ''}" data-tab="untranslated">未翻译发现</button>
                        <button class="tab-btn ${this.activeTab === 'sync' ? 'active' : ''}" data-tab="sync">导入 / 导出</button>
                    </div>

                    <div class="hakimi-body" id="hakimi-tab-content">
                        <!-- Dynamic Tab Content -->
                    </div>

                    <div class="hakimi-footer">
                        <span class="footer-tip" id="hakimi-footer-tip">${embedded
                            ? '修改「常规设置」后点击右侧按钮生效 · <kbd>Ctrl+Shift+L</kbd> 快速打开本页'
                            : '快捷键: <kbd>Ctrl+Shift+L</kbd> 呼出 | <kbd>Ctrl+R</kbd> 热重载'}</span>
                        <div class="footer-actions">
                            <button class="btn btn-secondary" id="hakimi-btn-cancel">关闭</button>
                            <button class="btn btn-primary" id="hakimi-btn-apply">保存并立即生效</button>
                        </div>
                    </div>
                </div>
            `;
        }

        bindDialog(root) {
            root.querySelector('#hakimi-close-btn').addEventListener('click', () => this.close());
            root.querySelector('#hakimi-btn-cancel').addEventListener('click', () => this.close());
            root.querySelector('#hakimi-btn-apply').addEventListener('click', () => this.saveAndApply());
            root.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.activeTab = btn.getAttribute('data-tab');
                    this.renderTabContent();
                });
            });
        }

        // Render the full config center inside a host-provided container (AGM Hub detail panel).
        mountEmbedded(container) {
            this.unmountEmbedded();
            if (this.modalEl) {
                // Never keep two copies alive: tab content is looked up by element id.
                this.modalEl.remove();
                this.modalEl = null;
                this.isOpen = false;
            }
            const root = document.createElement('div');
            root.id = 'hakimi-i18n-modal-overlay';
            root.className = 'embedded active';
            root.setAttribute('data-ag-localization-skip', 'true');
            root.setAttribute('data-immune', 'true');
            root.innerHTML = this.buildDialogHtml(true);
            container.appendChild(root);
            this.embeddedEl = root;
            this.bindDialog(root);
            this.renderTabContent();
        }

        unmountEmbedded() {
            if (this.embeddedEl) {
                try { this.embeddedEl.remove(); } catch (_) {}
                this.embeddedEl = null;
            }
        }

        renderModal() {
            if (this.modalEl) this.modalEl.remove();
            this.unmountEmbedded();

            const modal = document.createElement('div');
            modal.id = 'hakimi-i18n-modal-overlay';
            modal.setAttribute('data-ag-localization-skip', 'true');
            modal.setAttribute('data-immune', 'true');
            modal.innerHTML = this.buildDialogHtml(false);

            document.body.appendChild(modal);
            this.modalEl = modal;
            this.bindDialog(modal);

            this.renderTabContent();
            requestAnimationFrame(() => modal.classList.add('active'));
        }

        renderTabContent() {
            const container = document.getElementById('hakimi-tab-content');
            if (!container) return;

            const cfg = this.engine.config;

            if (this.activeTab === 'general') {
                container.innerHTML = `
                    <div class="tab-pane">
                        <div class="form-group row">
                            <label>插件主开关</label>
                            <div class="toggle-switch">
                                <input type="checkbox" id="cfg-enabled" ${cfg.enabled ? 'checked' : ''}>
                                <label for="cfg-enabled"></label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>界面语言 (Language)</label>
                            <select id="cfg-language" class="form-control">
                                <option value="zh-CN" ${cfg.language === 'zh-CN' ? 'selected' : ''}>简体中文 (Simplified Chinese)</option>
                                <option value="en" ${cfg.language === 'en' ? 'selected' : ''}>English (Original)</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>翻译范围预设方案 (Presets)</label>
                            <div class="preset-group">
                                <button class="preset-btn ${cfg.preset === 'full' ? 'active' : ''}" data-preset="full">完整中文化</button>
                                <button class="preset-btn ${cfg.preset === 'basic' ? 'active' : ''}" data-preset="basic">基础界面</button>
                                <button class="preset-btn ${cfg.preset === 'tech' ? 'active' : ''}" data-preset="tech">技术增强</button>
                                <button class="preset-btn ${cfg.preset === 'custom' ? 'active' : ''}" data-preset="custom">自定义范围</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>详细模块开关 (Granular Scopes)</label>
                            <div class="scope-grid">
                                <label class="checkbox-label"><input type="checkbox" id="scope-menu" ${cfg.scope.menu ? 'checked' : ''}> 菜单与导航</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-settings" ${cfg.scope.settings ? 'checked' : ''}> 设置与配置</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-agent" ${cfg.scope.agent ? 'checked' : ''}> Agent 与工作流</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-models" ${cfg.scope.models ? 'checked' : ''}> 模型与参数说明</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-requests" ${cfg.scope.requests ? 'checked' : ''}> 请求数据与消耗</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-errors" ${cfg.scope.errors ? 'checked' : ''}> 错误与诊断</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-native" ${cfg.scope.native ? 'checked' : ''}> 原生右键与弹窗</label>
                                <label class="checkbox-label"><input type="checkbox" id="scope-plugins" ${cfg.scope.plugins ? 'checked' : ''}> 插件与扩展挂件</label>
                            </div>
                        </div>
                    </div>
                `;

                // Handle Preset Clicks
                container.querySelectorAll('.preset-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const preset = btn.getAttribute('data-preset');
                        this.applyPreset(preset);
                        this.renderTabContent();
                    });
                });
            } else if (this.activeTab === 'overrides') {
                const overrides = cfg.customOverrides || {};
                const keys = Object.keys(overrides);
                const prefillEn = this.prefillOverrideEn || '';
                this.prefillOverrideEn = '';
                container.innerHTML = `
                    <div class="tab-pane">
                        <div class="diy-add-box">
                            <input type="text" id="diy-en" value="${this.escapeHtml(prefillEn)}" placeholder="原英文 (如: New Conversation)" class="form-control">
                            <input type="text" id="diy-zh" placeholder="自定义中文 (如: 开启新对话)" class="form-control">
                            <button class="btn btn-primary" id="btn-add-override">+ 添加覆盖</button>
                        </div>

                        <div class="table-container">
                            <table class="diy-table">
                                <thead>
                                    <tr>
                                        <th style="width: 45%;">原始文本 (English)</th>
                                        <th style="width: 45%;">用户覆盖翻译 (Chinese)</th>
                                        <th style="width: 10%;">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${keys.length === 0 ? '<tr><td colspan="3" class="empty-tip">暂无自定义覆盖词条，随时在上方添加！</td></tr>' : ''}
                                    ${keys.map(k => `
                                        <tr>
                                            <td><code>${this.escapeHtml(k)}</code></td>
                                            <td>${this.escapeHtml(overrides[k])}</td>
                                            <td><button class="btn-del" data-key="${this.escapeHtml(k)}">删除</button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                if (prefillEn) {
                    const zhBox = container.querySelector('#diy-zh');
                    if (zhBox && typeof zhBox.focus === 'function') zhBox.focus();
                }

                container.querySelector('#btn-add-override').addEventListener('click', () => {
                    const en = container.querySelector('#diy-en').value.trim();
                    const zh = container.querySelector('#diy-zh').value.trim();
                    if (en && zh) {
                        // Dedupe case variants so duplicates never accumulate
                        const lowerEn = en.toLowerCase();
                        for (const existingKey of Object.keys(this.engine.config.customOverrides)) {
                            if (existingKey.toLowerCase() === lowerEn && existingKey !== en) {
                                delete this.engine.config.customOverrides[existingKey];
                            }
                        }
                        this.engine.config.customOverrides[en] = zh;
                        if (typeof this.engine.removeUntranslated === 'function') {
                            this.engine.removeUntranslated(en);
                        }
                        this.renderTabContent();
                    }
                });

                container.querySelectorAll('.btn-del').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const k = btn.getAttribute('data-key');
                        delete this.engine.config.customOverrides[k];
                        this.renderTabContent();
                    });
                });
            } else if (this.activeTab === 'exclusions') {
                const exclusions = this.engine.config.exclusions || [];
                container.innerHTML = `
                    <div class="tab-pane">
                        <p class="section-desc">被加入此列表的词条将永远保留原始英文，不受任何官方词典或正则规则翻译。</p>
                        <div class="diy-add-box">
                            <input type="text" id="ex-term" placeholder="输入永远保留英文的词条 (如: Docker)" class="form-control">
                            <button class="btn btn-primary" id="btn-add-ex">+ 添加保留项</button>
                        </div>
                        <div class="tag-cloud">
                            ${exclusions.map(t => `
                                <span class="tag-chip">
                                    ${this.escapeHtml(t)}
                                    <span class="tag-close" data-term="${this.escapeHtml(t)}">&times;</span>
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `;

                container.querySelector('#btn-add-ex').addEventListener('click', () => {
                    const t = container.querySelector('#ex-term').value.trim();
                    if (t && !this.engine.config.exclusions.includes(t)) {
                        this.engine.config.exclusions.push(t);
                        this.renderTabContent();
                    }
                });

                container.querySelectorAll('.tag-close').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const t = btn.getAttribute('data-term');
                        this.engine.config.exclusions = this.engine.config.exclusions.filter(x => x !== t);
                        this.renderTabContent();
                    });
                });
            } else if (this.activeTab === 'glossary') {
                const glossary = this.engine.config.glossary || {};
                const keys = Object.keys(glossary);
                container.innerHTML = `
                    <div class="tab-pane">
                        <p class="section-desc">专业术语表：在长句子或混合段落中，作为标准专业词汇进行无歧义替换。</p>
                        <div class="diy-add-box">
                            <input type="text" id="glo-en" placeholder="英文术语 (如: Token)" class="form-control">
                            <input type="text" id="glo-zh" placeholder="标准翻译 (如: 词元)" class="form-control">
                            <button class="btn btn-primary" id="btn-add-glo">+ 添加术语</button>
                        </div>
                        <div class="table-container">
                            <table class="diy-table">
                                <thead>
                                    <tr>
                                        <th>英文术语</th>
                                        <th>中文规范</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${keys.length === 0 ? '<tr><td colspan="3" class="empty-tip">暂无专业术语，可自行扩展！</td></tr>' : ''}
                                    ${keys.map(k => `
                                        <tr>
                                            <td><strong>${this.escapeHtml(k)}</strong></td>
                                            <td>${this.escapeHtml(glossary[k])}</td>
                                            <td><button class="btn-del-glo" data-key="${this.escapeHtml(k)}">删除</button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                container.querySelector('#btn-add-glo').addEventListener('click', () => {
                    const en = container.querySelector('#glo-en').value.trim();
                    const zh = container.querySelector('#glo-zh').value.trim();
                    if (en && zh) {
                        this.engine.config.glossary[en] = zh;
                        this.renderTabContent();
                    }
                });

                container.querySelectorAll('.btn-del-glo').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const k = btn.getAttribute('data-key');
                        delete this.engine.config.glossary[k];
                        this.renderTabContent();
                    });
                });
            } else if (this.activeTab === 'untranslated') {
                const list = this.engine.getUntranslatedList('default');
                const statusHtml = this.quickEditStatus
                    ? `<div id="hakimi-quick-status" class="hakimi-status-banner status-${this.escapeHtml(this.quickEditStatus.type)}">${this.escapeHtml(this.quickEditStatus.message)}</div>`
                    : '';
                const editorHtml = this.editingCandidate !== null ? `
                    <div id="hakimi-quick-edit-box" class="quick-edit-box">
                        <div class="quick-edit-header">
                            <span class="editing-badge">正在编辑 DIY 词条</span>
                            <button class="btn btn-sm btn-secondary" id="btn-quick-goto-diy">在 DIY 页面打开</button>
                        </div>
                        <div class="diy-add-box">
                            <input type="text" id="quick-diy-en" value="${this.escapeHtml(this.editingCandidate)}" placeholder="原英文" class="form-control">
                            <input type="text" id="quick-diy-zh" value="${this.escapeHtml(this.editingZhValue)}" placeholder="请输入中文翻译后保存..." class="form-control">
                            <button class="btn btn-primary" id="btn-quick-save">${this.isSavingQuick ? '保存中...' : '保存并生效'}</button>
                            <button class="btn btn-secondary" id="btn-quick-cancel">取消</button>
                        </div>
                    </div>
                ` : '';

                container.innerHTML = `
                    <div class="tab-pane">
                        <div class="untranslated-toolbar">
                            <p class="section-desc">仅展示经过 DOM 来源与文本分类过滤的「UI 文案」和「专业术语」候选（已自动过滤聊天正文、代码、路径与动态指标）。</p>
                            <button class="btn btn-sm btn-secondary" id="btn-clear-untranslated">清空记录</button>
                        </div>
                        ${statusHtml}
                        ${editorHtml}
                        <div class="table-container">
                            <table class="diy-table">
                                <thead>
                                    <tr>
                                        <th style="width: 36%;">未翻译文本</th>
                                        <th style="width: 13%;">类型</th>
                                        <th style="width: 15%;">来源</th>
                                        <th style="width: 10%;">频次</th>
                                        <th style="width: 26%;">快速操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${list.length === 0 ? '<tr><td colspan="5" class="empty-tip">界面汉化非常完整，暂无可疑未翻译 UI 文案！🐾</td></tr>' : ''}
                                    ${list.slice(0, 100).map(item => `
                                        <tr data-candidate="${this.escapeHtml(item.text)}">
                                            <td><code>${this.escapeHtml(item.text)}</code></td>
                                            <td><span class="badge-cat badge-${this.escapeHtml(item.categoryId || 'ui_copy')}">${this.escapeHtml(item.category || 'UI 文案')}</span></td>
                                            <td><span class="source-tag">${this.escapeHtml((item.sources || []).join(', ') || 'ui')}</span></td>
                                            <td>${item.count} 次</td>
                                            <td class="ops-cell">
                                                <button class="btn btn-sm btn-primary btn-quick-add" data-text="${this.escapeHtml(item.text)}">+ 翻译此词</button>
                                                <button class="btn btn-sm btn-secondary btn-keep-en" data-text="${this.escapeHtml(item.text)}">保留英文</button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                const clearBtn = container.querySelector('#btn-clear-untranslated');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        if (typeof this.engine.clearUntranslated === 'function') {
                            this.engine.clearUntranslated();
                        } else if (this.engine.untranslatedLogs) {
                            this.engine.untranslatedLogs.clear();
                        }
                        this.editingCandidate = null;
                        this.quickEditStatus = null;
                        this.renderTabContent();
                    });
                }

                // Focus Chinese input when inline editor is open
                if (this.editingCandidate !== null) {
                    const zhInput = container.querySelector('#quick-diy-zh');
                    const enInput = container.querySelector('#quick-diy-en');
                    if (zhInput && typeof zhInput.focus === 'function') {
                        zhInput.focus();
                    }
                    const saveBtn = container.querySelector('#btn-quick-save');
                    const cancelBtn = container.querySelector('#btn-quick-cancel');
                    const gotoBtn = container.querySelector('#btn-quick-goto-diy');

                    if (saveBtn) {
                        saveBtn.addEventListener('click', () => {
                            const enVal = enInput ? enInput.value : this.editingCandidate;
                            const zhVal = zhInput ? zhInput.value : '';
                            void this.saveQuickTranslation(enVal, zhVal);
                        });
                    }
                    if (zhInput) {
                        zhInput.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const enVal = enInput ? enInput.value : this.editingCandidate;
                                void this.saveQuickTranslation(enVal, zhInput.value);
                            }
                        });
                    }
                    if (cancelBtn) {
                        cancelBtn.addEventListener('click', () => {
                            this.editingCandidate = null;
                            this.editingZhValue = '';
                            this.quickEditStatus = null;
                            this.renderTabContent();
                        });
                    }
                    if (gotoBtn) {
                        gotoBtn.addEventListener('click', () => {
                            const enVal = enInput ? enInput.value.trim() : this.editingCandidate;
                            this.openInDiyOverridesTab(enVal);
                        });
                    }
                }

                container.querySelectorAll('.btn-quick-add').forEach(btn => {
                    btn.addEventListener('click', () => {
                        try {
                            const text = btn.getAttribute('data-text');
                            this.openQuickEditor(text);
                        } catch (err) {
                            this.quickEditStatus = {
                                type: 'error',
                                message: '✗ 打开编辑失败：' + (err && err.message ? err.message : String(err))
                            };
                            this.renderTabContent();
                        }
                    });
                });

                container.querySelectorAll('.btn-keep-en').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const text = btn.getAttribute('data-text');
                        void this.keepCandidateEnglish(text);
                    });
                });
            } else if (this.activeTab === 'sync') {
                container.innerHTML = `
                    <div class="tab-pane">
                        <p class="section-desc">将您的自定义覆盖、保留名单及专业术语表导出为 JSON，或导入他人的优质规则包。</p>
                        <div class="sync-actions">
                            <div class="sync-card">
                                <h3>导出 DIY 规则包</h3>
                                <p>导出包含自定义覆盖、排除项和专业术语的完整配置</p>
                                <button class="btn btn-primary" id="btn-export-json">导出为 JSON 文件</button>
                            </div>
                            <div class="sync-card">
                                <h3>导入 DIY 规则包</h3>
                                <p>选择外部 JSON 文件导入并合并覆盖当前规则</p>
                                <input type="file" id="file-import-json" accept=".json" style="display:none;">
                                <button class="btn btn-secondary" id="btn-import-json">选择 JSON 导入</button>
                            </div>
                        </div>
                    </div>
                `;

                container.querySelector('#btn-export-json').addEventListener('click', () => {
                    const data = {
                        version: '1.0.0',
                        exportDate: new Date().toISOString(),
                        customOverrides: this.engine.config.customOverrides || {},
                        exclusions: this.engine.config.exclusions || [],
                        glossary: this.engine.config.glossary || {}
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `hakimi_i18n_diy_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                });

                container.querySelector('#btn-import-json').addEventListener('click', () => {
                    container.querySelector('#file-import-json').click();
                });

                container.querySelector('#file-import-json').addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const imported = JSON.parse(event.target.result);
                            if (imported.customOverrides) {
                                this.engine.config.customOverrides = {
                                    ...this.engine.config.customOverrides,
                                    ...imported.customOverrides
                                };
                            }
                            if (Array.isArray(imported.exclusions)) {
                                this.engine.config.exclusions = Array.from(new Set([
                                    ...this.engine.config.exclusions,
                                    ...imported.exclusions
                                ]));
                            }
                            if (imported.glossary) {
                                this.engine.config.glossary = {
                                    ...this.engine.config.glossary,
                                    ...imported.glossary
                                };
                            }
                            alert('导入规则成功合并！点击下方“保存并立即生效”应用更改。🐾');
                            this.renderTabContent();
                        } catch (err) {
                            alert('导入失败: 无法解析 JSON 文件！');
                        }
                    };
                    reader.readAsText(file);
                });
            }
        }

        applyPreset(preset) {
            this.engine.config.preset = preset;
            if (preset === 'full') {
                this.engine.config.scope = {
                    menu: true, settings: true, agent: true, models: true,
                    requests: true, errors: true, native: true, plugins: true
                };
            } else if (preset === 'basic') {
                this.engine.config.scope = {
                    menu: true, settings: true, agent: false, models: false,
                    requests: false, errors: true, native: true, plugins: false
                };
            } else if (preset === 'tech') {
                this.engine.config.scope = {
                    menu: true, settings: true, agent: true, models: true,
                    requests: false, errors: true, native: true, plugins: true
                };
            }
        }

        async persistConfig() {
            if (typeof this.onSave !== 'function') return true;
            const res = await this.onSave(this.engine.config);
            if (res === false) {
                throw new Error('持久化写入返回失败 (false)');
            }
            return true;
        }

        openQuickEditor(text) {
            if (!text) return;
            this.editingCandidate = text;
            this.editingZhValue = '';
            this.quickEditStatus = {
                type: 'editing',
                message: '正在编辑候选词条：请填写中文翻译后点击「保存并生效」'
            };
            this.renderTabContent();
        }

        openInDiyOverridesTab(text) {
            this.prefillOverrideEn = text || '';
            this.activeTab = 'overrides';
            const root = this.modalEl || this.embeddedEl;
            if (root) {
                root.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-tab') === 'overrides');
                });
            }
            this.renderTabContent();
        }

        async saveQuickTranslation(enRaw, zhRaw) {
            if (this.isSavingQuick) return { ok: false, error: 'saving_in_progress' };

            const en = String(enRaw || '').trim();
            const zh = String(zhRaw || '').trim();

            if (!en) {
                this.quickEditStatus = {
                    type: 'error',
                    message: '✗ 保存失败：原始英文文本不能为空（候选词已保留，请重试）'
                };
                this.renderTabContent();
                return { ok: false, error: 'empty_source' };
            }
            if (!zh) {
                this.editingCandidate = en;
                this.editingZhValue = '';
                this.quickEditStatus = {
                    type: 'error',
                    message: '✗ 保存失败：中文翻译内容不能为空（候选词已保留，请重试）'
                };
                this.renderTabContent();
                return { ok: false, error: 'empty_translation' };
            }

            this.isSavingQuick = true;
            const prevOverrides = { ...(this.engine.config.customOverrides || {}) };
            try {
                const nextOverrides = { ...prevOverrides };
                const lowerEn = en.toLowerCase();
                for (const existingKey of Object.keys(nextOverrides)) {
                    if (existingKey.toLowerCase() === lowerEn && existingKey !== en) {
                        delete nextOverrides[existingKey];
                    }
                }
                nextOverrides[en] = zh;
                this.engine.config.customOverrides = nextOverrides;

                await this.persistConfig();

                this.engine.updateConfig(this.engine.config);
                if (typeof this.engine.removeUntranslated === 'function') {
                    this.engine.removeUntranslated(en);
                } else if (this.engine.untranslatedLogs) {
                    this.engine.untranslatedLogs.delete(en);
                }
                this.addedCandidates.set(en, zh);

                if (this.engine.config.enabled && this.engine.config.language === 'zh-CN' && this.domAdapter) {
                    this.domAdapter.start();
                    this.domAdapter.translateTree(document.body || document.documentElement);
                }

                this.editingCandidate = null;
                this.editingZhValue = '';
                this.quickEditStatus = {
                    type: 'success',
                    message: `✓ 保存成功：已将「${en} → ${zh}」写入 DIY 词典并立即生效！`
                };
                return { ok: true, key: en, value: zh };
            } catch (err) {
                // Rollback strictly so candidate stays preserved and user can retry
                this.engine.config.customOverrides = prevOverrides;
                this.editingCandidate = en;
                this.editingZhValue = zh;
                const msg = err && err.message ? err.message : String(err);
                this.quickEditStatus = {
                    type: 'error',
                    message: `✗ 保存失败：${msg}（候选词已保留，请重试）`
                };
                return { ok: false, error: err };
            } finally {
                this.isSavingQuick = false;
                this.renderTabContent();
            }
        }

        async keepCandidateEnglish(text) {
            if (!text) return { ok: false, error: 'empty_source' };
            const prevExclusions = Array.from(this.engine.config.exclusions || []);
            try {
                if (!prevExclusions.some(x => x.toLowerCase() === text.toLowerCase())) {
                    this.engine.config.exclusions = [...prevExclusions, text];
                }
                await this.persistConfig();
                this.engine.updateConfig(this.engine.config);
                if (typeof this.engine.removeUntranslated === 'function') {
                    this.engine.removeUntranslated(text);
                } else if (this.engine.untranslatedLogs) {
                    this.engine.untranslatedLogs.delete(text);
                }
                this.quickEditStatus = {
                    type: 'success',
                    message: `✓ 已将「${text}」加入英文白名单，永不再翻译或重复提示。`
                };
                return { ok: true };
            } catch (err) {
                this.engine.config.exclusions = prevExclusions;
                const msg = err && err.message ? err.message : String(err);
                this.quickEditStatus = {
                    type: 'error',
                    message: `✗ 保存白名单失败：${msg}（候选词已保留，请重试）`
                };
                return { ok: false, error: err };
            } finally {
                this.renderTabContent();
            }
        }

        saveAndApply() {
            // Read values from form if in general tab
            const enabledEl = document.getElementById('cfg-enabled');
            if (enabledEl) this.engine.config.enabled = enabledEl.checked;

            const langEl = document.getElementById('cfg-language');
            if (langEl) this.engine.config.language = langEl.value;

            ['menu', 'settings', 'agent', 'models', 'requests', 'errors', 'native', 'plugins'].forEach(s => {
                const el = document.getElementById(`scope-${s}`);
                if (el) this.engine.config.scope[s] = el.checked;
            });

            // Update engine indexes and clear caches
            this.engine.updateConfig(this.engine.config);

            // Re-apply translation or restore English
            if (!this.engine.config.enabled || this.engine.config.language === 'en') {
                this.domAdapter.restoreEnglish();
            } else {
                this.domAdapter.start();
                this.domAdapter.translateTree(document.body || document.documentElement);
            }

            // Persist via callback
            if (typeof this.onSave === 'function') {
                Promise.resolve(this.onSave(this.engine.config)).catch(err => {
                    console.error('[Hakimi i18n] Failed to persist settings:', err);
                });
            }

            if (this.embeddedEl && this.embeddedEl.isConnected) {
                // Embedded in AGM Hub: stay on the page, confirm inline.
                const tip = this.embeddedEl.querySelector('#hakimi-footer-tip');
                if (tip) {
                    tip.textContent = `✓ 已保存并生效（${new Date().toLocaleTimeString()}）`;
                    tip.classList.add('saved');
                }
                return;
            }
            this.close();
        }

        escapeHtml(s) {
            if (!s) return '';
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        injectStyles() {
            if (document.getElementById('hakimi-i18n-style')) return;
            const style = document.createElement('style');
            style.id = 'hakimi-i18n-style';
            style.textContent = `
                /* Floating Trigger Pill */
                #hakimi-i18n-trigger {
                    position: fixed;
                    right: calc(20px + var(--hakimi-dock-offset, 0px));
                    bottom: 20px;
                    z-index: 99998;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: rgba(30, 31, 35, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    backdrop-filter: blur(12px);
                    color: #e3e3e3;
                    padding: 6px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    user-select: none;
                    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
                    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #hakimi-i18n-trigger:hover {
                    background: rgba(45, 47, 52, 0.95);
                    border-color: rgba(255, 255, 255, 0.3);
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
                }

                /* Modal Overlay */
                #hakimi-i18n-modal-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    background: rgba(0, 0, 0, 0.65);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }
                #hakimi-i18n-modal-overlay.active {
                    opacity: 1;
                    pointer-events: auto;
                }

                /* Dialog Container */
                .hakimi-i18n-dialog {
                    width: 720px;
                    max-width: 92vw;
                    height: 580px;
                    max-height: 88vh;
                    background: #1e1f23;
                    border: 1px solid #33363d;
                    border-radius: 14px;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    color: #d1d5db;
                }

                /* Header */
                .hakimi-header {
                    padding: 16px 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid #2d3139;
                    background: #18191c;
                }
                .hakimi-header .cat-badge {
                    font-size: 11px;
                    font-weight: 600;
                    color: #60a5fa;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .hakimi-header h2 {
                    margin: 2px 0 0 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: #f3f4f6;
                }
                .close-btn {
                    background: transparent;
                    border: none;
                    font-size: 24px;
                    color: #9ca3af;
                    cursor: pointer;
                    line-height: 1;
                }
                .close-btn:hover { color: #f3f4f6; }

                /* Tabs */
                .hakimi-tabs {
                    display: flex;
                    gap: 4px;
                    padding: 8px 16px;
                    background: #18191c;
                    border-bottom: 1px solid #2d3139;
                    overflow-x: auto;
                }
                .tab-btn {
                    background: transparent;
                    border: none;
                    padding: 6px 14px;
                    border-radius: 6px;
                    color: #9ca3af;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }
                .tab-btn:hover { background: #262930; color: #f3f4f6; }
                .tab-btn.active {
                    background: #2b303c;
                    color: #60a5fa;
                    font-weight: 600;
                }

                /* Body */
                .hakimi-body {
                    flex: 1;
                    padding: 20px;
                    overflow-y: auto;
                }
                .tab-pane {
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                }

                /* Form Controls */
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .form-group.row {
                    flex-direction: row;
                    align-items: center;
                    justify-content: space-between;
                }
                .form-group label {
                    font-size: 13px;
                    font-weight: 500;
                    color: #e5e7eb;
                }
                .section-desc {
                    font-size: 12px;
                    color: #9ca3af;
                    margin: 0;
                }
                .form-control {
                    background: #151619;
                    border: 1px solid #33363d;
                    border-radius: 6px;
                    padding: 8px 12px;
                    color: #f3f4f6;
                    font-size: 13px;
                    outline: none;
                }
                .form-control:focus { border-color: #60a5fa; }

                /* Preset Buttons */
                .preset-group {
                    display: flex;
                    gap: 8px;
                }
                .preset-btn {
                    flex: 1;
                    padding: 8px;
                    background: #151619;
                    border: 1px solid #33363d;
                    border-radius: 6px;
                    color: #9ca3af;
                    font-size: 12px;
                    cursor: pointer;
                }
                .preset-btn.active {
                    background: #1e293b;
                    border-color: #60a5fa;
                    color: #60a5fa;
                    font-weight: 600;
                }

                /* Scope Grid */
                .scope-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                    background: #151619;
                    padding: 14px;
                    border-radius: 8px;
                    border: 1px solid #2d3139;
                }
                .checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: #d1d5db;
                    cursor: pointer;
                }

                /* DIY Table & Box */
                .diy-add-box {
                    display: flex;
                    gap: 8px;
                }
                .table-container {
                    border: 1px solid #2d3139;
                    border-radius: 8px;
                    overflow: hidden;
                    background: #151619;
                    max-height: 280px;
                    overflow-y: auto;
                }
                .diy-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .diy-table th, .diy-table td {
                    padding: 8px 12px;
                    text-align: left;
                    border-bottom: 1px solid #262930;
                }
                .diy-table th { background: #1c1e22; color: #9ca3af; }
                .diy-table code {
                    background: #24272f;
                    padding: 2px 6px;
                    border-radius: 4px;
                    color: #93c5fd;
                }
                .empty-tip { text-align: center; color: #6b7280; padding: 24px !important; }
                .btn-del, .btn-del-glo {
                    background: #7f1d1d;
                    color: #fca5a5;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 8px;
                    cursor: pointer;
                    font-size: 11px;
                }
                .btn-del:hover { background: #991b1b; }

                /* Tag Cloud */
                .tag-cloud {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    padding: 12px;
                    background: #151619;
                    border-radius: 8px;
                    border: 1px solid #2d3139;
                    max-height: 220px;
                    overflow-y: auto;
                }
                .tag-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    background: #262930;
                    padding: 4px 10px;
                    border-radius: 14px;
                    font-size: 12px;
                    color: #e5e7eb;
                }
                .tag-close {
                    cursor: pointer;
                    color: #9ca3af;
                    font-weight: bold;
                }
                .tag-close:hover { color: #f87171; }

                /* Sync Cards */
                .sync-actions {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 16px;
                }
                .sync-card {
                    background: #151619;
                    border: 1px solid #2d3139;
                    border-radius: 8px;
                    padding: 18px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .sync-card h3 { margin: 0; font-size: 14px; color: #f3f4f6; }
                .sync-card p { margin: 0; font-size: 12px; color: #9ca3af; flex: 1; }

                /* Footer */
                .hakimi-footer {
                    padding: 14px 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-top: 1px solid #2d3139;
                    background: #18191c;
                }
                .footer-tip { font-size: 12px; color: #6b7280; }
                .footer-tip kbd {
                    background: #262930;
                    border: 1px solid #3b3f4a;
                    border-radius: 4px;
                    padding: 2px 5px;
                    color: #d1d5db;
                }
                .footer-actions { display: flex; gap: 10px; }
                .btn {
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    border: none;
                    transition: all 0.15s;
                }
                .btn-sm { padding: 4px 8px; font-size: 11px; }
                .btn-secondary { background: #262930; color: #d1d5db; }
                .btn-secondary:hover { background: #323640; color: #fff; }
                .btn-primary { background: #2563eb; color: #fff; }
                .btn-primary:hover { background: #1d4ed8; }

                /* v1.1 Untranslated Discovery Badges */
                .untranslated-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }
                .badge-cat {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 500;
                }
                .badge-ui_copy { background: #1e3a8a; color: #93c5fd; }
                .badge-terminology { background: #064e3b; color: #6ee7b7; }
                .source-tag { font-size: 11px; color: #9ca3af; }
                .ops-cell { display: flex; gap: 6px; white-space: nowrap; }

                /* Quick DIY Inline Editor & Status Banner */
                .hakimi-status-banner {
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    border: 1px solid transparent;
                }
                .hakimi-status-banner.status-editing {
                    background: rgba(37, 99, 235, 0.14);
                    border-color: rgba(96, 165, 250, 0.35);
                    color: #93c5fd;
                }
                .hakimi-status-banner.status-success {
                    background: rgba(16, 185, 129, 0.14);
                    border-color: rgba(52, 211, 153, 0.35);
                    color: #6ee7b7;
                }
                .hakimi-status-banner.status-error {
                    background: rgba(239, 68, 68, 0.15);
                    border-color: rgba(248, 113, 113, 0.4);
                    color: #fca5a5;
                }
                .quick-edit-box {
                    background: #181a20;
                    border: 1px solid #3b82f6;
                    border-radius: 8px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .quick-edit-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .editing-badge {
                    font-size: 12px;
                    font-weight: 600;
                    color: #60a5fa;
                }

                /* ---------- Embedded mode (AGM Hub detail panel, native palette) ---------- */
                #hakimi-i18n-modal-overlay.embedded {
                    position: static;
                    inset: auto;
                    z-index: auto;
                    display: block;
                    background: none;
                    backdrop-filter: none;
                    opacity: 1;
                    pointer-events: auto;
                    transition: none;
                }
                #hakimi-i18n-modal-overlay.embedded .hakimi-i18n-dialog {
                    width: 100%;
                    max-width: none;
                    height: auto;
                    max-height: none;
                    overflow: visible;
                    box-shadow: none;
                    border-radius: 12px;
                    background: var(--card, #131317);
                    border: 1px solid var(--border, rgba(255,255,255,0.06));
                    color: var(--secondary-foreground, #BCBDC6);
                    font-family: inherit;
                }
                #hakimi-i18n-modal-overlay.embedded .hakimi-header,
                #hakimi-i18n-modal-overlay.embedded #hakimi-btn-cancel { display: none; }
                #hakimi-i18n-modal-overlay.embedded .hakimi-tabs {
                    background: transparent;
                    border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
                    padding: 8px 10px;
                    border-radius: 12px 12px 0 0;
                }
                #hakimi-i18n-modal-overlay.embedded .tab-btn { color: var(--muted-foreground, #87888F); font-family: inherit; }
                #hakimi-i18n-modal-overlay.embedded .tab-btn:hover { background: var(--muted, rgba(255,255,255,0.042)); color: var(--foreground, #fff); }
                #hakimi-i18n-modal-overlay.embedded .tab-btn.active { background: var(--secondary, rgba(255,255,255,0.075)); color: var(--foreground, #fff); font-weight: 500; }
                #hakimi-i18n-modal-overlay.embedded .hakimi-body { overflow: visible; padding: 20px; }
                #hakimi-i18n-modal-overlay.embedded .form-group label { color: var(--foreground, #fff); }
                #hakimi-i18n-modal-overlay.embedded input[type="checkbox"] { accent-color: var(--foreground, #fff); }
                #hakimi-i18n-modal-overlay.embedded .form-control,
                #hakimi-i18n-modal-overlay.embedded .preset-btn,
                #hakimi-i18n-modal-overlay.embedded .scope-grid,
                #hakimi-i18n-modal-overlay.embedded .table-container,
                #hakimi-i18n-modal-overlay.embedded .tag-cloud,
                #hakimi-i18n-modal-overlay.embedded .sync-card {
                    background: var(--muted, rgba(255,255,255,0.042));
                    border-color: var(--border, rgba(255,255,255,0.06));
                }
                #hakimi-i18n-modal-overlay.embedded .diy-table th { background: var(--secondary, rgba(255,255,255,0.075)); }
                #hakimi-i18n-modal-overlay.embedded .diy-table th,
                #hakimi-i18n-modal-overlay.embedded .diy-table td { border-bottom-color: var(--border, rgba(255,255,255,0.06)); }
                #hakimi-i18n-modal-overlay.embedded .preset-btn.active {
                    background: var(--secondary, rgba(255,255,255,0.075));
                    border-color: color-mix(in srgb, var(--foreground, #fff) 22%, transparent);
                    color: var(--foreground, #fff);
                }
                #hakimi-i18n-modal-overlay.embedded .hakimi-footer {
                    position: sticky;
                    bottom: 0;
                    background: var(--card, #131317);
                    border-top: 1px solid var(--border, rgba(255,255,255,0.06));
                    border-radius: 0 0 12px 12px;
                }
                #hakimi-i18n-modal-overlay.embedded .footer-tip { color: var(--muted-foreground, #87888F); }
                #hakimi-i18n-modal-overlay.embedded .footer-tip.saved { color: #86efac; }
                #hakimi-i18n-modal-overlay.embedded .btn { font-family: inherit; border-radius: 8px; }
                #hakimi-i18n-modal-overlay.embedded .btn-primary { background: var(--foreground, #fff); color: var(--background, #070708); }
                #hakimi-i18n-modal-overlay.embedded .btn-primary:hover { background: color-mix(in srgb, var(--foreground, #fff) 86%, var(--background, #070708)); }
                #hakimi-i18n-modal-overlay.embedded .btn-secondary { background: var(--secondary, rgba(255,255,255,0.075)); color: var(--foreground, #fff); }
            `;
            document.head.appendChild(style);
        }
    }

    exports.ConfigCenterUI = ConfigCenterUI;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.__HakimiConfigUI = {}));
