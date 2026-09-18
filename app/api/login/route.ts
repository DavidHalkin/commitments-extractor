import { NextResponse } from "next/server";
import { appPassword, isValidSession, safeNext, SESSION_COOKIE, SESSION_MAX_AGE_SEC, sessionToken } from "@/lib/auth/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 303 turns the form POST into a GET of the page the visitor was after. */
const seeOther = (url: URL) => NextResponse.redirect(url, 303);

export async function POST(req: Request) {
  const form = await req.formData();
  const next = safeNext(String(form.get("next") ?? ""));
  const password = appPassword();
  if (!password) return seeOther(new URL(next, req.url));

  // Compared as tokens, so a wrong code costs the same time as a right one.
  const given = String(form.get("password") ?? "");
  if (!isValidSession(sessionToken(given), password)) {
    const back = new URL("/login", req.url);
    back.searchParams.set("error", "1");
    if (next !== "/") back.searchParams.set("next", next);
    return seeOther(back);
  }

  const res = seeOther(new URL(next, req.url));
  res.cookies.set({
    name: SESSION_COOKIE,
    value: sessionToken(password),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
