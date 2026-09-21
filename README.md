# myAgent

一个学习导向的 TypeScript Agent，最终目标是形成可以检索、阅读和综合学术论文的个人学术助手。当前先用尽量少的代码理解完整数据流：

```text
用户输入 → 模型 → 工具调用 → 工具结果 → 模型 → 最终回答
```

项目已经支持 Agent Loop、多轮会话、本地会话持久化、受预算控制的模型上下文、工具调用、免费公共网页搜索与网页正文读取、本地 Chroma RAG、命令人工审批，以及一个简单的浏览器聊天界面。

## 学习原则

- 快速理解并亲手实现 Agent 的核心能力。
- 每次只增加一个容易观察和验证的概念。
- 不为尚未出现的需求提前设计复杂架构。
- 保留必要的本地安全边界，但不把当前实现描述成安全沙箱。
- 每个函数包含一条简短的中文职责注释。
- 每次功能实现完成后提供一组可直接运行的测试 Prompt，并说明预期观察点。

## 学术论文助手目标

当前建设顺序是“先掌握通用 Agent 基础，再组合学术能力”。已经完成的基础包括 Tool Call、Agent Loop、Web Search、网页正文读取、Session、Context Management 和本地 RAG。

接下来的学术能力按小步实现：

1. `read_pdf`：读取本地或已下载论文 PDF，并保留页码来源。
2. 学术元数据检索：接入免费来源，例如 OpenAlex、Crossref 或 arXiv，而不是只依赖通用网页搜索。
3. 单篇论文结构化阅读：提取题目、作者、问题、方法、实验、结论和局限。
4. 论文入库：把论文正文和元数据加入 Literature Corpus，支持可追溯的 RAG。
5. 多论文比较：围绕同一问题整理证据、分歧、研究空白和引用。

滚动摘要、长期 Memory 和更复杂的上下文优化暂缓，等真实论文任务证明有需要再继续。

## 安装与配置

需要 Node.js 22+。安装依赖，复制示例配置并填写 DeepSeek API Key：

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

项目启动时，`src/config.ts` 会自动读取根目录下的 `.env`，应用默认值和校验，然后导出唯一的 `config` 对象供其他模块直接使用。PowerShell 或 VS Code 已设置的进程环境变量优先于 `.env`。独立的知识库索引和 Chroma Server 不调用模型，因此不要求 DeepSeek API Key；CLI 与 Web 启动时会检查 Key。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 无，必须设置 | DeepSeek API Key，不会写入日志 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Agent 使用的模型 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 兼容接口地址 |
| `DEEPSEEK_REASONING_EFFORT` | `high` | 只允许 `low`、`high`、`max` |
| `AGENT_MAX_STEPS` | `12` | 单轮最大工具步骤数，必须为正整数 |
| `AGENT_CONTEXT_MAX_CHARS` | `30000` | Model Context 字符预算 |
| `AGENT_OLD_TOOL_OUTPUT_MAX_CHARS` | `1500` | 旧工具输出保留字符数 |
| `AGENT_TOOL_OUTPUT_MAX_CHARS` | `12000` | 单次工具结果字符预算 |
| `AGENT_WEB_PORT` | `3000` | Web 服务端口，范围 `1–65535` |
| `AGENT_WEB_SEARCH_ENABLED` | `true` | 联网工具的默认开关，只允许 `true` 或 `false` |
| `CHROMA_HOST` | `127.0.0.1` | Chroma Server 地址 |
| `CHROMA_PORT` | `8000` | Chroma Server 端口，范围 `1–65535` |
| `CHROMA_MODEL_PATH` | `%USERPROFILE%\.cache\chroma\onnx_models\all-MiniLM-L6-v2\onnx` | 本地 Embedding 模型目录 |
| `CHROMA_DATA_PATH` | `.myagent\chroma` | Chroma 数据目录 |
| `CHROMA_COLLECTION` | `myagent_knowledge` | Chroma collection 名称 |
| `KNOWLEDGE_PATH` | `knowledge` | 本地知识文档目录 |

