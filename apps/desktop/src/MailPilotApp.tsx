import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  ChevronDown,
  FileText,
  Inbox,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  Timer,
  WandSparkles,
} from "lucide-react";
import { accounts, messages, selectedMessage, type MailAccount, type MailItem } from "./data";

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

  const visibleMessages = useMemo(
    () =>
      messages.filter((message) => {
        const accountMatch = activeAccount === "all" || message.accountId === activeAccount;
        const queryMatch = `${message.sender} ${message.subject} ${message.preview}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return accountMatch && queryMatch;
      }),
    [activeAccount, query],
  );

  const selected = messages.find((message) => message.id === selectedId) ?? selectedMessage;

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
          <span className="sync-dot" />
          <span>Synced just now</span>
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
              <b>24</b>
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
          <button
            className={`space-row ${activeAccount === "work" ? "space-row-active" : ""}`}
            type="button"
            onClick={() => setActiveAccount(activeAccount === "work" ? "all" : "work")}
          >
            <span className="space-dot blue" />
            <span>Work</span>
            <b>12</b>
          </button>
          <button
            className={`space-row ${activeAccount === "personal" ? "space-row-active" : ""}`}
            type="button"
            onClick={() => setActiveAccount(activeAccount === "personal" ? "all" : "personal")}
          >
            <span className="space-dot amber" />
            <span>Personal</span>
            <b>4</b>
          </button>
          <div className="account-card">
            <p className="eyebrow">CONNECTED ACCOUNTS</p>
            <AccountRow account={accounts[0]} active={activeAccount === "work"} />
            <AccountRow account={accounts[1]} active={activeAccount === "personal"} />
          </div>
        </aside>

        <section className="inbox-panel">
          <div className="inbox-heading">
            <div>
              <h1>Inbox</h1>
              <p>12 conversations need attention</p>
            </div>
            <button className="filter-button" type="button">
              All mail <ChevronDown size={14} />
            </button>
          </div>
          <button className="agent-prompt" type="button">
            <span className="agent-prompt-icon">
              <Sparkles size={17} />
            </span>
            <span>Ask MailPilot to triage this inbox</span>
            <kbd>Enter</kbd>
          </button>
          <p className="eyebrow list-eyebrow">TODAY</p>
          <div className="mail-list">
            {visibleMessages.slice(0, 4).map((item) => (
              <MailRow key={item.id} item={item} selected={item.id === selectedId} onSelect={setSelectedId} />
            ))}
          </div>
          <p className="eyebrow earlier-eyebrow">EARLIER</p>
          <div className="mail-list">
            {visibleMessages.slice(4).map((item) => (
              <MailRow key={item.id} item={item} selected={item.id === selectedId} onSelect={setSelectedId} />
            ))}
          </div>
          <div className="inbox-footnote">
            <WandSparkles size={14} />
            MailPilot is watching for deadlines, commitments, and files.
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-heading">
            <p className="eyebrow">MAILPILOT INSPECTOR</p>
            <h2>Ready to help</h2>
            <p>I read the thread and found one decision to make.</p>
          </div>
          <span className="ready-pill">
            <span>●</span> Ready to act
          </span>
          <div className="rule" />
          <p className="eyebrow">WHAT I UNDERSTOOD</p>
          <div className="understanding-card">
            <p>
              This is a renewal decision.
              <br />
              Maya is waiting for legal confirmation before routing the agreement for signature.
            </p>
            <div className="confidence-row">
              <strong>92% confident</strong>
              <span>thread + 1 indexed PDF</span>
            </div>
          </div>
          <p className="eyebrow section-gap">ATTACHMENT</p>
          <div className="attachment-card">
            <div className="pdf-preview">
              <span>PDF</span>
              <small>4 pages</small>
            </div>
            <div className="attachment-copy">
              <strong>{selectedMessage.attachments[0].filename}</strong>
              <span>PDF · {selectedMessage.attachments[0].size}</span>
              <em>Indexed and searchable</em>
            </div>
            <button className="icon-button" type="button" aria-label="打开附件预览">
              <ArrowUpRight size={16} />
            </button>
          </div>
          <p className="eyebrow section-gap">CHANGES FOUND</p>
          <ul className="change-list">
            <li>01&nbsp;&nbsp;Payment schedule: net 45</li>
            <li>02&nbsp;&nbsp;Cancellation clause: 30 days</li>
            <li>03&nbsp;&nbsp;Signature routing updated</li>
          </ul>
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
          {showDraftNotice && (
            <div className="draft-notice" role="status">
              <FileText size={15} />
              Draft created. Nothing has been sent.
              <button type="button" onClick={() => setShowDraftNotice(false)} aria-label="关闭提示">
                <MoreHorizontal size={16} />
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export { App as MailPilotApp };
