#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Base URL / API key follow the same override convention as MailX's SDKs
// (MAILX_API_KEY, MAILX_API_BASE_URL) — see mailx-* SDK repos.
const baseUrl = (process.env.MAILX_API_BASE_URL ?? "https://api.mailx.dev/v1").replace(/\/$/, "");
const apiKey = process.env.MAILX_API_KEY;
if (!apiKey) {
  console.error("MAILX_API_KEY is required.");
  process.exit(1);
}

async function mailx<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MailX API error (${response.status}): ${body}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const server = new McpServer({ name: "mailx", version: "0.1.0" });

server.tool(
  "send_email",
  "Send a transactional email through MailX. The from address must belong to a verified sending domain.",
  {
    from: z.string().describe("Sender address, e.g. hello@yourdomain.com"),
    to: z.array(z.string()).min(1),
    subject: z.string(),
    text: z.string().optional(),
    html: z.string().optional(),
  },
  async (input) => {
    const result = await mailx("/emails", { method: "POST", body: input });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool("list_domains", "List sending domains for this account.", {}, async () => {
  const result = await mailx("/domains?limit=100");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.tool(
  "add_domain",
  "Add a new sending domain. Returns the TXT record to publish for ownership verification.",
  { name: z.string().describe("Domain name, e.g. example.com") },
  async ({ name }) => {
    const result = await mailx("/domains", { method: "POST", body: { name } });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool(
  "verify_domain",
  "Re-check DNS ownership verification for a pending domain.",
  { id: z.string() },
  async ({ id }) => {
    const result = await mailx(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool("list_templates", "List saved email templates.", {}, async () => {
  const result = await mailx("/templates?limit=100");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.tool(
  "create_template",
  "Create a reusable email template. Use {{variable}} placeholders in subject/text/html.",
  {
    name: z.string(),
    subject: z.string(),
    text: z.string().optional(),
    html: z.string().optional(),
  },
  async (input) => {
    const result = await mailx("/templates", { method: "POST", body: input });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool("list_webhooks", "List configured webhook endpoints.", {}, async () => {
  const result = await mailx("/webhooks?limit=100");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.tool(
  "create_webhook",
  "Register a webhook endpoint for delivery events.",
  {
    url: z.string().url(),
    events: z
      .array(z.enum(["email.queued", "email.delivered", "email.delivery_delayed", "email.failed", "email.bounced", "email.suppressed"]))
      .min(1),
  },
  async (input) => {
    const result = await mailx("/webhooks", { method: "POST", body: input });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
