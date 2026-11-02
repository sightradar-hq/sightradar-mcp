import { z } from "zod";
import { seg, SightRadarApiError, type SightRadarApi } from "../client.js";
import { defineTool, pathId, READ, IDEMPOTENT_WRITE, DESTRUCTIVE } from "./define.js";

const collectionId = pathId("collection_id").describe(
  "Collection id, e.g. an event or album id. Any text except '/', '\\', '.' and '..'.",
);

export const collectionTools = [
  defineTool({
    name: "list_collections",
    scope: "read",
    title: "List collections",
    description:
      "List the face collections on this SightRadar account, with photo, face and selfie counts. Supports substring search and paging. Free.",
    input: () => ({
      query: z.string().max(100).optional().describe("Only collections whose id contains this text."),
      status: z
        .enum(["active", "deletion_pending", "deleting", "deleted"])
        .optional()
        .describe("Filter by status. Omit for everything except fully deleted collections."),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default 50, max 200)."),
      offset: z.number().int().min(0).optional().describe("Rows to skip, for paging."),
    }),
    annotations: READ,
    handler: (a, { api }) =>
      api.get("/v1/collections", { query: { q: a.query, status: a.status, limit: a.limit, offset: a.offset } }),
  }),

  defineTool({
    name: "get_collection",
    scope: "read",
    title: "Get a collection",
    description:
      "Show one collection: status, photo_count, face_count, selfie_count, created_at and purge_after when a deletion is pending. Set verify=true to recount from the vector store instead of the cached counters. Free.",
    input: () => ({
      collection_id: collectionId,
      verify: z.boolean().optional().describe("Recount from the vector store (slower)."),
    }),
    annotations: READ,
    handler: (a, { api }) =>
      a.verify
        ? api.get(`/v1/collections/${seg(a.collection_id)}/metrics`, { query: { verify: true } })
        : api.get(`/v1/collections/${seg(a.collection_id)}`),
  }),

  defineTool({
    name: "create_collection",
    scope: "write",
    title: "Create a collection",
    description:
      "Create a face collection (for example one per event). Creating one that already exists and is active succeeds without change; one that is being deleted or was deleted returns 409 (use restore_collection or recreate_collection). Indexing into a missing collection also creates it, so this is optional. Free.",
    input: () => ({ collection_id: collectionId }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) => api.post("/v1/collections", { json: { collection_id: a.collection_id } }),
  }),

  defineTool({
    name: "delete_collection",
    scope: "delete",
    title: "Delete a collection",
    description:
      "Delete a collection and every face, selfie and photo record in it. By default this is a SOFT delete: the collection is hidden at once and purged after a 7-day grace period, and restore_collection undoes it until then. immediate=true starts the purge now and cannot be undone. compliance=true records an audited erasure (GDPR/BIPA) and cannot be restored. An immediate or compliance erase of a collection that still holds faces or selfies is refused with confirmation_required until confirm_erase=true. Confirm with the user before calling this. Free.",
    input: () => ({
      collection_id: collectionId,
      immediate: z.boolean().optional().describe("Purge now instead of after the grace period. Irreversible."),
      compliance: z.boolean().optional().describe("Audited legal erasure. Irreversible and never restorable."),
      confirm_erase: z
        .boolean()
        .optional()
        .describe(
          "Set true once the user has confirmed they want to erase a collection that still holds faces. When the answer is confirmation_required, tell the user what will be erased, ask, and retry with this.",
        ),
    }),
    annotations: DESTRUCTIVE,
    handler: async (a, { api }) => {
      const path = `/v1/collections/${seg(a.collection_id)}`;
      // The API treats immediate/compliance as explicit intent and skips its
      // own confirmation, so an assistant could erase a full collection in one
      // call. Ask for confirm_erase first whenever it is not provably empty.
      if ((a.immediate || a.compliance) && !a.confirm_erase) {
        const held = await heldContent(api, path);
        if (held) {
          return {
            mcp: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "This permanently erases a collection that still holds face data.",
                      code: "confirmation_required",
                      ...held,
                      hint: "Tell the user how many faces and selfies will be erased for good, ask them to confirm, then call delete_collection again with confirm_erase=true.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            },
          };
        }
      }
      return api.delete(path, {
        query: {
          immediate: a.immediate || undefined,
          compliance: a.compliance || undefined,
          intent: a.confirm_erase ? "erase" : undefined,
        },
      });
    },
  }),

  defineTool({
    name: "get_deletion_status",
    scope: "read",
    title: "Check a collection deletion",
    description:
      "Track a collection deletion: phase (not_deleting, deletion_pending, deleting, completed, blocked), whether the data is verified gone (verified_zero), purge_after, attempts and the last error. Free.",
    input: () => ({ collection_id: collectionId }),
    annotations: READ,
    handler: (a, { api }) => api.get(`/v1/collections/${seg(a.collection_id)}/deletion`),
  }),

  defineTool({
    name: "restore_collection",
    scope: "delete",
    title: "Restore a deleted collection",
    description:
      "Undo a soft delete while the collection is still in its grace period (status deletion_pending). Fails once the purge has started or for a compliance erasure. Free.",
    input: () => ({ collection_id: collectionId }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) => api.post(`/v1/collections/${seg(a.collection_id)}/restore`),
  }),

  defineTool({
    name: "recreate_collection",
    scope: "write",
    title: "Recreate a purged collection",
    description:
      "Bring back an empty collection under the same id after it has been fully deleted (status deleted). The old faces are not recovered. Free.",
    input: () => ({ collection_id: collectionId }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) => api.post(`/v1/collections/${seg(a.collection_id)}/recreate`),
  }),

  defineTool({
    name: "delete_photo",
    scope: "delete",
    title: "Delete a photo's faces",
    description:
      "Remove every face indexed from one photo. Soft by default (restore_photo undoes it); immediate=true or compliance=true is permanent. Deleting a photo that is already gone, or a photo_id that was never indexed, still answers deleted=true, so check the photo_id before telling the user something was removed. Free.",
    input: () => ({
      collection_id: collectionId,
      photo_id: pathId("photo_id").describe("The photo_id used when the photo was indexed."),
      immediate: z.boolean().optional().describe("Remove permanently now."),
      compliance: z.boolean().optional().describe("Audited legal erasure. Permanent."),
    }),
    annotations: DESTRUCTIVE,
    handler: (a, { api }) =>
      api.delete(`/v1/collections/${seg(a.collection_id)}/photos/${seg(a.photo_id)}`, {
        query: { immediate: a.immediate || undefined, compliance: a.compliance || undefined },
      }),
  }),

  defineTool({
    name: "restore_photo",
    scope: "delete",
    title: "Restore a deleted photo",
    description: "Undo a soft photo deletion made with delete_photo. Free.",
    input: () => ({
      collection_id: collectionId,
      photo_id: pathId("photo_id").describe("The photo_id that was deleted."),
    }),
    annotations: IDEMPOTENT_WRITE,
    handler: (a, { api }) =>
      api.post(`/v1/collections/${seg(a.collection_id)}/photos/${seg(a.photo_id)}/restore`),
  }),
];

/**
 * What a collection still holds, or null when it is provably empty (or does
 * not exist: the delete call then answers its own 404). Counts that are
 * missing or unreadable count as "holds data", so the check fails safe.
 */
async function heldContent(
  api: SightRadarApi,
  path: string,
): Promise<{ face_count: number | null; selfie_count: number | null; photo_count: number | null } | null> {
  let c: Record<string, unknown>;
  try {
    c = ((await api.get(path)).data ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SightRadarApiError && err.status === 404) return null;
    return { face_count: null, selfie_count: null, photo_count: null };
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const faces = num(c.face_count);
  const selfies = num(c.selfie_count);
  const photos = num(c.photo_count);
  if (faces === 0 && selfies === 0) return null;
  return { face_count: faces, selfie_count: selfies, photo_count: photos };
}
