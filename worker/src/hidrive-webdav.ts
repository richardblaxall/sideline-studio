// Classic HiDrive WebDAV client (read side of the ingest pipeline).
//
// WebDAV base URL is env-configured (HIDRIVE_WEBDAV_URL). The IONOS documented value is
//   https://webdav.hidrive.ionos.com/users/<loginname>/
// (Strato-hosted accounts use https://webdav.hidrive.strato.com/ ). WebDAV must be enabled
// for the account under HiDrive settings → access rights & protocols.
//
// All paths passed here are RELATIVE to that base (no leading slash), e.g.
//   "ingest/NGU_20250914_0001.jpg". This is also what we persist as hidrive_original_path.
//
// SECURITY: credentials come from env and are only ever placed in the Authorization header.
// They are never logged — thrown errors carry status + path only.

import { env } from "./env.js";

export interface RemoteFile {
  /** Path relative to HIDRIVE_WEBDAV_URL (matches hidrive_original_path). */
  path: string;
  /** Final path segment, e.g. "NGU_20250914_0001.jpg". */
  name: string;
  /** Size in bytes, if reported. */
  size: number | null;
  /** Last-modified ISO string, if reported. */
  lastModified: string | null;
}

function authHeader(): string {
  const token = Buffer.from(`${env.HIDRIVE_WEBDAV_USER}:${env.HIDRIVE_WEBDAV_PASS}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

/** Resolve a base-relative path to an absolute WebDAV URL, encoding each segment. */
function toUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  const encoded = clean
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return new URL(encoded, env.HIDRIVE_WEBDAV_URL).toString();
}

/** The pathname portion of the WebDAV base (e.g. "/users/loginname/"), used to relativize hrefs. */
function basePathname(): string {
  return new URL(env.HIDRIVE_WEBDAV_URL).pathname;
}

/**
 * Fetch a single file's raw bytes over authenticated HTTPS GET.
 * Throws with status + path (never credentials) on a non-2xx response.
 */
export async function fetchFileBytes(relPath: string): Promise<Buffer> {
  const res = await fetch(toUrl(relPath), {
    method: "GET",
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`HiDrive WebDAV GET failed (${res.status}) for path: ${relPath}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <displayname/>
    <getcontentlength/>
    <getlastmodified/>
    <resourcetype/>
  </prop>
</propfind>`;

/**
 * List the files directly inside a folder (Depth: 1) via PROPFIND.
 * Returns files only (directories/collections are skipped, including the folder itself).
 * Paths are returned relative to HIDRIVE_WEBDAV_URL.
 */
export async function listFolder(folderRelPath: string): Promise<RemoteFile[]> {
  const folder = folderRelPath.endsWith("/") ? folderRelPath : `${folderRelPath}/`;
  const res = await fetch(toUrl(folder), {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(),
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: PROPFIND_BODY,
  });
  if (!res.ok) {
    throw new Error(`HiDrive WebDAV PROPFIND failed (${res.status}) for folder: ${folderRelPath}`);
  }
  const xml = await res.text();
  return parseMultistatus(xml, basePathname());
}

// --- Minimal, namespace-tolerant multistatus parser -------------------------------------
// HiDrive returns a standard DAV multistatus document. We avoid an XML dependency and parse
// the small, well-formed <response> blocks with tolerant regexes (any namespace prefix).

function tag(block: string, local: string): string | null {
  const re = new RegExp(`<[^>]*\\b${local}[^>]*>([\\s\\S]*?)</[^>]*\\b${local}>`, "i");
  const m = block.match(re);
  return m ? m[1]!.trim() : null;
}

function parseMultistatus(xml: string, basePath: string): RemoteFile[] {
  const files: RemoteFile[] = [];
  const responseRe = /<[^>]*\bresponse[^>]*>([\s\S]*?)<\/[^>]*\bresponse>/gi;
  let match: RegExpExecArray | null;

  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1]!;

    // A collection (directory) has <resourcetype><collection/></resourcetype>.
    const resourceType = tag(block, "resourcetype") ?? "";
    if (/collection/i.test(resourceType)) continue;

    const hrefRaw = tag(block, "href");
    if (!hrefRaw) continue;

    // href is an absolute URL path; make it relative to the WebDAV base.
    let hrefPath: string;
    try {
      hrefPath = new URL(hrefRaw, env.HIDRIVE_WEBDAV_URL).pathname;
    } catch {
      hrefPath = hrefRaw;
    }
    let rel = decodeURIComponent(hrefPath);
    if (rel.startsWith(basePath)) rel = rel.slice(basePath.length);
    rel = rel.replace(/^\/+/, "");
    if (!rel) continue; // the folder itself

    const sizeRaw = tag(block, "getcontentlength");
    const size = sizeRaw && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : null;
    const lastModRaw = tag(block, "getlastmodified");
    const lastModified = lastModRaw ? new Date(lastModRaw).toISOString() : null;
    const name = decodeURIComponent(tag(block, "displayname") ?? rel.split("/").pop() ?? rel);

    files.push({ path: rel, name, size, lastModified });
  }

  return files;
}
