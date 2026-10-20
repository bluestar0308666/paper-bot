# PaperBot：个人科研文献解析与知识库

PaperBot 可以接收论文标题、PubMed 链接或微信公众号文章，识别其中对应的论文，并生成结构化中文解读，最终保存到可检索的个人文献库中。

## 主要功能

- 支持直接提交论文标题或文章链接
- 尽可能识别论文标题、作者、机构、期刊、DOI 和 PMID 等信息
- 调用 DeepSeek 生成中文翻译与结构化分析
- 分析核心突破、技术创新、实验结果、应用前景、生信视角等内容
- 使用 Node.js 内置 `node:sqlite` 保存数据
- 支持注册登录、用户独立文献库、收藏、分页和管理统计
- 可运行于普通 Linux 服务器或 Android Termux

## 环境要求

- Node.js 22 或更高版本，推荐 Node.js 24
- DeepSeek 或兼容接口的 API Key
- 运行时依赖仅为 `express`

项目特意使用 Node 内置的 `DatabaseSync`，请不要安装 `better-sqlite3`，以避免 Termux 上的原生编译问题。

## 快速启动

```bash
cp config.example.json config.json
npm install
npm start
```

启动前编辑 `config.json`，填入自己的模型接口配置。`PASSWORD` 非空时会启用兼容旧部署的 Basic Auth。默认端口通常为 `3008`。

公网部署建议使用非 root 用户运行，并放在带 HTTPS 的 Caddy 或 Nginx 后面。端口 `3008` 应仅监听本机，或由防火墙限制访问。

## Termux 部署

```bash
pkg install nodejs-lts openssh
```

把项目复制到 `~/pubmed`，创建 `config.json` 后执行：

```bash
bash install.sh
```

`tunnel.sh` 可通过 localhost.run 提供临时外网入口；免费隧道重新连接后网址可能变化。

## 配置示例

仓库提供 `config.example.json`。请复制后再填写真实配置，不要直接在示例文件中保存密钥。

```json
{
  "DEEPSEEK_API_KEY": "your-api-key",
  "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
  "DEEPSEEK_MODEL": "deepseek-chat",
  "PORT": 3008,
  "PASSWORD": ""
}
```

## 数据与备份

以下内容已经被 `.gitignore` 排除：

- `config.json`
- `data.db` 及其 WAL/SHM 文件
- 日志、备份和临时文件

升级前请备份数据库。不要把生产环境的 API Key、用户数据库或日志提交到公开仓库。

## 基础检查

```bash
node --check server.js
npm ci --ignore-scripts
```

启动后，请使用与浏览器相同的认证方式检查 `/api/list`。

## 开源协议

PaperBot 采用 [MIT License](LICENSE)。仓库不包含用户数据、API 密钥或第三方文章内容。

