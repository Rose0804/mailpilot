# Agent Runtime

本包是 MailPilot 产品 Session 与 Agent 执行器之间的适配边界。

## 设计

- Pi Agent Core 默认负责推理循环、工具选择、流式事件、steer、follow-up 和 abort。
- DSH 通过 `DshRuntimeAdapter` 作为可选兼容运行时。
- MailPilot MCP Server 负责标准 MCP 工具和稳定资源；Pi 默认直接复用同一查询服务生成原生工具。
- MailPilot Policy 负责账号作用域、审批和审计，任何 Agent runtime 都不是安全边界。
- UI 只订阅 MailPilot `AgentEvent`，不解析 Pi 或 DSH 的隐式思维链。
- 时间表请求通过结构化工具完成：先搜索和读取，再 `record_mail_event`，然后 `create_task`，最后 `list_schedule`。

## 统一契约

`AgentRuntime` 提供：

```text
createSession
streamMessage
steer
followUp
abort
respondToApproval
getSession
listEvents
closeSession
close
```

产品 Session 包含 `runtime`、账号作用域、状态、轮次和时间戳。`FileSessionStore` 将元数据和审计事件写入 JSON 文件；Pi 的完整上下文 transcript 目前仍由进程内 `Agent` 持有。

## Pi 默认链路

```text
Local API
  -> PiAgentRuntime
  -> @earendil-works/pi-agent-core Agent
  -> Pi AgentTool[]
  -> MailPilot database / attachment index
  -> AgentEvent
  -> FileSessionStore + Desktop UI
```

模型默认是 `deepseek-v4-flash`，由 `@earendil-works/pi-ai/providers/deepseek` 提供。模型密钥由 `DEEPSEEK_API_KEY` 提供。

当前提供 `DshRuntimeAdapter` 和 `JsonLineDshTransport`。后者对接 DSH SDK 的 stdin/stdout JSON-RPC：

```json
{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"cwd":"/workspace","provider":"deepseek-official","model":"deepseek-v4-flash"}}
{"jsonrpc":"2.0","id":"2","method":"session/prompt","params":{"sessionId":"session-id","contentBlocks":[{"type":"text","text":"找续约邮件"}]}}
{"jsonrpc":"2.0","method":"session.event","params":{"sessionId":"session-id","event":{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"我找到 1 封邮件。"}]}}}}}
{"jsonrpc":"2.0","method":"session.status","params":{"sessionId":"session-id","status":"idle"}}
```

DSH 的 MCP 工具通过 profile patch 配置 `@deepseek-ai/dsh-mcp-client`，以 `mcp__mailpilot__<tool>` 形式出现在模型工具列表中。MailPilot 不把 `mcpServers` 伪装成 `initialize` 参数，也不把 DSH 当作审批边界；发送、删除和批量变更仍由 MailPilot Policy 拦截。

## 结构化编排

事件和任务不是 Agent 的隐式记忆：

```text
邮件 / 附件
  -> search_messages / search_attachments
  -> get_message / get_attachment_text
  -> record_mail_event（来源 + 证据 + 置信度）
  -> create_task（跨账号 + 依赖）
  -> list_schedule（排序 + 冲突）
```

`MailEvent` 和 `OrchestrationTask` 写入 MailPilot 数据库，UI 只展示这些可审计结果。Agent 不展示隐式思维链，也不凭空补全邮件中没有确认的时间。
