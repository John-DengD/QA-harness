const MIN_LENGTH = 8;

export function makeRedactor(secrets: string[]): (text: string) => string {
  const usable = [...new Set(secrets.filter((s) => s.length >= MIN_LENGTH))].sort((a, b) => b.length - a.length);
  return (text) => usable.reduce((t, s) => t.split(s).join("[REDACTED]"), text);
}
