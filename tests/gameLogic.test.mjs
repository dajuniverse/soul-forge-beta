import test from 'node:test';
import assert from 'node:assert/strict';
import { counterMultiplier, rollReforge, rollSummon, simulateBattle, upgradeItem } from '../src/gameLogic.js';

const starter = { level: 1, power: 18, aura: 'ember', rarity: 'common', stat_options: { attack: 5, defense: 3 } };

test('soft counter stays useful without becoming a hard wall', () => {
  assert.equal(counterMultiplier('ember', 'gale'), 1.25);
  assert.equal(counterMultiplier('gale', 'ember'), 0.85);
  assert.equal(counterMultiplier('ember', 'ember'), 1);
});

test('battle output is server-safe and always contains a positive hit', () => {
  const result = simulateBattle({ item: starter, boss: { aura: 'gale', hp: 120, attack: 24, base_power: 80 } });
  assert.equal(typeof result.won, 'boolean');
  assert.ok(result.damage > 0);
  assert.equal(result.log.at(-1).type, 'result');
});

test('summon always returns a valid item payload', () => {
  const result = rollSummon({ soulShards: 100 });
  assert.ok(['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(result.rarity));
  assert.ok(['ember', 'tide', 'gale'].includes(result.aura));
  assert.ok(result.power > 0);
  assert.ok(Object.keys(result.stat_options).length >= 1);
});

test('reforge and upgrade reject insufficient currency', () => {
  assert.throws(() => rollReforge({ item: starter, soulShards: 24 }), /INSUFFICIENT_SOUL_SHARDS/);
  assert.throws(() => upgradeItem({ item: starter, soulShards: 41 }), /INSUFFICIENT_SOUL_SHARDS/);
});

test('upgrade advances level and power', () => {
  const upgraded = upgradeItem({ item: starter, soulShards: 100 });
  assert.equal(upgraded.level, 2);
  assert.ok(upgraded.power > starter.power);
});
