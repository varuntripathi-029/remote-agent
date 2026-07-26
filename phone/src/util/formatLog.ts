export type LogVariant = "info" | "success" | "error" | "muted" | "user" | "assistant" | "tool";

export interface FormattedLog {
  text: string;
  variant: LogVariant;
}

const MAX_LINE_LENGTH = 600;

function truncate(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;
}

/**
 * Render one `log` message's `data` field for the terminal view.
 *
 * `data` is opaque per PROTOCOL.md. We only special-case the small set of
 * `kind` values the devagent core itself emits (checkpoint/error/stderr/raw/
 * revert — see devagent/main.py) since those are shared across every CLI
 * agent adapter. Anything else (an agent's own structured output, e.g. a
 * CLI's stream-json events) is rendered with a generic, agent-agnostic
 * fallback — this file must never know what "claude" is.
 */
export function formatLog(data: Record<string, unknown>): FormattedLog {
  const kind = data.kind;

  if (kind === "checkpoint") {
    const sha = String(data.checkpoint ?? "").slice(0, 12);
    return { text: `✓ checkpoint ${sha}`, variant: "success" };
  }
  if (kind === "error") {
    return { text: `✗ ERROR: ${data.message}`, variant: "error" };
  }
  if (kind === "stderr") {
    return { text: `[stderr] ${data.text}`, variant: "error" };
  }
  if (kind === "raw") {
    return { text: String(data.text ?? ""), variant: "muted" };
  }
  if (kind === "revert") {
    const sha = String(data.checkpoint ?? "").slice(0, 12);
    return { text: `↺ reverted to ${sha}`, variant: "success" };
  }

  // Generic fallback for opaque, agent-defined event shapes: label with the
  // event's own "type" field if it has one (a common convention, not
  // specific to any one CLI), otherwise dump compact JSON.
  const label = typeof data.type === "string" ? `[${data.type}] ` : "";
  return { text: truncate(`${label}${JSON.stringify(data)}`), variant: "info" };
}