也可以用 PowerShell 临时覆盖 `.env`：

```powershell
$env:DEEPSEEK_MODEL = "deepseek-flash"
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"
$env:DEEPSEEK_REASONING_EFFORT = "high"
$env:AGENT_MAX_STEPS = "12"
$env:AGENT_WEB_PORT = "3000"
$env:AGENT_WEB_SEARCH_ENABLED = "true"
$env:AGENT_CONTEXT_MAX_CHARS = "30000"
$env:AGENT_OLD_TOOL_OUTPUT_MAX_CHARS = "1500"
$env:AGENT_TOOL_OUTPUT_MAX_CHARS = "12000"
$env:CHROMA_HOST = "127.0.0.1"
$env:CHROMA_PORT = "8000"
$env:CHROMA_MODEL_PATH = "C:\Users\FaultCutter\.cache\chroma\onnx_models\all-MiniLM-L6-v2\onnx"
$env:CHROMA_DATA_PATH = ".myagent\chroma"
$env:CHROMA_COLLECTION = "myagent_knowledge"
$env:KNOWLEDGE_PATH = "knowledge"
```

代码默认使用 `deepseek-flash`，如供应商模型名称发生变化，请通过 `DEEPSEEK_MODEL` 覆盖。

## 使用终端会话

```powershell
npm run dev
```

- `/help`：显示全部会话命令。
- `/sessions`：按最近更新时间列出会话，`*` 表示当前会话。
- `/new`：创建并切换到一个新会话，旧会话仍会保留。
- `/use <序号或ID>`：按列表序号、完整 ID 或唯一 ID 前缀切换会话。
- `/delete <序号或ID>`：删除会话；删除当前会话后自动切换，删除最后一个会话后自动创建空会话。
- `/exit`：退出程序。

其他输入都会作为任务交给 Agent 处理。以 `/` 开头但不属于上述命令的输入只会提示“未知命令”，不会发送给模型，因此写错命令不会消耗一次模型调用。

也可以执行一次任务后退出：

```powershell
npm run dev -- "读取 README.md，然后总结这个项目"
```

## 使用图形化会话

```powershell
npm run web
```

然后打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Web UI 支持：

- 多轮聊天和历史恢复。
- 创建新会话，并从下拉列表切换已有会话。
- 删除当前会话；删除前要求确认，删除后自动加载后继会话。
- 固定标题栏和输入区，只有中间消息区滚动。
- 安全显示标题、列表、代码块、行内代码和加粗，不执行模型返回的 HTML。
- 实时查看“思考、调用工具、生成回答”等阶段，并按步骤查看工具调用。
- 使用 `Enter` 发送、`Shift + Enter` 换行，输入框随内容自动增高。
- Agent 运行时可继续编辑下一条消息，但必须等待当前任务结束后才能提交。
- 每轮发送前可选择是否向 Agent 开放联网搜索，默认关闭。
- 在标题栏查看消息数、上下文项数、序列化体积，以及本轮真实 Token 用量。
- 在页面中允许或拒绝终端命令。

运行状态通过浏览器轮询 `/api/status` 获得。“上下文体积”是历史 JSON 的字节数；“本轮 Token”来自模型响应的 `usage`，两者不能互相替代。第一版没有逐字流式输出。

Web 服务只监听本机地址。CLI 和 Web UI 共用 `.myagent/sessions/` 中的会话文件，不要同时操作同一会话。

## Agent 工具

