# MailPilot MCP Server

本包把 MailPilot 的查询、附件资源和受控写操作暴露为 MCP 能力。

MCP Server 不直接绕过本地产品核心调用邮箱连接器。

Pi Agent Runtime 默认不通过 MCP 子进程调用本包，而是复用同一个查询服务生成 Pi 原生工具。MCP Server 继续服务于 DSH、外部 Agent 和调试客户端，保证能力定义只有一份。

当前只读能力包括：

- 账号、邮箱文件夹和邮件搜索。
- 邮件正文、附件元数据和附件解析文本。
- 稳定的 `mailpilot://message/...` 与 `mailpilot://attachment/...` 资源。

所有查询结果都保留账号作用域；附件正文和解析文本会标记为不可信内容。

当前结构化编排能力包括：

- `record_mail_event`：保存带邮件原文证据和置信度的事件。
- `create_task`：创建带来源、跨账号信息和依赖关系的任务。
- `list_tasks`：按账号和日期范围读取任务。
- `list_schedule`：按时间排序事件和任务并检测冲突。

Pi 默认直接复用相同的查询服务和工具校验；DSH 与外部 Agent 通过 MCP 调用相同的能力。规划工具只负责事实、任务和排程数据，不会绕过审批去发送邮件或写入日历。

独立 MCP 进程可以通过 `MAILPILOT_ACCOUNT_IDS=work,personal` 固定账号作用域。未设置时服务会暴露本地索引中的全部账号，调用方仍必须在每个来源和查询中保留账号标识。
