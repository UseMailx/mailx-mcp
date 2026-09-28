# @usemailx/mcp

MCP server exposing the MailX API to AI agents (Claude, etc.). Tools are organized in three
risk tiers — read, prepare, execute — so an agent can inspect and check things safely before
ever taking an action with a real side effect.

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
MailX instance. Use an API key scoped to only what the agent should be able to do (see
MailX's scope model) — this server enforces nothing itself beyond what the key allows.

## Tools

**Read** (no side effects):

- `whoami` — the authenticated organization and this API key's own identity/scopes
- `list_domains` / `get_domain`
- `list_templates` / `get_template`
- `list_emails` / `get_email`
- `get_email_events` — diagnose an email's delivery: timeline + per-attempt SMTP outcome
- `list_webhooks`

**Prepare** (computes something, still no side effects):

- `preview_template` — render a template's subject/text/html with given variables

**Execute** (real side effects):

- `add_domain` / `verify_domain`
- `create_template`
- `send_email` — always pass `idempotency_key`; a retried call with the same key returns
  the original result instead of sending again
- `create_webhook`

## Develop

```bash
npm install
npm run build
MAILX_API_KEY=... node dist/index.js
```