- `list_files(path)`：递归列出文件。
- `search_files(path, query)`：按普通文本搜索文件内容。
- `grep_files(path, pattern)`：按正则表达式搜索文件内容。
- `knowledge_search(query, top_k)`：从本地 Chroma 知识库语义检索相关片段。
- `web_search(query)`：通过公开 RSS 入口搜索实时网页结果。
- `fetch_web_page(url, find?)`：读取搜索结果中的 HTML 或纯文本网页正文；可用 `find` 定位长网页中的相关段落。
- `read_file(path)`：读取 UTF-8 文件。
- `write_file(path, content)`：写入 UTF-8 文件。
- `run_command(command, reason)`：请求执行 PowerShell 命令。

模型应优先使用文件专用工具，只有专用工具无法完成任务时才使用 `run_command`。

所有成功的工具结果在进入 Agent Loop 前共用一个输出预算，默认最多 `12000` 字符。超过预算时保留首尾并插入明确的裁剪标记；该限制同样适用于 `read_file`、搜索、RAG、联网结果和命令输出。可通过 `AGENT_TOOL_OUTPUT_MAX_CHARS` 调整。这里裁剪的是工具实际交给模型和写入 Session 的结果，因此中间省略部分不会在后续上下文中恢复；模型应改用更聚焦的搜索或工具调用。

### 联网搜索

`web_search` 使用 Bing 的公开 RSS 搜索结果，不需要搜索 API Key、付费计划或额外 npm 依赖。每次调用只进行一次网络请求，最多返回五条标题、URL 和摘要。模型可以继续调用 `fetch_web_page` 读取其中相关页面的正文，形成“搜索 → 选择来源 → 阅读正文 → 回答”的工具链。

`fetch_web_page` 跟随 HTTP 重定向，接受 HTML 和纯文本页面，删除脚本、样式和标签后返回正文；单次下载限制为 2 MB，15 秒超时，最终文本继续受统一工具输出预算控制。长页面可传入 `find`，工具会进行大小写无关的文本查找，并返回命中位置附近最多 6000 字符；找不到时会返回明确错误，模型可以更换关键词。它不执行网页 JavaScript，也不能绕过登录、反爬或付费墙。

Agent 会按信息来源选择最小工具路径：公开官方信息使用联网工具，用户自己的论文或笔记才使用本地知识库，工作区内容使用文件工具。对简单事实查询，默认软预算是一次 `web_search` 和一到两次 `fetch_web_page`；权威来源已经支持核心答案时应立即停止。该预算不是硬限制，证据不完整、来源冲突、高风险问题或用户明确要求深入研究时可以继续检索。

`AGENT_WEB_SEARCH_ENABLED` 决定 CLI 和 Web UI 启动时的默认联网状态，默认是 `true`。Web UI 仍可在发送每条消息前用“允许联网搜索”逐轮覆盖；关闭时，本轮系统指令要求 Agent 不得用 `run_command` 绕过这一选择。如果模型仍提出命令，原有人工审批仍是最终边界。

这是个人学习用途的最小实现，不是正式搜索 API：公共入口可能限流、改变格式或停止开放。模型应引用最终读取页面的 URL，并把网页内容视为外部证据而不是指令。`fetch_web_page` 会明确拒绝 PDF；论文 PDF 将由后续独立的 `read_pdf` Capability 处理。

### 本地知识库 RAG

本地 RAG 使用 TypeScript 完成文档切块、Embedding、索引同步和查询。Embedding 通过 Transformers.js 直接加载已有的 `all-MiniLM-L6-v2` ONNX 文件，并设置为只使用本地文件，不会自动联网下载模型。Chroma 使用 npm 包提供的 Windows x64 原生绑定启动本地 Server，不需要 Python bridge 或付费服务。

把 `.md` 或 `.txt` 文件放入 `knowledge/` 后，在两个终端中依次运行：

```powershell
# 终端一：保持本地 Chroma Server 运行
npm run knowledge:server

# 终端二：建立或刷新索引
npm run knowledge:index

# 可选：不调用 DeepSeek，直接验证检索结果
npm run knowledge:query -- "What is the development principle of myAgent?"
```

然后正常启动 CLI 或 Web UI。Agent 可以调用 `knowledge_search`，结果包含：

