<<<<<<< SEARCH
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
        actor.customResources._intel_cd = 20; // triggers every 20s
        // Advanced Intel: 10% chance to reveal stealthed enemies up to 400 units
        revealStealthedNearby(actor, actor.battleSystem.allies.filter(a=>a.team==='ally'), actor.battleSystem.enemies, 400, 0.10);
    }
}

/* Parser metadata to help BattleSystem when parsing abilities */
export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();
    if (key.includes('basic')) {
        return {
            baseDmg: 20,
            scalePct: 0.25,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: false,
            typeCategory: 'basic',
            visualKeyword: 'slash',
            cooldown: 1.0
        };
    }
    if (key.includes('batarang toss') || key.includes('batarang')) {
        return {
            baseDmg: 20,
            scalePct: 0,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: false,
            typeCategory: 'skill',
            visualKeyword: 'projectile',
            cooldown: 6,
            mechanics: { appliesSlow: true, slowPct: 0.20, slowDur: 2, evolvesAt: [20,60,120,180] }
        };
    }
    if (key.includes('smoke pellet') || key.includes('smoke')) {
        return {
            baseDmg: 0,
            scalePct: 0,
            element: 'dark',
            targeting: 'aoe',
            visualKeyword: 'dark_void',
            multiHitCount: 0,
            mechanics: { blindPct: 0.5, blindDur: 3, radiusUnits: 3 },
            cooldown: 12,
            typeCategory: 'skill'
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
            description: 'Signature: three-batarang passive that debuffs & reveals; 20s internal cooldown',
            cooldown: 20
        };
    }
    if (key.includes('descent') || key.includes('dark knight') || key.includes("the dark knight")) {
        return {
            baseDmg: 1.0, // marker: scale by full ATK
            scalePct: 1.0,
            scaleStat: 'atk',
            multiHitCount: 1,
            element: 'physical',
            isBurst: true,
            typeCategory: 'ultimate',
            visualKeyword: 'explosion',
            cooldown: 45,
            mechanics: { stun: 1.5, aoePct: 0.5, shieldPct: 0.10, durationShield: 5 }
        };
    }
    return null;
}

/* AI: choose which ability to use. Keep priorities reasonable and use cooldowns. */
export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (liveEnemies.length === 0) return { score: -1, ability: { name: 'Basic Attack' }, targets: [enemies[0]] };

    // ultimate when energy full
    if (actor.energy >= actor.maxEnergy) {
        const ultAbility = (actor.data.abilities || []).find(a => (a.type || '').toLowerCase() === 'ultimate' || (a.name || '').toLowerCase().includes('descent'));
        if (ultAbility && !actor.cooldownTimers?.[ultAbility.name]) {
            return { score: 1200, ability: ultAbility, targets: liveEnemies.slice(0,3), type: 'ultimate' };
        }
    }

    // prefer Smoke Pellet when 2+ enemies clustered
    const smoke = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('smoke'));
    if (smoke && !actor.cooldownTimers?.[smoke.name]) {
        for (let i=0;i<liveEnemies.length;i++){
            const e1 = liveEnemies[i];
            const around = liveEnemies.filter(e2 => Math.hypot(e2.x-e1.x,e2.y-e1.y) < 160);
            if (around.length >= 2) return { score: 900, ability: smoke, targets: [e1], type: 'skill' };
        }
    }

    // Use Batarang to finish low HP or to slow when useful
    const batarang = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('batarang'));
    if (batarang && !actor.cooldownTimers?.[batarang.name]) {
        const low = liveEnemies.find(e => (e.currentHp / e.maxHp) < 0.35);
        if (low) return { score: 800, ability: batarang, targets: [low], type: 'skill' };
        // otherwise use on nearest if few allies nearby to create openings
        const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
        return { score: 300, ability: batarang, targets: [nearest], type: 'skill' };
    }

    // fallback basic
    const basic = (actor.data.abilities || []).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };
    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { score: 100, ability: basic, targets: [nearest], type: 'basic' };
}

