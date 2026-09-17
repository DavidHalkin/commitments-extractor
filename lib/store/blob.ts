import { del, get, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

const URL_TTL_MS = 15 * 60 * 1000;
const PAGE = 1000;

/** Private Vercel Blob store. Credentials come from OIDC + BLOB_STORE_ID on Vercel, BLOB_READ_WRITE_TOKEN elsewhere. */
export class BlobStore implements ObjectStore {
  async put(key: string, data: Uint8Array | string, contentType: string): Promise<void> {
    await put(key, typeof data === "string" ? data : Buffer.from(data), {
      access: "private",
      contentType,
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    // run.json is overwritten after every stage; a CDN-cached read could return a version up to 60 s old.
    const res = await get(key, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  }

  async listDirs(prefix: string): Promise<string[]> {
    const dirs: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, mode: "folded", cursor, limit: PAGE });
      dirs.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return dirs;
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: PAGE });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  async uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget> {
    const validUntil = Date.now() + URL_TTL_MS;
    const token = await issueSignedToken({ pathname: key, operations: ["put"], maximumSizeInBytes: maxBytes, validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname: key,
      access: "private",
      maximumSizeInBytes: maxBytes,
      // The browser reuses this URL when it retries a failed upload.
      allowOverwrite: true,
      validUntil,
    });
    return { url: presignedUrl, method: "PUT", headers: { "Content-Type": contentType } };
  }

  async downloadUrl(key: string): Promise<string | null> {
    const validUntil = Date.now() + URL_TTL_MS;
    const token = await issueSignedToken({ pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil });
    return presignedUrl;
  }
}
