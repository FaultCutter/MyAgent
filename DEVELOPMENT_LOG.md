# 开发与调试日志

本文件集中记录项目的开发过程、问题诊断、修复内容和验证结果。后续开发继续按时间倒序追加到本文件，不为单次开发任务另建日志文件。

## 记录约定

- 记录日期、目标、现象、诊断假设、根因、代码变更和验证命令。
- 调试输出只保留能够证明问题或修复结果的内容。
- 不记录 API Key、认证信息、完整环境变量值或真实会话内容。
- 临时调试代码必须在任务结束前移除，并在日志中说明清理结果。
- 尚未验证的推测必须标注为“未验证”，不能作为已确认结论。

---

## 2026-09-22：工具路由与停止策略

### 开发目标

- 让 Agent 在用户只描述目标时，也能选择与信息来源匹配的最小工具路径。
- 简单问题获得足够的一手证据后停止，避免自动扩展到无关知识库、源码分析或多余比较。

### 决策流

```text
保持用户范围
      ↓
识别信息来源
      ↓
选择最小工具路径
      ↓
每次结果后检查证据是否充分
      ↓
充分则停止，不充分才继续
```

### 实现变更

- 系统指令增加范围保持、信息源路由、证据充分性和停止规则。
- 变更与验证报告只用于工作区修改任务，普通信息问答直接回答。
- 简单事实查询采用“一次搜索、一到两次网页读取”的软预算，不改 Agent Loop，也不设置硬上限。
- 本地知识库只用于用户明确要求的本地论文、笔记或任务明确依赖的个人资料。
- `run_command` 明确不得替代联网、知识库和文件工具。
- 收紧 `knowledge_search`、`web_search`、`fetch_web_page` 和 `run_command` 的工具描述。
- 工具测试验证模型可见的路由说明，防止后续修改意外移除关键约束。

### 验证

```text
npm run check             PASS
npm run test:tools        PASS
npm run test:web-search   PASS
npm run test:session      PASS
```

---

## 2026-09-21：长网页关键词定位

### 开发目标

- 让 Agent 在官方文档等长页面中直接读取目标段落，减少因统一输出预算裁剪而改用 `run_command` 的情况。

### 数据流

```text
URL + 可选 find
      ↓
下载并清洗网页正文
      ↓
大小写无关定位关键词
      ↓
返回命中位置附近正文
      ↓
统一工具输出预算
```

### 实现变更

- `fetch_web_page` 新增可选 `find` 参数；不传参数时保持原行为。
- 命中后最多返回附近 6000 字符，并标记前后省略内容。
- 未命中或传入空关键词时返回明确工具错误，便于模型调整关键词。
- Agent 指令要求长页面优先使用 `find`，不再用 `run_command` 二次抓取。
- 固定 HTML 测试覆盖成功定位和未命中，不访问真实网络。

### 验证

```text
npm run check             PASS
npm run test:web-search   PASS
npm run test:tools        PASS
```

---

## 2026-09-21：统一联网工具默认开关

### 实现变更

- 新增 `AGENT_WEB_SEARCH_ENABLED`，默认 `true`，并严格限制为 `true/false`。
- CLI 与 Agent Loop 在调用方未覆盖时统一读取该配置。
- Web UI 启动时使用统一默认值初始化复选框，同时保留每轮手动开关能力。
- 工具数量限制、网页下载大小与超时等内部保护边界继续留在对应模块，不作为普通运行配置暴露。

### 验证

```text
npm run check             PASS
npm run test:config       PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：配置简化为 `.env → config`

### 调整原因

上一版虽然集中了解析和校验，但 CLI/Web 仍调用加载函数并把配置字段重新映射到 `AgentOptions`，对当前学习项目显得过重。本轮按更直接的心智模型收敛 interface。

### 最终数据流

```text
.env / process.env
        ↓
config.ts 启动时读取、应用默认值并校验
        ↓
导出的唯一 config 对象
        ↓
Agent / CLI / Web / Knowledge / Chroma
```

### 实现变更

- 使用 Node.js 内置 `.env` 加载能力；项目根目录存在 `.env` 时自动读取，不新增依赖，已有进程环境变量保持优先。
- `config.ts` 直接导出 `config`；生产模块不再调用 `loadConfig()` 或 `loadKnowledgeConfig()`。
- DeepSeek API Key 在通用配置中允许缺省，使知识库命令可以独立运行；CLI/Web/Agent 在真正需要模型时调用 `requireDeepSeekApiKey()`。
- Agent 直接读取 `config`，`AgentOptions` 只保留运行回调和本轮能力开关，不再复制模型、步数和预算字段。
- `createConfig(env)` 只作为纯配置构造 interface 保留，供确定性测试和 Agent 故障测试注入使用。
- 配置测试新增临时 `.env` 子进程验证，证明自动加载确实生效且不依赖开发机当前环境。

### 验证

```text
npm run check             PASS
npm run test:config       PASS
npm run test:session      PASS
npm run test:tools        PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:usage        PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：统一配置管理

### 开发目标

- 把模型、Agent、Web、Chroma 和知识库的重要运行参数集中到一个 module。
- CLI 与 Web 共享同一套环境变量读取、默认值和校验，不再重复解析。
- 保持 Agent Loop 和工具行为不变，并让独立知识库命令继续不依赖 DeepSeek API Key。

### 检查结果

