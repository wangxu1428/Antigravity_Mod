# Antigravity Mod (AGM) 插件开发指南 (Plugin Developer Guide v2.1.0)

本文档面向 Antigravity Mod 插件开发者，详细说明 **AGM Plugin Host v2.1.0** 的双轨插件运行模型、`manifest.json` 规范、权限目录与网关校验、`configSchema` 动态配置表单、Worker 沙箱 RPC API 以及主世界 UI 扩展接口。

---

## 1. 插件架构与用户数据隔离准则

### 1.1 双轨插件体系
仓库源码和用户机器上的加载路径是两套布局。`platform/scripts/install-or-update.ps1` 把源码复制到历史运行时路径，宿主与 `platform/mod_kit/patch.js` 注入的 `hakimi:list-plugins` / `hakimi:list-packages` 仍只扫描运行时路径。

1. **Web Worker 沙箱包插件（推荐，Package Plugins）**：
   - 仓库源码放在 `plugins/optional/<pluginId>/`。安装脚本把它复制到运行时 `plugins/repo/<pluginId>/`（只复制该 id，不删除 `plugins/repo/` 里的其他包）。
   - 用户在插件中心安装后，副本位于运行时 `plugins/packages/<pluginId>/`。升级不删除这个目录。
   - 运行在独立的 Web Worker 沙箱线程中（无 DOM、无直接网络、无 Node/Electron 原生权限），所有宿主能力均通过 `ctx.api.*` 异步 RPC 调用，并受 `manifest.permissions` 强校验与超时熔断（默认 `2500ms`）保护。
2. **传统主世界内置插件（Legacy Main-World Plugins）**：
   - 仓库源码放在 `plugins/builtin/<id>/`（当前为 `hakimi-i18n`、`ai-sidedock`）。安装脚本把 `<id>.js` 复制到运行时 `plugins/<id>.js`。`hakimi-i18n` 的模块目录复制到运行时 `plugins/hakimi-i18n/`。
   - 宿主只注入运行时 `plugins/*.js` 顶层脚本。这些插件运行在渲染进程主世界，可通过 `window.HakimiPluginHost.register(id, pluginObj)` 注册，并可使用 `window.HakimiPluginHost.ui` 将自定义配置页或导航项嵌入 AGM Hub v2.1。

### 1.2 用户数据与平台升级生命周期隔离
- **仓库中的平台源码（可更新，安装时复制到运行时）**：`platform/mod_kit/`、`platform/agm-plugin-host.js`、`platform/config.default.json`、`plugins/builtin/`、`plugins/optional/`。
- **运行时平台文件（复制覆盖的是这些路径，不是用户数据）**：`mod_kit/`、`plugins/agm-plugin-host.js`、`plugins/hakimi-i18n.js`、`plugins/ai-sidedock.js`、`plugins/hakimi-i18n/`、`plugins/repo/<随仓库分发的 id>/`、`plugins/config.default.json`。
- **用户数据保护区（已列入 `.gitignore`，平台升级严禁覆盖或删除）**：
  - `UserData/`：便携版 Chromium / Electron 登录态、Cookie 与会话存储。
  - `plugins/config.json`：内置插件运行态用户配置（首次安装时从运行时 `plugins/config.default.json` 初始化；模板的仓库路径是 `platform/config.default.json`）。
  - `plugins/state/registry.json`：宿主全局设置与插件启停注册表。
  - `plugins/state/configs/<pluginId>.json`：沙箱插件独立用户配置与私有 KV 存储（`{ "config": {...}, "storage": {...} }`）。
  - `plugins/state/logs/<pluginId>.log`：插件运行与权限审计日志。
  - `plugins/packages/<pluginId>/`：用户已安装的沙箱插件包副本。

---

## 2. 沙箱插件包结构与 `manifest.json` v1 规范

每个沙箱插件包必须包含 `manifest.json` 与入口 JS 文件（如 `index.js`）：

```json
{
  "manifestVersion": 1,
  "id": "agm-hello-guard",
  "name": "AGM Hello Guard",
  "author": "Hakimi Tech Lab",
  "version": "1.0.0",
  "description": "Safe sandboxed example plugin demonstrating configSchema, storage counter, toast UI, and permission denial.",
  "compatibility": {
    "appVersion": ">=1.0.0",
    "hostVersion": ">=2.0.0"
  },
  "entry": "index.js",
  "permissions": [
    "ui:toast",
    "config:read",
    "storage:read",
    "storage:write"
  ],
  "actions": [
    {
      "id": "greet",
      "label": "执行问候 (greet)",
      "description": "读取配置、累加私有存储计数器并弹出 Toast 通知"
    }
  ],
  "configSchema": {
    "showToast": {
      "type": "boolean",
      "title": "启用 Toast 通知",
      "description": "执行 greet 动作时是否弹出轻量通知",
      "default": true
    },
    "greetingPrefix": {
      "type": "string",
      "title": "问候语前缀",
      "default": "Hello Antigravity",
      "required": true,
      "minLength": 2,
      "maxLength": 32,
      "pattern": "^[\\u4e00-\\u9fa5A-Za-z0-9 _!#-]+$"
    },
    "stepSize": {
      "type": "number",
      "title": "计数步进值",
      "default": 1,
      "required": true,
      "min": 1,
      "max": 100,
      "integer": true
    },
    "tone": {
      "type": "enum",
      "title": "输出风格",
      "default": "friendly",
      "options": [
        { "value": "friendly", "label": "友好 (friendly)" },
        { "value": "formal", "label": "正式 (formal)" },
        { "value": "concise", "label": "精简 (concise)" }
      ]
    }
  }
}
```

