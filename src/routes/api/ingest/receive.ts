// Machine-to-machine ingest endpoint. The VPS worker POSTs a fully-processed photo here
// (two derivative JPEGs base64 + parsed metadata) and this route performs all the Supabase
// writes using the injected service-role admin client. Gated by a shared secret, NOT Supabase
// user auth. Mirrors the style of src/routes/api/public/previews.$.tsx.
//
// NOTE: this only exists on the deployed origin once the app is PUBLISHED from Lovable Cloud.
// The heavy DB/storage logic lives in @/lib/ingest.server and is dynamic-imported inside the
// handler so it (and supabase-js) never ships to the client bundle.
import { createFileRoute } from "@tanstack/react-router";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/ingest/receive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          INGEST_MAX_BODY_BYTES,
          verifyIngestSecret,
          receiveSchema,
          decodeJpeg,
          handleReceive,
        } = await import("@/lib/ingest.server");

        if (!verifyIngestSecret(request.headers.get("x-ingest-secret"))) {
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        // Cap the body: reject on the declared length, then again on the actual read.
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > INGEST_MAX_BODY_BYTES) {
          return json({ ok: false, error: "payload too large" }, 413);
        }
        const raw = await request.text();
        if (raw.length > INGEST_MAX_BODY_BYTES) {
          return json({ ok: false, error: "payload too large" }, 413);
        }

        let payload;
        try {
          payload = receiveSchema.parse(JSON.parse(raw));
          // Both base64 fields must decode to JPEG bytes.
          decodeJpeg(payload.clean_jpeg_base64);
          decodeJpeg(payload.watermarked_jpeg_base64);
        } catch (err) {
          return json({ ok: false, error: `invalid request: ${(err as Error).message}` }, 400);
        }

        try {
          const { photo_id } = await handleReceive(payload);
          return json({ ok: true, photo_id }, 200);
        } catch (err) {
          return json({ ok: false, error: (err as Error).message }, 500);
        }
      },
    },
  },
});
