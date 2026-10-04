create table if not exists public.summon_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  draw_count integer not null default 0 check (draw_count >= 0),
  relic_dust bigint not null default 0 check (relic_dust >= 0),
  updated_at timestamptz not null default now()
);

insert into public.summon_progress (user_id)
select id from public.users
on conflict (user_id) do nothing;

alter table public.summon_progress enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Forgemaster')) on conflict (id) do nothing;
  insert into public.tower_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.leaderboard_profiles (user_id, display_name, avatar_seed)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Forgemaster'), 'forge-' || right(replace(new.id::text, '-', ''), 2))
  on conflict (user_id) do nothing;
  insert into public.summon_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.items (owner_id, name, aura, rarity, level, power, forge_grade, stat_options)
  values (new.id, 'Emberbound Starter', 'ember', 'common', 1, 18, 'C', '{"attack": 5, "defense": 3}'::jsonb);
  return new;
end;
$$;

drop function if exists public.draw_relic(uuid, integer, text, public.aura, public.item_rarity, integer, integer, jsonb, jsonb);

create function public.draw_relic(
  p_user_id uuid,
  p_cost integer,
  p_name text,
  p_aura public.aura,
  p_rarity public.item_rarity,
  p_level integer,
  p_power integer,
  p_stat_options jsonb,
  p_absolute_soul jsonb
)
returns table (item_id uuid, soul_shards bigint, rarity public.item_rarity, draw_count integer)
language plpgsql security definer set search_path = public as $$
declare
  created_id uuid;
  current_draws integer;
  final_rarity public.item_rarity;
begin
  insert into public.summon_progress (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select sp.draw_count into current_draws from public.summon_progress sp where sp.user_id = p_user_id for update;

  update public.users u
  set soul_shards = u.soul_shards - p_cost
  where u.id = p_user_id and u.soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  final_rarity := case
    when (current_draws + 1) % 50 = 0 then 'legendary'::public.item_rarity
    when (current_draws + 1) % 10 = 0 and p_rarity in ('common', 'uncommon', 'rare') then 'epic'::public.item_rarity
    else p_rarity
  end;

  insert into public.items (owner_id, name, aura, rarity, level, power, stat_options, absolute_soul, forge_grade)
  values (p_user_id, p_name, p_aura, final_rarity, p_level, p_power, p_stat_options, p_absolute_soul, 'C')
  returning id into created_id;

  update public.summon_progress sp
  set draw_count = current_draws + 1, updated_at = now()
  where sp.user_id = p_user_id;

  return query select created_id, u.soul_shards, final_rarity, current_draws + 1
  from public.users u where u.id = p_user_id;
end;
$$;

revoke all on function public.draw_relic(uuid, integer, text, public.aura, public.item_rarity, integer, integer, jsonb, jsonb) from public;
grant execute on function public.draw_relic(uuid, integer, text, public.aura, public.item_rarity, integer, integer, jsonb, jsonb) to service_role;