- `cli.ts` 与 `web.ts` 重复解析模型、reasoning effort、步数和字符预算。
- `agent.ts` 直接读取 API Key 与 Base URL，配置依赖没有体现在 `AgentOptions` 中。
- `context.ts` 与 `tools.ts` 分别保存上下文和工具输出默认值。
- `knowledge.ts` 与 `chroma-server.ts` 重复读取 Chroma 配置，端口校验规则不一致。
- README 与 `.env.example` 仍记录旧的 `80000/4000`，而代码实际默认值已经是 `30000/1500`。

### 实现变更

- 新增 `src/config.ts`，定义 `AppConfig`、`KnowledgeConfig`、分组配置类型、全部默认值以及统一读取函数。
- `loadConfig()` 要求非空 `DEEPSEEK_API_KEY`，但从不打印它；`loadKnowledgeConfig()` 供不调用模型的 Chroma/知识库命令复用。
- 正整数使用严格十进制格式并检查安全整数；Web/Chroma 端口额外限制为 `1–65535`；reasoning effort 只接受 `low/high/max`。
- CLI 和 Web 都从 `loadConfig()` 映射 `AgentOptions`；API Key 与 Base URL 现在显式传入 Agent，`agent.ts` 不再读取环境变量。
- Context、Tools、Knowledge 与 Chroma Server 改为使用统一默认值或配置读取入口；工具内部数量和下载安全上限保持原位。
- 新增 `tests/config.test.ts`，覆盖默认配置、完整覆盖、非法整数、非法 reasoning effort、非法 Web/Chroma 端口、缺少 API Key，以及知识库配置无需 API Key。
- README 增加完整配置表和 PowerShell 示例，并修正上下文默认值；`.env.example` 同步更新。

### 配置数据流

```text
process.env
    ↓
config.ts：默认值 + 类型转换 + 校验
    ├── CLI / Web → AgentOptions → Agent Loop
    └── Knowledge / Chroma Server
```

### 验证

```text
npm run check             PASS
npm run test:config       PASS
npm run test:session      PASS
npm run test:tools        PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:usage        PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：网页正文读取与学术论文助手定位

### 开发目标

- 在现有 `web_search` 之后增加网页正文读取，形成可观察的多工具调用链。
- 保持免费、无新增依赖，并复用联网开关和统一工具输出预算。
- 明确项目最终方向为 Academic Research Assistant，同时继续用小功能学习通用 Agent 基础。

### 实现变更

- 新增 `src/web-page.ts`，提供 `fetchWebPage()`：只接受 HTTP/HTTPS，跟随重定向，15 秒超时，单页下载上限 2 MB。
- HTML 提取会删除注释、脚本、样式等不可见内容，把常见块级标签转换为段落，并解码常见实体；纯文本直接整理空白。
- 新增 `fetch_web_page(url)` 工具，并在系统指令中明确“先搜索，再读取相关 HTML 页面，最后引用来源 URL”。
- Web 联网开关现在同时控制 `web_search` 和 `fetch_web_page`；关闭时两个工具都不会交给模型。
- 网页正文进入 Agent Loop 前继续经过统一工具输出预算。
- PDF content type 会返回明确错误，后续由独立的论文 PDF 阅读能力处理。
- `tests/web-search.test.ts` 使用固定 RSS、HTML 和 PDF 响应验证注册、开关、正文清理、实体解码与 PDF 边界，不访问真实网络。
- `CONTEXT.md` 收敛为领域词汇表，确定 Academic Research Assistant、Paper、Evidence、Citation、Literature Corpus 等统一语言；实现状态和路线保留在 README 与开发日志。

### 验证

```text
npm run check             PASS
npm run test:web-search   PASS
npm run test:tools        PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:session      PASS
npm run test:usage        PASS
```

未执行真实联网冒烟测试，因此当前验证能证明工具分发和解析逻辑，不能证明任意外部网站在当前网络环境中一定可访问。

---

## 2026-09-21：统一工具输出预算

### 开发目标

- 防止当前运行中的单次大文件、检索结果或命令输出直接放大后续模型请求。
- 把已有的分散截断规则收口到一个可配置 seam，不继续扩展更复杂的上下文系统。
- 完成这一步后暂缓滚动摘要等上下文优化，转向新的 Agent 功能练习。

### 实现变更

- `executeTool()` 成为统一输出预算 seam：所有成功工具调用先完成原始执行，再在结果进入 Agent Loop 前应用同一规则。
- 默认预算为 12000 字符，可通过 `AGENT_TOOL_OUTPUT_MAX_CHARS` 调整；CLI 与 Web 使用相同配置。
- 超出预算时保留约四分之三的头部和四分之一的尾部，在中间加入原始长度及重试提示，并保证最终字符串本身不超过预算。
- 移除 `read_file`、文件搜索和命令输出中分散的字符截断；结果数、命令超时和子进程缓冲区限制保持不变。
- `web_search` 与 `knowledge_search` 现在也自动受到同一输出预算约束。
- `tests/tools.test.ts` 通过公开的 `executeTool()` interface 验证严格长度、首部保留、裁剪标记和非法预算。

### 数据边界

与旧工具输出的 Model Context 压缩不同，这次裁剪发生在结果进入 Agent Loop 之前。因此 Session 保存的也是裁剪后结果，省略部分不会自动恢复。模型需要通过更聚焦的搜索再次获取信息；工具分页和文件分段读取暂未实现。

### 验证

```text
npm run check             PASS
npm run test:tools        PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:session      PASS
npm run test:usage        PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：CLI 本轮统计与彩色输出

### 开发目标

- 保留每次模型响应的内部 usage/context 更新，但避免一次 Agent Loop 中重复刷出累计统计。
- 让用户输入、Agent 最终回答、工具调用、系统消息、错误和统计在终端中容易区分。

