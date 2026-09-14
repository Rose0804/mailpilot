import { describe, expect, it } from "vitest";
import { AppleMailConnector, type JxaExecutor } from "./index";

class FakeJxaExecutor implements JxaExecutor {
  async run(script: string): Promise<string> {
    if (script.includes("Mail.accounts().map")) {
      return JSON.stringify([
        {
          accountId: "Work",
          displayName: "Work",
          email: "siyuan@loomos.ai",
          provider: "apple-mail",
        },
      ]);
    }
    if (script.includes("mailboxes().map")) {
      return JSON.stringify([
        {
          accountId: "Work",
          id: "INBOX",
          name: "INBOX",
          unreadCount: 2,
        },
      ]);
    }
    return JSON.stringify([
      {
        accountId: "Work",
        mailboxId: "INBOX",
        messageId: "m-1",
        threadId: "t-1",
        sender: "Maya <maya@northstar.co>",
        subject: "Renewal terms",
        receivedAt: "2026-09-14T09:42:00Z",
        preview: "Please review the updated agreement.",
        body: "Please review the updated agreement.",
        isRead: false,
      },
    ]);
  }
}

describe("Apple Mail 只读连接器", () => {
  it("读取账号、文件夹和带作用域的邮件", async () => {
    const connector = new AppleMailConnector(new FakeJxaExecutor());
    const accounts = await connector.listAccounts();
    const mailboxes = await connector.listMailboxes("Work");
    const messages = await connector.listMessages("Work", "INBOX");

    expect(accounts[0].email).toBe("siyuan@loomos.ai");
    expect(mailboxes[0].account.accountId).toBe("Work");
    expect(messages[0].ref.mailboxId).toBe("INBOX");
    expect(messages[0].ref.account.email).toBe("siyuan@loomos.ai");
  });

  it("找不到账号时拒绝读取", async () => {
    const connector = new AppleMailConnector(new FakeJxaExecutor());
    await expect(connector.listMailboxes("Missing")).rejects.toThrow("未找到邮箱账号");
  });
});
