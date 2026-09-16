import { describe, expect, it } from "vitest";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS } from "@/lib/limits";

describe("classify", () => {
  it("checks size bounds", () => {
    expect(checkSize(0)).toBe("file_too_small");
    expect(checkSize(LIMITS.maxBytes + 1)).toBe("file_too_large");
    expect(checkSize(2 * 1024 * 1024)).toBeNull();
  });
  it("classifies containers by detected type, not extension", () => {
    expect(checkContainer(undefined).code).toBe("not_audio");
    expect(checkContainer({ ext: "mp3", mime: "audio/mpeg" }).code).toBeNull();
    expect(checkContainer({ ext: "mov", mime: "video/quicktime" })).toEqual({ code: "contains_video", detail: "MOV" });
    expect(checkContainer({ ext: "png", mime: "image/png" })).toEqual({ code: "not_audio", detail: "PNG" });
  });
  it("checks duration bounds and accepts unknown duration", () => {
    expect(checkDuration(null, 180)).toBeNull();
    expect(checkDuration(1, 180)).toBe("too_short");
    expect(checkDuration(183, 180)).toBe("too_long");
    expect(checkDuration(183, 185)).toBeNull();
  });
});
