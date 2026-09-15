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