### 实现变更

- `src/cli.ts` 新增每任务独立的 reporter：`onUsage` 与 `onContextBuilt` 只缓存最新累计快照，任务正常结束或失败后统一打印一次 `[本轮统计]`。
- 工具调用仍实时显示，因此用户可以观察 Agent 正在做什么；Token 和上下文不再随每次工具步骤重复输出。
- 使用原生 ANSI 转义序列实现颜色，不新增依赖；TTY 中用户输入为青色、Agent 回答为绿色、工具调用为黄色、系统消息为灰色、错误为红色、统计为紫色。
- 非 TTY 输出和设置 `NO_COLOR` 时自动使用纯文本，避免日志文件包含颜色控制符。
- CLI 单次任务模式和多轮交互模式使用相同 reporter 和颜色规则；Web 的实时 usage/context 回调保持不变。

### 验证

```text
npm run check             PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:tools        PASS
npm run test:session      PASS
npm run test:usage        PASS
npm run test:web-search   PASS
node .build/src/cli.js    PASS（TTY 中启动后输入 /exit；未调用模型）
```

---

## 2026-09-21：Session/Model 分离、确定性裁剪与滑动窗口

### 开发目标

- 完整 Session History 继续用于持久化和恢复，不因上下文预算丢失内容。
- 每次模型请求都派生独立的 Model Context，避免把压缩结果写回会话。
- 先压缩安全的旧工具输出，再用滑动窗口限制模型输入体积。
- 保留当前运行中的全部消息和工具链，即使当前运行本身已经超过预算。

### 实现变更

- 新增 `src/context.ts`，集中负责 Model Context 构建；`src/agent.ts` 只通过 `buildModelContext()` 获取可发送输入。
- 只裁剪位于当前运行之前、长度超过阈值且之后已有助手答复的字符串工具输出。默认保留原文首尾共 4000 字符，并保留原 `call_id`。
- 裁剪后若 JSON 序列化字符数仍超过默认 80000，按用户消息边界从最旧完整轮次开始移除，不拆分工具调用和工具结果。
- 当前运行不参与窗口淘汰；它单独超出预算时通过 `budgetExceeded` 暴露事实。
- CLI 每次请求前输出 Session/Model 项数、字符数、裁剪数和移除轮次数。
- Web 后端通过 `/api/status` 和 `/api/chat` 返回最近一次 `modelContext` 统计；遵循当前约定，没有继续调整前端设计。
- 新增 `AGENT_CONTEXT_MAX_CHARS` 和 `AGENT_OLD_TOOL_OUTPUT_MAX_CHARS` 两个可选环境变量。
- 新增 `tests/context.test.ts`，覆盖历史不变、旧/当前工具输出边界、未消费结果保护、完整轮次滑动和当前轮超预算。

### 当前边界

字符预算是发送前可确定计算的粗粒度限制，不等于 tokenizer 的精确 Token 数；真实 Token 仍来自响应后的 usage。被窗口移除的旧轮次尚未摘要，也没有按相关性找回。本阶段先观察确定性规则，再学习滚动摘要。

### 验证

```text
npm run check             PASS
npm run test:context      PASS
npm run test:knowledge    PASS
npm run test:tools        PASS
npm run test:session      PASS
npm run test:usage        PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：本轮 Token 用量监控

### 开发目标

- 在开始压缩上下文前，先看到 Agent 每轮实际使用了多少 Token。
- 区分历史 JSON 体积与模型 API 返回的真实 usage，避免用字符数冒充 Token。
- 正确累计一次 Agent Loop 内多次模型调用的输入、输出和总用量。

### 实现变更

- 新增 `src/token-usage.ts`，归一化 Responses 风格的 `input_tokens/output_tokens`，并兼容 `prompt_tokens/completion_tokens` 字段。
- 统计模型调用次数和实际返回 usage 的调用次数；API 缺少 usage 时显示不可用或部分可用，而不是填入估算值。
- `src/agent.ts` 在每次模型响应后累计本轮输入、输出、总计、缓存输入和推理 Token，并通过 `onUsage` 回调上报。
- `src/web.ts` 通过 `/api/status` 和 `/api/chat` 返回本轮 usage；新建、切换或删除会话时清空最近一轮统计。
- Web UI 标题区新增“本轮 Token”，轮询显示输入、输出、总计和模型调用次数；缓存与推理 Token 放在提示信息中。
- CLI 在每次模型响应后向标准错误输出本轮累计 Token。
- 新增 `tests/token-usage.test.ts`，覆盖多次调用累计、兼容字段和 usage 缺失。

实现后直接核对 DeepSeek 官方 `POST /responses` API Reference：页面包含 `input_tokens`、`output_tokens`、`total_tokens`、`cached_tokens` 和 `reasoning_tokens` 字段，与主读取路径一致；兼容字段只作为降级处理。

### 数据含义

Agent Loop 每次工具执行后都会再次请求模型，因此本轮输入 Token 是每次模型调用输入量的总和，不等于最后一次请求的上下文长度。当前统计只保留最近一轮，不写入 Session，也没有触发任何压缩策略。

### 验证

```text
npm run check             PASS
npm run test:knowledge    PASS
npm run test:tools        PASS
npm run test:session      PASS
npm run test:usage        PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：Web UI 按轮启用联网搜索

### 开发目标

- 联网能力不再默认交给 Web Agent，而是由用户在发送前为当前运行显式开启。
- 关闭联网时，模型看不到 `web_search`，且本轮指令要求它不得用 `run_command` 绕过选择；命令仍受人工审批约束。
- 保持 CLI 原有行为，避免把一次 Web UI 学习改动扩展成全局设置系统。

