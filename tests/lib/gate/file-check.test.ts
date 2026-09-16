import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAudioFile } from "@/lib/gate/file-check";
import { LIMITS } from "@/lib/limits";

const dir = path.join("testset", "invalid");
const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as Record<string, string>;

describe("checkAudioFile on fixtures", () => {
  for (const [file, want] of Object.entries(expected)) {
    it(`${file} → ${want}`, async () => {
      const result = await checkAudioFile(new Uint8Array(readFileSync(path.join(dir, file))));
      expect(result.ok ? "ok" : result.code).toBe(want);
    });
  }

  it("rejects files larger than the limit before parsing", async () => {
    const result = await checkAudioFile(new Uint8Array(LIMITS.maxBytes + 1));
    expect(result.ok ? "ok" : result.code).toBe("file_too_large");
  });

  it("reports detected format and duration for accepted audio", async () => {
    const result = await checkAudioFile(new Uint8Array(readFileSync(path.join(dir, "wav-renamed.mp3"))));
    expect(result).toMatchObject({ ok: true, detectedFormat: "wav", hasVideo: false });
    expect(result.durationSec).toBeCloseTo(5, 0);
  });
});
