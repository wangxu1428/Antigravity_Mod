// =============================================================================
// agm-hello-guard (Web Worker Sandbox Example Plugin)
// Pure worker plugin: no network, no filesystem, no DOM access.
// =============================================================================
'use strict';

module.exports = {
    async activate(ctx, initialConfig) {
        const cfg = initialConfig || (await ctx.api.config.getAll());
        const current = (await ctx.api.storage.get('counter')) || 0;
        return {
            activated: true,
            counter: current,
            config: cfg,
        };
    },

    async invoke(actionId, _payload, ctx) {
        if (actionId === 'greet') {
            const cfg = await ctx.api.config.getAll();
            const prev = Number(await ctx.api.storage.get('counter')) || 0;
            const step = Number(cfg.stepSize) || 1;
            const nextCounter = prev + step;
            await ctx.api.storage.set('counter', nextCounter);

            const message = `[${cfg.tone}] ${cfg.greetingPrefix} #${nextCounter}`;
            if (cfg.showToast !== false) {
                await ctx.api.ui.showToast(message, 'info');
            }
            return {
                ok: true,
                action: 'greet',
                message,
                counter: nextCounter,
                config: {
                    showToast: Boolean(cfg.showToast),
                    greetingPrefix: String(cfg.greetingPrefix || ''),
                    stepSize: step,
                    tone: String(cfg.tone || 'friendly'),
                },
            };
        }

        if (actionId === 'tryForbidden') {
            try {
                await ctx.api.shell.launchDesktopGpt();
                return {
                    ok: true,
                    denied: false,
                    warning: 'Expected permission denial did not occur',
                };
            } catch (err) {
                return {
                    ok: false,
                    denied: true,
                    code: (err && err.code) || 'E_PERMISSION_DENIED',
                    error: err && err.message ? err.message : String(err),
                };
            }
        }

        throw new Error('Unknown action: ' + String(actionId));
    },

    async onConfigChange(newConfig) {
        return { updated: true, config: newConfig };
    },

    async deactivate() {
        return { deactivated: true };
    },
};
