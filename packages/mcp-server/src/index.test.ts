import { describe, expect, it } from "vitest";
import { MailDatabase } from "@mailpilot/database";
import type { AccountRef } from "@mailpilot/domain";
import { InMemoryTransport, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { createDatabaseQueryService, createMailPilotMcpServer } from "./index.js";

const account: AccountRef = {
  accountId: "work",
  provider: "apple-mail",
  email: "siyuan@loomos.ai",
  displayName: "Work",
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
    expect(searchResult[0].ref.messageId).toBe("m-1");

    await clientTransport.close();
    await server.close();
    database.close();
  });
});

type MailMessageResult = {
  ref: { messageId: string };
};
