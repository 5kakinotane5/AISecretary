import type { Goal, Level } from "@/lib/schemas";
import { LlmError } from "@/lib/llm/client";
import { generateGoalTaskNamesByLlm } from "@/lib/llm/goal-task-names";
import type { GoalTaskWrite } from "./repositories/goals";

// 目標タスクのカテゴリ別テンプレート（backend.md 8.2、補正 C-11）と、その名前の決め方

type GoalTaskTemplate = {
  minutes: number;
  concentration: Level;
  splittable: boolean;
  interruptible: boolean;
  buffer_fit: Level;
};

type CategoryTemplate = { main: GoalTaskTemplate; light: GoalTaskTemplate | null };

const TEMPLATES: Readonly<Record<string, CategoryTemplate>> = {
  "資格・テスト勉強": {
    main: { minutes: 60, concentration: "medium", splittable: true, interruptible: true, buffer_fit: "low" },
    light: { minutes: 30, concentration: "low", splittable: true, interruptible: true, buffer_fit: "high" },
  },
  "筋トレ・運動": {
    main: { minutes: 45, concentration: "low", splittable: false, interruptible: false, buffer_fit: "low" },
    light: null,
  },
  "大学の課題・レポート": {
    main: { minutes: 60, concentration: "high", splittable: true, interruptible: false, buffer_fit: "low" },
    light: null,
  },
  就活: {
    main: { minutes: 60, concentration: "medium", splittable: true, interruptible: true, buffer_fit: "low" },
    light: { minutes: 30, concentration: "low", splittable: true, interruptible: true, buffer_fit: "high" },
  },
  その他: {
    main: { minutes: 60, concentration: "medium", splittable: true, interruptible: true, buffer_fit: "medium" },
    light: null,
  },
};

// 表にないカテゴリは「その他」として扱う
function templateFor(category: string): CategoryTemplate {
  return TEMPLATES[category] ?? TEMPLATES["その他"];
}

// メインの1回の時間（分）。7.2.1 の回数からの base にも使う
export function mainMinutesFor(category: string): number {
  return templateFor(category).main.minutes;
}

export type GoalTaskNames = { main: string; light: string | null };

// LLM を使わないときの名前（8.2）
export function templateGoalTaskNames(taskName: string): { main: string; light: string } {
  return { main: `${taskName} 演習`, light: `${taskName} 単語・復習` };
}

// 目標タスクを作る。軽作業版がないカテゴリは1件（names.light は使わない）。goal_id は confirmGoalWithTasks が付ける
export function buildGoalTasks(args: {
  category: string;
  priority: Level;
  hoursPerWeek: number;
  names: GoalTaskNames;
}): GoalTaskWrite[] {
  const template = templateFor(args.category);
  const remaining = Math.round(args.hoursPerWeek * 60); // DB には target_hours_per_week × 60 を入れる（8.2）
  const toTask = (title: string, t: GoalTaskTemplate): GoalTaskWrite => ({
    id: crypto.randomUUID(),
    title,
    deadline_at: null,
    estimated_minutes: t.minutes,
    remaining_minutes: remaining,
    importance: args.priority,
    concentration: t.concentration,
    splittable: t.splittable,
    interruptible: t.interruptible,
    buffer_fit: t.buffer_fit,
    status: "not_started",
  });

  const tasks = [toTask(args.names.main, template.main)];
  if (template.light !== null) {
    // resolveGoalTaskNames() は軽作業版があるカテゴリでは必ず light を返す
    if (args.names.light === null) throw new Error("light task name is required for this category");
    tasks.push(toTask(args.names.light, template.light));
  }
  return tasks;
}

const MAX_NAME_LENGTH = 20;

// trim して 1〜20 文字なら、その名前。そうでなければ null
function validName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? trimmed : null;
}

// 目標タスクの名前（8.2）。LLM が使えれば LLM、LlmError ならテンプレート。
// 検証に通らない名前は、その名前だけテンプレートに戻す。軽作業版がないカテゴリの light は null
export async function resolveGoalTaskNames(goal: Goal): Promise<GoalTaskNames> {
  const hasLight = templateFor(goal.category).light !== null;
  const template = templateGoalTaskNames(goal.task_name);

  let llm: GoalTaskNames;
  try {
    llm = await generateGoalTaskNamesByLlm({
      task_name: goal.task_name,
      category: goal.category,
      conditions: goal.conditions,
      has_light: hasLight,
    });
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { main: template.main, light: hasLight ? template.light : null };
  }

  const main = validName(llm.main) ?? template.main;
  if (!hasLight) return { main, light: null };
  const light = validName(llm.light);
  return { main, light: light === null || light === main ? template.light : light };
}
