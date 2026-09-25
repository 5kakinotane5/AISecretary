import { NextResponse } from "next/server";
import { MockCheckResultSchema } from "@/lib/schemas";
import { validateMockData } from "@/lib/mock/validate";

// 4章のとおり、待ち時間なし。GET /api/mock/check はダミーデータの検査結果（6章）を返す。
export async function GET() {
  const result = MockCheckResultSchema.parse(validateMockData());
  return NextResponse.json(result);
}
