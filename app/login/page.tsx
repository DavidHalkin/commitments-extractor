import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { appPassword, safeNext } from "@/lib/auth/gate";

export const metadata: Metadata = { title: "Access code" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  // Nothing to log into when the demo is open; the gate is off and every page is reachable.
  if (!appPassword()) redirect("/");
  const { next, error } = await searchParams;

  return (
    <div className="login-card card">
      <h1>Access code</h1>
      <p className="lede">This demo is private. Enter the code you were given to open it.</p>
      <form className="login-form" method="post" action="/api/login">
        <input type="hidden" name="next" value={safeNext(next ?? null)} />
        <label htmlFor="password">Code</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-describedby={error ? "login-error" : undefined}
        />
        {error ? <p id="login-error" className="login-error" role="alert">That code does not match. Try again.</p> : null}
        <button type="submit" className="btn btn-primary">Log in</button>
      </form>
    </div>
  );
}
