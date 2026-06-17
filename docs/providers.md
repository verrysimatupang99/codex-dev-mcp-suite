# Provider smoke matrix

_Generated 2026-06-17T01:58:41.412Z_

| Provider | Kind | Status | Latency | HTTP | Sample / dim | Error |
|---|---|---|---|---|---|---|
| groq | chat | ✓ | 430ms | 200 | `OK` |  |
| cerebras | chat | ✓ | 554ms | 200 | — |  |
| openai | chat | ✗ | 158ms | 401 | — | {"error":{"message":"unauthorized client detected, contact support for assistance at https://discord.com/invite/V6kaP6Rg44"},"message":"UNAUTHENTICATED","success":false,"type":"unauthorized_client_err |
| openai | embed | ✗ | 147ms | 401 | — | {"error":{"message":"unauthorized client detected, contact support for assistance at https://discord.com/invite/V6kaP6Rg44"},"message":"UNAUTHENTICATED","success":false,"type":"unauthorized_client_err |
| anthropic | chat | ✓ | 5.83s | 200 | — |  |
| cloudflare | chat | ✗ | 907ms | 400 | — | {"errors":[{"message":"AiError: Bad input: Error: oneOf at '/' not met, 0 matches: required properties at '/' are 'text', required properties at '/' are 'requests' (f3f58c5f-7207-461a-96e1-d809e15ede3 |
| cloudflare | embed | ✓ | 194ms | 200 | dim=768 |  |
