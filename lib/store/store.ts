import type { UploadTarget } from "@/lib/types";

export interface ObjectStore {
  put(key: string, data: Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Names of direct child "directories" under a prefix ending in "/". */
  listDirs(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
  /** A URL the browser can GET, or null when the app must serve the bytes itself. */
  downloadUrl(key: string): Promise<string | null>;
}
