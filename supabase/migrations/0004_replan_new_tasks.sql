-- 会話の再計画で足したタスクを、提案の確定（apply_replan）で tasks に入れる（replan-add.md 12.19）。
-- Supabase の SQL Editor で流す。0001〜0003 の後に1回だけ。

-- accept で tasks に入れる行。tasks の全列を持つ（user_id・created_at も入れる。
-- jsonb_populate_recordset で select * するため、行にない列は default ではなく null になる）
alter table replan_proposals add column new_tasks jsonb not null default '[]';

-- 再計画の確定（plans-replan.md 12.6）。0002 と同じで、tasks の insert だけを足した
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

  -- daily_plan_items.task_id が tasks を参照するため、項目より前に入れる
  insert into tasks
  select * from jsonb_populate_recordset(null::tasks, p.new_tasks);

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

-- 実行できる役割を、ログイン中の利用者（authenticated）だけにする（0002 と同じ）
revoke execute on function apply_replan(uuid) from public, anon;
grant execute on function apply_replan(uuid) to authenticated;

-- new_tasks の列を API（PostgREST）からすぐ使えるようにする
notify pgrst, 'reload schema';
