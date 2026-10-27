import { z } from "zod";
import { seg, type SightRadarApi } from "../client.js";
import { imageSchemaShape, loadImage, toForm, ImageInputError, type ImageArgs, type ImageCapabilities } from "../images.js";
import { defineTool, COMPUTE, WRITE } from "./define.js";

// Billable face operations. Prices are in credits; 100,000 credits = US$1.

const collectionId = z.string().min(1).max(255).describe("Collection id.");

const idempotencyKey = z
  .string()
  .max(255)
  .optional()
  .describe(
    "Optional. Reusing the same key for a retry of the same request returns the original result instead of charging again.",
  );

const threshold = z
  .number()
  .min(0)
  .max(1)
  .optional()
  .describe("Minimum cosine similarity for a match (0-1). Omit to use the calibrated default.");

const limit = z.number().int().min(1).max(1000).optional().describe("Maximum number of matches to return.");

const embedding = z
  .array(z.number())
  .length(512)
  .optional()
  .describe("A 512-number face embedding (from register_selfie) instead of an image.");

async function postImage(
  api: SightRadarApi,
  path: string,
  args: ImageArgs,
  images: ImageCapabilities,
  fields: Record<string, string | number | boolean | undefined>,
  idem?: string,
) {
  const img = await loadImage(args, images);
  if (img?.upload) {
    return api.post(path, { form: toForm(img.upload, fields), idempotencyKey: idem });
  }
  return api.post(path, { json: { ...img?.json, ...dropUndefined(fields) }, idempotencyKey: idem });
}

