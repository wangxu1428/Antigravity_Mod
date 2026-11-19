# AGM-233-IPC-SEC-01 安全审计记录：Hakimi 主进程 IPC 调用方授权加固

- 轮次：IPC-SEC-01
- 基线提交：`a22f044fef898a93a8faccbb69be9314dc1aceb3`（`dev/compat-233-stage-b`）
- 环境：云端 Linux 盒子（`/workspace/agm/ipcsec`），非 Windows 实机；旭的 Windows PC 本轮离线。
- 真实底座：`REAL_BASE_2321 = NOT RUN`、`REAL_BASE_2330 = NOT RUN`（未在实机 `app.asar` 上执行）。
- 真实 Electron：Electron `44.9.1` + `xvfb-run`，在仓库外的 `W/electron_sandbox/` 中执行，未写入仓库依赖。

## 1. 威胁模型

Hakimi 注入的 13 个 `hakimi:*` 通道位于 Electron 主进程，具备文件读写、目录创建/删除、状态持久化、启动本地进程等特权。攻击面包括：

- 远程 WebContents（独立远程窗口、远程 iframe、webview）；
- 被导航到远程源的本地窗口；
- 合法窗口中的非主 Frame（跨源 iframe）；
- 已销毁或已关闭窗口的残留 sender / 伪造 sender 标识；
- renderer 伪造的窗口 ID、URL、`local` 标记、布尔参数。

`preload` 的 `isRemoteWindow` 分支、`contextBridge` 暴露范围、前端隐藏按钮只作为纵深辅助，不能作为主进程授权的唯一依据。

## 2. 授权策略（默认拒绝）

主进程维护一个仅由本地窗口工厂登记的可信 WebContents 允许表：

1. **登记（A/B）**：补丁在 `dist/main.js` 顶部安装 `agm_ipc_auth.js`，包装 `utils_1.createWindow`。只有通过该本地窗口工厂创建的 `BrowserWindow.webContents` 才登记，登记粒度为 WebContents 对象本身 + `webContents.id`。
2. **Frame 身份（C）**：每次调用要求 `event.senderFrame` 非空、未销毁、且严格等于 `event.sender.mainFrame`；子 iframe 一律拒绝。
3. **导航（D）**：监听主帧 `did-start-navigation`；首次加载完成后的任意主帧跨文档导航立即撤销登记。首次加载若已是明确的远程 http(s) 源（含重定向）也立即撤销。`will-redirect` 对主帧重定向到远程源做补充撤销。同文档导航（SPA hash/history）不撤销。
4. **销毁（E）**：监听 `destroyed`，撤销登记；每次调用同时检查 `sender.isDestroyed()`。
5. **远程内容（F）**：未登记的远程 WebContents、远程页面、远程子帧均无授权。
6. **未知/异常 sender（G）**：缺失 sender、缺失 senderFrame、frame 已销毁、sender 已销毁、id 复用导致对象不一致等情况一律拒绝。
7. **URL 只作附加条件**：仅用于“本地窗口首次加载/重定向到明确远程 http(s) 源”的补充撤销，以及创建时初始 URL 的远程判定；不以 URL 前缀、localhost 域名、`getURL()` 单次结果作为授权依据。
8. **过期授权**：导航或销毁后旧授权立即失效，不自动恢复；窗口需重新创建才会重新登记。

## 3. 统一门禁与失败语义

- 统一包装器：`createIpcAuthorizer().wrapHandle(ipcMain, channel, handler)`；`patch.js` 内 13 处 handler 全部改为 `secureHandle(...)`，没有第二套授权实现。
- 授权检查发生在 handler 任何副作用之前；未授权时不读敏感数据、不写文件、不创建目录、不启动进程、不调用其他特权 IPC。
- `ipcMain.handle` 未授权：抛出 `Error('unauthorized')`（`code = AGM_IPC_UNAUTHORIZED`），handler 不执行。
- `ipcMain.on` 未授权：直接返回 `undefined`，无副作用（当前 Hakimi 13 通道均为 handle，无 on）。
- 拒绝日志固定为 `[Hakimi IPC] denied channel=<通道名> reason=<短原因>`，原因仅为以下枚举之一：`missing-event`、`missing-sender`、`sender-destroyed`、`untrusted-sender`、`missing-frame`、`frame-destroyed`、`not-main-frame`、`missing-main-frame`、`frame-unavailable`、`sender-unavailable`、`main-frame-unavailable`。不记录路径、用户名、Token、Cookie、配置内容。
- 重复注册幂等：同一 WebContents 重复登记只保留一条；同一通道重复 `wrapHandle` 先 `removeHandler` 再注册，最终仅一个 handler。

## 4. 13 个通道清单（全部纳入本轮）