/* Core execution implementing the kit described by the user with level scaling (1→200). */
export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);

    // small windup
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 140));

    // Helper: level-based helpers
    const lvl = actor.data.level || actor.level || 1;
    const skillLv = (actor.data.skills && actor.data.skills[ability.name]) ? actor.data.skills[ability.name] : 1;
    const skillMult = 1 + (skillLv - 1) * 0.1;
    const sigCdReady = !(actor.customResources && actor.customResources._echo_cd && actor.customResources._echo_cd > 0);

    // BASIC ATTACK
    if (name.includes('basic')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        // base scales slightly with level; apply small late-game buff
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const base = (20 + Math.floor((lvl - 1) * 0.45)) * skillMult; // modest growth per level
        const scale = (0.25 + (lvl >= 10 ? 0.02 : 0)) * skillMult;
        const dmg = Math.max(1, Math.floor(base + atk * scale));
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 25 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash');
        // small energy gain
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // BATARANG TOSS
    if (name.includes('batarang')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        // Level progression
        let slowDur = 2;
        let slowPct = 0.20;
        let baseAtkAdd = 0;
        if (lvl >= 20) slowDur = 3;
        if (lvl >= 60) baseAtkAdd = 50;
        if (lvl >= 120) {
            // apply Weakness on hit
            applyWeakness(t, 0.10, 2);
        }
        if (lvl >= 180) {
            slowPct = 0.30;
            applyWeakness(t, 0.15, 2);
        }
        // Damage calculation: described as "20 + X ATK" evolving per levels
        const atk = actor.effectiveAtk || actor.stats.atk || 50;
        const base = (20 + baseAtkAdd) * skillMult;
        const dmg = Math.max(1, Math.floor(base + Math.floor(atk * (parsed.scalePct || 0)))); // primarily flat per spec at low levels
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 28 });
        ui.showProjectile(actor, t, 'physical');
        await new Promise(r => setTimeout(r, 90));
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'proj-magic');
        // Apply slow
        t.applyStatus({ type: 'debuff_speed', value: slowPct, duration: slowDur });
        ui.showFloatingText(t, 'SLOWED', 'status-text');
        // At higher levels, Weakness applied above
        // cooldown handled by BattleSystem parsed cooldown assignment
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // SMOKE PELLET
    if (name.includes('smoke')) {
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : (liveEnemies[0] || actor);
        if (!center) return;
        const radiusUnits = parsed?.mechanics?.radiusUnits || 3;
        let blindDur = parsed?.mechanics?.blindDur || 3;
        let blindPct = parsed?.mechanics?.blindPct || 0.5;
        if (lvl >= 70) blindDur = 4;
        // Level 30 increases radius by +25%
        const radius = Math.floor((radiusUnits * 40) * (lvl >= 30 ? 1.25 : 1.0));
        ui.playVfx(center, 'dark_void');
        // Apply blind to enemies within radius
        const affected = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= radius);
        affected.forEach(e => {
            e.applyStatus({ type: 'blind', duration: blindDur, value: blindPct });
            ui.showFloatingText(e, 'BLINDED', 'status-text');
            ui.playVfx(e, 'vfx-dark-void');
        });
        // Level 130: Allies in cloud gain +10% evasion
        if (lvl >= 130) {
            friends.forEach(a => {
                if (!a.isDead && Math.hypot(a.x - center.x, a.y - center.y) <= radius) {
                    a.applyStatus({ type: 'buff_evasion', value: 0.10, duration: 4 });
                    ui.showFloatingText(a, 'EVA +10%', 'status-text buff');
                }
            });
        }
        // Level 190: Blind also silences enemies for 1s after effect ends -> schedule delayed silence
        if (lvl >= 190) {
            setTimeout(() => {
                affected.forEach(e => {
                    if (!e.isDead) {
                        e.applyStatus({ type: 'silence', duration: 1 });
                        ui.showFloatingText(e, 'SILENCED', 'status-text');
                    }
                });
            }, blindDur * 1000);
        }
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 16);
        return;
    }

    // ULTIMATE: THE DARK KNIGHT'S DESCENT
    if (name.includes('descent') || name.includes("the dark knight")) {
        // Primary target: furthest visible enemy
        const visible = liveEnemies.filter(e => !e.isStealthed);
        const primary = visible.length ? visible.sort((a,b) => Math.hypot(b.x-actor.x,b.y-actor.y)-Math.hypot(a.x-actor.x,a.y-actor.y))[0] : liveEnemies[0];
        if (!primary) return;
        // Travel effect & VFX
        ui.playVfx(actor, 'vfx-beam');
        await new Promise(r => setTimeout(r, 160));
        // Damage equals full attack power to primary
        const atkVal = actor.effectiveAtk || actor.stats.atk || 50;
        let primaryDmg = Math.floor(atkVal * 1.0 * skillMult);
        // Level scaling: Level 100 increases stun to 2s
        let stunDur = 1.5;
        if (lvl >= 100) stunDur = 2.0;
        // Deal to primary
        const resPrimary = primary.receiveAction({ amount: primaryDmg, type: 'physical', isCrit: false, attackerAccuracy: 40 });
        primary.applyStatus({ type: 'stun', duration: stunDur });
        ui.showFloatingText(primary, resPrimary.amount, 'damage-number');
        ui.playVfx(primary, 'vfx-explosion');
        // Shockwave: hits all enemies within radius for portion of ATK
        let aoePct = parsed?.mechanics?.aoePct || 0.5;
        if (lvl >= 150) aoePct = 0.75;
        const shockDmg = Math.floor(atkVal * aoePct);
        const aoeRadius = 120;
        liveEnemies.forEach(e => {
            const dist = Math.hypot(e.x - primary.x, e.y - primary.y);
            if (dist <= aoeRadius && e.id !== primary.id) {
                const r = e.receiveAction({ amount: shockDmg, type: 'physical', isCrit: false, attackerAccuracy: 30 });
                ui.showFloatingText(e, r.amount, 'damage-number');
                ui.playVfx(e, 'vfx-explosion');
            }
        });
        // Shield generation: 10% max HP for base, 15% at level 200
        let shieldPct = (parsed?.mechanics?.shieldPct || 0.10) * skillMult;
        if (lvl >= 200) shieldPct = 0.15 * skillMult;
        const shieldAmt = Math.floor((actor.maxHp || actor.stats.maxHp || 1000) * shieldPct);
        actor.receiveAction({ amount: shieldAmt, effectType: 'shield' });
        ui.showFloatingText(actor, `SHIELD ${shieldAmt}`, 'status-text buff');
        ui.playVfx(actor, 'shield');
        actor.energy = 0;
        // internal shield cooldown to avoid repeated immediate shields handled by BattleSystem/cooldowns
        return;
    }

    // SIGNATURE PASSIVE: BATARANG ECHO (reactive activation implemented here if triggered manually)
    if (name.includes('batarang echo')) {
        const primary = decision.targets && decision.targets[0];
        if (!primary) return;
        // Sonic emitter -> accuracy debuff
        primary.applyStatus({ type: 'debuff_accuracy', duration: 2, value: 0.12 });
        // Micro-grapple -> short root
        primary.applyStatus({ type: 'root', duration: 0.8 });
        // Echolocation pulse: reveal nearby and apply vulnerability stack
        const radius = 140;
        battle.enemies.filter(e => !e.isDead && Math.hypot(e.x - primary.x, e.y - primary.y) <= radius).forEach(e => {
            e.applyStatus({ type: 'vulnerability_stack', stacks: 1, value: 0.08, duration: 4 });
            ui.showFloatingText(e, 'ECHO', 'status-text');
        });
        // Start internal cooldown
        actor.customResources = actor.customResources || {};
        actor.customResources._echo_cd = 20;
        return;
    }

    // Fallback basic strike
    {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor(18 + atk * 0.4);
        const res = t.receiveAction({ amount: dmg, type: 'physical', isCrit: false, element: 'physical', attackerAccuracy: 18 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash');
    }
}