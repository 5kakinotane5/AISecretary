import { describe, expect, it } from "vitest";
import { consultTextFor, type CheckinLevels } from "@/lib/checkin";
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
