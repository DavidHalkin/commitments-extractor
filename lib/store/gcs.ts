import { Storage, type Bucket } from "@google-cloud/storage";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

const URL_TTL_MS = 15 * 60 * 1000;

export class GcsStore implements ObjectStore {
  private bucket: Bucket;

  constructor(bucketName: string | undefined = process.env.GCS_BUCKET) {
    if (!bucketName) throw new Error("GCS_BUCKET is not set");
    this.bucket = new Storage().bucket(bucketName);
  }

  async put(key: string, data: Uint8Array | string, contentType: string): Promise<void> {
    await this.bucket.file(key).save(typeof data === "string" ? data : Buffer.from(data), { contentType, resumable: false });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const [buf] = await this.bucket.file(key).download();
      return new Uint8Array(buf);
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }

  async listDirs(prefix: string): Promise<string[]> {
    const [, , response] = await this.bucket.getFiles({ prefix, delimiter: "/", autoPaginate: false, maxResults: 1000 });
    const prefixes = (response as { prefixes?: string[] } | undefined)?.prefixes ?? [];
    return prefixes.map((p) => p.slice(prefix.length).replace(/\/$/, ""));
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.bucket.deleteFiles({ prefix });
  }

  async uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget> {
    const range = `0,${maxBytes}`;
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + URL_TTL_MS,
      contentType,
      extensionHeaders: { "x-goog-content-length-range": range },
    });
    return { url, method: "PUT", headers: { "Content-Type": contentType, "x-goog-content-length-range": range } };
  }

  async downloadUrl(key: string): Promise<string | null> {
    const [url] = await this.bucket.file(key).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + URL_TTL_MS });
    return url;
  }
}
