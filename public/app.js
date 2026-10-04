const state = { token: null, nickname: localStorage.getItem('soulForgeNickname') || '', items: [], selectedItem: null, tower: null, leaderboard: [], busy: false, realtime: null };

const $ = (id) => document.getElementById(id);
const auraNames = { ember: 'EMBER', tide: 'TIDE', gale: 'GALE' };
const auraKorean = { ember: '화염', tide: '조류', gale: '질풍' };
const advantage = { ember: 'gale', gale: 'tide', tide: 'ember' };
let phaserScene;
let supabaseClient;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function currentUserId() { try { return state.token ? JSON.parse(atob(state.token.split('.')[1])).sub : null; } catch { return null; } }

function initPhaser() {
  if (!window.Phaser) return;
  class CombatScene extends Phaser.Scene {
    constructor() { super('CombatScene'); }
    create() {
      phaserScene = this;
      this.fx = this.add.graphics();
      this.scale.on('resize', () => this.fx.clear());
    }
    triggerImpact(victory) {
      const { width, height } = this.scale;
      const cx = width * .51; const cy = height * .49;
      this.fx.clear(); this.fx.alpha = 1;
      const rings = [12, 28, 48, 72];
      rings.forEach((radius, index) => {
        this.fx.lineStyle(2, victory ? 0xe1a86b : 0xb97562, 0.85 - index * .15);
        this.fx.strokeCircle(cx, cy, radius);
        this.tweens.add({ targets: this.fx, alpha: 0, duration: 720, delay: index * 45, ease: 'Cubic.Out', onComplete: () => this.fx.clear() });
      });
      for (let i = 0; i < 18; i += 1) {
        const shard = this.add.rectangle(cx, cy, 3, 3, victory ? 0xe6c58e : 0xc98168);
        const angle = (Math.PI * 2 * i) / 18;
        this.tweens.add({ targets: shard, x: cx + Math.cos(angle) * (60 + i * 3), y: cy + Math.sin(angle) * (60 + i * 3), alpha: 0, angle: 120, duration: 560 + i * 12, ease: 'Cubic.Out', onComplete: () => shard.destroy() });
      }
    }
  }
  new Phaser.Game({ type: Phaser.CANVAS, parent: 'phaserCanvas', width: 900, height: 300, transparent: true, scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: CombatScene, render: { antialias: false, pixelArt: true } });
}

function api(path, options = {}) {
  return fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `REQUEST_${response.status}`);
    return data;
  });
}

function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }
function setConnection(label, active = false) { $('connectionState').textContent = label; document.querySelector('.status-dot').style.background = active ? '#a7bd79' : '#8d6d52'; }
function setAura(element, aura) { element.textContent = auraNames[aura] || aura; element.className = `aura-chip aura-${aura}`; }

function renderTower() {
  const { progress, boss } = state.tower;
  const profile = Array.isArray(progress.users) ? progress.users[0] : progress.users;
  state.nickname = profile?.display_name || state.nickname;
  if (state.nickname) {
    localStorage.setItem('soulForgeNickname', state.nickname);
    setConnection(`접속됨: ${state.nickname}`, true);
  }
  $('currentFloor').textContent = String(progress.current_floor).padStart(2, '0');
  $('highestFloor').textContent = `최고 기록 ${profile?.highest_floor ?? 0}층`;
  $('shardCount').textContent = `${profile?.soul_shards ?? 0} 영혼 파편`;
  $('floorProgress').style.width = `${Math.min(92, 14 + (progress.current_floor % 10) * 7)}%`;
  $('bossName').textContent = boss.name;
  setAura($('bossAura'), boss.aura);
  $('bossPattern').textContent = boss.aura === 'ember' ? '잔화 폭발' : boss.aura === 'tide' ? '쇄도하는 파문' : '절단 돌풍';
  $('bossHp').textContent = `${boss.hp} HP`;
  $('bossReward').textContent = `+${boss.reward_shards} 파편`;
  $('bossNote').textContent = `성질: ${auraKorean[boss.aura]} / 공격력 ${boss.attack} / 전투력 ${boss.base_power}`;
  if (state.selectedItem) updateLoadoutReadout();
}

