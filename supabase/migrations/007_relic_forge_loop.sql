create or replace function public.draw_relic(
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
returns table (item_id uuid, soul_shards bigint)
language plpgsql security definer set search_path = public as $$
declare
  created_id uuid;
begin
  update public.users u
  set soul_shards = u.soul_shards - p_cost
  where u.id = p_user_id and u.soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  insert into public.items (owner_id, name, aura, rarity, level, power, stat_options, absolute_soul, forge_grade)
  values (p_user_id, p_name, p_aura, p_rarity, p_level, p_power, p_stat_options, p_absolute_soul, 'C')
  returning id into created_id;

  return query select created_id, u.soul_shards from public.users u where u.id = p_user_id;
end;
$$;

create or replace function public.upgrade_item(
  p_user_id uuid,
  p_item_id uuid,
  p_cost integer,
  p_level integer,
  p_power integer,
  p_stat_options jsonb
)
returns table (item_id uuid, level integer, power integer, soul_shards bigint)
language plpgsql security definer set search_path = public as $$
begin
  update public.users u
  set soul_shards = u.soul_shards - p_cost
  where u.id = p_user_id and u.soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  update public.items i
  set level = p_level, power = p_power, stat_options = p_stat_options, updated_at = now()
  where i.id = p_item_id and i.owner_id = p_user_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  return query select p_item_id, i.level, i.power, u.soul_shards
  from public.items i join public.users u on u.id = i.owner_id
  where i.id = p_item_id and i.owner_id = p_user_id;
end;
$$;

revoke all on function public.draw_relic(uuid, integer, text, public.aura, public.item_rarity, integer, integer, jsonb, jsonb) from public;
revoke all on function public.upgrade_item(uuid, uuid, integer, integer, integer, jsonb) from public;
grant execute on function public.draw_relic(uuid, integer, text, public.aura, public.item_rarity, integer, integer, jsonb, jsonb) to service_role;
grant execute on function public.upgrade_item(uuid, uuid, integer, integer, integer, jsonb) to service_role;
