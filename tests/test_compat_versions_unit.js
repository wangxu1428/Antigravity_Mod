// tests/test_compat_versions_unit.js
// 平台兼容声明（manifest.repo.json -> platform.compatibleAppVersion[s]）正反向测试。
//
// 说明：当前仓库没有生产运行时消费者读取平台兼容字段（agm-plugin-host.js 的
// checkCompatibility 处理的是插件 manifest 的 compatibility.appVersion，不是本字段）。
// 因此本文件分两类，如实标注、互不冒充：
//   META-*：元数据结构验证（只验证 manifest 声明与登记/CI 接线）。
//   V1-V13：运行时版本拒绝测试，真实调用 platform/mod_kit/agm_compat_versions.js
//           导出的最小纯函数 isAppVersionAllowed()，并实际调用宿主既有 SemVer 解析器。
// 该纯函数仅作为“未来消费者”的参考实现导出，未接入现有运行时（无消费者需要）。
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.repo.json');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'test.yml');
const HOST_PATH = path.join(REPO_ROOT, 'platform', 'agm-plugin-host.js');
const COMPAT_PATH = path.join(REPO_ROOT, 'platform', 'mod_kit', 'agm_compat_versions.js');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const platform = manifest.platform || {};
const { isAppVersionAllowed } = require(COMPAT_PATH);
const host = require(HOST_PATH);

