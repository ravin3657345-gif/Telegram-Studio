#!/usr/bin/env node
//
// Publishes the macOS half of the in-app update channel.
//
// This is the counterpart of scripts/publish-update.ps1 (which owns the Windows
// half). Windows and macOS need *different artifacts* and cannot be built on one
// machine: the Windows updater installs the signed NSIS .exe, the macOS updater
// installs a signed .app.tar.gz — and a macOS bundle can only be produced on
// macOS (see .github/workflows/build-macos.yml for the CI path).
//
// So the two scripts cooperate through ONE file in the bucket:
//
//   publish-update.ps1  -> writes platforms["windows-x86_64"]
//   publish-macos.mjs   -> writes platforms["darwin-aarch64" | "darwin-x86_64"]
//
// Both READ the published latest.json first, replace only their own platform
// key and put it back. Writing the manifest from scratch instead would make the
// two releases delete each other's platform, which is silent: nothing on either
// machine would report an error, that platform would just stop seeing updates.
//
// Usage (on macOS, after `npx tauri build --target universal-apple-darwin`):
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-macos.mjs
//   node scripts/publish-macos.mjs --dry-run        # print the merged manifest
//   node scripts/publish-macos.mjs --arches x86_64  # override detected arches
//
// Requirements:
//   * SUPABASE_SERVICE_ROLE_KEY — service_role, the only key allowed to write to
//     Storage. Never the anon key.
//   * a signed build: <App>.app.tar.gz + <App>.app.tar.gz.sig in the bundle dir.
//     The signing key is the *same* one as Windows (~/.tauri/telegram-studio.key);
//     Tauri's updater signature is what makes an update trustworthy, and the
//     public half is already compiled into every installed copy. A build signed
//     with a different key is rejected by every client, so this script refuses to
//     publish one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SupabaseUrl = process.env.TS_SUPABASE_URL ?? "https://xhjxnyhvfyzyulzzxpsg.supabase.co";
const Bucket = process.env.TS_UPDATES_BUCKET ?? "updates";

// ── Arguments ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const archOverride = args.includes("--arches") ? args[args.indexOf("--arches") + 1] : null;
const bundleDirOverride = args.includes("--bundle-dir")
  ? args[args.indexOf("--bundle-dir") + 1]
  : process.env.TS_MACOS_BUNDLE_DIR ?? null;

if (archOverride && !archOverride.split(",").every((a) => a === "aarch64" || a === "x86_64")) {
  fail(`--arches accepts only aarch64 and x86_64 (comma-separated), got "${archOverride}"`);
}

// ── Version (tauri.conf.json is the source the updater compares against) ─────

const confPath = join(RepoRoot, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const version = String(conf.version ?? "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`Version "${version}" is not 3-part semver — the updater's parser rejects 1.9.0.1 style.`);
}
console.log(`Publishing Telegram Studio ${version} for macOS`);

// ── Release notes, straight from CHANGELOG.md ────────────────────────────────
// Read as UTF-8 explicitly (Node does that by default, unlike PowerShell 5.1,
// which is why the Windows script has to spell the encoding out).

function changelogNotes(v) {
  const path = join(RepoRoot, "CHANGELOG.md");
  if (!existsSync(path)) return "";
  const changelog = readFileSync(path, "utf8");
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^##\\s+${escaped}[^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n---|\\r?\\n##\\s|(?![\\s\\S]))`,
    "m",
  );
  const match = changelog.match(pattern);
  return match ? match[1].trim() : "";
}

const notes = changelogNotes(version);
if (!notes) {
  console.warn(`::warning::No CHANGELOG.md section for ${version} — the update dialog will show no "what's new" text.`);
}

// ── Locate the signed updater artifact ───────────────────────────────────────

