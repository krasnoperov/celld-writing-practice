import { errorResponse, httpError, json } from "./http.js";
import { currentUser, handleAuth } from "./auth.js";
import {
  billingStatus,
  deleteAccountCell,
  handleBilling,
  handleBillingAdmin,
  handlePolarWebhook,
  withUsageAuthorization,
} from "./billing.js";
import { chargeableAction, deleteAllPieces, handlePieces } from "./pieces.js";
export { WritingCoach } from "./coach.js";
export { WritingLibrary } from "./library.js";
export { BillingAdmin, WritingAccount } from "./account.js";

function hasTrustedOrigin(request, env) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(env.PUBLIC_BASE_URL || request.url).origin;
  } catch {
    return false;
  }
}

async function serveAsset(env, request, assetPath) {
  const url = new URL(request.url);
  url.pathname = assetPath;
  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(response.body, { status: response.status, headers });
}

const PAGE_ASSETS = {
  "/privacy": "/privacy.page",
  "/pricing": "/pricing.page",
  "/admin": "/admin.page",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "writing-practice",
        provider: env.COACH_PROVIDER || "demo",
        billingConfigured: Boolean(env.POLAR_ACCESS_TOKEN && env.POLAR_PRODUCT_ID && env.POLAR_WEBHOOK_SECRET),
      });
    }
    if (!hasTrustedOrigin(request, env)) return errorResponse(httpError(403, "Cross-site request rejected"));
    if (url.pathname === "/api/webhooks/polar" && request.method === "POST") return handlePolarWebhook(request, env);
    if (url.pathname.startsWith("/auth/")) return handleAuth(request, env);
    if (url.pathname.startsWith("/api/billing/") || url.pathname.startsWith("/api/admin/")) {
      const user = await currentUser(request, env);
      if (!user) return errorResponse(httpError(401, "Sign in with GitHub first"));
      return url.pathname.startsWith("/api/admin/") ? handleBillingAdmin(request, env, user) : handleBilling(request, env, user);
    }
    if (url.pathname === "/api/account" && request.method === "DELETE") {
      const user = await currentUser(request, env);
      if (!user) return errorResponse(httpError(401, "Sign in with GitHub first"));
      const status = await billingStatus(env, user);
      const active = ["active", "trialing"].includes(status.subscription?.status);
      if (active) {
        return errorResponse(httpError(409, "The subscription must end before the account can be deleted."));
      }
      try {
        await deleteAllPieces(env, user);
        await deleteAccountCell(env, user.id);
        return json({ deleted: true }, 200, { "Set-Cookie": "wc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
      } catch (error) {
        return errorResponse(error, 502);
      }
    }
    if (url.pathname === "/api/pieces" || url.pathname.startsWith("/api/pieces/")) {
      const user = await currentUser(request, env);
      if (!user) return errorResponse(httpError(401, "Sign in with GitHub to use the writing desk"));
      const access = await billingStatus(env, user);
      if (!access.entitled) return errorResponse(httpError(402, "A monthly subscription is required to use the writing desk"));
      const charged = chargeableAction(request, url);
      return charged
        ? withUsageAuthorization(request, env, user, charged.action, charged.pieceId, () => handlePieces(request, env, user))
        : handlePieces(request, env, user);
    }
    if (env.ASSETS) {
      if (PAGE_ASSETS[url.pathname]) return serveAsset(env, request, PAGE_ASSETS[url.pathname]);
      if (url.pathname === "/desk" || url.pathname.startsWith("/desk/")) {
        return serveAsset(env, request, "/");
      }
      return env.ASSETS.fetch(request);
    }
    return errorResponse(httpError(404, "Route not found"));
  },
};
