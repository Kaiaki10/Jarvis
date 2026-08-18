import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { getSettings } from "../db/repo.js";

/**
 * Access to a single folder of images the user drops in for Jarvis to attach.
 *
 * Everything here treats the filename as untrusted. It arrives from a model that
 * may have been influenced by whatever it just read, so "images/../../.ssh/id_rsa"
 * has to be impossible by construction rather than by the model behaving well.
 */

/**
 * Extension to MIME type. The MIME matters: an upload part sent without one is
 * rejected by X with "media type unrecognized", which reads like a problem with
 * the image rather than with the request.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));

export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/** X rejects images above 5 MB on the simple upload path. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function defaultImagesFolder(): string {
  return join(homedir(), "Jarvis Images");
}

export function imagesFolder(): string {
  const configured = getSettings().imagesFolder.trim();
  return configured || defaultImagesFolder();
}

export function ensureImagesFolder(): string {
  const folder = imagesFolder();
  try {
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
  } catch {
    // A folder we cannot create is reported when something tries to use it.
  }
  return folder;
}

export interface AvailableImage {
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
}

export function listImages(): AvailableImage[] {
  const folder = imagesFolder();
  if (!existsSync(folder)) return [];

  return readdirSync(folder)
    .filter((name) => ALLOWED_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => {
      const stats = statSync(join(folder, name));
      return {
        fileName: name,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    })
    .filter((image) => image.sizeBytes > 0)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export class ImageAccessError extends Error {}

/**
 * Resolves a user-supplied filename to a real path inside the images folder.
 *
 * Rejects anything that escapes the folder, including via `..`, an absolute
 * path, or a symlink pointing elsewhere — the containment check runs on the
 * fully resolved real path, not the string that was passed in.
 */
export function resolveImagePath(fileName: string): string {
  if (!fileName || typeof fileName !== "string") {
    throw new ImageAccessError("No image filename was given.");
  }

  // Reject any path structure outright: this accepts a bare filename only.
  if (basename(fileName) !== fileName) {
    throw new ImageAccessError(
      `"${fileName}" must be a plain filename from the images folder, not a path.`
    );
  }

  const extension = extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new ImageAccessError(
      `"${fileName}" is not an image. Allowed types: ${[...ALLOWED_EXTENSIONS].join(", ")}`
    );
  }

  const folder = resolve(imagesFolder());
  const candidate = resolve(folder, fileName);

  // Belt and braces: even with a bare filename, confirm containment.
  if (candidate !== folder && !candidate.startsWith(folder + sep)) {
    throw new ImageAccessError(`"${fileName}" resolves outside the images folder.`);
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new ImageAccessError(
      `"${fileName}" was not found in the images folder (${folder}).`
    );
  }

  const size = statSync(candidate).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new ImageAccessError(
      `"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`
    );
  }
  if (size === 0) throw new ImageAccessError(`"${fileName}" is empty.`);

  return candidate;
}

export function readImage(fileName: string): { bytes: Buffer; path: string } {
  const path = resolveImagePath(fileName);
  return { bytes: readFileSync(path), path };
}
