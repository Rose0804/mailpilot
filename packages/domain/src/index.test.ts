import { describe, expect, it } from "vitest";
import { assertMessageScope, buildScheduleOverview, type MailEvent, type MessageRef, type OrchestrationTask } from "./index";

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

  it("按事件和任务截止时间生成可解释的时间表并标记冲突", () => {
    const event: MailEvent = {
      eventId: "event-1",
      kind: "meeting",
      title: "客户评审",
      startAt: "2026-09-17T10:00:00Z",
      endAt: "2026-09-17T11:00:00Z",
      attendees: ["Maya"],
      confidence: 0.92,
      status: "proposed",
      sources: [{ accountId: "work", mailboxId: "inbox", messageId: "m-1", evidence: "Thursday 10 AM" }],
      createdAt: "2026-09-16T01:00:00Z",
      updatedAt: "2026-09-16T01:00:00Z",
    };
    const task: OrchestrationTask = {
      taskId: "task-1",
      title: "准备评审材料",
      status: "planned",
      priority: "high",
      dueAt: "2026-09-17T10:30:00Z",
      estimatedMinutes: 60,
      sourceEventIds: ["event-1"],
      sourceRefs: event.sources,
      dependencyIds: [],
      accountIds: ["work"],
      createdAt: "2026-09-16T01:00:00Z",
      updatedAt: "2026-09-16T01:00:00Z",
    };

    const overview = buildScheduleOverview([event], [task], "2026-09-16T02:00:00Z");
    expect(overview.blocks.map((block) => block.sourceId)).toEqual(["task-1", "event-1"]);
    expect(overview.conflicts[0].title).toContain("时间重叠");
    expect(overview.blocks[0].conflictIds).toContain("conflict:1");
  });
});
