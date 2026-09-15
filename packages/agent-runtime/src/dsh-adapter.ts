import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  SessionEventBridge,
  type AgentEvent,
  type AgentRuntime,
  type AgentSession,
  type CreateSessionInput,
  InMemorySessionStore,
  type SessionStore,
} from "./contracts.js";

export type DshSessionOptions = CreateSessionInput;

export type DshRuntimeOptions = {
  sessionStore?: SessionStore;
};

export type DshEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.message"; text: string }
  | { type: "tool.call"; tool: string; inputSummary?: string }
  | { type: "tool.result"; tool: string; outputSummary?: string; status?: "success" | "failed" }
  | { type: "approval.required"; approvalId: string; summary: string }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string };

export type DshTransport = {
  startSession(options: DshSessionOptions): Promise<{ sessionId: string; createdAt?: string }>;
  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
};

export class DshRuntimeAdapter implements AgentRuntime {
  readonly runtimeName = "dsh" as const;
  readonly events = new SessionEventBridge();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly accountScopes = new Map<string, string[] | undefined>();
  private readonly store: SessionStore;

  constructor(
    private readonly transport: DshTransport,
    options: DshRuntimeOptions = {},
  ) {
    this.store = options.sessionStore ?? new InMemorySessionStore();
  }

  async createSession(options: DshSessionOptions = {}): Promise<AgentSession> {
    const started = await this.transport.startSession(options);
    const now = new Date().toISOString();
    const session: AgentSession = {
      sessionId: started.sessionId,
      createdAt: started.createdAt ?? now,
      updatedAt: now,
      title: options.title,
      accountIds: options.accountIds,
      runtime: "dsh",
      status: "idle",
      turnCount: 0,
    };
    this.sessions.set(session.sessionId, session);
    this.accountScopes.set(session.sessionId, options.accountIds);
    await this.store.save(session);
    await this.publish({ type: "session.started", session });
    return session;
  }

