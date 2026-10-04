insert into public.bosses (floor, name, aura, base_power, hp, attack, defense, reward_shards)
values
  (1, 'Ashbound Sentinel', 'gale', 80, 120, 24, 8, 12),
  (2, 'Tideglass Warden', 'ember', 96, 150, 28, 10, 14),
  (3, 'Galehook Ravager', 'tide', 115, 185, 33, 12, 16),
  (4, 'Cinder Archivist', 'gale', 138, 225, 39, 15, 18),
  (5, 'Drowned Crown', 'ember', 165, 270, 46, 18, 21),
  (6, 'Skybreak Colossus', 'tide', 198, 325, 54, 22, 24),
  (7, 'Blackkiln Regent', 'gale', 238, 390, 63, 26, 28),
  (8, 'Moonless Leviathan', 'ember', 285, 465, 73, 31, 32),
  (9, 'Tempest Reliquary', 'tide', 342, 555, 85, 37, 36),
  (10, 'The Unmaking Forge', 'gale', 410, 660, 98, 44, 42)
on conflict (floor) do update set
  name = excluded.name, aura = excluded.aura, base_power = excluded.base_power,
  hp = excluded.hp, attack = excluded.attack, defense = excluded.defense,
  reward_shards = excluded.reward_shards;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Forgemaster')) on conflict (id) do nothing;
  insert into public.tower_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.leaderboard_profiles (user_id, display_name, avatar_seed)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Forgemaster'), 'forge-' || right(replace(new.id::text, '-', ''), 2))
  on conflict (user_id) do nothing;
  insert into public.items (owner_id, name, aura, rarity, level, power, forge_grade, stat_options)
  values (new.id, 'Emberbound Starter', 'ember', 'common', 1, 18, 'C', '{"attack": 5, "defense": 3}'::jsonb);
  return new;
end;
$$;

insert into public.items (owner_id, name, aura, rarity, level, power, forge_grade, stat_options)
select u.id, 'Emberbound Starter', 'ember', 'common', 1, 18, 'C', '{"attack": 5, "defense": 3}'::jsonb
from public.users u
where not exists (select 1 from public.items i where i.owner_id = u.id);
