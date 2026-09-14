import { describe, expect, it } from "vitest";
import { accounts, messages } from "./data";

describe("MailPilot 示例数据契约", () => {
  it("为每封邮件提供明确的账号作用域", () => {
    expect(messages.every((message) => accounts.some((account) => account.id === message.accountId))).toBe(true);
  });

  it("可以按搜索词找到合同邮件", () => {
    const result = messages.filter((message) =>
      `${message.sender} ${message.subject} ${message.preview}`.toLowerCase().includes("renewal"),
    );

    expect(result).toHaveLength(1);
    expect(result[0].accountId).toBe("work");
    expect(result[0].subject).toContain("vendor renewal");
  });
});
