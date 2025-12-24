/**
 * 132.js — Batman (Character ability module)
 * Exports:
 *  - decideAction(actor, enemies, allies, battle)
 *  - getParsedAbility(ability, actor)
 *  - executeAction(battle, actor, decision, parsed)
 *
 * Lightweight but functional implementation matching the provided ability descriptions.
 */

function simpleDamageValue(actor, multiplier = 1.0, base = 0) {
    // use effectiveAtk as primary source, fallback to stats.atk
    const atk = actor.effectiveAtk || actor.stats.atk || 10;
    return Math.max(1, Math.floor((atk * multiplier) + base));
}

function applySlow(target, pct = 0.2, dur = 2) {
    target.applyStatus({ type: 'slow', duration: dur, value: pct });
}

function applyBlind(target, dur = 3) {
    target.applyStatus({ type: 'blind', duration: dur, value: 0.5 });
}

function applyWeakness(target, pct = 0.10, dur = 2) {
    target.applyStatus({ type: 'debuff_atk', duration: dur, modifiers: { atk: -pct } });
}

function revealStealthedNearby(actor, allies, enemies, radius = 400, chance = 0.10) {
    // reveal stealthed enemies nearby with chance
    enemies.forEach(e => {
        if (e.isStealthed) {
            const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
            if (dist <= radius && Math.random() < chance) {
                // strip stealth and mark visible briefly
                e.activeEffects = e.activeEffects.filter(s => !(s.type === 'stealth' || s.type === 'invisible'));
                // give a short reveal marker
                e.applyStatus({ type: 'exposed', duration: 3 });
                // notify allies (UI)
                allies.forEach(a => a.battleSystem.uiManager.showFloatingText(a, `REVEAL: ${e.data.name}`, 'status-text'));
            }
        }
    });
}

/* Passive periodic scanner (called from updatePassives) */
export function updatePassives(actor, dt) {
    // cooldown timer mechanism on actor.customResources for scanner
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
    if (!actor.customResources._intel_cd) actor.customResources._intel_cd = 0;
    actor.customResources._intel_cd -= dt;
    if (actor.customResources._intel_cd <= 0) {
        actor.customResources._intel_cd = 20; // triggers every 20s (signature passive + base)
        // Advanced Intel: 10% chance to reveal stealthed enemies up to 400 units
        revealStealthedNearby(actor, actor.battleSystem.allies.filter(a=>a.team==='ally'), actor.battleSystem.enemies, 400, 0.10);
    }
}

/* Parser metadata to help BattleSystem when parsing abilities */
export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    if (key.includes('basic')) {
        return {
            baseDmg: 0,
            scalePct: 0.25,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: false,
            typeCategory: 'basic',
            visualKeyword: 'slash',
            cooldown: 1.2
        };
    }
    if (key.includes('batarang') && !key.includes('echo')) {
        return {
            baseDmg: 0,
            scalePct: 0.25,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: false,
            typeCategory: 'skill',
            visualKeyword: 'projectile',
            cooldown: 6,
            statuses: [{ type: 'slow', duration: (skillLevel >= 20 ? 3 : 2), value: 0.20 }]
        };
    }
    if (key.includes('smoke')) {
        return {
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'atk',
            multiHitCount: 0,
            element: 'magic',
            isBurst: false,
            typeCategory: 'skill',
            visualKeyword: 'dark_void',
            targeting: 'aoe',
            cooldown: 12,
            statuses: [{ type: 'blind', duration: (skillLevel >= 70 ? 4 : 3), value: 0.5, auraRadius: 4 * 40 }]
        };
    }
    if (key.includes('descent') || key.includes('dark knight')) {
        return {
            baseDmg: 0,
            scalePct: 1.0,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: true,
            typeCategory: 'ultimate',
            visualKeyword: 'explosion',
            cooldown: 45,
            statuses: [{ type: 'stun', duration: 1.5 }]
        };
    }
    if (key.includes('advanced intel')) {
        return {
            typeCategory: 'passive',
            description: 'Passive radar: increases luck and periodically reveals stealthed enemies',
            statuses: [{ type: 'buff_luck', duration: Infinity, value: 4 }]
        };
    }
    if (key.includes('batarang echo')) {
        return {
            typeCategory: 'passive',
            description: 'Signature: multi-batarang passive, triggers every 20s',
            cooldown: 20
        };
    }
    return null;
}

