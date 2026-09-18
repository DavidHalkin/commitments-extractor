// Verifies a Vercel deployment without paid API calls: Blob driver, presigned PUT and GET, history, cron auth, deletion.
// Browser CORS for the presigned PUT is not covered here; check it with a real upload in the UI.
import { readFile } from "node:fs/promises";
import { SESSION_COOKIE } from "@/lib/auth/gate";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) throw new Error("usage: npm run smoke -- https://<production-domain>");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}

async function json<T>(res: Response): Promise<T> {
  check(res.ok, `${res.url} returned ${res.status}: ${await res.clone().text()}`);
  return (await res.json()) as T;
}

// A protected deployment answers every route but /api/health and /api/login with 401, so sign in first.
let cookie = "";
if (process.env.APP_PASSWORD) {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }),
    redirect: "manual",
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  check(cookie.startsWith(`${SESSION_COOKIE}=`), `login returned ${res.status} without a session cookie`);
}

/** Same-origin request, carrying the session when the deployment is protected. */
const site = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });

const health = await json<{ ok: boolean; store: string }>(await site("/api/health"));
check(health.store === "blob", `store driver is "${health.store}", expected "blob"`);

const audio = new Uint8Array(await readFile("testset/01-normal/audio.mp3"));
const created = await json<{ runId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
  await site("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: "smoke.mp3", sizeBytes: audio.byteLength, declaredType: "audio/mpeg" }),
  }),
);

let cleaned = false;
try {
  check(created.upload.url.startsWith("https://"), `upload URL is not a presigned Blob URL: ${created.upload.url}`);

  const put = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: audio });
  check(put.ok, `presigned PUT returned ${put.status}: ${await put.text()}`);

  const audioRoute = await site(`/api/runs/${created.runId}/audio`, { redirect: "manual" });
  check(audioRoute.status === 302, `audio route returned ${audioRoute.status}, expected a 302 to a presigned GET`);
  const played = await fetch(audioRoute.headers.get("location")!);
  check(played.ok, `presigned GET returned ${played.status}`);
  check((await played.arrayBuffer()).byteLength === audio.byteLength, "downloaded audio size differs from the upload");

  const history = await json<{ runs: { id: string }[] }>(await site("/api/runs"));
  check(history.runs.some((r) => r.id === created.runId), "new run is missing from history");

  const cron = await site("/api/cron/cleanup");
  check(cron.status === 401, `cron route without the secret returned ${cron.status}, expected 401`);

  const deleted = await json<{ ok: boolean }>(await site(`/api/runs/${created.runId}`, { method: "DELETE" }));
  check(deleted.ok, "delete did not report ok");
  const gone = await site(`/api/runs/${created.runId}`);
  check(gone.status === 404, `deleted run still returns ${gone.status}`);

  cleaned = true;
} finally {
  if (!cleaned) {
    await site(`/api/runs/${created.runId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

console.log(`Smoke test passed for ${base}`);