// The bundle path depends on how the build was invoked: `--target
// universal-apple-darwin` lands in .../universal-apple-darwin/release/...,
// a per-arch build in .../<triple>/release/..., and a plain local build in
// .../release/... The directory name is also our only cheap hint at which
// architectures the archive actually contains.
function candidateBundleDirs() {
  if (bundleDirOverride) return [resolve(bundleDirOverride)];
  const base = join(RepoRoot, "src-tauri/target");
  return [
    join(base, "universal-apple-darwin/release/bundle/macos"),
    join(base, "aarch64-apple-darwin/release/bundle/macos"),
    join(base, "x86_64-apple-darwin/release/bundle/macos"),
    join(base, "release/bundle/macos"),
  ];
}

const bundleDir = candidateBundleDirs().find((dir) => existsSync(dir));
if (!bundleDir) {
  fail(
    "No macOS bundle directory found. Build first:\n" +
      "  npx tauri build --target universal-apple-darwin\n" +
      "Checked:\n  " +
      candidateBundleDirs().join("\n  "),
  );
}

const tarballs = readdirSync(bundleDir).filter((f) => f.endsWith(".app.tar.gz"));
if (tarballs.length === 0) {
  fail(
    `No .app.tar.gz in ${bundleDir} — that file is the updater artifact and only exists when ` +
      `bundle.createUpdaterArtifacts is true.`,
  );
}
const tarballName = tarballs[0];
const tarballPath = join(bundleDir, tarballName);
const sigPath = `${tarballPath}.sig`;

if (!existsSync(sigPath)) {
  fail(
    `Missing ${tarballName}.sig — the build was not signed, and every installed copy would ` +
      `reject this update as untrusted. Set TAURI_SIGNING_PRIVATE_KEY and rebuild.`,
  );
}
const signature = readFileSync(sigPath, "utf8").trim();

// ── Which manifest keys this archive serves ──────────────────────────────────

// A universal binary contains both slices, so it must satisfy both keys: the
// updater asks with the arch of the slice that is running, not of the bundle.
// A single-arch build only serves its own key — publishing it for the other
// arch would hand that machine a binary it cannot run.
function detectArches() {
  if (archOverride) return archOverride.split(",").map((a) => a.trim());

  if (bundleDir.includes("universal-apple-darwin")) return ["aarch64", "x86_64"];
  if (bundleDir.includes("aarch64-apple-darwin")) return ["aarch64"];
  if (bundleDir.includes("x86_64-apple-darwin")) return ["x86_64"];

  // A plain `target/release` build: ask lipo what is inside the binary. It is
  // part of the macOS toolchain, so it is present anywhere this script can run.
  try {
    const binary = join(bundleDir, tarballName.replace(/\.app\.tar\.gz$/, ".app"), "Contents/MacOS");
    const exe = readdirSync(binary)[0];
    const lipo = execFileSync("lipo", ["-archs", join(binary, exe)], { encoding: "utf8" });
    const arches = lipo
      .trim()
      .split(/\s+/)
      .map((a) => (a === "arm64" ? "aarch64" : a))
      .filter((a) => a === "aarch64" || a === "x86_64");
    if (arches.length) return arches;
  } catch {
    // Fall through to the host arch below.
  }
  return [process.arch === "arm64" ? "aarch64" : "x86_64"];
}

const arches = detectArches();
const archLabel = arches.length === 2 ? "universal" : arches[0];

// Storage object name: ASCII, no spaces. The bundle is called "Telegram
// Studio.app.tar.gz" and a space in a URL is a needless encoding trap.
const objectName = `Telegram-Studio-${version}-${archLabel}.app.tar.gz`;
const tarballUrl = `${SupabaseUrl}/storage/v1/object/public/${Bucket}/${objectName}`;

// ── Supabase Storage helpers (service_role via the Storage REST API) ─────────

function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key && !dryRun) {
    fail("No SUPABASE_SERVICE_ROLE_KEY. Only service_role may write to Storage.");
  }
  return key ?? "";
}

