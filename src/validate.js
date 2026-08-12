export function text(value, name, { min = 1, max = 300 } = {}) {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const result = value.trim();
  if (result.length < min || result.length > max) {
    throw new Error(`${name} must be between ${min} and ${max} characters`);
  }
  return result;
}

export function integer(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function singleLine(value, name, { min = 3, max = 160 } = {}) {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  return text(value.replace(/\s+/g, " "), name, { min, max });
}