### 实现变更

- `web/index.html` 在输入区增加“允许联网搜索”复选框，默认不选中，并随 `/api/chat` 提交本轮设置。
- `src/web.ts` 读取 `webSearchEnabled`，记录到运行状态，并将它传入本轮 Agent 配置。
- `src/tools.ts` 新增 `enabledToolDefinitions()`，按设置过滤 `web_search` 工具定义。
- `src/agent.ts` 在关闭时使用过滤后的工具列表，并追加“不得通过其他工具访问网络”的本轮指令。
- `tests/web-search.test.ts` 覆盖联网关闭和开启两种工具列表。
- 项目约定增加：以后每次实现完成都提供一组可复制的测试 Prompt 和预期观察点。

### 搜索质量诊断

现有 Session 证明 Agent 正常调用了 `web_search`，但针对 DeepSeek 官方文档的 6 次查询持续返回无关 API 文章、仿站或 SEO 站点。使用相同查询直接调用 `searchWeb()`，断言结果包含 `api-docs.deepseek.com` 时稳定失败；官方 sitemap 则确认目标文档存在且可直接访问。因此当前问题位于 Bing RSS 的召回质量，而不是 Agent Loop 或工具分发。此次开关只控制是否允许联网，没有掩盖或声称修复搜索质量。

### 验证

```text
npm run check             PASS
npm run test:knowledge    PASS
npm run test:tools        PASS
npm run test:session      PASS
npm run test:web-search   PASS
```

---

## 2026-09-21：Web 会话界面与运行状态可视化

### 开发目标

- 长会话中始终保留标题栏、会话操作和输入区。
- 用安全的轻量 Markdown 改善回答展示，并按步骤呈现工具调用。
- 通过简单轮询展示 Agent 当前阶段、命令审批和上下文体积。
- 改善键盘输入、错误恢复、空会话引导和移动端布局。

### 实现变更

- `web/index.html` 改为 `100dvh` 三段式布局，中间消息区独立滚动，审批框和运行状态位于输入框上方。
- 使用 DOM API 支持标题、无序/有序列表、代码块、行内代码和加粗；没有使用 `innerHTML`。
- 工具日志解析为“步骤 / 工具名 / 参数”列表；回答结束后也保留可展开的本轮工具记录。
- `Enter` 发送，`Shift + Enter` 换行，输入框自动增高；运行期间输入框保持可编辑，但发送、会话切换和删除被禁用。
- 请求失败时把原消息恢复到输入框，并使用独立错误消息样式；页面加载和状态轮询失败不再静默。
- 新会话增加确认，空会话显示示例引导，窄屏下会话控件和发送区重新排版。
- `src/agent.ts` 增加 `onStatus` 回调，在思考、工具调用和继续生成时报告阶段。
- `src/web.ts` 增加 `/api/status`，统一返回运行状态、工具事件、审批请求，以及消息数、原始上下文项数和序列化字节数。
- 创建、选择或删除会话后清空旧会话的运行状态，避免显示上一会话的工具轨迹。

### 设计边界

- 第一版使用约 0.5 到 1.5 秒的轮询，没有引入 SSE、WebSocket、React 或 Vue。
- 上下文大小是 JSON 序列化字节数，只用于观察增长趋势，不等同于模型 token usage。
- Markdown 只覆盖当前聊天需要的常用子集，不支持消息编辑、文件上传或任意 HTML。

### 验证

```text
npm run check            PASS
npm run test:knowledge   PASS
npm run test:tools       PASS
npm run test:session     PASS
npm run test:web-search  PASS
```

随后使用本地 Web Server 和实际浏览器检查固定布局、会话恢复、上下文统计、工具步骤、输入框自动增高与响应式布局。

---

## 2026-09-21：终端命令的 /help 与未知命令兜底

### 开发目标

- 终端提供 `/help`，让用户不必记住斜杠命令。
- 写错的斜杠命令不应被当作任务发送给模型。

### 现象

- 在终端输入 `/session`（`/sessions` 的拼写错误）或 `/help` 时，程序不给出任何命令反馈，而是把整段文本作为任务交给模型。
- 结果是：用户无法从提示中纠正输入，而且每次输入错误都会消耗一次模型调用。

### 诊断假设

1. `/help` 未实现，因此落入“普通任务”分支。
2. 命令解析只有精确匹配和一条 `/use`、`/delete` 正则，缺少“以 `/` 开头即视为命令”的兜底判断。

### 根因

已确认与假设一致：`src/cli.ts` 的多轮循环按顺序判断 `/exit`、`/new`、`/sessions` 和 `/(use|delete)`，任何不匹配的输入都会走到循环末尾的 `runAgent()`。因此“命令”和“任务”之间没有显式分流，拼写错误必然被发送给模型。

### 实现变更

#### `src/cli.ts`

- 新增 `printHelp()`，输出中文命令说明。
- 新增 `/help` 分支。
- 在会话命令之后新增兜底分支：以 `/` 开头但未识别的输入只输出 `未知命令 <命令>。输入 /help 查看可用命令。`，然后继续下一轮，不再调用 `runAgent()`。
- 启动提示由固定命令串改为「输入 /help 查看会话命令，输入 /exit 退出。」
- 未改动 `/sessions`、`/use`、`/delete`、`/new`、`/exit` 的既有行为。

#### `README.md`

