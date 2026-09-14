import { readFile } from "node:fs/promises";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AccountRef, Attachment, MailMessage, MailboxRef, MessageRef } from "@mailpilot/domain";
import type {
  AttachmentSearchInput,
  MailDatabase,
  MessageSearchInput,
  AttachmentSearchResult,
} from "@mailpilot/database";

export type MailQueryService = {
  listAccounts(): AccountRef[];
  listMailboxes(accountId: string): MailboxRef[];
  searchMessages(input: MessageSearchInput): MailMessage[];
  getMessage(ref: MessageRef): MailMessage | null;
  listAttachments(ref: MessageRef): Attachment[];
  getAttachment(accountId: string, attachmentId: string): Attachment | null;
  searchAttachmentContent(input: AttachmentSearchInput): AttachmentSearchResult[];
};

const scopedMessageSchema = z.object({
  accountId: z.string().trim().min(1),
  mailboxId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
});

const accountFilterSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).optional(),
  mailboxIds: z.array(z.string().trim().min(1)).optional(),
  query: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export function createMailPilotMcpServer(queryService: MailQueryService): McpServer {
  const server = new McpServer(
    { name: "mailpilot", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "列出邮箱账号",
      description: "列出 MailPilot 已发现并建立本地索引的邮箱账号。结果包含 provider 和完整账号作用域。",
      inputSchema: z.object({}),
    },
    async () => result(queryService.listAccounts()),
  );

  server.registerTool(
    "search_attachments",
    {
      title: "搜索附件内容",
      description: "在已解析的附件文本分块中检索文件内容，并返回邮件和账号作用域。",
      inputSchema: accountFilterSchema.extend({
        messageIds: z.array(z.string().trim().min(1)).optional(),
      }),
    },
    async (input) => result(queryService.searchAttachmentContent(input)),
  );

  server.registerTool(
    "get_attachment_metadata",
    {
      title: "读取附件元数据",
      description: "读取指定账号下的附件文件名、类型、大小和解析状态，不暴露本地路径给 Agent。",
      inputSchema: z.object({
        accountId: z.string().trim().min(1),
        attachmentId: z.string().trim().min(1),
      }),
    },
    async ({ accountId, attachmentId }) => {
      const attachment = queryService.getAttachment(accountId, attachmentId);
      if (!attachment) return result({ found: false, accountId, attachmentId });
      return result({ found: true, attachment: publicAttachment(attachment) });
    },
  );

  server.registerTool(
    "list_mailboxes",
    {
      title: "列出邮箱文件夹",
      description: "列出指定账号的邮箱文件夹。必须使用 accountId，避免多账号下的同名文件夹混淆。",
      inputSchema: z.object({ accountId: z.string().trim().min(1) }),
    },
    async ({ accountId }) => result(queryService.listMailboxes(accountId)),
  );

  server.registerTool(
    "search_messages",
    {
      title: "搜索邮件",
      description:
        "在本地索引中搜索邮件主题、发件人、摘要和正文。返回结果始终带 accountId、mailboxId 和 messageId。",
      inputSchema: accountFilterSchema,
    },
    async (input) => result(queryService.searchMessages(input)),
  );

  server.registerTool(
    "get_message",
    {
      title: "读取邮件",
      description: "读取一封邮件的完整本地内容。必须同时提供账号、邮箱文件夹和消息标识。",
      inputSchema: scopedMessageSchema,
    },
    async (input) => {
      const message = queryService.getMessage(toMessageRef(input, queryService));
      if (!message) return result({ found: false, ref: input });
      return result({ found: true, message });
    },
  );

  server.registerResource(
    "message",
    new ResourceTemplate("mailpilot://message/{accountId}/{mailboxId}/{messageId}", {
      list: undefined,
    }),
    {
      title: "邮件正文资源",
      description: "通过稳定的 MailPilot URI 读取邮件内容，不暴露本地文件路径。",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const input = scopedMessageSchema.parse({
        accountId: variables.accountId,
        mailboxId: variables.mailboxId,
        messageId: variables.messageId,
      });
      const message = queryService.getMessage(toMessageRef(input, queryService));
      if (!message) {
        throw new Error(`未找到邮件: ${input.accountId}/${input.mailboxId}/${input.messageId}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ trusted: false, message }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "attachment-text",
    new ResourceTemplate("mailpilot://attachment/{accountId}/{attachmentId}/text", { list: undefined }),
    {
      title: "附件解析文本",
      description: "读取已索引的附件纯文本内容。内容来自不可信文件解析结果。",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const input = attachmentVariables(variables);
      const attachment = queryService.getAttachment(input.accountId, input.attachmentId);
      if (!attachment?.extractedTextPath) throw new Error(`附件尚未生成文本索引: ${input.attachmentId}`);
      const text = await readFile(attachment.extractedTextPath, "utf8");
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: `UNTRUSTED_ATTACHMENT_TEXT\n${text}` }],
      };
    },
  );

  server.registerResource(
    "attachment-preview",
    new ResourceTemplate("mailpilot://attachment/{accountId}/{attachmentId}/preview", { list: undefined }),
    {
      title: "附件预览",
      description: "读取由本地核心生成的附件预览二进制内容。",
    },
    async (uri, variables) => {
      const input = attachmentVariables(variables);
      const attachment = queryService.getAttachment(input.accountId, input.attachmentId);
      if (!attachment?.previewPath) throw new Error(`附件尚未生成预览: ${input.attachmentId}`);
      const bytes = await readFile(attachment.previewPath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/octet-stream",
            blob: bytes.toString("base64"),
          },
        ],
      };
    },
  );

  return server;
}

export function createDatabaseQueryService(database: MailDatabase): MailQueryService {
  return {
    listAccounts: () => database.listAccounts(),
    listMailboxes: (accountId) => database.listMailboxes(accountId),
    searchMessages: (input) => database.searchMessages(input),
    getMessage: (ref) => database.getMessage(ref),
    listAttachments: (ref) => database.listAttachments(ref),
    getAttachment: (accountId, attachmentId) => database.getAttachment(accountId, attachmentId),
    searchAttachmentContent: (input) => database.searchAttachmentContent(input),
  };
}

function toMessageRef(
  input: z.infer<typeof scopedMessageSchema>,
  queryService: MailQueryService,
): MessageRef {
  const account = queryService.listAccounts().find((item) => item.accountId === input.accountId);
  if (!account) throw new Error(`未找到邮箱账号: ${input.accountId}`);
  return {
    account,
    mailboxId: input.mailboxId,
    messageId: input.messageId,
  };
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function publicAttachment(attachment: Attachment): Omit<Attachment, "localPath" | "extractedTextPath" | "previewPath"> {
  const { localPath: _localPath, extractedTextPath: _extractedTextPath, previewPath: _previewPath, ...publicValue } =
    attachment;
  return publicValue;
}

function attachmentVariables(variables: Record<string, string | string[] | undefined>): {
  accountId: string;
  attachmentId: string;
} {
  const accountId = firstVariable(variables.accountId);
  const attachmentId = firstVariable(variables.attachmentId);
  return {
    accountId: z.string().trim().min(1).parse(accountId),
    attachmentId: z.string().trim().min(1).parse(attachmentId),
  };
}

function firstVariable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