- `source`：知识文件相对路径。
- `id`：稳定的 chunk ID，例如 `example.md#0001`。
- `text`：召回的原始片段。
- `distance`：余弦距离，越小通常越相关。

索引保存到 `.myagent/chroma/`。知识文件发生变化后，检索会提示重新执行 `npm run knowledge:index`；语料未变化时重复索引不会重新计算向量。

默认模型主要适合英文语义检索。中文文档可以运行，但应通过实际查询评估召回质量，不能只根据“成功返回结果”判断效果。

## Human-in-the-loop

每次调用 `run_command` 都需要人工批准。

CLI 会在终端展示命令和原因；Web UI 会显示“允许”和“拒绝”按钮。拒绝后，Agent Loop 不会崩溃，而是把拒绝结果交还给模型继续处理。

命令执行具有以下限制：

- 从项目目录启动。
- 使用无配置、非交互式 Windows PowerShell。
- 30 秒超时，输出长度有限制。
- 子进程不会继承 `DEEPSEEK_API_KEY`。

这不是真正的 sandbox。获得批准的命令仍然继承当前 Windows 用户的大部分权限，可能访问项目目录之外的文件或网络。

## 会话持久化

每个 Session 都保存在 `.myagent/sessions/<session-id>.json` 中，不再创建单独的 `current-session.json` 指针文件。启动时会直接恢复最近使用的已有 Session；只有目录中没有任何 Session 时才创建空会话。选择会话会刷新它的使用时间，所以下次启动仍会恢复上次选择的会话。旧版本遗留的 `current-session.json` 会被忽略，可以安全删除。

创建新会话时会立即写入空会话文件；追加用户消息、模型输出或工具结果后也会立即覆盖保存当前会话，因此模型调用中途失败时，已经发生的历史事件仍可恢复。

再次启动 CLI 或 Web UI 时会自动恢复当前会话。两个界面都支持创建、选择和删除会话。删除当前会话后会选择最近更新的剩余会话；如果没有剩余会话，则立即创建一个新的空会话。首次升级时，如果发现旧版 `.myagent/session.json`，会将其中历史导入为一个新格式会话，旧文件不会被删除。

这里保存的是 Session，即一次对话的历史，不是长期 Memory。文件中可能包含用户输入、模型回答和工具结果，并已通过 `.gitignore` 排除。

Session History 与 Model Context 已经分离：磁盘仍保存完整事件序列；每次请求模型时，Agent 都从完整历史重新构建一个独立、受预算限制的输入副本。上下文处理不会删除或改写 Session 文件。

构建顺序固定为：

```text
完整 Session History
    ↓ 复制
压缩已被助手消费的旧长工具输出（默认保留原文首尾共 1500 字符）
    ↓
若仍超过 30000 字符，按完整轮次从最旧处移除
    ↓
当前运行中的用户消息、工具调用和“预算处理后的工具结果”始终保留
    ↓
Model Context → 模型
```

这里的 30000 是 JSON 序列化后的字符预算，不是 Token 上限。可分别通过 `AGENT_CONTEXT_MAX_CHARS` 和 `AGENT_OLD_TOOL_OUTPUT_MAX_CHARS` 调整。滑动窗口以用户消息为轮次边界，不会单独丢掉某个工具调用或结果。如果当前运行本身已经超过预算，Agent 会保留当前运行并报告超预算，而不是破坏正在进行的工具链。

Agent 会累计本轮每次模型响应返回的输入、输出和总 Token。一次需要多个工具步骤的运行会多次调用模型，也会多次重发逐渐增长的历史，所以“本轮输入 Token”是各次调用输入量之和，不等于最后一次请求的上下文长度。CLI 内部仍逐次接收统计，但不会在每次工具步骤后打印；一次用户任务结束时只输出一组 `[本轮统计]`。统计只保留在当前进程的最近一轮运行状态中，不写入 Session；如果 API 没有返回 `usage`，界面会明确显示不可用。

