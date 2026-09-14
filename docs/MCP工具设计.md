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

## 3. 工具边界

工具只接受结构化输入，并且必须拒绝缺少账号作用域的请求。

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

## 4. 资源设计

预览资源使用稳定的本地资源标识，不向 Agent 暴露任意文件系统路径：

```text
mailpilot://message/<message-id>
mailpilot://attachment/<attachment-id>/preview
mailpilot://attachment/<attachment-id>/text
```

## 5. 写操作流程

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
