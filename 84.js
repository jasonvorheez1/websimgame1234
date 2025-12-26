/**
 * 84.js — Robin (Utility) ability module
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Batarang Toss (ally shield / buff) — grants shield 60% ATK for 3s, extends existing shield duration up to 5s
 *  - Acrobatic Strike (basic) — 100% ATK, chance to gain evade buff
 *  - Smoke Pellet Distraction — 3s smoke, Robin +25% evasion, enemies in cloud reduced accuracy
 *  - Batarang (Exposed) — ranged single target that deals 75% ATK and applies Exposed (takes +15% damage)
 *  - Aerial Assault (ultimate) — untargetable channel then AoE 150% ATK and 1s stun
 */
import { pickRandom } from './utils.js';

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName||'').toLowerCase();
    const lvlMult = 1 + ((skillLevel - 1) * 0.08);

    if (key.includes('acrobatic strike')) {
        return {
            typeCategory: 'basic',
            baseDmg: Math.floor(0 * lvlMult), // we'll scale from atk
            scalePct: 1.00 * lvlMult,
            scaleStat: 'atk',
            element: 'physical',
            multiHitCount: 1,
            cooldown: 1.8,
            mechanics: { evadeChance: 0.10, evadeDur: 2 },
            visualKeyword: 'sword'
        };
    }

    if (key.includes('batarang toss') && description.toLowerCase().includes('ally')) {
        // Shielding/support variant (first listed)
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.60 * lvlMult, // shield = 60% atk
            scaleStat: 'atk',
            element: 'physical',
            targeting: 'ally',
            cooldown: 8,
            mechanics: { shieldDur: 3, extendDur: 2, maxDur: 5, buffPct: 0.10, buffDur: 3 },
            visualKeyword: 'proj_throw'
        };
    }

    if (key.includes('batarang toss') && description.toLowerCase().includes('exposed')) {
        // Offensive/expose variant (later unlock, tags indicate)
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.75 * lvlMult,
            scaleStat: 'atk',
            element: 'physical',
            targeting: 'enemy',
            cooldown: 9,
            mechanics: { applyExposedPct: 0.15, exposedDur: 4, interruptChance: 0.12 },
            visualKeyword: 'proj_throw'
        };
    }

    if (key.includes('smoke pellet')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'atk',
            element: 'smoke',
            targeting: 'self-area',
            cooldown: 18,
            mechanics: { duration: 3, evasionPct: 0.25, enemyMissChance: 0.20, radius: 140 },
            visualKeyword: 'vfx_toxic_gas'
        };
    }

    if (key.includes('aerial assault') || key.includes('ultimate')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            scalePct: 1.50 * lvlMult,
            scaleStat: 'atk',
            element: 'physical',
            multiHitCount: 1,
            cooldown: 90,
            mechanics: { untargetableDur: 2.0, aoeRadius: 220, stunDur: 1.0, damagePct: 1.50 },
            visualKeyword: 'vfx_fire_storm'
        };
    }

    // fallback: attempt to let caller parse
    return null;
}

