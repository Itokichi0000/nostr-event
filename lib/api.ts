import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorBody = { code: string; message: string; details?: unknown };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, "unauthorized", "ログインが必要です"),
  forbidden: () => new ApiError(403, "forbidden", "この操作を行う権限がありません"),
  notFound: (what = "対象") => new ApiError(404, "not_found", `${what}が見つかりません`),
  badOrigin: () => new ApiError(403, "bad_origin", "不正なリクエスト元です"),
  rateLimited: () => new ApiError(429, "rate_limited", "短時間に操作が集中しています。少し待ってから再試行してください"),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  invalid: (message: string, details?: unknown) => new ApiError(400, "invalid_input", message, details),
};

export function ok<T>(data: T, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json({ data, error: null }, responseInit);
}

export function fail(err: ApiError): NextResponse {
  const body: ApiErrorBody = { code: err.code, message: err.message };
  if (err.details !== undefined) body.details = err.details;
  return NextResponse.json({ data: null, error: body }, { status: err.status });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** API ルート共通ラッパー: { data, error } 形式とエラー変換。秘密情報はログに出さない */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      const res = await fn(req, ctx);
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (e) {
      if (e instanceof ApiError) return fail(e);
      if (e instanceof ZodError) {
        return fail(errors.invalid("入力内容を確認してください", e.issues.map((i) => ({ path: i.path, message: i.message }))));
      }
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, e instanceof Error ? e.message : e);
      return fail(new ApiError(500, "internal", "サーバーでエラーが発生しました。時間をおいて再試行してください"));
    }
  };
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "too_large", "リクエストが大きすぎます");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.invalid("JSON の形式が正しくありません");
  }
}