/* AI: choose which ability to use. Keep simple priority:
   - If ultimate ready (energy>=max), use ultimate
   - If enemies cluster or many alive -> smoke pellet (AOE) when not on CD
   - If a single reachable target low HP -> Batarang toss to set up slow/weakness
   - otherwise basic attack.
*/
export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead && !e.isStealthed);
    if (liveEnemies.length === 0) return { score: -1, ability: { name: 'Basic Attack' }, targets: [enemies[0]] };

    // check ultimate readiness
    if (actor.energy >= actor.maxEnergy) {
        return { score: 1200, ability: { name: "The Dark Knight's Descent" }, targets: liveEnemies.slice(0,1), type: 'ultimate' };
    }

    // prefer smoke if there are >=2 enemies clustered within 160px of each other
    if (!actor.cooldownTimers["Smoke Pellet"]) {
        for (let i=0;i<liveEnemies.length;i++){
            const e1 = liveEnemies[i];
            const around = liveEnemies.filter(e2 => Math.hypot(e2.x-e1.x, e2.y-e1.y) < 160);
            if (around.length >= 2) return { score: 900, ability: { name: 'Smoke Pellet' }, targets: around, type: 'skill' };
        }
    }

    // If any enemy is below 35% hp prefer batarang toss to slow/enable follow up
    const killable = liveEnemies.find(e => (e.currentHp / e.maxHp) < 0.35 && !actor.cooldownTimers["Batarang Toss"]);
    if (killable) return { score: 800, ability: { name: 'Batarang Toss' }, targets: [killable], type: 'skill' };

    // If signature passive off cooldown, we allow it to trigger reactively in executeAction (passive)
    // Fallback: basic attack nearest
    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { score: 200, ability: { name: 'Basic Attack' }, targets: [nearest], type: 'basic' };
}

