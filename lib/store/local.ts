import { promises as fs } from "node:fs";
import path from "node:path";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

function isNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

export class LocalStore implements ObjectStore {
  constructor(private root: string = process.env.LOCAL_STORE_DIR ?? ".data") {}

  private file(key: string): string {
    return path.join(this.root, ...key.replace(/\/$/, "").split("/"));
  }

  // contentType is part of the ObjectStore interface (BlobStore needs it); the filesystem doesn't.
  async put(key: string, data: Uint8Array | string, contentType?: string): Promise<void> {
    void contentType;
    await fs.mkdir(path.dirname(this.file(key)), { recursive: true });
    await fs.writeFile(this.file(key), data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.file(key)));
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async listDirs(prefix: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.file(prefix), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fs.rm(this.file(prefix), { recursive: true, force: true });
  }

  async uploadTarget(key: string): Promise<UploadTarget> {
    const id = key.split("/")[1];
    return { url: `/api/runs/${id}/upload`, method: "PUT", headers: {} };
  }

  async downloadUrl(): Promise<string | null> {
    return null;
  }
}
