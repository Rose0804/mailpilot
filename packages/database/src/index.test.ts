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

    const rows = database.searchMessages({ accountIds: ["work"], query: "renewal" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ref.account.email).toBe("siyuan@loomos.ai");
    expect(
      database.searchMessages({
        dateFrom: "2026-09-15T00:00:00Z",
        query: "renewal",
      }),
    ).toHaveLength(0);
    database.close();
  });
});
