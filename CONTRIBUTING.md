# 参与贡献

所有变更都通过 Pull Request 进入受保护的 `main`。不要直接推送 `main`，不要 force push。

## 分支与 Pull Request

1. 从最新的 `main` 建立分支。分支名用小写短横线，例如 `docs/versioning`、`feat/plugin-hello`。
2. 在分支上提交。一次提交只做一件事。
3. 向 `main` 开 Pull Request。说明里写清改了什么；若涉及平台或插件行为，确认这次更新不会覆盖或删除用户数据。
4. 由维护者合并。不要对 `main` 强推，也不要改写已经推送的公共历史。

## 提交说明

使用简短的约定式提交：

```text
<type>(<scope>): <摘要>

type：feat、fix、docs、chore
scope（可选）：platform、plugins、plugin-api、index、docs
```

摘要说明做了什么，中文或英文均可。

```text
docs(index): 添加插件索引模板
```

## 如何提交插件

1. 从最新 `main` 建分支。
2. 添加 `plugins/optional/<id>/README.md`，写明用途、作者，以及兼容的平台版本范围。`<id>` 使用小写字母、数字、连字符或点，创建后不改。内置插件放在 `plugins/builtin/<id>/`，不通过这条索引流程提交。
3. 准备该版本的发行包。包内不得包含下面的禁止内容。按 [index/README.md](index/README.md) 计算发行包文件的 SHA256。
4. 在 [`index/plugins.json`](index/plugins.json) 的 `plugins` 数组追加一条。必填：`id`、`name`、`version`、`author`、`description`、`platformCompatibility`、`downloadUrl`、`sha256`。版本号遵循 [docs/versioning.md](docs/versioning.md)，且与发行包一致。
5. 开向 `main` 的 Pull Request，写上插件 ID、版本、平台兼容范围和 SHA256。

不要把 `examples` 里的示范条目改成正式插件，也不要删掉字段说明。只改文档或索引、没有新发行包时，跳过第 3 步。

`plugin-api/` 的接口规范尚未编写，由开发者负责。在规范落地前，不要自行添加接口、字段或协议。

## 禁止内容

提交、发行包，以及索引所指向的由本仓库发布的文件，都不得包含：

- Antigravity 官方程序，以及任何修改版 Antigravity 可执行文件（含 `*.exe`、`app.asar` 和官方程序资源）
- 用户数据（如 `UserData/`、`user-data/`），以及缓存、临时文件、日志、备份和历史记录
- `.env`、私钥、令牌、cookie 和其他密钥文件
- 路径中任意位置的 `02_Personal/` 目录及其下全部内容
- 个人隐私或不适合放进公开仓库的数据

会覆盖或删除用户数据的改动不予合并。忽略规则见仓库根目录的 `.gitignore`。
