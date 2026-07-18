/** Not cryptographically strong — good enough for phone_id/task_id/req_id,
 * which only need to be unique enough to route messages, not secret. */
export function generateId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${time}-${rand}`;
}
