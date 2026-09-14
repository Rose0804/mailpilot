import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AppleMailConnector } from "@mailpilot/apple-mail-connector";
import { MailDatabase } from "@mailpilot/database";
import { MailSyncService } from "./index.js";

const databasePath = resolve(
  process.env.MAILPILOT_DB_PATH ?? `${process.env.HOME ?? "."}/Library/Application Support/MailPilot/mailpilot.sqlite`,
);
await mkdir(dirname(databasePath), { recursive: true });

const database = new MailDatabase(databasePath);
const sync = new MailSyncService(new AppleMailConnector(), database);
try {
  const results = await sync.syncAll();
  for (const result of results) {
    console.error(
      `MailPilot 已同步账号 ${result.accountId}: ${result.mailboxes} 个文件夹，${result.messages} 封邮件`,
    );
  }
} finally {
  database.close();
}
