import { NextResponse } from "next/server";
import type { z } from "zod";
import { ApiErrorSchema, type ApiErrorCode } from "@/lib/schemas";
import { isDemoMode } from "./clock";

// API で投げるエラー。handle() が { error: { code, message } } の応答に変える（common.md 2.2）
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string, // 画面にそのまま出せる日本語
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(ApiErrorSchema.parse({ error: { code, message } }), { status });
}

// すべての Route Handler をこれで包む。fn は返す値（そのまま JSON になる）か Response を返す
export async function handle(request: Request, fn: () => Promise<unknown>): Promise<Response> {
  // x-mock-error: 1 はデモモードのときだけ有効（common.md 1.3）
  if (isDemoMode() && request.headers.get("x-mock-error") === "1") {
    return errorResponse(500, "INTERNAL", "モックエラー（x-mock-error）");
  }
  try {
    const result = await fn();
    return result instanceof Response ? result : NextResponse.json(result);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message);
    // ログには種類だけ出す（中身には個人情報が含まれることがある）
    const kind = e instanceof Error ? e.name : (e as { code?: string })?.code ?? typeof e;
    console.error("[api] unexpected error:", kind);
    return errorResponse(500, "INTERNAL", "エラーが発生しました。時間をおいて再試行してください");
  }
}

// リクエストの JSON を Zod で検証する。失敗したら 400
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return parseValue(await readJson(request), schema);
}

// リクエストの JSON をそのまま読む（読めなければ null）。スキーマにないキーも見たいときに使う
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

// 読んだ値を Zod で検証する。失敗したら 400
export function parseValue<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "リクエストの形が正しくありません");
  return parsed.data;
}
// YYYY-MM-DD の実在する日付か（2026-02-30 などは不可）
function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

// クエリ・本文の日付を検証する。YYYY-MM-DD の実在する日付でなければ 400
export function requireValidDate(date: string | null): string {
  if (date === null || !isValidDate(date)) {
    throw new HttpError(400, "INVALID_REQUEST", "日付は YYYY-MM-DD の形で指定してください");
  }
  return date;
}