这两个概念现在各自承担不同职责：

- **Session History**：用于持久化和恢复的完整会话记录。
- **Model Context**：从 Session 中选出、压缩后真正发送给模型的有限上下文。

上下文压缩只缩小 Model Context，不会直接删除完整 Session。CLI 在任务结束时把最终上下文快照和累计 Token 合并进 `[本轮统计]`；Web 后端的 `/api/status` 和 `/api/chat` 仍会持续返回最近一次 `modelContext` 统计，但本阶段不再改动前端设计。

CLI 使用终端原生 ANSI 样式区分信息：用户输入为青色，Agent 最终回答为绿色，工具调用为黄色，系统提示为灰色，错误为红色，统计为紫色。设置标准环境变量 `NO_COLOR`，或把输出重定向到文件时，会自动退回无颜色纯文本。

## 下一阶段学习路线

接下来继续保持“小步实现、每步可观察”的方式推进。

### 已完成：Web UI 易用性

- 已完成固定高度布局、安全的常用 Markdown、工具步骤、输入快捷键和自动增高。
- 已完成运行阶段轮询，以及消息数、上下文项数、上下文体积和本轮 Token 用量显示。

当前仍使用原生 HTML、CSS 和 JavaScript，不引入前端框架，也暂不实现逐字 Streaming。

### 1. 上下文管理

按以下顺序学习和实现：

1. **已完成基础可观测性**：显示历史项数量、序列化体积和模型实际返回的 token usage。
2. **已完成 Session/Model 分离**：Session 永久保存完整历史，Model Context 每次按需派生。
3. **已完成确定性裁剪**：只压缩已被旧轮次助手答复消费的长工具输出。
4. **已完成滑动窗口**：超过字符预算时移除最旧的完整轮次，不拆散工具调用和结果。
5. **已完成当前工具输出预算**：所有工具结果进入 Agent Loop 前统一限制长度，避免单次大结果撑爆当前轮。
6. **暂缓滚动摘要与相关历史检索**：当前能力已足够作为学术助手的基础，后续出现真实长会话需求时再继续。

预期的数据流为：

```text
完整 Session
    ↓
上下文选择与压缩
    ↓
会话摘要 + 最近对话 + 当前任务 + 当前工具结果
    ↓
发送给模型
```

### 2. RAG 后续练习

RAG 将同时支持本地知识库和联网搜索：

```text
用户问题
   ↓
选择 local / web / all
   ├── 本地知识库检索
   └── 联网搜索
   ↓
统一的检索片段和来源
   ↓
纳入上下文预算
   ↓
模型生成带引用的回答
```

第一版已经完成：本地 `.md`/`.txt` 文档使用 Chroma 和本地 `all-MiniLM-L6-v2` 向量检索，联网部分复用现有 `web_search`。后续练习重点是检索质量评估、中文模型对比、关键词与向量混合检索，以及把检索片段纳入 Model Context 预算。

RAG 返回的内容不会无限追加到上下文；它与会话摘要、最近对话和工具输出共同受 Model Context 预算控制。

## 项目结构

