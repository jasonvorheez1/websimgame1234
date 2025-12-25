/*
  Character ability module for export_id "34" (Roll) - Buffed "make her strong" revision
  Exports:
    - getParsedAbility(ability, actor, battle)
    - decideAction(actor, enemies, allies, battle)
    - executeAction(battle, actor, decision, parsed)
    - updatePassives(actor, dt)
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name||'').toLowerCase();
  if(name.includes('sweeping volley') || name.includes('roll buster')){
    return {
      typeCategory:'basic',
      baseDmg: 0,
      scalePct: 0.65, // beefed up from 0.35
      scaleStat: 'atk',
      element: 'magic',
      targeting: 'arc',
      multiProj: 3,
      procTokensPerEnemy: 1,
      visualKeyword: 'proj_fire',
      cooldown: 1.8
    };
  }

  if(name.includes('shield strike') || name.includes('helper\'s dash')){
    return {
      typeCategory:'skill',
      baseDmg: 0,
      scalePct: 0.55, // increased magic scaling
      scaleStat: 'magicAtk',
      element: 'magic',
      targeting: 'single',
      flatHpPercentDmg: 0.18, // increased from 12%
      tokenCost: 2,
      shieldPctMaxHp: 0.25, // buffed shield to 25%
      shieldDur: 3,
      compromisedPct: 0.12, // increased vulnerability
      compromisedDur: 8,
      visualKeyword: 'vfx_sword',
      cooldown: 8
    };
  }

  if(name.includes('swift enhancement') || name.includes('dust & polish')){
    return {
      typeCategory:'skill',
      baseBuffPct: 0.28, // +28% ATK (buffed from 20%)
      duration: 6,       // longer duration
      tokenCost: 3,
      guaranteeNextCrit: true,
      visualKeyword: 'vfx_buff',
      cooldown: 14
    };
  }

  if(name.includes('errand dynamo')){
    return {
      typeCategory:'passive',
      passiveInterval: 12, // faster passive generation
      maxTokens: 7,        // bigger storage
      assistGain: 2,       // more tokens on assist
      visualKeyword: 'vfx_starlight'
    };
  }

  if(name.includes('super helper mode') || name.includes('ultimate')){
    return {
      typeCategory:'ultimate',
      duration: 12, // longer duration
      tokenGainOnCast: 3,
      tokenCostReduction: 1,
      healPctPerSec: 0.035, // 3.5% max HP per sec (buffed)
      radius: 350,
      visualKeyword: 'vfx_heal',
      cooldown: 90
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  const liveAllies = (allies||[]).filter(a=>!a.isDead && a !== actor);

  const find = q => (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes(q));
  const basic = actor.data.abilities?.find(a => (a.type||'').toLowerCase().includes('basic')) || { name: 'Roll Buster: Sweeping Volley' };
  const dash = find('helper\'s dash') || find('shield strike');
  const buff = find('dust & polish') || find('swift enhancement');
  const ult = find('super helper mode') || find('ultimate');
  const passive = find('errand dynamo');

  // Use ultimate when available or when allies are low
  if (actor.energy >= (actor.maxEnergy || 100) && ult && !actor.cooldownTimers?.[ult.name]) {
    return { ability: ult, type: 'ultimate', targets: liveAllies.slice(0,5) };
  }

  // If allies are critically low, dash to create shield and disrupt
  if (dash && !actor.cooldownTimers?.[dash.name]) {
    const lowAlly = liveAllies.find(a => (a.currentHp / a.maxHp) < 0.45);
    if (lowAlly || (liveEnemies.length && liveAllies.some(a => (a.currentHp/a.maxHp) < 0.75))) {
      // target closest enemy to low ally or highest threat
      const target = liveEnemies.sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0] || liveEnemies[0];
      if (target) return { ability: dash, type: 'skill', targets: [target] };
    }
  }

  // If tokens are abundant and allies have burst windows, use Dust & Polish
  const tokens = Math.floor(actor.getResource ? actor.getResource('Errand Token') : (actor.customResources?.['Errand Token']||0));
  if (buff && tokens >= 3 && liveAllies.length) {
    // pick ally with highest pwr to maximize burst synergy
    const ally = liveAllies.sort((a,b)=> (b.stats.atk + b.stats['magic atk']) - (a.stats.atk + a.stats['magic atk']))[0];
    if (ally) return { ability: buff, type: 'skill', targets: [ally] };
  }

  // Otherwise use basic volley for multi-hit and token generation
  return { ability: basic, type: 'basic', targets: liveEnemies.length ? [liveEnemies[0]] : [] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);

  const name = (decision.ability.name||'').toLowerCase();
  const tokens = Math.floor(actor.getResource ? actor.getResource('Errand Token') : (actor.customResources?.['Errand Token']||0));

  // Windup
  await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?420:160));

  // BASIC: Sweeping Volley (multi-projectile)
  if (name.includes('sweeping volley') || name.includes('roll buster')){
    if (!liveEnemies.length) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 20;
    const projCount = parsed.multiProj || 3;
    const perProjPct = parsed.scalePct || 0.65;
    const hits = new Set();
    for (let p=0;p<projCount;p++){
      // each projectile hits first enemy in arc; simplified as random enemy among nearest 3
      const target = pickRandom(liveEnemies.slice(0, Math.min(3, liveEnemies.length)));
      if (!target) continue;
      const dmg = Math.floor(atk * perProjPct);
      const res = target.receiveAction({ amount: dmg, type:'magic', element: parsed.element || 'magic', attackerAccuracy: 18 });
      ui.showFloatingText(target, res.amount, 'damage-number');
      ui.playVfx(target, 'proj_fire');
      hits.add(target.id);
      await new Promise(r=>setTimeout(r, 120));
    }
    // For each unique enemy hit, grant an Errand Token (cap handled in passive)
    const gained = hits.size;
    for (let i=0;i<gained;i++) actor.addResource && actor.addResource('Errand Token', 1, parsedErrandCap(actor, parsed));
    return;
  }

  // HELPER'S DASH: Shield Strike
  if (name.includes('shield strike') || name.includes('helper\'s dash')){
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    // consume tokens
    const cost = parsed.tokenCost || 2;
    const consumed = consumeErrandTokens(actor, cost);
    // dash damage: magic scaling + % of target current HP
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 20;
    const dmgFromMatk = Math.floor(matk * (parsed.scalePct || 0.55));
    const dmgFromHp = Math.floor((t.currentHp || t.maxHp || 100) * (parsed.flatHpPercentDmg || 0.18));
    const totalDmg = dmgFromMatk + dmgFromHp;
    // reposition near target (simple nudge)
    try {
      const dx = t.x - actor.x; const dy = t.y - actor.y; const dist = Math.hypot(dx,dy)||1;
      actor.x = t.x - (dx/dist)*60;
      actor.y = t.y - (dy/dist)*8;
    } catch(e){}
    // apply damage
    const res = t.receiveAction({ amount: totalDmg, type:'magic', element: parsed.element || 'magic', attackerAccuracy: 20 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, 'vfx_sword');
    // create shield around actor
    const shieldAmt = Math.floor((actor.maxHp || actor.stats['max hp'] || 500) * (parsed.shieldPctMaxHp || 0.25));
    actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
    ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
    // apply Compromised debuff to target
    t.applyStatus({ type:'vulnerability_stack', stacks:1, value: parsed.compromisedPct || 0.12, duration: parsed.compromisedDur || 8 });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  // DUST & POLISH: Swift Enhancement
  if (name.includes('dust & polish') || name.includes('swift enhancement')){
    const ally = decision.targets && decision.targets[0] || (friends.find(f=>!f.isDead) || actor);
    const buffPct = parsed.baseBuffPct || 0.28;
    const dur = parsed.duration || 6;
    ally.applyStatus({ type:'buff_atk', value: buffPct, duration: dur });
    // guarantee next basic crit - store as custom resource/flag
    ally.customResources = ally.customResources || {};
    ally.customResources['GuaranteedNextCrit'] = (ally.customResources['GuaranteedNextCrit'] || 0) + 1;
    ui.showFloatingText(ally, `ATK +${Math.round(buffPct*100)}%`, 'status-text buff');
    ui.playVfx(ally, 'vfx_buff');
    // consume tokens
    consumeErrandTokens(actor, parsed.tokenCost || 3);
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 14;
    return;
  }

  // ERRAND DYNAMO passive handled in updatePassives (no active execution)
  if (name.includes('errand dynamo')) return;

  // ULTIMATE: Super Helper Mode
  if (name.includes('super helper mode') || decision.type === 'ultimate'){
    // grant tokens
    for (let i=0;i<(parsed.tokenGainOnCast||3);i++) actor.addResource && actor.addResource('Errand Token', 1, parsedErrandCap(actor, parsed));
    // reduce token cost flag (store temporary resource)
    actor.customResources = actor.customResources || {};
    actor.customResources['SuperHelperActive'] = parsed.duration || 12;
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
    actor.resourceDecayTimers['SuperHelperActive'] = parsed.duration || 12;
    // AOE heal over time applied as regen status to allies within radius (engine will propagate aura by applyStatus)
    friends.forEach(f => {
      const dist = Math.hypot((f.x||0) - (actor.x||0), (f.y||0) - (actor.y||0));
      if (dist <= (parsed.radius || 350)) {
        f.applyStatus({ type:'regen', percent: parsed.healPctPerSec || 0.035, duration: parsed.duration || 12 });
        ui.showFloatingText(f, 'HEALING', 'status-text buff');
      }
    });
    ui.playVfx(actor, 'vfx_heal');
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 90;
    return;
  }

  // Fallback: basic single hit on nearest enemy
  {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 20;
    const dmg = Math.floor((parsed.baseDmg || 12) + atk * (parsed.scalePct || 0.5));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'physical', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, 'slash');
  }
}

// Helpers for token handling
function parsedErrandCap(actor, parsed){
  const passive = actor.data.abilities?.find(a => (a.name||'').toLowerCase().includes('errand dynamo'));
  if (actor && actor.getResource) {
    // use passive override if present
    if (passive && passive.upgrades && passive.upgrades.includes('Increase maximum Errand Token storage to 7')) return 7;
  }
  return (parsed && parsed.maxTokens) ? parsed.maxTokens : 7;
}
function consumeErrandTokens(actor, amt){
  const cur = Math.floor(actor.getResource ? actor.getResource('Errand Token') : (actor.customResources?.['Errand Token']||0));
  const used = Math.min(cur, amt);
  if (actor.consumeResource) actor.consumeResource('Errand Token', used);
  else actor.customResources['Errand Token'] = Math.max(0, cur - used);
  return used;
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};

  // Errand Dynamo passive: generates tokens every passiveInterval seconds and grants assist tokens
  const passiveAbility = actor.data.abilities?.find(a => (a.name||'').toLowerCase().includes('errand dynamo'));
  const interval = passiveAbility ? (passiveAbility.upgrades && passiveAbility.upgrades.includes('Reduce passive Errand Token generation time to 12 seconds.') ? 12 : 15) : 15;
  const maxTokens = passiveAbility ? (passiveAbility.upgrades && passiveAbility.upgrades.includes('Increase maximum Errand Token storage to 7.') ? 7 : 5) : 7;

  actor._errandTimer = (actor._errandTimer || 0) + dt;
  if (actor._errandTimer >= interval) {
    actor._errandTimer = 0;
    actor.addResource && actor.addResource('Errand Token', 1, maxTokens);
  }

  // Assist detection: reward token if actor contributed to kill within window (simple decay tracker)
  // Decrement any AssistWindow counters
  if (actor._assistWindow) {
    actor._assistWindow = Math.max(0, actor._assistWindow - dt);
  }

  // If super helper active, reduce token costs implicitly by setting resource flag timer decay above
  if (actor.resourceDecayTimers['SuperHelperActive'] > 0) {
    actor.resourceDecayTimers['SuperHelperActive'] = Math.max(0, actor.resourceDecayTimers['SuperHelperActive'] - dt);
    actor.customResources['SuperHelperActive'] = Math.max(0, actor.customResources['SuperHelperActive'] - dt);
  }

  // Cap Errand Token to maxTokens
  actor.customResources['Errand Token'] = Math.min(maxTokens, actor.customResources['Errand Token'] || 0);
}