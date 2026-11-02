import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { seg, type SightRadarApi } from "./client.js";
import type { ImageCapabilities } from "./images.js";

export const PRICING_URI = "sightradar://docs/pricing-and-limits";
export const COLLECTION_URI_TEMPLATE = "sightradar://collections/{collection_id}";

// Every number here is a gateway or engine default (gateway
// internal/config/config.go, engine app/config.py). Re-check them when either
// changes.
export function pricingAndLimitsMarkdown(images: ImageCapabilities): string {
  const base64Mb = Math.floor(images.maxBase64Bytes / (1024 * 1024));
  return `# SightRadar pricing and limits

## Credits

100,000 credits = US$1. Credits are charged per photo processed.

| Operation | Tool | Credits |
|---|---|---|
| Index a photo | index_photo | 93 |
| Search by selfie or embedding | search_faces | 93 |
| Register a selfie | register_selfie | 93 |
| Detect faces | detect_faces | 93 |
| Compare two faces | compare_faces | 93 per image side (186 for two images; 93 when one or both sides are embeddings) |
| Search by a stored selfie | search_by_point_id | 62 |
| Batch photo (index or match) | submit_batch | 62 per photo, charged when processed |
| Requeued batch photo | requeue_failed_batch_photos | the price stamped at submit, usually 62 |
| Face storage | (daily) | 600,000 credits per million stored faces per month, charged daily |

Some accounts are opted in to paying the real-time 93 credits for a batch of a single photo.
Everything else (collections, batch status, webhooks, usage, keys, billing settings) is free.
A billable call that fails before the engine answers is refunded. Sending the same idempotency_key again never charges twice.

## Rate limits

- 50 requests per second per API key, on the billable operations.
- An account can also be capped on billable requests in flight at once.
- Over a limit the API answers HTTP 429 (rate_limit_exceeded or concurrency_limit_exceeded). Wait and retry.

## Images

- Formats: JPEG, PNG, WebP, GIF, BMP, TIFF and HEIC.
- Largest file: 30 MB (larger uploads get HTTP 413). Base64 through this server: up to ${base64Mb} MB decoded.
- Images are downscaled to 4096 px on the longest side before detection.
- A face is kept only if its detection score is at least 0.6 and its box is at least 24 px on its shorter side. Up to 50 faces are stored per photo, largest first.
- Two faces match at cosine similarity 0.42 or above unless a threshold is given.
- A batch holds 1 to 1000 photo URLs. Batches take URLs only, not base64.

## Deletion

- delete_collection and delete_photo are soft by default: the data is hidden at once and purged after a 7-day grace period. restore_collection and restore_photo undo it until then.
- immediate=true purges now; compliance=true records an audited legal erasure. Neither can be undone.
- get_deletion_status shows the purge progress; phase=completed with verified_zero=true means the faces are gone.
`;
}

export function registerResources(
  server: McpServer,
  opts: { api: SightRadarApi; images: ImageCapabilities; read: boolean },
) {
  server.registerResource(
    "pricing-and-limits",
    PRICING_URI,
    {
      title: "SightRadar pricing and limits",
      description: "Credits per operation, rate limits, image limits and the deletion grace period.",
      mimeType: "text/markdown",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: pricingAndLimitsMarkdown(opts.images) }] }),
  );

  if (!opts.read) return;
  server.registerResource(
    "collection",
    new ResourceTemplate(COLLECTION_URI_TEMPLATE, { list: undefined }),
    {
      title: "SightRadar collection",
      description: "One collection's status and photo, face and selfie counts (same data as get_collection).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = variables.collection_id;
      const id = decodeURIComponent(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""));
      if (!id) throw new Error("The URI needs a collection id.");
      const res = await opts.api.get(`/v1/collections/${seg(id)}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(res.data, null, 2) }] };
    },
  );
}
