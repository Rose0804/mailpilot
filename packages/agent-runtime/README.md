# Agent Runtime

本包是 MailPilot 与 DeepSeek Harness 之间的适配边界。

## 设计

- DSH 负责会话、推理、工具选择和事件流。
- MailPilot MCP Server 负责邮箱工具和稳定资源。
- MailPilot Policy 负责账号作用域、审批和审计，DSH 不是安全边界。
- UI 只订阅 `AgentEvent`，不解析 DSH 私有协议。

当前提供 `DshRuntimeAdapter` 和 `JsonLineDshTransport`。后者约定 DSH 进程通过 stdin/stdout 交换 JSONL：

```json
{"type":"session.start","sessionId":"request-id","options":{"mcpServers":{}}}
{"type":"session.started","requestId":"request-id","sessionId":"session-id"}
{"type":"message.send","sessionId":"session-id","text":"找续约邮件"}
{"type":"tool.call","sessionId":"session-id","tool":"search_messages"}
{"type":"approval.respond","sessionId":"session-id","approvalId":"approval-id","approved":true}
```

这个协议是本地适配契约，不假设仓库里已经安装某个 DSH CLI。真正接入时只需把 `command` 指向已安装的 harness，并让它连接 MailPilot MCP stdio server。
