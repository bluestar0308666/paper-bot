# PaperBot Skill 化评估与施工方案

核查日期：2026-10-14

本文件只记录现状和方案。本次未修改服务器、OpenClaw、PaperBot 或渠道配置。

## 1. 结论

PaperBot 很适合封装为 OpenClaw Skill，而且服务器中已经存在一个可用的 `paperbot` 初版 Skill。

当前不需要从零建设，建议采用“小步加固”的方式：

1. 保留现有 OpenClaw、PaperBot、DeepSeek Flash 和微信/飞书渠道。
2. 先完善现有 `paperbot` Skill 的触发规则、输入校验、超时、错误处理和返回格式。
3. 对 PaperBot API 做极小范围增强，让 Skill 可以按任务 ID 查询结果，不再轮询全部队列和全部文献。
4. 验证稳定后，再考虑专用工具或直达命令，以进一步减少 OpenClaw 模型调用。

## 2. OpenClaw Skill 机制核查

当前 OpenClaw：2026.9.8。

实际加载目录：

- Workspace：`/home/ubuntu/.openclaw/workspace`
- Managed skills：`/home/ubuntu/.openclaw/skills`
- Bundled skills：OpenClaw npm 安装目录内的 `skills/`
- 插件也可以携带 Skill。

当前 Skill 清单：

- 总数：61
- 当前可用：26
- 当前不可用：35（大多因为运行环境或配置不满足）
- 来源：bundled 49、custom 4、extra 6、managed 1、workspace 1

OpenClaw 使用每个目录中的 `SKILL.md` 读取：

- `name`
- `description`
- 工作流程说明
- 可选依赖/调用元数据

模型通常根据 `description` 判断是否调用 Skill。用户也可以显式使用 `$paperbot` 或 `/paperbot`。

## 3. 已有 PaperBot Skill

现有 Skill：

- 名称：`paperbot`
- 来源：`openclaw-managed`
- 状态：eligible=true、disabled=false
- 位置：`~/.openclaw/skills/paperbot/`
- 文件：`SKILL.md`、`run.sh`、凭据文件和历史备份

当前调用流程：

1. 接收微信公众号链接或论文题目。
2. 调用 PaperBot `/api/auth/login` 登录。
3. 调用 `/api/add` 提交任务。
4. 每 5 秒查询 `/api/queue`，最长约 6 分钟。
5. 调用 `/api/list` 获取用户全部文献。
6. 按规范化链接或题目匹配本次结果。
7. 输出标题、中文标题、期刊、日期、作者、机构、PMID、DOI、关键词和各分析模块。

因此，初版已经实现：

`微信/飞书消息 → OpenClaw → PaperBot → 数据库 → 返回结构化结果`

## 4. 当前主要问题

### 4.1 Skill 触发存在重叠

服务器还存在 `wechat-article-extraction` Skill，它用于抓取微信公众号正文并总结。

两个 Skill 都可能匹配 `mp.weixin.qq.com` 链接：

- `paperbot`：科研论文推文、文献入库、结构化分析
- `wechat-article-extraction`：普通微信公众号文章正文提取与总结

需要把两者的 `description` 边界写清楚，否则模型可能选择错误的 Skill。

### 4.2 仍然会消耗 OpenClaw 模型 Token

当前 Skill 依赖模型完成：

- 判断是否使用 PaperBot
- 组织执行命令
- 接收脚本输出
- 整理并回复用户

PaperBot 已承担真正的文献解析，但 OpenClaw 仍会读取完整分析结果。它能减少重复分析，却不能做到零 Token。

### 4.3 轮询粒度较粗

`POST /api/add` 当前只返回 `{ok:true}`，虽然底层 `enqueue()` 会生成任务信息，但路由没有返回任务 ID。

Skill 因此只能：

- 查询当前用户全部运行/等待任务；
- 等全部任务结束；
- 再下载全部文献列表寻找目标。

并发提交时容易等待无关任务，也会产生不必要的数据和上下文。

### 4.4 凭据方式需要加固

现有 Skill 通过本地凭据文件读取 PaperBot 用户名和密码，再换取 Session Cookie。

