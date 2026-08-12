import { json } from "./http.js";
import { registerAccount } from "./billing.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url encoding");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) throw new Error("Non-canonical base64url encoding");
  return bytes;
}

function encodeJson(value) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(decoder.decode(base64UrlToBytes(value)));
}

async function signingKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken(payload, secret) {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const body = encodeJson(payload);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      base64UrlToBytes(signature),
      encoder.encode(body),
    );
    if (!valid) return null;
    const payload = decodeJson(body);
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(/;\s*/).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return separator === -1 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
}

function cookiePath(env) {
  const path = env.BASE_PATH || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function setCookie(name, value, env, maxAge) {
  return `${name}=${value}; Path=${cookiePath(env)}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function pkceChallenge(verifier) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

function requireGithubConfig(env) {
  const required = ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_CALLBACK_URL", "SESSION_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Authentication is not configured: ${missing.join(", ")}`);
}

export async function currentUser(request, env) {
  const session = await verifyToken(cookies(request).wc_session, env.SESSION_SECRET);
  if (!session || session.kind !== "session" || !session.id || !session.login) return null;
  return { id: session.id, login: session.login, avatarUrl: session.avatarUrl };
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/auth/me") {
    const user = await currentUser(request, env);
    if (user) await registerAccount(env, user);
    return json({ user });
  }

  if (request.method === "GET" && url.pathname === "/auth/github/login") {
    try {
      requireGithubConfig(env);
      const state = randomToken();
      const verifier = randomToken(48);
      const flow = await signToken({ kind: "oauth", state, verifier, exp: Date.now() + 10 * 60_000 }, env.SESSION_SECRET);
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
      target.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL);
      target.searchParams.set("state", state);
      target.searchParams.set("code_challenge", await pkceChallenge(verifier));
      target.searchParams.set("code_challenge_method", "S256");
      target.searchParams.set("allow_signup", "false");
      return new Response(null, {
        status: 302,
        headers: { Location: target.toString(), "Set-Cookie": setCookie("wc_oauth", flow, env, 600) },
      });
    } catch (error) {
      return json({ error: error.message }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/auth/github/callback") {
    try {
      requireGithubConfig(env);
      if (url.searchParams.get("error")) throw new Error(`GitHub authorization failed: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`);
      const flow = await verifyToken(cookies(request).wc_oauth, env.SESSION_SECRET);
      if (!flow || flow.kind !== "oauth" || flow.state !== url.searchParams.get("state")) throw new Error("The GitHub sign-in state is invalid or expired");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("GitHub did not return an authorization code");

      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "celld-writing-coach" },
        body: JSON.stringify({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code,
          redirect_uri: env.GITHUB_CALLBACK_URL,
          code_verifier: flow.verifier,
        }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || "GitHub token exchange failed");

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenPayload.access_token}`,
          "User-Agent": "celld-writing-coach",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const githubUser = await userResponse.json();
      if (!userResponse.ok || !githubUser.id || !githubUser.login) throw new Error(githubUser.message || "GitHub profile lookup failed");

      await registerAccount(env, {
        id: String(githubUser.id),
        login: githubUser.login,
        avatarUrl: githubUser.avatar_url,
      });

      const session = await signToken({
        kind: "session",
        id: String(githubUser.id),
        login: githubUser.login,
        avatarUrl: githubUser.avatar_url,
        iat: Date.now(),
        exp: Date.now() + 7 * 24 * 60 * 60_000,
      }, env.SESSION_SECRET);
      const headers = new Headers({ Location: cookiePath(env) });
      headers.append("Set-Cookie", setCookie("wc_session", session, env, 7 * 24 * 60 * 60));
      headers.append("Set-Cookie", setCookie("wc_oauth", "", env, 0));
      return new Response(null, { status: 302, headers });
    } catch (error) {
      return json({ error: error.message }, 400, { "Set-Cookie": setCookie("wc_oauth", "", env, 0) });
    }
  }

  if (request.method === "POST" && url.pathname === "/auth/logout") {
    return json({ signedOut: true }, 200, { "Set-Cookie": setCookie("wc_session", "", env, 0) });
  }

  return json({ error: "Route not found" }, 404);
}
