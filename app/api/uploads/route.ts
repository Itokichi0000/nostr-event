import { ApiError, ok, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { enforce } from "@/lib/security/rate-limit";
import { MAX_IMAGE_BYTES, saveImage } from "@/lib/storage/images";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  await enforce(`upload:${s.accountId}`, 30, 3600);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES + 64 * 1024) throw new ApiError(413, "too_large", "画像は5MB以下にしてください");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "invalid_input", "画像ファイルを選択してください");
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "too_large", "画像は5MB以下にしてください");
  try {
    const saved = await saveImage(new Uint8Array(await file.arrayBuffer()));
    return ok({ url: saved.url }, 201);
  } catch (e) {
    if (e instanceof Error && e.message === "unsupported_type") {
      throw new ApiError(415, "unsupported_type", "PNG / JPEG / WebP / GIF の画像を選択してください");
    }
    throw e;
  }
});
