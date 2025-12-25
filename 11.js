/**
 * 11.js — Skulker (Danny Phantom) ability module
 * Exports:
 *  - decideAction(actor, enemies, allies, battle)
 *  - getParsedAbility(abilityName, actor)
 *  - executeAction(battle, actor, decision, parsed)
 *
 * Implements Spectral Trap Launcher, Ecto-Net Barrage, Spectral Static passive, Ultimate fusion, and signature stacking.
 */

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName||'').toLowerCase();
    if (key.includes('basic')) {
        return {
            typeCategory: 'basic',
            baseDmg: 14,           // reduced base to lower early burst
            scalePct: 0.18,        // softer scaling
            scaleStat: 'atk',
            multiHitCount: 2,
            element: 'fire',
            cooldown: 1.1,         // slight pacing increase
            visualKeyword: 'slash_heavy'
        };
    }
    if (key.includes('spectral trap')) {
        return {
            typeCategory: 'skill',
            baseDmg: 60,           // nerfed raw damage, more utility emphasis
            scalePct: 0.16,        // reduced scaling
            scaleStat: 'atk',
            element: 'physical',
            targeting: 'ground',
            cooldown: 16,          // increased cooldown to limit spam
            mechanics: {
                armDelay: 0.9,         // slightly longer arming delay
                snareDuration: 2.0,    // increased control duration (utility buff)
                snareSlow: 0.25,
                deployCount: 1,
                prioritizeChampions: true
            },
            visualKeyword: 'trap'
        };
    }
    if (key.includes('ecto-net')) {
        return {
            typeCategory: 'skill',
            baseDmg: 48,           // lower per-target damage
            scalePct: 0.12,        // reduced scaling for sustainability
            scaleStat: 'magicAtk',
            element: 'magic',
            targeting: 'cone',
            cooldown: 14,          // slower reuse
            mechanics: {
                entangleDur: 2.4,      // slightly longer crowd control
                attackSpeedRed: 0.22,
                widenPerLevel: true
            },
            visualKeyword: 'poison_cloud'
        };
    }
    if (key.includes('spectral static')) {
        return {
            typeCategory: 'passive',
            description: 'Static Cling stacks on melee attackers; 3 stacks trigger Static Shock AoE and grants ranged damage reduction.',
            mechanics: { stacksToShock: 3, shockRadius: 90, shockDmg: 30, rangedReductionPct: 0.10 }, // toned down shock dmg
            visualKeyword: 'electric'
        };
    }
    if (key.includes('ghostly upgrade') || key.includes('upgrade 9.9') || key.includes('ultimate')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 45,           // reduce base to lower burst ceiling
            scalePct: 0.09,        // reduce scaling slightly
            scaleStat: 'atk',
            element: 'magic',
            cooldown: 100,         // longer cooldown for power budget
            mechanics: {
                duration: 14,
                hpPct: 0.25,
                atkPct: 0.18,
                magicAtkPct: 0.18,
                trapBonusCount: 2,   // fewer bonus traps to limit raw output
                ectoNetDouble: false, // remove automatic doubling of Ecto-Net in ultimate
                destabilizeThreshold: 0.22,
                shieldOnForcedEnd: { base: 350, scalePct: 0.2 } // smaller forced-end shield
            },
            visualKeyword: 'vfx-light'
        };
    }
    if (key.includes('tech-enhanced tenacity') || key.includes('signature')) {
        return {
            typeCategory: 'passive',
            description: 'Adaptive Protocols stacks on applying CC; each stack reduces incoming damage by 3% up to 5 stacks and decays every 5s.',
            mechanics: { maxStacks: 5, perStackDR: 0.03, decaySec: 5, healPulseOn5: { pct: 0.04, cooldown: 12 } }, // heal pulse reduced and slowed
            visualKeyword: 'vfx-buff'
        };
    }
    return null;
}

