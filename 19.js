/*
  Remote custom ability module for export_id 19 (Bobette).
  Provides:
    - decideAction(actor, enemies, allies, battle)
    - getParsedAbility(ability, actor, battle)  (optional overrides / richer parsed hints)
    - executeAction(battle, actor, decision, parsed)  (fully handles ability execution)
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
  // Prefer ultimate if enough Holiday Spirit and off-cooldown
  const liveEnemies = enemies.filter(e => !e.isDead);
  const liveAllies = allies.filter(a => !a.isDead && a !== actor);
  const hpPct = (actor.currentHp / Math.max(1, actor.maxHp));
  // use resources: Holiday Spirit tracked as 'Holiday Spirit' in customResources
  const spirit = Math.floor(actor.getResource ? actor.getResource('Holiday Spirit') : (actor.customResources?.['Holiday Spirit']||0));

  // Try ultimate if full or very generous (>=10) and off cooldown
  const ult = (actor.data?.abilities || []).find(a => String(a.type||'').toLowerCase() === 'ultimate');
  if (ult && spirit > 0 && !actor.cooldownTimers?.[ult.name]) {
    return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0, 12) };
  }

  // If low HP, cast Bauble Barrier if available and enough spirit
  const shieldSkill = (actor.data?.abilities || []).find(a => a.name && a.name.toLowerCase().includes('bauble barrier'));
  if (shieldSkill && !actor.cooldownTimers?.[shieldSkill.name]) {
    if (spirit >= 15 && hpPct < 0.7) {
      return { ability: shieldSkill, type: 'skill', targets: [actor] };
    }
    // also use defensively if multiple allies low
    const alliesLow = liveAllies.filter(a => (a.currentHp / a.maxHp) < 0.5);
    if (spirit >= 15 && alliesLow.length >= 2) return { ability: shieldSkill, type: 'skill', targets: [actor] };
  }

  // Heartwarming Carol: buff allies - target lowest HP ally for single-target buff or aoe
  const carol = (actor.data?.abilities || []).find(a => a.name && a.name.toLowerCase().includes('heartwarming carol'));
  if (carol && !actor.cooldownTimers?.[carol.name]) {
    // prefer to use when at least one ally below 85% and spirit >=20
    const needBuff = liveAllies.some(a => (a.currentHp / a.maxHp) < 0.9);
    if (needBuff && spirit >= 20) {
      return { ability: carol, type: 'skill', targets: [actor] };
    }
  }

  // Default: basic attack against highest threat (closest lowest hp)
  const basic = (actor.data?.abilities || []).find(a => (a.tags||[]).some(t => String(t).toLowerCase().includes('basic'))) || { name: 'Basic Attack' };
  const primary = liveEnemies.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0] || liveEnemies[0];
  return { ability: basic, type: 'basic', targets: [primary] };
}

export async function getParsedAbility(ability, actor, battle) {
  // Provide helpful parsed hints for BattleSystem to merge with its parser.
  const name = String(ability.name || '').toLowerCase();
  if (name.includes('basic attack')) {
    return {
      typeCategory: 'basic',
      baseDmg: 0,
      scalePct: 1.0,
      scaleStat: 'atk',
      element: 'ice',
      multiHitCount: 1,
      targeting: 'single',
      visualKeyword: 'wind_gust',
      cooldown: 1.8
    };
  }
  if (name.includes('bauble barrier')) {
    return {
      typeCategory: 'active',
      isShield: true,
      isInvulnerable: true,
      baseDmg: 0,
      cooldown: 15,
      visualKeyword: 'holy_light',
      statuses: [
        { type: 'invulnerability', duration: 4 },
        { type: 'root', duration: 4 },
        { type: 'shield', duration: 5, value: 0.10 } // 10% max HP shield after exiting
      ],
      mechanics: { generatesSpirit: 5, consumesSpirit: 15, auraSlowPct: 0.2, auraRadius: 3 * 40, auraDuration: 3 }
    };
  }
  if (name.includes('heartwarming carol')) {
    return {
      typeCategory: 'skill',
      isHeal: false,
      baseDmg: 0,
      scalePct: 0,
      element: 'light',
      cooldown: 12,
      targeting: 'aoe',
      statuses: [
        { type: 'buff_atk', duration: 6, value: 0.15 },
        { type: 'buff_matk', duration: 6, value: 0.15 },
        { type: 'debuff_magicdef', duration: 4, value: -0.10, target: 'enemy' }
      ],
      mechanics: { priority: 'lowest_hp' },
      visualKeyword: 'holy_light'
    };
  }
  if (name.includes('holiday resilience')) {
    return {
      typeCategory: 'passive',
      statuses: [
        { type: 'buff_def', duration: Infinity, value: 100, name: 'HolidayDefFlat' },
        { type: 'buff_hp_percent', duration: Infinity, value: 0.05, name: 'HolidayMaxHp' }
      ],
      mechanics: { spiritOnAllyDamaged: 3, spiritCapShield: 0.02 }
    };
  }
  if (name.includes('ornament overload') || name.includes('ultimate')) {
    return {
      typeCategory: 'ultimate',
      baseDmg: 0,
      scalePct: 0,
      element: 'ice',
      cooldown: 75,
      visualKeyword: 'explosion',
      mechanics: { percentHpDmg: 0.08, minOrnaments: 1, perSpiritOrnaments: 2, maxOrnaments: 100, dreadPerHit: 0.03, dreadDuration: 5, consumesAllSpirit: true }
    };
  }
  if (name.includes('ornamental resilience')) {
    return {
      typeCategory: 'passive',
      statuses: [
        { type: 'buff_tenacity', duration: Infinity, value: 0.20 }
      ],
      mechanics: { ccReactionChance: 0.4, reactionSpirit: 10, passiveGenerationEvery: 2, passiveGenerationAmount: 1, spiritCap: 50 }
    };
  }
  return null;
}

export async function executeAction(battle, actor, decision, parsed) {
  // Provide clear, deterministic implementations for Bobette's skills.
  const ui = battle.uiManager;
  const ability = decision.ability;
  const name = String(ability.name || '').toLowerCase();
  const spiritName = 'Holiday Spirit';

  // helper: spend spirit
  const spendSpirit = (amount) => {
    if (!actor.consumeResource) {
      if (!actor.customResources) actor.customResources = {};
      if ((actor.customResources[spiritName]||0) < amount) return false;
      actor.customResources[spiritName] -= amount;
      return true;
    }
    return actor.consumeResource(spiritName, amount);
  };

  // Basic Attack: quick projectile to single target
  if (name.includes('basic attack')) {
    const target = decision.targets && decision.targets[0];
    if (!target || target.isDead) return;
    // small windup
    await ui.showProjectile(actor, target, 'ice');
    await waitMs(80);
    const dmg = Math.max(8, Math.floor(actor.effectiveAtk * 0.9));
    const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit: false, attackerElement: 'ice', attackerAccuracy: 20 });
    ui.showFloatingText(target, res.amount, 'damage-number');
    ui.playVfx(target, 'ice');
    actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
    return;
  }

  // Bauble Barrier: invulnerability for 4s, rooted, then shield to self and small slow aura on enemies
  if (name.includes('bauble barrier')) {
    // require spirit
    const cost = 15;
    if (!spendSpirit(cost)) return;
    // generate 5 back (per description)
    actor.addResource && actor.addResource(spiritName, 5);

    // Apply invul + root
    actor.applyStatus({ type: 'invulnerability', duration: 4 });
    actor.applyStatus({ type: 'root', duration: 4 });
    ui.showAbilityName(actor, ability.name);
    ui.playVfx(actor, 'holy_light');
    ui.showFloatingText(actor, 'INVINCIBLE!', 'status-text buff');

    // Wait while invul active (visual timing)
    await waitMs(400);

    // On exit: grant shield equal to 10% max HP lasting 5s
    actor.applyStatus({ type: 'shield', duration: 5, value: Math.floor(actor.maxHp * 0.10) });

    // slow nearby enemies (aura)
    const radiusPx = 3 * 40;
    const enemies = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemies.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radiusPx) {
        e.applyStatus({ type: 'debuff_speed', duration: 3, value: 0.20 });
        ui.showFloatingText(e, 'SLOWED', 'status-text');
      }
    });
    ui.playVfx(actor, 'vfx-buff');
    // set cooldown
    actor.cooldownTimers[ability.name] = parsed && parsed.cooldown ? Number(parsed.cooldown) : 15;
    return;
  }

  // Heartwarming Carol: buff allies in radius, debuff enemy magic def
  if (name.includes('heartwarming carol')) {
    const cost = 20;
    if (!spendSpirit(cost)) return;
    ui.showAbilityName(actor, ability.name);
    ui.playVfx(actor, 'vfx-heal');
    const radiusPx = (5 * 40);
    const allies = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
    allies.forEach(a => {
      const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
      if (dist <= radiusPx) {
        a.applyStatus({ type: 'buff_atk', duration: 6, value: 0.15 });
        a.applyStatus({ type: 'buff_matk', duration: 6, value: 0.15 });
        ui.showFloatingText(a, 'ATK↑', 'status-text buff');
      }
    });
    // enemies debuff
    const enemies = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    enemies.forEach(e => {
      const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
      if (dist <= radiusPx) {
        e.applyStatus({ type: 'debuff_magicdef', duration: 4, value: -0.10 });
        ui.showFloatingText(e, 'M.DEF↓', 'status-text');
      }
    });
    actor.cooldownTimers[ability.name] = parsed && parsed.cooldown ? Number(parsed.cooldown) : 12;
    return;
  }

  // Holiday Resilience passive is handled via getParsedAbility and engine triggers; no runtime execute

  // Ornamental Overload / Ultimate: consume all Holiday Spirit -> spawn ornaments hitting random enemies
  if (name.includes('ornament overload') || name.includes('ultimate')) {
    // read spirit
    const spirit = Math.floor(actor.getResource ? actor.getResource('Holiday Spirit') : (actor.customResources?.['Holiday Spirit']||0));
    if (spirit <= 0) return;
    // consume all
    if (actor.consumeResource) actor.consumeResource(spiritName, spirit);
    else actor.customResources[spiritName] = 0;

    // number ornaments = min(max, spirit*2)
    const count = Math.min(100, Math.max(1, spirit * 2));
    ui.showAbilityName(actor, ability.name);
    // briefly vanish from target lists -> make actor stealthed/invulnerable for 3s as per description
    actor.applyStatus({ type: 'invulnerability', duration: 3 });
    actor.applyStatus({ type: 'stealth', duration: 3 }); // keep safe
    ui.playVfx(actor, 'vfx-explosion');

    // throw ornaments at random enemies over short period
    const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);
    const perHitDmg = Math.max(1, Math.floor(actor.maxHp * 0.08)); // 8% max HP
    const maxPerTick = Math.min(10, Math.ceil(count / 10));
    for (let i = 0; i < count; i++) {
      const target = enemiesPool.length ? enemiesPool[Math.floor(Math.random() * enemiesPool.length)] : null;
      if (!target) break;
      // visual projectile
      ui.showProjectile(actor, target, 'proj-fire');
      // small delay between ornaments
      await waitMs(40);
      // apply damage
      const res = target.receiveAction({ amount: perHitDmg, type: 'physical', attackerElement: 'ice', attackerAccuracy: 15 });
      ui.showFloatingText(target, res.amount, 'damage-number');
      // apply Holiday Dread stack (debuff atk %)
      const existing = target.activeEffects.find(e => e.type === 'holiday_dread');
      if (existing) {
        existing.stacks = Math.min(10, (existing.stacks||0) + 1);
        existing.duration = 5;
      } else {
        target.applyStatus({ type: 'holiday_dread', stacks: 1, value: 0.03, duration: 5 });
      }
      // apply stack effect: reduce attack by 3% per stack (engine will read holiday_dread if used downstream)
      // small heal to allies near ornament if high-level upgrade exists (handled by parser flags; simple imitation:)
      if (parsed && parsed.mechanics && parsed.mechanics.healOnHit) {
        const allyNear = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead && Math.hypot(a.x - target.x, a.y - target.y) <= 40);
        allyNear.forEach(a => {
          a.receiveAction({ amount: Math.floor(actor.maxHp * 0.02), effectType: 'heal' });
          ui.showFloatingText(a, `+${Math.floor(actor.maxHp*0.02)}`, 'damage-number heal');
        });
      }
      // tiny yield so the loop doesn't block UI entirely
      if (i % 8 === 0) await waitMs(12);
    }

    // cooldown reduction rule: base 75s minus 1s per 5 spirit consumed
    const baseCd = parsed && parsed.cooldown ? Number(parsed.cooldown) : 75;
    const cdReduction = Math.floor(spirit / 5);
    actor.cooldownTimers[ability.name] = Math.max(10, baseCd - cdReduction);

    // small post-ultimate cooldown visual
    ui.showFloatingText(actor, `THREW ${count} ORNAMENTS`, 'status-text buff');
    return;
  }

  // Signature passive / reaction: not executed actively here
}

// Minimal internal wait helper
function waitMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}