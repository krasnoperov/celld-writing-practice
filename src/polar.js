import { httpError } from "./http.js";

const encoder = new TextEncoder();
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function polarBase(env) {
  return (env.POLAR_API_BASE || "https://api.polar.sh/v1").replace(/\/$/, "");
}

function requirePolar(env, keys = ["POLAR_ACCESS_TOKEN", "POLAR_PRODUCT_ID"]) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw httpError(503, `Billing is not configured: ${missing.join(", ")}`);
}

async function polarRequest(env, pathname, init = {}) {
  requirePolar(env, ["POLAR_ACCESS_TOKEN"]);
  const response = await fetch(`${polarBase(env)}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : payload.error || `Polar request failed: ${response.status}`;
    throw httpError(response.status >= 500 ? 502 : 400, detail);
  }
  return payload;
}

function publicBase(env, request) {
  const value = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("PUBLIC_BASE_URL must use HTTPS");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function customerIp(request) {
  const value = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return value && /^[0-9a-f:.]{3,64}$/i.test(value) ? value : undefined;
}

export async function createPolarCheckout(env, user, request) {
  requirePolar(env);
  const base = publicBase(env, request);
  const success = new URL(base);
  success.searchParams.set("billing", "success");
  success.searchParams.set("checkout_id", "{CHECKOUT_ID}");
  const input = {
    products: [env.POLAR_PRODUCT_ID],
    external_customer_id: `github:${user.id}`,
    customer_name: user.login,
    customer_ip_address: customerIp(request),
    metadata: { github_user_id: String(user.id), github_login: user.login, source: "writing-practice" },
    success_url: success.toString(),
    return_url: base.toString(),
  };
  if (!input.customer_ip_address) delete input.customer_ip_address;
  const checkout = await polarRequest(env, "/checkouts", { method: "POST", body: JSON.stringify(input) });
  if (!checkout.url) throw httpError(502, "Polar did not return a checkout URL");
  return checkout.url;
}

export async function createPolarPortal(env, user, request) {
  requirePolar(env, ["POLAR_ACCESS_TOKEN"]);
  const session = await polarRequest(env, "/customer-sessions", {
    method: "POST",
    body: JSON.stringify({
      external_customer_id: `github:${user.id}`,
      return_url: publicBase(env, request).toString(),
    }),
  });
  if (!session.customer_portal_url) throw httpError(502, "Polar did not return a customer portal URL");
  return session.customer_portal_url;
}

export async function fetchPolarSubscription(env, userId) {
  requirePolar(env);
  const query = new URLSearchParams({
    external_customer_id: `github:${userId}`,
    product_id: env.POLAR_PRODUCT_ID,
    limit: "10",
    sorting: "-started_at",
  });
  const result = await polarRequest(env, `/subscriptions?${query}`);
  const subscriptions = (Array.isArray(result.items) ? result.items : []).filter((value) => {
    const productId = value.product_id ?? value.productId ?? record(value.product)?.id;
    return productId === env.POLAR_PRODUCT_ID;
  });
  const subscription = subscriptions.find((value) => ["active", "trialing"].includes(value.status)) || subscriptions[0] || null;
  if (!subscription) return null;
  const eventAt = new Date().toISOString();
  return {
    webhookId: `reconcile:${userId}:${subscription.id}:${subscription.modified_at || eventAt}`,
    eventType: "subscription.reconciled",
    eventAt,
    subscription: subscriptionValue(subscription, record(subscription.customer), eventAt),
    order: null,
  };
}

function base64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secretBytes(secret) {
  if (secret.startsWith("whsec_")) return base64Bytes(secret.slice(6));
  return encoder.encode(secret);
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyPolarWebhook(rawBody, headers, secret, now = Date.now()) {
  if (!secret) throw httpError(503, "Polar webhook verification is unavailable");
  const webhookId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = (headers.get("webhook-signature") || "").split(/\s+/).filter(Boolean);
  if (!webhookId || !timestamp || !/^\d+$/.test(timestamp) || !signatures.length) throw httpError(401, "Polar webhook signature headers are missing");
  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (age > WEBHOOK_TOLERANCE_SECONDS) throw httpError(401, "Polar webhook timestamp is outside the replay window");

  const key = await crypto.subtle.importKey("raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${webhookId}.${timestamp}.${rawBody}`)));
  const valid = signatures.some((signature) => {
    const [version, encoded, extra] = signature.split(",");
    if (version !== "v1" || !encoded || extra) return false;
    try { return equalBytes(expected, base64Bytes(encoded)); } catch { return false; }
  });
  if (!valid) throw httpError(401, "Polar webhook signature is invalid");
  return webhookId;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function optionalString(value) {
  return typeof value === "string" && value ? value : null;
}

