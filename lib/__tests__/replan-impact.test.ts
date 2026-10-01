import { describe, expect, it } from "vitest";
import { computeReplanImpact } from "@/lib/replan-impact";
import type { ReplanChange, ReplanProposal, ScheduleItem, Task } from "@/lib/schemas";

const TODAY = "2026-10-05";

function item(
  id: string,
  kind: ScheduleItem["kind"],
  date: string,
  start: string,
  end: string,
  taskId: string | null = null,
  title: string = kind,
): ScheduleItem {
  return {
    id,
    kind,
    title,
    start_at: `${date}T${start}:00+09:00`,
    end_at: `${date}T${end}:00+09:00`,
    location_id: null,
    task_id: taskId,
    fixed_event_id: null,
    fixed_category: null,
    travel: null,
    suggested_task_id: null,
    locked: false,
    status: "planned",
    reason: null,
  };
}

function task(id: string, title: string, goalId: string | null, deadline: string | null): Task {
  return {
    id,
    title,
    goal_id: goalId,
    deadline_at: deadline ? `${deadline}T23:59:00+09:00` : null,
    estimated_minutes: 60,
    remaining_minutes: 60,
    importance: "medium",
    concentration: "high",
    splittable: true,
    interruptible: true,
    buffer_fit: "low",
    status: "not_started",
  };
}

function change(
  change_type: ReplanChange["change_type"],
  before: ScheduleItem | null,
  after: ScheduleItem[],
  moved_to_date: string | null = null,
): ReplanChange {
  return { change_type, before, after, moved_to_date, reason: "" };
}

function proposal(
  before: ScheduleItem[],
  after: ScheduleItem[],
  changes: ReplanChange[],
  other_day_changes: ReplanChange[],
): ReplanProposal {
  return {
    proposal_id: "p1",
    date: TODAY,
    intent: { type: "state_change", fatigue: "high", task_changes: [], new_fixed_events: [], preference_changes: [] },
    before: { date: TODAY, items: before },
    after: { date: TODAY, items: after },
    changes,
    other_day_changes,
    summary_message: "",
  };
}

const TASKS = [
  task("t-es", "ES作成（企業A）", null, "2026-10-09"),
  task("t-listening", "TOEIC リスニング演習", "g-toeic", null),
  task("t-vocab", "TOEIC 単語", "g-toeic", null),
];

// 「今日は疲れた」の形：ES は 18:00 で切って残り35分を 10/6 へ、リスニング60分は単語20分にして残り40分を 10/11 へ
const es = item("es", "task", TODAY, "17:35", "18:35", "t-es", "ES作成（企業A）");
const esKept = item("es", "task", TODAY, "17:35", "18:00", "t-es", "ES作成（企業A）");
const listening = item("ls", "task", TODAY, "20:00", "21:00", "t-listening", "TOEIC リスニング演習");
const vocab = item("vc", "task", TODAY, "18:30", "18:50", "t-vocab", "TOEIC 単語");
const esOn6 = item("es6", "task", "2026-10-06", "08:15", "08:50", "t-es", "ES作成（企業A）");
const lsOn11 = item("ls11", "task", "2026-10-11", "08:15", "08:55", "t-listening", "TOEIC リスニング演習");

const TIRED = proposal(
  [
    es,
    item("b1", "buffer", TODAY, "18:35", "18:50"),
    item("f1", "free", TODAY, "18:50", "20:00"),
    listening,
    item("b2", "buffer", TODAY, "21:00", "21:30"),
  ],
  [
    esKept,
    item("rest", "free", TODAY, "18:00", "18:30"),
    vocab,
    item("b3", "buffer", TODAY, "18:50", "19:00"),
    item("f2", "free", TODAY, "19:00", "21:30"),
  ],
  [change("replaced", es, [esKept]), change("replaced", listening, [vocab])],
  [
    change("moved", es, [esOn6, item("b6", "buffer", "2026-10-06", "08:50", "09:05")], "2026-10-06"),
    change("moved", listening, [lsOn11, item("b11", "buffer", "2026-10-11", "08:55", "09:10")], "2026-10-11"),
  ],
);

