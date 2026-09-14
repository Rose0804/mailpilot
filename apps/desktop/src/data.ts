export type MailAccount = {
  id: string;
  name: string;
  email: string;
  provider: string;
  color: "blue" | "amber";
  unread: number;
};

export type MailItem = {
  id: string;
  accountId: string;
  initials: string;
  messageId?: string;
  sender: string;
  email: string;
  subject: string;
  preview: string;
  receivedAt: string;
  label?: string;
  labelTone?: "amber" | "blue" | "green" | "neutral";
  unread?: boolean;
  avatarTone: "green" | "blue" | "amber" | "brown";
  mailboxId?: string;
  receivedAtIso?: string;
};

export type Attachment = {
  id: string;
  filename: string;
  kind: "PDF" | "DOCX" | "XLSX";
  size: string;
  pages?: string;
  status: "indexed" | "pending";
};

export const accounts: MailAccount[] = [
  {
    id: "work",
    name: "Work",
    email: "siyuan@loomos.ai",
    provider: "Exchange",
    color: "blue",
    unread: 12,
  },
  {
    id: "personal",
    name: "Personal",
    email: "siyuan@gmail.com",
    provider: "Gmail",
    color: "amber",
    unread: 4,
  },
];

export const messages: MailItem[] = [
  {
    id: "m1",
    accountId: "work",
    initials: "M",
    sender: "Maya Chen",
    email: "maya@northstar.co",
    subject: "Q4 vendor renewal - final terms",
    preview: "3 clauses changed from the previous agreement.",
    receivedAt: "9:42 AM",
    label: "ACTION",
    labelTone: "amber",
    unread: true,
    avatarTone: "green",
  },
  {
    id: "m2",
    accountId: "work",
    initials: "A",
    sender: "Alex Rivera",
    email: "alex@loomos.ai",
    subject: "Re: Launch checklist for Tuesday",
    preview: "The last open item is customer comms approval.",
    receivedAt: "8:16 AM",
    label: "FOLLOW UP",
    labelTone: "blue",
    unread: true,
    avatarTone: "blue",
  },
  {
    id: "m3",
    accountId: "work",
    initials: "N",
    sender: "Northstar",
    email: "billing@northstar.co",
    subject: "Your monthly statement is ready",
    preview: "Statement attached. No action needed.",
    receivedAt: "Yesterday",
    label: "FYI",
    labelTone: "neutral",
    avatarTone: "amber",
  },
  {
    id: "m4",
    accountId: "work",
    initials: "J",
    sender: "Jordan Lee",
    email: "jordan@loomos.ai",
    subject: "Can you review the attached brief?",
    preview: "Would love a quick gut check before I send it.",
    receivedAt: "Yesterday",
    label: "REVIEW",
    labelTone: "green",
    avatarTone: "brown",
  },
  {
    id: "m5",
    accountId: "work",
    initials: "R",
    sender: "Rina Patel",
    email: "rina@partner.co",
    subject: "Notes from our partner call",
    preview: "Sharing notes and the recording link for context.",
    receivedAt: "Mon",
    avatarTone: "blue",
  },
];

export const selectedMessage = {
  ...messages[0],
  body: `Hi Siyuan,

Attached is the updated renewal agreement. I highlighted the revised payment schedule and the new 30-day cancellation clause.

Could you confirm whether the legal language works for your side? If yes, I can route it for signature this afternoon.

Best,
Maya`,
  attachments: [
    {
      id: "a1",
      filename: "Northstar_Renewal_Agreement.pdf",
      kind: "PDF" as const,
      size: "482 KB",
      pages: "4 pages",
      status: "indexed" as const,
    },
  ],
};

export function mapApiAccount(account: {
  accountId: string;
  displayName: string;
  email: string;
  provider: string;
}): MailAccount {
  const color = account.accountId.toLowerCase().includes("personal") ? "amber" : "blue";
  return {
    id: account.accountId,
    name: account.displayName || account.email,
    email: account.email,
    provider: account.provider,
    color,
    unread: 0,
  };
}

export function mapApiMessage(message: {
  accountId: string;
  mailboxId: string;
  messageId: string;
  sender: string;
  subject: string;
  preview: string;
  receivedAt: string;
  isRead: boolean;
}): MailItem {
  const senderName = message.sender.split("<")[0]?.trim() || message.sender;
  const initials = senderName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const avatarTones = ["green", "blue", "amber", "brown"] as const;
  const toneIndex = [...message.messageId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    id: `${message.accountId}|${message.mailboxId}|${message.messageId}`,
    accountId: message.accountId,
    mailboxId: message.mailboxId,
    messageId: message.messageId,
    initials: initials || "?",
    sender: senderName,
    email: message.sender.match(/<([^>]+)>/)?.[1] ?? message.sender,
    subject: message.subject || "(无主题)",
    preview: message.preview,
    receivedAt: formatReceivedAt(message.receivedAt),
    receivedAtIso: message.receivedAt,
    label: message.isRead ? undefined : "NEW",
    labelTone: message.isRead ? undefined : "green",
    unread: !message.isRead,
    avatarTone: avatarTones[toneIndex % avatarTones.length],
  };
}

function formatReceivedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