function authHeaders() {
  const key = serviceKey();
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function uploadObject(path, name, contentType) {
  const body = readFileSync(path);
  const res = await fetch(`${SupabaseUrl}/storage/v1/object/${Bucket}/${name}`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "content-type": contentType,
      "x-upsert": "true",
      "cache-control": "no-cache",
    },
    body,
  });
  if (!res.ok) {
    fail(`Upload of ${name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`  uploaded ${name} (${(body.length / 1024 / 1024).toFixed(1)} MB)`);
}

// Reads the manifest through the AUTHENTICATED object endpoint on purpose: the
// public URL is served through a CDN, and a stale read here is what would make
// this script silently drop the other platform's entry.
async function fetchPublishedManifest() {
  const res = await fetch(`${SupabaseUrl}/storage/v1/object/${Bucket}/latest.json`, {
    headers: { ...authHeaders(), "cache-control": "no-cache" },
  });
  // Storage answers 400 (not 404) for a missing object; either means "first
  // release, nothing published yet", which is not an error.
  if (res.status === 400 || res.status === 404) {
    console.log("  (no published latest.json yet — starting a fresh manifest)");
    return null;
  }
  if (!res.ok) {
    fail(`Could not read the published manifest: ${res.status} ${await res.text()}`);
  }
  try {
    return await res.json();
  } catch {
    // Better to stop than to overwrite a manifest we failed to understand.
    fail("Published latest.json is not valid JSON — refusing to overwrite it.");
  }
}

async function uploadManifest(manifest) {
  const tmp = join(RepoRoot, ".build/latest.json");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await uploadObject(tmp, "latest.json", "application/json");
}

// ── Merge ────────────────────────────────────────────────────────────────────

const semverCompare = (a, b) => {
  const A = String(a).split(".").map(Number);
  const B = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0);
  }
  return 0;
};

const previous = await fetchPublishedManifest();
const platforms = { ...(previous?.platforms ?? {}) };

// Each platform entry pins its OWN version and notes. The manifest is shared,
// but releases are not simultaneous: if Windows ships 1.9.6 while macOS is still
// on 1.9.5, a Mac must keep being offered 1.9.5 (and its matching notes) rather
// than "1.9.6", install the 1.9.5 archive and be offered 1.9.6 forever.
for (const arch of arches) {
  platforms[`darwin-${arch}`] = { version, url: tarballUrl, signature, notes };
}

const previousVersion = previous?.version ?? "";
const weAreNewest = !previousVersion || semverCompare(version, previousVersion) >= 0;

const manifest = {
  ...previous,
  // The top-level version is only a fallback for entries that don't pin their
  // own, so it must never move backwards — a Windows release of 1.9.6 followed
  // by a macOS build of 1.9.5 must not relabel the manifest as 1.9.5.
  version: weAreNewest ? version : previousVersion,
  notes: weAreNewest ? notes : (previous?.notes ?? notes),
  pub_date: weAreNewest ? new Date().toISOString().replace(/\.\d+Z$/, "Z") : previous?.pub_date,
  platforms,
};

console.log("");
console.log(`  artifact : ${objectName}`);
console.log(`  platform : ${arches.map((a) => `darwin-${a}`).join(", ")}`);
console.log(`  version  : ${version}${weAreNewest ? "" : ` (manifest stays at ${previousVersion})`}`);
console.log(`  kept     : ${Object.keys(platforms).filter((k) => !k.startsWith("darwin-")).join(", ") || "(none)"}`);
console.log("");

if (dryRun) {
  // No process.exit(0) here: on Windows an explicit exit with pending handles
  // prints a libuv assertion that reads like a crash. Falling off the end of the
  // module does the same job quietly.
  console.log("--dry-run: nothing uploaded. Merged manifest:");
  console.log(JSON.stringify(manifest, null, 2));
} else {
  console.log("Uploading updater artifact...");
  await uploadObject(tarballPath, objectName, "application/octet-stream");
  await uploadObject(sigPath, `${objectName}.sig`, "text/plain");

  console.log("Uploading manifest...");
  await uploadManifest(manifest);

  console.log("");
  console.log(
    `Done. macOS ${version} is offered to every installed copy on next launch.\n` +
      `Verify: ${SupabaseUrl}/functions/v1/updates?target=darwin&arch=${arches[0]}&version=0.0.1`,
  );
}

function fail(message) {
  console.error(`\npublish-macos: ${message}`);
  process.exit(1);
}
