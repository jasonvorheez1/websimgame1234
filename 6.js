/*
  Character ability module for export_id "6" (Tom)
  Exports:
    - decideAction(actor, enemies, allies, battle) => decision object
    - getParsedAbility(ability, actor, battle) => parsed overrides
    - executeAction(battle, actor, decision, parsed) => performs ability effects
*/

import { pickRandom } from './src/utils.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function getCartoonStacks(actor) { return Math.floor(actor.getResource ? actor.getResource('Cartoon Physics') : (actor.customResources?.['Cartoon Physics']||0)); }
function addCartoonStack(actor, amt) { if (actor.addResource) return actor.addResource('Cartoon Physics', amt, 999); actor.customResources['Cartoon Physics'] = Math.min(999,(actor.customResources['Cartoon Physics']||0)+amt); return actor.customResources['Cartoon Physics']; }
function consumeCartoonStacks(actor, amt) { const cur = getCartoonStacks(actor); const used = Math.min(cur, amt); if (actor.consumeResource) actor.consumeResource('Cartoon Physics', used); else actor.customResources['Cartoon Physics'] = Math.max(0, cur - used); return used; }

// Expose parsed ability metadata to help BattleSystem and AI
export async function getParsedAbility(ability, actor, battle) {
    const name = (ability && ability.name || '').toLowerCase();

    if (name.includes('basic attack')) {
        return {
            baseDmg: 41,
            scalePct: 0.45,
            scaleStat: 'atk',
            element: 'water',
            targeting: 'single',
            visualKeyword: 'slash',
            typeCategory: 'basic'
        };
    }

    if (name.includes('mallet mayhem') || name.includes('whack-a-foe') || name.includes('mallet')) {
        return {
            baseDmg: 100,
            scalePct: 0.3,
            scaleStat: 'atk',
            element: 'physical',
            targeting: 'aoe',
            visualKeyword: 'slash_heavy',
            multiHitCount: 1,
            radius: 300,
            knockbackBase: 150,
            mechanics: {
                grantsCartoonOnHit: true,
                maxStacksTriggersStun: true
            },
            cooldown: 10,
            typeCategory: 'skill'
        };
    }

    if (name.includes('frantic flourish')) {
        return {
            typeCategory: 'skill',
            visualKeyword: 'vfx-dodge',
            targeting: 'self',
            mechanics: { givesEvasionBuff: true, appliesDistracted: true },
            cooldown: 18,
            duration: 4, // base duration, scales with DEF/HP in execute
        };
    }

    if (name.includes('inescapable antagonism') || name.includes('frenzy')) {
        return { typeCategory: 'passive', evasionChance: 0.15, frenzy: { stacksMax: 3, movePct: 0.05, atkSpdPct: 0.10 } };
    }

    if (name.includes('cartoon resilience') || name.includes('cartoon recovery')) {
        return {
            typeCategory: 'passive',
            bonusDef: 50,
            bonusMagicDef: 30,
            recovery: { hpThresholdPct: 0.20, invulBase: 1.0, invulPerStack: 0.2, speedPct: 0.25, cooldown: 60, tenacityAdd: 10 }
        };
    }

    if (name.includes('rube goldberg') || name.includes('ingenious contraption') || name.includes('rampage')) {
        return {
            typeCategory: 'ultimate',
            visualKeyword: 'vfx-beam',
            cooldown: 120,
            mechanics: { buildTime: 2, rainDuration: 3, magnetDuration: 2, explosionDuration: 1, rainRadius: 500 },
            projectileBase: 50,
            projectileScalePct: 0.1,
            explosionBase: 300,
            explosionScalePct: 0.6,
            duration: 8
        };
    }

    return null;
}

