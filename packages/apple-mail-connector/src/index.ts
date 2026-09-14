import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AccountRef,
  MailboxRef,
  MailMessage,
  MessageRef,
} from "@mailpilot/domain";

const execFileAsync = promisify(execFile);

export type JxaExecutor = {
  run(script: string): Promise<string>;
};

export type MailReader = {
  listAccounts(): Promise<AccountRef[]>;
  listMailboxes(accountId: string): Promise<MailboxRef[]>;
  listMessages(accountId: string, mailboxId: string): Promise<MailMessage[]>;
  getMessage(ref: MessageRef): Promise<MailMessage | null>;
};

export class OsascriptJxaExecutor implements JxaExecutor {
  async run(script: string): Promise<string> {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return stdout.trim();
  }
}

const accountScript = `
const Mail = Application("Mail");
function read(call, fallback) { try { return call(); } catch (_) { return fallback; } }
function accountId(account) {
  const identifier = String(read(() => account.id(), ""));
  const email = String(read(() => account.emailAddresses()[0], ""));
  const name = String(read(() => account.name(), ""));
  return identifier || email || name;
}
JSON.stringify(Mail.accounts().map(account => ({
  accountId: accountId(account),
  displayName: String(read(() => account.name(), "")),
  email: String(read(() => account.emailAddresses()[0], "")),
  provider: "apple-mail"
})));
`;

const mailboxScript = (accountId: string) => `
const Mail = Application("Mail");
function read(call, fallback) { try { return call(); } catch (_) { return fallback; } }
function accountKey(account) {
  const identifier = String(read(() => account.id(), ""));
  const email = String(read(() => account.emailAddresses()[0], ""));
  const name = String(read(() => account.name(), ""));
  return identifier || email || name;
}
function mailboxKey(mailbox) {
  let current = mailbox;
  let path = String(read(() => current.name(), ""));
  for (let index = 0; index < 20; index += 1) {
    const parent = read(() => current.container(), null);
    const parentName = parent ? String(read(() => parent.name(), "")) : "";
    if (!parentName || parentName === path) break;
    path = parentName + "/" + path;
    current = parent;
  }
  return path;
}
const account = Mail.accounts().find(item => accountKey(item) === ${JSON.stringify(accountId)});
JSON.stringify(account ? account.mailboxes().map(mailbox => ({
  accountId: ${JSON.stringify(accountId)},
  id: mailboxKey(mailbox),
  name: String(read(() => mailbox.name(), "")),
  unreadCount: Number(read(() => mailbox.unreadCount(), 0))
})) : []);
`;

const messageScript = (accountId: string, mailboxId: string, includeBody: boolean) => `
const Mail = Application("Mail");
function read(call, fallback) { try { return call(); } catch (_) { return fallback; } }
function accountKey(account) {
  const identifier = String(read(() => account.id(), ""));
  const email = String(read(() => account.emailAddresses()[0], ""));
  const name = String(read(() => account.name(), ""));
  return identifier || email || name;
}
function mailboxKey(mailbox) {
  let current = mailbox;
  let path = String(read(() => current.name(), ""));
  for (let index = 0; index < 20; index += 1) {
    const parent = read(() => current.container(), null);
    const parentName = parent ? String(read(() => parent.name(), "")) : "";
    if (!parentName || parentName === path) break;
    path = parentName + "/" + path;
    current = parent;
  }
  return path;
}
const account = Mail.accounts().find(item => accountKey(item) === ${JSON.stringify(accountId)});
const mailbox = account && account.mailboxes().find(item =>
  mailboxKey(item) === ${JSON.stringify(mailboxId)} ||
  String(read(() => item.name(), "")) === ${JSON.stringify(mailboxId)}
);
const messages = mailbox ? mailbox.messages() : [];
JSON.stringify(messages.map(message => ({
  accountId: ${JSON.stringify(accountId)},
  mailboxId: ${JSON.stringify(mailboxId)},
  messageId: String(read(() => message.messageId(), "")),
  threadId: String(read(() => message.messageId(), "")),
  sender: String(read(() => message.sender(), "")),
  subject: String(read(() => message.subject(), "")),
  receivedAt: String(read(() => message.dateReceived(), "")),
  preview: String(read(() => message.content(), "")).slice(0, 240),
  ${includeBody ? 'body: String(read(() => message.content(), "")),' : ""}
  isRead: Boolean(read(() => message.readStatus(), true))
})));
`;

export class AppleMailConnector implements MailReader {
  constructor(private readonly executor: JxaExecutor = new OsascriptJxaExecutor()) {}

  async listAccounts(): Promise<AccountRef[]> {
    return parseJson<AccountRef[]>(await this.executor.run(accountScript), "账号");
  }

  async listMailboxes(accountId: string): Promise<MailboxRef[]> {
    const account = (await this.listAccounts()).find((item) => item.accountId === accountId);
    if (!account) throw new Error(`未找到邮箱账号: ${accountId}`);
    const rows = parseJson<Array<Omit<MailboxRef, "account">>>(
      await this.executor.run(mailboxScript(accountId)),
      "邮箱文件夹",
    );
    return rows.map((row) => ({ ...row, account }));
  }

  async listMessages(accountId: string, mailboxId: string): Promise<MailMessage[]> {
    const account = (await this.listAccounts()).find((item) => item.accountId === accountId);
    if (!account) throw new Error(`未找到邮箱账号: ${accountId}`);
    const rows = parseJson<Array<Record<string, unknown>>>(
      await this.executor.run(messageScript(accountId, mailboxId, false)),
      "邮件",
    );
    return rows.map((row) => toMessage(row, account));
  }

  async getMessage(ref: MessageRef): Promise<MailMessage | null> {
    const messages = parseJson<Array<Record<string, unknown>>>(
      await this.executor.run(messageScript(ref.account.accountId, ref.mailboxId, true)),
      "邮件",
    );
    const row = messages.find((item) => String(item.messageId) === ref.messageId);
    return row ? toMessage(row, ref.account) : null;
  }
}

function toMessage(row: Record<string, unknown>, account: AccountRef): MailMessage {
  const ref: MessageRef = {
    account,
    mailboxId: String(row.mailboxId ?? ""),
    messageId: String(row.messageId ?? ""),
    threadId: String(row.threadId ?? ""),
  };
  return {
    ref,
    sender: String(row.sender ?? ""),
    subject: String(row.subject ?? ""),
    receivedAt: String(row.receivedAt ?? ""),
    preview: String(row.preview ?? ""),
    body: typeof row.body === "string" ? row.body : undefined,
    isRead: Boolean(row.isRead),
  };
}

function parseJson<T>(value: string, kind: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Apple Mail 返回的${kind}数据不是有效 JSON`);
  }
}
