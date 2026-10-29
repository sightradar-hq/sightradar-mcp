import { z } from "zod";
import { seg } from "../client.js";
import { defineTool, dropUndefined, READ, WRITE, IDEMPOTENT_WRITE, DESTRUCTIVE } from "./define.js";

const dateish = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const usageTools = [
  defineTool({
    name: "get_balance",
    scope: "read",
    title: "Get credit balance",
    description:
      "Current credit balance of the account. 100,000 credits = US$1. Real-time index, search, selfie, detect = 93 credits; compare = 93 per image; batch photo and search_by_point_id = 62. Free.",
    input: () => ({}),
    annotations: READ,
    handler: (_a, { api }) => api.get("/v1/wallet"),
  }),

  defineTool({
    name: "get_usage",
    scope: "read",
    title: "Get usage",
    description:
      "Calls and credits spent, per operation. granularity=summary (default) gives totals per op; daily gives a day-by-day series including storage charges; storage gives the daily stored-vector count and storage credits. Use days (1-365) or a from/to date range (YYYY-MM-DD). Free.",
    input: () => ({
      granularity: z.enum(["summary", "daily", "storage"]).optional().describe("Default summary."),
      days: z.number().int().min(1).max(365).optional().describe("Look-back window in days (default 30; storage 90)."),
      from: dateish.describe("Start date YYYY-MM-DD (with to; not for storage)."),
      to: dateish.describe("End date YYYY-MM-DD (with from; not for storage)."),
    }),
    annotations: READ,
    handler: (a, { api }) => {
      const path =
        a.granularity === "daily" ? "/v1/usage/daily" : a.granularity === "storage" ? "/v1/usage/storage" : "/v1/usage";
      const range = a.granularity === "storage" ? {} : { from: a.from, to: a.to };
      return api.get(path, { query: { days: a.days, ...range } });
    },
  }),
];

