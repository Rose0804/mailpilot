export type Provider = "apple-mail" | "gmail" | "imap" | "exchange";

export type MailboxRef = {
  account: AccountRef;
  mailboxId: string;
  name: string;
  unreadCount: number;
};

export type AccountRef = {
  provider: Provider;
  accountId: string;
  email: string;
  displayName: string;
};

export type MailMessage = {
  ref: MessageRef;
  sender: string;
  subject: string;
  receivedAt: string;
  preview: string;
  body?: string;
  isRead: boolean;
};

export type MessageRef = {
  account: AccountRef;
  mailboxId: string;
  messageId: string;
  internetMessageId?: string;
  threadId?: string;
};

export type Attachment = {
  id: string;
  message: MessageRef;
  filename: string;
  mimeType: string;
  size: number;
  contentHash?: string;
  localPath?: string;
  extractedTextPath?: string;
  previewPath?: string;
  indexStatus: "pending" | "ready" | "failed";
};

export type AgentStep = {
  runId: string;
  tool: string;
  inputSummary: string;
  outputSummary: string;
  status: "success" | "failed" | "blocked";
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  action: "send" | "reply" | "delete" | "batch-move";
  accountId: string;
  messageId?: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
};

export type MailEventKind = "meeting" | "deadline" | "travel" | "reminder" | "commitment";
export type MailEventStatus = "proposed" | "confirmed" | "dismissed";

export type PlanningSource = {
  accountId: string;
  mailboxId: string;
  messageId: string;
  evidence: string;
};

export type MailEvent = {
  eventId: string;
  kind: MailEventKind;
  title: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  timezone?: string;
  location?: string;
  description?: string;
  attendees: string[];
  confidence: number;
  status: MailEventStatus;
  sources: PlanningSource[];
  createdAt: string;
  updatedAt: string;
};

export type TaskStatus = "planned" | "in_progress" | "blocked" | "done" | "dismissed";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type OrchestrationTask = {
  taskId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: string;
  estimatedMinutes?: number;
  sourceEventIds: string[];
  sourceRefs: PlanningSource[];
  dependencyIds: string[];
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ScheduleBlock = {
  blockId: string;
  sourceType: "event" | "task";
  sourceId: string;
  title: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  accountIds: string[];
  status: string;
  conflictIds: string[];
};

export type ScheduleOverview = {
  events: MailEvent[];
  tasks: OrchestrationTask[];
  blocks: ScheduleBlock[];
  conflicts: Array<{
    conflictId: string;
    blockIds: string[];
    title: string;
  }>;
  generatedAt: string;
};

export function assertMessageScope(message: MessageRef): MessageRef {
  const values = [message.account.accountId, message.account.email, message.mailboxId, message.messageId];
  if (values.some((value) => !value.trim())) {
    throw new Error("邮件操作必须包含账号、邮箱和消息标识");
  }
  return message;
}

export function buildScheduleOverview(
  events: MailEvent[],
  tasks: OrchestrationTask[],
  generatedAt = new Date().toISOString(),
): ScheduleOverview {
  const blocks: ScheduleBlock[] = [
    ...events
      .filter((event) => event.status !== "dismissed")
      .filter((event) => event.startAt || event.dueAt)
      .map((event) => {
        const startAt = event.startAt ?? event.dueAt;
        const endAt = event.endAt ?? (event.startAt ? addMinutes(event.startAt, 60) : undefined);
        return {
          blockId: `event:${event.eventId}`,
          sourceType: "event" as const,
          sourceId: event.eventId,
          title: event.title,
          startAt,
          endAt,
          dueAt: event.dueAt,
          accountIds: unique(event.sources.map((source) => source.accountId)),
          status: event.status,
          conflictIds: [],
        };
      }),
    ...tasks
      .filter((task) => task.status !== "dismissed" && task.dueAt)
      .map((task) => {
        const endAt = task.dueAt;
        const startAt = task.estimatedMinutes
          ? addMinutes(task.dueAt!, -Math.min(Math.max(task.estimatedMinutes, 5), 24 * 60))
          : undefined;
        return {
          blockId: `task:${task.taskId}`,
          sourceType: "task" as const,
          sourceId: task.taskId,
          title: task.title,
          startAt,
          endAt,
          dueAt: task.dueAt,
          accountIds: task.accountIds,
          status: task.status,
          conflictIds: [],
        };
      }),
  ].sort(compareBlocks);

  const conflicts: ScheduleOverview["conflicts"] = [];
  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    const left = blocks[leftIndex];
    if (!left.startAt || !left.endAt) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const right = blocks[rightIndex];
      if (!right.startAt || !right.endAt) continue;
      if (new Date(left.startAt).getTime() >= new Date(right.endAt).getTime()) continue;
      if (new Date(right.startAt).getTime() >= new Date(left.endAt).getTime()) continue;
      const conflictId = `conflict:${conflicts.length + 1}`;
      const title = `${left.title} 与 ${right.title} 时间重叠`;
      conflicts.push({ conflictId, blockIds: [left.blockId, right.blockId], title });
      left.conflictIds.push(conflictId);
      right.conflictIds.push(conflictId);
    }
  }

  return { events, tasks, blocks, conflicts, generatedAt };
}

function compareBlocks(left: ScheduleBlock, right: ScheduleBlock): number {
  const leftTime = left.startAt ?? left.dueAt ?? "";
  const rightTime = right.startAt ?? right.dueAt ?? "";
  const leftTimestamp = parseTimestamp(leftTime);
  const rightTimestamp = parseTimestamp(rightTime);
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
  return left.blockId.localeCompare(right.blockId);
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function parseTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
