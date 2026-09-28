#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Base URL / API key follow the same override convention as MailX's SDKs
// and CLI (MAILX_API_KEY, MAILX_API_BASE_URL) — see mailx-* SDK repos and
// UseMailx/mailx-cli.
const baseUrl = (process.env.MAILX_API_BASE_URL ?? "https://api.mailx.dev/v1").replace(/\/$/, "");
const apiKey = process.env.MAILX_API_KEY;
if (!apiKey) {
  console.error("MAILX_API_KEY is required.");
  process.exit(1);
}

async function mailx<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MailX API error (${response.status}): ${body}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

const server = new McpServer({ name: "mailx", version: "0.2.0" });

// ---------------------------------------------------------------- READ ----
// Read tools have no side effects and need no confirmation - this is the
// tier an agent should reach for first, and the tier this server exposes
// most of (spec: start MCP with a small, read-first surface).

server.tool("whoami", "Show the authenticated organization and this API key's own identity/scopes.", {}, async () => {
  return json(await mailx("/whoami"));
});

server.tool("list_domains", "List sending domains for this account.", {}, async () => {
  return json(await mailx("/domains?limit=100"));
});

server.tool(
  "get_domain",
  "Get one sending domain, including its DNS ownership record and verification status.",
  { id: z.string().describe("Domain ID, from list_domains") },
  async ({ id }) => json(await mailx(`/domains/${encodeURIComponent(id)}`)),
);

server.tool("list_templates", "List saved email templates.", {}, async () => {
  return json(await mailx("/templates?limit=100"));
});

server.tool(
  "get_template",
  "Get one email template's subject/text/html.",
  { id: z.string().describe("Template ID, from list_templates") },
  async ({ id }) => json(await mailx(`/templates/${encodeURIComponent(id)}`)),
);

server.tool("list_emails", "List sent/queued emails for this account.", {}, async () => {
  return json(await mailx("/emails?limit=100"));
});

server.tool(
  "get_email",
  "Get one email's current state (from/to/subject/status).",
  { id: z.string().describe("Message ID, from list_emails or send_email's result") },
  async ({ id }) => json(await mailx(`/emails/${encodeURIComponent(id)}`)),
);

server.tool(
  "get_email_events",
  "Diagnose an email's delivery: its lifecycle timeline and, for each delivery attempt, the SMTP outcome and failure classification. Use this to explain WHY an email did what it did, in developer-facing terms - never MailX's own internal infrastructure identifiers.",
  { id: z.string().describe("Message ID, from list_emails or send_email's result") },
  async ({ id }) => json(await mailx(`/emails/${encodeURIComponent(id)}/events`)),
);

server.tool("list_webhooks", "List configured webhook endpoints.", {}, async () => {
  return json(await mailx("/webhooks?limit=100"));
});

// ------------------------------------------------------------- PREPARE ----
// Preparation tools render/compute something but never send, create, or
// change anything - safe to call speculatively while composing an email.

server.tool(
  "preview_template",
  "Render a template's subject/text/html with given variables, without sending anything. Use this before send_email to check a template looks right.",
  {
    id: z.string().describe("Template ID, from list_templates"),
    variables: z.record(z.string()).optional().describe("Template variables, e.g. { name: 'Ada' }"),
  },
  async ({ id, variables }) =>
    json(await mailx(`/templates/${encodeURIComponent(id)}/preview`, { method: "POST", body: { variables: variables ?? {} } })),
);

// ------------------------------------------------------------- EXECUTE ----
// Execute tools have real side effects. send_email supports an idempotency
// key so a retried call (e.g. because the agent didn't see the response)
// can never double-send - always set one when calling this on behalf of a
// user-visible action.

server.tool(
  "add_domain",
  "Add a new sending domain. Returns the TXT record to publish for ownership verification.",
  { name: z.string().describe("Domain name, e.g. example.com") },
  async ({ name }) => json(await mailx("/domains", { method: "POST", body: { name } })),
);

server.tool(
  "verify_domain",
  "Re-check DNS ownership verification for a pending domain.",
  { id: z.string().describe("Domain ID, from list_domains or add_domain's result") },
  async ({ id }) => json(await mailx(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" })),
);

server.tool(
  "create_template",
  "Create a reusable email template. Use {{variable}} placeholders in subject/text/html.",
  {
    name: z.string(),
    subject: z.string(),
    text: z.string().optional(),
    html: z.string().optional(),
  },
  async (input) => json(await mailx("/templates", { method: "POST", body: input })),
);

server.tool(
  "send_email",
  "Send an email through MailX. The from address must belong to a verified sending domain. Either provide subject/text/html directly, or template_id (+ variables) to send a saved Template - never both. Always pass idempotency_key so a retried call cannot send twice.",
  {
    from: z.string().describe("Sender address, e.g. hello@yourdomain.com"),
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    template_id: z.string().optional().describe("Send a saved Template instead of raw subject/text/html"),
    variables: z.record(z.string()).optional().describe("Template variables, only with template_id"),
    idempotency_key: z
      .string()
      .describe("A key unique to this logical send. Retrying with the same key returns the original result instead of sending again."),
  },
  async ({ idempotency_key, ...body }) =>
    json(await mailx("/emails", { method: "POST", body, idempotencyKey: idempotency_key })),
);

server.tool(
  "create_webhook",
  "Register a webhook endpoint for delivery events.",
  {
    url: z.string().url(),
    events: z
      .array(z.enum(["email.queued", "email.delivered", "email.delivery_delayed", "email.failed", "email.bounced", "email.suppressed"]))
      .min(1),
  },
  async (input) => json(await mailx("/webhooks", { method: "POST", body: input })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
