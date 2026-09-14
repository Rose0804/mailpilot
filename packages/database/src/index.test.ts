import { describe, expect, it } from "vitest";
import { MailDatabase } from "./index";

describe("本地邮件数据库", () => {
  it("保存并按账号和关键词搜索邮件", () => {
    const database = new MailDatabase();
    const account = {
      accountId: "work",
      provider: "apple-mail" as const,
      email: "siyuan@loomos.ai",
      displayName: "Work",
    };
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-1" },
      sender: "Maya",
      subject: "Renewal terms",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review the agreement",
      body: "Payment schedule changed",
      isRead: false,
    });
    database.upsertAttachment({
      id: "a-1",
      message: { account, mailboxId: "INBOX", messageId: "m-1" },
      filename: "renewal.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 128,
      indexStatus: "ready",
    });
    database.upsertAttachmentChunk("a-1", 0, "Payment schedule changed to net 45");

    const rows = database.searchMessages({ accountIds: ["work"], query: "renewal" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.account.email).toBe("siyuan@loomos.ai");
    expect(database.listAccounts()[0].accountId).toBe("work");
    expect(database.listMailboxes("work")[0].mailboxId).toBe("INBOX");
    expect(database.getMessage(rows[0].ref)?.subject).toBe("Renewal terms");
    expect(database.listAttachments(rows[0].ref)[0].filename).toBe("renewal.xlsx");
    expect(database.getAttachment("work", "a-1")?.message.messageId).toBe("m-1");
    expect(database.searchAttachmentContent({ query: "net 45" })[0].attachment.id).toBe("a-1");
    expect(
      database.searchMessages({
        dateFrom: "2026-09-15T00:00:00Z",
        query: "renewal",
      }),
    ).toHaveLength(0);
    database.close();
  });
});
