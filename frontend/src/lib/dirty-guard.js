export const MAX_FLUSH_ATTEMPTS = 3;

export async function flushPendingChanges({ isDirty, save, isBlocked, maxAttempts = MAX_FLUSH_ATTEMPTS }) {
  let attempts = 0;
  while (isDirty() && attempts < maxAttempts) {
    if (isBlocked()) return { saved: false, reason: "blocked", attempts };
    await save();
    attempts += 1;
  }
  if (isBlocked()) return { saved: false, reason: "blocked", attempts };
  return { saved: !isDirty(), reason: isDirty() ? "still-dirty" : null, attempts };
}

export function guardDirtyPage(event, dirty) {
  if (!dirty) return false;
  event.preventDefault();
  event.returnValue = "";
  return true;
}
