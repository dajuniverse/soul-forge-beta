import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rollReforge, simulateBattle } from './gameLogic.js';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']
    }
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use(pinoHttp());

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function requireUser(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'INVALID_TOKEN' });
  req.user = data.user;
  next();
}

const challengeSchema = z.object({ floor: z.number().int().positive(), item_id: z.string().uuid() });
const reforgeSchema = z.object({ item_id: z.string().uuid() });
const leaderboardSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const profileSchema = z.object({ display_name: z.string().trim().min(2).max(20).regex(/^[^<>]{2,20}$/) });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'soul-forge-api' }));
app.get('/v1/config', (_req, res) => res.json({ supabase_url: process.env.SUPABASE_URL, supabase_anon_key: process.env.SUPABASE_ANON_KEY }));

app.post('/v1/profile', requireUser, async (req, res, next) => {
  try {
    const { display_name: displayName } = profileSchema.parse(req.body);
    const profile = await admin.from('users').update({ display_name: displayName }).eq('id', req.user.id).select('id, display_name, highest_floor, soul_shards').single();
    if (profile.error) throw profile.error;
    const leaderboard = await admin.from('leaderboard_profiles').update({ display_name: displayName }).eq('user_id', req.user.id);
    if (leaderboard.error) throw leaderboard.error;
    res.json({ profile: profile.data });
  } catch (error) { next(error); }
});

app.get('/v1/leaderboard', async (req, res, next) => {
  try {
    const { limit } = leaderboardSchema.parse(req.query);
    const result = await admin.from('leaderboard_profiles')
      .select('user_id, display_name, highest_floor, avatar_seed, loadout, updated_at')
      .order('highest_floor', { ascending: false }).order('updated_at', { ascending: true }).limit(limit);
    if (result.error) throw result.error;
    res.json({ entries: result.data });
  } catch (error) { next(error); }
});

app.get('/v1/items', requireUser, async (req, res, next) => {
  try {
    const result = await admin.from('items')
      .select('id, name, aura, rarity, level, power, forge_grade, stat_options, absolute_soul')
      .eq('owner_id', req.user.id)
      .order('power', { ascending: false });
    if (result.error) throw result.error;
    res.json({ items: result.data });
  } catch (error) { next(error); }
});

app.get('/v1/tower/state', requireUser, async (req, res, next) => {
  try {
    const progress = await admin.from('tower_progress')
      .select('current_floor, last_result, users!inner(highest_floor, soul_shards)')
      .eq('user_id', req.user.id).single();
    if (progress.error) throw progress.error;
    const boss = await admin.from('bosses')
      .select('id, floor, name, aura, base_power, hp, attack, defense, reward_shards')
      .eq('floor', progress.data.current_floor).single();
    if (boss.error) throw boss.error;
    res.json({ progress: progress.data, boss: boss.data });
  } catch (error) { next(error); }
});

app.post('/v1/tower/challenge', requireUser, async (req, res, next) => {
  try {
    const { floor, item_id: itemId } = challengeSchema.parse(req.body);
    const [progressResult, itemResult, bossResult] = await Promise.all([
      admin.from('tower_progress').select('current_floor').eq('user_id', req.user.id).single(),
      admin.from('items').select('id, name, aura, rarity, level, power, forge_grade, stat_options, absolute_soul').eq('id', itemId).eq('owner_id', req.user.id).single(),
      admin.from('bosses').select('id, floor, name, aura, base_power, hp, attack, defense, reward_shards').eq('floor', floor).single()
    ]);
    if (progressResult.error) throw progressResult.error;
    if (itemResult.error) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
    if (bossResult.error) return res.status(404).json({ error: 'BOSS_NOT_FOUND' });
    if (progressResult.data.current_floor !== floor) return res.status(409).json({ error: 'INVALID_FLOOR', current_floor: progressResult.data.current_floor });

    const battle = simulateBattle({ item: itemResult.data, boss: bossResult.data });
    const result = await admin.rpc('record_tower_result', {
      p_user_id: req.user.id, p_expected_floor: floor, p_won: battle.won,
      p_next_floor: floor + 1, p_reward_shards: bossResult.data.reward_shards,
      p_result: {
        boss_id: bossResult.data.id, ...battle,
        loadout: { name: itemResult.data.name, aura: itemResult.data.aura, rarity: itemResult.data.rarity, forge_grade: itemResult.data.forge_grade,
          level: itemResult.data.level, power: itemResult.data.power, stat_options: itemResult.data.stat_options,
          absolute_soul: itemResult.data.absolute_soul }
      }
    });
    if (result.error) throw result.error;
    const state = result.data?.[0];
    res.json({ floor, boss: { name: bossResult.data.name, aura: bossResult.data.aura }, ...battle, state });
  } catch (error) { next(error); }
});

app.post('/v1/items/reforge', requireUser, async (req, res, next) => {
  try {
    const { item_id: itemId } = reforgeSchema.parse(req.body);
    const itemResult = await admin.from('items').select('id, level, power, stat_options, owner_id').eq('id', itemId).eq('owner_id', req.user.id).single();
    if (itemResult.error) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });
    const userResult = await admin.from('users').select('soul_shards').eq('id', req.user.id).single();
    if (userResult.error) throw userResult.error;
    const roll = rollReforge({ item: itemResult.data, soulShards: userResult.data.soul_shards });
    const committed = await admin.rpc('commit_reforge', {
      p_user_id: req.user.id, p_item_id: itemId, p_cost: roll.cost,
      p_power: roll.power, p_stat_options: roll.stat_options, p_absolute_soul: roll.absolute_soul, p_forge_grade: roll.forge_grade
    });
    if (committed.error) throw committed.error;
    res.json({ item_id: itemId, ...roll, soul_shards: committed.data?.[0]?.soul_shards });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_REQUEST', details: error.flatten() });
  const knownConflict = ['INSUFFICIENT_SOUL_SHARDS', 'STALE_TOWER_STATE', 'INVALID_FLOOR'];
  const status = error.status ?? (knownConflict.some((code) => String(error.message).includes(code)) ? 409 : 500);
  res.status(status).json({ error: status === 500 ? 'INTERNAL_ERROR' : error.message });
});

app.use(express.static('public', { extensions: ['html'] }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Soul Forge API listening on :${port}`));