### 2.1 字段校验规则
- `manifestVersion`：必须为整数 `1`。
- `id`：匹配 `/^[a-z0-9][a-z0-9._-]{1,63}$/`，且必须与所在目录名严格一致。
- `version`：标准 SemVer（如 `1.0.0`）。
- `compatibility`：必填 `appVersion` 与 `hostVersion`（支持 `*`、`>=x.y.z`、`^x.y.z`、`>=1.0.0 <3.0.0`）。
- `entry`：包内相对 `.js` 路径，禁止 `..` 或绝对路径。

---

## 3. 权限目录与 RPC 能力映射 (`PERMISSIONS_CATALOG`)

沙箱内调用任何 `ctx.api.*` 方法时，宿主权限网关会校验 `manifest.permissions`。未声明权限将立即被拦截并返回错误码 `E_PERMISSION_DENIED`：

| 权限标识符 (`manifest.permissions`) | 映射的 Worker RPC 能力 (`ctx.api.*`) | 风险等级 | 说明 |
|---|---|---|---|
| `ui:toast` | `ctx.api.ui.showToast(message, level)` | 低 | 在插件中心展示提示通知（`info`/`success`/`warn`/`error`） |
| `ui:banner` | `ctx.api.ui.setBanner(text, style)` | 低 | 在插件详情页展示状态横幅 |
| `config:read` | `ctx.api.config.get(key)` / `getAll()` | 低 | 读取当前插件的配置项 |
| `config:write` | `ctx.api.config.set(key, value)` | 中 | 经 `configSchema` 校验后修改当前插件配置 |
| `storage:read` | `ctx.api.storage.get(key)` | 低 | 读取当前插件私有 KV 存储 |
| `storage:write` | `ctx.api.storage.set(key, value)` | 低 | 写入当前插件私有 KV 存储（单插件序列化上限 **64 KB**） |
| `clipboard:read` | `ctx.api.clipboard.readText()` | 中 | 读取系统剪贴板文本 |
| `clipboard:write` | `ctx.api.clipboard.writeText(text)` | 中 | 向系统剪贴板写入文本 |
| `shell:launchDesktopGpt` | `ctx.api.shell.launchDesktopGpt()` | 高 | 请求宿主拉起本地 ChatGPT 桌面端 |

---

## 4. Worker 沙箱插件生命周期接口

在 `entry`（如 `index.js`）中通过 `module.exports` 导出：

```javascript
'use strict';

module.exports = {
  async activate(ctx, initialConfig) {
    // 插件启用或重载时触发
    return { activated: true };
  },

  async invoke(actionId, payload, ctx) {
    // 用户点击详情页动作按钮或外部调用 invokePlugin(id, actionId, payload) 时触发
    if (actionId === 'greet') {
      const cfg = await ctx.api.config.getAll();
      await ctx.api.ui.showToast(cfg.greetingPrefix, 'info');
      return { ok: true };
    }
    throw new Error('Unknown action: ' + actionId);
  },

  async onConfigChange(newConfig, ctx) {
    // 用户在详情页保存配置且插件处于 ACTIVE 状态时触发
    return { updated: true };
  },

  async deactivate(ctx) {
    // 插件禁用、卸载或重载停止前触发（1000ms 超时后宿主终止 Worker）
    return { deactivated: true };
  },
};
```

---

## 5. 主世界插件 AGM Hub v2.1 UI 扩展接口

内置主世界插件可通过 `window.HakimiPluginHost.ui` 将配置面板直接嵌入 AGM Hub：

- `HakimiPluginHost.ui.registerDetailPanel(pluginId, { id, title, order, render(container), onShow(container), onHide() })`：向指定插件的详情页注册自定义内嵌标签面板（例如 `hakimi-i18n` 注册的「本地化配置」面板）。
- `HakimiPluginHost.ui.registerNavItem({ id, label, icon, title, badge, onClick })`：向主界面左侧边栏注册原生风格导航入口。
- `HakimiPluginHost.ui.registerPage({ id, title, render(container) })`：向 AGM Hub 注册独立全幅页面。

---

## 6. 离线单元测试

在仓库根目录执行以下命令即可运行纯 Node.js 离线单元测试（无需启动客户端，不写生产目录）：

```bash
node tests/test_host_unit.js
node tests/test_reaper_unit.js
node tests/test_update_lock.js
```
