import { readFile, stat, realpath } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { MAX_IMAGE_BYTES, ImageInputError } from "./images.js";

/**
 * File reader for the local server. Paths must sit under one of the allowed
 * roots (default: the user's home directory), symlinks are resolved before
 * the check, and size is checked before reading.
 */
export function createFileReader(roots: string[]) {
  const allowed = roots.map((r) => resolve(expandHome(r)));
  return async (input: string) => {
    const path = resolve(expandHome(input));
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      throw new ImageInputError(`File not found: ${input}`);
    }
    const realRoots = await Promise.all(allowed.map((r) => realpath(r).catch(() => r)));
    if (!realRoots.some((root) => real === root || real.startsWith(root.endsWith(sep) ? root : root + sep))) {
      throw new ImageInputError(
        `${input} is outside the folders this server may read (${allowed.join(", ")}). Set SIGHTRADAR_FILE_ROOTS to change them.`,
      );
    }
    const info = await stat(real);
    if (!info.isFile()) throw new ImageInputError(`${input} is not a file.`);
    if (info.size > MAX_IMAGE_BYTES) throw new ImageInputError(`${input} is larger than 30 MB.`);
    return { bytes: new Uint8Array(await readFile(real)), filename: basename(real) };
  };
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
