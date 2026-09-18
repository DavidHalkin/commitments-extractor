import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(async () => undefined),
  issueSignedToken: vi.fn(async () => ({ delegationToken: "d", clientSigningToken: "c", validUntil: 0 })),
  presignUrl: vi.fn(async () => ({ presignedUrl: "https://blob.example/signed" })),
}));

const blob = await import("@vercel/blob");
const { BlobStore } = await import("@/lib/store/blob");

const store = new BlobStore();

beforeEach(() => vi.clearAllMocks());

describe("BlobStore", () => {
  it("writes private, overwritable objects at the exact key", async () => {
    await store.put("runs/x/run.json", "{}", "application/json");
    expect(blob.put).toHaveBeenCalledWith("runs/x/run.json", "{}", {
      access: "private",
      contentType: "application/json",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  });

  it("reads bypassing the CDN cache and returns null when missing", async () => {
    vi.mocked(blob.get).mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response(new Uint8Array([1, 2, 3])).body!,
    } as Awaited<ReturnType<typeof blob.get>>);
    expect(await store.get("runs/x/audio")).toEqual(new Uint8Array([1, 2, 3]));
    expect(blob.get).toHaveBeenCalledWith("runs/x/audio", { access: "private", useCache: false });

    vi.mocked(blob.get).mockResolvedValueOnce(null);
    expect(await store.get("runs/missing/audio")).toBeNull();
  });

  it("lists folder names across pages", async () => {
    vi.mocked(blob.list)
      .mockResolvedValueOnce({ blobs: [], folders: ["runs/a/", "runs/b/"], hasMore: true, cursor: "c1" } as never)
      .mockResolvedValueOnce({ blobs: [], folders: ["runs/c/"], hasMore: false } as never);
    expect(await store.listDirs("runs/")).toEqual(["a", "b", "c"]);
    expect(blob.list).toHaveBeenNthCalledWith(1, { prefix: "runs/", mode: "folded", cursor: undefined, limit: 1000 });
    expect(blob.list).toHaveBeenNthCalledWith(2, { prefix: "runs/", mode: "folded", cursor: "c1", limit: 1000 });
  });

  it("deletes every object under a prefix, page by page", async () => {
    vi.mocked(blob.list)
      .mockResolvedValueOnce({ blobs: [{ url: "u1" }, { url: "u2" }], hasMore: true, cursor: "c1" } as never)
      .mockResolvedValueOnce({ blobs: [{ url: "u3" }], hasMore: false } as never);
    await store.deletePrefix("runs/x/");
    expect(blob.del).toHaveBeenNthCalledWith(1, ["u1", "u2"]);
    expect(blob.del).toHaveBeenNthCalledWith(2, ["u3"]);
  });

  it("issues a size-capped presigned PUT for uploads", async () => {
    const target = await store.uploadTarget("runs/x/audio", "application/octet-stream", 35 * 1024 * 1024);
    expect(target).toEqual({ url: "https://blob.example/signed", method: "PUT", headers: { "Content-Type": "application/octet-stream" } });
    expect(blob.issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "runs/x/audio", operations: ["put"], maximumSizeInBytes: 35 * 1024 * 1024 }),
    );
    expect(blob.presignUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: "put", pathname: "runs/x/audio", access: "private", maximumSizeInBytes: 35 * 1024 * 1024, allowOverwrite: true }),
    );
  });

  it("uploads to the exact key, because presigned uploads add a random suffix by default", async () => {
    await store.uploadTarget("runs/x/audio", "audio/mpeg", 1024);
    const options = vi.mocked(blob.presignUrl).mock.calls[0][1] as { addRandomSuffix?: boolean };
    expect(options.addRandomSuffix).toBe(false);
  });

  it("issues a presigned GET for playback that expires within 15 minutes", async () => {
    const before = Date.now();
    expect(await store.downloadUrl("runs/x/audio")).toBe("https://blob.example/signed");
    const options = vi.mocked(blob.presignUrl).mock.calls[0][1] as { operation: string; validUntil: number };
    expect(options.operation).toBe("get");
    expect(options.validUntil).toBeGreaterThan(before);
    expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });
});
