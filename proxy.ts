import { NextResponse, type NextRequest } from "next/server";
import { appPassword, gateDecision, SESSION_COOKIE } from "@/lib/auth/gate";

/** Runs before every request. With no APP_PASSWORD set it does nothing and the app stays open. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const decision = gateDecision({
    pathname,
    token: req.cookies.get(SESSION_COOKIE)?.value,
    password: appPassword(),
  });
  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "This demo is protected. Open it in a browser and enter the access code." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

// Everything except Next's own assets and the files served straight from public/.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