| # | 通道 | 类型 | 预期调用方 | 未授权处理 |
|---|------|------|------------|------------|
| 1 | `hakimi:get-plugins-dir` | handle | 本地主 Frame | 拒绝 `unauthorized` |
| 2 | `hakimi:list-plugins` | handle | 本地主 Frame | 拒绝 |
| 3 | `hakimi:read-plugin` | handle | 本地主 Frame | 拒绝 |
| 4 | `hakimi:read-config` | handle | 本地主 Frame | 拒绝 |
| 5 | `hakimi:save-config` | handle | 本地主 Frame | 拒绝 |
| 6 | `hakimi:launch-desktop-gpt` | handle | 本地主 Frame | 拒绝 |
| 7 | `hakimi:get-host-info` | handle | 本地主 Frame | 拒绝 |
| 8 | `hakimi:list-packages` | handle | 本地主 Frame | 拒绝 |
| 9 | `hakimi:read-package-entry` | handle | 本地主 Frame | 拒绝 |
| 10 | `hakimi:install-package` | handle | 本地主 Frame | 拒绝 |
| 11 | `hakimi:uninstall-package` | handle | 本地主 Frame | 拒绝 |
| 12 | `hakimi:read-state` | handle | 本地主 Frame | 拒绝 |
| 13 | `hakimi:write-state` | handle | 本地主 Frame | 拒绝 |

非 `hakimi:` 前缀但同样特权的通道：`updater:quit-and-install`、`updater:apply`、`updater:check-for-updates`（`dist/ipcHandlers.js`，由 `AGM_UPDATE_LOCK` 在副作用前短路）。它们不属于本轮 13 个 Hakimi 通道，也未新增授权门禁；其更新行为已被 AGM 更新锁阻断，本轮仅登记为范围外残余风险。`sshRemote`、`agyComputerPreview` 属于 preload contextBridge 暴露面，不是主进程 IPC 通道；远程分支不暴露 `hakimiHost`。

## 5. 代码位置

- 授权核心：`platform/mod_kit/agm_ipc_auth.js`
  - `isClearlyRemoteUrl`（第 19 行）
  - `createIpcAuthorizer`（第 35 行）
  - 导航/加载/销毁监听（第 81–150 行）
  - `register`（第 152 行）
  - `denyReason`（第 164 行）
  - `authorize`（第 185 行）
  - `wrapHandle` / `wrapOn`（第 209 / 228 行）
  - `installCreateWindowHook`（第 248 行）
- 补丁嵌入与 13 处门禁：`platform/mod_kit/patch.js`
  - 授权核心读取与完整性检查（第 9–21 行）
  - 生成的主进程授权块（第 138–158 行）
  - 统一 `secureHandle`（第 282–283 行）
  - 13 个 handler 改为 `secureHandle(...)`（第 285–604 行）
  - 写盘前后置校验：标记、13 个门禁、0 个未包装 handler（第 884–890 行）

## 6. 测试覆盖

- 新增 `tests/test_ipc_sec_unit.js`，SEC-01..18（含 SEC-08b/SEC-08c、SEC-12a/SEC-12b、SEC-LOG-1），全部调用真实授权函数或补丁生成的主进程代码；无“搜源码字符串”式通过；Windows 上出现 SKIP 判 FAIL。
- `.github/workflows/test.yml` 在 Windows 与 Ubuntu 均新增 `node tests/test_ipc_sec_unit.js`。
- 真实 Electron（`W/electron_sandbox`，仓库外）：SEC-01、02、03、04、05、08、09、10、LOG 共 9 项 PASS；证据见 `W/evidence/electron_results.json`、`W/evidence/electron_run.log`。
- 旧测试：Host、Reaper、Update lock、Repatch、Fault injection、Manifest raw-byte、i18n teardown、Compat 2.33.0、Compat versions，全部保持通过；详见交付报告。

## 7. 残余风险与 UNKNOWN

1. 本地窗口登记依赖 `utils_1.createWindow` 工厂；若未来版本改用其他工厂或解构调用，窗口会因未登记而被拒绝（fail-closed，不会越权），但可能影响功能，需要在新版本兼容时补充登记点。
2. 跨文档导航后不自动恢复授权；若官方页面在登录/换页后仍依赖 `hakimiHost`，该页面需重新创建窗口才能恢复，属安全优先的可用性取舍。
3. `updater:*` 通道未纳入本轮统一门禁，仅依赖 `AGM_UPDATE_LOCK` 阻断；建议后续轮次纳入同一授权框架。
4. 真实底座未运行：`REAL_BASE_2321 = NOT RUN`、`REAL_BASE_2330 = NOT RUN`；Stage-C 的 7 项实机验证仍未做，不能以 Stage-B 历史 25/25 代替。
5. Electron 44.9.1 无头测试不能完全等价于 Windows 实机 UI/安装器/便携目录行为；Windows 侧仅由 CI 单测覆盖。