describe("computeReplanImpact（frontend.md 14.2「数字で見る変化」）", () => {
  it("今日の増減：タスクと自由時間（buffer＋free）", () => {
    // タスク 60+60=120 → 25+20=45（−75）。自由時間 15+70+30=115 → 30+10+150=190（+75）
    expect(computeReplanImpact(TIRED, TASKS).today).toEqual({ taskMinutesDelta: -75, freeMinutesDelta: 75 });
  });

  it("日ごとの増えた分とタスク名（軽作業版は同じ目標の分として差し引く）", () => {
    expect(computeReplanImpact(TIRED, TASKS).otherDays).toEqual([
      { date: "2026-10-06", minutes: 35, tasks: [{ task_id: "t-es", title: "ES作成（企業A）", minutes: 35 }] },
      { date: "2026-10-11", minutes: 40, tasks: [{ task_id: "t-listening", title: "TOEIC リスニング演習", minutes: 40 }] },
    ]);
  });

  it("changes と other_day_changes の両方にある同じ移動は1回だけ数える", () => {
    const moved = item("es6", "task", "2026-10-07", "19:00", "20:35", "t-es", "ES作成（企業A）");
    const p = proposal(
      [es],
      [],
      [change("moved", es, [], "2026-10-07")],
      [change("moved", es, [moved], "2026-10-07")],
    );
    const { otherDays } = computeReplanImpact(p, TASKS);
    expect(otherDays).toHaveLength(1);
    expect(otherDays[0]).toMatchObject({ date: "2026-10-07", minutes: 60 });
  });

  it("changes にしかない移動は今日の元の項目の長さで数える", () => {
    const p = proposal([es], [], [change("moved", es, [], "2026-10-07")], []);
    expect(computeReplanImpact(p, TASKS).otherDays).toEqual([
      { date: "2026-10-07", minutes: 60, tasks: [{ task_id: "t-es", title: "ES作成（企業A）", minutes: 60 }] },
    ]);
  });

  it("移した先の既存の枠を延ばしたとき、延長後の長さではなく今日から減った分だけ数える", () => {
    // 10/8 の 90分の枠を 130分に延ばした（after は延長後の1件）
    const extended = item("ls8", "task", "2026-10-08", "14:00", "16:10", "t-listening", "TOEIC リスニング演習");
    const p = proposal([listening], [vocab], [change("replaced", listening, [vocab])], [change("moved", null, [extended], "2026-10-08")]);
    expect(computeReplanImpact(p, TASKS).otherDays).toEqual([
      { date: "2026-10-08", minutes: 40, tasks: [{ task_id: "t-listening", title: "TOEIC リスニング演習", minutes: 40 }] },
    ]);
  });

  it("今日の中で動かしただけ（moved_to_date が今日）はほかの日に数えない", () => {
    const later = item("es-later", "task", TODAY, "21:00", "22:00", "t-es", "ES作成（企業A）");
    const p = proposal([es], [later], [change("moved", es, [later], TODAY)], []);
    expect(computeReplanImpact(p, TASKS).otherDays).toEqual([]);
  });

  describe("締切", () => {
    it("締切のあるタスクがすべて締切の日までに収まっている → ok", () => {
      expect(computeReplanImpact(TIRED, TASKS).deadline).toEqual({ status: "ok" });
    });

    it("締切の日ちょうどに移しても間に合う", () => {
      const onDeadline = item("es9", "task", "2026-10-09", "19:00", "20:00", "t-es", "ES作成（企業A）");
      const p = proposal([es], [], [], [change("moved", es, [onDeadline], "2026-10-09")]);
      expect(computeReplanImpact(p, TASKS).deadline).toEqual({ status: "ok" });
    });

    it("締切のあるタスクが動いていない → none_moved", () => {
      const p = proposal([listening], [], [], [change("moved", listening, [lsOn11], "2026-10-11")]);
      expect(computeReplanImpact(p, TASKS).deadline).toEqual({ status: "none_moved" });
    });

    it("締切の日より後へ移したタスクがある → late（名前つき）", () => {
      const tooLate = item("es10", "task", "2026-10-10", "19:00", "20:00", "t-es", "ES作成（企業A）");
      const p = proposal([es], [], [], [change("moved", es, [tooLate], "2026-10-10")]);
      expect(computeReplanImpact(p, TASKS).deadline).toEqual({ status: "late", titles: ["ES作成（企業A）"] });
    });
  });
});
