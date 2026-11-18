// =============================================================================
// agm-fault-probe (Test-Only Fault Isolation Probe)
// =============================================================================
'use strict';

module.exports = {
    async activate() {
        return { activated: true };
    },

    async invoke(actionId) {
        if (actionId === 'throwSync') {
            throw new Error('AGM_FAULT_PROBE_SYNC_THROW');
        }
        if (actionId === 'rejectAsync') {
            return Promise.reject(new Error('AGM_FAULT_PROBE_ASYNC_REJECT'));
        }
        if (actionId === 'infiniteLoop') {
            while (true) {}
        }
        throw new Error('Unknown fault probe action: ' + String(actionId));
    },

    async deactivate() {
        return { deactivated: true };
    },
};
