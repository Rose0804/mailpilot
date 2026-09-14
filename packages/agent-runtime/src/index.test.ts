import { describe, expect, it } from "vitest";
import { DshRuntimeAdapter, type DshEvent, type DshTransport } from "./index.js";

class FakeDshTransport implements DshTransport {
  async startSession() {
    return { sessionId: "session-1", createdAt: "2026-09-14T12:00:00Z" };
  }

  async *sendMessage(_sessionId: string, _text: string): AsyncIterable<DshEvent> {
    yield { type: "tool.call", tool: "search_messages", inputSummary: "renewal" };
    yield { type: "tool.result", tool: "search_messages", outputSummary: "1 result", status: "success" };
    yield { type: "assistant.message", text: "我找到 1 封相关邮件。" };
    yield { type: "run.completed" };
  }

  async respondToApproval() {}

  async closeSession() {}
}

describe("DSH Agent Runtime 适配层", () => {
  it("保留会话并广播结构化 Agent 事件", async () => {
    const runtime = new DshRuntimeAdapter(new FakeDshTransport());
    const session = await runtime.createSession({ title: "查找续约邮件", accountIds: ["work"] });
    const events: string[] = [];
    runtime.events.subscribe(session.sessionId, (event) => events.push(event.type));

    for await (const _event of runtime.streamMessage({
      sessionId: session.sessionId,
      text: "找一下续约邮件",
    })) {
      // Consume the stream to drive the adapter.
    }

    expect(events).toEqual(["tool.call", "tool.result", "assistant.message", "run.completed"]);
    await runtime.respondToApproval(session.sessionId, "approval-1", true);
    await runtime.closeSession(session.sessionId);
  });

  it("拒绝向不存在的会话发送消息", async () => {
    const runtime = new DshRuntimeAdapter(new FakeDshTransport());
    await expect(
      (async () => {
        for await (const _event of runtime.streamMessage({ sessionId: "missing", text: "hello" })) {
          // The iterator should fail before yielding an event.
        }
      })(),
    ).rejects.toThrow("未找到 Agent 会话");
  });
});
