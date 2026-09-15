import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppleMailConnector } from "@mailpilot/apple-mail-connector";
import {
  DshRuntimeAdapter,
  FileSessionStore,
  JsonLineDshTransport,
  PiAgentRuntime,
} from "@mailpilot/agent-runtime";
import type { AgentRuntime } from "@mailpilot/agent-runtime";
import { MailDatabase } from "@mailpilot/database";
import { createDatabaseQueryService, createMailPilotAgentTools } from "@mailpilot/mcp-server";
import { MailSyncService } from "@mailpilot/sync";
import { createLocalApiServer, MailPilotLocalApi } from "./index.js";

const databasePath = resolve(
  process.env.MAILPILOT_DB_PATH ?? `${process.env.HOME ?? "."}/Library/Application Support/MailPilot/mailpilot.sqlite`,
);
await mkdir(dirname(databasePath), { recursive: true });
const projectRoot = resolve(
  process.env.MAILPILOT_PROJECT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
);

const database = new MailDatabase(databasePath);
const reader = new AppleMailConnector();
const queryService = createDatabaseQueryService(database);
const sessionStore = new FileSessionStore(resolve(dirname(databasePath), "agent-sessions"));
const runtimeName = process.env.MAILPILOT_AGENT_RUNTIME ?? "pi";
const runtimeCommand = process.env.MAILPILOT_DSH_COMMAND;
let runtime: AgentRuntime | undefined;
if (runtimeName === "dsh") {
  if (!runtimeCommand) {
    throw new Error("MAILPILOT_AGENT_RUNTIME=dsh 时必须设置 MAILPILOT_DSH_COMMAND");
  }
  const dshHome = resolve(
    process.env.MAILPILOT_DSH_HOME ??
      process.env.DSH_HOME ??
      resolve(dirname(databasePath), "dsh-home"),
  );
  await mkdir(dshHome, { recursive: true });
  const mcpPatchPath = await writeMcpPatch(projectRoot, databasePath);
  runtime = new DshRuntimeAdapter(
    new JsonLineDshTransport({
      command: runtimeCommand,
      args: process.env.MAILPILOT_DSH_ARGS
        ? JSON.parse(process.env.MAILPILOT_DSH_ARGS)
        : [
            "--profile",
            process.env.MAILPILOT_DSH_PROFILE ?? "sdk",
            "--patch",
            process.env.MAILPILOT_DSH_PATCH ?? mcpPatchPath,
          ],
      cwd: process.env.MAILPILOT_DSH_CWD,
      env: { DSH_HOME: dshHome },
      provider: process.env.MAILPILOT_DSH_PROVIDER ?? "deepseek-official",
      model: process.env.MAILPILOT_DSH_MODEL ?? "deepseek-v4-flash",
      reasoningEffort: process.env.MAILPILOT_DSH_REASONING_EFFORT,
      maxTokens: process.env.MAILPILOT_DSH_MAX_TOKENS
        ? Number(process.env.MAILPILOT_DSH_MAX_TOKENS)
        : undefined,
    }),
  );
} else if (runtimeName === "pi") {
  runtime = new PiAgentRuntime({
    sessionStore,
    modelId: process.env.MAILPILOT_PI_MODEL ?? "deepseek-v4-flash",
    thinkingLevel: parseThinkingLevel(process.env.MAILPILOT_PI_THINKING_LEVEL),
    toolsFactory: (session) => createMailPilotAgentTools(queryService, session.accountIds),
  });
} else if (runtimeName !== "none") {
  throw new Error(`不支持的 MAILPILOT_AGENT_RUNTIME: ${runtimeName}`);
}
const api = new MailPilotLocalApi({
  database,
  reader,
  sync: new MailSyncService(reader, database),
  runtime,
});
const port = Number(process.env.MAILPILOT_PORT ?? 3100);
const server = createLocalApiServer(api, port);
console.error(`MailPilot local API 已启动: http://127.0.0.1:${port}（Agent Runtime: ${runtime?.runtimeName ?? "none"}）`);

const shutdown = async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime?.close().catch(() => undefined);
  database.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function writeMcpPatch(root: string, databaseFile: string): Promise<string> {
  const patchPath = resolve(dirname(databaseFile), "dsh-mcp-mailpilot.patch.yml");
  const command = process.env.MAILPILOT_MCP_COMMAND ?? "pnpm";
  const args = process.env.MAILPILOT_MCP_ARGS
    ? parseStringArray(process.env.MAILPILOT_MCP_ARGS, "MAILPILOT_MCP_ARGS")
    : ["--filter", "@mailpilot/mcp-server", "exec", "tsx", "src/cli.ts"];
  const yaml = [
    "- insert:",
    "    - id: mcp-mailpilot",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: mailpilot",
    "        transport: stdio",
    `        command: ${JSON.stringify(command)}`,
    `        args: ${JSON.stringify(args)}`,
    `        cwd: ${JSON.stringify(root)}`,
    "        env:",
    `          MAILPILOT_DB_PATH: ${JSON.stringify(databaseFile)}`,
    "        failOnStartupError: true",
    "",
  ].join("\n");
  await writeFile(patchPath, yaml, "utf8");
  return patchPath;
}

function parseStringArray(value: string, name: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`${name} 必须是 JSON 字符串数组`);
  }
  return parsed;
}

function parseThinkingLevel(
  value: string | undefined,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (!value) return undefined;
  const values = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
  if (!values.includes(value as (typeof values)[number])) {
    throw new Error(`MAILPILOT_PI_THINKING_LEVEL 无效: ${value}`);
  }
  return value as (typeof values)[number];
}
