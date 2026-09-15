# MailPilot MCP Server

本包把 MailPilot 的查询、附件资源和受控写操作暴露为 MCP 能力。

MCP Server 不直接绕过本地产品核心调用邮箱连接器。

Pi Agent Runtime 默认不通过 MCP 子进程调用本包，而是复用同一个查询服务生成 Pi 原生工具。MCP Server 继续服务于 DSH、外部 Agent 和调试客户端，保证能力定义只有一份。

当前只读能力包括：

- 账号、邮箱文件夹和邮件搜索。
- 邮件正文、附件元数据和附件解析文本。
- 稳定的 `mailpilot://message/...` 与 `mailpilot://attachment/...` 资源。

所有查询结果都保留账号作用域；附件正文和解析文本会标记为不可信内容。