  async *streamMessage(message: { sessionId: string; text: string }): AsyncIterable<AgentEvent> {
    const session = this.requireSession(message.sessionId);
    const turnId = `turn-${randomUUID().replaceAll("-", "")}`;
    const running = await this.updateSession(session, { status: "running", turnCount: session.turnCount + 1 });
    await this.publish({ type: "session.updated", session: running });
    const started: AgentEvent = {
      type: "turn.started",
      sessionId: session.sessionId,
      turnId,
      text: message.text,
    };
    await this.publish(started);
    yield started;

    try {
      for await (const dshEvent of this.transport.sendMessage(
        message.sessionId,
        withAccountScope(message.text, this.accountScopes.get(message.sessionId)),
      )) {
        const events = normalizeEvents(message.sessionId, turnId, dshEvent);
        for (const event of events) {
          await this.publish(event);
          yield event;
        }
        if (events.some((event) => event.type === "run.completed")) {
          const idle = await this.updateSession(session, { status: "idle" });
          await this.publish({ type: "session.updated", session: idle });
        }
        if (events.some((event) => event.type === "run.failed")) {
          const idle = await this.updateSession(session, { status: "idle" });
          await this.publish({ type: "session.updated", session: idle });
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const failed: AgentEvent = { type: "run.failed", sessionId: message.sessionId, message: text };
      await this.publish(failed);
      yield failed;
      const idle = await this.updateSession(session, { status: "idle" });
      await this.publish({ type: "session.updated", session: idle });
    }
  }

  async steer(): Promise<void> {
    throw new Error("DSH Runtime 当前不支持 steer");
  }

  async followUp(): Promise<void> {
    throw new Error("DSH Runtime 当前不支持 follow-up");
  }

  async abort(): Promise<void> {
    throw new Error("DSH Runtime 当前不支持 abort");
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void> {
    this.requireSession(sessionId);
    await this.transport.respondToApproval(sessionId, approvalId, approved);
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.sessions.get(sessionId) ?? (await this.store.get(sessionId));
  }

  async listEvents(sessionId: string): Promise<AgentEvent[]> {
    return this.store.listEvents(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await this.transport.closeSession(sessionId);
    const closed = await this.updateSession(session, { status: "closed" });
    await this.publish({ type: "session.updated", session: closed });
    this.sessions.delete(sessionId);
    this.accountScopes.delete(sessionId);
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.sessions.clear();
    this.accountScopes.clear();
  }

  private requireSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`未找到 Agent 会话: ${sessionId}`);
    return session;
  }

  private async updateSession(session: AgentSession, patch: Partial<AgentSession>): Promise<AgentSession> {
    const updated = { ...session, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(session.sessionId, updated);
    await this.store.save(updated);
    return updated;
  }

  private async publish(event: AgentEvent): Promise<void> {
    const sessionId = event.type === "session.started" || event.type === "session.updated"
      ? event.session.sessionId
      : event.sessionId;
    await this.store.appendEvent(sessionId, event);
    this.events.publish(event);
  }
}

export type JsonLineTransportOptions = {
  command: string;
  args?: string[];
  patches?: string[];
  cwd?: string;
  env?: Record<string, string>;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  maxTokens?: number;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: "initialize" | "session/prompt" | "shutdown";
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: "session.event" | "session.status" | "subagent.started" | "subagent.finished";
  params: Record<string, unknown>;
};

export class JsonLineDshTransport implements DshTransport {
  private readonly options: JsonLineTransportOptions;
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly queues = new Map<string, AsyncEventQueue>();
  private readonly pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly sessions = new Set<string>();
  private nextRequestId = 1;
  private initialized: Promise<void> | undefined;
  private closed = false;

  constructor(options: JsonLineTransportOptions) {
    this.options = options;
    this.process = spawn(
      options.command,
      [...(options.args ?? []), ...(options.patches ?? []).flatMap((patch) => ["--patch", patch])],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk) => {
      process.stderr.write(`[mailpilot:dsh] ${String(chunk)}`);
    });
    this.process.on("exit", (code) => {
      const message = `DSH 进程已退出，状态码: ${code ?? "unknown"}`;
      for (const pending of this.pending.values()) pending.reject(new Error(message));
      this.pending.clear();
      for (const queue of this.queues.values()) queue.fail(new Error(message));
      this.queues.clear();
    });
  }

  async startSession(options: DshSessionOptions): Promise<{ sessionId: string; createdAt?: string }> {
    await this.initializeRuntime(options);
    const sessionId = options.sessionId ?? `session-${randomUUID().replaceAll("-", "")}`;
    this.sessions.add(sessionId);
    return { sessionId, createdAt: new Date().toISOString() };
  }

  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent> {
    const queue = new AsyncEventQueue();
    this.queues.set(sessionId, queue);
    void this.prompt(sessionId, text, queue);
    return queue;
  }

  async respondToApproval(): Promise<void> {
    throw new Error("DSH SDK 当前没有公开的审批回传方法，审批由 MailPilot Policy 处理");
  }

  async closeSession(sessionId: string): Promise<void> {
    this.queues.get(sessionId)?.finish();
    this.queues.delete(sessionId);
    this.sessions.delete(sessionId);
    if (this.sessions.size > 0 || this.closed) return;
    await this.request("shutdown").catch(() => undefined);
    this.closed = true;
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    for (const queue of this.queues.values()) queue.finish();
    this.queues.clear();
    this.sessions.clear();
    await this.request("shutdown").catch(() => undefined);
    this.closed = true;
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }

  private async initializeRuntime(options: DshSessionOptions): Promise<void> {
    this.initialized ??= (async () => {
      await this.request("initialize", {
        cwd: resolve(this.options.cwd ?? process.cwd()),
        provider: this.options.provider ?? "deepseek-official",
        model: this.options.model ?? "deepseek-v4-flash",
        ...(this.options.reasoningEffort ? { reasoningEffort: this.options.reasoningEffort } : {}),
        ...(this.options.maxTokens ? { maxTokens: this.options.maxTokens } : {}),
      });
      void options.title;
    })();
    await this.initialized;
  }

  private async prompt(sessionId: string, text: string, queue: AsyncEventQueue): Promise<void> {
    try {
      await this.initializeRuntime({});
      await this.request("session/prompt", {
        sessionId,
        contentBlocks: [{ type: "text", text }],
      });
    } catch (error) {
      queue.fail(error instanceof Error ? error : new Error(String(error)));
      this.queues.delete(sessionId);
    }
  }

  private request(method: JsonRpcRequest["method"], params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("DSH transport 已关闭"));
    const id = `mailpilot-${this.nextRequestId++}`;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    const result = new Promise<unknown>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
    });
    try {
      this.write(request);
    } catch (error) {
      this.pending.delete(id);
      return Promise.reject(error);
    }
    return result;
  }

  private write(command: JsonRpcRequest): void {
    if (!this.process.stdin.writable) throw new Error("DSH 进程 stdin 不可写");
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private handleLine(line: string): void {
    let event: JsonRpcResponse | JsonRpcNotification;
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      return;
    }
    if ("id" in event) {
      const pending = this.pending.get(event.id);
      if (!pending) return;
      this.pending.delete(event.id);
      if (event.error) pending.reject(new Error(`DSH JSON-RPC ${event.error.code}: ${event.error.message}`));
      else pending.resolve(event.result);
      return;
    }
    if (event.method === "session.status") {
      const sessionId = String(event.params.sessionId ?? "");
      if (event.params.status === "idle") {
        this.queues.get(sessionId)?.finish();
        this.queues.delete(sessionId);
      }
      return;
    }
    if (event.method !== "session.event") return;
    const sessionId = String(event.params.sessionId ?? "");
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    const normalized = normalizeDshSessionEvent(event.params.event);
    if (normalized) queue.push(normalized);
  }
}

