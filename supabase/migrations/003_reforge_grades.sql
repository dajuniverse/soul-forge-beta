alter table public.items
  add column if not exists forge_grade text not null default 'C'
  check (forge_grade in ('C', 'B', 'A', 'S', 'SS'));

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

  update public.users
  set soul_shards = soul_shards - p_cost
  where id = p_user_id and soul_shards >= p_cost;
  if not found then raise exception 'INSUFFICIENT_SOUL_SHARDS'; end if;

  update public.items
  set power = p_power, stat_options = p_stat_options,
      absolute_soul = p_absolute_soul, forge_grade = p_forge_grade, updated_at = now()
  where id = p_item_id and owner_id = p_user_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  return query select p_item_id, u.soul_shards, p_forge_grade
  from public.users u where u.id = p_user_id;
end;
$$;

revoke all on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb, text) from public;
grant execute on function public.commit_reforge(uuid, uuid, integer, integer, jsonb, jsonb, text) to service_role;
