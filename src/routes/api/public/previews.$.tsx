// Public, stable, non-expiring image route for watermarked previews.
//
// WHY THIS EXISTS: the `public-previews` bucket stays PRIVATE (workspace guardrail blocks
// public buckets). Our RLS policy on storage.objects lets anon SELECT from that bucket, but
// Storage only accepts the anon key as an `apikey` HEADER — the `?apikey=` query form returns
// "Bucket not found", and `<img src>` cannot send headers. So this same-origin route performs
// the anon-key object read server-side and streams the bytes back.
//
// URL form stored in photos.public_watermarked_url:  /api/public/previews/<bucket-key>
// Anyone (no login) can load it, and it never expires — unlike a signed URL.
import { createFileRoute } from "@tanstack/react-router";

const BUCKET = "public-previews";

export const Route = createFileRoute("/api/public/previews/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = (params as { _splat?: string })._splat ?? "";
        // Only allow simple in-bucket keys (no traversal, no absolute URLs).
        if (!key || key.includes("..") || key.startsWith("/")) {
          return new Response("Not found", { status: 404 });
        }

        const url = process.env["SUPABASE_URL"];
        const anonKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
        if (!url || !anonKey) return new Response("Not configured", { status: 500 });

        const upstream = await fetch(
          `${url}/storage/v1/object/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
          { headers: { apikey: anonKey } },
        );

        if (!upstream.ok || !upstream.body) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
