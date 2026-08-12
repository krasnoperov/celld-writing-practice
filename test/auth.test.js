import assert from "node:assert/strict";
import test from "node:test";
import { currentUser, handleAuth, signToken, verifyToken } from "../src/auth.js";

const env = {
  SESSION_SECRET: "test-secret-that-is-long-enough-for-tests",
  BASE_PATH: "/",
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  GITHUB_CALLBACK_URL: "https://writing.krasnoperov.me/auth/github/callback",
  ALLOWED_GITHUB_USERS: "krasnoperov",
  ACCOUNTS: {
    idFromName: (name) => name,
    get: () => ({ fetch: async () => new Response(JSON.stringify({ registered: true }), { headers: { "Content-Type": "application/json" } }) }),
  },
};

test("signed sessions identify one GitHub user and reject tampering", async () => {
  const token = await signToken({
    kind: "session",
    id: "4581825",
    login: "krasnoperov",
    avatarUrl: "https://avatars.example/user",
    exp: Date.now() + 60_000,
  }, env.SESSION_SECRET);
  const request = new Request("https://writing.krasnoperov.me/auth/me", {
    headers: { Cookie: `wc_session=${token}` },
  });

  assert.deepEqual(await currentUser(request, env), {
    id: "4581825",
    login: "krasnoperov",
    avatarUrl: "https://avatars.example/user",
  });
  const replacement = token.endsWith("x") ? "y" : "x";
  assert.equal(await verifyToken(`${token.slice(0, -1)}${replacement}`, env.SESSION_SECRET), null);
});

test("expired sessions are rejected", async () => {
  const token = await signToken({ kind: "session", id: "1", login: "old", exp: Date.now() - 1 }, env.SESSION_SECRET);
  assert.equal(await verifyToken(token, env.SESSION_SECRET), null);
});

test("GitHub login uses PKCE, signed state, and the configured callback", async () => {
  const response = await handleAuth(new Request("https://writing.krasnoperov.me/auth/github/login"), env);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location"));
  assert.equal(location.origin, "https://github.com");
  assert.equal(location.pathname, "/login/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), env.GITHUB_APP_CLIENT_ID);
  assert.equal(location.searchParams.get("redirect_uri"), env.GITHUB_CALLBACK_URL);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("code_challenge"));
  assert.ok(location.searchParams.get("state"));
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Lax/);
});

test("the GitHub callback accepts any valid GitHub identity", async () => {
  const login = await handleAuth(new Request("https://writing.krasnoperov.me/auth/github/login"), env);
  const authorization = new URL(login.headers.get("Location"));
  const oauthCookie = login.headers.get("Set-Cookie").match(/wc_oauth=([^;]+)/)[1];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("access_token")) return Response.json({ access_token: "temporary-token" });
    if (url === "https://api.github.com/user") return Response.json({ id: 9001, login: "a-new-writer", avatar_url: "https://avatars.example/new" });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const callback = await handleAuth(new Request(`${env.GITHUB_CALLBACK_URL}?code=valid&state=${authorization.searchParams.get("state")}`, {
      headers: { Cookie: `wc_oauth=${oauthCookie}` },
    }), env);
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get("Set-Cookie"), /wc_session=/);
    assert.doesNotMatch(callback.headers.get("Set-Cookie"), /not allowed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
