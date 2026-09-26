-- Personal AI Secretary：複数の表をまとめて変える操作（docs/design/backend.md 4.4）
-- すべて security invoker（呼んだ利用者の権限で動き、RLS が効く）。
-- API からは supabase.rpc("関数名", { 引数 }) で呼ぶ。
-- エラーは raise exception 'CODE' で投げる。API は message の CODE を見て 2.2 のエラーに変換する。
-- jsonb で渡す行は、テーブルの列名と同じキーをすべて持つこと（id・user_id・created_at も含める）。

-- 3案の保存：前の候補を捨て、3案と項目を入れ、セッションを PLAN_PROPOSED にする（plans-replan.md 11.1）
create or replace function save_generation(p_session_id uuid, p_plans jsonb, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update weekly_plans set status = 'discarded' where status = 'candidate';

  insert into weekly_plans (id, generation_id, week_start, style, label, summary, features, status)
  select x.id, x.generation_id, x.week_start, x.style, x.label, x.summary, x.features, 'candidate'
  from jsonb_to_recordset(p_plans) as x(
    id uuid, generation_id uuid, week_start date, style text, label text, summary jsonb, features jsonb
  );

  insert into daily_plan_items
  select * from jsonb_populate_recordset(null::daily_plan_items, p_items);

  update interview_sessions set state = 'PLAN_PROPOSED' where id = p_session_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

-- 案の選択：今までの有効な計画の実施済みの分を記録してから切り替える（plans-replan.md 11.1、backend.md 8.2）
create or replace function select_plan(p_plan_id uuid, p_now timestamptz)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_generation uuid;
begin
  select generation_id into v_generation
  from weekly_plans
  where id = p_plan_id and status = 'candidate';
  if v_generation is null then
    raise exception 'NOT_FOUND';
  end if;

  insert into task_done_logs (task_id, date, minutes)
  select i.task_id, i.date, (extract(epoch from (i.end_at - i.start_at)) / 60)::int
  from daily_plan_items i
  join weekly_plans w on w.id = i.weekly_plan_id
  where w.status = 'active'
    and i.kind = 'task'
    and i.task_id is not null
    and i.carried = false
    and i.end_at <= p_now;

  update weekly_plans set status = 'discarded' where status = 'active';
  update weekly_plans set status = 'active', version = version + 1 where id = p_plan_id;
  update weekly_plans set status = 'discarded' where generation_id = v_generation and id <> p_plan_id;
end;
$$;

-- 目標の確定：前の有効な目標を archived にし、その目標タスクを消し、新しい目標とタスクを入れる（backend.md 8.1）
create or replace function confirm_goal(p_session_id uuid, p_goal jsonb, p_tasks jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_goal_id uuid := (p_goal ->> 'id')::uuid;
begin
  delete from tasks where goal_id in (select id from goals where status = 'active');
  update goals set status = 'archived' where status = 'active';

  insert into goals select * from jsonb_populate_record(null::goals, p_goal);
  insert into tasks select * from jsonb_populate_recordset(null::tasks, p_tasks);

  update interview_sessions set state = 'READY_FOR_PLANNING', goal_id = v_goal_id where id = p_session_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return v_goal_id;
end;
$$;

-- 再計画の確定（plans-replan.md 12.6）
create or replace function apply_replan(p_proposal_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p replan_proposals;
  v_version int;
  d jsonb;
begin
  select * into p from replan_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select version into v_version from weekly_plans where id = p.weekly_plan_id and status = 'active';
  if p.status <> 'pending' or p.expires_at < now() or v_version is distinct from p.base_version then
    raise exception 'PROPOSAL_EXPIRED';
  end if;

  insert into fixed_events
  select * from jsonb_populate_recordset(null::fixed_events, p.new_fixed_events);

  for d in select * from jsonb_array_elements(p.updated_days) loop
    delete from daily_plan_items
    where weekly_plan_id = p.weekly_plan_id and date = (d ->> 'date')::date;
    insert into daily_plan_items
    select * from jsonb_populate_recordset(null::daily_plan_items, d -> 'items');
  end loop;

  update weekly_plans set version = version + 1 where id = p.weekly_plan_id;
  update replan_proposals set status = 'accepted' where id = p.id;
  update replan_proposals set status = 'discarded'
  where weekly_plan_id = p.weekly_plan_id and date = p.date and status = 'pending';
end;
$$;

-- ---------- 実行できる役割を、ログイン中の利用者（authenticated）だけにする ----------
-- Supabase では public スキーマの関数は既定で anon（未ログイン）も実行できるため、外しておく。
revoke execute on function save_generation(uuid, jsonb, jsonb) from public, anon;
revoke execute on function select_plan(uuid, timestamptz) from public, anon;
revoke execute on function confirm_goal(uuid, jsonb, jsonb) from public, anon;
revoke execute on function apply_replan(uuid) from public, anon;
grant execute on function save_generation(uuid, jsonb, jsonb) to authenticated;
grant execute on function select_plan(uuid, timestamptz) to authenticated;
grant execute on function confirm_goal(uuid, jsonb, jsonb) to authenticated;
grant execute on function apply_replan(uuid) to authenticated;
