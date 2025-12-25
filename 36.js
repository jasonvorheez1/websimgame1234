/*
  Character ability module for export_id "36" (HIM)
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

  if (name.includes('basic attack')) {
    return {
      typeCategory: 'basic',
      baseDmg: 24,
      scalePct: 0.32,
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'single',
      visualKeyword: 'proj_fire',
      cooldown: 1.6
    };
  }

  if (name.includes('claw snap')) {
    return {
      typeCategory: 'skill',
      baseDmg: 1.0, // interpreted as atk * 1.0
      extraFirePct: 0.30, // +30% of atk as fire
      scaleStat: 'atk',
      element: 'fire',
      targeting: 'single',
      statuses: [{ type: 'burn', duration: 3, value: 0.05, tickInterval: 1 }],
      critBase: 0.05,
      visualKeyword: 'vfx_fire',
      cooldown: 8
    };
  }

  if (name.includes('cacophonous contradiction')) {
    return {
      typeCategory: 'skill',
      targeting: 'single',
      chooseHighestAtk: true,
      duration: 5,
      damageReductionPct: 0.30,
      applies: [{ type: 'dissonance', stacks: 1, duration: 8 }],
      endSilenceOnExpire: { duration: 1.5 },
      visualKeyword: 'vfx_music_notes',
      cooldown: 14
    };
  }

  if (name.includes('claw swipe')) {
    return {
      typeCategory: 'skill',
      targeting: 'cone',
      baseDmg: 80,
      scalePct: 0.40,
      scaleStat: 'magicAtk',
      element: 'magic',
      aoeRadius: 100,
      pushback: 120,
      applies: [{ type: 'dissonance', stacks: 1, duration: 6 }],
      visualKeyword: 'vfx_sword',
      cooldown: 10
    };
  }

  if (name.includes('omnipresence') || name.includes('passive')) {
    return {
      typeCategory: 'passive',
      mechanics: {
        perStatusMagicAtkPct: 0.05, // 5% per unique enemy status
        duration: 4,
        maxStacks: 5,
        allyHealOnDissonanceDamagePct: 0.03
      }
    };
  }

  if (name.includes('transformation') || name.includes('ultimate') || name.includes('unleash the inner demon')) {
    return {
      typeCategory: 'ultimate',
      duration: 15,
      magicAtkPct: 0.30,
      damageReductionPct: 0.20,
      shockwaveBase: 150,
      shockwaveScale: 0.6,
      stunPerStack: 0.25,
      visualKeyword: 'vfx_dark_bloom',
      cooldown: 120
    };
  }

  if (name.includes('diabolical decadence')) {
    return {
      typeCategory: 'passive',
      signature: true,
      dotScaleWithAtk: 0.02,
      dotDuration: 4,
      applyDebuffOnExpire: true,
      visualKeyword: 'vfx_dark_void'
    };
  }

  return null;
}

export async function decideAction(actor, enemies, allies, battle){
  const liveEnemies = (enemies||[]).filter(e=>!e.isDead);
  const liveAllies = (allies||[]).filter(a=>!a.isDead && a !== actor);
  if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };

  const find = q => (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes(q));
  const ult = find('transformation') || find('unleash the inner demon');
  const cac = find('cacophonous contradiction');
  const swipe = find('claw swipe');
  const claw = find('claw snap');
  const basic = (actor.data.abilities||[]).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

  // Use ultimate when full energy or when many dissonance stacks exist on field
  const totalDissonance = liveEnemies.reduce((s,e)=> s + (e.activeEffects.filter(x=>x.type==='dissonance').reduce((ss,st)=>ss + (st.stacks||1),0)),0);
  if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
    if (liveEnemies.length >= 3 || totalDissonance >= 3) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,6) };
  }

  // Cacophonous: target highest atk enemy to cripple DPS
  if (cac && !actor.cooldownTimers?.[cac.name]) {
    const byAtk = liveEnemies.slice().sort((a,b)=> (b.stats?.atk||0) - (a.stats?.atk||0));
    if (byAtk.length) return { ability: cac, type: 'skill', targets: [byAtk[0]] };
  }

  // Claw Swipe for crowd control when multiple enemies close
  if (swipe && !actor.cooldownTimers?.[swipe.name]) {
    for (const e of liveEnemies) {
      const cnt = liveEnemies.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= (swipe.aoeRadius || 100)).length;
      if (cnt >= 2) return { ability: swipe, type: 'skill', targets: [e] };
    }
  }

  // Claw Snap if single-target high priority
  if (claw && !actor.cooldownTimers?.[claw.name]) {
    const low = liveEnemies.slice().sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
    if (low) return { ability: claw, type: 'skill', targets: [low] };
  }

  // Fallback basic on nearest
  const nearest = liveEnemies.slice().sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
  return { ability: basic, type: 'basic', targets: [nearest] };
}

export async function executeAction(battle, actor, decision, parsed){
  if (!decision || !decision.ability) return;
  const ui = battle.uiManager;
  const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
  const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
  const liveEnemies = enemies.filter(e=>!e.isDead);
  const name = (decision.ability.name||'').toLowerCase();

  // windup
  await new Promise(r=>setTimeout(r, decision.type==='ultimate'?420:160));

  if (name.includes('basic attack')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 32;
    const dmg = Math.floor((parsed.baseDmg || 24) + atk * (parsed.scalePct || 0.32));
    const res = t.receiveAction({ amount: dmg, type:'physical', element: parsed.element || 'fire', attackerAccuracy: 18 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, parsed.visualKeyword || 'proj_fire');
    actor.energy = Math.min(actor.maxEnergy, (actor.energy||0) + 8);
    return;
  }

  if (name.includes('claw snap')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 32;
    const phys = Math.floor(atk * (parsed.baseDmg || 1.0));
    const fire = Math.floor(atk * (parsed.extraFirePct || 0.30));
    const res1 = t.receiveAction({ amount: phys, type:'physical', element:'physical', attackerAccuracy: 18 });
    const res2 = t.receiveAction({ amount: fire, type:'magic', element:'fire', attackerAccuracy: 18 });
    ui.showFloatingText(t, res1.amount + res2.amount, 'damage-number fire');
    t.applyStatus({ type:'burn', duration: 3, value: Math.max(1, Math.floor(t.maxHp * 0.05)), tickInterval: 1 });
    // small base crit handling: leave to battle receiveAction via attackerAccuracy if needed
    ui.playVfx(t, parsed.visualKeyword || 'vfx_fire');
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 8;
    return;
  }

  if (name.includes('cacophonous contradiction')) {
    // target highest atk (decision should provide target)
    const t = decision.targets && decision.targets[0] || liveEnemies.slice().sort((a,b)=>(b.stats?.atk||0)-(a.stats?.atk||0))[0];
    if (!t) return;
    // Apply damage reduction status that reduces outgoing damage
    t.applyStatus({ type:'debuff_outgoing_damage', duration: parsed.duration || 5, value: -(parsed.damageReductionPct || 0.30), name: 'Cacophony_DR' });
    // Apply dissonance
    t.applyStatus({ type:'dissonance', stacks: 1, duration: 8 });
    ui.showFloatingText(t, 'CACOPHONY', 'status-text');
    ui.playVfx(t, parsed.visualKeyword || 'vfx_music_notes');
    // If target uses damaging ability in window, the damage reduction is active (engine enforces)
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 14;
    return;
  }

  if (name.includes('claw swipe')) {
    const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
    const matk = actor.effectiveMagicAtk || actor.stats['magic atk'] || 25;
    const dmg = Math.floor((parsed.baseDmg || 80) + matk * (parsed.scalePct || 0.40));
    const inArea = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= (parsed.aoeRadius || 100));
    inArea.forEach(e => {
      const res = e.receiveAction({ amount: dmg, type:'magic', element: parsed.element || 'magic', attackerAccuracy: 18 });
      ui.showFloatingText(e, res.amount, 'damage-number');
      // pushback
      try {
        const dx = e.x - actor.x; const dy = e.y - actor.y; const dist = Math.hypot(dx,dy)||1;
        e.x += Math.round((dx / dist) * (parsed.pushback || 120));
        e.y += Math.round((dy / dist) * (parsed.pushback || 60));
      } catch (err){}
      e.applyStatus({ type:'dissonance', stacks: 1, duration: parsed.applies && parsed.applies[0] ? parsed.applies[0].duration : 6 });
      ui.playVfx(e, parsed.visualKeyword || 'vfx_sword');
    });
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 10;
    return;
  }

  if (name.includes('transformation') || decision.type === 'ultimate') {
    // transformation buff
    actor.applyStatus({ type:'buff_matk', value: parsed.magicAtkPct || 0.30, duration: parsed.duration || 15 });
    actor.applyStatus({ type:'buff_def', value: parsed.damageReductionPct || -0.20, duration: parsed.duration || 15 }); // buff_def positive means more def; here we use buff_def to reflect damage reduction
    ui.showFloatingText(actor, 'DEMONIC FORM', 'status-text buff');
    ui.playVfx(actor, parsed.visualKeyword || 'vfx_dark_bloom');
    // At end of duration, emit shockwave that consumes dissonance stacks on enemies and stuns per stack
    const dur = (parsed.duration || 15) * 1000 / Math.max(0.2, (battle.battleSpeed || 1));
    setTimeout(() => {
      const center = actor;
      const radius = 160;
      const base = parsed.shockwaveBase || 150;
      const scale = parsed.shockwaveScale || 0.6;
      const matk2 = actor.effectiveMagicAtk || actor.stats['magic atk'] || 25;
      const dmg = Math.floor(base + matk2 * scale);
      const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
      targets.forEach(e => {
        // count dissonance stacks
        const dis = e.activeEffects.find(x => x.type === 'dissonance');
        const stacks = dis ? (dis.stacks || 1) : 0;
        const totalDmg = Math.floor(dmg + (stacks * dmg * 0.15));
        const res = e.receiveAction({ amount: totalDmg, type:'magic', element: 'dark', attackerAccuracy: 16 });
        ui.showFloatingText(e, res.amount, 'damage-number crit');
        if (stacks > 0) {
          // stun per stack
          e.applyStatus({ type:'stun', duration: clamp((parsed.stunPerStack || 0.25) * stacks, 0, 3) });
          // remove dissonance stacks
          if (dis) dis.stacks = 0;
        }
        ui.playVfx(e, 'vfx_explosion');
      });
    }, dur);
    actor.energy = 0;
    actor.cooldownTimers[decision.ability.name] = parsed.cooldown || 120;
    return;
  }

  // Diabolical Decadence signature: apply DoT and mechanics when invoked (passive usually)
  if (name.includes('diabolical decadence')) {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 32;
    const mag = actor.effectiveMagicAtk || actor.stats['magic atk'] || 25;
    // scale with both atk & mag, distribute as DoT
    const dotPerSec = Math.max(8, Math.floor((atk + mag) * (parsed?.dotScaleWithAtk || 0.02)));
    t.applyStatus({ type:'dot', name: 'Diabolical', duration: parsed?.dotDuration || 4, value: dotPerSec, tickInterval: 1 });
    // apply a short vulnerability/debuff to amplify traps
    t.applyStatus({ type: 'debuff_def', duration: 4, modifiers: { def: -0.08 } });
    ui.showFloatingText(t, 'DIABOLICAL', 'status-text');
    ui.playVfx(t, parsed.visualKeyword || 'vfx_dark_void');
    return;
  }

  // fallback: basic
  {
    const t = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!t) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 32;
    const dmg = Math.floor(14 + atk * 0.22);
    const res = t.receiveAction({ amount: dmg, type:'physical', attackerAccuracy: 16 });
    ui.showFloatingText(t, res.amount, 'damage-number');
    ui.playVfx(t, 'slash');
  }
}

export function updatePassives(actor, dt){
  actor.customResources = actor.customResources || {};
  actor.resourceDecayTimers = actor.resourceDecayTimers || {};

  // Omnipresence: grant stacks of magic atk buff when enemies have statuses
  const parsedPassive = actor.data.abilities?.find(a => (a.name||'').toLowerCase().includes('omnipresence'));
  const mech = parsedPassive ? (parsedPassive.mechanics || {}) : {};
  const enemies = actor.battleSystem ? (actor.team === 'ally' ? actor.battleSystem.enemies : actor.battleSystem.allies) : [];
  const live = (enemies || []).filter(e => !e.isDead);

  // Count unique enemies with any negative status
  const uniqueCount = live.reduce((acc, e) => {
    const hasNeg = e.activeEffects && e.activeEffects.some(x => ['burn','stun','freeze','poison','blind','root','silence','dissonance','dot'].includes(x.type));
    return acc + (hasNeg ? 1 : 0);
  }, 0);

  // Apply temporary magic attack buff proportional to uniqueCount (5% per enemy)
  const stacks = Math.min(mech.maxStacks || 5, uniqueCount);
  actor.passiveModifiers = actor.passiveModifiers || {};
  actor.passiveModifiers.omniMagicAtk = (stacks * (mech.perStatusMagicAtkPct || 0.05));

  // Heal ally on dealing damage to dissonance-marked enemies is handled in BattleSystem.receiveAction hooks;
  // we can provide a helper flag by scanning for recent damage events—simulate by decaying a small resource counters
  // For durability, ensure resource timers decay:
  for (const k in actor.resourceDecayTimers) {
    actor.resourceDecayTimers[k] = Math.max(0, (actor.resourceDecayTimers[k] || 0) - dt);
  }
}