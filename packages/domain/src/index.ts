export type Provider = "apple-mail" | "gmail" | "imap" | "exchange";

export type MailboxRef = {
  account: AccountRef;
  mailboxId: string;
  name: string;
  unreadCount: number;
};

export type AccountRef = {
  provider: Provider;
  accountId: string;
  email: string;
  displayName: string;
};

export type MailMessage = {
  ref: MessageRef;
  sender: string;
  subject: string;
  receivedAt: string;
  preview: string;
  body?: string;
  isRead: boolean;
};

export type MessageRef = {
  account: AccountRef;
  mailboxId: string;
  messageId: string;
  internetMessageId?: string;
  threadId?: string;
};

export type Attachment = {
  id: string;
  message: MessageRef;
  filename: string;
  mimeType: string;
  size: number;
  contentHash?: string;
  localPath?: string;
  extractedTextPath?: string;
  previewPath?: string;
  indexStatus: "pending" | "ready" | "failed";
};

export type AgentStep = {
  runId: string;
  tool: string;
  inputSummary: string;
  outputSummary: string;
  status: "success" | "failed" | "blocked";
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  action: "send" | "reply" | "delete" | "batch-move";
  accountId: string;
  messageId?: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
};

export function assertMessageScope(message: MessageRef): MessageRef {
  const values = [message.account.accountId, message.account.email, message.mailboxId, message.messageId];
  if (values.some((value) => !value.trim())) {
    throw new Error("邮件操作必须包含账号、邮箱和消息标识");
  }
  return message;
}
