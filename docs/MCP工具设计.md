# MCP 工具设计

## 1. 只读工具

```text
list_accounts
list_mailboxes
search_messages
get_message
search_attachments
get_attachment_metadata
preview_attachment
search_attachment_content
```

## 2. 写操作工具

```text
create_draft
update_draft
reply_message
send_draft
move_message
archive_message
```

## 3. 事件与任务编排工具

```text
record_mail_event
create_task
list_tasks
list_schedule
```

`record_mail_event` 是事实层写入，不代表用户已经确认。它必须包含至少一个来源邮件，每个来源必须带 `accountId`、`mailboxId`、`messageId` 和邮件中的紧凑原文证据。时间不确定时保留字段为空。

`create_task` 是跨邮箱任务层写入。它可以引用多个事件、邮件来源和已有任务依赖；系统会校验来源邮件、账号作用域和依赖环。任务不会自动发送邮件、写入日历或执行高风险操作。

`list_schedule` 由数据库中的事件和任务生成确定性 `ScheduleOverview`，负责排序时间块并报告重叠冲突。它不是模型的自由文本推理结果。

## 4. 工具边界

工具只接受结构化输入，并且必须拒绝缺少账号作用域的请求。

独立 MCP 进程可以通过 `MAILPILOT_ACCOUNT_IDS` 固定到一个或多个账号；Pi 原生工具则使用产品 Session 的 `accountIds`。没有固定作用域时，MCP 仍要求查询和写入数据显式携带账号标识，不能通过同名文件夹或联系人推断账号。

```ts
type SearchMessagesInput = {
  accountIds?: string[];
  mailboxIds?: string[];
  query: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};
```

## 5. 资源设计

预览资源使用稳定的本地资源标识，不向 Agent 暴露任意文件系统路径：

```text
mailpilot://message/<account-id>/<mailbox-id>/<message-id>
mailpilot://attachment/<account-id>/<attachment-id>/preview
mailpilot://attachment/<account-id>/<attachment-id>/text
```

当前只读实现已提供：

- `list_accounts`
- `list_mailboxes`
- `search_messages`
- `get_message`
- `search_attachments`
- `get_attachment_metadata`
- `get_attachment_text`
- `mailpilot://message/{accountId}/{mailboxId}/{messageId}`
- `mailpilot://attachment/{accountId}/{attachmentId}/text`
- `mailpilot://attachment/{accountId}/{attachmentId}/preview`

MCP 返回的邮件正文和资源统一标记为不可信数据。资源 URI 是稳定标识，不返回 Mail.app 内部路径或本地附件绝对路径。

## 6. 写操作流程

```text
MCP 工具调用
    ↓
输入校验
    ↓
账号和消息作用域校验
    ↓
风险分级
    ↓
创建审批请求
    ↓
用户确认
    ↓
调用连接器
    ↓
回源校验结果
    ↓
写入审计记录
```

发送工具必须显示发件账号、收件人、主题、正文摘要和附件列表。
