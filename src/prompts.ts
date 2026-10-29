import { z } from "zod";
import type { Scope } from "./scopes.js";

// Prompt templates. Each one lists the scopes its steps need; a prompt is only
// offered when the connection has all of them, the same way tools are filtered.

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** Every scope the prompt's tool calls need. */
  scopes: Scope[];
  args: z.ZodRawShape;
  text: (args: Record<string, string | undefined>) => string;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "find_person_in_event",
    title: "Find a person's photos",
    description: "Find every photo in a collection that shows the person in a selfie.",
    scopes: ["read", "search"],
    args: {
      collection_id: z.string().min(1).describe("Collection (event) to search."),
      selfie: z
        .string()
        .optional()
        .describe("Public URL or local file path of the selfie. Leave empty to attach the image instead."),
    },
    text: (a) =>
      [
        `Find the photos in SightRadar collection "${a.collection_id}" that show the person in ${
          a.selfie ? `this selfie: ${a.selfie}` : "the selfie I attach"
        }.`,
        "1. Call get_collection to check the collection exists and is active, and get_balance to check there are at least 93 credits.",
        "2. Call search_faces once with the selfie (image_url for a URL, file_path for a local file, image_base64 for an attached image).",
        "3. If the answer has a reason (no_face or low_quality_selfie), tell me and ask for a clearer, front-facing selfie. Do not retry with the same image.",
        "4. Otherwise list the matching photo_ids, best score first, and say how many there are. Do not run more searches without asking.",
      ].join("\n"),
  },
  {
    name: "index_event_photos",
    title: "Index event photos",
    description: "Add a set of photos to a collection, choosing per-photo indexing or a batch and quoting the cost first.",
    scopes: ["read", "write"],
    args: {
      collection_id: z.string().min(1).describe("Collection to add the photos to (created if missing)."),
      photos: z.string().min(1).describe("The photos: a list of URLs, or a local folder path."),
    },
    text: (a) =>
      [
        `Add these photos to SightRadar collection "${a.collection_id}": ${a.photos}`,
        "1. Count the photos. Call get_balance.",
        "2. Pick the method: public URLs and more than 20 photos -> submit_batch (62 credits per photo, up to 1000 per batch). Local files, or 20 photos or fewer -> index_photo for each (93 credits per photo).",
        "3. Before indexing anything, tell me the photo count, the method, the total credits (100,000 credits = US$1) and my balance, and wait for my go-ahead.",
        "4. Use each file name or URL path as photo_id so search results are readable.",
        "5. For a batch, give me the batch_id and check get_batch until it finishes. At the end report indexed, failed (with reason) and credits spent.",
      ].join("\n"),
  },
  {
    name: "account_health",
    title: "Account health check",
    description: "Summarise balance, recent spend, failed batch photos and failed webhook deliveries.",
    scopes: ["read"],
    args: {
      days: z.string().regex(/^\d{1,3}$/).optional().describe("Look-back window in days (default 7)."),
    },
    text: (a) => {
      const days = a.days ?? "7";
      return [
        `Give me a short health report for my SightRadar account over the last ${days} days.`,
        `1. get_balance, and get_usage with days=${days}: balance, credits spent per operation, and how many days the balance lasts at that rate.`,
        "2. list_batches: any batches with failed photos. For those, get_batch_photos and group the failures by reason_code.",
        "3. list_webhook_failures: how many deliveries gave up, to which endpoints, and the last error.",
        "4. End with at most three concrete next steps (for example top up, replay webhook failures, requeue insufficient_credits failures). Do not change anything yourself.",
      ].join("\n");
    },
  },
];