```text
myAgent/
├── knowledge/            本地知识库中的 Markdown 和纯文本文件
├── src/                  正式 TypeScript 源码
│   ├── agent.ts          Agent Loop
│   ├── chroma-server.ts  使用官方 Windows x64 绑定启动 Chroma
│   ├── cli.ts            终端交互入口
│   ├── config.ts         自动加载 .env 并导出统一配置
│   ├── context.ts        Model Context 构建、旧输出裁剪与滑动窗口
│   ├── knowledge-cli.ts  知识库索引与手动查询入口
│   ├── knowledge.ts      文档切块、本地 Embedding 与 Chroma 检索
│   ├── session.ts        多会话创建、选择、删除、加载与保存
│   ├── token-usage.ts    模型 usage 归一化与本轮累计
│   ├── tools.ts          工具定义与执行
│   ├── web-page.ts       HTML/纯文本网页下载与正文提取
│   ├── web-search.ts     免费公共网页搜索与 RSS 解析
│   └── web.ts            本地 Web 服务
├── tests/                不调用模型 API 的确定性测试
│   ├── config.test.ts
│   ├── knowledge.test.ts
│   ├── context.test.ts
│   ├── session.test.ts
│   ├── token-usage.test.ts
│   ├── tools.test.ts
│   └── web-search.test.ts
├── web/
│   └── index.html        图形化聊天页面
├── package.json          项目依赖与 npm 命令
├── package-lock.json     npm 自动生成的精确依赖版本
├── tsconfig.json         TypeScript 配置
├── CONTEXT.md            项目定位和领域词汇
├── DEVELOPMENT_LOG.md    集中的开发与调试日志
└── README.md
```

项目根目录只有一个 `package.json`。`package-lock.json` 不是第二份项目配置；`node_modules` 中的其他 `package.json` 属于安装的依赖。

## 检查与测试

```powershell
npm run check
npm run test:config
npm run test:knowledge
npm run test:tools
npm run test:session
npm run test:usage
npm run test:context
npm run test:web-search
```

这些命令都不请求模型 API。配置测试会在临时目录验证 `.env` 自动加载、默认值、覆盖和非法值；知识库测试只验证切块和哈希，不启动 Chroma 或加载 ONNX；工具测试会运行本地 PowerShell 命令，但不会调用 DeepSeek；Token 测试使用固定 usage 数据；上下文测试使用固定历史验证分离、裁剪和滑动窗口；联网搜索测试只解析固定 RSS 样本，不会访问外网。

## TypeScript 编译产物

源码使用 TypeScript，普通 Node.js 最终执行的是编译后的 JavaScript。`npm run web` 和测试命令会把临时 JavaScript 生成到 `.build/`。

`.build/` 不是源码，已加入 `.gitignore`，可以随时删除；下一次运行相关命令时会自动重新生成。原来的 `dist/` 已不再使用。

## 当前边界

- 文件工具只能访问启动目录以内的路径。
- 命令审批不是 sandbox。
- 会话命令只在多轮终端模式生效；单次任务模式（`npm run dev -- "..."`）没有交互命令。
- 每次历史变化都会覆盖写入当前会话的整份 JSON；除旧版单文件导入外，没有通用版本迁移。
- Model Context 使用字符预算而不是模型 tokenizer 的精确输入 Token 预算；真实 Token 只能在响应返回后从 usage 观察。
- 工具输出预算会真实丢弃中间部分；当前工具还没有统一的分页或分段读取 interface，模型需要改用更聚焦的搜索调用。
- 滑动窗口丢弃的旧轮次尚未生成滚动摘要；需要旧细节时，模型只能重新读取文件/知识库，或等待后续摘要与历史检索能力。
- Web UI 同一时间只处理一个任务；状态和工具进度使用轮询，没有逐字 Streaming。
- Web UI 只实现常用 Markdown 子集，没有消息编辑、文件上传和完整 Markdown 扩展。
- Token usage 只保留当前进程中的最近一轮，不持久化，也还没有形成历史趋势图或预算告警。
- 联网开关只控制工具是否可用，不改善 Bing RSS 的搜索排序；技术文档查询可能返回低相关或非官方结果。
- 网页正文读取不执行 JavaScript，不能读取登录/付费墙内容，也暂不支持 PDF。
- 本地 RAG 需要单独保持 Chroma Server 运行，并在知识文件变化后显式刷新索引。
- 当前 RAG 没有关键词混合检索、重排、距离阈值或检索质量评测集。
- 暂无论文 PDF 解析、学术元数据专用检索、长期 Memory、滚动摘要、相关历史检索、patch 工具和 API 自动重试。

这些边界是后续学习路线，不需要一次全部实现。
