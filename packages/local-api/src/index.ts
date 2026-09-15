import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { AgentRuntime, AgentSession, AgentEvent } from "@mailpilot/agent-runtime";
import type { MailReader } from "@mailpilot/apple-mail-connector";
import type { MailDatabase } from "@mailpilot/database";
import type { AccountRef, Attachment, MailMessage, MessageRef } from "@mailpilot/domain";
import type { MailSyncService } from "@mailpilot/sync";

export type LocalApiOptions = {
  database: MailDatabase;
  reader: MailReader;
  sync: MailSyncService;
  runtime?: AgentRuntime;
};

export type MailSnapshot = {
  accounts: AccountRef[];
  mailboxes: Array<{
    accountId: string;
    mailboxId: string;
    name: string;
    unreadCount: number;
  }>;
  messages: Array<ReturnType<typeof serializeMessage>>;
  generatedAt: string;
};

export class MailPilotLocalApi {
  constructor(private readonly options: LocalApiOptions) {}

  getSnapshot(query = ""): MailSnapshot {
    const accounts = this.options.database.listAccounts();
    const mailboxes = accounts.flatMap((account) =>
      this.options.database.listMailboxes(account.accountId).map((mailbox) => ({
        accountId: account.accountId,
        mailboxId: mailbox.mailboxId,
        name: mailbox.name,
        unreadCount: mailbox.unreadCount,
      })),
    );
    const messages = this.options.database
      .searchMessages({ query, limit: 100 })
      .map((message) => serializeMessage(message));
    return {
      accounts,
      mailboxes,
      messages,
      generatedAt: new Date().toISOString(),
    };
  }

  getMessage(accountId: string, mailboxId: string, messageId: string): {
    message: MailMessage;
    attachments: Attachment[];
  } | null {
    const account = this.options.database.listAccounts().find((item) => item.accountId === accountId);
    if (!account) return null;
    const ref: MessageRef = { account, mailboxId, messageId };
    const message = this.options.database.getMessage(ref);
    if (!message) return null;
    return { message, attachments: this.options.database.listAttachments(ref) };
  }

  getAttachment(accountId: string, attachmentId: string): Attachment | null {
    return this.options.database.getAttachment(accountId, attachmentId);
  }

  async readAttachmentText(accountId: string, attachmentId: string): Promise<string | null> {
    const attachment = this.getAttachment(accountId, attachmentId);
    if (!attachment?.extractedTextPath) return null;
    return readFile(attachment.extractedTextPath, "utf8");
  }

  syncAll() {
    return this.options.sync.syncAll();
  }

  async createAgentSession(input: { title?: string; accountIds?: string[] }): Promise<AgentSession> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    return this.options.runtime.createSession(input);
  }

  async sendAgentMessage(sessionId: string, text: string): Promise<AgentEvent[]> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    const events: AgentEvent[] = [];
    for await (const event of this.options.runtime.streamMessage({ sessionId, text })) {
      events.push(event);
    }
    return events;
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    await this.options.runtime.respondToApproval(sessionId, approvalId, approved);
  }

  async getAgentSession(sessionId: string): Promise<AgentSession | null> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    return this.options.runtime.getSession(sessionId);
  }

  async listAgentEvents(sessionId: string): Promise<AgentEvent[]> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    return this.options.runtime.listEvents(sessionId);
  }

  async steerAgent(sessionId: string, text: string): Promise<void> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    await this.options.runtime.steer(sessionId, text);
  }

  async followUpAgent(sessionId: string, text: string): Promise<void> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    await this.options.runtime.followUp(sessionId, text);
  }

  async abortAgent(sessionId: string): Promise<void> {
    if (!this.options.runtime) throw new Error("AGENT_RUNTIME_UNAVAILABLE");
    await this.options.runtime.abort(sessionId);
  }

  getAgentRuntimeName(): string {
    return this.options.runtime?.runtimeName ?? "none";
  }
}

export function createLocalApiServer(api: MailPilotLocalApi, port = 3100): Server {
  return createServer(async (request, response) => {
    await handleRequest(api, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "本地 API 请求失败";
      const status = message === "AGENT_RUNTIME_UNAVAILABLE" ? 503 : 400;
      sendJson(response, status, { error: message });
    });
  }).listen(port, "127.0.0.1");
}