建议后续改为：

- 仅限 `127.0.0.1` 的专用集成 Token；或
- 单独的 PaperBot 服务账户和最小权限 Token。

不要把密码或 Token 写进 `SKILL.md`、日志或 Git 仓库。

### 4.5 脚本健壮性不足

当前脚本需要补充：

- `curl --fail-with-body`
- 连接超时和总超时
- HTTP 状态校验
- JSON 格式错误处理
- 任务级轮询
- 明确的失败/超时退出码
- 输出长度控制

### 4.6 输入类型有限

PaperBot 的 `normalizeSource()` 当前接受：

- `title:论文题目`
- 长度合规的普通题目
- `https://mp.weixin.qq.com/...`

当前没有直接接受 DOI、PubMed URL 或普通期刊页面 URL。现有需求可以满足，后续可扩展。

## 5. 推荐的目标流程

```text
用户发送公众号论文链接或论文题目
              │
              ▼
OpenClaw 判断为科研文献任务
              │
              ▼
调用 paperbot Skill（只传原始链接/题目）
              │
              ▼
PaperBot 返回 jobId
              │
              ▼
Skill 仅轮询该 jobId
              │
              ▼
PaperBot 返回单篇结构化结果和网页地址
              │
              ▼
OpenClaw 按“简洁/完整”模式返回
```

## 6. 分步施工方案

### 第一步：备份和基线测试

- 备份 `~/.openclaw/skills/paperbot/`。
- 备份 `/opt/paper-bot/server.js` 和数据库。
- 记录现有 Skill 的链接、题目、失败、重复提交四类结果。
- 不修改微信和飞书插件。

### 第二步：整理 Skill 元数据

保留 Skill 名称 `paperbot`，明确触发边界：

- 科研论文微信公众号推文 → PaperBot
- 用户明确要求解析、入库、查看文献分析 → PaperBot
- 纯普通公众号正文提取 → `wechat-article-extraction`
- 普通聊天或科研问答 → 不调用 PaperBot

补充依赖声明：`bash`、`curl`、`node`。

### 第三步：最小增强 PaperBot API

建议增强现有接口，不另起框架：

1. `POST /api/add` 返回新建或复用的 `jobId`、规范化输入和当前状态。
2. 增加 `GET /api/job/:id`，只能读取当前用户自己的任务。
3. 增加按任务或规范化来源读取单篇结果的接口。
4. 保持现有网页 API 完全兼容，不影响网页用户。

### 第四步：加固 `run.sh`

- 严格限定只接受一个链接或题目参数。
- 所有参数以 JSON 安全编码，不拼接为 shell 命令。
- 使用任务 ID 轮询，不等待其他用户或其他任务。
- 默认只输出：处理状态、标题、简短摘要、网页地址。
- 用户明确要求“完整解析”时，再输出所有分析模块。
- 对登录失败、提交失败、处理失败和超时分别返回清晰错误。

### 第五步：测试

至少测试：

- 新的微信公众号论文链接
- 已解析过的重复链接
- 直接输入完整论文题目
- 无法识别的普通公众号链接
- PaperBot 服务暂时不可用
- DeepSeek 解析失败
- 两人同时提交任务
- 微信和飞书分别调用

### 第六步：观察

- 观察 3 至 7 天。
- 对比 OpenClaw Token、PaperBot DeepSeek 用量、成功率和平均耗时。
- 确认没有渠道异常后，再决定是否继续做 Router。

## 7. 后续低 Token 方案

Skill 加固后可以进一步开发一个受限的 `paperbot.submit` 工具，并将 `/paperbot` 直达该工具。

这样显式命令可以绕过模型选择步骤；自然语言或单独粘贴链接仍可由 DeepSeek Flash 判断。不要把通用 `exec` 直接暴露为直达工具，否则会产生命令注入风险。

## 8. 暂不执行

当前不做：

- Viking Router
- Ollama/Qwen 本地模型
- OpenClaw 重装或升级
- Docker 化
- OpenViking
- 大规模数据库迁移

先把现有 PaperBot Skill 做稳，再进行下一阶段。
