import { BlobStore } from "@/lib/store/blob";
import { LocalStore } from "@/lib/store/local";
import type { ObjectStore } from "@/lib/store/store";

let cached: ObjectStore | null = null;

export function getStore(): ObjectStore {
  if (!cached) cached = process.env.STORE_DRIVER === "blob" ? new BlobStore() : new LocalStore();
  return cached;
}
