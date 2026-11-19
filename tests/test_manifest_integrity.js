// tests/test_manifest_integrity.js : Verifies raw Git blob bytes & release archive bytes
// against manifest.repo.json without LF normalization.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.repo.json');

const results = [];
function check(id, desc, cond, detail) {
  if (cond) {
    results.push({ id, ok: true });
    console.log(`PASS ${id} ${desc}`);
  } else {
    results.push({ id, ok: false });
    const msg = detail === undefined ? 'condition false' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function resolveGitExe() {
  const candidates = ['git'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Git\\cmd\\git.exe');
    candidates.push('C:\\Program Files\\Git\\bin\\git.exe');
  }
  for (const cand of candidates) {
    try {
      execFileSync(cand, ['--version'], { stdio: 'ignore' });
      return cand;
    } catch (_) {}
  }
  throw new Error('git executable not found');
}

function gitBlob(gitExe, relPath) {
  return execFileSync(gitExe, ['-C', REPO_ROOT, 'cat-file', 'blob', `HEAD:${relPath}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parsePaxAttributes(buf) {
  const attrs = {};
  let idx = 0;
  while (idx < buf.length) {
    const sp = buf.indexOf(0x20, idx);
    if (sp < 0) break;
    const recLen = parseInt(buf.subarray(idx, sp).toString('ascii'), 10);
    if (!Number.isFinite(recLen) || recLen <= 0 || idx + recLen > buf.length) break;
    const rec = buf.subarray(sp + 1, idx + recLen).toString('utf8').replace(/\n$/, '');
    const eq = rec.indexOf('=');
    if (eq > 0) {
      attrs[rec.slice(0, eq)] = rec.slice(eq + 1);
    }
    idx += recLen;
  }
  return attrs;
}

function parseTarArchive(tarBuf) {
  const entries = new Map();
  let offset = 0;
  let nextPax = {};
  let nextGnuLongName = null;

  while (offset + 512 <= tarBuf.length) {
    const hdr = tarBuf.subarray(offset, offset + 512);
    if (hdr.every((b) => b === 0)) break;

    const rawName = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const rawPrefix = hdr.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeOct = hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    const typeFlag = String.fromCharCode(hdr[156]);
    offset += 512;

    const data = tarBuf.subarray(offset, offset + size);
    const padded = Math.ceil(size / 512) * 512;
    offset += padded;

    if (typeFlag === 'g') {
      // pax_global_header - ignore global metadata
      continue;
    }
    if (typeFlag === 'x') {
      nextPax = parsePaxAttributes(data);
      continue;
    }
    if (typeFlag === 'L') {
      nextGnuLongName = data.toString('utf8').replace(/\0.*$/, '');
      continue;
    }

    let fullName = nextPax.path || nextGnuLongName || (rawPrefix ? `${rawPrefix}/${rawName}` : rawName);
    fullName = fullName.replace(/^\.\//, '');
    nextPax = {};
    nextGnuLongName = null;

    if (typeFlag === '0' || typeFlag === '\0') {
      entries.set(fullName, Buffer.from(data));
    }
  }
  return entries;
}

function runAll() {
  const gitExe = resolveGitExe();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const builtins = Array.isArray(manifest.builtinPlugins) ? manifest.builtinPlugins : [];
  const repoPlugins = Array.isArray(manifest.repoPlugins) ? manifest.repoPlugins : [];

  // MF1: Manifest structure, existence on disk, unique paths
  const seen = new Set();
  const dupes = [];
  const missingOnDisk = [];
  const badFields = [];
  for (const item of files) {
    if (!item || typeof item.path !== 'string' || typeof item.size !== 'number' || !/^[0-9A-F]{64}$/.test(String(item.sha256 || ''))) {
      badFields.push(item ? item.path : 'INVALID');
      continue;
    }
    if (seen.has(item.path)) dupes.push(item.path);
    seen.add(item.path);
    const full = path.join(REPO_ROOT, ...item.path.split('/'));
    if (!fs.existsSync(full)) missingOnDisk.push(item.path);
  }
  check(
    'MF1',
    `manifest.repo.json files[] (${files.length} entries) structure valid, unique, and present on disk`,
    files.length >= 52 && dupes.length === 0 && missingOnDisk.length === 0 && badFields.length === 0,
    { count: files.length, dupes, missingOnDisk, badFields }
  );

  // MF2: Raw Git blob byte verification (NO LF normalization)
  const blobMismatches = [];
  const crBlobs = [];
  for (const item of files) {
    try {
      const buf = gitBlob(gitExe, item.path);
      const actualSha = sha256Hex(buf);
      if (buf.length !== item.size || actualSha !== item.sha256) {
        blobMismatches.push({
          path: item.path,
          expectedSize: item.size,
          actualSize: buf.length,
          expectedSha: item.sha256,
          actualSha,
        });
      }
      if (buf.includes(0x0d)) {
        crBlobs.push(item.path);
      }
    } catch (e) {
      blobMismatches.push({ path: item.path, error: e.message });
    }
  }
  for (const bp of builtins) {
    const buf = gitBlob(gitExe, bp.entry);
    const actualSha = sha256Hex(buf);
    if (actualSha !== bp.sha256) {
      blobMismatches.push({ path: bp.entry, expectedSha: bp.sha256, actualSha });
    }
  }
  for (const rp of repoPlugins) {
    for (const rf of rp.files || []) {
      const buf = gitBlob(gitExe, rf.path);
      const actualSha = sha256Hex(buf);
      if (buf.length !== rf.size || actualSha !== rf.sha256) {
        blobMismatches.push({ path: rf.path, expectedSize: rf.size, actualSize: buf.length, expectedSha: rf.sha256, actualSha });
      }
    }
  }
  check(
    'MF2',
    `raw Git blob bytes (HEAD:<path>) match manifest.repo.json size & SHA256 for all ${files.length} files + plugin entries`,
    blobMismatches.length === 0,
    { mismatchCount: blobMismatches.length, sample: blobMismatches.slice(0, 10) }
  );

  // MF3: No unexpected CRLF inside Git blobs (specifically app-update.template.yml & rollback.bat)
  const tplEntry = files.find((f) => f.path === 'platform/mod_kit/app-update.template.yml');
  const rbEntry = files.find((f) => f.path === 'platform/scripts/legacy-rollback/rollback.bat');
  check(
    'MF3',
    'all manifest Git blobs are pure LF (including app-update.template.yml & rollback.bat)',
    crBlobs.length === 0 && Boolean(tplEntry) && Boolean(rbEntry) && tplEntry.size === 259 && rbEntry.size === 174,
    { crBlobs, tplEntry, rbEntry }
  );

  // MF4: Release archive (`git -c core.autocrlf=false archive --format=tar HEAD`, matching Linux/GitHub release archives) byte match (+ disk byte match on non-Windows)
  const tarBuf = execFileSync(gitExe, ['-c', 'core.autocrlf=false', '-C', REPO_ROOT, 'archive', '--format=tar', 'HEAD'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const tarMap = parseTarArchive(tarBuf);
  const archiveMismatches = [];
  const diskMismatches = [];
  for (const item of files) {
    const tarData = tarMap.get(item.path);
    if (!tarData) {
      archiveMismatches.push({ path: item.path, error: 'missing from git archive' });
    } else {
      const tarSha = sha256Hex(tarData);
      if (tarData.length !== item.size || tarSha !== item.sha256) {
        archiveMismatches.push({ path: item.path, expectedSize: item.size, tarSize: tarData.length, expectedSha: item.sha256, tarSha });
      }
    }
    if (process.platform !== 'win32') {
      const diskBuf = fs.readFileSync(path.join(REPO_ROOT, ...item.path.split('/')));
      const diskSha = sha256Hex(diskBuf);
      if (diskBuf.length !== item.size || diskSha !== item.sha256) {
        diskMismatches.push({ path: item.path, expectedSize: item.size, diskSize: diskBuf.length, expectedSha: item.sha256, diskSha });
      }
    }
  }
  check(
    'MF4',
    `release archive (git archive --format=tar HEAD) bytes match all ${files.length} manifest entries` +
      (process.platform !== 'win32' ? ' + Linux checkout bytes match' : ''),
    archiveMismatches.length === 0 && diskMismatches.length === 0,
    { archiveMismatches: archiveMismatches.slice(0, 10), diskMismatches: diskMismatches.slice(0, 10) }
  );

  // MF5: Test & evidence docs included in manifest
  const requiredInManifest = [
    'tests/test_repatch_unit.js',
    'tests/test_fault_injection.js',
    'tests/test_manifest_integrity.js',
    'docs/WINDOWS_TEST_EVIDENCE.md',
  ];
  const missingReq = requiredInManifest.filter((p) => !seen.has(p));
  check(
    'MF5',
    'all offline test suites (incl. test_repatch_unit.js, test_fault_injection.js, test_manifest_integrity.js) and WINDOWS_TEST_EVIDENCE.md included in manifest',
    missingReq.length === 0,
    { missingReq }
  );

  const failCount = results.filter((r) => !r.ok).length;
  console.log(`SUMMARY pass=${results.length - failCount} fail=${failCount}`);
  process.exitCode = failCount ? 1 : 0;
}

runAll();
