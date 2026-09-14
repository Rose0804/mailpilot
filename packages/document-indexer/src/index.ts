import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import * as XLSX from "xlsx";
import type { Attachment, MessageRef } from "@mailpilot/domain";
import type { MailDatabase } from "@mailpilot/database";

export type AttachmentInput = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type DocumentFormat = "pdf" | "docx" | "xlsx" | "image" | "text" | "unknown";

export type ExtractedDocument = {
  format: DocumentFormat;
  text: string;
  pageCount?: number;
  sheetNames?: string[];
  warnings: string[];
  indexStatus: "ready" | "failed";
};

export type TextChunk = {
  index: number;
  text: string;
};

export type StoredAttachment = {
  attachmentId: string;
  filename: string;
  localPath: string;
  size: number;
  contentHash: string;
};

export class DocumentIndexer {
  constructor(
    private readonly options: {
      chunkSize?: number;
      chunkOverlap?: number;
    } = {},
  ) {}

  async extract(input: AttachmentInput): Promise<ExtractedDocument> {
    const format = detectFormat(input.filename, input.mimeType);
    try {
      switch (format) {
        case "pdf":
          return await extractPdf(input.bytes);
        case "docx":
          return await extractDocxAsync(input.bytes);
        case "xlsx":
          return extractXlsx(input.bytes);
        case "image":
          return {
            format,
            text: "",
            warnings: ["图片 OCR 尚未接入，当前只生成缩略图"],
            indexStatus: "ready",
          };
        case "text":
          return {
            format,
            text: new TextDecoder().decode(input.bytes),
            warnings: [],
            indexStatus: "ready",
          };
        default:
          return {
            format,
            text: "",
            warnings: ["暂不支持该附件格式"],
            indexStatus: "failed",
          };
      }
    } catch (error) {
      return {
        format,
        text: "",
        warnings: [error instanceof Error ? error.message : "附件解析失败"],
        indexStatus: "failed",
      };
    }
  }

  chunk(text: string): TextChunk[] {
    const value = text.trim();
    if (!value) return [];
    const chunkSize = Math.max(this.options.chunkSize ?? 1200, 100);
    const overlap = Math.min(Math.max(this.options.chunkOverlap ?? 160, 0), chunkSize - 1);
    const step = chunkSize - overlap;
    const chunks: TextChunk[] = [];
    for (let start = 0; start < value.length; start += step) {
      const chunk = value.slice(start, start + chunkSize).trim();
      if (chunk) chunks.push({ index: chunks.length, text: chunk });
      if (start + chunkSize >= value.length) break;
    }
    return chunks;
  }
}

export class AttachmentStore {
  constructor(private readonly rootPath: string) {}

  async save(attachmentId: string, input: AttachmentInput): Promise<StoredAttachment> {
    const safeId = sanitizeSegment(attachmentId);
    const filename = sanitizeFilename(input.filename);
    const directory = resolve(this.rootPath, safeId);
    await mkdir(directory, { recursive: true });
    const localPath = join(directory, filename);
    await writeFile(localPath, input.bytes);
    return {
      attachmentId,
      filename,
      localPath,
      size: input.bytes.byteLength,
      contentHash: createHash("sha256").update(input.bytes).digest("hex"),
    };
  }

  async read(stored: StoredAttachment): Promise<Buffer> {
    return readFile(stored.localPath);
  }

  async saveExtractedText(attachmentId: string, text: string): Promise<string> {
    const directory = resolve(this.rootPath, sanitizeSegment(attachmentId));
    await mkdir(directory, { recursive: true });
    const localPath = join(directory, "extracted.txt");
    await writeFile(localPath, text, "utf8");
    return localPath;
  }

  async createImageThumbnail(bytes: Uint8Array, width = 640): Promise<Buffer> {
    return sharp(bytes).resize({ width, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  }
}

export class AttachmentIndexService {
  constructor(
    private readonly database: MailDatabase,
    private readonly indexer: DocumentIndexer = new DocumentIndexer(),
    private readonly store?: AttachmentStore,
  ) {}

  async index(
    attachmentId: string,
    message: MessageRef,
    input: AttachmentInput,
  ): Promise<{ attachment: Attachment; extracted: ExtractedDocument }> {
    const stored = this.store ? await this.store.save(attachmentId, input) : undefined;
    const pending: Attachment = {
      id: attachmentId,
      message,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
      contentHash: stored?.contentHash,
      localPath: stored?.localPath,
      indexStatus: "pending",
    };
    this.database.upsertAttachment(pending);

    const extracted = await this.indexer.extract(input);
    const extractedTextPath =
      extracted.text && this.store ? await this.store.saveExtractedText(attachmentId, extracted.text) : undefined;
    const indexed: Attachment = {
      ...pending,
      extractedTextPath,
      indexStatus: extracted.indexStatus,
    };
    this.database.upsertAttachment(indexed);
    this.database.clearAttachmentChunks(attachmentId);
    for (const chunk of this.indexer.chunk(extracted.text)) {
      this.database.upsertAttachmentChunk(attachmentId, chunk.index, chunk.text);
    }
    return { attachment: indexed, extracted };
  }
}

function detectFormat(filename: string, mimeType: string): DocumentFormat {
  const mime = mimeType.toLowerCase();
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "docx";
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    extension === "xlsx" ||
    extension === "xls"
  ) {
    return "xlsx";
  }
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (mime.startsWith("text/") || ["txt", "md", "csv", "json"].includes(extension)) return "text";
  return "unknown";
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const document = await getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`第 ${pageNumber} 页\n${text}`);
  }
  return {
    format: "pdf",
    text: pages.join("\n\n"),
    pageCount: document.numPages,
    warnings: pages.length < document.numPages ? ["部分 PDF 页面没有可提取文本，可能需要 OCR"] : [],
    indexStatus: "ready",
  };
}

async function extractDocxAsync(bytes: Uint8Array): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return {
    format: "docx",
    text: result.value.trim(),
    warnings: result.messages.map((message) => message.message),
    indexStatus: "ready",
  };
}

function extractXlsx(bytes: Uint8Array): ExtractedDocument {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
    return `工作表：${sheetName}\n${rows.map((row) => row.map(String).join(" | ")).join("\n")}`;
  });
  return {
    format: "xlsx",
    text: sections.join("\n\n").trim(),
    sheetNames: workbook.SheetNames,
    warnings: [],
    indexStatus: "ready",
  };
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!sanitized || sanitized === "." || sanitized === "..") throw new Error("附件标识无效");
  return sanitized;
}

function sanitizeFilename(value: string): string {
  const sanitized = basename(value).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
  if (!sanitized || sanitized === "." || sanitized === "..") throw new Error("附件文件名无效");
  return sanitized;
}

export async function extractDocument(input: AttachmentInput): Promise<ExtractedDocument> {
  return new DocumentIndexer().extract(input);
}

export { detectFormat };