function customerFrom(data) {
  return record(data.customer) || record(data.subscription)?.customer || record(data.order)?.customer || (
    data.external_id || data.externalId ? data : null
  );
}

function externalCustomerId(data) {
  const customer = customerFrom(data);
  return optionalString(customer?.external_id ?? customer?.externalId ?? data.external_id ?? data.externalId ?? data.external_customer_id ?? data.externalCustomerId);
}

export function githubIdFromPolarEvent(payload) {
  const data = record(payload?.data);
  if (!data) throw new Error("Polar webhook data must be an object");
  const externalId = externalCustomerId(data);
  const match = externalId?.match(/^github:([A-Za-z0-9_-]{1,80})$/);
  if (!match) throw new Error("Polar customer is missing a valid GitHub external ID");
  return match[1];
}

function subscriptionValue(source, customer, eventAt) {
  return {
    id: optionalString(source.id),
    status: optionalString(source.status) || "inactive",
    customerId: optionalString(customer?.id ?? source.customer_id ?? source.customerId),
    productId: optionalString(source.product_id ?? source.productId ?? record(source.product)?.id),
    currentPeriodStart: optionalString(source.current_period_start ?? source.currentPeriodStart),
    currentPeriodEnd: optionalString(source.current_period_end ?? source.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(source.cancel_at_period_end ?? source.cancelAtPeriodEnd),
    modifiedAt: optionalString(source.modified_at ?? source.modifiedAt) || eventAt,
  };
}

export function normalizePolarEvent(payload, webhookId, configuredProductId) {
  if (!record(payload) || typeof payload.type !== "string" || !record(payload.data)) throw new Error("Polar webhook payload must include type and data");
  const data = payload.data;
  const eventAt = optionalString(payload.timestamp) || new Date().toISOString();
  const customer = customerFrom(data);
  const base = { webhookId, eventType: payload.type, eventAt, subscription: null, order: null };

  if (payload.type.startsWith("subscription.")) {
    const source = record(data.subscription) || data;
    const subscription = subscriptionValue(source, customer, eventAt);
    if (subscription.productId !== configuredProductId) return { ...base, ignored: true };
    return { ...base, subscription };
  }

  if (payload.type === "customer.state_changed") {
    const active = data.active_subscriptions ?? data.activeSubscriptions ?? customer?.active_subscriptions ?? customer?.activeSubscriptions;
    const matching = Array.isArray(active) ? active.map(record).filter(Boolean).find((value) => (value.product_id ?? value.productId) === configuredProductId) : null;
    if (matching) return { ...base, subscription: subscriptionValue(matching, customer, eventAt) };
    return { ...base, subscription: {
      id: null,
      status: "canceled",
      customerId: optionalString(customer?.id),
      productId: configuredProductId,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      modifiedAt: eventAt,
    } };
  }

  if (payload.type === "order.paid" || payload.type === "order.created") {
    const source = record(data.order) || data;
    const productId = optionalString(source.product_id ?? source.productId ?? record(source.product)?.id);
    if (productId !== configuredProductId) return { ...base, ignored: true };
    return { ...base, order: {
      id: optionalString(source.id),
      amount: Number.isFinite(source.total_amount ?? source.totalAmount ?? source.amount) ? Number(source.total_amount ?? source.totalAmount ?? source.amount) : null,
      currency: optionalString(source.currency)?.toUpperCase() || null,
      billingReason: optionalString(source.billing_reason ?? source.billingReason),
      invoiceNumber: optionalString(source.invoice_number ?? source.invoiceNumber ?? record(source.invoice)?.number),
    } };
  }

  return base;
}
