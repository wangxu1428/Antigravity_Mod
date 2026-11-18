// test_host_unit.js - Pure logic unit tests for platform/agm-plugin-host.js (v2.1.0)
// Node built-ins only; relative paths from repository root.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOST_PATH = path.join(REPO_ROOT, 'platform', 'agm-plugin-host.js');
const HELLO_MANIFEST_PATH = path.join(REPO_ROOT, 'plugins', 'optional', 'agm-hello-guard', 'manifest.json');
const PROBE_MANIFEST_PATH = path.join(__dirname, 'fixtures', 'agm-fault-probe', 'manifest.json');

const host = require(HOST_PATH);

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('PASS ' + name);
    } catch (err) {
        failed++;
        const msg = err && err.message ? err.message : String(err);
        failures.push(name + ': ' + msg);
        console.log('FAIL ' + name + ' :: ' + msg);
    }
}

// 1. Exports sanity
test('exports_present', () => {
    assert.strictEqual(host.HOST_VERSION, '2.1.0');
    assert.strictEqual(typeof host.validateManifest, 'function');
    assert.strictEqual(typeof host.checkCompatibility, 'function');
    assert.strictEqual(typeof host.defaultsFromSchema, 'function');
    assert.strictEqual(typeof host.validateConfigBySchema, 'function');
    assert.strictEqual(typeof host.checkPermission, 'function');
    assert.strictEqual(typeof host.satisfiesRange, 'function');
    assert.ok(host.DEFAULT_SETTINGS && host.DEFAULT_SETTINGS.executionTimeoutMs === 2500);
});

// 2. Manifest validation (good & bad)
const helloManifest = JSON.parse(fs.readFileSync(HELLO_MANIFEST_PATH, 'utf8'));
const probeManifest = JSON.parse(fs.readFileSync(PROBE_MANIFEST_PATH, 'utf8'));

test('manifest_valid_hello_guard', () => {
    const res = host.validateManifest(helloManifest, 'agm-hello-guard');
    assert.strictEqual(res.valid, true, res.errors.join('; '));
    assert.strictEqual(res.errors.length, 0);
});

test('manifest_valid_fault_probe', () => {
    const res = host.validateManifest(probeManifest, 'agm-fault-probe');
    assert.strictEqual(res.valid, true, res.errors.join('; '));
});

test('manifest_bad_non_object_and_version', () => {
    assert.strictEqual(host.validateManifest(null).valid, false);
    const badVer = { ...helloManifest, manifestVersion: 2 };
    const r = host.validateManifest(badVer);
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('manifestVersion')));
});

test('manifest_bad_id_and_dir_mismatch', () => {
    const badId = { ...helloManifest, id: '../evil' };
    assert.strictEqual(host.validateManifest(badId).valid, false);

    const shortId = { ...helloManifest, id: 'a' };
    assert.strictEqual(host.validateManifest(shortId).valid, false);

    const mismatch = host.validateManifest(helloManifest, 'other-dir');
    assert.strictEqual(mismatch.valid, false);
});

test('manifest_bad_entry_traversal_and_ext', () => {
    for (const badEntry of ['../x.js', '/abs.js', '\\win.js', 'C:\\evil.js', 'index.txt', '']) {
        const m = { ...helloManifest, entry: badEntry };
        const r = host.validateManifest(m, 'agm-hello-guard');
        assert.strictEqual(r.valid, false, 'Expected invalid entry: ' + badEntry);
    }
});

test('manifest_bad_meta_permissions_actions_schema', () => {
    assert.strictEqual(host.validateManifest({ ...helloManifest, name: '' }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, name: 'x'.repeat(65) }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, author: '   ' }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, version: 'not-semver' }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, compatibility: {} }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, permissions: [123] }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, actions: [{ id: '', label: 'x' }] }).valid, false);
    assert.strictEqual(host.validateManifest({ ...helloManifest, configSchema: null }).valid, false);

    const badSchemaType = {
        ...helloManifest,
        configSchema: { x: { type: 'object', title: 'Bad' } },
    };
    assert.strictEqual(host.validateManifest(badSchemaType).valid, false);

    const badEnumDefault = {
        ...helloManifest,
        configSchema: { e: { type: 'enum', title: 'E', default: 'missing', options: ['a', 'b'] } },
    };
    assert.strictEqual(host.validateManifest(badEnumDefault).valid, false);

    const badRegex = {
        ...helloManifest,
        configSchema: { s: { type: 'string', title: 'S', pattern: '[' } },
    };
    assert.strictEqual(host.validateManifest(badRegex).valid, false);

    const badBoolDefault = {
        ...helloManifest,
        configSchema: { b: { type: 'boolean', title: 'B', default: 'true' } },
    };
    assert.strictEqual(host.validateManifest(badBoolDefault).valid, false);
});

