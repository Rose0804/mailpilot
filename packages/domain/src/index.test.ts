import { describe, expect, it } from "vitest";
import { assertMessageScope, type MessageRef } from "./index";

const validMessage: MessageRef = {
  account: {
    provider: "apple-mail",
    accountId: "work",
    email: "siyuan@loomos.ai",
    displayName: "Work",
  },
  mailboxId: "inbox",
  messageId: "message-1",
};

describe("邮件领域契约", () => {
  it("接受包含完整作用域的邮件引用", () => {
    expect(assertMessageScope(validMessage)).toEqual(validMessage);
  });

  it("拒绝缺少账号作用域的邮件引用", () => {
    expect(() =>
      assertMessageScope({
        ...validMessage,
        account: { ...validMessage.account, accountId: "" },
      }),
    ).toThrow("账号");
  });
});
