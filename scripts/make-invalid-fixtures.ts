import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.join("testset", "invalid");
mkdirSync(dir, { recursive: true });

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

const videoIn = ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-f", "lavfi", "-i", "sine=frequency=440"];

// MP4 with a video track, saved under audio extensions
for (const name of ["video-renamed.mp3", "video-renamed.m4a"]) {
  ffmpeg([...videoIn, "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", path.join(dir, name)]);
}
// WebM with a video track
ffmpeg([...videoIn, "-t", "5", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", "-f", "webm", path.join(dir, "webm-video-renamed.webm")]);
// Valid WAV named .mp3
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-f", "wav", path.join(dir, "wav-renamed.mp3")]);
// 200 s and 1 s MP3
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=200", "-c:a", "libmp3lame", "-b:a", "32k", path.join(dir, "too-long.mp3")]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", "-b:a", "64k", path.join(dir, "too-short.mp3")]);
// Plain text (> 1 KB so the size rule does not fire first) and an empty file
writeFileSync(path.join(dir, "text-renamed.mp3"), "This is not audio. ".repeat(120));
writeFileSync(path.join(dir, "empty.mp3"), "");

writeFileSync(
  path.join(dir, "expected.json"),
  JSON.stringify(
    {
      "video-renamed.mp3": "contains_video",
      "video-renamed.m4a": "contains_video",
      "webm-video-renamed.webm": "contains_video",
      "text-renamed.mp3": "not_audio",
      "wav-renamed.mp3": "ok",
      "too-long.mp3": "too_long",
      "too-short.mp3": "too_short",
      "empty.mp3": "file_too_small",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Fixtures written to ${dir}`);
