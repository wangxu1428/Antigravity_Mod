Antigravity_Mod 全套方案技术架构与算法公式白皮书
文档版本：v1.0.0 (Release)编写团队：哈基米技术组 (Hakimi Tech Lab)面向对象：架构师、核心协作者与深度技术评审团队工程环境：C:\Antigravity_Mod\ (隔离运行时) vs %OFFICIAL_APP_DIR%\ (原版基线)
一、宏观系统拓扑与双开隔离架构
整个方案的核心目标是：在绝对不影响现有正在运行的原厂客户端前提下，构建一个全相对路径、零环境污染、可热插拔扩充能力的独立便携客户端。
1.1 系统物理拓扑结构
宿主操作系统（Windows 11 x64）：
操作系统安全凭据层（Shared Vault）：Windows 凭据管理器（keytar / 'Antigravity'）与 ~/.gemini/antigravity/（会话、项目数据库与 Brain）。
原版运行实例（D: 盘保底）：%OFFICIAL_APP_DIR%\Antigravity.exe，CDP 调试端口 9223，UserData 位于 %APPDATA%\Antigravity。
便携爆改实例（C:\Antigravity_Mod）：Antigravity.exe（启动爆改版.bat），UserData 位于 C:\Antigravity_Mod\UserData，挂载外置热插拔插件插座 plugins/（含 ai-sidedock.js、hakimi-i18n.js、config.json）。实验室/本机正式实例可开启 CDP 调试端口 9224；公开发行的启动器默认关闭远程调试，需设置 AGM_DEBUG_PORT 或传入 --debug-port 才会开启（详见 README）。
1.2 关键参数对比
架构维度
官方原版 (%OFFICIAL_APP_DIR%)
便携爆改版 (C:\Antigravity_Mod)
隔离保障机制
程序执行基准
%OFFICIAL_APP_DIR%\Antigravity.exe
%~dp0Antigravity.exe
绝对隔离，独立可执行文件副本
单例互斥锁
占用全局默认 app.requestSingleInstanceLock()
基于独立 UserData 派生独立单例互斥锁
两者进程互不抢占锁，可同屏并发双开
Chromium UserData
%APPDATA%\Antigravity
C:\Antigravity_Mod\UserData
缓存、GPU Cache、LevelDB 物理彻底隔离
CDP 远程调试端口
127.0.0.1:9223
默认关闭；可选 127.0.0.1:9224（AGM_DEBUG_PORT / --debug-port）
端口完全分立，自动化与探针零冲突
修改模式
传统侵入式修改（旧汉化改动 asar 达 1.87MB）
插座解耦式（asar 仅增加 710 字节通用总线）
外置插件热插拔，asar 零业务污染
二、双开免打码与凭据安全共享机制
&quot;免打码&quot;原理阐述：很多双开修改直接强行变更 app.setName('Antigravity_Mod')，导致 Electron 调用 keytar 读取 Windows 凭据管理器时找不到对应密钥，强制触发 Google 网页二次 OAuth 登录与人机验证（reCAPTCHA/打码）。

本方案采用 &quot;容器物理隔离 + 凭据逻辑共享&quot; 拓扑：

凭据安全共享：
保持主进程 app.getName() 为官方原生标识符 antigravity。
keytar 向 Windows Credential Manager 查询 service = &quot;Antigravity&quot;，直接安全复用已持久化的 Google 账号 OAuth Refresh Token。
共享 ~/.gemini/antigravity 目录：历史会话、项目结构（如&quot;Project_Alpha&quot;、&quot;Project_Beta&quot;）立即可见。
容器与单例隔离：在 dist/main.js 执行单例锁之前注入便携 UserData 挂载锁：
tconst exeDir = path.dirname(process.execPath);const portableUserData = path.join(exeDir, 'UserData');if (fs.existsSync(portableUserData)) {app.setPath('userData', portableUserData);}


