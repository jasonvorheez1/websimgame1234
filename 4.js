/*
  Character ability module for export_id "4" (Li)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function getScorched(actor) { return Math.floor(actor.getResource ? actor.getResource('Scorched Earth') : (actor.customResources?.['Scorched Earth']||0)); }
function addScorched(actor, amt) { actor.addResource ? actor.addResource('Scorched Earth', amt, 999) : (actor.customResources['Scorched Earth'] = Math.min(999, (actor.customResources['Scorched Earth']||0)+amt)); }
function consumeScorched(actor, amt) { const cur = getScorched(actor); const used = Math.min(cur, amt); if (actor.consumeResource) actor.consumeResource('Scorched Earth', used); else actor.customResources['Scorched Earth'] = Math.max(0, cur - used); return used; }

export async function getParsedAbility(ability, actor, battle) {
    const name = (ability && ability.name || '').toLowerCase();
    if (name.includes('basic attack')) {
        return {
            baseDmg: 30,
            scalePct: 0.3,
            scaleStat: 'atk',
            element: 'fire',
            targeting: 'single',
            visualKeyword: 'slash',
            typeCategory: 'basic'
        };
    }
    if (name.includes('spiritual flame')) {
        return {
            baseDmg: 51,
            scalePct: 1.5,
            scaleStat: 'magicAtk',
            element: 'fire',
            targeting: 'single',
            visualKeyword: 'proj-fire',
            multiHitCount: 1,
            mechanics: { isBurnApplier: true },
            energyCost: 51,
            cooldown: 4
        };
    }
    if (name.includes('blazing meteor')) {
        return {
            baseDmg: 0, // damage computed from magicAtk * 0.8
            scalePct: 0.8,
            scaleStat: 'magicAtk',
            element: 'fire',
            targeting: 'aoe',
            visualKeyword: 'explosion',
            multiHitCount: 1,
            energyCost: 40,
            cooldown: 8
        };
    }
    if (name.includes('crimson nova')) {
        return {
            baseDmg: 0,
            scalePct: 2.0,
            scaleStat: 'magicAtk',
            element: 'fire',
            targeting: 'aoe',
            visualKeyword: 'holy_light',
            typeCategory: 'ultimate',
            energyCost: 'all',
            cooldown: 60
        };
    }
    if (name.includes('flame talisman') || name.includes('eternal blaze')) {
        return { typeCategory: 'passive' };
    }
    return null;
}

export async function decideAction(actor, enemies, allies, battle) {
    const abilities = actor.data.abilities || [];
    const ult = abilities.find(a => a.name && a.name.toLowerCase().includes('crimson nova'));
    const meteor = abilities.find(a => a.name && a.name.toLowerCase().includes('blazing meteor'));
    const flame = abilities.find(a => a.name && a.name.toLowerCase().includes('spiritual flame'));
    const basic = abilities.find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };

    const liveEnemies = enemies.filter(e => !e.isDead);
    if (liveEnemies.length === 0) return { ability: basic, type: 'basic', targets: [] };

    // Ultimate: prefer when energy full or many Scorched stacks and multiple enemies
    const scorched = getScorched(actor);
    if (actor.energy >= actor.maxEnergy && ult) {
        return { ability: ult, type: 'ultimate', targets: liveEnemies };
    }

    // Meteor: AoE priority when 2+ enemies clustered
    if (meteor && !actor.cooldownTimers?.[meteor.name]) {
        // cluster check: count enemies within 120px of some point
        let bestCount = 0;
        for (const e of liveEnemies) {
            const cnt = liveEnemies.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= (120 + scorched * 2)).length;
            if (cnt > bestCount) bestCount = cnt;
        }
        if (bestCount >= 2) {
            // target area centered on densest enemy
            const center = liveEnemies.sort((a,b) => {
                const ca = liveEnemies.filter(o => Math.hypot(o.x - a.x, o.y - a.y) <= 120).length;
                const cb = liveEnemies.filter(o => Math.hypot(o.x - b.x, o.y - b.y) <= 120).length;
                return cb - ca;
            })[0];
            return { ability: meteor, type: 'skill', targets: [center] };
        }
    }

    // Spiritual Flame: prefer enemies not burning; otherwise target lowest HP
    if (flame && !actor.cooldownTimers?.[flame.name] && actor.energy >= 51) {
        const notBurning = liveEnemies.filter(e => !e.activeEffects.some(s => s.type === 'burning' || s.type === 'burn'));
        if (notBurning.length > 0) return { ability: flame, type: 'skill', targets: [pickRandom(notBurning)] };
        return { ability: flame, type: 'skill', targets: [liveEnemies.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0]] };
    }

    // Fallback basic
    return { ability: basic, type: 'basic', targets: [liveEnemies[0]] };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);

    // small windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 300 : 180));

    // Basic Attack
    if (name.includes('basic attack')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const dmg = Math.floor((parsed.baseDmg || 30) + atk * (parsed.scalePct || 0.3));
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'fire', attackerAccuracy: 22 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash');
        return;
    }

    // Spiritual Flame
    if (name.includes('spiritual flame')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        // consume energy
        if (actor.energy >= 51) actor.energy = Math.max(0, actor.energy - 51);
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        let base = Math.floor((parsed.baseDmg || 51) + matk * (parsed.scalePct || 1.5));
        // Scorched Earth stacks: +5% per stack (cap handled in resource)
        const stacks = clamp(getScorched(actor), 0, 10);
        base = Math.floor(base * (1 + 0.05 * stacks));
        // Apply hit
        const res = t.receiveAction({ amount: base, type: 'magic', isCrit: false, element: 'fire', attackerAccuracy: 20 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'proj-fire');

        // Burning: deals 20% of initial damage per second for 5s
        const burnPerSec = Math.floor(base * 0.20);
        // If target already burning, refresh duration and grant Li a Scorched Earth stack (max 10)
        const existing = t.activeEffects.find(e => e.type === 'burning');
        if (existing) {
            existing.duration = Math.max(existing.duration, 5);
            addScorched(actor, 1);
            // cap handled by addScorched via resource max if needed
        } else {
            t.applyStatus({ type: 'burning', duration: 5, value: burnPerSec });
        }

        // Prioritize non-burning targets in AI; we already targeted accordingly

        // If parsed indicates explosion at high level, that behavior is handled by battle/main upgrades (not enforced here)

        return;
    }

    // Blazing Meteor
    if (name.includes('blazing meteor')) {
        const center = decision.targets && decision.targets[0];
        if (!center) return;
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        const stacks = clamp(getScorched(actor), 0, 10);
        // radius increases 5% per stack; base radius ~120
        const baseRadius = 120;
        const radius = Math.floor(baseRadius * (1 + 0.05 * stacks));
        // damage
        let dmg = Math.floor(matk * (parsed.scalePct || 0.8));
        // If any target at center is burning, +20%
        const localTargets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        let finalDmg = dmg;
        if (localTargets.some(t => t.activeEffects.some(s => s.type === 'burning'))) finalDmg = Math.floor(finalDmg * 1.2);
        // Apply to each
        ui.playVfx(center, 'explosion');
        for (const t of localTargets) {
            const res = t.receiveAction({ amount: finalDmg, type: 'magic', isCrit: false, element: 'fire', attackerAccuracy: 18 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            // apply burning for 3s at 15% per sec of initial impact
            const burnPerSec = Math.floor(finalDmg * 0.15);
            t.applyStatus({ type: 'burning', duration: 3, value: burnPerSec });
        }
        // consume energy
        actor.energy = Math.max(0, (actor.energy || 0) - 40);
        return;
    }

    // Crimson Nova (Ultimate)
    if (name.includes('crimson nova')) {
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : { x: actor.x, y: actor.y };
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        const stacks = clamp(getScorched(actor), 0, 999);
        const baseRadius = 200;
        const radius = Math.floor(baseRadius * (1 + 0.08 * Math.min(stacks, 999))); // visually larger with stacks
        // Consume all stacks for final damage boost: +8% per stack
        const stackBonus = 1 + (0.08 * stacks);
        // damage
        let dmg = Math.floor(matk * (parsed.scalePct || 2.0) * stackBonus);
        ui.playVfx(center, 'holy_light');

        const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        for (const t of targets) {
            const res = t.receiveAction({ amount: dmg, type: 'magic', isCrit: false, element: 'fire', attackerAccuracy: 15 });
            ui.showFloatingText(t, res.amount, 'damage-number crit');
            t.applyStatus({ type: 'burning', duration: 8, value: Math.floor(dmg * 0.25) });
        }

        // After cast, give Li +50% Fire DMG for 10s and generate 1 Scorched per second for 10s, but immediate consume stacks
        consumeScorched(actor, stacks);
        actor.applyStatus({ type: 'buff_fire_dmg', value: 0.5, duration: 10 });
        // schedule stack generation (1 per sec for 10s)
        let ticks = 10;
        const gen = setInterval(() => {
            if (ticks-- <= 0) { clearInterval(gen); return; }
            addScorched(actor, 1);
        }, 1000 / Math.max(0.2, (battle.battleSpeed || 1)));

        // Reset energy
        actor.energy = 0;
        return;
    }

    // Default fallback: treat as basic
    {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const dmg = Math.floor(20 + atk * 0.5);
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 20 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash');
    }
}