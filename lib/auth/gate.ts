import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "app_session";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Paths that answer before the gate: the login form itself, the health check, and the cron endpoint,
 * which Vercel Cron authenticates with CRON_SECRET and which would otherwise stop running. */
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/health", "/api/cron/cleanup"]);

/** The access code, or null when none is configured and the app stays open to everyone. */
export function appPassword(env: Record<string, string | undefined> = process.env): string | null {
  const code = env.APP_PASSWORD?.trim();
  return code ? code : null;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

/** The cookie value for a code. Keyed by the code itself, so the code never travels in the cookie and
 * changing it invalidates every session that was handed out under the old one. */
export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("commitments-extractor session").digest("hex");
}

export function isValidSession(token: string | undefined, password: string): boolean {
  if (!token) return false;
  const expected = Buffer.from(sessionToken(password));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Where to send a visitor after a successful login. Only a path inside this app is honoured, so a
 * crafted ?next= cannot turn the login form into a redirector to somebody else's site. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return isPublicPath(raw.split("?")[0]) ? "/" : raw;
}

export type GateDecision = "allow" | "login" | "unauthorized";

/** An API request gets an error it can read; a page request gets the form. */
export function gateDecision(req: { pathname: string; token: string | undefined; password: string | null }): GateDecision {
  if (!req.password) return "allow";
  if (isPublicPath(req.pathname)) return "allow";
  if (isValidSession(req.token, req.password)) return "allow";
  return req.pathname.startsWith("/api/") ? "unauthorized" : "login";
}