**效果**：双击启动时，Chromium 的全部磁盘缓存、LocalStorage、Cookies 和崩溃日志全部收敛在 `C:\Antigravity_Mod\UserData\`，绝不污染系统盘 `%APPDATA%`。

## 三、HakimiPluginHost 热插拔插件插座总线

为了摆脱&quot;每次功能修改都必须重新拆包打包 `app.asar`&quot;的落后模式，我们在 Electron 底座中焊入了轻量级通用插件插座总线 `HakimiPluginHost`。

### 3.1 总线运行生命周期

1. 窗口启动时，`dist/main.js` 向 `dist/preload.js` 暴露 `hakimiHost` API。
2. `Preload` 调用 `hakimi:read-config` 读取 `config.json`，调用 `hakimi:list-plugins` 动态扫描 `plugins/*.js`。
3. 循环读取每个插件源码（UTF-8）并通过 `webFrame.executeJavaScript` 注入渲染窗口，调用 `HakimiPluginHost.register(name, { init, teardown })` 与 `plugin.init(config)` 挂载 DOM 与事件。
4. 用户在窗口按下 `Ctrl+R` 或 `F5` 时，拦截刷新事件并触发 `initHakimiHost(isReload=true)`，先执行各插件的 `__teardown()` 清理旧 DOM 与监听器，再重新读取最新 `config.json` 与外部 `*.js` 实现零重启秒级热重载。

### 3.2 底座增强清单（Diff 净增仅 710 字节）

1. **`dist/main.js`**：
   * 注入 `hakimi:list-plugins`：`fs.readdirSync(getPluginsDir()).filter(f =&gt; f.endsWith('.js'))`（纯动态扫描，零写死白名单）。
   * 注入 `hakimi:read-plugin`、`hakimi:read-config`、`hakimi:save-config`。
   * 注入网络会话响应头过滤器：剥离 `X-Frame-Options`，清洗 CSP `frame-ancestors`，解除外链嵌套限制。
2. **`dist/preload.js`**：
   * 暴露 `window.hakimiHost` 接口。
   * 注册全局键盘监听：拦截 `Ctrl + R` 与 `F5`，触发插件热重载。
3. **`dist/utils.js`**：
   * 开启主窗口参数：`webviewTag: true`。

## 四、子系统 A：三巨头 AI Side-Dock 侧边舱架构与布局公式

### 4.1 视口挤压与外侧分屏数学模型

传统侧边栏通常采用绝对悬浮遮罩（`position: absolute; right: 0;`），直接盖住原本的会话内容或滚动条。本方案采用**视口挤压自适应模型**。

Antigravity 2.32.1 顶栏高 35px（`-webkit-app-region: drag`），下方主内容区为 `.agy-inset-shell`。通过向宿主根节点动态注入 CSS 变量 `--hakimi-dock-offset` 实现非侵入式分屏：

`W_main = calc(100% - var(--hakimi-dock-offset, 0px))`

### 4.2 宽度夹紧与阻尼限制公式

为防止用户在拖拽调节侧边栏宽度时将其拉过大导致主会话被压烂，或拉过小导致 Webview 无法阅读，侧边舱实施了边界夹紧函数：

`W(x) = clamp(W_min, X_window - x, W_max)`

* `W_min = 280px`（侧边舱最小可用宽度）
* `W_max = X_window - 320px`（确保左侧主会话至少保留 320px 宽度）
* `X_window` 为当前宿主窗口总内部宽度（`window.innerWidth`），`x` 为鼠标当前指针位置（`e.clientX`）

### 4.3 鼠标事件穿透防御机制

**踩坑复盘**：在 Electron 中向内嵌 `&lt;webview&gt;` 拖拽时，一旦光标掠过 `&lt;webview&gt;` 边界，Chromium 会将后续所有鼠标事件派发至子进程沙箱，导致主窗口拖拽逻辑断流卡死；若使用全屏 `inset: 0` 遮罩，Chromium Blink 引擎又会把宿主顶部的 `-webkit-app-region: drag` 系统标题栏拖动区域吃掉。

**解决方案（双重隔离）**：

1. **API 层**：拖拽手柄在 `pointerdown` 时调用 `resizer.setPointerCapture(e.pointerId)`，将指针事件全局锁定。
2. **DOM 遮罩层**：动态激活 scoped 缩放遮罩，其物理范围精确限定在顶栏下方：`top: 35px; bottom: 0; left: 0; right: 0;`，闲置状态下设置为 `display: none`，拖拽激活时显化，严禁声明 `-webkit-app-region: no-drag`。

### 4.4 懒加载与沙箱分区配置

| 标签 | 目标 URL | 独立沙箱持久化分区 (Partition) | 内存开销模型 |
| :--- | :--- | :--- | :--- |
| **云端本喵** | `https://gemini.google.com/app` | `persist:hakimi_gemini` | 默认未激活：0 MB；点击后：独立单进程 |
| **GPT网页** | `https://chatgpt.com` | `persist:hakimi_gpt` | 默认未激活：0 MB；点击后：独立单进程 |
| **Grok** | `https://grok.com` | `persist:hakimi_grok` | 默认未激活：0 MB；点击后：独立单进程 |

## 五、子系统 B：Hakimi i18n 深度本地化引擎与翻译算法

### 5.1 六级瀑布流翻译流水线算法

翻译引擎采用短路求值的多级瀑布流管道，依托预构建哈希索引与双层缓存实现 O(1) 查询复杂度：

1. **第一级**：英文白名单（Exclusions）命中则写入 Negative 缓存并短路返回 null（保留原文）。
2. **第二级**：用户自定义覆盖（Custom Overrides）命中则应用首尾空格保持函数并写入 Positive 缓存。
3. **第三级**：官方精确匹配（Exact &amp; Core）命中则返回中文结果。
4. **第四级**：长句前缀规则（Prefix Rules）命中则替换前缀并递归翻译尾部。
5. **第五级**：动态正则匹配（Regex Rules）命中则执行正则捕获组替换。
6. **第六级**：专业术语表（Glossary）命中则按单词边界 `\bTerm\b` 替换；全部未命中则录入未翻译文本发现库（LRU Cache）并写入 Negative 缓存。

### 5.2 核心数学与字符串算法公式

1. **首尾空白字符无损保真函数**：
   `applyWhitespace(x, y) = leadingWS(x) + y + trailingWS(x)`
   其中 `leadingWS(x) = x.match(/^(\s*)/)[1]`，`trailingWS(x) = x.match(/(\s*)$/)[1]`。
2. **占位符与敏感参数遮蔽还原公式**：
   在进入翻译管道前将占位符（`{[a-zA-Z0-9_-]+}`、`%[sdif]`、`${[^}]+}`）、代码与链接（`` `[^`]+` ``、`https?:\/\/[^\s]+`）以及模型唯一标识符（`\b(gemini|gpt|claude|grok)-[a-zA-Z0-9.-]+\b`）替换为掩码 Token，翻译完成后无损还原。
3. **批量调度与熔断保护公式**：
   * 设置原子防重入锁 `isTranslating` 与 `requestAnimationFrame` 动态帧聚合。
   * **高频熔断器**：当 `Delta_M &gt; 1500` 且 `Delta_t &lt; 1000ms` 时进入 `OPEN` 熔断降级状态，杜绝 `MutationObserver` 死循环与 CPU 风暴。
4. **浮动胶囊坐标自适应联动公式**：
   `right = 20px + var(--hakimi-dock-offset, 0px)`
   SideDock 收起时距右 20px；展开至 450px 时自动平滑推移至距右 470px。

## 六、重铸工具箱与灾难恢复机制

所有自动化工具在用户机器上仍位于 `C:\Antigravity_Mod\mod_kit\`（含 `patch.js`、`repatch.ps1`、`repatch.bat`）。仓库源码在 `platform/mod_kit/`，由安装脚本复制到该运行时目录，不改变应用内的相对路径：

1. **秒级原厂恢复**：官方原始未修改备份保存于 `C:\Antigravity_Mod\resources\app.asar.bak`（大小：`5,656,861` 字节，SHA256：`5b493943...`），覆盖回 `app.asar` 即可在 1 秒内退回 100% 原厂状态。
2. **版本升级一键重铸**：官方发布新版本覆盖 `app.asar` 后，双击运行 `mod_kit\repatch.bat` 即可从 `%~dp0` 动态计算相对路径并在 3 秒内完成重新切片与注入，`plugins/` 下的业务插件无需重写。

## 七、方案核心技术公式速查总表

| 序号 | 核心公式 / 算法 | 应用场景 | 算法特性 |
| :---: | :--- | :--- | :--- |
| **1** | `W(x) = clamp(280, X_win - x, X_win - 320)` | SideDock 侧边舱手柄拖拽宽度计算 | 边界阻尼，防止挤塌主会话 |
| **2** | `W_main = calc(100% - var(--offset, 0px))` | 主会话内容区视口推移自适应 | 原生 CSS 级响应，零重绘抖动 |
| **3** | `R_pill = 20px + var(--offset, 0px)` | i18n 悬浮胶囊跟随侧边栏滑移 | 自动贴边防重叠 |
| **4** | `applyWS(x, y) = leadWS(x) + y + trailWS(x)` | 文本替换前后的空白字符保真 | 保证界面排版与弹性盒微间距不变 |
| **5** | `Text -&gt; Tokens -&gt; Zh -&gt; Final` | 占位符、URL、模型ID无损遮蔽还原 | 确保技术变量与网络参数不被篡改 |
| **6** | `Delta_M &gt; 1500 per 1000ms =&gt; CircuitBreak` | MutationObserver 批量调度与熔断 | 杜绝死循环与 CPU 风暴 |
| **7** | `Priority: Ex &gt; Ovr &gt; Glo &gt; Exact &gt; Reg &gt; En` | 6 级瀑布流翻译求值管道 | 短路求值，哈希 O(1) 查找 |
