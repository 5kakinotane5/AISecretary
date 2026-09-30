-- タスク枠の完了を利用者が記録し、再計画の版番号と進捗を一貫させる。

-- 案の選択：利用者が完了にした分だけ task_done_logs に記録する。
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
    and i.status = 'completed';

  update weekly_plans set status = 'discarded' where status = 'active';
  update weekly_plans set status = 'active', version = version + 1 where id = p_plan_id;
  update weekly_plans set status = 'discarded' where generation_id = v_generation and id <> p_plan_id;
end;
$$;

-- 今日の有効な計画タスクを切り替える処理と、計画の version 更新を同じ DB transaction で行う。
create or replace function set_task_slot_completion(p_item_id uuid, p_date date, p_completed boolean)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_kind text;
  v_status text;
  v_new_status text;
begin
  select weekly_plan_id, kind, status
  into v_plan_id, v_kind, v_status
  from daily_plan_items
  where id = p_item_id and date = p_date
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_kind <> 'task' then
    raise exception 'INVALID_STATE';
  end if;

  v_new_status := case when p_completed then 'completed' else 'planned' end;

  perform 1 from weekly_plans where id = v_plan_id and status = 'active' for update;
  if not found then
    raise exception 'INVALID_STATE';
  end if;

  if v_status = v_new_status then
    return v_status;
  end if;

  update daily_plan_items
  set status = v_new_status
  where id = p_item_id;

  update weekly_plans set version = version + 1 where id = v_plan_id;
  return v_new_status;
end;
$$;

revoke execute on function select_plan(uuid, timestamptz) from public, anon;
revoke execute on function set_task_slot_completion(uuid, date, boolean) from public, anon;
grant execute on function select_plan(uuid, timestamptz) to authenticated;
grant execute on function set_task_slot_completion(uuid, date, boolean) to authenticated;
