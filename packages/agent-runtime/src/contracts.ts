import type { AgentStep } from "@mailpilot/domain";

export type AgentRuntimeName = "pi" | "dsh";

export type AgentSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  accountIds?: string[];
  runtime: AgentRuntimeName;
  status: "idle" | "running" | "waiting_approval" | "aborted" | "closed";
  turnCount: number;
};

export type CreateSessionInput = {
  sessionId?: string;
  title?: string;
  accountIds?: string[];
};

export type AgentMessage = {
  sessionId: string;
  text: string;
};

export type AgentEvent =
  | { type: "session.started"; session: AgentSession }
  | { type: "session.updated"; session: AgentSession }
  | { type: "turn.started"; sessionId: string; turnId: string; text: string }
  | { type: "assistant.delta"; sessionId: string; turnId?: string; text: string }
  | { type: "assistant.message"; sessionId: string; turnId?: string; text: string }
  | { type: "tool.call"; sessionId: string; turnId?: string; tool: string; inputSummary: string }
  | {
      type: "tool.result";
      sessionId: string;
      turnId?: string;
      tool: string;
      outputSummary: string;
      status: "success" | "failed";
    }
  | { type: "approval.required"; sessionId: string; turnId?: string; approvalId: string; summary: string }
  | { type: "turn.completed"; sessionId: string; turnId: string }
  | { type: "turn.failed"; sessionId: string; turnId: string; message: string }
  | { type: "run.completed"; sessionId: string }
  | { type: "run.failed"; sessionId: string; message: string }
  | { type: "session.aborted"; sessionId: string };

export type AgentRuntimeOptions = {
  sessionStore?: SessionStore;
};

export type SessionStore = {
  get(sessionId: string): Promise<AgentSession | null> | AgentSession | null;
  save(session: AgentSession): Promise<void> | void;
  appendEvent(sessionId: string, event: AgentEvent): Promise<void> | void;
  listEvents(sessionId: string): Promise<AgentEvent[]> | AgentEvent[];
};

export type AgentRuntime = {
  readonly runtimeName: AgentRuntimeName;
  readonly events: SessionEventBridge;
  createSession(input?: CreateSessionInput): Promise<AgentSession>;
  streamMessage(message: AgentMessage): AsyncIterable<AgentEvent>;
  steer(sessionId: string, text: string): Promise<void>;
  followUp(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  listEvents(sessionId: string): Promise<AgentEvent[]>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
};

export type SessionEventListener = (event: AgentEvent) => void;

export function eventSessionId(event: AgentEvent): string {
  return event.type === "session.started" || event.type === "session.updated"
    ? event.session.sessionId
    : event.sessionId;
}

export class SessionEventBridge {
  private readonly listeners = new Map<string, Set<SessionEventListener>>();

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    const values = this.listeners.get(sessionId) ?? new Set<SessionEventListener>();
    values.add(listener);
    this.listeners.set(sessionId, values);
    return () => {
      values.delete(listener);
      if (!values.size) this.listeners.delete(sessionId);
    };
  }

  publish(event: AgentEvent): void {
    for (const listener of this.listeners.get(eventSessionId(event)) ?? []) listener(event);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly events = new Map<string, AgentEvent[]>();

  get(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  save(session: AgentSession): void {
    this.sessions.set(session.sessionId, { ...session });
  }

  appendEvent(sessionId: string, event: AgentEvent): void {
    const values = this.events.get(sessionId) ?? [];
    values.push(event);
    this.events.set(sessionId, values);
  }

  listEvents(sessionId: string): AgentEvent[] {
    return [...(this.events.get(sessionId) ?? [])];
  }
}

export function toAgentStep(
  event: Extract<AgentEvent, { type: "tool.call" | "tool.result" }>,
  runId: string,
): AgentStep {
  return {
    runId,
    tool: event.tool,
    inputSummary: event.type === "tool.call" ? event.inputSummary : "",
    outputSummary: event.type === "tool.result" ? event.outputSummary : "",
    status: event.type === "tool.result" ? event.status : "success",
    createdAt: new Date().toISOString(),
  };
}
