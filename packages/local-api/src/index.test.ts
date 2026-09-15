import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MailDatabase } from "@mailpilot/database";
import type { MailReader } from "@mailpilot/apple-mail-connector";
import { SessionEventBridge, type AgentEvent, type AgentRuntime } from "@mailpilot/agent-runtime";
import type { AccountRef } from "@mailpilot/domain";
import type { MailSyncService } from "@mailpilot/sync";
import { createLocalApiServer, MailPilotLocalApi } from "./index.js";

const account: AccountRef = {
  accountId: "work",
  provider: "apple-mail",
  email: "siyuan@loomos.ai",
  displayName: "Work",
};

describe("MailPilot local API", () => {
  it("返回本地索引快照且不泄露附件路径", () => {
    const database = new MailDatabase();
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-1" },
      sender: "Maya",
      subject: "Renewal",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review",
      body: "Agreement",
      isRead: false,
    });
    database.upsertAttachment({
      id: "a-1",
      message: { account, mailboxId: "INBOX", messageId: "m-1" },
      filename: "agreement.pdf",
      mimeType: "application/pdf",
      size: 20,
      localPath: "/private/secret/agreement.pdf",
      indexStatus: "pending",
    });
    const reader = {} as MailReader;
    const sync = {} as MailSyncService;
    const api = new MailPilotLocalApi({ database, reader, sync });

    const snapshot = api.getSnapshot("renewal");
    expect(snapshot.messages[0].subject).toBe("Renewal");
    expect(api.getAttachment("work", "a-1")).toMatchObject({ filename: "agreement.pdf" });
    database.close();
  });

  it("读取附件解析文本时只使用数据库中的受控路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "mailpilot-api-"));
    const extractedTextPath = join(root, "extracted.txt");
    await writeFile(extractedTextPath, "UNTRUSTED_ATTACHMENT_TEXT\nNet 45", "utf8");
    const database = new MailDatabase();
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-1" },
      sender: "Maya",
      subject: "Renewal",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review",
      body: "Agreement",
      isRead: false,
    });
    database.upsertAttachment({
      id: "a-1",
      message: { account, mailboxId: "INBOX", messageId: "m-1" },
      filename: "agreement.pdf",
      mimeType: "application/pdf",
      size: 20,
      extractedTextPath,
      indexStatus: "ready",
    });
    const api = new MailPilotLocalApi({
      database,
      reader: {} as MailReader,
      sync: {} as MailSyncService,
    });

    await expect(api.readAttachmentText("work", "a-1")).resolves.toContain("Net 45");
    await expect(api.readAttachmentText("other", "a-1")).resolves.toBeNull();
    database.close();
  });

  it("通过 Runtime 返回 Agent 会话事件", async () => {
    const database = new MailDatabase();
    const runtime: AgentRuntime = {
      runtimeName: "pi",
      events: new SessionEventBridge(),
      createSession: async () => ({
        sessionId: "s-1",
        createdAt: "2026-09-14T12:00:00Z",
        updatedAt: "2026-09-14T12:00:00Z",
        runtime: "pi",
        status: "idle",
        turnCount: 0,
      }),
      async *streamMessage(): AsyncIterable<AgentEvent> {
        yield { type: "assistant.message", sessionId: "s-1", text: "找到 1 封邮件。" };
        yield { type: "run.completed", sessionId: "s-1" };
      },
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      respondToApproval: async () => undefined,
      getSession: async () => null,
      listEvents: async () => [],
      closeSession: async () => undefined,
      close: async () => undefined,
    };
    const api = new MailPilotLocalApi({
      database,
      reader: {} as MailReader,
      sync: {} as MailSyncService,
      runtime,
    });
    const events = await api.sendAgentMessage("s-1", "找续约邮件");
    expect(events.map((event) => event.type)).toEqual(["assistant.message", "run.completed"]);
    database.close();
  });

  it.skipIf(process.env.MAILPILOT_NETWORK_TEST !== "1")("通过 localhost HTTP 暴露健康检查和快照", async () => {
    const database = new MailDatabase();
    const api = new MailPilotLocalApi({
      database,
      reader: {} as MailReader,
      sync: {} as MailSyncService,
    });
    const server = createLocalApiServer(api, 0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    try {
      const health = await fetch(`http://127.0.0.1:${address.port}/health`);
      const snapshot = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true });
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ accounts: [], messages: [] });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    }
  });
});
