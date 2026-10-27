// Public API: the remote server and forks build on these.
export { createSightRadarServer, SERVER_NAME, MAX_RESULT_CHARS, DEFAULT_IMAGE_CAPS } from "./server.js";
export type { CreateServerOptions, ToolCallEvent } from "./server.js";
export { SightRadarApi, SightRadarApiError, DEFAULT_BASE_URL } from "./client.js";
export type { SightRadarApiOptions, ApiResponse, RequestOptions } from "./client.js";
export { SCOPES, ALL_SCOPES, DEFAULT_SCOPES, parseScopes, isScope } from "./scopes.js";
export type { Scope } from "./scopes.js";
export { TOOLS } from "./tools/index.js";
export type { ToolDef, ToolContext, ToolAnnotations } from "./tools/index.js";
export type { ImageCapabilities } from "./images.js";
export { VERSION } from "./version.js";