function itemCard(item) {
  const selected = state.selectedItem?.id === item.id ? ' selected' : '';
  const soul = item.absolute_soul ? ` · ${item.absolute_soul.label}` : '';
  return `<button class="item-card${selected}" data-item-id="${item.id}"><span class="rarity">${item.rarity}<span class="grade-mark grade-${item.forge_grade || 'C'}">${item.forge_grade || 'C'}</span></span><div class="item-name">${escapeHtml(item.name)}</div><div class="item-meta">${auraKorean[item.aura]} · LV.${item.level}</div><div class="item-stats">POW ${item.power} · ATK ${item.stat_options?.attack ?? 0} · DEF ${item.stat_options?.defense ?? 0}${escapeHtml(soul)}</div></button>`;
}

function renderItems() {
  const grid = $('itemGrid');
  if (!state.items.length) { grid.innerHTML = '<div class="empty-state">보유 중인 아이템이 없습니다.</div>'; return; }
  grid.innerHTML = state.items.map(itemCard).join('');
  grid.querySelectorAll('[data-item-id]').forEach((card) => card.addEventListener('click', () => {
    state.selectedItem = state.items.find((item) => item.id === card.dataset.itemId);
    renderItems(); updateLoadoutReadout();
  }));
}

function updateLoadoutReadout() {
  const item = state.selectedItem;
  if (!item || !state.tower) return;
  $('selectedLoadout').textContent = `${item.name} · POW ${item.power}`;
  const multiplier = item.aura === state.tower.boss.aura ? 1 : advantage[item.aura] === state.tower.boss.aura ? 1.25 : 0.85;
  $('counterReadout').textContent = multiplier === 1.25 ? '유리 상성 · 1.25x' : multiplier === 0.85 ? '불리 상성 · 0.85x' : '중립 상성 · 1.0x';
  $('counterReadout').style.color = multiplier === 1.25 ? '#dca56f' : multiplier === 0.85 ? '#a4a9b3' : '#9ba77d';
  $('challengeButton').disabled = state.busy === true;
  $('forgeButton').disabled = state.busy === true;
}

function renderLeaderboard() {
  const list = $('rankingList');
  if (!state.leaderboard.length) { list.innerHTML = '<div class="empty-state">아직 기록을 등록한 대장장이가 없습니다.</div>'; return; }
  list.innerHTML = state.leaderboard.map((entry, index) => {
    const loadout = entry.loadout || {};
    const aura = auraKorean[loadout.aura] || '미정';
    const self = entry.user_id === currentUserId() ? ' is-self' : '';
    return `<button class="rank-row${self}" data-rank-id="${escapeHtml(entry.user_id)}"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="rank-avatar" style="filter:hue-rotate(${(entry.avatar_seed || '').length * 17}deg)"></span><span class="rank-copy"><span class="rank-name">${escapeHtml(entry.display_name)}</span><span class="rank-meta">${escapeHtml(loadout.name || '대표 세팅 미등록')} · ${aura}</span></span><span class="rank-aura aura-${loadout.aura || 'ember'}">${auraNames[loadout.aura] || '—'}</span><span class="rank-floor">${entry.highest_floor}<small>FLOOR</small></span></button>`;
  }).join('');
  list.querySelectorAll('[data-rank-id]').forEach((row) => row.addEventListener('click', () => openLoadout(row.dataset.rankId)));
}

async function loadLeaderboard() {
  try { const result = await api('/v1/leaderboard?limit=20'); state.leaderboard = result.entries || []; renderLeaderboard(); }
  catch (error) { $('rankingList').innerHTML = `<div class="empty-state">랭킹을 불러오지 못했습니다: ${escapeHtml(error.message)}</div>`; }
}