- 「使用终端会话」命令列表加入 `/help`。
- 说明未知命令只会提示错误，不会发送给模型，因此写错命令不消耗模型调用。
- 「当前边界」补充：会话命令只在多轮终端模式生效，单次任务模式没有交互命令。

### 最终验证

执行：

```powershell
npm run check
npm run test:session
```

结果：

```text
TypeScript check: PASS
session test: PASS - sessions can be created, selected, deleted, and saved incrementally.
```

冒烟测试直接运行编译产物 `.build/src/cli.js`（注入测试用假 Key，不调用模型），按固定间隔依次输入 `/help`、`/session`、`/exit`：

```text
已进入多轮对话，已加载 <N> 条历史记录。
输入 /help 查看会话命令，输入 /exit 退出。

你>
会话命令：
  /help                显示本说明。
  /sessions            列出全部会话，* 表示当前会话。
  /new                 创建并切换到新会话，旧会话仍会保留。
  /use <序号或ID>       切换会话，接受列表序号、完整 ID 或唯一 ID 前缀。
  /delete <序号或ID>    删除会话，删除当前会话后自动切换。
  /exit                退出程序。

其他输入都会作为任务交给 Agent。

你> 你>
```

标准错误只出现：

```text
未知命令 /session。输入 /help 查看可用命令。
```

进程退出码为 0，说明 `/session` 没有触发模型请求。

### 测试方式上的问题

先用 `npx tsx src/cli.ts` 并通过 PowerShell 管道输入时，进程立即以 `readline was closed` 失败，未打印任何界面输出；改为延迟写入 `stdin` 仍然失败。最终改为用 `node` 直接启动编译产物 `.build/src/cli.js` 并延迟写入输入后成功。

该现象与本次代码改动无关（改动前同样存在该测试方式的问题）。具体原因未验证，暂不记录为结论，只是后续冒烟测试优先直接运行编译产物。

### 当前边界

- `/session` 这类拼写错误只提示未知命令，没有别名或模糊匹配。
- `/help` 只在多轮终端模式可用；单次任务模式没有交互命令。
- 仍未实现会话重命名和通用数据版本迁移。

### 预防性结论

只要“命令”和“任务”共用同一个输入通道，就必须有一条显式的兜底判断决定未匹配输入的归属。本次选择让以 `/` 开头的未识别输入留在本地提示，从而把拼写错误的代价从“一次模型调用”降为“一行提示”。

---

## 2026-09-21：启动时恢复已有 Session，不再创建当前会话指针

### 问题现象

重新运行 Agent 时，即使 `.myagent/sessions/` 已经存在会话，启动流程仍可能先创建新的 Session。项目也会创建 `current-session.json`，但该额外指针文件并非期望的数据模型。

### 最小复现

回归测试创建一个已有历史的 Session，再用新的 `SessionStore` 实例模拟进程重启，并断言：

1. 启动恢复的 Session ID 与已有 ID 相同。
2. Session 文件数量仍为 1。
3. 创建和恢复过程中都不存在 `current-session.json`。

旧实现第一次运行该测试时失败：实际恢复出的 UUID 与已有 UUID 不同，证明启动流程额外创建了 Session。将断言进一步收紧为“不生成指针文件”后，旧实现出现 `Missing expected rejection`，证明 `current-session.json` 确实仍被创建。

### 诊断结论

`loadCurrent()` 在无法读取当前会话指针时直接执行旧版导入并调用 `create()`，没有先检查 `.myagent/sessions/` 中的新格式会话。因此指针缺失或失效会导致重复 Session。

### 实现变更

- 删除 `CurrentSessionFile`、`currentSessionPath`、指针解析和指针写入逻辑。
- `loadCurrent()` 启动时直接调用 `list()`，存在 Session 时加载最近使用项；列表为空时才执行旧版导入或创建空 Session。
- `select()` 更新所选 Session 的 `updatedAt`，使下次启动仍能恢复上次选择项，无需单独指针。
- 新建、保存和选择使用严格递增的更新时间，避免多个操作发生在同一毫秒时排序不稳定。
- 旧版遗留的 `current-session.json` 不再读取或写入；其中不包含会话历史，可以安全删除。
- 已删除当前工作区遗留的 `.myagent/current-session.json`；删除后确认 2 个 Session JSON 文件仍完整保留。
- 更新 `README.md` 和 `CONTEXT.md`，移除当前指针作为现行设计的描述。

### 最终验证

`npm run test:session` 连续执行两次均通过，随后执行完整验证：

```text
npm run check: PASS
npm run test:tools: PASS
npm run test:session: PASS - existing sessions are restored; sessions can be created, selected, deleted, and saved incrementally.
npm run test:web-search: PASS
```

搜索 `[DEBUG-` 未发现残留的临时调试代码。

### 预防性结论

启动恢复必须先查询持久化实体，再决定是否创建；“缺少辅助索引或指针”不能等同于“没有业务数据”。本次回归测试同时锁定 Session ID、文件数量和辅助文件不存在三个信号，防止以后重新引入同类问题。

---

## 2026-09-21：禁止 Agent 修改 myAgent 核心源码

### 开发目标

通过 Agent 的 System Prompt 将 myAgent 自身核心源码设为只读，避免 Agent 在执行普通任务时修改自己的运行实现。

### 实现变更

在 `src/agent.ts` 的 `SYSTEM_PROMPT` 中增加以下约束：

- 禁止创建、修改、移动、重命名或删除本仓库 `src/` 与 `web/` 下的文件。
- 禁止使用 `run_command` 或其他工具绕过限制。
- 允许读取和搜索核心源码以理解行为。
- 如果任务必须修改受保护路径，Agent 应说明核心源码受保护并拒绝执行修改。

