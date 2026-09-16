import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRICING } from "@/lib/pricing";

type Line = { speaker: string; voice: string; text: string };

const SAMPLE_RATE = 24000;
const GAP_SEC = 0.4;
const cases = process.argv.slice(2).length ? process.argv.slice(2) : ["01-normal", "02-changed", "03-clarify"];
const key = process.env.DEEPGRAM_API_KEY;
if (!key) throw new Error("DEEPGRAM_API_KEY is not set (put it in .env.local)");

const posix = (p: string) => path.resolve(p).replace(/\\/g, "/");
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

function duration(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

async function speak(text: string, voice: string): Promise<Buffer> {
  const url = `https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&container=wav&sample_rate=${SAMPLE_RATE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Aura-2 ${res.status} for voice ${voice}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  let totalChars = 0;
  for (const name of cases) {
    const dir = path.join("testset", name);
    const work = path.join(dir, ".work");
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const lines = JSON.parse(await readFile(path.join(dir, "script.json"), "utf8")) as Line[];

    const silence = path.join(work, "silence.wav");
    ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`, "-t", String(GAP_SEC), "-c:a", "pcm_s16le", silence]);

    const list: string[] = [];
    const offsets: { line: number; speaker: string; start: number; end: number }[] = [];
    let t = 0;
    let chars = 0;
    for (const [i, line] of lines.entries()) {
      const rawFile = path.join(work, `line${String(i + 1).padStart(2, "0")}.wav`);
      await writeFile(rawFile, await speak(line.text, line.voice));
      chars += line.text.length;
      const norm = rawFile.replace(/\.wav$/, "-n.wav");
      ffmpeg(["-i", rawFile, "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", norm]);
      const d = duration(norm);
      offsets.push({ line: i + 1, speaker: line.speaker, start: round3(t), end: round3(t + d) });
      list.push(`file '${posix(norm)}'`, `file '${posix(silence)}'`);
      t += d + GAP_SEC;
    }
    const listFile = path.join(work, "list.txt");
    await writeFile(listFile, list.join("\n"));
    ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-b:a", "96k", path.join(dir, "audio.mp3")]);
    await writeFile(path.join(dir, "offsets.json"), JSON.stringify(offsets, null, 2) + "\n");
    await rm(work, { recursive: true, force: true });
    totalChars += chars;
    console.log(`${name}: ${lines.length} lines, ${t.toFixed(1)} s, ${chars} chars`);
  }
  console.log(`Aura-2 one-time synthesis cost: $${((totalChars / 1000) * PRICING.deepgram.aura2Per1kChars).toFixed(4)} for ${totalChars} chars`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
