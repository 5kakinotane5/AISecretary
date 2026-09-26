import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCATIONS, LOCATION_IDS, PERSONA_DISPLAY_NAME, TRAVEL_TIMES, USER_PREFERENCE } from "@/mocks/persona";
import { FIXED_EVENTS } from "@/mocks/fixed-events"; // ← FIXED_EVENTS があるファイルに合わせる
import { TASKS } from "@/mocks/tasks";
import { DEFAULT_DEMO_NOW } from "./clock";

// Supabase の { data, error } で、error があれば投げる
function check(error: unknown) {
  if (error) throw error;
}

// デモ用のデータを入れる（backend.md 4.5）。表示名を返す
export async function seedDemoUser(supabase: SupabaseClient, userId: string): Promise<string> {
  // モックの読みやすい ID（loc_home など）→ 新しい UUID の置き換え表
  const locId = new Map(LOCATIONS.map((l) => [l.id, crypto.randomUUID()]));
  const toLoc = (mockId: string | null) => {
    if (mockId === null) return null;
    const id = locId.get(mockId);
    if (!id) throw new Error(`seed: 場所 ${mockId} が LOCATIONS にない`);
    return id;
  };

  // 1. locations
  check((await supabase.from("locations").insert(
    LOCATIONS.map((l) => ({
      id: toLoc(l.id), user_id: userId, name: l.name, address: l.address, kind: l.kind,
    })),
  )).error);

  // 2. travel_times
  check((await supabase.from("travel_times").insert(
    TRAVEL_TIMES.map((t) => ({
      user_id: userId,
      from_location_id: toLoc(t.from_location_id),
      to_location_id: toLoc(t.to_location_id),
      minutes: t.minutes, mode: t.mode, note: t.note,
    })),
  )).error);

  // 3. fixed_events
  check((await supabase.from("fixed_events").insert(
    FIXED_EVENTS.map((e) => ({
      id: crypto.randomUUID(), user_id: userId, title: e.title, category: e.category,
      location_id: toLoc(e.location_id), start_at: e.start_at, end_at: e.end_at, recurrence: e.recurrence,
    })),
  )).error);

  // 4. tasks（目標タスクは入れない。confirm で作る）
  check((await supabase.from("tasks").insert(
    TASKS.filter((t) => t.goal_id === null).map((t) => ({
      id: crypto.randomUUID(), user_id: userId, title: t.title, goal_id: null,
      deadline_at: t.deadline_at, estimated_minutes: t.estimated_minutes, remaining_minutes: t.remaining_minutes,
      importance: t.importance, concentration: t.concentration, splittable: t.splittable,
      interruptible: t.interruptible, buffer_fit: t.buffer_fit, status: t.status,
    })),
  )).error);

  // 5. user_settings（最後に入れる。mock-login は「これがあれば seed 済み」と判定するため）
  check((await supabase.from("user_settings").insert({
    user_id: userId,
    display_name: PERSONA_DISPLAY_NAME,
    ...USER_PREFERENCE,
    home_location_id: toLoc(LOCATION_IDS.home),
    demo_now: DEFAULT_DEMO_NOW,
  })).error);

  return PERSONA_DISPLAY_NAME;
}