function openLoadout(userId) {
  const entry = state.leaderboard.find((item) => item.user_id === userId); if (!entry) return;
  const loadout = entry.loadout || {};
  $('dialogEyebrow').textContent = 'RESEARCH LOADOUT';
  $('dialogName').textContent = entry.display_name;
  $('dialogFloor').textContent = `최고 도달 ${entry.highest_floor}층 · ${auraKorean[loadout.aura] || '성질 미정'} 성질`;
  $('dialogLoadout').innerHTML = `<div class="loadout-detail"><strong>${escapeHtml(loadout.name || '이름 없는 장비')}</strong><div class="detail-line"><span>등급 / 레벨</span><span>${escapeHtml(loadout.rarity || '—')} / LV.${escapeHtml(loadout.level || '—')}</span></div><div class="detail-line"><span>기본 전투력</span><span>${escapeHtml(loadout.power || 0)}</span></div><div class="detail-line"><span>능력치 조합</span><span>ATK ${escapeHtml(loadout.stat_options?.attack || 0)} · DEF ${escapeHtml(loadout.stat_options?.defense || 0)}</span></div>${loadout.absolute_soul ? `<div class="detail-line soul-detail"><span>앱솔루트 소울</span><span>${escapeHtml(loadout.absolute_soul.label)} · +${escapeHtml(loadout.absolute_soul.damage_percent)}%</span></div>` : '<div class="detail-line"><span>앱솔루트 소울</span><span>미각성</span></div>'}</div>`;
  $('loadoutDialog').showModal();
}

async function initRealtime() {
  if (!supabaseClient) return;
  try {
    state.realtime = supabaseClient.channel('global-leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_profiles' }, () => loadLeaderboard())
      .subscribe();
  } catch { showToast('실시간 랭킹 연결을 사용할 수 없습니다.'); }
}

async function initSupabase() {
  if (!window.supabase) throw new Error('SUPABASE_CLIENT_UNAVAILABLE');
  const config = await fetch('/v1/config').then((response) => response.json());
  supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
  const sessionResult = await supabaseClient.auth.getSession();
  if (sessionResult.error) throw sessionResult.error;
  if (sessionResult.data.session) {
    state.token = sessionResult.data.session.access_token;
    return true;
  }
  return false;
}

async function createAnonymousAccount(displayName) {
  const auth = await supabaseClient.auth.signInAnonymously({ options: { data: { display_name: displayName } } });
  if (auth.error || !auth.data.session) throw auth.error || new Error('ANONYMOUS_SIGN_IN_FAILED');
  state.token = auth.data.session.access_token;
  const profile = await api('/v1/profile', { method: 'POST', body: JSON.stringify({ display_name: displayName }) });
  state.nickname = profile.profile.display_name;
  localStorage.setItem('soulForgeNickname', state.nickname);
}

async function bootstrap() {
  try {
    const restored = await initSupabase();
    if (!restored) {
      $('welcomeDialog').showModal();
      return;
    }
    setConnection(`접속됨: ${state.nickname || '대장장이'}`, true);
    await Promise.all([loadLeaderboard(), initRealtime(), loadData()]);
  } catch (error) {
    setConnection('접속할 수 없음');
    showToast(error.message === 'SUPABASE_CLIENT_UNAVAILABLE' ? '인증 모듈을 불러오지 못했습니다.' : '접속 준비에 실패했습니다.');
  }
}

async function loadData() {
  if (!state.token) return;
  setConnection('동기화 중');
  try {
    const [items, tower] = await Promise.all([api('/v1/items'), api('/v1/tower/state')]);
    const selectedId = state.selectedItem?.id;
    state.items = items.items || []; state.tower = tower; state.selectedItem = state.items.find((item) => item.id === selectedId) || state.items[0] || null;
    renderTower(); renderItems(); updateLoadoutReadout(); setConnection('서버 연결됨', true);
  } catch (error) { setConnection('연결 실패'); showToast(error.message === 'INVALID_TOKEN' ? '토큰이 유효하지 않습니다.' : `동기화 실패: ${error.message}`); }
}

