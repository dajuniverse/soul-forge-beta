create extension if not exists pgcrypto;

create type public.aura as enum ('ember', 'tide', 'gale');
create type public.item_rarity as enum ('common', 'uncommon', 'rare', 'epic', 'legendary');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Forgemaster',
  highest_floor integer not null default 0 check (highest_floor >= 0),
  soul_shards bigint not null default 100 check (soul_shards >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bosses (
  id uuid primary key default gen_random_uuid(),
  floor integer not null unique check (floor > 0),
  name text not null,
  aura public.aura not null,
  base_power integer not null check (base_power > 0),
  hp integer not null check (hp > 0),
  attack integer not null check (attack > 0),
  defense integer not null check (defense >= 0),
  reward_shards integer not null default 10 check (reward_shards >= 0),
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  aura public.aura not null,
  rarity public.item_rarity not null default 'common',
  level integer not null default 1 check (level between 1 and 100),
  power integer not null default 10 check (power >= 0),
  stat_options jsonb not null default '{}'::jsonb,
  absolute_soul jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_stat_options_object check (jsonb_typeof(stat_options) = 'object'),
  constraint items_absolute_soul_object check (absolute_soul is null or jsonb_typeof(absolute_soul) = 'object')
);

create table public.tower_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  current_floor integer not null default 1 check (current_floor > 0),
  active_boss_id uuid references public.bosses(id),
  last_result jsonb,
  updated_at timestamptz not null default now()
);

create index items_owner_id_idx on public.items(owner_id);
create index bosses_floor_idx on public.bosses(floor);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_touch_updated_at before update on public.users
for each row execute function public.touch_updated_at();
create trigger items_touch_updated_at before update on public.items
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id) values (new.id) on conflict (id) do nothing;
  insert into public.tower_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.users enable row level security;
alter table public.items enable row level security;
alter table public.tower_progress enable row level security;
alter table public.bosses enable row level security;

create policy users_self_read on public.users for select using (auth.uid() = id);
create policy items_owner_read on public.items for select using (auth.uid() = owner_id);
create policy tower_owner_read on public.tower_progress for select using (auth.uid() = user_id);
create policy bosses_public_read on public.bosses for select using (true);

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
begin
  update public.tower_progress
  set current_floor = case when p_won then p_next_floor else p_expected_floor end,
      last_result = p_result,
      updated_at = now()
  where user_id = p_user_id and current_floor = p_expected_floor;

  if not found then
    raise exception 'STALE_TOWER_STATE' using errcode = '40001';
  end if;

  update public.users
  set highest_floor = greatest(highest_floor, case when p_won then p_next_floor - 1 else p_expected_floor - 1 end),
      soul_shards = soul_shards + case when p_won then p_reward_shards else 0 end
  where id = p_user_id;

  return query select tp.current_floor, u.highest_floor, u.soul_shards
  from public.tower_progress tp join public.users u on u.id = tp.user_id
  where tp.user_id = p_user_id;
end;
$$;

create or replace function public.commit_reforge(
  p_user_id uuid,
  p_item_id uuid,
  p_cost integer,
  p_power integer,
  p_stat_options jsonb,
  p_absolute_soul jsonb
)
returns table (item_id uuid, soul_shards bigint)
language plpgsql security definer set search_path = public as $$
begin
  update public.users
  set soul_shards = soul_shards - p_cost
  where id = p_user_id and soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  update public.items
  set power = p_power, stat_options = p_stat_options,
      absolute_soul = p_absolute_soul, updated_at = now()
  where id = p_item_id and owner_id = p_user_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  return query select p_item_id, soul_shards from public.users where id = p_user_id;
end;
$$;

revoke all on function public.record_tower_result(uuid, integer, boolean, integer, integer, jsonb) from public;
revoke all on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb) from public;
grant execute on function public.record_tower_result(uuid, integer, boolean, integer, integer, jsonb) to service_role;
grant execute on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb) to service_role;
