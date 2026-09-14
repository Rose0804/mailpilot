import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AgentStep } from "@mailpilot/domain";

export type AgentSession = {
  sessionId: string;
  createdAt: string;
  title?: string;
  accountIds?: string[];
};

export type AgentMessage = {
  sessionId: string;
  text: string;
};

export type AgentEvent =
  | {
      type: "session.started";
      session: AgentSession;
    }
  | {
      type: "assistant.delta";
      sessionId: string;
      text: string;
    }
  | {
      type: "assistant.message";
      sessionId: string;
      text: string;
    }
  | {
      type: "tool.call";
      sessionId: string;
      tool: string;
      inputSummary: string;
    }
  | {
      type: "tool.result";
      sessionId: string;
      tool: string;
      outputSummary: string;
      status: "success" | "failed";
    }
  | {
      type: "approval.required";
      sessionId: string;
      approvalId: string;
      summary: string;
    }
  | {
      type: "run.completed";
      sessionId: string;
    }
  | {
      type: "run.failed";
      sessionId: string;
      message: string;
    };

export type DshEvent =
  | { type: "session.started"; sessionId: string; createdAt?: string; title?: string }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.message"; text: string }
  | { type: "tool.call"; tool: string; inputSummary?: string }
  | { type: "tool.result"; tool: string; outputSummary?: string; status?: "success" | "failed" }
  | { type: "approval.required"; approvalId: string; summary: string }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string };

export type DshSessionOptions = {
  sessionId?: string;
  title?: string;
  accountIds?: string[];
};

export type DshTransport = {
  startSession(options: DshSessionOptions): Promise<{ sessionId: string; createdAt?: string }>;
  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
};

export interface AgentRuntime {
  createSession(options?: DshSessionOptions): Promise<AgentSession>;
  streamMessage(message: AgentMessage): AsyncIterable<AgentEvent>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export type SessionEventListener = (event: AgentEvent) => void;

export class SessionEventBridge {
  private readonly listeners = new Map<string, Set<SessionEventListener>>();

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    const sessionListeners = this.listeners.get(sessionId) ?? new Set<SessionEventListener>();
    sessionListeners.add(listener);
    this.listeners.set(sessionId, sessionListeners);
    return () => {
      sessionListeners.delete(listener);
      if (sessionListeners.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish(event: AgentEvent): void {
    const sessionId = event.type === "session.started" ? event.session.sessionId : event.sessionId;
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
}

export class DshRuntimeAdapter implements AgentRuntime {
  readonly events = new SessionEventBridge();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly accountScopes = new Map<string, string[] | undefined>();

  constructor(
    private readonly transport: DshTransport,
  ) {}

  async createSession(
    options: DshSessionOptions = {},
  ): Promise<AgentSession> {
    const started = await this.transport.startSession(options);
    const session: AgentSession = {
      sessionId: started.sessionId,
      createdAt: started.createdAt ?? new Date().toISOString(),
      title: options.title,
      accountIds: options.accountIds,
    };
    this.sessions.set(session.sessionId, session);
    this.accountScopes.set(session.sessionId, options.accountIds);
    this.events.publish({ type: "session.started", session });
    return session;
  }

  async *streamMessage(message: AgentMessage): AsyncIterable<AgentEvent> {
    if (!this.sessions.has(message.sessionId)) {
      throw new Error(`未找到 Agent 会话: ${message.sessionId}`);
    }
    const scopedText = withAccountScope(message.text, this.accountScopes.get(message.sessionId));
    for await (const dshEvent of this.transport.sendMessage(message.sessionId, scopedText)) {
      const event = normalizeEvent(message.sessionId, dshEvent);
      this.events.publish(event);
      yield event;
    }
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`未找到 Agent 会话: ${sessionId}`);
    }
    await this.transport.respondToApproval(sessionId, approvalId, approved);
  }

  async closeSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    await this.transport.closeSession(sessionId);
    this.sessions.delete(sessionId);
    this.accountScopes.delete(sessionId);
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.sessions.clear();
    this.accountScopes.clear();
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
    this.process = spawn(options.command, [
      ...(options.args ?? []),
      ...(options.patches ?? []).flatMap((patch) => ["--patch", patch]),
    ], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
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
    return {
      sessionId,
      createdAt: new Date().toISOString(),
    };
  }

  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent> {
    const queue = new AsyncEventQueue();
    this.queues.set(sessionId, queue);
    void this.prompt(sessionId, text, queue);
    return queue;
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void> {
    void sessionId;
    void approvalId;
    void approved;
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
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    const normalized = normalizeDshSessionEvent(event.params.event, sessionId);
    if (normalized) queue.push(normalized);
  }
}

function normalizeDshSessionEvent(raw: unknown, sessionId: string): DshEvent | undefined {
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
  if (type === "turn/end") {
    const reason = (data.reason ?? {}) as Record<string, unknown>;
    const kind = String(reason.kind ?? "");
    return kind === "error"
      ? { type: "run.failed", message: String(reason.message ?? "DSH 运行失败") }
      : { type: "run.completed" };
  }
  return undefined;
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
    this.flush();
  }

  fail(error: Error): void {
    this.failure = error;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<DshEvent> {
    return {
      next: async () => {
        if (this.failure) throw this.failure;
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<DshEvent>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ done: true, value: undefined });
    }
  }
}

function normalizeEvent(sessionId: string, event: DshEvent): AgentEvent {
  switch (event.type) {
    case "session.started":
      return {
        type: "session.started",
        session: {
          sessionId,
          createdAt: event.createdAt ?? new Date().toISOString(),
          title: event.title,
        },
      };
    case "assistant.delta":
      return { type: "assistant.delta", sessionId, text: event.text };
    case "assistant.message":
      return { type: "assistant.message", sessionId, text: event.text };
    case "tool.call":
      return { type: "tool.call", sessionId, tool: event.tool, inputSummary: event.inputSummary ?? "" };
    case "tool.result":
      return {
        type: "tool.result",
        sessionId,
        tool: event.tool,
        outputSummary: event.outputSummary ?? "",
        status: event.status ?? "success",
      };
    case "approval.required":
      return { type: "approval.required", sessionId, approvalId: event.approvalId, summary: event.summary };
    case "run.completed":
      return { type: "run.completed", sessionId };
    case "run.failed":
      return { type: "run.failed", sessionId, message: event.message };
  }
}

function withAccountScope(text: string, accountIds: string[] | undefined): string {
  if (!accountIds?.length) return text;
  const scope = accountIds.join(", ");
  return [
    `MailPilot scope: only use accountId values [${scope}] for this session.`,
    "Do not infer or switch to another account without asking the user.",
    `User request: ${text}`,
  ].join("\n");
}

export function toAgentStep(event: Extract<AgentEvent, { type: "tool.call" | "tool.result" }>, runId: string): AgentStep {
  return {
    runId,
    tool: event.tool,
    inputSummary: event.type === "tool.call" ? event.inputSummary : "",
    outputSummary: event.type === "tool.result" ? event.outputSummary : "",
    status: event.type === "tool.result" ? event.status : "success",
    createdAt: new Date().toISOString(),
  };
}
