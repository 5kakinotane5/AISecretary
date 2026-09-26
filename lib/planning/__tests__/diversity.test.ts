import { describe, expect, it } from "vitest";
import { EnginePlanSchema, type ObjectiveVector } from "@/lib/schemas";
import { validateCandidateDiversity } from "../validate";
import { createPlanningContext } from "./fixtures";

const summary = { task_hours: 0, buffer_hours: 0, free_hours: 0, travel_hours: 0, goal_hours: 0, deadline_task_count: 0, overload: false, explanation: "" };
const days = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(5 + index).padStart(2, "0")}`, items: [] }));
const features = (value: number): ObjectiveVector => ({ achievement: value, deadline_safety: value, task_fit: value, buffer: value, free_time: value, control: value, recovery: value });
const makePlan = (style: "intensive" | "balanced" | "relaxed", value: number) => EnginePlanSchema.parse({ style, label: style, week_start: "2026-10-05", days, summary, features: features(value) });

describe("validateCandidateDiversity", () => {
  it("距離不足だけをgenerate・storedのwarningにし、replanでは検査しない", () => {
    const context = createPlanningContext();
    const close = [makePlan("intensive", 0.5), makePlan("balanced", 0.5), makePlan("relaxed", 0.5)];
    expect(validateCandidateDiversity(context, close, "generate").warnings.every((issue) => issue.code === "CANDIDATES_TOO_SIMILAR")).toBe(true);
    expect(validateCandidateDiversity(context, close, "replan").warnings).toEqual([]);
    const diverse = [makePlan("intensive", 1), makePlan("balanced", 0.5), makePlan("relaxed", 0)];
    expect(validateCandidateDiversity(context, diverse, "stored").warnings).toEqual([]);
  });
});
