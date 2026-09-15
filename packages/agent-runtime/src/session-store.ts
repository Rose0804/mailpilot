import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent, AgentSession, SessionStore } from "./contracts.js";

export class FileSessionStore implements SessionStore {
  constructor(private readonly rootPath: string) {}

  async get(sessionId: string): Promise<AgentSession | null> {
    try {
      return JSON.parse(await readFile(this.sessionPath(sessionId), "utf8")) as AgentSession;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async save(session: AgentSession): Promise<void> {
    const path = this.sessionPath(session.sessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(session, null, 2), "utf8");
  }

  async appendEvent(sessionId: string, event: AgentEvent): Promise<void> {
    const path = this.eventsPath(sessionId);
    await mkdir(dirname(path), { recursive: true });
    const events = await this.listEvents(sessionId);
    events.push(event);
    await writeFile(path, JSON.stringify(events, null, 2), "utf8");
  }

  async listEvents(sessionId: string): Promise<AgentEvent[]> {
    try {
      return JSON.parse(await readFile(this.eventsPath(sessionId), "utf8")) as AgentEvent[];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private sessionPath(sessionId: string): string {
    return join(this.rootPath, `${safe(sessionId)}.json`);
  }

  private eventsPath(sessionId: string): string {
    return join(this.rootPath, `${safe(sessionId)}.events.json`);
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
