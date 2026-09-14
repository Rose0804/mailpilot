import type { MailReader } from "@mailpilot/apple-mail-connector";
import { MailDatabase } from "@mailpilot/database";

export class MailSyncService {
  constructor(
    private readonly reader: MailReader,
    private readonly database: MailDatabase,
  ) {}

  async syncInbox(accountId: string): Promise<{ accountId: string; mailboxes: number; messages: number }> {
    const accounts = await this.reader.listAccounts();
    const account = accounts.find((item) => item.accountId === accountId);
    if (!account) throw new Error(`未找到邮箱账号: ${accountId}`);
    const mailboxes = await this.reader.listMailboxes(accountId);
    let messageCount = 0;
    for (const mailbox of mailboxes) {
      this.database.upsertMailbox(mailbox);
      const messages = await this.reader.listMessages(accountId, mailbox.mailboxId);
      messages.forEach((message) => this.database.upsertMessage(message));
      messageCount += messages.length;
    }
    return { accountId, mailboxes: mailboxes.length, messages: messageCount };
  }
}
