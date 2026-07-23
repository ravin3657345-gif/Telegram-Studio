// Passthrough relay to Telegram's Bot API — last-resort fallback for
// Telegram Studio clients whose direct connection AND fragmented-TLS
// fallback both fail (confirmed case: Russian ISP-level IP+port blocking of
// api.telegram.org, which no amount of TLS-layer trickery can get around
// since the block happens before TLS even starts — see fragmented.rs).
// Forwards the method/body/content-type to api.telegram.org unchanged and
// returns the response verbatim. Auth is Supabase's own JWT verification
// (verify_jwt=true) against the app's embedded publishable key — same gate
// already used for license redemption (core/src/license.rs).
//
// Second route added 2026-07-23: /tg-relay/storage/bot<token>/<method> —
// live-reported the plain passthrough above reliably breaks for multipart
// bodies over ~25-30KB — turned out to be true of ANY request through this
// Edge Function, or even Supabase's own Storage backend hit directly with
// one big request, regardless of content-type (see client.rs's RELAY_BASE
// doc comment for the full live-test writeup; that "Storage is immune"
// assumption in the paragraph below this one used to be here as the
// justification and it was wrong). What DOES hold up (also live-tested):
// many small (~20KB) requests in parallel to Storage stay under whatever
// the current per-request threshold is. So the client now splits each file
// into ~20KB chunks, uploads them individually to the private `relay-tmp`
// Storage bucket, and calls THIS route with a small JSON descriptor (chunk
// paths, in order) instead of the file itself. This function fetches every
// chunk via service_role, concatenates them back into one blob, rebuilds
// the multipart form server-side, forwards to Telegram, and always deletes
// every chunk afterward — success or failure — so nothing accumulates.
// Also opportunistically sweeps any leftover `relay-tmp` objects older than
// 10 minutes on every invocation (covers the case where a client uploads
// chunks then crashes/loses network before ever calling this route) — no
// scheduled job needed for that, it just rides along on normal traffic.
// Known limitation (also live-tested): this reliably fixes photo-sized
// files (~1MB) but not video-sized ones (~5MB+) — something beyond
// per-request size also seems to matter for sustained transfers, and
// chunking alone doesn't route around that. Accepted as-is for now rather
// than gated behind a size check — for large files this is no worse than
// the old single-shot attempt, which failed outright above ~25-30KB anyway.
const TELEGRAM_BASE = "https://api.telegram.org";
const PATH_MARKER = "/tg-relay";
const STORAGE_MARKER = "/storage";
const RELAY_BUCKET = "relay-tmp";
const ORPHAN_MAX_AGE_MS = 10 * 60 * 1000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function storageObjectUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${RELAY_BUCKET}/${path}`;
}

async function fetchFromStorage(path: string): Promise<Uint8Array> {
  const resp = await fetch(storageObjectUrl(path), {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) {
    throw new Error(`storage fetch ${path} -> ${resp.status}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

async function deleteFromStorage(path: string): Promise<void> {
  try {
    await fetch(storageObjectUrl(path), {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  } catch {
    // Best-effort — a failed delete just means the 10-minute orphan sweep
    // below picks it up on some later invocation instead.
  }
}

async function listStorage(prefix: string): Promise<{ name: string; id: string | null; created_at?: string }[]> {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${RELAY_BUCKET}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix, limit: 100, sortBy: { column: "created_at", order: "asc" } }),
  });
  if (!resp.ok) return [];
  return await resp.json();
}

// Piggybacks on normal traffic instead of a separate scheduled job — cheap
// and self-healing even if a client never reaches this route after
// uploading (crash, lost network, etc.). Two-level walk because chunks live
// nested (`relay-tmp/<uuid>/<00000, 00001, ...>`) — Storage's LIST is not
// recursive, `id: null` on an entry means it's a virtual folder (the
// per-upload uuid prefix), not a real object with its own timestamp, so
// staleness has to be judged from the chunks inside it, not the folder
// entry itself.
async function sweepOrphans(): Promise<void> {
  try {
    const topLevel = await listStorage("");
    const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
    for (const entry of topLevel) {
      if (entry.id !== null) continue; // a stray top-level file, not a chunk folder — leave it alone
      const children = await listStorage(`${entry.name}/`);
      if (children.length === 0) continue;
      const isStale = children.every(
        (c) => c.created_at && new Date(c.created_at).getTime() < cutoff,
      );
      if (isStale) {
        await Promise.all(children.map((c) => deleteFromStorage(`${entry.name}/${c.name}`)));
      }
    }
  } catch {
    // Never let cleanup failure affect the actual relay response.
  }
}

interface StorageForwardFile {
  field: string;
  chunkPaths: string[];
  fileName: string;
  mimeType: string;
}

interface StorageForwardRequest {
  fields?: Record<string, string>;
  files: StorageForwardFile[];
}

