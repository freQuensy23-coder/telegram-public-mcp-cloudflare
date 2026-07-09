# telegram-public-mcp-cloudflare

Public Telegram MCP server for Cloudflare Workers. It reads public Telegram channel pages at `t.me/s/{channel}` and exposes them as MCP tools over Streamable HTTP/JSON-RPC.

No Telegram API credentials are required. The server only fetches public web pages.

## Public hosted instance

Anyone can use the deployed public MCP endpoint:

```text
https://telegram-public-mcp-cf.mametevalex.workers.dev/mcp
```

Health check:

```text
https://telegram-public-mcp-cf.mametevalex.workers.dev/healthz
```

## Tools

| Tool | Description |
|---|---|
| `get_channel_info` | Public channel title, description, avatar, subscriber counter, canonical URL. |
| `get_latest_posts` | Latest public posts with text, images, views, timestamps, pagination by `before_post_id` or `before_time`. |
| `search_posts` | Telegram public web search via `https://t.me/s/{channel}?q=...`. |

## Endpoints

Live Cloudflare deployment:

- `GET https://telegram-public-mcp-cf.mametevalex.workers.dev/healthz` — health check.
- `POST https://telegram-public-mcp-cf.mametevalex.workers.dev/mcp` — MCP JSON-RPC endpoint.

Generic endpoints:

- `GET /healthz` — health check.
- `POST /mcp` — MCP JSON-RPC endpoint.

## Deploy

```bash
npm install
npx wrangler deploy
```

`wrangler.toml`:

```toml
name = "telegram-public-mcp-cf"
main = "src/worker.js"
compatibility_date = "2026-07-09"

[vars]
TELEGRAM_BASE_URL = "https://t.me"
```

## MCP examples

List tools:

```bash
curl -s https://telegram-public-mcp-cf.<account>.workers.dev/mcp \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

Get latest posts:

```bash
curl -s https://telegram-public-mcp-cf.<account>.workers.dev/mcp \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_latest_posts","arguments":{"channel":"telegram","limit":3}}}' | jq
```

## Hermes Agent config

```yaml
mcp_servers:
  telegram-public:
    url: https://telegram-public-mcp-cf.mametevalex.workers.dev/mcp
    timeout: 120
    connect_timeout: 60
```

## Limitations

- Only public Telegram channels are supported.
- Telegram can change `t.me/s` HTML; parser updates may be needed.
- Subscriber/view counts are returned as Telegram renders them.

## License

MIT
