import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sniffImageType, decodeBase64, loadImage } from "../src/images.js";
import { createFileReader } from "../src/local-files.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("sniffImageType", () => {
  it("recognises common formats", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("\0\0\0\x18ftypheic"))).toBe("image/heic");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeUndefined();
  });
});

describe("decodeBase64", () => {
  it("handles data URLs and url-safe alphabet", () => {
    expect(decodeBase64("data:image/png;base64,iVBORw0KGgo=", 100)).toEqual(PNG);
    expect(decodeBase64("iVBORw0KGgo", 100)).toEqual(PNG);
  });
  it("rejects oversize input before decoding", () => {
    expect(() => decodeBase64("A".repeat(4000), 1000)).toThrow(/larger/);
  });
  it("rejects garbage", () => expect(() => decodeBase64("not base64!!", 100)).toThrow(/valid base64/));
});

describe("local file reader", () => {
  const root = mkdtempSync(join(tmpdir(), "srmcp-"));
  const inside = join(root, "allowed");
  const outside = join(root, "secret");
  mkdirSync(inside);
  mkdirSync(outside);
  writeFileSync(join(inside, "a.png"), PNG);
  writeFileSync(join(outside, "b.png"), PNG);
  writeFileSync(join(inside, "notes.txt"), "hello");
  symlinkSync(join(outside, "b.png"), join(inside, "link.png"));
  const readFile = createFileReader([inside]);
  const caps = { readFile, maxBase64Bytes: 1000 };

  it("reads an image under the root", async () => {
    const img = await loadImage({ file_path: join(inside, "a.png") }, caps);
    expect(img?.upload?.mimeType).toBe("image/png");
    expect(img?.upload?.filename).toBe("a.png");
  });
  it("refuses paths outside the root, including via ..", async () => {
    await expect(loadImage({ file_path: join(outside, "b.png") }, caps)).rejects.toThrow(/outside/);
    await expect(loadImage({ file_path: join(inside, "..", "secret", "b.png") }, caps)).rejects.toThrow(/outside/);
  });
  it("refuses symlinks that escape the root", async () => {
    await expect(loadImage({ file_path: join(inside, "link.png") }, caps)).rejects.toThrow(/outside/);
  });
  it("refuses non-image files", async () => {
    await expect(loadImage({ file_path: join(inside, "notes.txt") }, caps)).rejects.toThrow(/not a supported image/);
  });
  it("reports missing files", async () => {
    await expect(loadImage({ file_path: join(inside, "nope.png") }, caps)).rejects.toThrow(/not found/);
  });
});
