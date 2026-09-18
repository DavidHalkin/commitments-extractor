import { describe, expect, it } from "vitest";
import { appPassword, gateDecision, isPublicPath, isValidSession, safeNext, sessionToken } from "@/lib/auth/gate";

const PASSWORD = "a-long-access-code-nobody-guesses";

describe("appPassword", () => {
  it("is the configured code", () => {
    expect(appPassword({ APP_PASSWORD: PASSWORD })).toBe(PASSWORD);
  });

  it("is null when unset, empty or blank, which leaves the app open", () => {
    expect(appPassword({})).toBeNull();
    expect(appPassword({ APP_PASSWORD: "" })).toBeNull();
    expect(appPassword({ APP_PASSWORD: "   " })).toBeNull();
  });
});

describe("isPublicPath", () => {
  it("lets through the login form and the endpoints with their own authentication", () => {
    for (const p of ["/login", "/api/login", "/api/health", "/api/cron/cleanup"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("covers the app and its data", () => {
    for (const p of ["/", "/history", "/history/20260917T134225Z-kpoo1c", "/api/runs", "/api/runs/x/audio"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("is not fooled by a path that merely starts with a public one", () => {
    expect(isPublicPath("/logins")).toBe(false);
    expect(isPublicPath("/api/health-secrets")).toBe(false);
  });
});

describe("sessionToken", () => {
  it("is stable for one code and different for another", () => {
    expect(sessionToken(PASSWORD)).toBe(sessionToken(PASSWORD));
    expect(sessionToken(PASSWORD)).not.toBe(sessionToken(`${PASSWORD}!`));
  });

  it("does not contain the code itself", () => {
    expect(sessionToken(PASSWORD)).not.toContain(PASSWORD);
    expect(sessionToken(PASSWORD)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidSession", () => {
  it("accepts the token issued for the current code", () => {
    expect(isValidSession(sessionToken(PASSWORD), PASSWORD)).toBe(true);
  });

  it("rejects a missing, empty, wrong or stale token", () => {
    expect(isValidSession(undefined, PASSWORD)).toBe(false);
    expect(isValidSession("", PASSWORD)).toBe(false);
    expect(isValidSession("nope", PASSWORD)).toBe(false);
    expect(isValidSession(sessionToken("the previous code"), PASSWORD)).toBe(false);
  });
});

describe("gateDecision", () => {
  const signedIn = sessionToken(PASSWORD);

  it("allows everything when no code is configured", () => {
    expect(gateDecision({ pathname: "/history", token: undefined, password: null })).toBe("allow");
  });

  it("allows a visitor holding a valid session", () => {
    expect(gateDecision({ pathname: "/history", token: signedIn, password: PASSWORD })).toBe("allow");
  });

  it("sends a page request to the login form", () => {
    expect(gateDecision({ pathname: "/history", token: undefined, password: PASSWORD })).toBe("login");
  });

  it("answers an API request with an error instead of a login page", () => {
    expect(gateDecision({ pathname: "/api/runs", token: undefined, password: PASSWORD })).toBe("unauthorized");
  });

  it("keeps the public paths reachable while the gate is on", () => {
    expect(gateDecision({ pathname: "/login", token: undefined, password: PASSWORD })).toBe("allow");
    expect(gateDecision({ pathname: "/api/cron/cleanup", token: undefined, password: PASSWORD })).toBe("allow");
  });
});

describe("safeNext", () => {
  it("keeps a path inside the app", () => {
    expect(safeNext("/history")).toBe("/history");
    expect(safeNext("/history/20260917T134225Z-kpoo1c?tab=raw")).toBe("/history/20260917T134225Z-kpoo1c?tab=raw");
  });

  it("refuses anything that would leave the app", () => {
    expect(safeNext("https://evil.example/steal")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("history")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("never sends a visitor back to the login form", () => {
    expect(safeNext("/login")).toBe("/");
  });
});
