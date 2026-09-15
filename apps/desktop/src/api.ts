export type ApiAccount = {
  accountId: string;
  provider: string;
  email: string;
  displayName: string;
};

export type ApiMessage = {
  accountId: string;
  mailboxId: string;
  messageId: string;
  threadId?: string;
  sender: string;
  subject: string;
  receivedAt: string;
  preview: string;
  isRead: boolean;
};

export type ApiAttachment = {
  id: string;
  message: {
    account: ApiAccount;
    mailboxId: string;
    messageId: string;
    threadId?: string;
  };
  filename: string;
  mimeType: string;
  size: number;
  contentHash?: string;
  indexStatus: "pending" | "ready" | "failed";
};

export type ApiSnapshot = {
  accounts: ApiAccount[];
  mailboxes: Array<{
    accountId: string;
    mailboxId: string;
    name: string;
    unreadCount: number;
  }>;
  messages: ApiMessage[];
  generatedAt: string;
};

export type ApiMessageDetails = {
  message: ApiMessage & { body?: string };
  attachments: ApiAttachment[];
};

export type ApiPlanningSource = {
  accountId: string;
  mailboxId: string;
  messageId: string;
  evidence: string;
};

export type ApiMailEvent = {
  eventId: string;
  kind: "meeting" | "deadline" | "travel" | "reminder" | "commitment";
  title: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  timezone?: string;
  location?: string;
  description?: string;
  attendees: string[];
  confidence: number;
  status: "proposed" | "confirmed" | "dismissed";
  sources: ApiPlanningSource[];
  createdAt: string;
  updatedAt: string;
};

export type ApiOrchestrationTask = {
  taskId: string;
  title: string;
  description?: string;
  status: "planned" | "in_progress" | "blocked" | "done" | "dismissed";
  priority: "low" | "normal" | "high" | "urgent";
  dueAt?: string;
  estimatedMinutes?: number;
  sourceEventIds: string[];
  sourceRefs: ApiPlanningSource[];
  dependencyIds: string[];
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApiScheduleBlock = {
  blockId: string;
  sourceType: "event" | "task";
  sourceId: string;
  title: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  accountIds: string[];
  status: string;
  conflictIds: string[];
};

export type ApiScheduleConflict = {
  conflictId: string;
  blockIds: string[];
  title: string;
};

export type ApiScheduleOverview = {
  events: ApiMailEvent[];
  tasks: ApiOrchestrationTask[];
  blocks: ApiScheduleBlock[];
  conflicts: ApiScheduleConflict[];
  generatedAt: string;
};

export type ApiAgentEvent = {
  type:
    | "session.started"
    | "session.updated"
    | "turn.started"
    | "assistant.delta"
    | "assistant.message"
    | "tool.call"
    | "tool.result"
    | "approval.required"
    | "turn.completed"
    | "turn.failed"
    | "run.completed"
    | "run.failed"
    | "session.aborted";
  session?: ApiAgentSession;
  sessionId?: string;
  turnId?: string;
  text?: string;
  tool?: string;
  inputSummary?: string;
  outputSummary?: string;
  status?: "success" | "failed";
  approvalId?: string;
  summary?: string;
  message?: string;
};

export type ApiAgentSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  accountIds?: string[];
  runtime: "pi" | "dsh";
  status: "idle" | "running" | "waiting_approval" | "aborted" | "closed";
  turnCount: number;
};

const apiBaseUrl = (import.meta.env.VITE_MAILPILOT_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

export function attachmentTextUrl(accountId: string, attachmentId: string): string {
  return `${apiBaseUrl}/api/attachments/${encodeURIComponent(accountId)}/${encodeURIComponent(attachmentId)}/text`;
}

export async function getSnapshot(query = ""): Promise<ApiSnapshot> {
  return request<ApiSnapshot>(`/api/snapshot?query=${encodeURIComponent(query)}`);
}

export async function getMessage(
  accountId: string,
  mailboxId: string,
  messageId: string,
): Promise<ApiMessageDetails> {
  return request<ApiMessageDetails>(
    `/api/messages/${encodeURIComponent(accountId)}/${encodeURIComponent(mailboxId)}/${encodeURIComponent(messageId)}`,
  );
}

export async function syncMail(): Promise<void> {
  await request<{ results: unknown[] }>("/api/sync", { method: "POST" });
}

export async function getPlanningOverview(input: {
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<ApiScheduleOverview> {
  const params = new URLSearchParams();
  if (input.accountIds?.length) params.set("accountIds", input.accountIds.join(","));
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  const query = params.toString();
  return request<ApiScheduleOverview>(`/api/planning/overview${query ? `?${query}` : ""}`);
}

export async function getPlanningEvents(input: {
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<ApiMailEvent[]> {
  const params = new URLSearchParams();
  if (input.accountIds?.length) params.set("accountIds", input.accountIds.join(","));
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  const query = params.toString();
  const response = await request<{ events: ApiMailEvent[] }>(`/api/planning/events${query ? `?${query}` : ""}`);
  return response.events;
}

export async function getPlanningTasks(input: {
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<ApiOrchestrationTask[]> {
  const params = new URLSearchParams();
  if (input.accountIds?.length) params.set("accountIds", input.accountIds.join(","));
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  const query = params.toString();
  const response = await request<{ tasks: ApiOrchestrationTask[] }>(`/api/planning/tasks${query ? `?${query}` : ""}`);
  return response.tasks;
}

export async function createAgentSession(input: {
  title?: string;
  accountIds?: string[];
}): Promise<ApiAgentSession> {
  const response = await request<{ session: ApiAgentSession }>("/api/agent/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.session;
}

export async function sendAgentMessage(sessionId: string, text: string): Promise<ApiAgentEvent[]> {
  const response = await request<{ events: ApiAgentEvent[] }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
  return response.events;
}

export async function getAgentSession(sessionId: string): Promise<ApiAgentSession> {
  const response = await request<{ session: ApiAgentSession }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
  );
  return response.session;
}

export async function getAgentEvents(sessionId: string): Promise<ApiAgentEvent[]> {
  const response = await request<{ events: ApiAgentEvent[] }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/events`,
  );
  return response.events;
}

export async function steerAgent(sessionId: string, text: string): Promise<void> {
  await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function followUpAgent(sessionId: string, text: string): Promise<void> {
  await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/follow-up`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function abortAgent(sessionId: string): Promise<void> {
  await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/abort`, {
    method: "POST",
  });
}

export async function respondToApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
): Promise<void> {
  await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/approval`, {
    method: "POST",
    body: JSON.stringify({ approvalId, approved }),
  });
}

export async function checkApi(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `MailPilot API 请求失败: ${response.status}`);
  }
  return (await response.json()) as T;
}
