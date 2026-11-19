// platform/mod_kit/agm_compat_versions.js
// 平台兼容版本声明（manifest.repo.json -> platform.compatibleAppVersion[s]）的最小纯函数解析器。
// 本模块只做声明匹配，不执行补丁、安装或版本归一化。
//
// 规则（与 AGM-233-COMPAT-01 / STAGE-B-CLOSEOUT 任务 A/C 一致）：
// - compatibleAppVersions 存在时优先使用数组；数组必须是非空字符串数组，条目必须是精确 x.y.z。
// - 数组匹配为严格精确字符串相等：不 trim、不加/去 v 前缀、不接受构建号后缀、不解析区间/OR。
// - 空数组或数组类型错误 => 明确拒绝（绝不解释为“允许全部”），不回退旧字段。
// - 数组不存在时才回退到旧字段 compatibleAppVersion；旧字段按既有声明语义匹配
//   （精确相等，或历史遗留的 major.minor.x 形式），同样不做 trim / v 前缀 / 构建号匹配。
// - 双字段同时存在时数组优先，旧字段仅供旧消费者解析，不参与数组路径判定。
'use strict';

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+$/;

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function reject(source, reason) {
    return { allowed: false, source, reason };
}

function allow(source) {
    return { allowed: true, source, reason: '' };
}

function legacyAllows(legacy, appVersion) {
    if (legacy === appVersion) return true;
    const wildcard = /^(\d+)\.(\d+)\.x$/.exec(legacy);
    if (!wildcard) return false;
    const parts = appVersion.split('.');
    return parts.length === 3 && parts[0] === wildcard[1] && parts[1] === wildcard[2];
}

function isAppVersionAllowed(platform, appVersion) {
    if (typeof appVersion !== 'string' || appVersion.length === 0) {
        return reject('input', 'appVersion 必须是非空字符串');
    }
    if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
        return reject('input', 'platform 必须是对象');
    }

    if (hasOwn(platform, 'compatibleAppVersions')) {
        const list = platform.compatibleAppVersions;
        if (!Array.isArray(list)) {
            return reject('compatibleAppVersions', 'compatibleAppVersions 必须是字符串数组');
        }
        if (list.length === 0) {
            return reject('compatibleAppVersions', '空数组不表示允许全部版本');
        }
        for (const item of list) {
            if (typeof item !== 'string' || !EXACT_VERSION_RE.test(item)) {
                return reject('compatibleAppVersions', '数组条目必须是精确 x.y.z 版本字符串');
            }
        }
        if (list.includes(appVersion)) return allow('compatibleAppVersions');
        return reject('compatibleAppVersions', `版本 ${appVersion} 不在已验证版本列表中`);
    }

    if (hasOwn(platform, 'compatibleAppVersion')) {
        const legacy = platform.compatibleAppVersion;
        if (typeof legacy !== 'string') {
            return reject('compatibleAppVersion', 'compatibleAppVersion 必须是字符串');
        }
        if (legacyAllows(legacy, appVersion)) return allow('compatibleAppVersion');
        return reject('compatibleAppVersion', `版本 ${appVersion} 不匹配旧字段 ${legacy}`);
    }

    return reject('none', '未声明任何平台兼容版本字段');
}

module.exports = { isAppVersionAllowed };
