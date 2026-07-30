/**
 * Redact secrets before logs / diagnostics leave the process.
 * Never log API keys, passwords, bearer tokens, or long prompt bodies.
 */

const ASSIGNMENT_KEYS =
  /(?:password|passwd|pwd|api[_-]?key|apikey|authorization|token|secret)\s*[:=]\s*([^\s,;&"']+)/gi;

const BEARER = /\bbearer\s+[A-Za-z0-9._\-+=/]+/gi;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_\-]+/g;
const JDBC_PWD = /((?:password|pwd)=)([^;&\s]+)/gi;

/** Truncate very long blobs (prompts, payloads) so diagnostics stay pasteable. */
const MAX_MESSAGE_CHARS = 2_000;

export function redactSecrets(input: string): string {
  let out = input;
  out = out.replace(ASSIGNMENT_KEYS, (full, value: string) =>
    full.slice(0, full.length - value.length) + "***",
  );
  out = out.replace(BEARER, "Bearer ***");
  out = out.replace(OPENAI_KEY, "sk-***");
  out = out.replace(JDBC_PWD, "$1***");
  return out;
}

export function sanitizeLogMessage(input: string): string {
  const redacted = redactSecrets(input).replace(/\s+/g, " ").trim();
  if (redacted.length <= MAX_MESSAGE_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
}
