# Troubleshooting — `@maximalabs/dev-mcp-suite`

First stop for every problem: run the server's `--doctor` flag. It prints
diagnostics **without starting the MCP loop** and never leaks secrets —
API keys are reported as `set (N chars)` or `not set`, never the value.

```bash
npx -y -p @maximalabs/dev-mcp-suite <server>-mcp --doctor
# e.g.
npx -y -p @maximalabs/dev-mcp-suite project-memory-mcp --doctor
```

## Reading doctor output

```
project-memory doctor
version: 1.4.0                        <- package version actually running
node: v22.14.0                        <- runtime version (needs >= 18)
storage dir: /home/you/.ai-shared-memory   <- where data lands (or env var override)
deterministic no-network: off         <- MCP_DETERMINISTIC_FALLBACK state
model/provider config (keys redacted):
  MCP_LLM_BASE_URL: https://...       <- (unset) means the env var is missing
  MCP_LLM_API_KEY: set (51 chars)     <- set ≠ valid; only proves the var exists
  MCP_PROVIDER_PRIMARY: deepseek      <- (unset) means default/disabled
```

Checks, in order:

1. **`version` is old** → the npx cache is stale. `npm cache clean npx` or pin a
   version (`-p @maximalabs/dev-mcp-suite@1.4.0`).
2. **`node` < 18** → the client is launching an old Node. Check `node -v` in a
   plain terminal; GUI clients may use a different PATH than your shell.
3. **Expected `MCP_*` vars show `(unset)` / `not set`** → the client config
   doesn't pass `env`. Each client declares it differently — see
   `docs/clients/<your-client>.md`.
4. **`deterministic no-network: on` unexpectedly** → `MCP_DETERMINISTIC_FALLBACK`
   is set in your shell or client `env`. Unset it to re-enable provider calls.

## Server starts but never answers

MCP servers speak JSON-RPC over **stdio**. They print nothing on success —
a silent process is a healthy process.

- Test the protocol by hand: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | <server>-mcp`
  should emit one JSON line and exit on EOF.
- `update available` notices go to **stderr**, never stdout — they cannot
  corrupt the protocol stream.
- If the client log shows `spawn ENOENT`, the `command` in your
  `mcpServers` entry is wrong — check `which npx` matches the client's PATH.

## Provider calls fail

| Symptom | Likely cause |
|---|---|
| 401/403 | `MCP_LLM_API_KEY`/`MCP_PROVIDER_PRIMARY_API_KEY` wrong or revoked — `set (N chars)` only proves presence |
| 429 | Provider quota/rate limit — wait or switch `MCP_PROVIDER_PRIMARY` |
| timeout / ECONNREFUSED | `MCP_LLM_BASE_URL` wrong, or network blocks egress |
| works offline but not online | `MCP_DETERMINISTIC_FALLBACK` masking a provider outage |

Run `provider-smoke` from the suite to probe chat & embedding endpoints
directly — it isolates "provider broken" from "server broken".

## Init wizard issues

- `dev-mcp-suite --dry-run` previews config changes without writing.
- `--version` / `--help` exit before the wizard — they can no longer write
  `mcpServers` entries by accident (regression-fixed in 1.4.x).
- Existing entries are updated in place; a backup is written next to each
  modified config.

## Still stuck

- File an issue with `--doctor` output attached (it's safe — values are redacted).
- Never paste raw client config containing API keys.
