// CLI + optional HTTP trigger entrypoint for the ingest worker.
//
//   npm run ingest -- <hidrive_path> [event_id]   # ingest one master (great for testing)
//   npm run poll   -- [event_id]                   # scan the ingest folder once (cron this)
//   npm run serve                                  # start the Make.com HTTP trigger server
//
// The HTTP trigger exists because HiDrive has no webhooks: Make.com (or cron + curl) POSTs to
// it and the worker runs a poll in the background.

import { createServer } from "node:http";
import { ingestPhoto } from "./ingest.js";
import { pollIngestFolder } from "./poll.js";
import { env } from "./env.js";

function startServer(): void {
  const secret = env.INGEST_TRIGGER_SECRET;
  if (!secret) {
    console.error("Refusing to start HTTP trigger: INGEST_TRIGGER_SECRET is not set.");
    process.exit(1);
  }

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/ingest-poll")) {
      res.writeHead(404).end();
      return;
    }

    // Auth via header or ?secret= query param (constant compare-ish; secrets are opaque).
    const url = new URL(req.url, "http://localhost");
    const provided = req.headers["x-ingest-secret"] ?? url.searchParams.get("secret") ?? "";
    if (provided !== secret) {
      res.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({ ok: false, error: "unauthorized" }),
      );
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let eventId: string | null = null;
      try {
        if (body.trim()) eventId = (JSON.parse(body).event_id as string) ?? null;
      } catch {
        /* ignore malformed body — event_id stays null */
      }

      // Respond immediately; run the (heavy) poll in the background so Make doesn't time out.
      res.writeHead(202, { "content-type": "application/json" }).end(
        JSON.stringify({ ok: true, accepted: true }),
      );
      pollIngestFolder(eventId)
        .then((r) => console.log(`[trigger] poll complete: ${JSON.stringify(r)}`))
        .catch((e) => console.error(`[trigger] poll failed: ${(e as Error).message}`));
    });
  });

  server.listen(env.PORT, () => {
    console.log(`Ingest trigger listening on :${env.PORT} (POST /ingest-poll)`);
  });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "ingest": {
      const hidrivePath = rest[0];
      const eventId = rest[1] ?? null;
      if (!hidrivePath) {
        console.error("usage: npm run ingest -- <hidrive_path> [event_id]");
        process.exit(1);
      }
      const result = await ingestPhoto({ hidrivePath, eventId });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "poll": {
      const eventId = rest[0] ?? null;
      const result = await pollIngestFolder(eventId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "serve": {
      startServer();
      return; // keep the process alive
    }
    default:
      console.error("usage: npm run <ingest|poll|serve>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
