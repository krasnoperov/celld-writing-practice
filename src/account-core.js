export const ACCOUNT_VERSION = 1;
const MAX_AUDIT_EVENTS = 250;
const MAX_ADMIN_ACTIONS = 300;
const MAX_OPERATIONS = 300;
const MAX_WEBHOOK_IDS = 300;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const USAGE_RESOLUTIONS = new Set(["completed", "released"]);

function nowIso(now) {
  return new Date(now).toISOString();
}

function appendAudit(account, type, message, data, now = Date.now()) {
  account.audit.push({ id: crypto.randomUUID(), at: nowIso(now), type, message, data });
  account.audit = account.audit.slice(-MAX_AUDIT_EVENTS);
  account.updatedAt = now;
}

export function createAccount(userId, monthlyAllowance, now = Date.now()) {
  return {
    version: ACCOUNT_VERSION,
    userId: String(userId),
    profile: null,
    subscription: {
      status: "inactive",
      customerId: null,
      subscriptionId: null,
      productId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      providerModifiedAt: null,
    },
    usage: {
      monthlyAllowance,
      granted: 0,
      used: 0,
      periodStart: null,
      periodEnd: null,
    },
    operations: [],
    adminActions: [],
    processedWebhookIds: [],
    audit: [],
    pendingAdminSync: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function hasPaidAccess(account, now = Date.now()) {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(account.subscription.status)) return false;
  const periodEnd = account.subscription.currentPeriodEnd;
  if (typeof periodEnd !== "string" || !periodEnd) return false;
  const periodEndAt = new Date(periodEnd).getTime();
  return Number.isFinite(periodEndAt) && periodEndAt > now;
}

export function remainingCredits(account) {
  return Math.max(0, account.usage.granted - account.usage.used);
}

export function registerProfile(account, profile, now = Date.now()) {
  const changed = !account.profile || account.profile.login !== profile.login || account.profile.avatarUrl !== profile.avatarUrl;
  account.profile = {
    login: profile.login,
    avatarUrl: profile.avatarUrl || "",
    lastLoginAt: nowIso(now),
  };
  account.pendingAdminSync = true;
  account.updatedAt = now;
  if (changed) appendAudit(account, "identity", `GitHub identity ${profile.login} registered`, { login: profile.login }, now);
  return account;
}

function resetPeriod(account, subscription, now) {
  account.usage.granted = account.usage.monthlyAllowance;
  account.usage.used = 0;
  account.usage.periodStart = subscription.currentPeriodStart;
  account.usage.periodEnd = subscription.currentPeriodEnd;
  appendAudit(account, "allowance", `Monthly allowance reset to ${account.usage.monthlyAllowance}`, {
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    granted: account.usage.monthlyAllowance,
  }, now);
}

export function applyPolarEvent(account, event, now = Date.now()) {
  if (account.processedWebhookIds.includes(event.webhookId)) return { account, duplicate: true };
  account.processedWebhookIds.push(event.webhookId);
  account.processedWebhookIds = account.processedWebhookIds.slice(-MAX_WEBHOOK_IDS);

  if (event.subscription) {
    const incomingModifiedAt = event.subscription.modifiedAt || event.eventAt;
    const currentModifiedAt = account.subscription.providerModifiedAt;
    const stale = currentModifiedAt && incomingModifiedAt && new Date(incomingModifiedAt).getTime() < new Date(currentModifiedAt).getTime();
    if (stale) {
      appendAudit(account, "webhook_ignored", `Ignored stale ${event.eventType}`, { webhookId: event.webhookId }, now);
    } else {
      const periodChanged = Boolean(
        event.subscription.currentPeriodStart &&
        event.subscription.currentPeriodStart !== account.usage.periodStart,
      );
      account.subscription = {
        status: event.subscription.status,
        customerId: event.subscription.customerId || account.subscription.customerId,
        subscriptionId: event.subscription.id || account.subscription.subscriptionId,
        productId: event.subscription.productId || account.subscription.productId,
        currentPeriodStart: event.subscription.currentPeriodStart,
        currentPeriodEnd: event.subscription.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(event.subscription.cancelAtPeriodEnd),
        providerModifiedAt: incomingModifiedAt || currentModifiedAt,
      };
      if (ACTIVE_SUBSCRIPTION_STATUSES.has(event.subscription.status) && periodChanged) resetPeriod(account, event.subscription, now);
      appendAudit(account, "subscription", `${event.eventType}: ${event.subscription.status}`, {
        webhookId: event.webhookId,
        subscriptionId: event.subscription.id,
        productId: event.subscription.productId,
        currentPeriodEnd: event.subscription.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(event.subscription.cancelAtPeriodEnd),
      }, now);
    }
  } else if (event.order) {
    appendAudit(account, "payment", `${event.eventType}: ${event.order.billingReason || "payment"}`, {
      webhookId: event.webhookId,
      orderId: event.order.id,
      amount: event.order.amount,
      currency: event.order.currency,
      invoiceNumber: event.order.invoiceNumber,
    }, now);
  } else {
    appendAudit(account, "webhook", `Received ${event.eventType}`, { webhookId: event.webhookId }, now);
  }

  account.pendingAdminSync = true;
  return { account, duplicate: false };
}

function operation(account, requestId) {
  return account.operations.find((candidate) => candidate.id === requestId) || null;
}

export function authorizeUsage(account, input, now = Date.now()) {
  const existing = operation(account, input.requestId);
  if (existing) {
    const sameOperation = existing.action === input.action && (existing.pieceId || null) === (input.pieceId || null);
    if (!sameOperation) {
      return { allowed: false, reason: "idempotency_conflict", duplicate: true, operation: null, remaining: remainingCredits(account) };
    }
    return {
      allowed: existing.status !== "released",
      reason: existing.status === "released" ? "operation_released" : null,
      duplicate: true,
      operation: existing,
      remaining: remainingCredits(account),
    };
  }
  if (!input.admin && !hasPaidAccess(account, now)) return { allowed: false, reason: "subscription_required", remaining: remainingCredits(account) };
  if (!input.admin && remainingCredits(account) < 1) return { allowed: false, reason: "monthly_allowance_exhausted", remaining: 0 };

  const value = {
    id: input.requestId,
    action: input.action,
    pieceId: input.pieceId || null,
    status: "reserved",
    charged: !input.admin,
    createdAt: nowIso(now),
    completedAt: null,
    result: null,
  };
  if (value.charged) account.usage.used += 1;
  account.operations.push(value);
  // Settled receipts rotate; a reservation whose outcome is still unknown is
  // never evicted while its charge stands.
  if (account.operations.length > MAX_OPERATIONS) {
    const reserved = account.operations.filter((operation) => operation.status === "reserved");
    const settled = account.operations
      .filter((operation) => operation.status !== "reserved")
      .slice(-Math.max(0, MAX_OPERATIONS - reserved.length));
    account.operations = [...reserved, ...settled].sort((left, right) => left.createdAt < right.createdAt ? -1 : 1);
  }
  appendAudit(account, "usage_reserved", `${input.action} reserved one coach session`, {
    requestId: input.requestId,
    pieceId: value.pieceId,
    charged: value.charged,
  }, now);
  account.pendingAdminSync = true;
  return { allowed: true, duplicate: false, operation: value, remaining: input.admin ? null : remainingCredits(account) };
}

export function completeUsage(account, requestId, result, now = Date.now()) {
  const value = operation(account, requestId);
  if (!value) throw new Error("Usage reservation not found");
  if (value.status === "completed") return value;
  if (value.status === "released") throw new Error("Usage reservation was released");
  value.status = "completed";
  if (!value.pieceId && result.pieceId) value.pieceId = result.pieceId;
  value.completedAt = nowIso(now);
  value.result = result;
  appendAudit(account, "usage_completed", `${value.action} accepted`, { requestId, status: result.status }, now);
  account.pendingAdminSync = true;
  return value;
}

export function purgePieceUsage(account, pieceId, now = Date.now()) {
  const before = account.operations.length;
  const auditBefore = account.audit.length;
  account.operations = account.operations.filter((value) => value.pieceId !== pieceId);
  account.audit = account.audit.filter((event) => event.data?.pieceId !== pieceId);
  const removed = before - account.operations.length;
  const auditRemoved = auditBefore - account.audit.length;
  if (removed || auditRemoved) {
    appendAudit(account, "piece_usage_purged", "Removed cached responses for a deleted piece", { removed, auditRemoved }, now);
    account.pendingAdminSync = true;
  }
  return { removed, auditRemoved };
}

export function releaseUsage(account, requestId, reason, now = Date.now()) {
  const value = operation(account, requestId);
  if (!value || value.status === "released") return value;
  if (value.status === "completed") return value;
  value.status = "released";
  value.completedAt = nowIso(now);
  if (value.charged) account.usage.used = Math.max(0, account.usage.used - 1);
  appendAudit(account, "usage_released", `${value.action} reservation released`, { requestId, reason }, now);
  account.pendingAdminSync = true;
  return value;
}

export function adjustCredits(account, input, now = Date.now()) {
  const adminAction = inspectAdminAction(account, {
    id: input.adminActionId,
    kind: "adjustment",
    fingerprint: JSON.stringify({ delta: input.delta, reason: input.reason, actorId: input.actorId }),
  });
  if (adminAction.duplicate) return { account, duplicate: true };
  const nextGranted = account.usage.granted + input.delta;
  if (nextGranted < account.usage.used) throw new Error("Adjustment would make the balance negative");
  account.usage.granted = nextGranted;
  recordAdminAction(account, adminAction.action, now);
  appendAudit(account, "admin_adjustment", `${input.delta > 0 ? "+" : ""}${input.delta} agent runs`, {
    adminActionId: input.adminActionId,
    delta: input.delta,
    reason: input.reason,
    actorId: input.actorId,
    actorLogin: input.actorLogin,
  }, now);
  account.pendingAdminSync = true;
  return { account, duplicate: false };
}

function inspectAdminAction(account, input) {
  account.adminActions ??= [];
  const existing = account.adminActions.find((candidate) => candidate.id === input.id);
  if (existing) {
    if (existing.kind !== input.kind || existing.fingerprint !== input.fingerprint) {
      throw Object.assign(new Error("Admin idempotency key was already used for another operation"), { status: 409 });
    }
    return { duplicate: true, action: existing };
  }
  return { duplicate: false, action: { id: input.id, kind: input.kind, fingerprint: input.fingerprint } };
}

function recordAdminAction(account, action, now) {
  action.createdAt = nowIso(now);
  account.adminActions.push(action);
  account.adminActions = account.adminActions.slice(-MAX_ADMIN_ACTIONS);
}

export function resolveUsage(account, input, now = Date.now()) {
  const fingerprint = JSON.stringify({
    requestId: input.requestId,
    resolution: input.resolution,
    reason: input.reason,
    actorId: input.actorId,
  });
  const adminAction = inspectAdminAction(account, {
    id: input.adminActionId,
    kind: "usage_resolution",
    fingerprint,
  });
  const value = operation(account, input.requestId);
  if (adminAction.duplicate) return { operation: value, duplicate: true };
  if (!value) throw new Error("Usage reservation not found");
  if (value.status !== "reserved") throw Object.assign(new Error("Only a pending usage reservation can be resolved"), { status: 409 });
  if (!USAGE_RESOLUTIONS.has(input.resolution)) throw new Error("Unknown usage resolution");

  recordAdminAction(account, adminAction.action, now);
  value.status = input.resolution;
  value.completedAt = nowIso(now);
  value.resolution = {
    reason: input.reason,
    actorId: input.actorId,
    actorLogin: input.actorLogin,
    adminActionId: input.adminActionId,
  };
  if (input.resolution === "released" && value.charged) account.usage.used = Math.max(0, account.usage.used - 1);
  appendAudit(account, `usage_admin_${input.resolution}`, `${value.action} marked ${input.resolution} by an administrator`, {
    requestId: value.id,
    pieceId: value.pieceId,
    reason: input.reason,
    actorId: input.actorId,
    actorLogin: input.actorLogin,
    adminActionId: input.adminActionId,
  }, now);
  account.pendingAdminSync = true;
  return { operation: value, duplicate: false };
}

export function adminAccount(account) {
  return {
    ...account,
    operations: account.operations.map((value) => ({
      ...value,
      result: value.result ? {
        status: value.result.status,
        contentType: value.result.contentType,
        bodyLength: typeof value.result.body === "string" ? value.result.body.length : 0,
      } : null,
    })),
  };
}

export function accountSummary(account) {
  return {
    userId: account.userId,
    login: account.profile?.login || "unknown",
    avatarUrl: account.profile?.avatarUrl || "",
    subscriptionStatus: account.subscription.status,
    currentPeriodEnd: account.subscription.currentPeriodEnd,
    cancelAtPeriodEnd: account.subscription.cancelAtPeriodEnd,
    granted: account.usage.granted,
    used: account.usage.used,
    remaining: remainingCredits(account),
    pendingOperations: account.operations.filter((value) => value.status === "reserved").length,
    updatedAt: account.updatedAt,
  };
}

export function publicAccount(account, options = {}) {
  const admin = Boolean(options.admin);
  return {
    entitled: admin || hasPaidAccess(account),
    admin,
    configured: Boolean(options.configured),
    plan: {
      name: options.planName || "Writing Practice monthly",
      monthlyAllowance: account.usage.monthlyAllowance,
    },
    subscription: { ...account.subscription },
    usage: {
      granted: account.usage.granted,
      used: account.usage.used,
      remaining: admin ? null : remainingCredits(account),
      periodStart: account.usage.periodStart,
      periodEnd: account.usage.periodEnd,
    },
  };
}
