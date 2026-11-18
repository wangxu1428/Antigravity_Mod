# 插件索引

本目录是插件的收录入口。安装与更新以这里的记录为准，不扫描仓库里的其他文件来发现插件。

| 文件 | 作用 |
| --- | --- |
| [`plugins.json`](plugins.json) | 索引数据。`plugins` 是正式条目，目前为空。`examples` 里只有一条格式示范。 |
| [`plugins.schema.json`](plugins.schema.json) | 字段结构（JSON Schema draft 2020-12）。 |

`schemaVersion` 是索引文档结构的版本，当前为 `1`。它不是平台版本，也不是某个插件的版本。

## 字段

| 含义 | JSON 字段 | 要求 |
| --- | --- | --- |
| 插件 ID | `id` | 小写字母、数字、连字符或点，创建后不改 |
| 名称 | `name` | 展示名称 |
| 版本 | `version` | 该插件的 SemVer，不带 `v` 前缀 |
| 作者 | `author` | 作者或团队名 |
| 简介 | `description` | 插件做什么 |
| 平台兼容范围 | `platformCompatibility` | 相对**平台**版本的 semver 范围 |
| 下载地址 | `downloadUrl` | 该版本发行包的 URL，对应下面的 SHA256 |
| SHA256 | `sha256` | 发行包原始字节的 SHA256，64 位小写十六进制 |

`platformCompatibility` 比较的是平台版本（标签 `platform-vX.Y.Z` 中的 `X.Y.Z`），使用 [node-semver](https://github.com/npm/node-semver) 范围语法，例如 `>=0.1.0 <1.0.0`。它不是 Antigravity 官方程序的版本号。

可选字段 `example`：正式条目不得为 `true`。示范条目必须为 `true`，安装器必须忽略。

## 示例条目

`plugins.json` 的 `examples` 中有且仅有一条示范，`id` 为 `example-plugin`。它用来展示字段写法：没有发行包，下载地址使用保留域名 `example.invalid`，SHA256 为全零。不要安装，也不要把它移入 `plugins`。

## 计算 SHA256

对发行包文件本身取 SHA256，不要对解压后的文件列表或十六进制文本再哈希。

```bash
sha256sum path/to/package.zip
```

```bash
shasum -a 256 path/to/package.zip
```

输出的 64 位十六进制改为小写后写入 `sha256`。`downloadUrl` 必须指向参与计算的那一个文件。
