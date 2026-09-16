import { GcsStore } from "@/lib/store/gcs";
import { LocalStore } from "@/lib/store/local";
import type { ObjectStore } from "@/lib/store/store";

let cached: ObjectStore | null = null;

export function getStore(): ObjectStore {
  if (!cached) cached = process.env.STORE_DRIVER === "gcs" ? new GcsStore() : new LocalStore();
  return cached;
}
