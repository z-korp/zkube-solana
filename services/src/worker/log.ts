// The Worker's one log sink. Whatever a dependency puts in an error, no
// configured secret and no endpoint path or query reaches a log line.

const URL_PATTERN = /https?:\/\/[^\s"'\\<>]+/g;

/** A JSON log line with every secret value removed and every URL cut down to its host. */
export function logLine(event: unknown, secrets: readonly (string | undefined)[]): string {
  let line = JSON.stringify(event);
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    // A secret appears as written, or escaped once more inside a quoted error.
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) line = line.split(form).join("[redacted]");
  }
  return line.replace(URL_PATTERN, (url) => {
    try { return new URL(url).host; } catch { return "[redacted]"; }
  });
}
