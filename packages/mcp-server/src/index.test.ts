import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MailDatabase } from "@mailpilot/database";
import type { AccountRef } from "@mailpilot/domain";
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import {
  createDatabaseQueryService,
  createMailPilotAgentTools,
  createMailPilotMcpServer,
} from "./index.js";

const account: AccountRef = {
  accountId: "work",
  provider: "apple-mail",
  email: "siyuan@loomos.ai",
  displayName: "Work",
};

const personalAccount: AccountRef = {
  accountId: "personal",
  provider: "gmail",
  email: "private@example.com",
  displayName: "Personal",
};

describe("MailPilot MCP facade", () => {
  it("注册只读工具和稳定邮件资源", () => {
    const database = new MailDatabase();
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-1" },
      sender: "Maya",
      subject: "Renewal terms",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review the agreement",
      body: "Payment schedule changed",
      isRead: false,
    });

    const server = createMailPilotMcpServer(createDatabaseQueryService(database));
    expect(server).toBeDefined();
    expect(database.searchMessages({ query: "renewal" })[0].ref.account.accountId).toBe("work");
    database.close();
  });

  it("通过 MCP JSON-RPC 列出工具并调用本地搜索", async () => {
    const database = new MailDatabase();
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-1" },
      sender: "Maya",
      subject: "Renewal terms",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review the agreement",
      body: "Payment schedule changed",
      isRead: false,
    });

    const server = createMailPilotMcpServer(createDatabaseQueryService(database));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const responses = new Map<number, Promise<unknown>>();
    let resolveResponse: ((value: unknown) => void) | undefined;
    clientTransport.onmessage = (message) => {
      if ("id" in message && typeof message.id === "number") {
        resolveResponse?.(message);
        resolveResponse = undefined;
      }
    };
    const request = async (id: number, method: string, params?: Record<string, unknown>) => {
      const response = new Promise<unknown>((resolve) => {
        resolveResponse = resolve;
      });
      responses.set(id, response);
      await clientTransport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
      return response;
    };

    await server.connect(serverTransport);
    await clientTransport.start();
    await request(1, "initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mailpilot-test", version: "0.1.0" },
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const toolList = (await request(2, "tools/list")) as {
      result: { tools: Array<{ name: string }> };
    };
    const searchResponse = (await request(3, "tools/call", {
      name: "search_messages",
      arguments: { query: "renewal", accountIds: ["work"] },
    })) as {
      result: { content: Array<{ text: string }> };
    };
    const searchResult = JSON.parse(searchResponse.result.content[0].text) as MailMessageResult[];

    expect(toolList.result.tools.map((tool) => tool.name)).toContain("search_messages");
    expect(toolList.result.tools.map((tool) => tool.name)).toContain("get_attachment_text");
    expect(searchResult[0].ref.messageId).toBe("m-1");

    await clientTransport.close();
    await server.close();
    database.close();
  });

  it("把同一套查询能力暴露为 Pi 原生工具并强制账号隔离", async () => {
    const root = await mkdtemp(join(tmpdir(), "mailpilot-tools-"));
    const extractedTextPath = join(root, "agreement.txt");
    await writeFile(extractedTextPath, "Net 45 payment terms", "utf8");
    const database = new MailDatabase();
    database.upsertMessage({
      ref: { account, mailboxId: "INBOX", messageId: "m-work" },
      sender: "Maya",
      subject: "Work renewal",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Work agreement",
      body: "Agreement",
      isRead: false,
    });
    database.upsertMessage({
      ref: { account: personalAccount, mailboxId: "INBOX", messageId: "m-personal" },
      sender: "Store",
      subject: "Personal renewal",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Personal receipt",
      body: "Receipt",
      isRead: false,
    });
    database.upsertAttachment({
      id: "a-work",
      message: { account, mailboxId: "INBOX", messageId: "m-work" },
      filename: "agreement.txt",
      mimeType: "text/plain",
      size: 22,
      extractedTextPath,
      indexStatus: "ready",
    });

    const tools = createMailPilotAgentTools(createDatabaseQueryService(database), ["work"]);
    const search = tools.find((tool) => tool.name === "search_messages");
    const attachmentText = tools.find((tool) => tool.name === "get_attachment_text");
    if (!search || !attachmentText) throw new Error("测试工具未注册");

    const searchResult = await search.execute("call-search", { query: "renewal" });
    expect(JSON.parse(textContent(searchResult))).toHaveLength(1);
    await expect(
      search.execute("call-out-of-scope", { accountIds: ["personal"], query: "renewal" }),
    ).rejects.toThrow("账号作用域");

    const textResult = await attachmentText.execute("call-attachment", {
      accountId: "work",
      attachmentId: "a-work",
    });
    expect(textContent(textResult)).toContain("UNTRUSTED_ATTACHMENT_TEXT");
    expect(textContent(textResult)).toContain("Net 45");
    database.close();
  });
});

type MailMessageResult = {
  ref: { messageId: string };
};

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const content = result.content.find((item) => item.type === "text");
  if (!content?.text) throw new Error("工具没有返回文本内容");
  return content.text;
}