### 验证

执行：

```powershell
npm run check
```

结果：TypeScript 类型检查通过。

### 安全边界

System Prompt 属于模型行为约束，不是操作系统或工具层的强制访问控制。若后续需要抵御模型忽略提示、提示注入或命令间接写入，应在 `write_file` 和 `run_command` 的执行层增加路径级强制校验。

---

## 2026-09-21：Web 与 CLI 会话选择和删除

### 开发目标

- Web UI 和 CLI 都能够选择已有会话。
- Web UI 和 CLI 都能够删除会话。
- 删除当前会话后应用仍然保持一个有效的当前会话。

### 行为设计

- 会话列表按 `updatedAt` 从新到旧排列。
- CLI 使用 `/sessions` 查看带序号的会话列表。
- CLI 使用 `/use <序号或ID>` 切换会话，使用 `/delete <序号或ID>` 删除会话。
- CLI 的 ID 参数支持完整 UUID 或唯一 UUID 前缀，前缀不唯一时拒绝操作。
- Web UI 继续使用下拉列表切换会话，并增加“删除”按钮和不可撤销确认框。
- 删除当前会话后自动选择最近更新的剩余会话。
- 删除最后一个会话后立即创建并持久化一个新的空会话。
- Agent 正在运行时，Web API 拒绝切换或删除会话，避免历史写入错误的 Session ID。

### 回归测试

先在 `tests/session.test.ts` 增加删除场景。首次运行按预期编译失败：

```text
Property 'delete' does not exist on type 'SessionStore'.
```

测试覆盖：

1. 删除当前会话后自动选择剩余会话。
2. 被删除文件不再出现在会话列表中。
3. 删除最后一个会话后自动创建不同 ID 的空会话。
4. 自动创建完成后磁盘上仍恰好存在一个可用会话。

### 实现变更

#### `src/session.ts`

- 新增 `SessionStore.delete(sessionId)`。
- 删除前加载目标会话，防止静默接受不存在的 ID。
- 删除非当前会话时保持当前会话不变。
- 删除当前会话时选择最近更新的剩余会话；无剩余会话时调用 `create()`。

#### `src/cli.ts`

- 新增 `/sessions`、`/use` 和 `/delete` 命令。
- 会话列表显示当前标记、序号、标题、更新时间、历史项数量和完整 ID。
- 新增序号、完整 ID、唯一 ID 前缀解析及对应错误提示。
- 切换或删除当前会话后同时替换内存中的 `currentSession` 与 `history`。

#### `src/web.ts`

- 新增 `POST /api/session/delete`。
- 删除后返回被删除的 ID 和新的当前会话 ID。
- 服务端在删除后同步替换 `activeSession` 与 `history`。

#### `web/index.html`

- 增加“删除”按钮。
- 删除前使用确认框明确提示操作不可撤销。
- 删除成功后同时刷新会话列表与消息列表。
- Agent 运行期间禁用删除按钮。

#### `README.md`

- 补充 CLI 命令、Web 删除功能、删除后的自动选择规则及开发日志文件位置。

### 最终验证

执行：

```powershell
npm run check
npm run test:tools
npm run test:session
npm run test:web-search
```

结果：

```text
TypeScript check: PASS
tools test: PASS
session test: PASS - sessions can be created, selected, deleted, and saved incrementally.
web-search test: PASS
```

当前没有自动化的浏览器或 HTTP 路由测试；Web 控件与路由通过 TypeScript 编译和共享 `SessionStore` 回归测试验证。这是本次验证的覆盖边界。

---

## 2026-09-21：多会话管理与增量持久化

### 开发目标

修复 Session 管理中的三个问题：

1. 只能维护一个会话文件。
2. 创建新会话时没有立即保存新会话数据。
3. 只有一次 Agent 调用正常结束后才保存会话数据。

### 修改前行为

- `SessionStore` 固定读写 `.myagent/session.json`。
- CLI 的 `/new` 和 Web 的“新会话”会清空内存历史并删除该文件。
- CLI 和 Web 只在 `runAgent()` 正常返回后调用 `session.save(history)`。
- 如果模型请求或工具循环中途失败，本轮已经加入内存的历史不会保存。
- 原有 `tests/session.test.ts` 只验证单文件的保存、加载和清空，因此无法发现上述问题。

### 初始基线

执行：

```powershell
npm run test:session
```

结果：

```text
PASS: session history can be saved, loaded, and cleared.
```

该结果只能证明旧的单文件设计按自身预期工作，不能证明多会话和增量持久化正确。

### 诊断假设

按优先级排列：

1. 单会话问题来自 `SessionStore` 将“当前会话”和“唯一存储文件”绑定在一起。
2. 新会话不落盘来自 `/new` 调用 `clear()`，其语义是删除文件而不是创建会话。
3. 中途历史丢失来自持久化逻辑位于 `runAgent()` 调用边界之外，只有成功返回才执行。
4. Web 和 CLI 都长期持有同一个 `history` 引用；仅修改底层存储不足以完成会话切换。

### 回归测试设计

将 `tests/session.test.ts` 改为验证以下真实症状：

- 连续创建两个会话后存在两个独立 JSON 文件。
- 第二个会话创建后立即存在，且历史为空。
- 选择第一个会话后能够恢复其历史。
- 模拟模型请求失败时，刚加入的用户消息仍然已经保存。

首次运行新测试时出现的预期失败：

