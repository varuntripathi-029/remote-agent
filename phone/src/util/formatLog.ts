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

  // The remaining kinds are ones a CLI agent adapter may choose to emit
  // (see devagent/agents/claude.py's parse_event) after normalizing its own
  // output format — generic concepts (assistant text, a tool call, a tool's
  // result, a run summary) that apply to any coding CLI, not Claude
  // specifically, so this file still never has to know what "claude" is.
  if (kind === "session_init") {
    const model = typeof data.model === "string" ? data.model : "agent";
    return { text: `▷ session started · ${model} · ${data.tool_count ?? 0} tools`, variant: "muted" };
  }
  if (kind === "assistant_text") {
    return { text: `🤖 ${truncate(String(data.text ?? ""))}`, variant: "assistant" };
  }
  if (kind === "tool_use") {
    const tool = String(data.tool ?? "tool");
    return { text: `🔧 ${tool}: ${truncate(String(data.text ?? ""))}`, variant: "tool" };
  }
  if (kind === "tool_result") {
    const text = String(data.text ?? "");
    if (data.is_error) {
      return { text: `↳ ${text || "error"}`, variant: "error" };
    }
    return { text: `↳ ${truncate(text) || "done"}`, variant: "muted" };
  }
  if (kind === "result_summary") {
    const success = data.success !== false;
    const seconds =
      typeof data.duration_ms === "number" ? `${(data.duration_ms / 1000).toFixed(1)}s` : null;
    const cost = typeof data.cost_usd === "number" ? `$${data.cost_usd.toFixed(4)}` : null;
    const turns = typeof data.num_turns === "number" ? `${data.num_turns} turn(s)` : null;
    const stats = [seconds, cost, turns].filter(Boolean).join(" · ");
    const label = success ? "✔ done" : "✘ failed";
    return { text: stats ? `${label} · ${stats}` : label, variant: success ? "success" : "error" };
  }

  // Generic fallback for opaque, agent-defined event shapes: label with the
  // event's own "type" field if it has one (a common convention, not
  // specific to any one CLI), otherwise dump compact JSON.
  const label = typeof data.type === "string" ? `[${data.type}] ` : "";
  return { text: truncate(`${label}${JSON.stringify(data)}`), variant: "info" };
}
