# @usemailx/mcp

MCP server exposing the MailX API to AI agents (Claude, etc.): send email, manage sending
domains, templates, and webhooks.

## Usage

```json
{
  "mcpServers": {
    "mailx": {
      "command": "npx",
      "args": ["-y", "@usemailx/mcp"],
      "env": {
        "MAILX_API_KEY": "mx_...",
        "MAILX_API_BASE_URL": "https://api.mailx.dev/v1"
      }
    }
  }
}
```

`MAILX_API_BASE_URL` defaults to the hosted API; override it to point at a self-hosted
MailX instance.

## Tools

- `send_email` — send a transactional email from a verified domain
- `list_domains` / `add_domain` / `verify_domain`
- `list_templates` / `create_template`
- `list_webhooks` / `create_webhook`

## Develop

```bash
pnpm install
pnpm build
MAILX_API_KEY=... node dist/index.js
```
