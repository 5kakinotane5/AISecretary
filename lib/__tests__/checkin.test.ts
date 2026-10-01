import { describe, expect, it } from "vitest";
import {
  consultTextFor,
  isCheckinComplete,
  isUnwellLevel,
  overallCondition,
  type CheckinLevels,
  type CompleteCheckinLevels,
  type OverallCondition,
} from "@/lib/checkin";
import { extractReplanIntentByKeywords } from "@/lib/llm/replan-keywords";
import { CHECKIN_LABELS } from "@/lib/labels";

const NONE: CheckinLevels = { mood: null, fatigue: null, concentration: null };

describe("「AIに相談する」で送る文（frontend.md 14.2）", () => {
  it.each<[Partial<CheckinLevels>, string]>([
    [{ fatigue: "high", concentration: "low", mood: "low" }, "今日は疲れた"],
    [{ fatigue: "medium", concentration: "low", mood: "low" }, "少し疲れた"],
    [{ fatigue: "low", concentration: "low", mood: "low" }, "集中できない"],
    [{ concentration: "medium", mood: "low" }, "今日はちょっとやる気ないです"],
  ])("%o →「%s」", (levels, text) => {
    expect(consultTextFor({ ...NONE, ...levels })).toBe(text);
  });

  it.each<Partial<CheckinLevels>>([
    {},
    { mood: "high" },
    { mood: "medium", fatigue: "low", concentration: "high" },
    { concentration: "medium" },
  ])("良い側・未入力だけ %o → 出さない", (levels) => {
    expect(consultTextFor({ ...NONE, ...levels })).toBeNull();
  });

  // LLM_MODE=off（キーワード）でも、送った文が再計画の state_change になること
  it.each(Object.values(CHECKIN_LABELS.consultText))(
    "「%s」はキーワードで state_change",
    (text) => {
      const intent = extractReplanIntentByKeywords(text, []);
      expect(intent.type).toBe("state_change");
      expect(intent.fatigue).not.toBeNull();
    },
  );
});

describe("確定済みか（frontend.md 14.2）", () => {
  it("3つとも入っていれば確定済み", () => {
    expect(isCheckinComplete({ mood: "medium", fatigue: "high", concentration: "low" })).toBe(true);
  });

  it.each<CheckinLevels | null>([
    null,
    NONE,
    { mood: null, fatigue: "high", concentration: null }, // /replan で fatigue だけ入った
    { mood: "high", fatigue: "low", concentration: null },
  ])("%o は未確定", (levels) => {
    expect(isCheckinComplete(levels)).toBe(false);
  });
});

describe("調子が悪い側の判定（frontend.md 14.2。相談の文と確定後の総合の判定で共用）", () => {
  it.each<[keyof CheckinLevels, "low" | "medium" | "high", boolean]>([
    ["mood", "low", true],
    ["mood", "medium", false],
    ["mood", "high", false],
    ["fatigue", "low", false],
    ["fatigue", "medium", true],
    ["fatigue", "high", true],
    ["concentration", "low", true],
    ["concentration", "medium", false],
    ["concentration", "high", false],
  ])("%s %s → %s", (field, level, expected) => {
    expect(isUnwellLevel(field, level)).toBe(expected);
  });
});

describe("確定後の総合の調子（frontend.md 14.2）", () => {
  it.each<[CompleteCheckinLevels, OverallCondition]>([
    [{ mood: "low", fatigue: "high", concentration: "high" }, "tired"], // 悪い側2つ
    [{ mood: "low", fatigue: "low", concentration: "low" }, "tired"], // 疲労以外で2つ
    [{ mood: "medium", fatigue: "medium", concentration: "medium" }, "normal"], // 悪い側1つ
    [{ mood: "high", fatigue: "low", concentration: "high" }, "good"], // 0
  ])("%o → %s", (levels, expected) => {
    expect(overallCondition(levels)).toBe(expected);
  });

  it("疲労 high だけでも tired", () => {
    expect(overallCondition({ mood: "high", fatigue: "high", concentration: "high" })).toBe("tired");
  });
});
