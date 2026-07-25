/**
 * Typed mirror of ../../docs/PROTOCOL.md. Keep these two in sync — if you
 * add or change a message shape here, update PROTOCOL.md in the same change
 * (and vice versa). This file must never encode anything specific to one
 * CLI agent; `agent` is always a free-form string picked from a simple list.
 */

// ---- phone -> backend/agent -------------------------------------------

export interface RegisterPhoneMessage {
  type: "register";
  phone_id: string;
}

export interface ProjectsListMessage {
  type: "projects.list";
  device_id: string;
}

export interface TaskStartMessage {
  type: "task.start";
  task_id: string;
  device_id: string;
  agent: string;
  project_id: string;
  prompt: string;
  /** Echo back a prior task.result's session_id to continue that
   * conversation (e.g. answering a clarifying question) instead of starting
   * a fresh one. Adapter-specific and opaque; omit to start fresh. */
  resume_session_id?: string;
}

export interface TaskRevertMessage {
  type: "task.revert";
  task_id: string;
  device_id: string;
  project_id: string;
  checkpoint: string;
}

export interface ApprovalResponseMessage {
  type: "approval.response";
  req_id: string;
  allow: boolean;
}

export interface ProjectRegisterMessage {
  type: "project.register";
  req_id: string;
  device_id: string;
  display_name: string;
  /** The one place a phone ever sends a laptop filesystem path — see
   * docs/PROTOCOL.md's Project registration section for why that's allowed
   * here despite the backend never storing/parsing local paths elsewhere. */
  local_path: string;
}

export type PhoneOutgoingMessage =
  | RegisterPhoneMessage
  | ProjectsListMessage
  | TaskStartMessage
  | TaskRevertMessage
  | ApprovalResponseMessage
  | ProjectRegisterMessage;

// ---- backend/agent -> phone --------------------------------------------

export interface DevicesMessage {
  type: "devices";
  online: string[];
}

export interface ProjectSummary {
  project_id: string;
  display_name: string;
  current_branch?: string;
  last_commit_hash?: string;
  remote_url?: string;
}

export interface ProjectsMessage {
  type: "projects";
  device_id: string;
  projects: ProjectSummary[];
}

/** `data` is opaque per PROTOCOL.md — its shape is the devagent/adapter's
 * business, not ours. We only special-case the small set of `kind` values
 * the devagent itself emits (checkpoint/error/stderr/raw/revert); anything
 * else (e.g. a CLI agent's own structured output) is rendered generically so
 * the phone never has to know about a specific agent. */
export interface LogMessage {
  type: "log";
  task_id: string;
  data: Record<string, unknown>;
}

export interface ApprovalRequestMessage {
  type: "approval.request";
  task_id: string;
  req_id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface TaskResultMessage {
  type: "task.result";
  task_id: string;
  checkpoint: string;
  files: string[];
  stat: { insertions: number; deletions: number };
  /** Opaque id to replay as resume_session_id on a follow-up task.start for
   * the same project; null if this agent adapter doesn't support resuming. */
  session_id: string | null;
}

export interface ErrorMessage {
  type: "error";
  reason: string;
  detail?: string;
  device_id?: string;
}

export interface ProjectRegisterResultMessage {
  type: "project.register.result";
  req_id: string;
  device_id: string;
  ok: boolean;
  project?: ProjectSummary;
  error?: string;
}

export type PhoneIncomingMessage =
  | DevicesMessage
  | ProjectsMessage
  | LogMessage
  | ApprovalRequestMessage
  | TaskResultMessage
  | ErrorMessage
  | ProjectRegisterResultMessage;

// Agents are a free-form string per PROTOCOL.md; this is only the set of
// options the UI offers to pick from — adding one here does not require any
// protocol or backend change, only a matching devagent adapter.
export const AGENT_OPTIONS = ["claude", "gemini", "codex"] as const;
