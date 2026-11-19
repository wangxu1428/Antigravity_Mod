# 插件 API / 接口规范

本目录用于存放插件平台的独立版本化 API 规范与形式化接口定义（当前 v2.1.0 的实际实现与接口文档已先写于 [`docs/PLUGIN_DEV_GUIDE.md`](../docs/PLUGIN_DEV_GUIDE.md)）。

## 当前已落地的 v2.1.0 接口能力（与 `docs/PLUGIN_DEV_GUIDE.md` 对齐）

1. **沙箱插件包规范（Manifest v1）**：包含 `manifestVersion`（`1`）、`id`、`version`、`compatibility`（`appVersion` / `hostVersion`）、`entry`、`permissions`、`actions` 与 `configSchema`（支持 `boolean`、`string`、`number`、`enum` 四种字段类型及校验约束）。
2. **权限目录与宿主 RPC 网关（`PERMISSIONS_CATALOG`）**：在独立 Web Worker 沙箱内通过 `ctx.api.*` 调用宿主能力（`ui:toast`、`ui:banner`、`config:read`、`config:write`、`storage:read`、`storage:write`、`clipboard:read`、`clipboard:write`、`shell:launchDesktopGpt`），未声明权限将被宿主拦截并返回 `E_PERMISSION_DENIED`。
3. **Worker 生命周期接口**：通过 `module.exports` 导出 `activate(ctx, initialConfig)`、`invoke(actionId, payload, ctx)`、`onConfigChange(newConfig, ctx)` 与 `deactivate(ctx)`。
4. **内置主世界插件扩展接口**：通过 `window.HakimiPluginHost.register(id, pluginObj)` 注册，并可通过 `window.HakimiPluginHost.ui`（`registerDetailPanel`、`registerNavItem`、`registerPage`）向 AGM Hub 注入界面扩展。

详细字段定义、示例与约束请以 [`docs/PLUGIN_DEV_GUIDE.md`](../docs/PLUGIN_DEV_GUIDE.md) 为准。本目录预留用于后续从开发指南中拆分出的独立版本化规范与 Schema；在正式规范文档落盘前，请勿在本目录自行添加冲突或未经评审的接口、字段与协议。