export async function decideAction(actor, enemies, allies, battle) {
    // Return structure: { ability: {name, ...}, targets: [...], type: 'skill'|'ultimate'|'basic' }
    const liveEnemies = enemies.filter(e=>!e.isDead);
    if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, targets: [], type: 'basic' };

    // Utility lookups
    const nearest = () => liveEnemies.sort((a,b)=>dist(a,actor)-dist(b,actor))[0];
    const clusteredTarget = () => {
        let best=null, bestCnt=0;
        for (const e of liveEnemies) {
            const cnt = liveEnemies.filter(o=>dist(o,e)<=120).length;
            if (cnt>bestCnt){ bestCnt=cnt; best=e; }
        }
        return { center: best, count: bestCnt };
    };

    // Ultimate if energy full
    const ult = (actor.data.abilities||[]).find(a=> (a.type||'').toLowerCase()==='ultimate' || (a.name||'').toLowerCase().includes('ghostly'));
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        return { ability: ult, targets: liveEnemies.slice(0, 5), type: 'ultimate' };
    }

    // Use skills immediately if off cooldown
    const trap = (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes('spectral trap'));
    if (trap && !actor.cooldownTimers?.[trap.name]) {
        const cluster = clusteredTarget();
        return { ability: trap, targets: [cluster.center || nearest()], type: 'skill' };
    }

    const ecto = (actor.data.abilities||[]).find(a=> (a.name||'').toLowerCase().includes('ecto-net'));
    if (ecto && !actor.cooldownTimers?.[ecto.name]) {
        const cluster = clusteredTarget();
        return { ability: ecto, targets: [cluster.center || nearest()], type: 'skill' };
    }

    // Otherwise, basic on nearest (and this will build stacks during ultimate)
    const basic = (actor.data.abilities||[]).find(a=> (a.tags||[]).includes('atk')) || { name: 'Basic Attack' };
    return { ability: basic, targets: [nearest()], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e=>!e.isDead);
    if (liveEnemies.length === 0) return;

    const ability = decision.ability;
    const name = (ability.name||'').toLowerCase();
    const lvl = actor.data.level || actor.level || 1;

    // ensure parsed info
    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, 1, ability.tags);

    // small windup
    await new Promise(r=>setTimeout(r, (decision.type==='ultimate')?300:120));

    // Helpers for stacks & signature
    actor.customResources = actor.customResources || {};
    actor.customResources._adaptive = actor.customResources._adaptive || 0;
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    // BASIC ATTACK
    if (name.includes('basic')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const base = parsed.baseDmg || 18;
        const perHit = Math.floor(base + atk * parsed.scalePct);
        // multi-hit splitting
        for (let i=0;i<(parsed.multiHitCount||1);i++){
            const res = t.receiveAction({ amount: Math.floor(perHit/(parsed.multiHitCount||1)), type: 'physical', element: parsed.element, attackerAccuracy: 18 });
            ui.showFloatingText(t, res.amount, 'damage-number');
            ui.playVfx(t, 'slash_heavy');
            if (res.amount>0) actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
            await new Promise(r=>setTimeout(r, 60));
        }
        // While fused, apply Overload stacks
        if (actor.customResources && actor.customResources._fused) {
            t.applyStatus({ type: 'overload', stacks: 1, duration: 6, value: 0.0 });
            ui.showFloatingText(t, 'OVERLOAD', 'status-text');
        }
        return;
    }

    // SPECTRAL TRAP LAUNCHER
    if (name.includes('spectral trap')) {
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
        if (!center) return;
        // Determine deploy count (1 normally, 2 when fused) - reduced explosive potential
        const deployCount = (actor.customResources._fused ? 2 : 1);
        const baseDmg = parsed.baseDmg || 60;
        const scale = parsed.scalePct || 0.16;
        const trapRadius = 48 * (actor.customResources._containment ? 1.15 : 1.0);
        const armDelay = Math.max(0.3, (parsed.mechanics && parsed.mechanics.armDelay) || 0.9);
        // Visual: place trap(s)
        for (let i=0;i<deployCount;i++){
            ui.playVfx(center, 'vfx-poison-cloud');
        }
        // Simulate arm delay (trap becomes active after)
        await new Promise(r=>setTimeout(r, Math.floor(armDelay*1000)));
        // Apply effect to enemies within radius now (deterrent/control over burst)
        const affected = liveEnemies.filter(e => dist(e, center) <= trapRadius);
        affected.forEach(e=>{
            const dmg = Math.floor(baseDmg + ( (actor.effectiveAtk||actor.stats.atk||40) * scale ));
            // smaller raw damage and stronger control duration for a tactical tradeoff
            const res = e.receiveAction({ amount: dmg, type: 'physical', element: 'physical', attackerAccuracy: 20 });
            e.applyStatus({ type: 'snared', duration: (actor.customResources._containment?2.2:2.0), value: parsed.mechanics.snareSlow || 0.25 });
            ui.showFloatingText(e, res.amount, 'damage-number');
            ui.showFloatingText(e, 'SNARED', 'status-text');
            ui.playVfx(e, 'vfx-poison-cloud');
        });
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        // cooldown assigned by BattleSystem/parsed
        return;
    }

    // ECTO-NET BARRAGE
    if (name.includes('ecto-net')) {
        const center = decision.targets && decision.targets[0] ? decision.targets[0] : liveEnemies[0];
        if (!center) return;
        // AoE/cone treated as area for clarity; reduce per-target damage and extend entangle duration for utility
        const base = parsed.baseDmg || 48;
        const scale = parsed.scalePct || 0.12;
        const entangleDur = (lvl >= 100) ? 2.8 : parsed.mechanics.entangleDur || 2.4;
        const entangleAS = parsed.mechanics.attackSpeedRed || 0.22;
        const netRadius = 110 * (lvl >= 60 ? 1.08 : 1.0) * (actor.customResources._fused?1.5:1.0);
        const targets = liveEnemies.filter(e => dist(e, center) <= netRadius);
        targets.forEach(e=>{
            const dmg = Math.floor(base + (actor.effectiveMagicAtk||actor.stats.magicAtk||25) * scale);
            // lower attackerAccuracy to reflect emphasis on control rather than secure damage
            const res = e.receiveAction({ amount: dmg, type: 'magic', element: parsed.element || 'magic', attackerAccuracy: 18 });
            e.applyStatus({ type: 'entangled', duration: entangleDur, value: entangleAS });
            ui.showFloatingText(e, res.amount, 'damage-number');
            ui.showFloatingText(e, 'ENTANGLED', 'status-text');
            ui.playVfx(e, 'vfx-fire-storm');
        });
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // SPECTRAL STATIC PASSIVE is handled reactively elsewhere, but we can trigger small AoE here if used as active (safety)
    if (name.includes('spectral static')) {
        // Passive; give a small burst around actor
        const mech = parsed.mechanics || {};
        const shockRadius = mech.shockRadius || 100;
        const shockDmg = mech.shockDmg || 40;
        liveEnemies.filter(e => dist(e, actor) <= shockRadius).forEach(e=>{
            const res = e.receiveAction({ amount: shockDmg, type: 'magic', element: 'magic', attackerAccuracy: 18 });
            ui.showFloatingText(e, res.amount, 'damage-number');
            ui.playVfx(e, 'vfx-electric');
        });
        return;
    }

    // ULTIMATE: GHOSTLY UPGRADE 9.9
    if (name.includes('ghostly upgrade') || name.includes('upgrade 9.9')) {
        // Apply fusion buffs
        actor.customResources._fused = true;
        actor.customResources._fusionTime = (parsed.mechanics && parsed.mechanics.duration) ? parsed.mechanics.duration : 15;
        // Increase HP temporarily (apply as instant heal + maxHp buff)
        const hpBonus = Math.floor((actor.maxHp || actor.stats.maxHp || 1000) * (parsed.mechanics.hpPct || 0.30));
        actor.maxHp = (actor.maxHp || actor.stats.maxHp || 1000) + hpBonus;
        actor.currentHp = Math.min(actor.maxHp, actor.currentHp + Math.floor(hpBonus*0.2));
        // Buff atk & magic atk via status
        actor.applyStatus({ type: 'buff_atk', value: parsed.mechanics.atkPct || 0.20, duration: actor.customResources._fusionTime });
        actor.applyStatus({ type: 'buff_matk', value: parsed.mechanics.magicAtkPct || 0.20, duration: actor.customResources._fusionTime });
        ui.showFloatingText(actor, 'UPGRADED', 'status-text buff');
        ui.playVfx(actor, 'vfx-holy-light');

        // While fused, set flags for other abilities (containment/ecto doubling logic)
        actor.customResources._containment = true; // indicates Hunter's Arsenal-like augment in fused state
        // Schedule fusion end
        setTimeout(()=>{
            // If still fused and HP below threshold, auto-destabilize earlier handled externally; when fusion ends, remove buffs
            if (actor.customResources._fused) {
                // revert maxHp and remove buffs
                actor.customResources._fused = false;
                actor.customResources._containment = false;
                // Revert maxHp (simple heuristic: remove same bonus)
                actor.maxHp = Math.max(1, actor.maxHp - hpBonus);
                // If ended prematurely due to low HP, grant shield per mechanics
                if (actor.currentHp / (actor.maxHp || 1) <= parsed.mechanics.destabilizeThreshold) {
                    const shield = Math.floor((parsed.mechanics.shieldOnForcedEnd.base || 500) + ( (parsed.mechanics.shieldOnForcedEnd.scalePct||0.3) * (lvl) ));
                    actor.receiveAction({ amount: shield, effectType: 'shield' });
                    ui.showFloatingText(actor, `SHIELD ${shield}`, 'status-text buff');
                }
            }
            // cleanup statuses will naturally expire; we keep logic conservative
        }, (actor.customResources._fusionTime || 15) * 1000);
        // consume energy & set cooldown handled by BattleSystem
        actor.energy = 0;
        return;
    }

    // Fallback basic strike
    {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        const atk = actor.effectiveAtk || actor.stats.atk || 40;
        const dmg = Math.floor((parsed.baseDmg||16) + atk * (parsed.scalePct||0.2));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element || 'physical', attackerAccuracy: 16 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'slash_heavy');
    }
}