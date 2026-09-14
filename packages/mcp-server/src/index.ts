import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AccountRef, MailMessage, MailboxRef, MessageRef } from "@mailpilot/domain";
import type { MailDatabase, MessageSearchInput } from "@mailpilot/database";

export type MailQueryService = {
  listAccounts(): AccountRef[];
  listMailboxes(accountId: string): MailboxRef[];
  searchMessages(input: MessageSearchInput): MailMessage[];
  getMessage(ref: MessageRef): MailMessage | null;
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

  return server;
}

export function createDatabaseQueryService(database: MailDatabase): MailQueryService {
  return {
    listAccounts: () => database.listAccounts(),
    listMailboxes: (accountId) => database.listMailboxes(accountId),
    searchMessages: (input) => database.searchMessages(input),
    getMessage: (ref) => database.getMessage(ref),
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
