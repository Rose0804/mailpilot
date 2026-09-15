import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  FileText,
  GitBranch,
  Inbox,
  ListTodo,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Timer,
  WandSparkles,
} from "lucide-react";
import {
  accounts as exampleAccounts,
  mapApiAccount,
  mapApiMessage,
  messages as exampleMessages,
  selectedMessage as exampleSelectedMessage,
  type MailAccount,
  type MailItem,
} from "./data";
import {
  attachmentTextUrl,
  abortAgent,
  createAgentSession,
  getMessage,
  getPlanningOverview,
  getSnapshot,
  sendAgentMessage,
  syncMail,
  type ApiAgentEvent,
  type ApiAgentSession,
  type ApiAttachment,
  type ApiScheduleOverview,
} from "./api";

const toneClass = {
  green: "avatar-green",
  blue: "avatar-blue",
  amber: "avatar-amber",
  brown: "avatar-brown",
} as const;

function AccountRow({ account, active }: { account: MailAccount; active: boolean }) {
  return (
    <button className={`account-row ${active ? "account-row-active" : ""}`} type="button">
      <span className={`account-dot ${account.color}`} />
      <span className="account-copy">
        <strong>{account.name}</strong>
        <small>{account.email}</small>
      </span>
      <span className="account-count">{account.unread}</span>
    </button>
  );
}