export const accountTools = [
  defineTool({
    name: "list_api_keys",
    scope: "account",
    title: "List API keys",
    description:
      "List the account's API keys: id, prefix, name, status, created_at, last_used_at. The secret part is never shown again after creation. Free.",
    input: () => ({ status: z.enum(["active", "inactive"]).optional() }),
    annotations: READ,
    handler: (a, { api }) => api.get("/portal/keys", { query: { status: a.status } }),
  }),

  defineTool({
    name: "create_api_key",
    scope: "account",
    title: "Create an API key",
    description:
      "Create a new API key. The full key (plaintext) is returned ONCE in this answer and cannot be retrieved later: give it to the user and remind them to store it safely. An account can have up to 50 active keys. The account owner gets a security email. Free.",
    input: () => ({ name: z.string().min(1).max(120).optional().describe("Label shown in the key list.") }),
    annotations: WRITE,
    handler: (a, { api }) => api.post("/portal/keys", { json: a.name ? { name: a.name } : {} }),
  }),

  defineTool({
    name: "revoke_api_key",
    scope: "account",
    title: "Revoke an API key",
    description:
      "Revoke an API key immediately; anything using it stops working on its next request. Revoking the key this MCP connection uses disconnects it. Confirm with the user first. Free.",
    input: () => ({ key_id: z.string().uuid().describe("The id from list_api_keys (not the key itself).") }),
    annotations: DESTRUCTIVE,
    handler: (a, { api }) => api.delete(`/portal/keys/${seg(a.key_id)}`),
  }),

  defineTool({
    name: "get_profile",
    scope: "account",
    title: "Get account profile",
    description: "Account email, name, first/last name and organization name. Free.",
    input: () => ({}),
    annotations: READ,
    handler: (_a, { api }) => api.get("/portal/profile"),
  }),

  defineTool({
    name: "update_profile",
    scope: "account",
    title: "Update account profile",
    description: "Change the first name, last name or organization shown on the account and invoices. Free.",
    input: () => ({
      first_name: z.string().max(100).optional(),
      last_name: z.string().max(100).optional(),
      organization: z.string().max(200).optional(),
    }),
    annotations: IDEMPOTENT_WRITE,
    // The API keeps any field left out of the body.
    handler: (a, { api }) =>
      api.put("/portal/profile", {
        json: dropUndefined({ first_name: a.first_name, last_name: a.last_name, organization: a.organization }),
      }),
  }),

  defineTool({
    name: "get_billing_settings",
    scope: "account",
    title: "Get billing settings",
    description:
      "Auto-recharge configuration (enabled, threshold_credits, recharge_credits, whether a payment mandate exists, pause state, platform minimums) and recent orders/payments (amount, currency, status, whether an invoice exists). Free.",
    input: () => ({
      include_orders: z.boolean().optional().describe("Also list recent orders (default true)."),
      order_status: z.enum(["succeeded", "failed", "incomplete", "refunded"]).optional(),
      order_limit: z.number().int().min(1).max(100).optional().describe("Orders per page (default 25)."),
      before_occurred: z.string().optional().describe("Orders paging cursor: next_before_occurred."),
      before_id: z.string().optional().describe("Orders paging cursor: next_before_id."),
    }),
    annotations: READ,
    handler: async (a, { api }) => {
      const recharge = await api.get("/portal/auto-recharge");
      if (a.include_orders === false) return recharge;
      const orders = await api.get("/portal/orders", {
        query: {
          status: a.order_status,
          limit: a.order_limit,
          before_occurred: a.before_occurred,
          before_id: a.before_id,
        },
      });
      return { ...recharge, data: { auto_recharge: recharge.data, orders: orders.data } };
    },
  }),

  defineTool({
    name: "update_auto_recharge",
    scope: "account",
    title: "Configure auto-recharge",
    description:
      "Turn automatic top-ups on or off. When the balance drops below threshold_credits the saved payment method is charged for recharge_credits. Enabling needs a saved payment mandate (set up on sightradar.com) and amounts at or above the platform minimums from get_billing_settings. This can charge the user's card: confirm the amounts with them first.",
    input: () => ({
      enabled: z.boolean(),
      threshold_credits: z.number().int().min(0).describe("Recharge when the balance falls below this."),
      recharge_credits: z.number().int().min(0).describe("Credits to buy per recharge."),
    }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) => api.put("/portal/auto-recharge", { json: a }),
  }),

  defineTool({
    name: "get_invoice",
    scope: "account",
    title: "Download an invoice",
    description: "Fetch the PDF invoice of a paid order (payment id from get_billing_settings orders). Free.",
    input: () => ({ payment_id: z.string().min(1).describe("dodo_payment_id of the order.") }),
    annotations: READ,
    handler: async (a, { api }) => {
      const { bytes, contentType } = await api.getBytes(`/portal/orders/${seg(a.payment_id)}/invoice`, 8 * 1024 * 1024);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        mcp: {
          content: [
            { type: "text", text: `Invoice for payment ${a.payment_id} (${bytes.byteLength} bytes).` },
            {
              type: "resource",
              resource: {
                uri: `sightradar://invoices/${encodeURIComponent(a.payment_id)}.pdf`,
                mimeType: contentType.split(";")[0] || "application/pdf",
                blob: btoa(bin),
              },
            },
          ],
        },
      };
    },
  }),

  defineTool({
    name: "get_notification_settings",
    scope: "account",
    title: "Get notification settings",
    description:
      "Email alert settings (low-balance threshold, daily summary, runway alert) and the extra recipients who get them, with per-recipient categories (billing, webhook_failure). Free.",
    input: () => ({}),
    annotations: READ,
    handler: async (_a, { api }) => {
      const prefs = await api.get("/portal/notifications");
      const recipients = await api.get("/portal/notifications/recipients");
      return { ...prefs, data: { preferences: prefs.data, recipients: recipients.data } };
    },
  }),

  defineTool({
    name: "update_notification_settings",
    scope: "account",
    title: "Update notification settings",
    description:
      "Change email alerts. balance_alert_threshold_credits sets the low-balance alert; pass disable_balance_alert=true to turn it off. Fields you omit are unchanged. Free.",
    input: () => ({
      balance_alert_threshold_credits: z.number().int().positive().optional(),
      disable_balance_alert: z.boolean().optional(),
      daily_summary_enabled: z.boolean().optional(),
      runway_alert_enabled: z.boolean().optional(),
    }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) => {
      const body: Record<string, unknown> = {};
      if (a.disable_balance_alert) body.balance_alert_threshold_credits = null;
      else if (a.balance_alert_threshold_credits !== undefined)
        body.balance_alert_threshold_credits = a.balance_alert_threshold_credits;
      if (a.daily_summary_enabled !== undefined) body.daily_summary_enabled = a.daily_summary_enabled;
      if (a.runway_alert_enabled !== undefined) body.runway_alert_enabled = a.runway_alert_enabled;
      return api.put("/portal/notifications", { json: body });
    },
  }),

  defineTool({
    name: "manage_notification_recipient",
    scope: "account",
    title: "Manage alert recipients",
    description:
      "Add, remove or configure an extra email address that receives account alerts. action=add sends a confirmation email the person must click. action=set_category turns one category (billing or webhook_failure) on or off for a recipient. action=remove deletes it. Free.",
    input: () => ({
      action: z.enum(["add", "remove", "set_category"]),
      email: z.string().email().optional().describe("action=add: address to add."),
      label: z.string().max(100).optional().describe("action=add: a note such as 'finance'."),
      recipient_id: z.number().int().positive().optional().describe("remove / set_category: recipient id."),
      category: z.enum(["billing", "webhook_failure"]).optional().describe("set_category: which alerts."),
      enabled: z.boolean().optional().describe("set_category: on or off."),
    }),
    annotations: WRITE,
    handler: (a, { api }) => {
      if (a.action === "add") {
        if (!a.email) throw new Error("action=add needs email.");
        return api.post("/portal/notifications/recipients", { json: { email: a.email, label: a.label ?? "" } });
      }
      if (!a.recipient_id) throw new Error(`action=${a.action} needs recipient_id.`);
      if (a.action === "remove") return api.delete(`/portal/notifications/recipients/${a.recipient_id}`);
      if (!a.category || a.enabled === undefined) throw new Error("set_category needs category and enabled.");
      return api.put(`/portal/notifications/recipients/${a.recipient_id}/categories`, {
        json: { category: a.category, enabled: a.enabled },
      });
    },
  }),

  defineTool({
    name: "list_team_members",
    scope: "account",
    title: "List team members",
    description:
      "People with access to this SightRadar organization and their roles. Inviting, removing and transferring ownership are done by the founder on sightradar.com. Free.",
    input: () => ({}),
    annotations: READ,
    handler: (_a, { api }) => api.get("/portal/org/members"),
  }),
];
