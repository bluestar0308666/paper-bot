# Paper Bot · 公众号 → 论文 → 总结

把一篇微信公众号文章链接丢进来，自动：

1. 抓取公众号正文（含公众号发布时间）
2. 用大模型判断文章主讲哪篇论文（标题 / DOI / PMID / 期刊 / 年份）
3. 去 PubMed 精确匹配（PMID → DOI → 标题+期刊+年份 过滤）
4. 抓 PubMed 摘要，连同公众号正文一起交给大模型
5. 输出：中英文标题 / 关键词 / 发表日期 / 中文总览 / 一句话结论
6. 点击论文进入深度解读：研究背景、核心突破、技术创新、关键结果、应用前景、未来展望、生信视角
7. 找不到对应论文时，直接总结公众号内容

## 技术栈
- Node.js（Termux 里 v24）+ Express + 内置 `node:sqlite`（免编译）
- 大模型：DeepSeek（OpenAI 兼容接口）
- 数据源：PubMed E-utilities

## 功能
- 网页端：批量粘贴公众号链接或完整英文论文标题、双语标题、详情解读、作者机构、搜索、删除、重新解析、**导出 Markdown**
- 访问密码（Basic Auth）
- SQLite 持久化队列：一次多条，逐条处理，重启后自动恢复
- 重复链接自动跳过，失败任务可在网页重试
- 一键下载数据库备份（服务器同时保留一份）
- 外网访问：`ssh -R` 隧道（tunnel.sh，断线自动重连）

## 部署（云手机 Termux）

首次安装只需在 Termux 粘贴这一行：

```bash
curl -fL https://ghfast.top/https://raw.githubusercontent.com/bluestar0308666/paper-bot/main/bootstrap.sh -o "$PREFIX/tmp/paper-bot-install.sh" && bash "$PREFIX/tmp/paper-bot-install.sh"
```

脚本会复用现有 Node v24、OpenSSH、`~/pubmed` 和 `.bashrc` 自启；只有检测到组件缺失时才调用 `pkg install`。它会下载最新版、保留原有 DeepSeek Key、网页密码和数据库，并精准重启 Paper Bot，不会停止 `~/123` 的 qqfarm。

以后更新：

```bash
paper-bot update
```

常用维护命令：

```bash
paper-bot status
paper-bot log
paper-bot restart
paper-bot backup
paper-bot tunnel-start
paper-bot tunnel-url
```

如需安卓开机自动运行，请安装 Termux:Boot，并允许 Termux/Termux:Boot 后台运行和忽略电池优化。安装脚本会自动创建启动文件。

### 手动部署

```bash
cd ~/pubmed
bash install.sh          # 装依赖、填配置、启动、设自启
bash tunnel.sh           # 开外网隧道，会打印公网网址
```

从旧版本升级时保留原来的 `config.json` 和 `data.db`，覆盖其余文件后重启即可。数据库会自动增加新字段；旧文章需在网页点击“重新解析”来生成中文标题和深度解读。

## 配置 `config.json`
```json
{
  "DEEPSEEK_API_KEY": "sk-...",
  "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
  "DEEPSEEK_MODEL": "deepseek-chat",
  "PORT": 3008,
  "PASSWORD": "你的访问密码"
}
```

## 接口
- `POST /api/add` `{url}`
- `POST /api/add-many` `{urls:[...]}`
- `GET /api/queue` 队列状态
- `POST /api/job/:id/retry` 重试失败任务
- `GET /api/list?q=` 列表/搜索
- `GET /api/item/:id` 论文详情
- `DELETE /api/item/:id`
- `POST /api/item/:id/reprocess` 重新解析
- `GET /api/export` 导出 Markdown
- `GET /api/backup` 下载 SQLite 备份