function MailRow({
  item,
  selected,
  onSelect,
}: {
  item: MailItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`mail-row ${selected ? "mail-row-selected" : ""}`}
      type="button"
      onClick={() => onSelect(item.id)}
    >
      <span className={`avatar ${toneClass[item.avatarTone]}`}>{item.initials}</span>
      <span className="mail-copy">
        <span className="mail-sender">
          <strong>{item.sender}</strong>
          {item.unread && <span className="unread-dot" />}
        </span>
        <span className="mail-subject">{item.subject}</span>
        <span className="mail-preview">{item.preview}</span>
      </span>
      <span className="mail-meta">
        <small>{item.receivedAt}</small>
        {item.label && <span className={`mail-label ${item.labelTone}`}>{item.label}</span>}
      </span>
    </button>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState("m1");
  const [activeAccount, setActiveAccount] = useState("all");
  const [showDraftNotice, setShowDraftNotice] = useState(false);
  const [query, setQuery] = useState("");
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [mailMessages, setMailMessages] = useState<MailItem[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<{
    body?: string;
    attachments: ApiAttachment[];
  } | null>(null);
  const [apiState, setApiState] = useState<
    "checking" | "connected" | "empty" | "offline" | "sync-error"
  >("checking");
  const [isSyncing, setIsSyncing] = useState(false);
  const [agentEvents, setAgentEvents] = useState<ApiAgentEvent[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentSession, setAgentSession] = useState<ApiAgentSession | null>(null);
  const [planningOverview, setPlanningOverview] = useState<ApiScheduleOverview | null>(null);

  useEffect(() => {
    if (apiState === "checking") return;
    let active = true;
    void getSnapshot(query)
      .then((snapshot) => {
        if (!active) return;
        setApiState(snapshot.accounts.length === 0 ? "empty" : "connected");
        setMailAccounts(
          snapshot.accounts.map(mapApiAccount).map((account) => ({
            ...account,
            unread: snapshot.mailboxes
              .filter((mailbox) => mailbox.accountId === account.id)
              .reduce((total, mailbox) => total + mailbox.unreadCount, 0),
          })),
        );
        setMailMessages(snapshot.messages.map(mapApiMessage));
        setSelectedId((current) =>
          snapshot.messages.some(
            (message) => `${message.accountId}|${message.mailboxId}|${message.messageId}` === current,
          )
            ? current
            : snapshot.messages[0]
              ? `${snapshot.messages[0].accountId}|${snapshot.messages[0].mailboxId}|${snapshot.messages[0].messageId}`
              : "",
        );
      })
      .catch(() => {
        if (!active) return;
        setMailAccounts(exampleAccounts);
        setMailMessages(exampleMessages);
        setSelectedId("m1");
        setApiState("offline");
      });
    return () => {
      active = false;
    };
  }, [query]);

  useEffect(() => {
    let active = true;
    const loadDetails = async () => {
      const selectedItem = mailMessages.find((message) => message.id === selectedId);
      if (!selectedItem?.mailboxId || !selectedItem.messageId) {
        if (apiState === "offline" && selectedItem?.id === "m1") {
          setSelectedDetails({
            body: exampleSelectedMessage.body,
            attachments: [
              {
                id: exampleSelectedMessage.attachments[0].id,
                message: {
                  account: {
                    accountId: "work",
                    provider: "exchange",
                    email: "siyuan@loomos.ai",
                    displayName: "Work",
                  },
                  mailboxId: "INBOX",
                  messageId: "m1",
                },
                filename: exampleSelectedMessage.attachments[0].filename,
                mimeType: "application/pdf",
                size: 482 * 1024,
                indexStatus: "ready",
              },
            ],
          });
          return;
        }
        setSelectedDetails(null);
        return;
      }
      try {
        const details = await getMessage(
          selectedItem.accountId,
          selectedItem.mailboxId,
          selectedItem.messageId,
        );
        if (active) setSelectedDetails({ body: details.message.body, attachments: details.attachments });
      } catch {
        if (active) setSelectedDetails(null);
      }
    };
    void loadDetails();
    return () => {
      active = false;
    };
  }, [apiState, mailMessages, selectedId]);

  useEffect(() => {
    let active = true;
    void getPlanningOverview(activeAccount === "all" ? {} : { accountIds: [activeAccount] })
      .then((overview) => {
        if (active) setPlanningOverview(overview);
      })
      .catch(() => {
        if (active) setPlanningOverview(null);
      });
    return () => {
      active = false;
    };
  }, [activeAccount, apiState]);

  const visibleMessages = useMemo(
    () =>
      mailMessages.filter((message) => {
        const accountMatch = activeAccount === "all" || message.accountId === activeAccount;
        const queryMatch =
          apiState !== "connected" && apiState !== "empty" && apiState !== "sync-error"
            ? `${message.sender} ${message.subject} ${message.preview}`.toLowerCase().includes(query.toLowerCase())
            : true;
        return accountMatch && queryMatch;
      }),
    [activeAccount, apiState, mailMessages, query],
  );

  const selectedAttachment = selectedDetails?.attachments[0];
  const selectedAttachmentName = selectedAttachment?.filename ?? "No indexed attachment";
  const selectedAttachmentSize = selectedAttachment
    ? formatBytes(selectedAttachment.size)
    : "";
  const selectedAttachmentKind = selectedAttachment
    ? selectedAttachment.mimeType.split("/").pop()?.toUpperCase() ?? "FILE"
    : "";
  const unreadTotal = mailAccounts.reduce((total, account) => total + account.unread, 0);
  const hasInspectorContext = apiState === "offline" || Boolean(selectedDetails?.body);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncMail();
      const snapshot = await getSnapshot(query);
      setMailAccounts(
        snapshot.accounts.map(mapApiAccount).map((account) => ({
          ...account,
          unread: snapshot.mailboxes
            .filter((mailbox) => mailbox.accountId === account.id)
            .reduce((total, mailbox) => total + mailbox.unreadCount, 0),
        })),
      );
      setMailMessages(snapshot.messages.map(mapApiMessage));
      setApiState(snapshot.accounts.length === 0 ? "empty" : "connected");
      setSelectedId((current) =>
        snapshot.messages.some(
          (message) => `${message.accountId}|${message.mailboxId}|${message.messageId}` === current,
        )
          ? current
          : snapshot.messages[0]
            ? `${snapshot.messages[0].accountId}|${snapshot.messages[0].mailboxId}|${snapshot.messages[0].messageId}`
            : "",
      );
      try {
        setPlanningOverview(
          await getPlanningOverview(activeAccount === "all" ? {} : { accountIds: [activeAccount] }),
        );
      } catch {
        setPlanningOverview(null);
      }
    } catch {
      setApiState("sync-error");
    } finally {
      setIsSyncing(false);
    }
  };

  const askAgent = async () => {
    setAgentBusy(true);
    setAgentEvents([]);
    try {
      const session = await createAgentSession({
        title: "整理当前收件箱",
        accountIds: activeAccount === "all" ? undefined : [activeAccount],
      });
      setAgentSession(session);
      const events = await sendAgentMessage(
        session.sessionId,
        "请跨当前范围内的邮箱搜索会议、截止日期、出行和待跟进事项；为每个事实记录来源邮件与原文证据，创建必要的任务和依赖关系，最后生成时间表并标记冲突。",
      );
      setAgentEvents(events);
      try {
        setPlanningOverview(
          await getPlanningOverview(activeAccount === "all" ? {} : { accountIds: [activeAccount] }),
        );
      } catch {
        setPlanningOverview(null);
      }
    } catch (error) {
      setAgentEvents([
        {
          type: "run.failed",
          message:
            error instanceof Error && error.message === "AGENT_RUNTIME_UNAVAILABLE"
              ? "Agent Runtime 尚未配置。邮件查询链路已可用，但本地推理会话尚未启用。"
              : "Agent 会话暂时不可用，请确认本地 API 正在运行。",
        },
      ]);
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <strong>mailpilot</strong>
          <span>agentic email workspace</span>
        </div>
        <label className="search-box">
          <Search size={16} strokeWidth={1.8} />
          <input
            aria-label="搜索邮件、文件或询问 MailPilot"
            placeholder="Search mail, files, or ask MailPilot..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="sync-state">
          <span className={`sync-dot sync-dot-${apiState}`} />
          <span>
            {apiState === "connected"
              ? "Local index connected"
              : apiState === "empty"
                ? "Local index ready"
                : apiState === "checking"
                  ? "Connecting..."
              : apiState === "sync-error"
                ? "Sync unavailable"
                : "Demo data"}
          </span>
          <button
            className="sync-button"
            type="button"
            aria-label="同步 Mail.app"
            title="同步 Mail.app"
            onClick={() => void handleSync()}
            disabled={isSyncing || apiState === "checking"}
          >
            <RefreshCw size={14} className={isSyncing ? "spin" : ""} />
          </button>
          <span className="user-avatar">S</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <button className="compose-button" type="button">
            <Plus size={17} />
            New message
          </button>
          <p className="eyebrow">MAILBOXES</p>
          <nav className="mail-nav" aria-label="邮箱导航">
            <button className="nav-item nav-item-active" type="button">
              <Inbox size={16} />
              <span>Inbox</span>
              <b>{apiState === "offline" ? 24 : unreadTotal}</b>
            </button>
            <button className="nav-item" type="button">
              <Star size={16} />
              <span>Starred</span>
              <b>8</b>
            </button>
            <button className="nav-item" type="button">
              <Timer size={16} />
              <span>Snoozed</span>
            </button>
            <button className="nav-item" type="button">
              <Send size={16} />
              <span>Sent</span>
            </button>
            <button className="nav-item" type="button">
              <FileText size={16} />
              <span>Drafts</span>
              <b>3</b>
            </button>
          </nav>
          <p className="eyebrow">SPACES</p>
          {mailAccounts.map((account) => (
            <button
              className={`space-row ${activeAccount === account.id ? "space-row-active" : ""}`}
              type="button"
              key={account.id}
              onClick={() => setActiveAccount(activeAccount === account.id ? "all" : account.id)}
            >
              <span className={`space-dot ${account.color}`} />
              <span>{account.name}</span>
              <b>{account.unread}</b>
            </button>
          ))}
          <div className="account-card">
            <p className="eyebrow">CONNECTED ACCOUNTS</p>
            {mailAccounts.map((account) => (
              <AccountRow key={account.id} account={account} active={activeAccount === account.id} />
            ))}
          </div>
        </aside>

        <section className="inbox-panel">
          <div className="inbox-heading">
            <div>
              <h1>Inbox</h1>
              <p>{visibleMessages.length} conversations in this view</p>
            </div>
            <button className="filter-button" type="button">
              All mail <ChevronDown size={14} />
            </button>
          </div>
          <button className="agent-prompt" type="button" onClick={() => void askAgent()} disabled={agentBusy}>
            <span className="agent-prompt-icon">
              <CalendarClock size={17} />
            </span>
            <span>{agentBusy ? "MailPilot is building your schedule..." : "Ask MailPilot to build a schedule"}</span>
            <kbd>Enter</kbd>
          </button>
          <section className="planning-strip" aria-label="时间表">
            <div className="planning-strip-heading">
              <div>
                <p className="eyebrow">NEXT UP</p>
                <h2>时间表</h2>
              </div>
              <div className="planning-summary">
                <span>
                  <CalendarClock size={13} />
                  {planningOverview?.events.length ?? 0} events
                </span>
                <span>
                  <ListTodo size={13} />
                  {planningOverview?.tasks.length ?? 0} tasks
                </span>
                <span className={planningOverview?.conflicts.length ? "planning-alert" : ""}>
                  <AlertTriangle size={13} />
                  {planningOverview?.conflicts.length ?? 0} conflicts
                </span>
              </div>
            </div>
            {planningOverview?.blocks.length ? (
              <div className="planning-block-list">
                {planningOverview.blocks.slice(0, 5).map((block) => {
                  const task = planningOverview.tasks.find((item) => item.taskId === block.sourceId);
                  const event = planningOverview.events.find((item) => item.eventId === block.sourceId);
                  return (
                    <div className="planning-block" key={block.blockId}>
                      <span className="planning-time">{formatScheduleTime(block.startAt ?? block.dueAt)}</span>
                      <span className="planning-block-icon">
                        {block.conflictIds.length ? (
                          <AlertTriangle size={15} />
                        ) : block.sourceType === "task" ? (
                          <ListTodo size={15} />
                        ) : (
                          <CalendarClock size={15} />
                        )}
                      </span>
                      <span className="planning-block-copy">
                        <strong>{block.title}</strong>
                        <small>
                          {block.sourceType === "task" ? "Task" : "Event"} ·{" "}
                          {block.accountIds.join(", ") || "来源待确认"}
                          {task?.dependencyIds.length ? ` · ${task.dependencyIds.length} dependencies` : ""}
                          {event ? ` · ${Math.round(event.confidence * 100)}% confidence` : ""}
                          {event?.sources[0]?.evidence ? ` · "${event.sources[0].evidence}"` : ""}
                        </small>
                      </span>
                      {block.conflictIds.length > 0 && <span className="planning-conflict-tag">Conflict</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="planning-empty">
                <CalendarClock size={16} />
                <span>还没有结构化事件。让 MailPilot 先阅读当前范围内的邮箱。</span>
              </div>
            )}
            {planningOverview?.conflicts.length ? (
              <div className="planning-conflicts">
                <AlertTriangle size={15} />
                <span>
                  {planningOverview.conflicts
                    .slice(0, 2)
                    .map((conflict) => conflict.title)
                    .join("；")}
                </span>
              </div>
            ) : null}
          </section>
          <p className="eyebrow list-eyebrow">TODAY</p>
          <div className="mail-list">
            {visibleMessages.length === 0 ? (
              <div className="empty-list-state">
                <Inbox size={18} />
                <strong>{apiState === "empty" ? "本地索引还没有邮件" : "没有匹配的邮件"}</strong>
                <span className="activity-status">
                  {apiState === "empty"
                    ? "先同步 Mail.app，MailPilot 会在本机建立可搜索索引。"
                    : "换一个关键词，或切换到其他账号。"}
                </span>
              </div>
            ) : (
              visibleMessages.slice(0, 4).map((item) => (
                <MailRow key={item.id} item={item} selected={item.id === selectedId} onSelect={setSelectedId} />
              ))
            )}
          </div>
          <p className="eyebrow earlier-eyebrow">EARLIER</p>
          <div className="mail-list">
            {visibleMessages.slice(4).map((item) => (
              <MailRow key={item.id} item={item} selected={item.id === selectedId} onSelect={setSelectedId} />
            ))}
          </div>
          <div className="inbox-footnote">
            <WandSparkles size={14} />
            {apiState === "connected" || apiState === "sync-error"
              ? "MailPilot is watching the local index for deadlines, commitments, and files."
              : apiState === "empty"
                ? "MailPilot is connected. Sync Mail.app to build the first local index."
                : "MailPilot is showing demo data until the local API is available."}
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-heading">
            <p className="eyebrow">MAILPILOT INSPECTOR</p>
            <h2>{selectedDetails?.body ? "Ready to help" : "Waiting for context"}</h2>
            <p>
              {selectedDetails?.body
                ? "I read the indexed thread and found one decision to make."
                : "Select an indexed message to inspect its context."}
            </p>
          </div>
          <span className="ready-pill">
            <span>●</span> Ready to act
          </span>
          <div className="rule" />
          <p className="eyebrow">WHAT I UNDERSTOOD</p>
          <div className="understanding-card">
            <p>
              {selectedDetails?.body
                ? selectedDetails.body.slice(0, 240)
                : apiState === "offline"
                  ? "Demo context is shown while the local API is offline."
                  : "Select a message to inspect its indexed content."}
            </p>
            <div className="confidence-row">
              <strong>{selectedDetails?.body ? "Indexed message" : "Awaiting context"}</strong>
              <span>
                {selectedDetails?.attachments.length
                  ? `thread + ${selectedDetails.attachments.length} indexed file`
                  : "local message context"}
              </span>
            </div>
          </div>
          <p className="eyebrow section-gap">ATTACHMENT</p>
          {selectedAttachment ? (
            <div className="attachment-card">
              <div className="pdf-preview">
                <span>{selectedAttachmentKind}</span>
                <small>{selectedAttachment.indexStatus}</small>
              </div>
              <div className="attachment-copy">
                <strong>{selectedAttachmentName}</strong>
                <span>{selectedAttachmentKind} · {selectedAttachmentSize}</span>
                <em>Indexed and searchable</em>
              </div>
              {selectedAttachment.indexStatus === "ready" && apiState !== "offline" ? (
                <a
                  className="icon-button"
                  href={attachmentTextUrl(selectedAttachment.message.account.accountId, selectedAttachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="打开附件文本预览"
                  title="打开附件文本预览"
                >
                  <ArrowUpRight size={16} />
                </a>
              ) : (
                <span
                  className="icon-button icon-button-disabled"
                  aria-label="附件文本尚未准备好"
                  title="附件文本尚未准备好"
                >
                  <ArrowUpRight size={16} />
                </span>
              )}
            </div>
          ) : (
            <div className="empty-inspector-state">
              <Paperclip size={15} />
              No indexed attachment on this message.
            </div>
          )}
          <p className="eyebrow section-gap">CHANGES FOUND</p>
          {selectedDetails?.body ? (
            <ul className="change-list">
              <li>01&nbsp;&nbsp;Message body indexed</li>
              <li>02&nbsp;&nbsp;Account scope preserved</li>
              <li>03&nbsp;&nbsp;Ready for Agent review</li>
            </ul>
          ) : (
            <div className="empty-inspector-state">No Agent analysis yet.</div>
          )}
          <p className="eyebrow section-gap">TASK GRAPH</p>
          {planningOverview?.tasks.length ? (
            <div className="task-graph">
              {planningOverview.tasks.slice(0, 3).map((task) => (
                <div className="task-graph-row" key={task.taskId}>
                  <GitBranch size={14} />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.accountIds.join(", ") || "No account"} ·{" "}
                      {task.dependencyIds.length
                        ? `${task.dependencyIds.length} dependencies`
                        : "No dependencies"}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-inspector-state">
              <GitBranch size={15} />
              No orchestration tasks yet.
            </div>
          )}
          {hasInspectorContext && (
            <div className="suggested-card">
              <p className="eyebrow">SUGGESTED ACTION</p>
              <strong>Create a reply confirming the legal language.</strong>
              <div className="suggested-actions">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => setShowDraftNotice(true)}
                >
                  Create draft
                </button>
                <button className="secondary-action" type="button">
                  Review first
                </button>
              </div>
            </div>
          )}
          {showDraftNotice && (
            <div className="draft-notice" role="status">
              <FileText size={15} />
              Draft created. Nothing has been sent.
              <button type="button" onClick={() => setShowDraftNotice(false)} aria-label="关闭提示">
                <MoreHorizontal size={16} />
              </button>
            </div>
          )}
          {agentEvents.length > 0 && (
            <div className="agent-activity" aria-live="polite">
              <div className="agent-activity-heading">
                <span className="agent-prompt-icon">
                  <Sparkles size={14} />
                </span>
                <strong>Agent session</strong>
                <span>
                  {agentSession?.runtime ?? "local"} ·{" "}
                  {agentEvents.at(-1)?.type === "run.completed" ? "Complete" : agentBusy ? "Active" : "Needs attention"}
                </span>
                {agentBusy && agentSession && (
                  <button
                    className="activity-abort-button"
                    type="button"
                    onClick={() => void abortAgent(agentSession.sessionId)}
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="agent-event-list">
                {agentEvents
                  .filter((event) => event.type !== "assistant.delta")
                  .map((event, index) => (
                    <div className="agent-event" key={`${event.type}-${index}`}>
                      <small>{event.type.replace(".", " ")}</small>
                      <p>
                        {event.text ??
                          event.message ??
                          event.summary ??
                          event.outputSummary ??
                          event.inputSummary ??
                          event.tool ??
                          "Event received"}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export { App as MailPilotApp };

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatScheduleTime(value?: string): string {
  if (!value) return "No time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
