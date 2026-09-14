# Agent Runtime

本包是 MailPilot 与 DeepSeek Harness 之间的适配边界。

## 设计

- DSH 负责会话、推理、工具选择和事件流。
- MailPilot MCP Server 负责邮箱工具和稳定资源。
- MailPilot Policy 负责账号作用域、审批和审计，DSH 不是安全边界。
- UI 只订阅 `AgentEvent`，不解析 DSH 私有协议。

当前提供 `DshRuntimeAdapter` 和 `JsonLineDshTransport`。后者对接 DSH SDK 的 stdin/stdout JSON-RPC：

```json
{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"cwd":"/workspace","provider":"deepseek-official","model":"deepseek-v4-flash"}}
{"jsonrpc":"2.0","id":"2","method":"session/prompt","params":{"sessionId":"session-id","contentBlocks":[{"type":"text","text":"找续约邮件"}]}}
{"jsonrpc":"2.0","method":"session.event","params":{"sessionId":"session-id","event":{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"我找到 1 封邮件。"}]}}}}}
{"jsonrpc":"2.0","method":"session.status","params":{"sessionId":"session-id","status":"idle"}}
```

DSH 的 MCP 工具通过 profile patch 配置 `@deepseek-ai/dsh-mcp-client`，以 `mcp__mailpilot__<tool>` 形式出现在模型工具列表中。MailPilot 不把 `mcpServers` 伪装成 `initialize` 参数，也不把 DSH 当作审批边界；发送、删除和批量变更仍由 MailPilot Policy 拦截。
