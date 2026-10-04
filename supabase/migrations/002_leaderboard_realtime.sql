create table public.leaderboard_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null default 'Forgemaster',
  highest_floor integer not null default 0 check (highest_floor >= 0),
  avatar_seed text not null default 'forge-01',
  loadout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint leaderboard_loadout_object check (jsonb_typeof(loadout) = 'object')
);

create index leaderboard_profiles_floor_idx on public.leaderboard_profiles(highest_floor desc, updated_at asc);
alter table public.leaderboard_profiles enable row level security;
create policy leaderboard_public_read on public.leaderboard_profiles for select using (true);

insert into public.leaderboard_profiles (user_id, display_name, highest_floor, avatar_seed)
select id, display_name, highest_floor, 'forge-' || right(replace(id::text, '-', ''), 2)
from public.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id) values (new.id) on conflict (id) do nothing;
  insert into public.tower_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.leaderboard_profiles (user_id, display_name, avatar_seed)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Forgemaster'), 'forge-' || right(replace(new.id::text, '-', ''), 2))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.record_tower_result(
  p_user_id uuid,
  p_expected_floor integer,
  p_won boolean,
  p_next_floor integer,
  p_reward_shards integer,
  p_result jsonb
)
returns table (current_floor integer, highest_floor integer, soul_shards bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_highest integer;
begin
  update public.tower_progress
  set current_floor = case when p_won then p_next_floor else p_expected_floor end,
      last_result = p_result,
      updated_at = now()
  where user_id = p_user_id and current_floor = p_expected_floor;

  if not found then raise exception 'STALE_TOWER_STATE' using errcode = '40001'; end if;

  update public.users
  set highest_floor = greatest(highest_floor, case when p_won then p_next_floor - 1 else p_expected_floor - 1 end),
      soul_shards = soul_shards + case when p_won then p_reward_shards else 0 end
  where id = p_user_id
  returning users.highest_floor into v_highest;

  if p_won then
    insert into public.leaderboard_profiles (user_id, display_name, highest_floor, avatar_seed, loadout, updated_at)
    select u.id, u.display_name, u.highest_floor, coalesce(lp.avatar_seed, 'forge-' || right(replace(u.id::text, '-', ''), 2)),
           coalesce(p_result->'loadout', '{}'::jsonb), now()
    from public.users u left join public.leaderboard_profiles lp on lp.user_id = u.id
    where u.id = p_user_id
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      highest_floor = greatest(public.leaderboard_profiles.highest_floor, excluded.highest_floor),
      loadout = case when excluded.highest_floor >= public.leaderboard_profiles.highest_floor then excluded.loadout else public.leaderboard_profiles.loadout end,
      updated_at = case when excluded.highest_floor >= public.leaderboard_profiles.highest_floor then now() else public.leaderboard_profiles.updated_at end;
  end if;

  return query select tp.current_floor, v_highest, u.soul_shards
  from public.tower_progress tp join public.users u on u.id = tp.user_id
  where tp.user_id = p_user_id;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.leaderboard_profiles;
exception when duplicate_object then null;
end $$;

grant select on public.leaderboard_profiles to anon, authenticated;
grant execute on function public.record_tower_result(uuid, integer, boolean, integer, integer, jsonb) to service_role;