```text
Property 'create' does not exist on type 'SessionStore'.
Property 'loadCurrent' does not exist on type 'SessionStore'.
Property 'select' does not exist on type 'SessionStore'.
Expected 1 arguments, but got 2.
'onHistoryChange' does not exist in type 'AgentOptions'.
```

这些失败分别证明多会话 API、按 ID 保存以及历史变化通知在修改前均不存在。

### 根因

已确认根因与诊断假设一致：

- 存储模型没有 Session ID，也没有当前会话指针。
- “新会话”被实现为删除现有数据，而不是创建一个新的持久化实体。
- Agent Loop 直接修改传入数组，却没有向持久化层报告中间变化。
- 界面层把历史数组当作不可切换的全局状态。

### 实现变更

#### `src/session.ts`

- 新增 `SessionData`：包含 `id`、`createdAt`、`updatedAt` 和 `history`。
- 每个会话保存到 `.myagent/sessions/<session-id>.json`。
- `.myagent/current-session.json` 保存当前会话 ID。
- 新增 `create()`、`loadCurrent()`、`load(id)`、`save(id, history)`、`list()` 和 `select(id)`。
- `create()` 会立即写入空会话文件，并更新当前会话指针。
- 会话 ID 只接受 UUID，避免通过 ID 越界访问其他文件。
- 首次升级时会读取旧版 `.myagent/session.json`，将其历史导入新会话；旧文件不会被删除。

#### `src/agent.ts`

- `AgentOptions` 新增 `onHistoryChange` 回调。
- 以下事件加入历史后立即等待持久化完成：
  - 用户消息；
  - 模型消息、推理项和工具调用；
  - 每个工具调用结果；
  - 最终模型回答。
- 因此后续模型请求失败时，已经发生的历史事件仍可恢复。

#### `src/cli.ts`

- 启动时加载当前会话。
- `/new` 改为创建并切换到新会话，不再删除旧会话。
- 使用 `onHistoryChange` 保存当前会话，移除仅在正常结束后执行的保存逻辑。

#### `src/web.ts`

- 服务端状态改为可切换的 `activeSession` 和 `history`。
- 新增 `GET /api/sessions`，返回会话列表和当前会话 ID。
- 新增 `POST /api/session`，切换已有会话。
- `POST /api/new` 改为立即创建并持久化新会话。
- Agent 运行期间禁止创建或切换会话，避免历史写入错误的 Session ID。

#### `web/index.html`

- 标题栏增加会话下拉列表。
- 支持加载并切换历史会话。
- 创建新会话后同时刷新会话列表和消息列表。
- Agent 运行期间禁用新建和切换控件。

#### 文档与测试

- `README.md` 更新存储路径、创建语义、增量保存、Web 切换和旧文件导入说明。
- `CONTEXT.md` 更新当前 Session 存储模型。
- `tests/session.test.ts` 覆盖多会话、新会话立即落盘、切换恢复和失败时增量保存。

### 数据流

```text
创建新会话
  -> 生成 Session ID
  -> 写入 sessions/<id>.json
  -> 更新 current-session.json

一次 Agent 调用
  -> 加入用户消息 -> 保存
  -> 加入模型输出/工具调用 -> 保存
  -> 加入每个工具结果 -> 保存
  -> 加入最终回答 -> 保存
```

### 调试过程中的编译问题

第一次实现回调时，`session.save()` 返回 `Promise<SessionData>`，但 `onHistoryChange` 要求 `void | Promise<void>`，TypeScript 报错：

```text
Type '(currentHistory: ResponseInput) => Promise<SessionData>' is not assignable to type
'(history: ResponseInput) => void | Promise<void>'.
```

修复方式：将调用包装为 `async` 回调并显式 `await session.save(...)`，使回调最终返回 `Promise<void>`。

### 最终验证

执行：

```powershell
npm run check
npm run test:tools
npm run test:session
npm run test:web-search
```

结果：

```text
TypeScript check: PASS
tools test: PASS
session test: PASS - multiple sessions are created, selected, and saved incrementally.
web-search test: PASS
```

为确认回归测试是确定性的，额外连续执行两次：

```powershell
npm run test:session
npm run test:session
```

两次均通过。搜索 `[DEBUG-` 未发现残留的临时调试日志。

### 当前边界

- 会话历史每次变化时仍采用整份 JSON 覆盖写入，不是追加式事件日志。
- Web UI 可以切换历史会话；CLI 当前只恢复当前会话并通过 `/new` 创建新会话。
- 尚未实现会话删除、重命名和通用数据版本迁移。
- Session History 与 Model Context 尚未拆分。

### 预防性结论

本次问题的共同原因是“当前会话状态”“会话身份”和“持久化时机”没有独立建模。现在通过显式 Session ID、当前会话指针和 Agent Loop 内部的历史变化回调，将三个职责分离，并由回归测试锁定关键行为。

---

## 2026-09-21：TypeScript Chroma 本地 RAG

### 开发目标

在不使用付费服务、不增加 Python 业务桥接层的前提下，为 Agent 增加：

1. 本地 Markdown/文本知识库。
2. 本地 ONNX Embedding。
3. Chroma 持久化向量索引。
4. 可由模型调用的 `knowledge_search` 工具。
5. 独立于 DeepSeek 的索引和查询验证命令。

### 已有环境确认

- 本机已经缓存 `all-MiniLM-L6-v2` 模型。
- 模型目录包含 `model.onnx`、`config.json`、`tokenizer.json`、词表和特殊 token 配置。
- 旧项目使用 Python `PersistentClient`，但 myAgent 本身是 TypeScript 项目。
- 决定只复用模型与 Chroma 概念，不复用旧项目的 `project_rules` collection。
- myAgent 使用独立 collection `myagent_knowledge` 和 `.myagent/chroma/` 数据目录。

