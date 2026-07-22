export function formatErrorMessage(
  error: unknown,
  fallback = "Operation failed.",
): string {
  if (error instanceof Error) {
    return error.message.trim() || fallback;
  }

  if (typeof error === "string") {
    return error.trim() || fallback;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }

  return fallback;
}