// 3. Compatibility check & semver ranges
test('compat_valid_and_ranges', () => {
    assert.strictEqual(host.satisfiesRange('2.0.0', '>=2.0.0'), true);
    assert.strictEqual(host.satisfiesRange('2.1.3', '^2.0.0'), true);
    assert.strictEqual(host.satisfiesRange('3.0.0', '^2.0.0'), false);
    assert.strictEqual(host.satisfiesRange('0.2.5', '^0.2.0'), true);
    assert.strictEqual(host.satisfiesRange('0.3.0', '^0.2.0'), false);
    assert.strictEqual(host.satisfiesRange('1.5.0', '>=1.0.0 <2.0.0'), true);
    assert.strictEqual(host.satisfiesRange('2.0.0', '>=1.0.0 <2.0.0'), false);
    assert.strictEqual(host.satisfiesRange('1.0.0', '*'), true);
    assert.strictEqual(host.satisfiesRange('1.0.0-alpha.1', '>=1.0.0'), false);

    const ok = host.checkCompatibility(helloManifest.compatibility, { appVersion: '1.10.0', hostVersion: '2.1.0' });
    assert.strictEqual(ok.compatible, true);
    assert.strictEqual(ok.reasons.length, 0);
});

test('compat_incompatible_app_and_host', () => {
    const badApp = host.checkCompatibility({ appVersion: '>=9.0.0', hostVersion: '>=2.0.0' }, { appVersion: '1.0.0', hostVersion: '2.1.0' });
    assert.strictEqual(badApp.compatible, false);
    assert.strictEqual(badApp.appCheck.ok, false);
    assert.strictEqual(badApp.hostCheck.ok, true);

    const badHost = host.checkCompatibility({ appVersion: '>=1.0.0', hostVersion: '>=3.0.0' }, { appVersion: '1.0.0', hostVersion: '2.1.0' });
    assert.strictEqual(badHost.compatible, false);
    assert.strictEqual(badHost.hostCheck.ok, false);

    const badMissing = host.checkCompatibility(null, { appVersion: '1.0.0', hostVersion: '2.1.0' });
    assert.strictEqual(badMissing.compatible, false);
});

// 4. defaultsFromSchema
test('defaults_from_schema_explicit_and_fallback', () => {
    const defs = host.defaultsFromSchema(helloManifest.configSchema);
    assert.deepStrictEqual(defs, {
        showToast: true,
        greetingPrefix: 'Hello Antigravity',
        stepSize: 1,
        tone: 'friendly',
    });

    const fallbackDefs = host.defaultsFromSchema({
        b: { type: 'boolean', title: 'B' },
        s: { type: 'string', title: 'S' },
        n1: { type: 'number', title: 'N1', min: 10 },
        n2: { type: 'number', title: 'N2' },
        e: { type: 'enum', title: 'E', options: ['opt1', 'opt2'] },
    });
    assert.deepStrictEqual(fallbackDefs, {
        b: false,
        s: '',
        n1: 10,
        n2: 0,
        e: 'opt1',
    });
});

// 5. validateConfigBySchema (all 4 types + boundary + invalid)
test('schema_boolean_valid_and_invalid', () => {
    const schema = { flag: { type: 'boolean', title: 'Flag', default: false } };
    assert.deepStrictEqual(host.validateConfigBySchema(schema, { flag: true }), {
        ok: true, errors: {}, normalized: { flag: true },
    });
    const bad = host.validateConfigBySchema(schema, { flag: 'true' });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.flag);
});