### 技术选择

安装：

```text
chromadb 3.5.0
@huggingface/transformers 4.3.0
```

未保留 `@chroma-core/default-embed`。原因是它默认使用同一模型名称，但不保证读取 Python Chroma 的既有缓存。当前实现直接把已有 ONNX 目录传给 Transformers.js，并设置：

```text
local_files_only: true
subfolder: ""
dtype: "fp32"
pooling: "mean"
normalize: true
```

这使模型缺失时直接报错，不会静默联网下载另一份模型。

### 模型复用验证

用 TypeScript 直接加载现有模型，并对 `hello world` 生成向量：

```text
dims: [1, 384]
vectorLength: 384
```

验证过程中没有发起模型下载。

### Windows Chroma Server 问题

官方 npm CLI 在当前 `win32 x64` 机器上执行 `npx chroma --help` 时错误退出：

```text
Unsupported Windows architecture: x64. Only ARM64 is supported.
```

但 `chromadb` 的 optional dependency 已正确安装：

```text
chromadb-js-bindings-win32-x64-msvc
```

该绑定导出可用的 `cli`。因此 `src/chroma-server.ts` 使用 Node `createRequire()` 直接加载官方 x64 原生绑定并启动 Server，没有调用 Python，也没有修改 `node_modules`。

### 实现变更

#### `src/knowledge.ts`

- 递归读取 `knowledge/` 下的 `.md` 和 `.txt`。
- 按段落切块；超长段落使用带重叠的固定长度窗口。
- 生成稳定的 `source#0001` chunk ID。
- 对完整语料计算 SHA-256，检测索引是否过期。
- 延迟加载本地 ONNX 模型，并在进程内复用 Embedding pipeline。
- 分批生成 384 维归一化向量。
- 使用预计算向量执行 Chroma `upsert` 和 `queryEmbeddings` 查询。
- 删除已经不在知识库中的旧 chunk。
- 查询结果返回 `id`、`source`、`text` 和 `distance`。

#### `src/chroma-server.ts`

- 使用官方 Windows x64 原生绑定启动本地 Chroma Server。
- 默认监听 `127.0.0.1:8000`。
- 默认把索引保存到 `.myagent/chroma/`。

#### `src/knowledge-cli.ts`

- `index`：建立索引；语料哈希未变化时跳过 Embedding。
- `query`：直接查询本地知识库，不调用 DeepSeek。

#### `src/tools.ts` 与 `src/agent.ts`

- 注册 `knowledge_search(query, top_k)`。
- 系统提示词要求本地检索结果引用 `source` 和 chunk ID。
- 明确把知识片段和网页搜索结果都视为证据，而不是指令。

#### 测试与示例

- 新增 `tests/knowledge.test.ts`，验证切块编号和语料哈希。
- 新增 `knowledge/example.md` 作为最小可查询语料。
- `tests/tools.test.ts` 验证工具定义包含 `knowledge_search`。

### 新增命令

```powershell
npm run knowledge:server
npm run knowledge:index
npm run knowledge:query -- "query"
npm run test:knowledge
```

### 调试记录

第一次运行 `npm run knowledge:index` 时，`tsx` 在 Windows 临时目录初始化阶段报错：

```text
uv_os_get_passwd returned ENOMEM
```

错误发生在加载项目代码之前。知识库脚本随后改为与 Web 和测试一致的执行方式：

```text
tsc && node .build/...
```

修改后索引成功。

### 端到端验证

执行索引：

```text
Indexed 1 documents into 1 chunks (myagent_knowledge).
```

立即再次执行索引：

```text
Knowledge index is already current: 1 documents, 1 chunks.
```

执行英文查询成功召回 `example.md#0001`，余弦距离约为 `0.60`。随后直接调用 `executeTool("knowledge_search", ...)` 也返回相同来源、片段正文和距离，证明链路已经贯通：

```text
Agent tool -> TypeScript Embedding -> Chroma query -> structured evidence
```

### 当前边界

- Chroma Server 需要在使用本地 RAG 时单独保持运行。
- 知识文件变化后需要显式执行 `npm run knowledge:index`。
- `all-MiniLM-L6-v2` 主要适合英文语义检索；中文召回质量尚未建立评测集。
- 当前没有关键词混合检索、重排或距离阈值。
- RAG 结果尚未接入统一的 Model Context token 预算。

### 预防性结论

“应用使用 TypeScript”和“数据库作为独立进程”并不冲突。当前链路中，文档解析、Embedding、索引同步、查询和 Agent Tool 都是 TypeScript；Chroma Server 由 npm 包附带的官方原生绑定提供。这样保留了清晰的数据流，也避免为了复用旧实现而增加 Python bridge。

### 最终回归验证

使用 npm 包中的 Windows x64 原生绑定重新启动 Chroma 后，再次完成索引状态检查和真实向量查询，证明结果不是来自先前的 Python Server 进程：

```text
Knowledge index is already current: 1 documents, 1 chunks.
query "What is myAgent built to teach?" -> example.md#0001
distance: 0.53720045
```

完整确定性回归结果：

```text
npm run check            PASS
npm run test:knowledge   PASS
npm run test:tools       PASS
npm run test:session     PASS
npm run test:web-search  PASS
npm audit                0 vulnerabilities
```

验证完成后已停止临时启动的 Chroma Server；日常使用时由用户执行 `npm run knowledge:server` 保持服务运行。
