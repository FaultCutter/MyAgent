# 现代 Agent 架构调研（2026-09）

## 结论

不存在公认唯一的“最先进 Agent 架构”。当前成熟方向是：

```text
用户 / API
    ↓
任务与运行控制器
    ↓
确定性状态机 / 持久工作流
    ↓
在不确定节点中运行有界 Agent Loop
    ↓
类型化工具 / MCP / 外部服务
    ↓
Event、Checkpoint、Artifact 与结果持久化

横切能力：HITL、权限、Trace、Eval、重试、幂等、上下文管理
```

也就是“薄智能循环 + 厚运行时”：模型决定开放问题中的下一步，代码负责生命周期、状态、风险和恢复。多 Agent 只是复杂任务下的可选层，不是先进程度的必选项。

## 生产级基座的共同组成

1. **有界 Agent Loop**：模型在最终回答、工具调用与委派之间选择；运行时负责执行、回传、步数和终止。
2. **Task / Run / Session 分离**：Task 是目标，Run 是一次执行，Session 是对话，Checkpoint 是可恢复位置，Memory 是跨会话信息，Artifact 是文件或结构化成果。
3. **统一 Tool Runtime**：schema、运行时校验、错误分类、超时、取消、审批、重试和幂等。
4. **Context Engine**：按当前任务动态组合指令、近期历史、计划、证据和记忆，而不是把全部历史直接重发。
5. **Durable Execution**：长任务支持 checkpoint、暂停、恢复、取消和进程重启后继续。
6. **Human in the Loop**：批准、拒绝、编辑参数、补充信息，并从原 Run 状态恢复。
7. **Trace 与 Eval**：同时评估最终答案与工具轨迹，记录模型调用、工具调用、耗时、usage、错误和停止原因。
8. **隔离执行**：无人值守的 Shell、代码执行或副作用操作需要 Sandbox 与最小权限。
9. **开放协议**：MCP 用于 Agent 接入工具、资源和 Prompt；A2A 用于独立 Agent 系统之间通信。

## 四类常见架构

| 架构 | 适用场景 | 主要代价 |
|---|---|---|
| 单 Agent Loop | 开放式但规模较小的任务、个人助手 | 长任务容易漂移，恢复能力弱 |
| Planner / Executor | 长任务、需要计划展示或计划审批 | 计划可能过时，模型调用和状态同步增加 |
| Graph / Durable Workflow | 业务流程、审批、失败恢复、长期任务 | 状态 schema、checkpoint 和幂等更复杂 |
| Multi-agent | 真正可并行、上下文需隔离、权限或模型不同的子任务 | 成本、延迟、合并冲突和调试复杂度上升 |

Graph 不比 Agent 更智能，它解决的是可靠运行。Multi-agent 也不是单 Agent 的自然升级版；只有并行、上下文隔离、权限隔离或独立部署确实带来收益时才值得使用。

## myAgent 的现状与缺口

已有能力：Tool Call Loop、多轮 Session、上下文裁剪、Token 统计、联网、本地 RAG、命令审批、简单运行状态和工具输出预算。

作为通用 Agent 基座，主要缺口按优先级排列：

1. 自动化 Agent Eval。
2. 结构化 Run Trace 与 Event。
3. Session 之外的 Run 状态和可恢复 Checkpoint。
4. 统一 Tool Result、错误分类、重试、取消与幂等。
5. Artifact 管理。
6. MCP Client。
7. 只对复杂任务启用的可观察 Plan。
8. 后台任务队列。
9. 无人值守执行前的 Sandbox。
10. 最后才是 Multi-agent 与 A2A。

## 推荐学习顺序

### 1. Trace + Eval

把人工 session 分析变成固定用例：

```json
{
  "prompt": "搜索 Node.js 官方文档，解释 process.loadEnvFile",
  "expectedTools": ["web_search", "fetch_web_page"],
  "forbiddenTools": ["knowledge_search", "run_command", "list_files"],
  "maxToolCalls": 3
}
```

记录 `run_id`、模型轮次、工具、参数、耗时、usage、错误与 `stop_reason`。

### 2. Run 状态机与恢复

```text
queued → running → waiting_for_approval → completed
                  ↘ failed / cancelled
```

保存当前 step、pending tool call、事件和最终结果。先自行实现小状态机，不急着引入 LangGraph。

### 3. 统一 Tool Runtime

统一返回结构，例如：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "retryable": false,
  "metadata": {}
}
```

然后加入错误类型、取消信号、重试策略和副作用 `idempotencyKey`。

### 4. MCP Client

本地 Tool Runtime 稳定后接入 MCP Server，先做 Client，不必立刻把所有现有工具改成 MCP Server。

### 5. Planner、Sandbox、Multi-agent

Planner 只对复杂任务启用；当前前台命令全部审批时 Sandbox 可暂缓，但后台执行或自动批准前必须补上。只有 Eval 证明单 Agent 存在真实瓶颈后再加入 Multi-agent。

## 一手来源

- [Anthropic：Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic：Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenAI Agents SDK：Agents](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK：Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK：Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI Agents SDK：Sessions](https://openai.github.io/openai-agents-python/sessions/)
- [OpenAI Agents SDK：Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK：Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [LangGraph：Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Google ADK：Evaluation workflow](https://google.github.io/agents-cli/guide/hands-on-tutorial/)
- [Google ADK：Sandboxed code execution](https://google.github.io/adk-docs/tools/google-cloud/code-exec-agent-engine/)
