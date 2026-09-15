import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { MailDatabase } from "@mailpilot/database";
import type { AccountRef, MessageRef } from "@mailpilot/domain";
import {
  AttachmentIndexService,
  AttachmentStore,
  DocumentIndexer,
  extractDocument,
} from "./index.js";

const account: AccountRef = {
  accountId: "work",
  provider: "apple-mail",
  email: "siyuan@loomos.ai",
  displayName: "Work",
};
const message: MessageRef = {
  account,
  mailboxId: "INBOX",
  messageId: "m-1",
};

describe("附件文档索引器", () => {
  it("提取 XLSX 工作表并生成重叠分块", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Clause", "Value"],
        ["Payment schedule", "Net 45"],
      ]),
      "Terms",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const extracted = await extractDocument({
      filename: "terms.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    expect(extracted.indexStatus).toBe("ready");
    expect(extracted.text).toContain("Payment schedule");
    expect(extracted.sheetNames).toEqual(["Terms"]);

    const chunks = new DocumentIndexer({ chunkSize: 100, chunkOverlap: 20 }).chunk("a".repeat(170));
    expect(chunks).toHaveLength(2);
    expect(chunks[1].text.startsWith("a")).toBe(true);
  });

  it("保存原文件、解析文本并写入附件搜索索引", async () => {
    const root = await mkdtemp(join(tmpdir(), "mailpilot-"));
    const database = new MailDatabase();
    database.upsertMessage({
      ref: message,
      sender: "Maya",
      subject: "Renewal",
      receivedAt: "2026-09-14T09:42:00Z",
      preview: "Review",
      isRead: false,
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Payment", "Net 45"]]), "Terms");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = await new AttachmentIndexService(
      database,
      new DocumentIndexer({ chunkSize: 100 }),
      new AttachmentStore(root),
    ).index("a-1", message, {
      filename: "../renewal.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });

    expect(result.attachment.localPath).toContain("/a-1/renewal.xlsx");
    expect(result.attachment.localPath).not.toContain("..");
    expect(result.attachment.indexStatus).toBe("ready");
    expect(database.searchAttachmentContent({ query: "Net 45" })[0].attachment.id).toBe("a-1");
    await expect(readFile(result.attachment.extractedTextPath!, "utf8")).resolves.toContain("Net 45");
    database.close();
  });
});