function dropUndefined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export const faceTools = [
  defineTool({
    name: "index_photo",
    scope: "write",
    title: "Index a photo",
    description:
      "Detect every face in a photo and store them in a collection so they can be found later by search_faces. Returns each face's point_id, bounding box (ratios of image width/height), detection score and pixel size. Faces below the quality gate (det_score < 0.6 or under 24 px) are counted as rejected. Indexing the same photo_id twice fails with already_indexed unless override=true. The collection is created if missing. Costs 93 credits.",
    input: (images) => ({
      collection_id: collectionId,
      photo_id: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe("Your id for the photo; search results return it. Defaults to a content hash."),
      ...imageSchemaShape(images, "photo"),
      override: z.boolean().optional().describe("Re-index and replace the faces of a photo_id indexed before."),
      idempotency_key: idempotencyKey,
    }),
    annotations: WRITE,
    billable: true,
    handler: (a, { api, images }) =>
      postImage(
        api,
        `/v1/collections/${seg(a.collection_id)}/index${a.override ? "?override=true" : ""}`,
        a,
        images,
        { photoId: a.photo_id },
        a.idempotency_key,
      ),
  }),

  defineTool({
    name: "search_faces",
    scope: "search",
    title: "Search a collection by face",
    description:
      "Find the photos in a collection that contain the person in a query image (typically a selfie) or a 512-number embedding. Returns matches [{photo_id, score}] best first, plus photo_ids. When nothing matches, `reason` says why: no_face (no face found in the query) or low_quality_selfie. Costs 93 credits.",
    input: (images) => ({
      collection_id: collectionId,
      ...imageSchemaShape(images, "query face image"),
      embedding,
      threshold,
      limit,
      idempotency_key: idempotencyKey,
    }),
    annotations: COMPUTE,
    billable: true,
    handler: async (a, { api, images }) => {
      const path = `/v1/collections/${seg(a.collection_id)}/search`;
      if (a.embedding) {
        if (await loadImage(a, images, { optional: true })) {
          throw new ImageInputError("Provide either an image or an embedding, not both.");
        }
        return api.post(path, {
          json: dropUndefined({ embedding: a.embedding, threshold: a.threshold, limit: a.limit }),
          idempotencyKey: a.idempotency_key,
        });
      }
      return postImage(api, path, a, images, { threshold: a.threshold, limit: a.limit }, a.idempotency_key);
    },
  }),

  defineTool({
    name: "search_by_point_id",
    scope: "search",
    title: "Search by a stored face",
    description:
      "Search a collection using a face that is already stored (its point_id from index_photo or register_selfie), without sending an image again. Cheaper than search_faces. Returns matches [{photo_id, score}]; reason=point_not_found if the id is unknown. Costs 62 credits.",
    input: () => ({
      collection_id: collectionId,
      point_id: z.string().min(1).describe("point_id of a stored face or selfie."),
      threshold,
      limit,
      idempotency_key: idempotencyKey,
    }),
    annotations: COMPUTE,
    billable: true,
    handler: (a, { api }) =>
      api.post(`/v1/collections/${seg(a.collection_id)}/search-by-id`, {
        json: dropUndefined({ pointId: a.point_id, threshold: a.threshold, limit: a.limit }),
        idempotencyKey: a.idempotency_key,
      }),
  }),

  defineTool({
    name: "register_selfie",
    scope: "write",
    title: "Register a selfie",
    description:
      "Store a user's selfie in a collection so they can be matched against its photos. Returns face_found, the selfie's point_id (use with search_by_point_id) and its 512-number embedding. face_found=false with a reason means no usable face. Costs 93 credits.",
    input: (images) => ({
      collection_id: collectionId,
      user_id: z.string().min(1).max(255).describe("Your id for the person (required)."),
      selfie_id: z.string().min(1).max(255).optional().describe("Your id for this selfie. Defaults to a content hash."),
      ...imageSchemaShape(images, "selfie"),
      idempotency_key: idempotencyKey,
    }),
    annotations: WRITE,
    billable: true,
    handler: (a, { api, images }) =>
      postImage(
        api,
        `/v1/collections/${seg(a.collection_id)}/selfies`,
        a,
        images,
        { userId: a.user_id, selfieId: a.selfie_id },
        a.idempotency_key,
      ),
  }),

  defineTool({
    name: "detect_faces",
    scope: "search",
    title: "Detect faces",
    description:
      "Find the faces in an image without storing anything. Returns detected_face_count, gated_face_count (faces that pass the quality gate) and per face: bounding box (ratios), det_score, min_px and quality_passed. Useful to check a photo or selfie before indexing. Costs 93 credits.",
    input: (images) => ({ ...imageSchemaShape(images, "image"), idempotency_key: idempotencyKey }),
    annotations: COMPUTE,
    billable: true,
    handler: (a, { api, images }) => postImage(api, "/v1/detect", a, images, {}, a.idempotency_key),
  }),

  defineTool({
    name: "compare_faces",
    scope: "search",
    title: "Compare two faces",
    description:
      "Check whether two images (or embeddings) show the same person. Uses the best face on each side. Returns face_found, similarity (0-1, null when a side has no face), match and the threshold used. Each side is a public URL, a CDN key or a 512-number embedding. Costs 93 credits per image processed (186 for two images, 93 for one image and one embedding).",
    input: () => ({
      source_url: z.string().url().optional().describe("Public URL of the first image."),
      source_gcs_key: z.string().optional().describe("CDN key of the first image."),
      source_embedding: embedding.describe("Embedding of the first face."),
      target_url: z.string().url().optional().describe("Public URL of the second image."),
      target_gcs_key: z.string().optional().describe("CDN key of the second image."),
      target_embedding: embedding.describe("Embedding of the second face."),
      idempotency_key: idempotencyKey,
    }),
    annotations: COMPUTE,
    billable: true,
    handler: (a, { api }) => {
      for (const side of ["source", "target"] as const) {
        const n = [a[`${side}_url`], a[`${side}_gcs_key`], a[`${side}_embedding`]].filter((v) => v !== undefined).length;
        if (n !== 1) {
          throw new ImageInputError(`Give exactly one of ${side}_url, ${side}_gcs_key or ${side}_embedding.`);
        }
      }
      return api.post("/v1/compare", {
        json: dropUndefined({
          sourceUrl: a.source_url,
          sourceGcsKey: a.source_gcs_key,
          source_embedding: a.source_embedding,
          targetUrl: a.target_url,
          targetGcsKey: a.target_gcs_key,
          target_embedding: a.target_embedding,
        }),
        idempotencyKey: a.idempotency_key,
      });
    },
  }),
];
