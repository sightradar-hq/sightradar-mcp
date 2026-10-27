import { z } from "zod";

// How a tool receives an image. MCP arguments are JSON, so an image arrives as
// one of: a public URL the API fetches itself, a storage key on the account's
// configured CDN, base64 bytes, or (local server only) a path on disk.

/** Raw upload bodies above this are refused before any network call. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** Capabilities of the host serving the tools. */
export interface ImageCapabilities {
  /** Reads a local file. Only the local stdio server provides this. */
  readFile?: (path: string) => Promise<{ bytes: Uint8Array; filename: string }>;
  /** Largest decoded base64 payload accepted (bytes). */
  maxBase64Bytes: number;
}

export interface LoadedImage {
  /** JSON fields to send instead of an upload. */
  json?: Record<string, string>;
  /** Bytes to send as multipart `file`. */
  upload?: { bytes: Uint8Array; filename: string; mimeType: string };
}

export function imageSchemaShape(caps: ImageCapabilities, label = "image") {
  const shape = {
    image_url: z
      .string()
      .url()
      .optional()
      .describe(`Public http(s) URL of the ${label}. SightRadar downloads it; it must be reachable from the internet.`),
    gcs_key: z
      .string()
      .optional()
      .describe(`Object key of the ${label} on the CDN configured for your account (instead of a URL).`),
    image_base64: z
      .string()
      .optional()
      .describe(
        `The ${label} as base64 (a data: URL is fine). Up to ${Math.floor(caps.maxBase64Bytes / (1024 * 1024))} MB decoded. Prefer image_url for large files.`,
      ),
  };
  if (!caps.readFile) return shape;
  return {
    ...shape,
    file_path: z
      .string()
      .optional()
      .describe(`Path to the ${label} on this computer (JPEG, PNG, WebP, GIF, BMP, TIFF or HEIC).`),
  };
}

export interface ImageArgs {
  image_url?: string;
  gcs_key?: string;
  image_base64?: string;
  file_path?: string;
}

export class ImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageInputError";
  }
}

/** Count how many image sources were supplied. */
export function countImageSources(args: ImageArgs): number {
  return [args.image_url, args.gcs_key, args.image_base64, args.file_path].filter(
    (v) => typeof v === "string" && v.trim() !== "",
  ).length;
}

/**
 * Turn the tool arguments into either JSON fields or an upload.
 * Exactly one source must be present unless `optional` is set.
 */
export async function loadImage(
  args: ImageArgs,
  caps: ImageCapabilities,
  opts: { optional?: boolean } = {},
): Promise<LoadedImage | undefined> {
  const n = countImageSources(args);
  if (n === 0) {
    if (opts.optional) return undefined;
    throw new ImageInputError(
      `Provide one image source: image_url, gcs_key, image_base64${caps.readFile ? " or file_path" : ""}.`,
    );
  }
  if (n > 1) throw new ImageInputError("Provide only one image source per image.");

  if (args.image_url) {
    const u = new URL(args.image_url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new ImageInputError("image_url must be an http(s) URL.");
    }
    return { json: { url: args.image_url } };
  }
  if (args.gcs_key) return { json: { gcsKey: args.gcs_key } };

  if (args.image_base64) {
    const bytes = decodeBase64(args.image_base64, caps.maxBase64Bytes);
    const mimeType = sniffImageType(bytes);
    if (!mimeType) throw new ImageInputError("image_base64 does not decode to a supported image format.");
    return { upload: { bytes, filename: `upload.${extFor(mimeType)}`, mimeType } };
  }

  if (args.file_path) {
    if (!caps.readFile) throw new ImageInputError("file_path is only available on the local server.");
    const { bytes, filename } = await caps.readFile(args.file_path);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageInputError(`File is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
    }
    const mimeType = sniffImageType(bytes);
    // Refuse non-images before they leave the machine: a prompt-injected
    // model must not be able to upload arbitrary files "as a photo".
    if (!mimeType) throw new ImageInputError(`${filename} is not a supported image file.`);
    return { upload: { bytes, filename, mimeType } };
  }
  return undefined;
}

export function decodeBase64(input: string, maxBytes: number): Uint8Array {
  let b64 = input.trim();
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma !== -1) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  // Reject before allocating: decoded size is ~3/4 of the encoded length.
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) {
    throw new ImageInputError(`image_base64 is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ImageInputError("image_base64 is not valid base64.");
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ImageInputError("image_base64 is not valid base64.");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Identify an image by its magic bytes; undefined for anything else. */
export function sniffImageType(b: Uint8Array): string | undefined {
  const at = (i: number) => b[i] ?? -1;
  const ascii = (start: number, s: string) => [...s].every((c, i) => at(start + i) === c.charCodeAt(0));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && ascii(1, "PNG")) return "image/png";
  if (ascii(0, "GIF8")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "BM")) return "image/bmp";
  if ((ascii(0, "II") && at(2) === 42 && at(3) === 0) || (ascii(0, "MM") && at(2) === 0 && at(3) === 42)) {
    return "image/tiff";
  }
  if (ascii(4, "ftyp") && ["heic", "heix", "hevc", "mif1", "msf1", "avif"].some((brand) => ascii(8, brand))) {
    return ascii(8, "avif") ? "image/avif" : "image/heic";
  }
  return undefined;
}

function extFor(mime: string): string {
  return mime.split("/")[1] === "jpeg" ? "jpg" : (mime.split("/")[1] ?? "bin");
}

/** Build the multipart body the gateway expects for an upload. */
export function toForm(
  upload: NonNullable<LoadedImage["upload"]>,
  fields: Record<string, string | number | boolean | undefined>,
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  // Copy into a fresh ArrayBuffer so Blob gets a plain (non-shared) buffer.
  const buf = new Uint8Array(upload.bytes.byteLength);
  buf.set(upload.bytes);
  form.append("file", new Blob([buf.buffer], { type: upload.mimeType }), upload.filename);
  return form;
}
