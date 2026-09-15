import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  type AgentEvent,
  DshRuntimeAdapter,
  JsonLineDshTransport,
  PiAgentRuntime,
  FileSessionStore,
  type DshEvent,
  type DshTransport,
} from "./index.js";

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

  async close() {}
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

    expect(events).toEqual([
      "session.updated",
      "turn.started",
      "tool.call",
      "tool.result",
      "assistant.message",
      "turn.completed",
      "run.completed",
      "session.updated",
    ]);
    await runtime.respondToApproval(session.sessionId, "approval-1", true);
    await runtime.closeSession(session.sessionId);
    await runtime.close();
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

  it("对接 DSH SDK 的 JSON-RPC 初始化、提示词和事件通知", async () => {
    const root = await mkdtemp(join(tmpdir(), "mailpilot-dsh-"));
    const script = join(root, "fake-dsh.mjs");
    await writeFile(
      script,
      `
import readline from "node:readline";
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "fake-dsh" } } }));
  }
  if (request.method === "session/prompt") {
    const sessionId = request.params.sessionId;
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session.event", params: {
      sessionId,
      event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "已完成索引搜索。" }] } } }
    }}));
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session.event", params: {
      sessionId,
      event: { type: "turn/end", data: { reason: { kind: "completed" } } }
    }}));
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "session.status", params: { sessionId, status: "idle" }}));
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { messageId: "message-1" } }));
  }
  if (request.method === "shutdown") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
    process.exit(0);
  }
});
`,
      "utf8",
    );
    const runtime = new DshRuntimeAdapter(
      new JsonLineDshTransport({
        command: process.execPath,
        args: [script],
        cwd: root,
        env: { DSH_HOME: join(root, "dsh-home") },
      }),
    );
    const session = await runtime.createSession({ sessionId: "session-jsonrpc" });
    const events: string[] = [];
    for await (const event of runtime.streamMessage({
      sessionId: session.sessionId,
      text: "搜索续约邮件",
    })) {
      events.push(event.type);
    }
    expect(events).toEqual(["turn.started", "assistant.message", "turn.completed", "run.completed"]);
    await runtime.closeSession(session.sessionId);
  });

  it("通过真实 Pi Agent 映射文本增量、消息和运行完成事件", async () => {
    const runtime = new PiAgentRuntime({
      agentFactory: () =>
        new Agent({
          initialState: {
            model: fakeModel(),
          },
          streamFn: async () => {
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              const message = assistantMessage("已找到 1 封邮件。");
              stream.push({ type: "start", partial: { ...message, content: [] } });
              stream.push({
                type: "text_start",
                contentIndex: 0,
                partial: { ...message, content: [{ type: "text", text: "" }] },
              });
              stream.push({
                type: "text_delta",
                contentIndex: 0,
                delta: "已找到 1 封邮件。",
                partial: message,
              });
              stream.push({ type: "text_end", contentIndex: 0, content: "已找到 1 封邮件。", partial: message });
              stream.push({ type: "done", reason: "stop", message });
            });
            return stream;
          },
        }),
    });
    const session = await runtime.createSession({ sessionId: "pi-session" });
    const events: AgentEvent[] = [];
    for await (const event of runtime.streamMessage({ sessionId: session.sessionId, text: "找邮件" })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "assistant.delta",
      "assistant.message",
      "turn.completed",
      "run.completed",
    ]);
    expect(events.find((event) => event.type === "assistant.message")).toMatchObject({
      text: "已找到 1 封邮件。",
    });
    await runtime.close();
  });

  it("把产品 Session 和可审计事件写入文件存储", async () => {
    const root = await mkdtemp(join(tmpdir(), "mailpilot-session-"));
    const store = new FileSessionStore(root);
    const runtime = new PiAgentRuntime({
      sessionStore: store,
      agentFactory: () =>
        new Agent({
          initialState: { model: fakeModel() },
          streamFn: async () => {
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
              const message = assistantMessage("已读取本地索引。");
              stream.push({ type: "start", partial: { ...message, content: [] } });
              stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [] } });
              stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
              stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
              stream.push({ type: "done", reason: "stop", message });
            });
            return stream;
          },
        }),
    });

    const session = await runtime.createSession({ sessionId: "persistent-session" });
    for await (const _event of runtime.streamMessage({ sessionId: session.sessionId, text: "读取索引" })) {
      // Consume the stream to persist the complete event history.
    }

    expect(await store.get(session.sessionId)).toMatchObject({ status: "idle", turnCount: 1 });
    expect((await store.listEvents(session.sessionId)).map((event) => event.type)).toContain("run.completed");
    await runtime.close();
  });
});

function fakeModel() {
  return {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 1000,
  };
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}