export function updatePassives(actor, dt) {
    // Robin has an agility passive: when below 40% HP, small evasion bonus persists for a few seconds
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    const hpPct = (actor.currentHp || 0) / Math.max(1, actor.maxHp || actor.stats && (actor.stats['max hp'] || actor.stats.maxHp || 1));
    if (hpPct < 0.4) {
        actor.passiveModifiers = actor.passiveModifiers || {};
        actor.passiveModifiers.robin_lowHpEvasion = 0.12; // +12% evasion
        actor.resourceDecayTimers._robin_low_hp = Math.max(actor.resourceDecayTimers._robin_low_hp || 0, 4);
        actor.resourceDecayTimers._robin_low_hp -= dt;
        if (actor.resourceDecayTimers._robin_low_hp <= 0) {
            delete actor.passiveModifiers.robin_lowHpEvasion;
        }
    } else {
        if (actor.resourceDecayTimers._robin_low_hp > 0) actor.resourceDecayTimers._robin_low_hp -= dt;
        else delete actor.passiveModifiers?.robin_lowHpEvasion;
    }

    // decay any custom short timers
    Object.keys(actor.resourceDecayTimers || {}).forEach(k => {
        if (k.startsWith('_')) {
            actor.resourceDecayTimers[k] = Math.max(0, actor.resourceDecayTimers[k] - dt);
        }
    });
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead);
    if (!liveEnemies.length) return { ability: { name: 'Acrobatic Strike' }, targets: [] };

    // Choose abilities by simple priority:
    // 1) Ultimate if energy full
    const ult = (actor.data.abilities||[]).find(a => (a.type||'').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('aerial'));
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        // prefer clustered enemies
        for (const e of liveEnemies) {
            const nearby = liveEnemies.filter(x => Math.hypot(x.x - e.x, x.y - e.y) <= 200);
            if (nearby.length >= 2) return { ability: ult, type: 'ultimate', targets: nearby };
        }
        return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,3) };
    }

    // 2) If any ally is below 50% HP and Batarang (ally) off CD, cast shield/support
    const batarangAlly = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('batarang') && (a.description||'').toLowerCase().includes('ally'));
    if (batarangAlly && !actor.cooldownTimers?.[batarangAlly.name]) {
        const needy = liveAllies.filter(a => (a.currentHp / a.maxHp) < 0.6).sort((a,b)=> (a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
        if (needy) return { ability: batarangAlly, type: 'skill', targets: [needy] };
    }

    // 3) If expose batarang unlocked and a high priority enemy exists, apply Exposed
    const batarangExpose = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('batarang') && (a.description||'').toLowerCase().includes('exposed'));
    if (batarangExpose && !actor.cooldownTimers?.[batarangExpose.name]) {
        // choose enemy with highest power or lowest hp to finish
        const target = liveEnemies.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
        if (target) return { ability: batarangExpose, type: 'skill', targets: [target] };
    }

    // 4) Use Smoke Pellet defensively if Robin is below 60% HP or surrounded
    const smoke = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('smoke'));
    if (smoke && !actor.cooldownTimers?.[smoke.name]) {
        const closeEnemies = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= 120);
        if ((actor.currentHp / actor.maxHp) < 0.6 || closeEnemies.length >= 2) return { ability: smoke, type: 'skill', targets: [actor] };
    }

    // 5) Otherwise, basic attack nearest or finish low HP
    const basic = (actor.data.abilities||[]).find(a => (a.type||'').toLowerCase().includes('basic')) || { name: 'Acrobatic Strike' };
    const fin = liveEnemies.sort((a,b) => (a.currentHp - b.currentHp))[0];
    return { ability: basic, type: 'basic', targets: [fin || liveEnemies[0]] };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);

    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();

    // normalize parsed if not provided
    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description || "", (actor.data.skills && actor.data.skills[ability.name]) || 1, ability.tags || []);

    // small windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 140));

    // ACROBATIC STRIKE (BASIC)
    if (name.includes('acrobatic strike') || (parsed && parsed.typeCategory === 'basic')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 28;
        const dmg = Math.floor(atk * (parsed.scalePct || 1.0));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'physical', attackerAccuracy: 22 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'vfx_sword');

        // chance to gain evade buff
        const evChance = parsed.mechanics && parsed.mechanics.evadeChance ? parsed.mechanics.evadeChance : 0.10;
        if (Math.random() < evChance) {
            actor.applyStatus({ type: 'buff_evasion', value: 0.15, duration: parsed.mechanics.evadeDur || 2 });
            ui.showFloatingText(actor, 'EVADE', 'status-text buff');
        }
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
        return;
    }

    // Batarang Toss (ally shield/support)
    if (name.includes('batarang toss') && (ability.description||'').toLowerCase().includes('ally')) {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : (friends.find(f=>!f.isDead) || actor);
        if (!target) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 28;
        const shieldVal = Math.max(1, Math.floor(atk * (parsed.scalePct || 0.6)));
        // If ally already has a shield effect, extend duration up to max
        const existingShield = target.activeEffects.find(e => e.type === 'shield' || e.type === 'buff_shield');
        if (existingShield) {
            existingShield.duration = Math.min(parsed.mechanics.maxDur || 5, (existingShield.duration || parsed.mechanics.shieldDur) + (parsed.mechanics.extendDur || 2));
            ui.showFloatingText(target, 'SHIELD EXTENDED', 'status-text buff');
        } else {
            // apply shield as a status to be consumed by BattleCharacter.receiveAction handling
            target.applyStatus({ type: 'shield', value: shieldVal, duration: parsed.mechanics.shieldDur || 3 });
            ui.showFloatingText(target, `SHIELD +${shieldVal}`, 'status-text buff');
        }
        // apply outgoing damage buff
        target.applyStatus({ type: 'buff_atk', value: parsed.mechanics.buffPct || 0.10, duration: parsed.mechanics.buffDur || 3 });
        ui.playVfx(target, 'vfx_buff');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // Batarang (Exposed) offensive
    if (name.includes('batarang toss') && (ability.description||'').toLowerCase().includes('exposed') || name.includes('exposed')) {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
        if (!target) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 28;
        const dmg = Math.floor(atk * (parsed.scalePct || 0.75));
        const res = target.receiveAction({ amount: dmg, type: 'physical', element: 'physical', attackerAccuracy: 20 });
        ui.showFloatingText(target, res.amount, 'damage-number');
        ui.playVfx(target, 'proj_throw');
        // apply Exposed debuff increasing damage taken by 15% (store as vulnerability_stack custom)
        const existing = target.activeEffects.find(e => e.type === 'exposed' || e.type === 'vulnerability_stack');
        if (existing) {
            existing.duration = Math.max(existing.duration || parsed.mechanics.exposedDur || 4, parsed.mechanics.exposedDur || 4);
            ui.showFloatingText(target, 'EXPOSED+', 'status-text');
        } else {
            target.applyStatus({ type: 'vulnerability_stack', stacks: 1, value: parsed.mechanics.applyExposedPct || 0.15, duration: parsed.mechanics.exposedDur || 4 });
            ui.showFloatingText(target, 'EXPOSED', 'status-text');
        }
        // small chance to interrupt if enemy was casting
        if (parsed.mechanics.interruptChance && Math.random() < parsed.mechanics.interruptChance) {
            target.applyStatus({ type: 'silence', duration: 1.0 });
            ui.showFloatingText(target, 'INTERRUPT', 'status-text');
        }
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // SMOKE PELLET DISTRACTION
    if (name.includes('smoke pellet') || name.includes('smoke')) {
        const mech = parsed.mechanics || {};
        // create an area center at Robin's position — apply an aura status to Robin that will push to nearby units on tick
        actor.applyStatus({
            type: 'smoke_aura',
            name: 'smoke_cloud',
            auraRadius: mech.radius || 140,
            auraEffect: { type: 'buff_evasion', value: mech.evasionPct || 0.25, duration: 1.2 },
            auraTarget: 'ally',
            duration: mech.duration || 3
        });
        // also apply debuff aura for enemies (reduce accuracy chance)
        actor.applyStatus({
            type: 'smoke_enemy_aura',
            name: 'smoke_enemy',
            auraRadius: mech.radius || 140,
            auraEffect: { type: 'blind', value: mech.enemyMissChance || 0.20, duration: 1.2 },
            auraTarget: 'enemy',
            duration: mech.duration || 3
        });
        ui.showFloatingText(actor, 'SMOKE', 'status-text buff');
        ui.playVfx(actor, 'vfx_toxic_gas');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
        return;
    }

    // AERIAL ASSAULT (ULTIMATE)
    if (name.includes('aerial assault') || decision.type === 'ultimate') {
        const mech = parsed.mechanics || {};
        const duration = mech.untargetableDur || 2.0;
        const aoe = mech.aoeRadius || 220;
        const stun = mech.stunDur || 1.0;
        const dmgPct = mech.damagePct || 1.5;
        // make Robin untargetable briefly
        actor.applyStatus({ type: 'invulnerability', duration });
        ui.showAbilityName(actor, ability.name);
        ui.playVfx(actor, 'vfx_fire_storm');

        // short channel while untargetable
        await new Promise(r => setTimeout(r, Math.floor(duration * 650)));

        // impact centered at chosen target (use primary enemy or center)
        const center = (decision.targets && decision.targets[0]) ? decision.targets[0] : liveEnemies[0];
        const atk = actor.effectiveAtk || actor.stats.atk || 28;
        const dmg = Math.floor(atk * (dmgPct || 1.5));
        const hitTargets = liveEnemies.filter(e => Math.hypot(e.x - (center.x||actor.x), e.y - (center.y||actor.y)) <= aoe);
        hitTargets.forEach(t => {
            const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'physical', attackerAccuracy: 26 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            t.applyStatus({ type: 'stun', duration: stun });
            ui.playVfx(t, 'vfx-explosion');
            ui.triggerHitAnim(t);
        });

        // ult cost/cooldown handled upstream in BattleSystem
        actor.energy = 0;
        return;
    }

    // fallback no-op
    return;
}