async function handleRequest(
  api: MailPilotLocalApi,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const origin = request.headers.origin;
  if (
    origin === "http://localhost:5173" ||
    origin === "http://127.0.0.1:5173" ||
    origin === "tauri://localhost" ||
    origin === "http://tauri.localhost" ||
    origin === "https://tauri.localhost"
  ) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "mailpilot-local-api" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    sendJson(response, 200, api.getSnapshot(url.searchParams.get("query") ?? ""));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync") {
    sendJson(response, 200, { results: await api.syncAll() });
    return;
  }
  if (request.method === "GET" && parts.length === 5 && parts[0] === "api" && parts[1] === "messages") {
    const value = api.getMessage(decodeSegment(parts[2]), decodeSegment(parts[3]), decodeSegment(parts[4]));
    sendJson(
      response,
      value ? 200 : 404,
      value
        ? {
            message: serializeMessage(value.message, true),
            attachments: value.attachments.map(publicAttachment),
          }
        : { error: "MESSAGE_NOT_FOUND" },
    );
    return;
  }
  if (request.method === "GET" && parts.length === 4 && parts[0] === "api" && parts[1] === "attachments") {
    const value = api.getAttachment(decodeSegment(parts[2]), decodeSegment(parts[3]));
    sendJson(response, value ? 200 : 404, value ? publicAttachment(value) : { error: "ATTACHMENT_NOT_FOUND" });
    return;
  }
  if (
    request.method === "GET" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "attachments" &&
    parts[4] === "text"
  ) {
    const text = await api.readAttachmentText(decodeSegment(parts[2]), decodeSegment(parts[3]));
    if (text === null) {
      sendJson(response, 404, { error: "ATTACHMENT_TEXT_NOT_READY" });
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(text);
    return;
  }
  if (request.method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "agent" && parts[2] === "sessions") {
    const body = await readJson(request);
    sendJson(response, 201, { session: await api.createAgentSession(body) });
    return;
  }
  if (
    request.method === "GET" &&
    parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions"
  ) {
    const sessionId = decodeSegment(parts[3]);
    const session = await api.getAgentSession(sessionId);
    sendJson(response, session ? 200 : 404, session ? { session } : { error: "AGENT_SESSION_NOT_FOUND" });
    return;
  }
  if (
    request.method === "GET" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions" &&
    parts[4] === "events"
  ) {
    sendJson(response, 200, { events: await api.listAgentEvents(decodeSegment(parts[3])) });
    return;
  }
  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions" &&
    parts[4] === "messages"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, { events: await api.sendAgentMessage(decodeSegment(parts[3]), String(body.text ?? "")) });
    return;
  }
  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions" &&
    (parts[4] === "steer" || parts[4] === "follow-up")
  ) {
    const body = await readJson(request);
    const sessionId = decodeSegment(parts[3]);
    const text = String(body.text ?? "");
    if (!text.trim()) throw new Error("Agent 消息不能为空");
    if (parts[4] === "steer") await api.steerAgent(sessionId, text);
    else await api.followUpAgent(sessionId, text);
    sendJson(response, 202, { ok: true });
    return;
  }
  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions" &&
    parts[4] === "abort"
  ) {
    await api.abortAgent(decodeSegment(parts[3]));
    sendJson(response, 202, { ok: true });
    return;
  }
  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "agent" &&
    parts[2] === "sessions" &&
    parts[4] === "approval"
  ) {
    const body = await readJson(request);
    await api.respondToApproval(decodeSegment(parts[3]), String(body.approvalId ?? ""), Boolean(body.approved));
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "NOT_FOUND" });
}

function serializeMessage(message: MailMessage, includeBody = false) {
  return {
    accountId: message.ref.account.accountId,
    mailboxId: message.ref.mailboxId,
    messageId: message.ref.messageId,
    threadId: message.ref.threadId,
    sender: message.sender,
    subject: message.subject,
    receivedAt: message.receivedAt,
    preview: message.preview,
    isRead: message.isRead,
    ...(includeBody && message.body !== undefined ? { body: message.body } : {}),
  };
}

function publicAttachment(attachment: Attachment): Omit<Attachment, "localPath" | "extractedTextPath" | "previewPath"> {
  const { localPath: _localPath, extractedTextPath: _extractedTextPath, previewPath: _previewPath, ...value } =
    attachment;
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1_000_000) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("路径参数不是有效的 URL 编码");
  }
}
