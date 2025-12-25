/*
  Character ability module for export_id "44" (Ike)
  Exports:
    - getParsedAbility(ability, actor, battle)
    - decideAction(actor, enemies, allies, battle)
    - executeAction(battle, actor, decision, parsed)
    - updatePassives(actor, dt)
*/

function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export async function getParsedAbility(ability, actor, battle){
  const name = (ability && ability.name || '').toLowerCase();

  if (name.includes('kick the baby')) {
    return {
      typeCategory: 'skill',
      element: 'physical',
      baseDmg: 60,
      scalePct: 0.35,
      scaleStat: 'atk',
      targeting: 'single',
      castRange: 6,
      grantsBuffToLaunched: { buff_speed: 0.15, buff_atk: 0.15, duration: 3 },
      visualKeyword: 'proj_sword',
      cooldown: 8
    };
  }

  if (name.includes("don't kick the baby") || name.includes('punt')) {
    return {
      typeCategory: 'skill',
      element: 'magic',
      baseDmg: 80,
      scalePct: 0.4,
      scaleStat: 'magicAtk',
      targeting: 'dash',
      maxRange: 300,
      onAllyCollision: { allyBuffSpeedPct: 0.15, duration: 3 },
      onEnemyCollision: { knockback: 120 },
      grantsChildlikeChaos: 1,
      visualKeyword: 'vfx_slash_heavy',
      cooldown: 10
    };
  }

  if (name.includes('cookie monster')) {
    return {
      typeCategory: 'skill',
      element: 'magic',
      targeting: 'cone',
      coneRadius: 220,
      baseDmg: 0,
      scalePct: 0.1,
      scaleStat: 'magicAtk',
      debuffDuration: 4,
      debuffs: ['silence','blind','poison','slow'],
      poisonPerSecBase: 30,
      grantsChildlikeChaos: 1,
      visualKeyword: 'vfx_poison_cloud',
      cooldown: 14
    };
  }

  if (name.includes('kindergartner genius')) {
    return {
      typeCategory: 'passive',
      mechanics: {
        magicAtkPct: 0.20, // baseline
        stackInterval: 10,
        maxCalculatedChaos: 5,
        consumeAllOnUse: true
      }
    };
  }

  if (name.includes('canadian knight') || name.includes('for the princess')) {
    return {
      typeCategory: 'ultimate',
      element: 'magic',
      duration: 15,
      moveSpeedPct: 0.30,
      auraHealPctPerSec: 0.03,
      auraDebuffInterval: 3,
      consumesChildlikeChaos: true,
      visualKeyword: 'vfx_holy_light',
      cooldown: 120
    };
  }

  if (name.includes('childlike chaos')) {
    return {
      typeCategory: 'signature',
      mechanics: {
        gainPerAbility: 1,
        triggerAt: 10,
        tenacityPenaltyPct: 0.10,
        evasionPenaltyPct: 0.05
      }
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const live = (enemies||[]).filter(e=>!e.isDead);
  if (!live.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('canadian knight');
  const cookie = find('cookie monster');
  const punt = find("don't kick the baby") || find('punt');
  const kick = find('kick the baby');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when energy full or many enemies present
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (live.length >= 3) return { ability: ult, type: 'ultimate', targets: live.slice(0,6) };
  }

  // Cookie Monster: use when at least 2 enemies in front cone
  if (cookie && !actor.cooldownTimers?.[cookie.name]) {
    const center = live[0];
    const count = live.filter(e=>Math.hypot(e.x - actor.x, e.y - actor.y) <= (cookie.coneRadius || 220)).length;
    if (count >= 2) return { ability: cookie, type: 'skill', targets: [center] };
  }

  // Punt (dash) for mobility / engage: use if low mobility or to close gap
  if (punt && !actor.cooldownTimers?.[punt.name]) {
    const nearest = live[0];
    if (nearest) {
      const dist = Math.hypot(nearest.x - actor.x, nearest.y - actor.y);
      if (dist > 180 || (actor.currentHp / actor.maxHp) > 0.6 && live.length > 1) {
        return { ability: punt, type: 'skill', targets: [nearest] };
      }
    }
  }

  // Kick the Baby: target enemy but prefer launching an ally if one is nearby
  if (kick && !actor.cooldownTimers?.[kick.name]) {
    // find allied candidate closest to Ike
    const ally = (allies||[]).filter(a=>!a.isDead && a.id !== actor.id).sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    const tgt = live[0];
    if (ally && tgt) return { ability: kick, type: 'skill', targets: [tgt, ally] };
  }

  // fallback basic nearest
  return { ability: basic, type: 'basic', targets: [live[0]] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const live = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // small windup
  await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?420:160));

  // Kick the Baby: expected targets [enemy, ally]
  if (name.includes('kick the baby')) {
    const enemy = decision.targets && decision.targets[0] || live[0];
    const ally = decision.targets && decision.targets[1] || (friends.find(a=>!a.isDead && a.id!==actor.id) || null);
    if (!enemy) return;
    ui.showAbilityName(actor, "Kick the Baby");
    ui.playVfx(actor, 'vfx_slash');

    const atk = actor.effectiveAtk || actor.stats.atk || 17;
    const dmg = Math.floor((parsed.baseDmg || 60) + atk * (parsed.scalePct || 0.35));
    const res = enemy.receiveAction({ amount: dmg, type: 'physical', element: parsed.element || 'physical', attackerAccuracy: 18 });
    ui.showFloatingText(enemy, res.amount, 'damage-number');

    if (ally) {
      // launch ally: reposition ally toward enemy and grant buff
      try {
        const dx = enemy.x - ally.x; const dy = enemy.y - ally.y; const dist = Math.hypot(dx,dy) || 1;
        const move = Math.min(200, Math.max(80, dist - 20));
        ally.x += (dx/dist) * move;
        ally.y += (dy/dist) * Math.max(0.1, move * 0.08);
      } catch (e){}
      const b = parsed.grantsBuffToLaunched || {};
      ally.applyStatus({ type: 'buff_speed', value: b.buff_speed || 0.15, duration: b.duration || 3, name: "Launched Speed" });
      ally.applyStatus({ type: 'buff_atk', value: b.buff_atk || 0.15, duration: b.duration || 3, name: "Launched ATK" });
      ui.showFloatingText(ally, 'LAUNCHED!', 'status-text buff');
    }

    // small energy gain
    actor.energy = Math.min(actor.maxEnergy, (actor.energy||0) + 12);
    actor.customResources = actor.customResources || {};
    actor.customResources['CalculatedChaos'] = actor.customResources['CalculatedChaos'] || 0;
    // Kindergartner Genius: gaining stacks handled in updatePassives but some abilities grant ChildlikeChaos explicitly
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  // Punt (Don't Kick the Baby!)
  if (name.includes("don't kick the baby") || name.includes('punt')) {
    const primary = decision.targets && decision.targets[0] || live[0];
    ui.showAbilityName(actor, "Don't Kick the Baby! (Punt)");
    // dash toward target
    try {
      const dx = primary.x - actor.x; const dy = primary.y - actor.y; const dist = Math.hypot(dx,dy) || 1;
      const dash = Math.min(parsed.maxRange || 300, Math.max(120, dist));
      actor.x += (dx/dist) * dash;
      actor.y += (dy/dist) * Math.max(0.1, dash * 0.08);
    } catch(e){}
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_slash_heavy');

    // damage enemies along path (approximate by tearing a line radius)
    const atk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 19;
    const dmg = Math.floor((parsed.baseDmg || 80) + atk * (parsed.scalePct || 0.4));
    const pathRadius = 60;
    const hits = enemies.filter(e => !e.isDead && Math.hypot(e.x - actor.x, e.y - actor.y) <= pathRadius);
    for (const t of hits) {
      const res = t.receiveAction({ amount: dmg, type: 'magic', element: 'magic', attackerAccuracy: 18 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // knockback if enemy hit
      try {
        const dx = t.x - actor.x; const dy = t.y - actor.y; const d = Math.hypot(dx,dy)||1;
        t.x += Math.round((dx/d) * 120);
        t.y += Math.round((dy/d) * 40);
      } catch(e){}
    }

    // if collides with ally anywhere in path give both speed buff
    const allyHit = friends.find(a => !a.isDead && Math.hypot(a.x - actor.x, a.y - actor.y) <= pathRadius);
    if (allyHit) {
      allyHit.applyStatus({ type: 'buff_speed', value: parsed.onAllyCollision?.allyBuffSpeedPct || 0.15, duration: parsed.onAllyCollision?.duration || 3 });
      actor.applyStatus({ type: 'buff_speed', value: parsed.onAllyCollision?.allyBuffSpeedPct || 0.15, duration: parsed.onAllyCollision?.duration || 3 });
      ui.showFloatingText(allyHit, 'PUNT BUFF', 'status-text buff');
    }

    // grant Childlike Chaos
    actor.customResources = actor.customResources || {};
    actor.customResources['ChildlikeChaos'] = (actor.customResources['ChildlikeChaos'] || 0) + (parsed.grantsChildlikeChaos || 1);

    // At higher upgrades, if colliding with ally grant shield - best-effort detection handled in parsed upgrades externally.
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  // Cookie Monster! (cone with random debuffs)
  if (name.includes('cookie monster')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    ui.showAbilityName(actor, "Cookie Monster!");
    ui.playVfx(center, parsed.visualKeyword || 'vfx_poison_cloud');
    const coneRadius = parsed.coneRadius || 220;
    const candidates = enemies.filter(e => !e.isDead && Math.hypot(e.x - actor.x, e.y - actor.y) <= coneRadius);
    for (const t of candidates) {
      // damage tick (small immediate)
      const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 19;
      const baseDps = parsed.poisonPerSecBase || 30;
      const res = t.receiveAction({ amount: Math.floor(matk * (parsed.scalePct || 0.1)), type: 'magic', element: 'magic', attackerAccuracy: 16 });
      ui.showFloatingText(t, res.amount, 'damage-number');
      // randomly pick one debuff equally
      const debuffs = parsed.debuffs || ['silence','blind','poison','slow'];
      const pick = debuffs[Math.floor(Math.random() * debuffs.length)];
      if (pick === 'poison') {
        const perSec = Math.floor((parsed.poisonPerSecBase || 30) + (actor.effectiveMagicAtk || actor.stats['magic atk'] || 19) * 0.1);
        t.applyStatus({ type: 'poison', duration: parsed.debuffDuration || 4, value: perSec, tickInterval: 1 });
        ui.showFloatingText(t, 'POISON', 'status-text');
      } else if (pick === 'silence') {
        t.applyStatus({ type: 'silence', duration: parsed.debuffDuration || 4 });
        ui.showFloatingText(t, 'SILENCED', 'status-text');
      } else if (pick === 'blind') {
        t.applyStatus({ type: 'blind', duration: parsed.debuffDuration || 4, value: 0.35 });
        ui.showFloatingText(t, 'BLIND', 'status-text');
      } else if (pick === 'slow') {
        t.applyStatus({ type: 'debuff_speed', duration: parsed.debuffDuration || 4, value: 0.30 });
        ui.showFloatingText(t, 'SLOWED', 'status-text');
      }
      // grant Childlike Chaos per hit
      actor.customResources = actor.customResources || {};
      actor.customResources['ChildlikeChaos'] = (actor.customResources['ChildlikeChaos'] || 0) + (parsed.grantsChildlikeChaos || 1);
      await new Promise(r=>setTimeout(r, 90));
    }
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 14;
    return;
  }

  // Kindergartner Genius & passive effects are handled in updatePassives

  // Canadian Knight ultimate
  if (name.includes('canadian knight') || decision.type === 'ultimate') {
    ui.showAbilityName(actor, "Canadian Knight: For the Princess!");
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_holy_light');
    // Transform flags
    actor.customResources = actor.customResources || {};
    actor.customResources['CanadianKnightActive'] = parsed.duration || 15;
    // apply movement speed
    actor.applyStatus({ type: 'buff_speed', value: parsed.moveSpeedPct || 0.30, duration: parsed.duration || 15 });
    // apply aura heal ticks and periodic debuff to enemies
    const dur = parsed.duration || 15;
    const ticks = Math.floor(dur / (parsed.auraDebuffInterval || 3));
    let tick = 0;
    const auraLoop = setInterval(() => {
      tick++;
      // heal allies in radius
      const radius = 300;
      const alliesIn = friends.filter(a => !a.isDead && Math.hypot(a.x - actor.x, a.y - actor.y) <= radius);
      for (const a of alliesIn) {
        const heal = Math.floor((a.maxHp || a.stats['max hp'] || 400) * (parsed.auraHealPctPerSec || 0.03));
        a.receiveAction && a.receiveAction({ amount: heal, effectType: 'heal' });
        ui.showFloatingText(a, `+${heal}`, 'damage-number heal');
      }
      // apply cookie-like random debuff to enemies in radius
      const enemiesIn = enemies.filter(e => !e.isDead && Math.hypot(e.x - actor.x, e.y - actor.y) <= radius);
      for (const t of enemiesIn) {
        const debuffs = ['silence','blind','poison','slow'];
        const pick = debuffs[Math.floor(Math.random() * debuffs.length)];
        if (pick === 'poison') t.applyStatus({ type:'poison', duration: parsed.debuffDuration || 4, value: Math.floor(30 + (actor.effectiveMagicAtk || actor.stats['magic atk'] || 19) * 0.1) });
        else if (pick === 'silence') t.applyStatus({ type:'silence', duration: parsed.debuffDuration || 4 });
        else if (pick === 'blind') t.applyStatus({ type:'blind', duration: parsed.debuffDuration || 4, value: 0.35 });
        else t.applyStatus({ type:'debuff_speed', duration: parsed.debuffDuration || 4, value: 0.30 });
        ui.showFloatingText(t, pick.toUpperCase(), 'status-text');
      }
      if (tick >= ticks) {
        clearInterval(auraLoop);
        // consume Childlike Chaos stacks for amplified effects
        const stacks = actor.customResources['ChildlikeChaos'] || 0;
        if (stacks >= 5) {
          // grant allies damage buff
          friends.filter(a=>!a.isDead && Math.hypot(a.x-actor.x,a.y-actor.y) <= 300).forEach(a => {
            a.applyStatus({ type:'buff_atk', value: 0.15, duration: dur });
            ui.showFloatingText(a, 'DMG+ (Stacks)', 'status-text buff');
          });
        }
        if (stacks >= 10) {
          // enemies take increased damage
          enemies.filter(e=>!e.isDead && Math.hypot(e.x-actor.x,e.y-actor.y) <= 300).forEach(e => {
            e.applyStatus({ type:'vulnerability_stack', stacks:1, value: 0.10, duration: dur });
            ui.showFloatingText(e, 'TAKEN+10%', 'status-text weakness');
          });
        }
        actor.customResources['ChildlikeChaos'] = 0;
      }
    }, (parsed.auraDebuffInterval || 3) * 1000 / Math.max(0.2, (battle.battleSpeed || 1)));
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 120;
    return;
  }

  // Fallback: no-op
  return;
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};
  actor.passiveModifiers = actor.passiveModifiers || {};

  // Kindergartner Genius: Magic ATK baseline + Calculated Chaos stack timer
  const passive = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('kindergartner genius'));
  const mechanics = passive ? (passive.mechanics || {}) : {};
  actor.passiveModifiers.magicAtkFlatPct = mechanics.magicAtkPct || 0.20;

  // Gain Calculated Chaos every X seconds (defaults 10)
  actor._calculatedTimer = (actor._calculatedTimer || 0) + dt;
  const interval = mechanics.stackInterval || 10;
  if (actor._calculatedTimer >= interval) {
    actor._calculatedTimer = 0;
    actor.customResources['CalculatedChaos'] = Math.min(mechanics.maxCalculatedChaos || 5, (actor.customResources['CalculatedChaos'] || 0) + 1);
  }

  // When an ability is used, engine will consume stacks via executeAction hooks; however if a manual trigger exists, allow external consumption
  // Ensure ChildlikeChaos and CalculatedChaos bounded and decayable
  for (const k of ['ChildlikeChaos','CalculatedChaos']) {
    if (!actor.customResources[k]) actor.customResources[k] = actor.customResources[k] || 0;
    actor.resourceDecayTimers[k] = actor.resourceDecayTimers[k] || 0;
    if (actor.resourceDecayTimers[k] > 0) actor.resourceDecayTimers[k] = Math.max(0, actor.resourceDecayTimers[k] - dt);
    else if (actor.customResources[k] > 0) actor.customResources[k] = Math.max(0, actor.customResources[k] - (0.02 * dt)); // slow decay
  }

  // Signature Childlike Chaos persona trigger detection
  if ((actor.customResources['ChildlikeChaos'] || 0) >= 10 && !actor._chaosTriggerCooldown) {
    actor._chaosTriggerCooldown = 6.0; // prevent immediate re-trigger
    // Choose random persona
    const persona = pickRandom(['tantrum','pirate','gizmo']);
    const battle = actor.battleSystem;
    if (persona === 'tantrum') {
      // fear nearby enemies
      const enemies = battle ? (actor.team==='ally' ? battle.enemies : battle.allies) : [];
      enemies.filter(e=>!e.isDead && Math.hypot(e.x-actor.x,e.y-actor.y)<=260).forEach(e => e.applyStatus({ type:'fear', duration: 1.5 }));
    } else if (persona === 'pirate') {
      // summon 2 ghost pirates as simple transient enemies attacking nearby foes
      const enemies = battle ? (actor.team==='ally' ? battle.enemies : battle.allies) : [];
      // approximate by applying damage ticks to random enemies
      for (let i=0;i<2;i++){
        const t = pickRandom(enemies.filter(e=>!e.isDead));
        if (!t) continue;
        const dmg = 30 + Math.floor((actor.stats.atk || 17) * 0.1);
        t.receiveAction && t.receiveAction({ amount: dmg, type:'physical' });
        battle.uiManager && battle.uiManager.showFloatingText(t, dmg, 'damage-number');
      }
    } else if (persona === 'gizmo') {
      // spawn a gremlin clone: simplified as a temporary buff that deals extra damage via a status
      actor.applyStatus({ type:'gizmo_clone', duration: 5, value: 0.5, name: 'Gizmo Clone' });
    }
    // apply penalties per signature: reduce tenacity/evasion temporarily
    actor.applyStatus({ type:'debuff_tenacity', value: -(0.10), duration: 6 });
    actor.applyStatus({ type:'debuff_evasion', value: -(0.05), duration: 6 });
    actor.customResources['ChildlikeChaos'] = 0;
  }

  // Chaos trigger cooldown tick
  if (actor._chaosTriggerCooldown > 0) {
    actor._chaosTriggerCooldown = Math.max(0, actor._chaosTriggerCooldown - dt);
  }
}