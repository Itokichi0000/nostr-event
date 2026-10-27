import { readImage } from "@/lib/storage/images";

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const img = await readImage(name);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
