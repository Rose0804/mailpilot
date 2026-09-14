import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AccountRef, MailMessage, MailboxRef, MessageRef } from "@mailpilot/domain";

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
    this.upsertMailbox({
      account: message.ref.account,
      mailboxId: message.ref.mailboxId,
      name: message.ref.mailboxId,
      unreadCount: 0,
    });
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
    accountId: String(row.id ?? row.account_id),
    provider: String(row.provider) as AccountRef["provider"],
    email: String(row.email),
    displayName: String(row.display_name),
  };
}
