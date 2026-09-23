/** Minimal Prometheus text parser: sums every series of a metric, ignoring labels. */
export function parsePrometheus(text: string) {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const v = Number(m[3]);
    if (Number.isNaN(v)) continue;
    out.set(m[1]!, (out.get(m[1]!) ?? 0) + v);
  }
  return out;
}
