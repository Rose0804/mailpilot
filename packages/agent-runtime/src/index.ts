import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
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
  title?: string;
  accountIds?: string[];
  systemPrompt?: string;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
};

export type DshTransport = {
  startSession(options: DshSessionOptions): Promise<{ sessionId: string; createdAt?: string }>;
  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
};

export interface AgentRuntime {
  createSession(options?: Omit<DshSessionOptions, "systemPrompt" | "mcpServers">): Promise<AgentSession>;
  streamMessage(message: AgentMessage): AsyncIterable<AgentEvent>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
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

  constructor(
    private readonly transport: DshTransport,
    private readonly options: Pick<DshSessionOptions, "systemPrompt" | "mcpServers"> = {},
  ) {}

  async createSession(
    options: Omit<DshSessionOptions, "systemPrompt" | "mcpServers"> = {},
  ): Promise<AgentSession> {
    const started = await this.transport.startSession({
      ...this.options,
      ...options,
    });
    const session: AgentSession = {
      sessionId: started.sessionId,
      createdAt: started.createdAt ?? new Date().toISOString(),
      title: options.title,
      accountIds: options.accountIds,
    };
    this.sessions.set(session.sessionId, session);
    this.events.publish({ type: "session.started", session });
    return session;
  }

  async *streamMessage(message: AgentMessage): AsyncIterable<AgentEvent> {
    if (!this.sessions.has(message.sessionId)) {
      throw new Error(`未找到 Agent 会话: ${message.sessionId}`);
    }
    for await (const dshEvent of this.transport.sendMessage(message.sessionId, message.text)) {
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
  }
}

type JsonLineTransportOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type JsonLineCommand = {
  type: "session.start" | "message.send" | "approval.respond" | "session.close";
  sessionId?: string;
  text?: string;
  approvalId?: string;
  approved?: boolean;
  options?: DshSessionOptions;
};

export class JsonLineDshTransport implements DshTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly queues = new Map<string, AsyncEventQueue>();
  private readonly pendingSessions = new Map<string, (value: { sessionId: string; createdAt?: string }) => void>();

  constructor(options: JsonLineTransportOptions) {
    this.process = spawn(options.command, options.args ?? [], {
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
      for (const queue of this.queues.values()) queue.fail(new Error(message));
      this.queues.clear();
    });
  }

  async startSession(options: DshSessionOptions): Promise<{ sessionId: string; createdAt?: string }> {
    const requestId = randomUUID();
    const sessionId = `pending:${requestId}`;
    const result = new Promise<{ sessionId: string; createdAt?: string }>((resolve) => {
      this.pendingSessions.set(requestId, resolve);
    });
    this.write({ type: "session.start", sessionId: requestId, options });
    return result;
  }

  sendMessage(sessionId: string, text: string): AsyncIterable<DshEvent> {
    const queue = new AsyncEventQueue();
    this.queues.set(sessionId, queue);
    this.write({ type: "message.send", sessionId, text });
    return queue;
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void> {
    this.write({ type: "approval.respond", sessionId, approvalId, approved });
  }

  async closeSession(sessionId: string): Promise<void> {
    this.write({ type: "session.close", sessionId });
    this.queues.get(sessionId)?.finish();
    this.queues.delete(sessionId);
    if (this.queues.size === 0) {
      this.lines.close();
      this.process.kill();
    }
  }

  private write(command: JsonLineCommand): void {
    if (!this.process.stdin.writable) throw new Error("DSH 进程 stdin 不可写");
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private handleLine(line: string): void {
    let event: DshEvent & { requestId?: string; sessionId?: string };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      return;
    }
    if (event.type === "session.started" && event.requestId) {
      this.pendingSessions.get(event.requestId)?.({
        sessionId: event.sessionId ?? event.requestId,
        createdAt: event.createdAt,
      });
      this.pendingSessions.delete(event.requestId);
      return;
    }
    if (!event.sessionId) return;
    const queue = this.queues.get(event.sessionId);
    if (!queue) return;
    queue.push(event);
    if (event.type === "run.completed" || event.type === "run.failed") {
      queue.finish();
      this.queues.delete(event.sessionId);
    }
  }
}

class AsyncEventQueue implements AsyncIterable<DshEvent> {
  private readonly values: DshEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<DshEvent>) => void> = [];
  private closed = false;
  private failure: Error | undefined;

  push(value: DshEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  finish(): void {
    this.closed = true;
    this.flush();
  }

  fail(error: Error): void {
    this.failure = error;
    this.closed = true;
    this.flush();
  }

  [Symbol.asyncIterator](): AsyncIterator<DshEvent> {
    return {
      next: async () => {
        if (this.failure) throw this.failure;
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<DshEvent>>((resolve) => this.waiters.push(resolve));
      },
    };
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) waiter({ done: true, value: undefined });
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