/* Core execution. This is designed to integrate with BattleSystem's expectations. */
export async function executeAction(battle, actor, decision, parsed) {
    const abilityName = (decision.ability && decision.ability.name) || 'Basic Attack';
    const skillLevel = (actor.data.skills && actor.data.skills[abilityName]) ? actor.data.skills[abilityName] : 1;

    // guard: basic attack immediate
    if (abilityName === 'Basic Attack') {
        const target = decision.targets[0];
        if (!target) return;
        const dmg = simpleDamageValue(actor, 0.25);
        const isCrit = Math.random()*100 < (actor.stats.luck || 0);
        const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit, attackerAccuracy: 25 });
        battle.uiManager.showFloatingText(target, res.amount, 'damage-number');
        battle.uiManager.playVfx(target, 'slash');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 15);
        return;
    }

    if (abilityName === 'Batarang Toss') {
        const target = decision.targets[0];
        if (!target) return;
        const dmg = simpleDamageValue(actor, 1.0, 0); // equals roughly full attack when described
        battle.uiManager.showProjectile(actor, target, 'physical');
        await new Promise(r => setTimeout(r, 80)); // reduced travel for more reliable hit registration
        const isCrit = Math.random()*100 < (actor.stats.luck || 0);
        const res = target.receiveAction({ amount: dmg, type: 'physical', isCrit, attackerAccuracy: 32 });
        battle.uiManager.showFloatingText(target, res.amount, 'damage-number');
        // Apply slow (duration scales by level milestones)
        const slowDur = skillLevel >= 20 ? 3 : 2;
        applySlow(target, skillLevel >= 180 ? 0.30 : 0.20, slowDur);
        // Level-based added effects
        if (skillLevel >= 120) applyWeakness(target, skillLevel >= 180 ? 0.15 : 0.10, 2);
        battle.uiManager.playVfx(target, 'beam');
        // set cooldown
        actor.cooldownTimers["Batarang Toss"] = 6;
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    if (abilityName === 'Smoke Pellet') {
        // Targeting: area centered on primary target or average of provided targets
        const group = decision.targets && decision.targets.length ? decision.targets : [actor.currentActionTarget];
        const center = group[0] || actor.currentActionTarget;
        if (!center) return;
        // Create blind aura (use applyBlind to each enemy within radius)
        const radiusUnits = 4;
        const pixelRadius = radiusUnits * 40;
        const blindDur = skillLevel >= 70 ? 4 : 3;
        // apply to enemies within radius
        const enemies = actor.battleSystem.enemies.filter(e => !e.isDead);
        enemies.forEach(e => {
            const dist = Math.hypot(e.x - center.x, e.y - center.y);
            if (dist <= pixelRadius) {
                applyBlind(e, blindDur);
                battle.uiManager.showFloatingText(e, 'BLINDED', 'status-text');
                battle.uiManager.playVfx(e, 'dark_void');
            }
        });
        // Level 130: allies inside gain 10% evasion
        if (skillLevel >= 130) {
            const allies = actor.battleSystem.allies.filter(a => !a.isDead);
            allies.forEach(a => {
                const dist = Math.hypot(a.x - center.x, a.y - center.y);
                if (dist <= pixelRadius) a.applyStatus({ type: 'buff_evasion', duration: 4, value: 0.10 });
            });
        }
        // Level 190 extra silence after blind ends: implement as delayed application (best-effort)
        if (skillLevel >= 190) {
            setTimeout(() => {
                const enemiesNow = actor.battleSystem.enemies.filter(e => !e.isDead);
                enemiesNow.forEach(e => {
                    // only apply if they had been blinded recently (heuristic: have 'blind' activeEffect removed recently is not tracked; best-effort apply short silence)
                    e.applyStatus({ type: 'silence', duration: 1 });
                });
            }, blindDur * 1000);
        }
        actor.cooldownTimers["Smoke Pellet"] = 12;
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 18);
        return;
    }

    if (abilityName === "The Dark Knight's Descent") {
        // Primary target: furthest visible enemy per description
        const liveEnemies = battle.enemies.filter(e => !e.isDead && !e.isStealthed);
        if (liveEnemies.length === 0) return;
        const primary = liveEnemies.sort((a,b) => Math.hypot(b.x-actor.x,b.y-actor.y)-Math.hypot(a.x-actor.x,a.y-actor.y))[0];
        // travel / grapple visual
        battle.uiManager.playVfx(actor, 'beam');
        // Impact: damage equal to full attack power to primary, stun 1.5s (increase at lvl100)
        const atkVal = actor.effectiveAtk || actor.stats.atk;
        const primaryDmg = Math.floor(atkVal * 1.0);
        const res = primary.receiveAction({ amount: primaryDmg, type: 'physical', isCrit: false, attackerAccuracy: 40 });
        primary.applyStatus({ type: 'stun', duration: (actor.data.level >= 100 ? 2.0 : 1.5) });
        battle.uiManager.showFloatingText(primary, res.amount, 'damage-number');
        battle.uiManager.triggerHitAnim(primary);
        battle.uiManager.playVfx(primary, 'slash');

        // Shockwave: hits all enemies within a moderate radius for 50% of attack (scaled at later levels)
        const rad = 120;
        battle.enemies.filter(e => !e.isDead).forEach(e => {
            const dist = Math.hypot(e.x - primary.x, e.y - primary.y);
            if (dist <= rad && e.id !== primary.id) {
                let pct = 0.5;
                if (actor.data.level >= 150) pct = 0.75;
                const amt = Math.floor(atkVal * pct);
                const r2 = e.receiveAction({ amount: amt, type: 'physical', isCrit: false, attackerAccuracy: 30 });
                battle.uiManager.showFloatingText(e, r2.amount, 'damage-number');
                battle.uiManager.playVfx(e, 'explosion');
            }
        });

        // Shield: avoid spamming — apply only if internal shield cooldown not active
        if (!actor.cooldownTimers['batman_shield_internal']) {
            const shieldPct = (actor.data.level >= 200) ? 0.15 : 0.10;
            const shieldAmt = Math.floor(actor.maxHp * shieldPct);
            actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            battle.uiManager.showFloatingText(actor, 'SHIELD', 'status-text buff');
            battle.uiManager.playVfx(actor, 'shield');
            // set short internal cooldown to prevent spamming the shield repeatedly
            actor.cooldownTimers['batman_shield_internal'] = 10; // 10s internal shield cooldown
        } else {
            // Visual hint that shield was suppressed due to internal cooldown
            battle.uiManager.showFloatingText(actor, 'SHIELD COOLDOWN', 'status-text');
        }
        // cooldown/consume energy
        actor.energy = 0;
        actor.cooldownTimers["The Dark Knight's Descent"] = 45;
        return;
    }

    // Signature passive "Batarang Echo" is reactive; allow it to trigger here if off-cd and not actively acting
    if (abilityName.toLowerCase().includes('batarang echo') || abilityName === 'Batarang Echo') {
        // Implementation not called as action normally; included for completeness
        // Trigger three effects quickly on the primary target if available
        const primary = decision.targets && decision.targets[0];
        if (!primary) return;
        // 1) sonic: accuracy debuff
        primary.applyStatus({ type: 'debuff_accuracy', duration: 2, value: 0.12 });
        // 2) micro-grapple: short root
        primary.applyStatus({ type: 'root', duration: 0.8 });
        // 3) echolocation: reveal nearby and increase damage taken by allies (vulnerability)
        primary.applyStatus({ type: 'vulnerability_stack', duration: 4, stacks: 1, value: 0.08 });
        battle.uiManager.showFloatingText(primary, 'ECHO', 'status-text buff');
        actor.cooldownTimers['Batarang Echo'] = 20;
        return;
    }

    // default fallback: small energy gain and a basic attack effect
    const fallback = decision.targets && decision.targets[0];
    if (fallback) {
        const d = simpleDamageValue(actor, 0.2);
        const r = fallback.receiveAction({ amount: d, type: 'physical', attackerAccuracy: 20 });
        battle.uiManager.showFloatingText(fallback, r.amount, 'damage-number');
    }
}