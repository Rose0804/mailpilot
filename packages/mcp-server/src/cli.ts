import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AppleMailConnector } from "@mailpilot/apple-mail-connector";
import { MailDatabase } from "@mailpilot/database";
import { createDatabaseQueryService, createMailPilotMcpServer } from "./index.js";

const databasePath = resolve(
  process.env.MAILPILOT_DB_PATH ?? `${process.env.HOME ?? "."}/Library/Application Support/MailPilot/mailpilot.sqlite`,
);
await mkdir(dirname(databasePath), { recursive: true });

const database = new MailDatabase(databasePath);
const connector = new AppleMailConnector();
const accounts = await connector.listAccounts();
for (const account of accounts) {
  database.upsertAccount(account);
}

const scopedAccountIds = process.env.MAILPILOT_ACCOUNT_IDS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const server = createMailPilotMcpServer(createDatabaseQueryService(database), {
  accountIds: scopedAccountIds,
});
const transport = new StdioServerTransport();

const shutdown = async () => {
  await server.close().catch(() => undefined);
  database.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await server.connect(transport);
