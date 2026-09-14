import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  AccountRef,
  Attachment,
  MailMessage,
  MailboxRef,
  MessageRef,
} from "@mailpilot/domain";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type MessageSearchInput = {
  accountIds?: string[];
  mailboxIds?: string[];
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type AttachmentSearchInput = {
  accountIds?: string[];
  messageIds?: string[];
  query?: string;
  limit?: number;
};

export type AttachmentSearchResult = {
  attachment: Attachment;
  chunkIndex?: number;
  matchedText?: string;
};

export class MailDatabase {
  readonly db: DatabaseSyncType;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mailboxes (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        account_id TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        received_at TEXT NOT NULL,
        preview TEXT NOT NULL,
        body TEXT,
        is_read INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (account_id, mailbox_id, message_id),
        FOREIGN KEY (account_id, mailbox_id) REFERENCES mailboxes(account_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        content_hash TEXT,
        local_path TEXT,
        extracted_text_path TEXT,
        preview_path TEXT,
        index_status TEXT NOT NULL,
        FOREIGN KEY (account_id, mailbox_id, message_id)
          REFERENCES messages(account_id, mailbox_id, message_id) ON DELETE CASCADE
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS attachment_search USING fts5(
        attachment_id UNINDEXED,
        chunk_index UNINDEXED,
        text
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
        account_id UNINDEXED,
        mailbox_id UNINDEXED,
        message_id UNINDEXED,
        subject,
        sender,
        preview,
        body
      );
    `);
  }

  upsertAccount(account: AccountRef): void {
    this.db
      .prepare(`
        INSERT INTO accounts (id, provider, email, display_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          email = excluded.email,
          display_name = excluded.display_name
      `)
      .run(account.accountId, account.provider, account.email, account.displayName);
  }

  upsertMailbox(mailbox: MailboxRef): void {
    this.upsertAccount(mailbox.account);
    this.db
      .prepare(`
        INSERT INTO mailboxes (account_id, id, name, unread_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          name = excluded.name,
          unread_count = excluded.unread_count
      `)
      .run(mailbox.account.accountId, mailbox.mailboxId, mailbox.name, mailbox.unreadCount);
  }

  upsertMessage(message: MailMessage): void {
    this.ensureMailbox(message.ref);
    this.db
      .prepare(`
        INSERT INTO messages (
          account_id, mailbox_id, message_id, thread_id, sender, subject,
          received_at, preview, body, is_read
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, mailbox_id, message_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          sender = excluded.sender,
          subject = excluded.subject,
          received_at = excluded.received_at,
          preview = excluded.preview,
          body = excluded.body,
          is_read = excluded.is_read
      `)
      .run(
        message.ref.account.accountId,
        message.ref.mailboxId,
        message.ref.messageId,
        message.ref.threadId ?? null,
        message.sender,
        message.subject,
        message.receivedAt,
        message.preview,
        message.body ?? null,
        message.isRead ? 1 : 0,
      );
    this.rebuildSearchIndex();
  }

  listAccounts(): AccountRef[] {
    const rows = this.db
      .prepare("SELECT provider, id, email, display_name FROM accounts ORDER BY display_name")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => toAccount(row));
  }

  listMailboxes(accountId: string): MailboxRef[] {
    const rows = this.db
      .prepare(`
        SELECT m.account_id, m.id, m.name, m.unread_count,
               a.provider, a.email, a.display_name
        FROM mailboxes m
        JOIN accounts a ON a.id = m.account_id
        WHERE m.account_id = ?
        ORDER BY m.name
      `)
      .all(accountId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      account: toAccount(row),
      mailboxId: String(row.id),
      name: String(row.name),
      unreadCount: Number(row.unread_count),
    }));
  }

  getMessage(ref: MessageRef): MailMessage | null {
    const row = this.db
      .prepare(`
        SELECT m.*, a.provider, a.email, a.display_name
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        WHERE m.account_id = ? AND m.mailbox_id = ? AND m.message_id = ?
      `)
      .get(ref.account.accountId, ref.mailboxId, ref.messageId) as Record<string, unknown> | undefined;
    return row ? toMailMessage(row) : null;
  }

  upsertAttachment(attachment: Attachment): void {
    this.db
      .prepare(`
        INSERT INTO attachments (
          id, account_id, mailbox_id, message_id, filename, mime_type, size,
          content_hash, local_path, extracted_text_path, preview_path, index_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          account_id = excluded.account_id,
          mailbox_id = excluded.mailbox_id,
          message_id = excluded.message_id,
          filename = excluded.filename,
          mime_type = excluded.mime_type,
          size = excluded.size,
          content_hash = excluded.content_hash,
          local_path = excluded.local_path,
          extracted_text_path = excluded.extracted_text_path,
          preview_path = excluded.preview_path,
          index_status = excluded.index_status
      `)
      .run(
        attachment.id,
        attachment.message.account.accountId,
        attachment.message.mailboxId,
        attachment.message.messageId,
        attachment.filename,
        attachment.mimeType,
        attachment.size,
        attachment.contentHash ?? null,
        attachment.localPath ?? null,
        attachment.extractedTextPath ?? null,
        attachment.previewPath ?? null,
        attachment.indexStatus,
      );
  }

  listAttachments(ref: MessageRef): Attachment[] {
    const rows = this.db
      .prepare(`
        SELECT a.*, m.thread_id, ac.provider, ac.email, ac.display_name
        FROM attachments a
        JOIN messages m
          ON m.account_id = a.account_id
         AND m.mailbox_id = a.mailbox_id
         AND m.message_id = a.message_id
        JOIN accounts ac ON ac.id = a.account_id
        WHERE a.account_id = ? AND a.mailbox_id = ? AND a.message_id = ?
        ORDER BY a.filename
      `)
      .all(ref.account.accountId, ref.mailboxId, ref.messageId) as Array<Record<string, unknown>>;
    return rows.map((row) => toAttachment(row));
  }

  getAttachment(accountId: string, attachmentId: string): Attachment | null {
    const row = this.db
      .prepare(`
        SELECT a.*, m.thread_id, ac.provider, ac.email, ac.display_name
        FROM attachments a
        JOIN messages m
          ON m.account_id = a.account_id
         AND m.mailbox_id = a.mailbox_id
         AND m.message_id = a.message_id
        JOIN accounts ac ON ac.id = a.account_id
        WHERE a.account_id = ? AND a.id = ?
      `)
      .get(accountId, attachmentId) as Record<string, unknown> | undefined;
    return row ? toAttachment(row) : null;
  }

  upsertAttachmentChunk(attachmentId: string, chunkIndex: number, text: string): void {
    this.db
      .prepare("DELETE FROM attachment_search WHERE attachment_id = ? AND chunk_index = ?")
      .run(attachmentId, chunkIndex);
    this.db
      .prepare("INSERT INTO attachment_search (attachment_id, chunk_index, text) VALUES (?, ?, ?)")
      .run(attachmentId, chunkIndex, text);
  }

  clearAttachmentChunks(attachmentId: string): void {
    this.db.prepare("DELETE FROM attachment_search WHERE attachment_id = ?").run(attachmentId);
  }

  searchAttachmentContent(input: AttachmentSearchInput): AttachmentSearchResult[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.accountIds?.length) {
      clauses.push(`a.account_id IN (${input.accountIds.map(() => "?").join(",")})`);
      values.push(...input.accountIds);
    }
    if (input.messageIds?.length) {
      clauses.push(`a.message_id IN (${input.messageIds.map(() => "?").join(",")})`);
      values.push(...input.messageIds);
    }
    if (input.query?.trim()) {
      clauses.push(`
        s.rowid IN (
          SELECT rowid
          FROM attachment_search
          WHERE attachment_search MATCH ?
        )
      `);
      values.push(toFtsQuery(input.query));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(`
        SELECT a.*, m.thread_id, ac.provider, ac.email, ac.display_name,
               s.chunk_index, s.text AS matched_text
        FROM attachments a
        JOIN messages m
          ON m.account_id = a.account_id
         AND m.mailbox_id = a.mailbox_id
         AND m.message_id = a.message_id
        JOIN accounts ac ON ac.id = a.account_id
        JOIN attachment_search s ON s.attachment_id = a.id
        ${where}
        ORDER BY a.filename, s.chunk_index
        LIMIT ?
      `)
      .all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      attachment: toAttachment(row),
      chunkIndex: Number(row.chunk_index),
      matchedText: String(row.matched_text),
    }));
  }

  searchMessages(input: MessageSearchInput): MailMessage[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.accountIds?.length) {
      clauses.push(`m.account_id IN (${input.accountIds.map(() => "?").join(",")})`);
      values.push(...input.accountIds);
    }
    if (input.mailboxIds?.length) {
      clauses.push(`m.mailbox_id IN (${input.mailboxIds.map(() => "?").join(",")})`);
      values.push(...input.mailboxIds);
    }
    if (input.dateFrom?.trim()) {
      clauses.push("m.received_at >= ?");
      values.push(input.dateFrom.trim());
    }
    if (input.dateTo?.trim()) {
      clauses.push("m.received_at <= ?");
      values.push(input.dateTo.trim());
    }
    if (input.query?.trim()) {
      clauses.push(`
        m.rowid IN (
          SELECT rowid
          FROM message_search
          WHERE message_search MATCH ?
        )
      `);
      values.push(toFtsQuery(input.query));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(`
        SELECT m.*, a.provider, a.email, a.display_name
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        ${where}
        ORDER BY m.received_at DESC
        LIMIT ?
      `)
      .all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => toMailMessage(row));
  }

  close(): void {
    this.db.close();
  }

  private rebuildSearchIndex(): void {
    this.db.exec(`DELETE FROM message_search;`);
    this.db.exec(`
      INSERT INTO message_search (rowid, account_id, mailbox_id, message_id, subject, sender, preview, body)
      SELECT rowid, account_id, mailbox_id, message_id, subject, sender, preview, body
      FROM messages
    `);
  }

  private ensureMailbox(ref: MessageRef): void {
    this.upsertAccount(ref.account);
    this.db
      .prepare(`
        INSERT INTO mailboxes (account_id, id, name, unread_count)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(account_id, id) DO NOTHING
      `)
      .run(ref.account.accountId, ref.mailboxId, ref.mailboxId);
  }
}

function toFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

function toMailMessage(row: Record<string, unknown>): MailMessage {
  const account = toAccount(row);
  return {
    ref: {
      account,
      mailboxId: String(row.mailbox_id),
      messageId: String(row.message_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
    },
    sender: String(row.sender),
    subject: String(row.subject),
    receivedAt: String(row.received_at),
    preview: String(row.preview),
    body: row.body ? String(row.body) : undefined,
    isRead: Boolean(row.is_read),
  };
}

function toAccount(row: Record<string, unknown>): AccountRef {
  return {
    accountId: String(row.account_id ?? row.id),
    provider: String(row.provider) as AccountRef["provider"],
    email: String(row.email),
    displayName: String(row.display_name),
  };
}

function toAttachment(row: Record<string, unknown>): Attachment {
  const account = toAccount(row);
  return {
    id: String(row.id),
    message: {
      account,
      mailboxId: String(row.mailbox_id),
      messageId: String(row.message_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
    },
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    contentHash: row.content_hash ? String(row.content_hash) : undefined,
    localPath: row.local_path ? String(row.local_path) : undefined,
    extractedTextPath: row.extracted_text_path ? String(row.extracted_text_path) : undefined,
    previewPath: row.preview_path ? String(row.preview_path) : undefined,
    indexStatus: String(row.index_status) as Attachment["indexStatus"],
  };
}
