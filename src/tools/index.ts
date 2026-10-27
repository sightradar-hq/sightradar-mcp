import { collectionTools } from "./collections.js";
import { faceTools } from "./faces.js";
import { batchTools } from "./batches.js";
import { webhookTools } from "./webhooks.js";
import { usageTools, accountTools } from "./account.js";
import type { ToolDef } from "./define.js";

export type { ToolDef, ToolContext, ToolAnnotations, HandlerResult } from "./define.js";

/** Every tool, in the order clients list them. */
export const TOOLS: ToolDef[] = [
  ...collectionTools,
  ...faceTools,
  ...batchTools,
  ...webhookTools,
  ...usageTools,
  ...accountTools,
];
