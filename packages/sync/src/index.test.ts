import { describe, expect, it } from "vitest";
import type { AccountRef, MailMessage, MailboxRef } from "@mailpilot/domain";
import type { MailReader } from "@mailpilot/apple-mail-connector";
import { MailDatabase } from "@mailpilot/database";
import { MailSyncService } from "./index";

const account: AccountRef = {
  accountId: "work",
  provider: "apple-mail",
  email: "siyuan@loomos.ai",
  displayName: "Work",
};
const message: MailMessage = {
  ref: { account, mailboxId: "INBOX", messageId: "m-1" },
  sender: "Maya",
  subject: "Renewal",
  receivedAt: "2026-09-14T09:42:00Z",
  preview: "Review",
  isRead: false,
};

describe("邮件同步服务", () => {
  it("把连接器数据写入本地数据库", async () => {
    const mailbox: MailboxRef = { account, mailboxId: "INBOX", name: "INBOX", unreadCount: 1 };
    const reader: MailReader = {
      listAccounts: async () => [account],
      listMailboxes: async () => [mailbox],
      listMessages: async () => [message],
      getMessage: async () => message,
    };
    const database = new MailDatabase();
    const result = await new MailSyncService(reader, database).syncInbox("work");
    expect(result.messages).toBe(1);
    expect(database.searchMessages({ query: "Renewal" })).toHaveLength(1);
    database.close();
  });
});
