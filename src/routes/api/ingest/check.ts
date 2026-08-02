// Poller support endpoint. The VPS worker POSTs the candidate HiDrive paths it found and this
// route returns the subset that is NOT already fully ingested, so the worker can skip already-
// ingested files without any Supabase access. Same shared-secret auth as /api/ingest/receive.
import { createFileRoute } from "@tanstack/react-router";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/ingest/check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyIngestSecret, checkSchema, handleCheck } =
          await import("@/lib/ingest.server");

        if (!verifyIngestSecret(request.headers.get("x-ingest-secret"))) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        let paths: string[];
        try {
          ({ paths } = checkSchema.parse(await request.json()));
        } catch (err) {
          return json({ ok: false, error: `invalid request: ${(err as Error).message}` }, 400);
        }

        try {
          const { new_paths } = await handleCheck(paths);
          return json({ new_paths }, 200);
        } catch (err) {
          return json({ ok: false, error: (err as Error).message }, 500);
        }
      },
    },
  },
});
