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
  update public.tower_progress as tp
  set current_floor = case when p_won then p_next_floor else p_expected_floor end,
      last_result = p_result,
      updated_at = now()
  where tp.user_id = p_user_id and tp.current_floor = p_expected_floor;
  if not found then raise exception 'STALE_TOWER_STATE' using errcode = '40001'; end if;

  update public.users as u
  set highest_floor = greatest(u.highest_floor, case when p_won then p_next_floor - 1 else p_expected_floor - 1 end),
      soul_shards = u.soul_shards + case when p_won then p_reward_shards else 0 end
  where u.id = p_user_id
  returning u.highest_floor into v_highest;

  if p_won then
    insert into public.leaderboard_profiles as target (user_id, display_name, highest_floor, avatar_seed, loadout, updated_at)
    select u.id, u.display_name, u.highest_floor,
           coalesce(lp.avatar_seed, 'forge-' || right(replace(u.id::text, '-', ''), 2)),
           coalesce(p_result->'loadout', '{}'::jsonb), now()
    from public.users u left join public.leaderboard_profiles lp on lp.user_id = u.id
    where u.id = p_user_id
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      highest_floor = greatest(target.highest_floor, excluded.highest_floor),
      loadout = case when excluded.highest_floor >= target.highest_floor then excluded.loadout else target.loadout end,
      updated_at = case when excluded.highest_floor >= target.highest_floor then now() else target.updated_at end;
  end if;

  return query select tp.current_floor, v_highest, u.soul_shards
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
  p_absolute_soul jsonb,
  p_forge_grade text
)
returns table (item_id uuid, soul_shards bigint, forge_grade text)
language plpgsql security definer set search_path = public as $$
begin
  if p_forge_grade not in ('C', 'B', 'A', 'S', 'SS') then raise exception 'INVALID_FORGE_GRADE'; end if;

  update public.users as u
  set soul_shards = u.soul_shards - p_cost
  where u.id = p_user_id and u.soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  update public.items as i
  set power = p_power,
      stat_options = p_stat_options,
      absolute_soul = p_absolute_soul,
      forge_grade = p_forge_grade,
      updated_at = now()
  where i.id = p_item_id and i.owner_id = p_user_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  return query select p_item_id, u.soul_shards, p_forge_grade
  from public.users u where u.id = p_user_id;
end;
$$;

revoke all on function public.record_tower_result(uuid, integer, boolean, integer, integer, jsonb) from public;
revoke all on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb, text) from public;
grant execute on function public.record_tower_result(uuid, integer, boolean, integer, integer, jsonb) to service_role;
grant execute on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb, text) to service_role;
