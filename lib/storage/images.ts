// 画像保存（開発はローカルディスク。本番は S3 互換ストレージへ差し替える想定のアダプター）
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { generateToken } from "../security/tokens";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES: { mime: string; ext: string; magic: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: "gif", magic: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    mime: "image/webp",
    ext: "webp",
    magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

export function detectImageType(bytes: Uint8Array) {
  return TYPES.find((t) => t.magic(bytes)) ?? null;
}

export async function saveImage(bytes: Uint8Array): Promise<{ name: string; url: string }> {
  // 拡張子ではなく先頭バイトで判定（SVG 等スクリプトを含み得る形式は受け付けない）
  const type = detectImageType(bytes);
  if (!type) throw new Error("unsupported_type");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("too_large");
  const name = `${generateToken(12)}.${type.ext}`;
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(path.join(config.uploadDir, name), bytes);
  return { name, url: `${config.appUrl}/api/uploads/${name}` };
}

export async function readImage(name: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!/^[A-Za-z0-9_-]+\.(png|jpg|gif|webp)$/.test(name)) return null;
  try {
    const bytes = await readFile(path.join(config.uploadDir, name));
    const type = detectImageType(bytes);
    return type ? { bytes, mime: type.mime } : null;
  } catch {
    return null;
  }
}
