import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/login/route";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth/gate";

const PASSWORD = "a-long-access-code-nobody-guesses";

const submit = (fields: Record<string, string>) =>
  POST(
    new Request("http://app.test/api/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
  );

afterEach(() => {
  delete process.env.APP_PASSWORD;
});

describe("POST /api/login", () => {
  it("lets the right code in and remembers it in an http-only cookie", async () => {
    process.env.APP_PASSWORD = PASSWORD;
    const res = await submit({ password: PASSWORD, next: "/history" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://app.test/history");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=${sessionToken(PASSWORD)}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("sends the wrong code back to the form without a session", async () => {
    process.env.APP_PASSWORD = PASSWORD;
    const res = await submit({ password: "wrong", next: "/history" });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("1");
    expect(location.searchParams.get("next")).toBe("/history");
    expect(res.headers.get("set-cookie") ?? "").not.toContain(sessionToken(PASSWORD));
  });

  it("refuses to bounce a visitor off to another site", async () => {
    process.env.APP_PASSWORD = PASSWORD;
    const res = await submit({ password: PASSWORD, next: "https://evil.example/steal" });
    expect(res.headers.get("location")).toBe("http://app.test/");
  });

  it("just goes to the app when no code is configured", async () => {
    const res = await submit({ password: "anything" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://app.test/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
