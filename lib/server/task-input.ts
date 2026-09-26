import type { TaskWrite } from "./repositories/tasks";
import { HttpError } from "./http";

// タスクの登録・変更の入力の検証（backend.md 9.2）。スキーマに無い制約をここで確かめる
// values にある項目だけを見る（PATCH は一部の項目だけが来る）

// +09:00 や Z が付いた ISO 8601 の日時（タイムゾーンが無いと、UTC で動くサーバーでずれるため）
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// タスクの id（UUID）。形が違うものは DB に問い合わせずに「見つからない」にする
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_REMAINING_MINUTES = 6000;

function invalid(message: string): never {
  throw new HttpError(400, "INVALID_REQUEST", message);
}

const isStep5 = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max && n % 5 === 0;

export function validateTaskValues(values: TaskWrite, now: string): void {
  if (values.title !== undefined && values.title.trim() === "") {
    invalid("タイトルを入力してください");
  }
  if (values.estimated_minutes !== undefined && !isStep5(values.estimated_minutes, 5, 600)) {
    invalid("見積もり時間は5〜600分の5分単位で入力してください");
  }
  if (values.remaining_minutes !== undefined && !isStep5(values.remaining_minutes, 0, MAX_REMAINING_MINUTES)) {
    invalid("残り時間は0〜6000分の5分単位で入力してください");
  }
  if (values.deadline_at !== undefined && values.deadline_at !== null) {
    const deadline = new Date(values.deadline_at).getTime();
    if (!ISO_WITH_OFFSET.test(values.deadline_at) || Number.isNaN(deadline)) {
      invalid("締切の日時の形が正しくありません");
    }
    if (deadline <= new Date(now).getTime()) {
      invalid("締切は現在より後の日時にしてください");
    }
  }
}

// URL の id がタスクの id の形か。違えば 404
export function requireTaskIdFormat(id: string): void {
  if (!UUID.test(id)) throw new HttpError(404, "NOT_FOUND", "タスクが見つかりません");
}
