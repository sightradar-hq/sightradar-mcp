import { z } from "zod";
import { seg } from "../client.js";
import { defineTool, READ, WRITE, DESTRUCTIVE, IDEMPOTENT_WRITE } from "./define.js";

export const webhookTools = [
  defineTool({
    name: "list_webhooks",
    scope: "read",
    title: "List webhooks",
    description: "List webhook endpoints (id, url, status, created_at). Optionally filter by status. Free.",
    input: () => ({
      status: z.enum(["active", "inactive"]).optional().describe("Only endpoints in this state."),
    }),
    annotations: READ,
    handler: (a, { api }) => api.get("/v1/webhooks", { query: { status: a.status } }),
  }),

  defineTool({
    name: "create_webhook",
    scope: "write",
    title: "Add a webhook",
    description:
      "Register a public HTTPS URL to receive batch-completion and deletion events. Each delivery is signed: X-SightRadar-Signature = hex HMAC-SHA256(secret, '<X-SightRadar-Timestamp>.<raw body>'). If you omit secret one is generated and returned ONCE in this answer: tell the user to store it. Free.",
    input: () => ({
      url: z.string().url().describe("Public https:// URL that will receive POSTs."),
      secret: z.string().min(16).optional().describe("Signing secret to use. Omit to have one generated."),
    }),
    annotations: WRITE,
    handler: (a, { api }) =>
      api.post("/v1/webhooks", { json: a.secret ? { url: a.url, secret: a.secret } : { url: a.url } }),
  }),

  defineTool({
    name: "delete_webhook",
    scope: "delete",
    title: "Disable a webhook",
    description: "Stop deliveries to a webhook endpoint. Already-disabled endpoints succeed again. Free.",
    input: () => ({ webhook_endpoint_id: z.string().min(1).describe("Id from list_webhooks.") }),
    annotations: DESTRUCTIVE,
    handler: (a, { api }) => api.delete(`/v1/webhooks/${seg(a.webhook_endpoint_id)}`),
  }),

  defineTool({
    name: "list_webhook_failures",
    scope: "read",
    title: "List failed webhook deliveries",
    description:
      "Deliveries that gave up after all retries (9 attempts): delivery_id, endpoint, url, attempts, last status code and error. Free.",
    input: () => ({
      limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50, max 200)."),
    }),
    annotations: READ,
    handler: (a, { api }) => api.get("/v1/webhooks/dead-letters", { query: { limit: a.limit } }),
  }),

  defineTool({
    name: "replay_webhook_failures",
    scope: "write",
    title: "Replay failed webhook deliveries",
    description:
      "Send failed deliveries again. Pass delivery_ids to replay specific ones, or omit to replay all of them. Returns how many were requeued. Free.",
    input: () => ({
      delivery_ids: z.array(z.string().min(1)).min(1).optional().describe("Specific deliveries; omit for all."),
    }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) =>
      api.post("/v1/webhooks/dead-letters/replay", {
        json: a.delivery_ids ? { delivery_ids: a.delivery_ids } : {},
      }),
  }),
];
