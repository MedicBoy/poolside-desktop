#!/usr/bin/env node
/*
 * mercury-secrets-migrate.cjs
 * ------------------------------------------------------------------
 * Moves env-backed secrets out of ~/.mercury/mercury.yaml and into
 * ~/.mercury/.env (which Mercury loads via dotenv at startup).
 *
 * Why this works with Mercury Agent 1.2.7:
 *   - getDefaultConfig() seeds every provider apiKey / channel token
 *     from process.env (e.g. DEEPSEEK_API_KEY, TELEGRAM_BOT_TOKEN).
 *   - loadConfig() = deepMerge(defaults, fileConfig) -> fileConfig wins.
 *     A literal `apiKey: ""` in the yaml SHADOWS the env default, so the
 *     key line must be REMOVED (not blanked) for env to take effect.
 *
 * Behaviour:
 *   - Surgical: deletes only the target lines; the rest of the file is
 *     byte-identical (comments, ordering and formatting preserved).
 *   - Idempotent: safe to re-run; reports "already absent".
 *   - Never prints secret values -- only lengths.
 *
 * Usage:  node mercury-secrets-migrate.cjs [--dry-run]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");

const HOME = process.env.MERCURY_HOME || path.join(os.homedir(), ".mercury");
const YAML_PATH = path.join(HOME, "mercury.yaml");
const ENV_PATH = path.join(HOME, ".env");

// 2-space indented block -> leaf key -> env var read by getDefaultConfig()
const TARGETS = [
  { block: "deepseek", leaf: "apiKey", env: "DEEPSEEK_API_KEY" },
  { block: "telegram", leaf: "botToken", env: "TELEGRAM_BOT_TOKEN" },
];

function die(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}

if (!fs.existsSync(YAML_PATH)) die("not found: " + YAML_PATH);

const rawYaml = fs.readFileSync(YAML_PATH, "utf8");
const EOL = rawYaml.includes("\r\n") ? "\r\n" : "\n";
let lines = rawYaml.split(/\r?\n/);

// ---- locate target leaf lines (bottom-up so indices stay valid) ----
const found = [];
for (const t of TARGETS) {
  const blockRe = new RegExp("^ {2}" + t.block + ":\\s*$");
  const blockIdx = lines.findIndex((l) => blockRe.test(l));
  if (blockIdx === -1) {
    console.log(`[skip] block "${t.block}:" not found in yaml`);
    continue;
  }
  // scan the block body until the next 2-space sibling key
  const leafRe = new RegExp("^\\s+" + t.leaf + ":\\s*(.*)$");
  let leafIdx = -1;
  for (let i = blockIdx + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break; // next sibling block
    if (leafRe.test(lines[i])) { leafIdx = i; break; }
  }
  if (leafIdx === -1) {
    console.log(`[skip] ${t.block}.${t.leaf} already absent`);
    continue;
  }
  let val = leafRe.exec(lines[leafIdx])[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  found.push({ ...t, lineIdx: leafIdx, lineNo: leafIdx + 1, value: val });
}

if (found.length === 0) {
  console.log("Nothing to migrate -- yaml is already clean.");
  process.exit(0);
}

// ---- report what we found ----
console.log(DRY_RUN ? "=== DRY RUN ===" : "=== MIGRATING ===");
for (const f of found) {
  console.log(
    `  ${f.block}.${f.leaf} (yaml line ${f.lineNo}): ${f.value.length} chars -> ${f.env}`
  );
}

// ---- build .env additions ----
let envRaw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
if (!envRaw.endsWith("\n") && envRaw.length > 0) envRaw += "\n";

const additions = [];
for (const f of found) {
  const existing = new RegExp("^" + f.env + "=", "m");
  if (existing.test(envRaw)) {
    console.log(`[note] ${f.env} already present in .env -- yaml copy will still be removed`);
    // leave the existing .env entry untouched (env is source of truth)
  } else {
    const escaped = f.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    additions.push(`${f.env}="${escaped}"`);
  }
}

if (DRY_RUN) {
  console.log("\n.env lines that would be appended: " + (additions.length || "(none)"));
  console.log("yaml lines that would be deleted: " + found.map((f) => f.lineNo).join(", "));
  process.exit(0);
}

// ---- write .env ----
if (additions.length > 0) {
  fs.writeFileSync(ENV_PATH, envRaw + additions.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(`\n[ok] .env updated (+${additions.length} line(s))`);
} else {
  console.log("\n[ok] .env unchanged (all vars already present)");
}

// ---- delete yaml leaf lines, bottom-up ----
for (const f of found.sort((a, b) => b.lineIdx - a.lineIdx)) {
  lines.splice(f.lineIdx, 1);
}

fs.writeFileSync(YAML_PATH, lines.join(EOL), { encoding: "utf8", mode: 0o600 });
console.log(`[ok] mercury.yaml updated (-${found.length} line(s))`);
console.log("\nDone. Restart Mercury, then verify providers + Telegram still work.");