// Chunks are fetched in parallel (this runs server-side on Supabase's own
// network, not through the client's ISP-affected connection, so there's no
// reason to throttle it) but concatenated back in the ORIGINAL order — the
// client's chunk paths already encode their index (`00000`, `00001`, ...
// via `String::format!("{i:05}")` in client.rs), so a plain array-index
// join after `Promise.all` is safe without re-parsing the path.
async function reassembleFile(chunkPaths: string[]): Promise<Uint8Array> {
  const chunks = await Promise.all(chunkPaths.map((p) => fetchFromStorage(p)));
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function handleStorageForward(suffix: string, req: Request): Promise<Response> {
  let payload: StorageForwardRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error_code: 400, description: "relay: invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An empty `files` array is legitimate, not a mistake — sendRichMessage,
  // for one, always goes through this multipart path regardless of whether
  // the post actually has any photo/video attachments (a map/formula/table/
  // text-only post has none). Only reject if the field is missing/malformed
  // entirely, live-reported 2026-07-23: this used to hard-require at least
  // one file and broke every attachment-free Rich post.
  if (!Array.isArray(payload.files)) {
    return new Response(
      JSON.stringify({ ok: false, error_code: 400, description: "relay: files must be an array" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const allChunkPaths = payload.files.flatMap((f) => f.chunkPaths);
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(payload.fields ?? {})) form.append(key, value);
    for (const file of payload.files) {
      const bytes = await reassembleFile(file.chunkPaths);
      form.append(file.field, new Blob([bytes], { type: file.mimeType }), file.fileName);
    }

    const targetUrl = `${TELEGRAM_BASE}${suffix}`;
    const resp = await fetch(targetUrl, { method: "POST", body: form });
    const respBody = await resp.arrayBuffer();
    return new Response(respBody, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error_code: 502, description: `relay: storage-forward failed: ${e}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    await Promise.all(allChunkPaths.map((p) => deleteFromStorage(p)));
    sweepOrphans(); // fire-and-forget, doesn't block the response
  }
}

// Admin-side helper, same shape as handleStorageForward but writes the
// reassembled bytes back to Storage instead of forwarding to Telegram —
// used for publishing large release installers (several MB) when a single
// big request to Storage itself hits the same ISP interference this whole
// file exists to route around (see docs/telegram-blocking-bypass.md).
// Deliberately scoped to the `sales-assets` bucket only — this function's
// auth is the app's embedded publishable key (effectively public, JWT
// verification just confirms it came from a real Supabase-issued token),
// so it must not become a write-anywhere-in-any-bucket primitive.
const ASSEMBLE_MARKER = "/assemble";
const ASSEMBLE_BUCKET = "sales-assets";

async function handleAssemble(req: Request): Promise<Response> {
  let payload: { chunkPaths: string[]; destPath: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, description: "assemble: invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!Array.isArray(payload.chunkPaths) || payload.chunkPaths.length === 0 || !payload.destPath) {
    return new Response(
      JSON.stringify({ ok: false, description: "assemble: chunkPaths and destPath required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const bytes = await reassembleFile(payload.chunkPaths);
    const putResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${ASSEMBLE_BUCKET}/${payload.destPath}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        },
        body: bytes,
      },
    );
    if (!putResp.ok) {
      return new Response(
        JSON.stringify({ ok: false, description: `assemble: storage write failed ${putResp.status}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, bytes: bytes.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, description: `assemble: failed: ${e}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    await Promise.all(payload.chunkPaths.map((p) => deleteFromStorage(p)));
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname.includes(ASSEMBLE_MARKER)) {
    return handleAssemble(req);
  }

  const markerIdx = url.pathname.indexOf(PATH_MARKER);
  let rest = markerIdx === -1 ? "" : url.pathname.slice(markerIdx + PATH_MARKER.length);

  const isStorageForward = rest.startsWith(STORAGE_MARKER);
  if (isStorageForward) rest = rest.slice(STORAGE_MARKER.length);

  if (!rest.startsWith("/bot")) {
    return new Response(
      JSON.stringify({ ok: false, error_code: 400, description: "relay: expected /bot<token>/<method> path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (isStorageForward) {
    return handleStorageForward(rest, req);
  }

  const targetUrl = `${TELEGRAM_BASE}${rest}${url.search}`;
  const contentType = req.headers.get("content-type");
  const body = (req.method === "GET" || req.method === "HEAD") ? undefined : await req.arrayBuffer();

  try {
    const resp = await fetch(targetUrl, {
      method: req.method,
      headers: contentType ? { "Content-Type": contentType } : {},
      body,
    });
    const respBody = await resp.arrayBuffer();
    return new Response(respBody, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error_code: 502, description: `relay: fetch to Telegram failed: ${e}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
