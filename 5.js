/*
  Character ability module for export_id "5" (Richard)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Helpers for Royal Decree resource
function getDecree(actor) { return Math.floor(actor.getResource ? actor.getResource('Royal Decree') : (actor.customResources?.['Royal Decree']||0)); }
function addDecree(actor, amt) { if (actor.addResource) return actor.addResource('Royal Decree', amt, 9999); actor.customResources['Royal Decree'] = Math.min(9999,(actor.customResources['Royal Decree']||0)+amt); return actor.customResources['Royal Decree']; }
function consumeAllDecree(actor) { const cur = getDecree(actor); if (actor.consumeResource) actor.consumeResource('Royal Decree', cur); else actor.customResources['Royal Decree'] = 0; return cur; }

export async function getParsedAbility(ability, actor, battle) {
    const name = (ability && ability.name || '').toLowerCase();

    if (name.includes('basic attack')) {
        return {
            baseDmg: 20,
            scalePct: 0.45,
            scaleStat: 'atk',
            element: 'wind',
            targeting: 'single',
            visualKeyword: 'slash',
            typeCategory: 'basic'
        };
    }

    if (name.includes('paperclip storm') || name.includes('royal decree: paperclip storm')) {
        return {
            baseDmg: 80, // total over duration
            scalePct: 0.6,
            scaleStat: 'magicAtk',
            element: 'magic',
            targeting: 'aoe',
            visualKeyword: 'proj-magic',
            multiTick: 6, // spread over 3s (approx)
            duration: 3,
            cooldown: 10,
            mechanics: { grantsDecree: 10, appliesSlowOnThreshold: true },
            typeCategory: 'skill'
        };
    }

    if (name.includes('unikingdom trivia barrage')) {
        return {
            baseShieldPct: 0.15,
            element: 'light',
            targeting: 'single',
            visualKeyword: 'vfx-buff',
            cooldown: 12,
            mechanics: { grantsDecree: 15, grantsEvasionAura: true },
            typeCategory: 'skill'
        };
    }

    if (name.includes('by the rules') || name.includes("by the rules!")) {
        return { typeCategory: 'passive', aura: { radius: 500, baseDef: 10, defScalePctPer20Decree: 0.02 } };
    }

    if (name.includes('royal advisor') || name.includes("royal advisor's tenacity")) {
        return { typeCategory: 'passive', tenacity: 20, evasionPct: 5 };
    }

    if (name.includes('grand royal decree') || name.includes('time-out corner')) {
        return {
            element: 'order',
            targeting: 'area',
            visualKeyword: 'vfx-beam',
            typeCategory: 'ultimate',
            cooldown: 90,
            duration: 5,
            mechanics: { consumesAllDecree: true, choresAtkRedPct: 0.30, choresSpdRedPct: 0.20, alliesAtkSpeedPct: 0.25, cooldownReductionPct: 0.10 }
        };
    }

    return null;
}

export async function decideAction(actor, enemies, allies, battle) {
    const abilities = actor.data.abilities || [];
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead && a !== actor);

    // Find abilities by hint
    const basic = (abilities.find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' });
    const paper = abilities.find(a => (a.name||'').toLowerCase().includes('paperclip storm'));
    const trivia = abilities.find(a => (a.name||'').toLowerCase().includes('unikingdom trivia'));
    const ultimate = abilities.find(a => (a.name||'').toLowerCase().includes('grand royal decree') || (a.name||'').toLowerCase().includes('time-out corner'));

    // Prefer ultimate if ready and there are multiple enemies
    if (actor.energy >= actor.maxEnergy && ultimate) {
        return { ability: ultimate, type: 'ultimate', targets: liveEnemies.length ? liveEnemies.slice(0,5) : [] };
    }

    // Use Trivia Barrage to shield lowest ally when injured or when multiple allies below 70%
    if (trivia && !actor.cooldownTimers?.[trivia.name]) {
        const injured = liveAllies.filter(a => a.currentHp / a.maxHp < 0.85);
        if (injured.length > 0) {
            const target = injured.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
            return { ability: trivia, type: 'skill', targets: [target] };
        }
    }

    // Use Paperclip Storm when clusters detected or to apply Tangled Tape if decree threshold met
    if (paper && !actor.cooldownTimers?.[paper.name]) {
        // find densest enemy center
        let best = null, bestCount = 0;
        for (const e of liveEnemies) {
            const cnt = liveEnemies.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= 120).length;
            if (cnt > bestCount) { bestCount = cnt; best = e; }
        }
        if (bestCount >= 2 || getDecree(actor) >= 50) {
            return { ability: paper, type: 'skill', targets: [best || liveEnemies[0]] };
        }
    }

    // Otherwise basic attack on closest enemy
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
    const liveFriends = friends.filter(f => !f.isDead);

    // small windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 160));

    // BASIC ATTACK
    if (name.includes('basic attack')) {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor((parsed.baseDmg || 20) + atk * (parsed.scalePct || 0.45));
        const res = tgt.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'wind', attackerAccuracy: 20 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'vfx-slash');
        return;
    }

    // PAPERCLIP STORM
    if (name.includes('paperclip storm')) {
        const center = decision.targets && decision.targets[0];
        if (!center) return;
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 50;
        const totalBase = parsed.baseDmg || 80;
        const scale = parsed.scalePct || 0.6;
        const total = Math.floor(totalBase + matk * scale);
        const ticks = parsed.multiTick || 6;
        const perTick = Math.max(1, Math.floor(total / ticks));
        const radius = 100 * (parsed.areaMult || 1); // area default

        // Grant Royal Decree
        addDecree(actor, parsed.mechanics?.grantsDecree || 10);

        // Apply ticks over duration (non-blocking loop)
        for (let t = 0; t < ticks; t++) {
            // find current targets in radius
            const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius && !e.isDead);
            for (const tar of targets) {
                const res = tar.receiveAction({ amount: perTick, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 16 });
                ui.showFloatingText(tar, res.amount, 'damage-number');
                ui.playVfx(tar, 'proj-magic');
                ui.triggerHitAnim(tar);
            }
            // On first tick, if decree threshold met, apply Tangled Tape slow
            if (t === 0 && getDecree(actor) > 50) {
                targets.forEach(tar => {
                    tar.applyStatus({ type: 'slow', duration: (parsed.slowDur || 2), value: 0.25 });
                    ui.showFloatingText(tar, 'TANGLED TAPE', 'status-text');
                });
            }
            // small wait between ticks
            // scale wait with battle speed to keep consistent feel
            await new Promise(r => setTimeout(r, Math.max(80, (parsed.duration || 3) * 1000 / ticks / (battle.battleSpeed || 1))));
        }
        return;
    }

    // UNIKINGDOM TRIVIA BARRAGE (Shield)
    if (name.includes('unikingdom trivia')) {
        const target = decision.targets && decision.targets[0];
        if (!target) return;
        const shieldAmt = Math.floor((actor.maxHp || 1000) * (parsed.baseShieldPct || 0.15));
        // Apply shield as decaying shield: implement as a shield value plus an activeEffect to decay display
        target.receiveAction({ amount: shieldAmt, effectType: 'shield' });
        ui.showFloatingText(target, `SHIELD ${shieldAmt}`, 'damage-number heal');
        ui.playVfx(target, 'vfx-buff');

        // If decree threshold, also grant atk buff
        if (getDecree(actor) > 50) {
            target.applyStatus({ type: 'buff_atk', value: 0.15, duration: 4 });
            ui.showFloatingText(target, 'ATK +15%', 'status-text buff');
        }

        // Distract enemies: small evasion buff to allies
        liveFriends.forEach(f => {
            f.applyStatus({ type: 'buff_evasion', value: 0.05, duration: 2 });
        });

        addDecree(actor, parsed.mechanics?.grantsDecree || 15);
        return;
    }

    // GRAND ROYAL DECREE: TIME-OUT CORNER (Ultimate)
    if (name.includes('grand royal decree') || name.includes('time-out corner')) {
        // create AOE centered on target (or actor if none)
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        // consume all decree
        const consumed = consumeAllDecree(actor);
        const duration = parsed.duration || 5;
        const choresAtkRed = parsed.mechanics?.choresAtkRedPct || 0.30;
        const choresSpdRed = parsed.mechanics?.choresSpdRedPct || 0.20;
        const allyAtkSpeed = parsed.mechanics?.alliesAtkSpeedPct || 0.25;
        const cooldownReduction = parsed.mechanics?.cooldownReductionPct || 0.10;
        const radius = 220;

        // Apply area statuses immediately and keep aura for duration
        const areaEffectId = `time_out_${Date.now()}`;

        // For simplicity, apply statuses to units currently inside and register an aura-like activeEffect on actor which BattleCharacter update will propagate if implemented
        const affectedEnemies = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        const affectedAllies = liveFriends.filter(a => Math.hypot(a.x - center.x, a.y - center.y) <= radius);

        affectedEnemies.forEach(en => {
            en.applyStatus({ type: 'debuff_atk', value: choresAtkRed, duration });
            en.applyStatus({ type: 'debuff_speed', value: choresSpdRed, duration });
            ui.showFloatingText(en, 'CHORES', 'status-text');
        });

        affectedAllies.forEach(al => {
            al.applyStatus({ type: 'buff_haste', value: allyAtkSpeed, duration });
            // reduce cooldowns by percent: we simulate by decreasing cooldownTimers
            Object.keys(al.cooldownTimers || {}).forEach(k => {
                al.cooldownTimers[k] = Math.max(0, al.cooldownTimers[k] * (1 - cooldownReduction));
            });
            ui.showFloatingText(al, 'ORDERLY FOCUS', 'status-text buff');
        });

        ui.playVfx(center, 'vfx-beam');
        // Note: do not re-apply per-frame; this is a one-off application per spec

        return;
    }

    // Fallback: basic strike
    const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
    if (!tgt) return;
    const atk = actor.effectiveAtk || actor.stats.atk || 40;
    const dmg = Math.floor(18 + atk * 0.4);
    const res = tgt.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 18 });
    ui.showFloatingText(tgt, res.amount, 'damage-number');
    ui.playVfx(tgt, 'slash');
}