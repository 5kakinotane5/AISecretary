-- Personal AI Secretary：テーブルと RLS（docs/design/backend.md 4章）
-- Supabase ダッシュボードの SQL Editor で、0001 → 0002 の順に1回だけ実行する。
-- すべての表は user_id を持ち、RLS で本人の行だけを読み書きできる。

-- ---------- 場所・生活リズム・移動 ----------
create table locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  address text not null,
  kind text not null check (kind in ('home', 'university', 'work', 'other')),
  created_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null,
  sleep_start text not null check (sleep_start ~ '^\d{2}:\d{2}$'),
  sleep_end text not null check (sleep_end ~ '^\d{2}:\d{2}$'),
  daily_work_limit_minutes int not null default 360 check (daily_work_limit_minutes between 60 and 960),
  min_buffer_minutes int not null default 15 check (min_buffer_minutes between 0 and 120),
  min_daily_buffer_minutes int not null default 60 check (min_daily_buffer_minutes between 0 and 480),
  home_location_id uuid not null references locations(id),
  demo_now timestamptz,                                          -- デモモードの現在時刻
  preference_weights jsonb not null default '[0,0,0,0,0,0,0]',   -- 選択からの学習（planning.md 9.2）
  created_at timestamptz not null default now()
);

create table travel_times (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_location_id uuid not null references locations(id) on delete cascade,
  to_location_id uuid not null references locations(id) on delete cascade,
  minutes int not null check (minutes > 0),
  mode text not null check (mode in ('walk', 'train', 'bus', 'bike', 'walk_train')),
  note text,
  unique (user_id, from_location_id, to_location_id)
);

create table fixed_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  category text not null check (category in ('class', 'work', 'meal', 'social', 'family', 'other')),
  location_id uuid references locations(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  recurrence text check (recurrence in ('weekly')),
  check (start_at < end_at)
);

-- ---------- 目標・タスク ----------
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_name text not null,
  category text not null,
  target_hours_per_week numeric(4, 1) not null check (target_hours_per_week between 1 and 15),
  frequency text,
  deadline date,
  priority text not null check (priority in ('low', 'medium', 'high')),
  conditions text[] not null default '{}',
  user_selected_plan text not null check (user_selected_plan in ('intensive', 'balanced', 'paced')),
  weekday_time_band text check (weekday_time_band in ('morning', 'daytime', 'evening')),
  weekend_time_band text check (weekend_time_band in ('morning', 'daytime', 'evening')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()                 -- confirm のときの getNow()（デモ時刻）を入れる
);
create unique index goals_one_active on goals (user_id) where status = 'active';

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  goal_id uuid references goals(id) on delete cascade,
  deadline_at timestamptz,
  estimated_minutes int not null check (estimated_minutes between 5 and 600 and estimated_minutes % 5 = 0),
  remaining_minutes int not null check (remaining_minutes between 0 and 6000 and remaining_minutes % 5 = 0),
  importance text not null check (importance in ('low', 'medium', 'high')),
  concentration text not null check (concentration in ('low', 'medium', 'high')),
  splittable boolean not null,
  interruptible boolean not null,
  buffer_fit text not null check (buffer_fit in ('low', 'medium', 'high')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);

-- 計画を選び直す前に実施済みだった分（backend.md 8.2）
create table task_done_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  date date not null,
  minutes int not null check (minutes > 0),
  created_at timestamptz not null default now()
);

create table daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  mood text check (mood in ('low', 'medium', 'high')),
  fatigue text check (fatigue in ('low', 'medium', 'high')),
  concentration text check (concentration in ('low', 'medium', 'high')),
  want_task_ids uuid[] not null default '{}',
  avoid_task_ids uuid[] not null default '{}',
  note text,
  unique (user_id, date)
);

-- ---------- ヒアリング ----------
create table interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state text not null check (state in ('INTERVIEWING', 'CONFIRMING', 'COMPLETED', 'READY_FOR_PLANNING',
                                       'PLANNING', 'PLAN_PROPOSED', 'ABANDONED')),
  step text not null,
  step_index int not null,
  retry_count int not null default 0,           -- 同じステップでの聞き直し回数
  slots jsonb not null default '{}',            -- 抽出した項目
  goal_candidates jsonb,                        -- GoalTimeCandidate[]
  goal_draft jsonb,                             -- Goal（id はまだない）
  goal_id uuid references goals(id) on delete set null,
  created_at timestamptz not null default now()
);

create table interview_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references interview_sessions(id) on delete cascade,
  role text not null check (role in ('ai', 'user')),
  text text not null,
  created_at timestamptz not null default now()
);

-- ---------- 計画 ----------
create table weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  generation_id uuid not null,                  -- 同時に作った3案で共通
  week_start date not null,
  style text not null check (style in ('intensive', 'balanced', 'relaxed')),
  label text not null,
  summary jsonb not null,                       -- PlanSummary
  features jsonb not null,                      -- ObjectiveVector（planning.md 6章）
  status text not null check (status in ('candidate', 'active', 'discarded')),
  version int not null default 0,               -- 項目を変えるたびに +1（再計画の base_version）
  created_at timestamptz not null default now()
);
create unique index weekly_plans_one_active on weekly_plans (user_id) where status = 'active';

create table daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekly_plan_id uuid not null references weekly_plans(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('sleep', 'fixed', 'travel', 'task', 'buffer', 'free')),
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  location_id uuid references locations(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  fixed_event_id uuid references fixed_events(id) on delete set null,
  fixed_category text,
  travel jsonb,
  suggested_task_id uuid references tasks(id) on delete set null,
  locked boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'completed')),
  reason text,
  reason_code text,
  carried boolean not null default false,       -- 作り直しのとき前の計画から写した過去の項目（二重計上を防ぐ）
  check (start_at < end_at)
);
create index daily_plan_items_plan_date on daily_plan_items (weekly_plan_id, date, start_at);

create table replan_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekly_plan_id uuid not null references weekly_plans(id) on delete cascade,
  date date not null,
  proposal jsonb not null,                      -- ReplanProposal（画面に返したもの）
  updated_days jsonb not null,                  -- [{ date, items: daily_plan_items の行 }]
  new_fixed_events jsonb not null default '[]', -- accept で fixed_events に入れる行
  base_version int not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'discarded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS：本人の行だけ ----------
alter table locations enable row level security;
alter table user_settings enable row level security;
alter table travel_times enable row level security;
alter table fixed_events enable row level security;
alter table goals enable row level security;
alter table tasks enable row level security;
alter table task_done_logs enable row level security;
alter table daily_checkins enable row level security;
alter table interview_sessions enable row level security;
alter table interview_messages enable row level security;
alter table weekly_plans enable row level security;
alter table daily_plan_items enable row level security;
alter table replan_proposals enable row level security;

create policy "own rows" on locations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on travel_times for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on fixed_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on task_done_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on daily_checkins for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on interview_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on interview_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on weekly_plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on daily_plan_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on replan_proposals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
