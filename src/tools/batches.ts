import { z } from "zod";
import { seg } from "../client.js";
import { defineTool, READ, WRITE } from "./define.js";

const batchId = z.string().uuid().describe("Batch id returned by submit_batch.");

export const batchTools = [
  defineTool({
    name: "submit_batch",
    scope: "write",
    title: "Submit a batch job",
    description:
      "Queue up to 1000 photo URLs for background processing. op=index stores their faces in the collection; op=match matches them against the collection. Submitting is free; each photo costs 62 credits when it is processed. Returns batch_id; poll get_batch or register a webhook to hear when it finishes. URLs are not checked at submit time: unreachable ones fail individually later.",
    input: () => ({
      collection_id: z.string().min(1).max(255).describe("Collection to index into or match against."),
      op: z.enum(["index", "match"]).describe("index = store faces; match = search with each photo."),
      photos: z
        .array(
          z.object({
            url: z.string().url().max(8192).describe("Public http(s) URL of the photo."),
            external_id: z.string().max(255).optional().describe("Your id for the photo (becomes its photo_id)."),
          }),
        )
        .min(1)
        .max(1000)
        .describe("Photos to process (1-1000)."),
      webhook_endpoint_id: z.string().optional().describe("Webhook to notify when the batch completes."),
      override: z.boolean().optional().describe("op=index only: replace faces of photos indexed before."),
      idempotency_key: z
        .string()
        .max(255)
        .optional()
        .describe("Reusing a key returns the original batch instead of creating a duplicate."),
    }),
    annotations: WRITE,
    billable: true,
    handler: (a, { api }) =>
      api.post("/v1/batches", {
        json: {
          collection_id: a.collection_id,
          op: a.op,
          photos: a.photos,
          ...(a.webhook_endpoint_id ? { webhook_endpoint_id: a.webhook_endpoint_id } : {}),
          ...(a.override ? { override: true } : {}),
        },
        idempotencyKey: a.idempotency_key,
      }),
  }),

  defineTool({
    name: "list_batches",
    scope: "read",
    title: "List batch jobs",
    description:
      "List recent batch jobs newest first with status and succeeded/failed/pending counts. For the next page pass next_before_created and next_before_id from the previous answer. Free.",
    input: () => ({
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, max 100)."),
      before_created: z.string().optional().describe("Paging cursor: next_before_created from the last page."),
      before_id: z.string().optional().describe("Paging cursor: next_before_id from the last page."),
    }),
    annotations: READ,
    handler: (a, { api }) =>
      api.get("/v1/batches", {
        query: { limit: a.limit, before_created: a.before_created, before_id: a.before_id },
      }),
  }),

  defineTool({
    name: "get_batch",
    scope: "read",
    title: "Get batch status",
    description:
      "Status of one or many batch jobs: status, total_photos, succeeded, failed, pending. Pass batch_id for one, or batch_ids (up to 5000) for many at once; ids you don't own are left out. Free.",
    input: () => ({
      batch_id: batchId.optional(),
      batch_ids: z.array(z.string().uuid()).min(1).max(5000).optional().describe("Several batch ids at once."),
    }),
    annotations: READ,
    handler: async (a, { api }) => {
      if (a.batch_ids?.length) return api.post("/v1/batches/statuses", { json: { batch_ids: a.batch_ids } });
      if (!a.batch_id) throw new Error("Provide batch_id or batch_ids.");
      return api.get(`/v1/batches/${seg(a.batch_id)}`);
    },
  }),

  defineTool({
    name: "get_batch_photos",
    scope: "read",
    title: "Get per-photo batch results",
    description:
      "Per-photo results of a batch: external_id, status, face_count and reason_code for failures. Page with after_index = next_after_index. Free.",
    input: () => ({
      batch_id: batchId,
      limit: z.number().int().min(1).max(1000).optional().describe("Page size (default 500, max 1000)."),
      after_index: z.number().int().min(-1).optional().describe("Paging cursor: next_after_index from the last page."),
    }),
    annotations: READ,
    handler: (a, { api }) =>
      api.get(`/v1/batches/${seg(a.batch_id)}/photos`, { query: { limit: a.limit, after_index: a.after_index } }),
  }),

  defineTool({
    name: "requeue_failed_batch_photos",
    scope: "write",
    title: "Retry failed batch photos",
    description:
      "Retry batch photos that failed for a given reason, in two steps. First call with execute=false to get a preview: how many photos match, the estimated credit cost and a preview_id (valid 10 minutes, usable once). Show that to the user, then call again with execute=true and the preview_id. Requeued photos cost 62 credits each when processed.",
    input: () => ({
      execute: z.boolean().describe("false = preview only; true = run a preview (needs preview_id)."),
      preview_id: z.string().optional().describe("From the preview step; required when execute=true."),
      reason_code: z
        .enum(["insufficient_credits", "internal_error", "retry_exhausted"])
        .optional()
        .describe("Preview step: which failures to retry."),
      limit: z.number().int().min(1).max(5000).optional().describe("Preview step: max photos (default 500)."),
      created_after: z.string().optional().describe("Preview step: only batches created after this RFC 3339 time."),
      created_before: z.string().optional().describe("Preview step: only batches created before this RFC 3339 time."),
      stagger_seconds: z.number().int().min(0).max(60).optional().describe("Preview step: spread the retries out."),
    }),
    annotations: WRITE,
    billable: true,
    handler: (a, { api }) => {
      if (a.execute) {
        if (!a.preview_id) throw new Error("execute=true needs the preview_id from a preview call.");
        return api.post("/v1/batches/failed/requeue", { json: { preview_id: a.preview_id, execute: true } });
      }
      if (!a.reason_code) throw new Error("The preview step needs reason_code.");
      return api.post("/v1/batches/failed/requeue", {
        json: {
          execute: false,
          reason_code: a.reason_code,
          ...(a.limit !== undefined ? { limit: a.limit } : {}),
          ...(a.created_after ? { created_after: a.created_after } : {}),
          ...(a.created_before ? { created_before: a.created_before } : {}),
          ...(a.stagger_seconds !== undefined ? { stagger_seconds: a.stagger_seconds } : {}),
        },
      });
    },
  }),
];
