export function deterministicEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.MCP_DETERMINISTIC_FALLBACK || "").trim());
}