const results = [];
function check(id, desc, cond, detail) {
  if (cond) {
    results.push({ id, status: 'PASS' });
    console.log(`PASS ${id} ${desc}`);
  } else {
    results.push({ id, status: 'FAIL' });
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function allowed(platformObj, version) {
  return isAppVersionAllowed(platformObj, version);
}

function runAll() {
  // ---- 元数据结构验证（不是运行时消费者测试） ----
  {
    const list = platform.compatibleAppVersions;
    const legacy = platform.compatibleAppVersion;
    const noRangeSyntax = Array.isArray(list) && list.every((v) => /^\d+\.\d+\.\d+$/.test(v));
    check(
      'META-1',
      'manifest platform declares schemaVersion=1, string legacy appVersion=2.32.1, and exactly [2.32.1, 2.33.0] with no range syntax',
      manifest.schemaVersion === 1 &&
        typeof legacy === 'string' &&
        legacy === '2.32.1' &&
        Array.isArray(list) &&
        JSON.stringify(list) === JSON.stringify(['2.32.1', '2.33.0']) &&
        noRangeSyntax,
      { schemaVersion: manifest.schemaVersion, legacy, list, noRangeSyntax }
    );
  }
  {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const registered = Array.isArray(manifest.files) && manifest.files.some((f) => f.path === 'tests/test_compat_versions_unit.js');
    const registeredModule = Array.isArray(manifest.files) && manifest.files.some((f) => f.path === 'platform/mod_kit/agm_compat_versions.js');
    const hasMatrix = workflow.includes('ubuntu-latest') && workflow.includes('windows-latest');
    check(
      'META-2',
      'new version-declaration test is wired into the two-OS CI matrix and registered in manifest.repo.json',
      workflow.includes('node tests/test_compat_versions_unit.js') && hasMatrix && registered && registeredModule,
      { hasStep: workflow.includes('node tests/test_compat_versions_unit.js'), hasMatrix, registered, registeredModule }
    );
  }

  // ---- 运行时版本拒绝测试（真实调用解析/消费逻辑） ----
  {
    const r = allowed(platform, '2.32.1');
    check('V1', '2.32.1 is allowed when the array is present', r.allowed === true && r.source === 'compatibleAppVersions', r);
  }
  {
    const r = allowed(platform, '2.33.0');
    check('V2', '2.33.0 is allowed when the array is present', r.allowed === true && r.source === 'compatibleAppVersions', r);
  }
  {
    const r = allowed(platform, '2.32.2');
    check('V3', '2.32.2 is rejected (not an exact validated version)', r.allowed === false && r.source === 'compatibleAppVersions', r);
  }
  {
    const r = allowed(platform, '2.33.1');
    check('V4', '2.33.1 is rejected (not an exact validated version)', r.allowed === false && r.source === 'compatibleAppVersions', r);
  }
  {
    const r = allowed(platform, '2.34.0');
    check('V5', 'an unknown version (2.34.0) is rejected', r.allowed === false && r.source === 'compatibleAppVersions', r);
  }
  {
    const exactOnly = { compatibleAppVersion: '2.32.1' };
    const legacyWildcard = { compatibleAppVersion: '2.32.x' };
    const exactR = allowed(exactOnly, '2.32.1');
    const exactReject = allowed(exactOnly, '2.33.0');
    const wildR = allowed(legacyWildcard, '2.32.1');
    const wildReject = allowed(legacyWildcard, '2.33.0');
    check(
      'V6',
      'when the array is absent, the legacy field is used (exact 2.32.1 and historical 2.32.x both allow 2.32.1, reject 2.33.0)',
      exactR.allowed === true &&
        exactR.source === 'compatibleAppVersion' &&
        exactReject.allowed === false &&
        wildR.allowed === true &&
        wildReject.allowed === false,
      { exactR, exactReject, wildR, wildReject }
    );
  }
  {
    const empty = { compatibleAppVersions: [] };
    const r1 = allowed(empty, '2.32.1');
    const r2 = allowed(empty, '2.33.0');
    check(
      'V7',
      'an empty array is not treated as allow-all (2.32.1 and 2.33.0 are both rejected, no legacy fallback)',
      r1.allowed === false && r2.allowed === false && r1.source === 'compatibleAppVersions' && r1.reason.includes('空数组'),
      { r1, r2 }
    );
  }
  {
    const badType = { compatibleAppVersions: '2.32.1,2.33.0' };
    const badEntry = { compatibleAppVersions: ['2.32.1', 2330] };
    const r1 = allowed(badType, '2.32.1');
    const r2 = allowed(badEntry, '2.32.1');
    check(
      'V8',
      'an array type error (string instead of array, or a non-string entry) is explicitly rejected with a reason',
      r1.allowed === false &&
        r1.reason.includes('必须是字符串数组') &&
        r2.allowed === false &&
        r2.reason.includes('精确 x.y.z'),
      { r1, r2 }
    );
  }
  {
    const both = { compatibleAppVersion: '2.33.0', compatibleAppVersions: ['2.32.1'] };
    const r1 = allowed(both, '2.33.0');
    const r2 = allowed(both, '2.32.1');
    check(
      'V9',
      'when both fields exist the array wins: 2.33.0 is rejected even though the legacy field names it, 2.32.1 is allowed',
      r1.allowed === false && r1.source === 'compatibleAppVersions' && r2.allowed === true && r2.source === 'compatibleAppVersions',
      { r1, r2 }
    );
  }
  {
    let legacyThrew = null;
    let legacyAllows2321 = null;
    let legacyAllows2330 = null;
    try {
      // 旧消费者典型写法：只读旧字符串字段，做精确相等或交给既有 SemVer 解析器。
      const legacyConsumer = (m, appVersion) => m.platform.compatibleAppVersion === appVersion;
      legacyAllows2321 = legacyConsumer(manifest, '2.32.1');
      legacyAllows2330 = legacyConsumer(manifest, '2.33.0');
      // 宿主既有 SemVer 解析器仍能解析新旧字段，不抛异常。
      const range2321 = host.satisfiesRange('2.32.1', manifest.platform.compatibleAppVersion);
      const range2330 = host.satisfiesRange('2.33.0', manifest.platform.compatibleAppVersion);
      if (range2321 !== true || range2330 !== false) legacyThrew = 'legacy satisfiesRange result unexpected';
    } catch (e) {
      legacyThrew = e.message;
    }
    check(
      'V10',
      'an old consumer can JSON.parse the new manifest and read the legacy field without exception (2.32.1 allowed, 2.33.0 rejected)',
      legacyThrew === null && legacyAllows2321 === true && legacyAllows2330 === false,
      { legacyThrew, legacyAllows2321, legacyAllows2330 }
    );
  }
  {
    const r = allowed(platform, 'v2.33.0');
    check('V11', 'v2.33.0 is rejected (no v-prefix normalization)', r.allowed === false, r);
  }
  {
    const r1 = allowed(platform, ' 2.33.0');
    const r2 = allowed(platform, '2.33.0 ');
    check('V12', 'leading/trailing whitespace around 2.33.0 is rejected (no trim normalization)', r1.allowed === false && r2.allowed === false, { r1, r2 });
  }
  {
    const r = allowed(platform, '2.33.0-4731201358004224');
    check('V13', '2.33.0 with a build-number suffix is rejected (no build-suffix normalization)', r.allowed === false, r);
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  console.log(`SUMMARY pass=${passCount} fail=${failCount} skip=0`);
  process.exitCode = failCount ? 1 : 0;
}

runAll();