async function reforge() {
  if (!state.selectedItem || state.busy) return;
  state.busy = true; updateLoadoutReadout(); $('forgeButton').textContent = '재련 중…';
  try {
    const result = await api('/v1/items/reforge', { method: 'POST', body: JSON.stringify({ item_id: state.selectedItem.id }) });
    const grade = result.forge_grade || 'C';
    $('dialogEyebrow').textContent = grade === 'SS' ? 'VOID FORGE / RARE EVENT' : grade === 'S' ? 'GOLD FORGE / RARE EVENT' : 'FORGE RESULT';
    $('dialogName').textContent = state.selectedItem.name;
    $('dialogFloor').textContent = `재련 비용 ${result.cost} 파편 · 남은 자원 ${result.soul_shards}`;
    $('dialogLoadout').innerHTML = `<div class="forge-result"><div class="result-grade grade-${grade}">${grade}</div><div class="result-label">FORGE GRADE</div><div class="result-stats">전투력 +${result.power - state.selectedItem.power} · ATK ${result.stat_options.attack} · DEF ${result.stat_options.defense}${result.absolute_soul ? `<br><span class="soul-detail">${escapeHtml(result.absolute_soul.label)} · +${result.absolute_soul.damage_percent}%</span>` : ''}</div></div>`;
    $('loadoutDialog').showModal();
    await loadData();
  } catch (error) { showToast(error.message === 'INSUFFICIENT_SOUL_SHARDS' ? '영혼 파편이 부족합니다.' : `재련 실패: ${error.message}`); }
  finally { state.busy = false; $('forgeButton').textContent = '선택 장비 재련'; updateLoadoutReadout(); }
}

async function challenge() {
  if (!state.selectedItem || !state.tower || state.busy) return;
  state.busy = true; updateLoadoutReadout(); const button = $('challengeButton'); button.textContent = '전투 계산 중…';
  try {
    const result = await api('/v1/tower/challenge', { method: 'POST', body: JSON.stringify({ floor: state.tower.progress.current_floor, item_id: state.selectedItem.id }) });
    playCombat(result);
    setTimeout(() => { loadData(); loadLeaderboard(); }, result.won ? 1200 : 900);
  } catch (error) { showToast(error.message === 'INVALID_FLOOR' ? '탑 진행 상태가 변경되었습니다. 새로고침합니다.' : `도전 실패: ${error.message}`); await loadData(); }
  finally { setTimeout(() => { state.busy = false; button.innerHTML = '도전 시작 <span>↗</span>'; updateLoadoutReadout(); }, 1100); }
}

function playCombat(result) {
  const arena = $('battlefield').querySelector('.arena'); const caption = $('combatCaption');
  arena.classList.remove('playing', 'victory'); void arena.offsetWidth; arena.classList.add('playing');
  if (result.aura_multiplier > 1) { caption.textContent = 'PERFECT STRIKE'; $('battleTitle').textContent = '상성의 틈을 정확히 꿰뚫었습니다'; }
  else { caption.textContent = result.won ? 'BREACH CONFIRMED' : 'IMPACT REGISTERED'; $('battleTitle').textContent = result.won ? '보스의 방어선이 무너집니다' : '공격을 분석했지만, 탑은 버텼습니다'; }
  $('battleSubtitle').textContent = `피해량 ${result.damage} · 전투 마진 ${result.combat_margin}`;
  phaserScene?.triggerImpact(result.won);
  if (result.won) { arena.classList.add('victory'); showToast(`층 돌파 성공 · +${result.state?.soul_shards ?? ''} 영혼 파편`); }
}

initPhaser();
$('challengeButton').addEventListener('click', challenge);
$('forgeButton').addEventListener('click', reforge);
$('refreshButton').addEventListener('click', loadData);
$('dialogClose').addEventListener('click', () => $('loadoutDialog').close());
$('dialogForge').addEventListener('click', () => { $('loadoutDialog').close(); document.querySelector('.loadout-section').scrollIntoView({ behavior: 'smooth' }); });
$('welcomeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('nicknameInput');
  const errorBox = $('welcomeError');
  const displayName = input.value.trim();
  if (displayName.length < 2 || displayName.length > 20) { errorBox.textContent = '닉네임은 2–20자로 입력해 주세요.'; return; }
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true; errorBox.textContent = '';
  try {
    await createAnonymousAccount(displayName);
    $('welcomeDialog').close();
    setConnection(`접속됨: ${state.nickname}`, true);
    await Promise.all([loadLeaderboard(), initRealtime(), loadData()]);
  } catch (error) {
    errorBox.textContent = error.message.includes('Anonymous') ? '익명 로그인이 비활성화되어 있습니다.' : '접속에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  } finally { submit.disabled = false; }
});
bootstrap();