function normalizeDshSessionEvent(raw: unknown): DshEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const event = raw as { type?: unknown; data?: unknown };
  const type = String(event.type ?? "");
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (type === "assistant/message") {
    const message = (data.message ?? data) as { content?: unknown };
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((block): block is { type: "text"; text: string } => {
        return (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        );
      })
      .map((block) => block.text)
      .join("");
    return { type: "assistant.message", text };
  }
  if (type === "assistant/delta") return { type: "assistant.delta", text: String(data.text ?? "") };
  if (type === "tool/call" || type === "tool/result") {
    const toolData = (data.tool ?? data) as Record<string, unknown>;
    if (type === "tool/call") {
      return {
        type: "tool.call",
        tool: String(toolData.name ?? toolData.tool ?? "unknown"),
        inputSummary: JSON.stringify(toolData.input ?? toolData.arguments ?? {}),
      };
    }
    return {
      type: "tool.result",
      tool: String(toolData.name ?? toolData.tool ?? "unknown"),
      outputSummary: JSON.stringify(toolData.output ?? toolData.result ?? {}),
      status: "success",
    };
  }
  if (type === "approval/required") {
    return {
      type: "approval.required",
      approvalId: String(data.approvalId ?? ""),
      summary: String(data.summary ?? "需要审批的邮箱操作"),
    };
  }
  if (type === "turn/end") {
    const reason = (data.reason ?? {}) as Record<string, unknown>;
    const kind = String(reason.kind ?? "");
    return kind === "error"
      ? { type: "run.failed", message: String(reason.message ?? "DSH 运行失败") }
      : { type: "run.completed" };
  }
  return undefined;
}

function normalizeEvents(sessionId: string, turnId: string, event: DshEvent): AgentEvent[] {
  switch (event.type) {
    case "assistant.delta":
      return [{ type: "assistant.delta", sessionId, turnId, text: event.text }];
    case "assistant.message":
      return [{ type: "assistant.message", sessionId, turnId, text: event.text }];
    case "tool.call":
      return [{ type: "tool.call", sessionId, turnId, tool: event.tool, inputSummary: event.inputSummary ?? "" }];
    case "tool.result":
      return [{
          type: "tool.result",
          sessionId,
          turnId,
          tool: event.tool,
          outputSummary: event.outputSummary ?? "",
          status: event.status ?? "success",
        }];
    case "approval.required":
      return [{
          type: "approval.required",
          sessionId,
          turnId,
          approvalId: event.approvalId,
          summary: event.summary,
        }];
    case "run.completed":
      return [
        { type: "turn.completed", sessionId, turnId },
        { type: "run.completed", sessionId },
      ];
    case "run.failed":
      return [
        { type: "turn.failed", sessionId, turnId, message: event.message },
        { type: "run.failed", sessionId, message: event.message },
      ];
  }
}

function withAccountScope(text: string, accountIds: string[] | undefined): string {
  if (!accountIds?.length) return text;
  return [
    `MailPilot scope: only use accountId values [${accountIds.join(", ")}] for this session.`,
    "Do not infer or switch to another account without asking the user.",
    `User request: ${text}`,
  ].join("\n");
}

class AsyncEventQueue implements AsyncIterable<DshEvent> {
  private readonly values: DshEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<DshEvent>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | undefined;

  push(value: DshEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  finish(): void {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!.resolve({ done: true, value: undefined });
  }

  fail(error: Error): void {
    this.failure = error;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<DshEvent> {
    return {
      next: async () => {
        if (this.failure) throw this.failure;
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}
