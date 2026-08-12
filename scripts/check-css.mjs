import { readFile, readdir } from "node:fs/promises";

const frontendRoot = new URL("../frontend/src/", import.meta.url);
const failures = [];

const tokens = await readFile(new URL("tokens.css", frontendRoot), "utf8");

const requireToken = (pattern, message) => {
  if (!pattern.test(tokens)) failures.push(message);
};

requireToken(/--color-[\w-]+:/, "semantic color tokens are missing from tokens.css");
requireToken(/--space-1:\s*0\.25rem/, "the spacing scale must use a 4px base unit");
requireToken(/--radius-[\w-]+:/, "radius tokens are missing from tokens.css");
requireToken(/--shadow-[\w-]+:/, "shadow tokens are missing from tokens.css");
requireToken(/oklch\(/, "the palette must use OKLCH");
requireToken(/--ease-ink:/, "the motion tokens are missing from tokens.css");

// Everything outside tokens.css consumes semantic tokens: no raw color
// functions, no px vertical rhythm, no fluid vertical spacing.
async function componentSources() {
  const sources = [["base.css", await readFile(new URL("base.css", frontendRoot), "utf8")]];
  const entries = await readdir(frontendRoot, { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith(".svelte")) continue;
    const source = await readFile(new URL(entry, frontendRoot), "utf8");
    for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      sources.push([`frontend/src/${entry}`, match[1]]);
    }
  }
  return sources;
}

const forbid = (file, css, pattern, message) => {
  const match = css.match(pattern);
  if (match) failures.push(`${file}: ${message}: ${match[0].trim()}`);
};

for (const [file, css] of await componentSources()) {
  forbid(file, css, /#[\da-f]{3,8}\b/i, "hex colors are forbidden outside tokens.css");
  forbid(file, css, /\brgba?\(/i, "RGB colors are forbidden outside tokens.css");
  forbid(file, css, /\bhsla?\(/i, "HSL colors are forbidden outside tokens.css");
  forbid(file, css, /\boklch\(/i, "raw OKLCH values are forbidden outside tokens.css");
  forbid(
    file, css,
    /(?:margin(?:-(?:top|bottom))?|padding(?:-(?:top|bottom))?|gap|row-gap)\s*:[^;{}]*\b\d+(?:\.\d+)?px\b/i,
    "vertical spacing must use the token scale",
  );
  forbid(file, css, /(?:margin|gap|row-gap)\s*:[^;{}]*clamp\(/i, "fluid vertical spacing is forbidden");
  forbid(
    file, css,
    /font(?:-size)?\s*:[^;{}]*(?:(?<![\d.])0?\.\d+(?:rem|em)|(?<![\d.])(?:\d|1[0-5])(?:\.\d+)?px)\b/i,
    "type floor: no font-size below 1rem (16px)",
  );
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("CSS contract passed: OKLCH tokens in one file, token-consuming components, 4px vertical rhythm.");
}
