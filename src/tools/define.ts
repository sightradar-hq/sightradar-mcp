import type { z } from "zod";
import type { SightRadarApi, ApiResponse } from "../client.js";
import type { ImageCapabilities } from "../images.js";
import type { Scope } from "../scopes.js";

export interface ToolContext {
  api: SightRadarApi;
  images: ImageCapabilities;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** What a handler returns: an API response, or a ready-made MCP result. */
export type HandlerResult =
  | ApiResponse
  | { mcp: { content: unknown[]; structuredContent?: Record<string, unknown>; isError?: boolean } };

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  scope: Scope;
  title: string;
  description: string;
  /** Builds the argument shape; gets the host's image capabilities. */
  input: (images: ImageCapabilities) => Shape;
  annotations: ToolAnnotations;
  /** Billable tools say so in their description and accept an idempotency key. */
  billable?: boolean;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<HandlerResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef {
  return def as unknown as ToolDef;
}

export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // false: reads only touch the user's own SightRadar account, and `true`
  // makes several clients demand an approval click on every lookup.
  openWorldHint: false,
};

/** Spends credits but stores nothing. */
export const COMPUTE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const IDEMPOTENT_WRITE: ToolAnnotations = { ...WRITE, idempotentHint: true };

export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