export async function decideAction(actor, enemies, allies, battle) {
    const abilities = actor.data.abilities || [];
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead && a !== actor);

    const findByName = (q) => abilities.find(a => a.name && a.name.toLowerCase().includes(q));

    const basic = (abilities.find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' });
    const mallet = findByName('mallet mayhem') || findByName('whack-a-foe');
    const flourish = findByName('frantic flourish');
    const ult = findByName('rube goldberg') || findByName('ingenious contraption');

    // Prioritize Ultimate when full energy
    if (actor.energy >= actor.maxEnergy && ult) return { ability: ult, type: 'ultimate', targets: liveEnemies.slice(0,5) };

    // If low HP and recovery passive ready (handled in passives) prefer flourish for evasion if allies safe
    if (flourish && !actor.cooldownTimers?.[flourish.name] && actor.currentHp / actor.maxHp < 0.6) {
        return { ability: flourish, type: 'skill', targets: [actor] };
    }

    // Use Mallet when clustered or when Cartoon Physics stacks are high
    if (mallet && !actor.cooldownTimers?.[mallet.name]) {
        const stacks = getCartoonStacks(actor);
        let bestCount = 0, center = null;
        for (const e of liveEnemies) {
            const cnt = liveEnemies.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= (300 + stacks*25)).length;
            if (cnt > bestCount) { bestCount = cnt; center = e; }
        }
        if (bestCount >= 2 || stacks >= 3) {
            return { ability: mallet, type: 'skill', targets: [center || liveEnemies[0]] };
        }
    }

    // Fallback: basic attack closest
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
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 160));

    // BASIC ATTACK
    if (name.includes('basic attack')) {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor((parsed.baseDmg || 41) + atk * (parsed.scalePct || 0.45));
        const res = tgt.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: parsed.element || 'water', attackerAccuracy: 18 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, parsed.visualKeyword || 'slash');
        return;
    }

    // MALLET MAYHEM
    if (name.includes('mallet mayhem') || name.includes('whack-a-foe')) {
        const center = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!center) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const base = parsed.baseDmg || 100;
        const scale = parsed.scalePct || 0.3;
        const total = Math.floor(base + (atk * scale));
        const stacks = clamp(getCartoonStacks(actor), 0, 7);
        const radius = (parsed.radius || 300) + (stacks * 25);
        const knockback = (parsed.knockbackBase || 150) + (stacks * 10);
        const applyStun = (stacks >= 5 && (parsed.mechanics?.maxStacksTriggersStun !== false));

        ui.playVfx(center, parsed.visualKeyword || 'vfx-beam');

        const targets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        for (const t of targets) {
            const res = t.receiveAction({ amount: total, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 16 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            ui.triggerHitAnim(t);
            ui.playVfx(t, 'vfx-slash-heavy' in ui ? 'vfx-slash-heavy' : 'vfx-slash');

            // knockback vector away from center
            try {
                const dx = t.x - center.x; const dy = t.y - center.y;
                const dist = Math.hypot(dx, dy) || 1;
                const nx = dx / dist; const ny = dy / dist;
                t.x += Math.round(nx * knockback);
                t.y += Math.round(ny * knockback * 0.6);
                // clamp in-bounds
                t.x = Math.max(40, Math.min(860, t.x));
                t.y = Math.max(battle.minY || 80, Math.min(battle.maxY || 520, t.y));
            } catch (e) {
                // fallback minimal horizontal push
                t.x += (t.x > actor.x ? knockback : -knockback);
            }

            // apply stun at max stacks
            if (applyStun) {
                t.applyStatus({ type: 'stun', duration: (stacks >= 7 ? 1.5 : 1.0) });
                ui.showFloatingText(t, 'STUN', 'status-text');
            }
        }

        // Grant one Cartoon Physics stack for each enemy hit? Spec says Tom gains one stack when struck by enemy ability; also grant small on cast (flavor)
        // We'll grant 0 here but ensure stacking primarily via being hit; grant 1 when hits >=2 to reward use
        if (targets.length >= 2) addCartoonStack(actor, 1);

        // Level-based upgrades: some parsed fields may be modified externally in parser; set cooldown
        actor.cooldownTimers[ability.name] = parsed.cooldown || 10;
        return;
    }

    // FRANTIC FLOURISH
    if (name.includes('frantic flourish')) {
        // Duration and potency scale with DEF and HP
        const baseDur = parsed.duration || 4;
        const defFactor = (actor.stats.def || 10) * 0.01; // small scaling
        const hpFactor = (actor.maxHp || 1000) * 0.0008;
        const finalDur = Math.min(8, baseDur + defFactor + hpFactor); // cap for sanity

        // Evasion buff magnitude derived from DEF; use passive-like buff value
        const evasionBuff = Math.min(0.5, 0.08 + (actor.stats.def || 10) * 0.002); // ~6-12% typical
        const distractedValue = 0.12 + (actor.maxHp / Math.max(1000, actor.maxHp)) * 0.03; // reduces target damage ~12-15%

        actor.applyStatus({ type: 'buff_evasion', value: evasionBuff, duration: finalDur });
        ui.showFloatingText(actor, `EVASION +${Math.round(evasionBuff*100)}%`, 'status-text buff');
        ui.playVfx(actor, 'vfx-dodge');

        // Apply Distracted debuff to nearby enemies (radius 220)
        const radius = 220;
        const targets = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= radius);
        for (const t of targets) {
            t.applyStatus({ type: 'debuff_atk', value: distractedValue, duration: finalDur });
            ui.showFloatingText(t, 'DISTRACTED', 'status-text');
        }

        actor.cooldownTimers[ability.name] = parsed.cooldown || 18;
        return;
    }

    // RUBE GOLDBERG (ULTIMATE)
    if (name.includes('rube goldberg') || name.includes('ingenious contraption') || name.includes('rampage')) {
        const mech = parsed.mechanics || {};
        const buildTime = mech.buildTime ? mech.buildTime * 1000 : 2000;
        const battleSpeed = battle.battleSpeed || 1;

        // During build: immune to CC but takes increased damage
        actor.applyStatus({ type: 'invulnerability', duration: 0.0001 }); // ensure no lingering; we use flag below
        actor.channeling = { name: ability.name, turnsRemaining: buildTime / 1000 };

        // set temporary flag - we emulate by setting channeling and activeEffect for CC immunity
        actor.applyStatus({ type: 'cc_immune_temp', duration: buildTime / 1000 });
        actor.addResource && actor.addResource('VulnTaken', 0); // no-op to keep API stable

        // Increase damage taken flag: apply a temporary effect that reduces def (represent increased damage taken)
        actor.applyStatus({ type: 'damage_taken_increase', value: 0.25, duration: buildTime / 1000 });

        ui.showFloatingText(actor, 'BUILDING...', 'status-text');
        ui.playVfx(actor, 'vfx-beam');
        await new Promise(r => setTimeout(r, buildTime / Math.max(0.25, battleSpeed)));

        // Rain Phase: projectiles fall for first 3 seconds
        const rainDur = mech.rainDuration || 3;
        const rainRadius = mech.rainRadius || 500;
        const projBase = parsed.projectileBase || 50;
        const projScale = parsed.projectileScalePct || parsed.projectileScalePct === 0 ? parsed.projectileScalePct : (parsed.projectileScalePct || 0.1);
        const projHits = 5; // per enemy max hits
        const atkScaleStat = actor.effectiveMagicAtk || actor.stats.magicAtk || 0;
        const projDmg = Math.floor((projBase + (atkScaleStat * projScale)));

        const rainTargets = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= rainRadius);
        const hitsPerEnemy = Math.min(projHits, Math.max(1, Math.floor((rainTargets.length > 0 ? 5 : 1))));
        const rainEnd = Date.now() + rainDur * 1000 / Math.max(0.2, battleSpeed);

        // Staggered projectiles
        while (Date.now() < rainEnd) {
            for (const t of rainTargets) {
                if (t.isDead) continue;
                const res = t.receiveAction({ amount: projDmg, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 12 });
                ui.showFloatingText(t, res.amount, 'damage-number');
                ui.playVfx(t, 'vfx-explosion');
            }
            await new Promise(r => setTimeout(r, Math.max(160, (rainDur*1000 / (hitsPerEnemy*2))) ));
        }

        // Magnet Phase: pull enemies towards center for magnetDuration seconds
        const magnetDur = mech.magnetDuration || 2;
        const magnetRadius = rainRadius;
        const magnetEnd = Date.now() + magnetDur * 1000 / Math.max(0.2, battleSpeed);
        ui.showFloatingText(actor, 'MAGNET ON', 'status-text buff');

        while (Date.now() < magnetEnd) {
            for (const t of liveEnemies.filter(e=>!e.isDead)) {
                const dx = actor.x - t.x; const dy = actor.y - t.y;
                const dist = Math.hypot(dx, dy) || 1;
                if (dist <= magnetRadius) {
                    const pullStrength = 1 + (0.25 * (1)); // base small pull
                    t.x += (dx / dist) * pullStrength * 18;
                    t.y += (dy / dist) * pullStrength * 8;
                }
            }
            await new Promise(r => setTimeout(r, 120));
        }

        // Explosion Phase: big center damage and knock-up effect
        const explosionBase = parsed.explosionBase || 300;
        const explosionScale = parsed.explosionScalePct || 0.6;
        const finalExplosion = Math.floor(explosionBase + (atkScaleStat * explosionScale));
        const explosionRadius = 220;
        ui.playVfx(actor, 'vfx-explosion');

        const explosionTargets = liveEnemies.filter(e => Math.hypot(e.x - actor.x, e.y - actor.y) <= explosionRadius);
        for (const t of explosionTargets) {
            const res = t.receiveAction({ amount: finalExplosion, type: 'magic', isCrit: false, element: 'magic', attackerAccuracy: 10 });
            ui.showFloatingText(t, res.amount, 'damage-number crit');
            ui.playVfx(t, 'vfx-explosion');
            // small vertical displacement to represent knock-up
            t.y = Math.max(battle.minY || 80, t.y - 40);
        }

        // If at max Cartoon Physics, grant random ally buff inside rain zone
        const stacks = getCartoonStacks(actor);
        if (stacks >= 5) {
            const buffChoice = Math.random() < 0.5 ? 'damage_boost' : 'speed_boost';
            const alliesInZone = friends.filter(f => !f.isDead && Math.hypot(f.x - actor.x, f.y - actor.y) <= rainRadius);
            for (const a of alliesInZone) {
                if (buffChoice === 'damage_boost') {
                    a.applyStatus({ type: 'buff_atk', value: 0.25, duration: 5 });
                    ui.showFloatingText(a, 'DMG +25%', 'status-text buff');
                } else {
                    a.applyStatus({ type: 'buff_speed', value: 0.20, duration: 5 });
                    ui.showFloatingText(a, 'SPD +20%', 'status-text buff');
                }
            }
        }

        // Heal allies small immediate heal based on parsed heal values if any
        if (parsed.healAmount) {
            const healAmt = parsed.healAmount;
            friends.forEach(f => { if (!f.isDead) { f.receiveAction({ amount: healAmt, effectType: 'heal' }); ui.showFloatingText(f, `+${healAmt}`, 'damage-number heal'); } });
        }

        // Reset energy / set cooldown
        actor.energy = 0;
        actor.cooldownTimers[ability.name] = parsed.cooldown || 120;
        return;
    }

    // Fallback: basic strike
    {
        const tgt = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!tgt) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor(20 + atk * 0.45);
        const res = tgt.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 16 });
        ui.showFloatingText(tgt, res.amount, 'damage-number');
        ui.playVfx(tgt, 'slash');
    }
}