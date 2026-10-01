import { describe, expect, it } from "vitest";
import { LlmError } from "@/lib/llm/client";
import { extractReplanIntentByLlm } from "@/lib/llm/replan-intent";
import { toReplanningIntent } from "@/lib/server/replan-intent";
import {
  SCENARIO_DATE,
  SCENARIO_NOW,
  SCENARIO_ROWS,
  SCENARIO_TASKS,
  describeExpect,
  describeResult,
  matchesExpect,
} from "@/lib/llm/__tests__/replan-scenarios";

// シナリオ表（docs/scenarios/replan-chat.md「6. 口語」）の全行を、実際の OpenAI で確かめる。
// RUN_LIVE_LLM=1 のときだけ動く（npm test では skip）。.env.local の OPENAI_API_KEY・OPENAI_MODEL を使い、
// LLM_MODE の値にかかわらず LLM を呼ぶ。
//   例：RUN_LIVE_LLM=1 npx vitest run lib/llm/__tests__/replan-intent.live.test.ts

const LIVE = process.env.RUN_LIVE_LLM === "1";
const CONCURRENCY = 5;

describe.skipIf(!LIVE)("再計画の意図（LLM・live。plans-replan.md 12.3.1）", () => {
  it("シナリオ表の全行が期待どおり", { timeout: 180_000 }, async () => {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // .env.local がなければ、すでにある環境変数を使う
    }
    const missing = ["OPENAI_API_KEY", "OPENAI_MODEL"].filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `RUN_LIVE_LLM=1 ですが ${missing.join("・")} が空です（.env.local を確かめてください）`,
      );
    }
    // callStructured は LLM_MODE=on のときだけ呼ぶため、ここで on にする
    process.env.LLM_MODE = "on";

    const input = { date: SCENARIO_DATE, now: SCENARIO_NOW, todayTasks: SCENARIO_TASKS };
    const results: { no: number; text: string; want: string; got: string; ok: boolean }[] = [];
    const queue = [...SCENARIO_ROWS];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          let got: string;
          let ok = false;
          try {
            const result = toReplanningIntent(
              await extractReplanIntentByLlm(row.text, input),
              input,
            );
            got = describeResult(result);
            ok = matchesExpect(result, row.expect, true);
          } catch (e) {
            got = e instanceof LlmError ? `LlmError(${e.kind})` : `例外(${String(e)})`;
          }
          results.push({ no: row.no, text: row.text, want: describeExpect(row.expect), got, ok });
        }
      }),
    );
    results.sort((a, b) => a.no - b.no);

    const failed = results.filter((r) => !r.ok);
    const lines = failed.map((r) => `${r.no}\t${r.text}\n\t期待：${r.want}\n\t結果：${r.got}`);
    console.log(
      `[live] ${results.length - failed.length}/${results.length} 行が期待どおり` +
        (failed.length > 0 ? `\n期待と違う行：\n${lines.join("\n")}` : ""),
    );
    expect(failed.map((r) => r.no)).toEqual([]);
  });
});
