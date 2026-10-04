import { randomInt } from 'node:crypto';

export const AURAS = ['ember', 'tide', 'gale'];
const ADVANTAGE = { ember: 'gale', gale: 'tide', tide: 'ember' };
const RARITY_MULTIPLIER = { common: 1, uncommon: 1.12, rare: 1.28, epic: 1.48, legendary: 1.75 };
const FORGE_GRADES = [
  { grade: 'SS', chance: 1, powerMin: 12, powerMax: 18 },
  { grade: 'S', chance: 5, powerMin: 8, powerMax: 13 },
  { grade: 'A', chance: 12, powerMin: 5, powerMax: 9 },
  { grade: 'B', chance: 30, powerMin: 3, powerMax: 6 },
  { grade: 'C', chance: 52, powerMin: 1, powerMax: 4 }
];

export function counterMultiplier(attackerAura, defenderAura) {
  if (ADVANTAGE[attackerAura] === defenderAura) return 1.25;
  if (ADVANTAGE[defenderAura] === attackerAura) return 0.85;
  return 1;
}

function statNumber(options, key) {
  const value = Number(options?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function simulateBattle({ item, boss }) {
  const itemPower = item.power + statNumber(item.stat_options, 'attack') + item.level * 2;
  const defense = statNumber(item.stat_options, 'defense');
  const soulBonus = Number(item.absolute_soul?.damage_percent ?? 0);
  const aura = counterMultiplier(item.aura, boss.aura);
  const rarity = RARITY_MULTIPLIER[item.rarity] ?? 1;
  const damage = Math.max(1, Math.floor(itemPower * rarity * aura * (1 + soulBonus / 100)));
  const survivability = Math.max(1, itemPower * 0.55 + defense + item.level * 3);
  const margin = damage / boss.hp + survivability / Math.max(1, boss.attack * 3);
  const required = 1.28 + boss.base_power / 260;
  const won = margin >= required;
  return {
    won,
    damage,
    aura_multiplier: aura,
    combat_margin: Number(margin.toFixed(3)),
    log: [
      { type: 'aura', attacker: item.aura, defender: boss.aura, multiplier: aura },
      { type: 'impact', damage, target_hp: boss.hp },
      { type: 'result', won }
    ]
  };
}

export function rollReforge({ item, soulShards }) {
  const cost = 20 + item.level * 5;
  if (soulShards < cost) {
    const error = new Error('INSUFFICIENT_SOUL_SHARDS');
    error.status = 409;
    throw error;
  }

  const roll = randomInt(1, 101);
  let threshold = 0;
  const result = FORGE_GRADES.find((candidate) => { threshold += candidate.chance; return roll <= threshold; }) ?? FORGE_GRADES.at(-1);
  const attack = randomInt(4, 13) + item.level;
  const defense = randomInt(2, 10) + Math.floor(item.level / 2);
  const absoluteSoul = randomInt(1, 101) <= 6
    ? { id: result.grade === 'SS' ? 'void-heart' : 'echoing-core', label: result.grade === 'SS' ? 'Void Heart' : 'Echoing Core', damage_percent: result.grade === 'SS' ? 11 : 7 }
    : null;
  return {
    cost,
    forge_grade: result.grade,
    power: item.power + randomInt(result.powerMin, result.powerMax + 1),
    stat_options: { attack, defense },
    absolute_soul: absoluteSoul
  };
}
