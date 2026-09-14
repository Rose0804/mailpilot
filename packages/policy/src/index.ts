export type RiskLevel = "low" | "medium" | "high" | "critical";

export type MailAction =
  | "search"
  | "read"
  | "preview"
  | "create-draft"
  | "mark-read"
  | "archive"
  | "send"
  | "reply"
  | "batch-move"
  | "delete"
  | "change-account-permission"
  | "upload-sensitive-file";

const riskByAction: Record<MailAction, RiskLevel> = {
  search: "low",
  read: "low",
  preview: "low",
  "create-draft": "medium",
  "mark-read": "medium",
  archive: "medium",
  send: "high",
  reply: "high",
  "batch-move": "high",
  delete: "critical",
  "change-account-permission": "critical",
  "upload-sensitive-file": "critical",
};

export function riskForAction(action: MailAction): RiskLevel {
  return riskByAction[action];
}

export function requiresApproval(action: MailAction): boolean {
  const risk = riskForAction(action);
  return risk === "high" || risk === "critical";
}

export function canAutoExecute(action: MailAction): boolean {
  return !requiresApproval(action);
}