test('schema_string_boundaries_required_pattern', () => {
    const schema = { greetingPrefix: helloManifest.configSchema.greetingPrefix };

    const okMin = host.validateConfigBySchema(schema, { greetingPrefix: 'ab' });
    assert.strictEqual(okMin.ok, true);

    const okMax = host.validateConfigBySchema(schema, { greetingPrefix: 'A'.repeat(32) });
    assert.strictEqual(okMax.ok, true);

    const okCjk = host.validateConfigBySchema(schema, { greetingPrefix: '\u4f60\u597d_Test 01!#-' });
    assert.strictEqual(okCjk.ok, true);

    assert.strictEqual(host.validateConfigBySchema(schema, { greetingPrefix: '   ' }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { greetingPrefix: 'a' }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { greetingPrefix: 'A'.repeat(33) }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { greetingPrefix: 'bad@char$' }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { greetingPrefix: 123 }).ok, false);
});

test('schema_number_boundaries_integer_and_float', () => {
    const schema = {
        stepSize: helloManifest.configSchema.stepSize,
        ratio: { type: 'number', title: 'Ratio', default: 0.5, min: 0, max: 1.5 },
    };

    const okBounds = host.validateConfigBySchema(schema, { stepSize: 1, ratio: 0 });
    assert.strictEqual(okBounds.ok, true);

    const okMax = host.validateConfigBySchema(schema, { stepSize: 100, ratio: 1.5 });
    assert.strictEqual(okMax.ok, true);

    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: 0, ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: 101, ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: 1.5, ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: NaN, ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: Infinity, ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: '5', ratio: 0.5 }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { stepSize: 5, ratio: 2.0 }).ok, false);
});

test('schema_enum_valid_and_invalid', () => {
    const schema = {
        tone: helloManifest.configSchema.tone,
        mode: { type: 'enum', title: 'Mode', default: 'fast', options: ['fast', 'safe'] },
    };
    assert.strictEqual(host.validateConfigBySchema(schema, { tone: 'formal', mode: 'safe' }).ok, true);
    assert.strictEqual(host.validateConfigBySchema(schema, { tone: 'concise', mode: 'fast' }).ok, true);
    assert.strictEqual(host.validateConfigBySchema(schema, { tone: 'unknown', mode: 'fast' }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { tone: 1, mode: 'fast' }).ok, false);
    assert.strictEqual(host.validateConfigBySchema(schema, { tone: 'friendly', mode: 'bad' }).ok, false);
});

// 6. Permission map (granted vs denied)
test('permission_map_all_capabilities', () => {
    const allPerms = Object.values(host.CAPABILITY_TO_PERMISSION);
    for (const cap of Object.keys(host.CAPABILITY_TO_PERMISSION)) {
        const allowRes = host.checkPermission(allPerms, cap);
        assert.strictEqual(allowRes.allowed, true, 'Expected allow for ' + cap);
        assert.strictEqual(allowRes.code, null);

        const denyRes = host.checkPermission([], cap);
        assert.strictEqual(denyRes.allowed, false, 'Expected deny for ' + cap);
        assert.strictEqual(denyRes.code, 'E_PERMISSION_DENIED');
    }

    assert.strictEqual(host.checkPermission(helloManifest.permissions, 'ui.showToast').allowed, true);
    assert.strictEqual(host.checkPermission(helloManifest.permissions, 'config.getAll').allowed, true);
    assert.strictEqual(host.checkPermission(helloManifest.permissions, 'storage.get').allowed, true);
    assert.strictEqual(host.checkPermission(helloManifest.permissions, 'storage.set').allowed, true);

    const deniedShell = host.checkPermission(helloManifest.permissions, 'shell.launchDesktopGpt');
    assert.strictEqual(deniedShell.allowed, false);
    assert.strictEqual(deniedShell.code, 'E_PERMISSION_DENIED');
    assert.strictEqual(deniedShell.requiredPerm, 'shell:launchDesktopGpt');

    const unknownCap = host.checkPermission(allPerms, 'fs.writeFile');
    assert.strictEqual(unknownCap.allowed, false);
    assert.strictEqual(unknownCap.code, 'E_PERMISSION_DENIED');
});

console.log(`UNIT_SUMMARY passed=${passed} failed=${failed}`);
if (failed > 0) {
    console.log('RESULT FAIL ' + failures.join(' | '));
    process.exit(1);
}
console.log('RESULT PASS');
process.exit(0);
