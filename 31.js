/*
  Local custom ability module for export_id 31 (Toph).
  Implements: decideAction, getParsedAbility, executeAction, updatePassives
*/

export async function decideAction(actor, enemies = [], allies = [], battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    const liveAllies = allies.filter(a => !a.isDead && a !== actor);
    if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, type: 'basic', targets: [] };

    // Prefer defensive shelter when multiple allies clustered and ability off cooldown
    const shelter = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('seismic shelter'));
    if (shelter && !actor.cooldownTimers?.[shelter.name]) {
        const alliesNearby = liveAllies.filter(a => Math.hypot(a.x - actor.x, a.y - actor.y) < 160).length;
        if (alliesNearby >= 2 && (actor.currentHp / actor.maxHp) < 0.85) {
            return { ability: shelter, type: 'skill', targets: [actor] };
        }
    }

    // Use Seismic Pulse to interrupt/mobility control when target is in range and off cooldown
    const pulse = (actor.data?.abilities || []).find(a => (a.name||'').toLowerCase().includes('seismic pulse'));
    if (pulse && !actor.cooldownTimers?.[pulse.name]) {
        // prefer visible nearest or lowest def if high level upgrades present
        const priority = liveEnemies.sort((a,b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))[0];
        if (priority) return { ability: pulse, type: 'skill', targets: [priority] };
    }

    // If ultimate ready, use on clustered / low HP single target
    const ult = (actor.data?.abilities || []).find(a => String(a.type || '').toLowerCase() === 'ultimate');
    if (ult && actor.energy >= actor.maxEnergy && !actor.cooldownTimers?.[ult.name]) {
        const clusterCenter = liveEnemies.sort((a,b)=> {
            const ca = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-a.x,e.y-a.y) < 160 ? 1:0),0);
            const cb = liveEnemies.reduce((s,e)=> s + (Math.hypot(e.x-b.x,e.y-b.y) < 160 ? 1:0),0);
            return cb - ca;
        })[0] || liveEnemies[0];
        return { ability: ult, type: 'ultimate', targets: clusterCenter ? [clusterCenter] : [liveEnemies[0]] };
    }

    // Passive awareness: if any stealthed enemy inside seismic sense, prefer reveal (engine-level passive handles reveal) - fallback basic
    const basic = (actor.data?.abilities || []).find(a => (a.tags || []).includes('atk')) || { name: 'Basic Attack' };
    const target = liveEnemies.sort((a,b)=> Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: basic, type: 'basic', targets: [target] };
}

export function updatePassives(actor, dt) {
    if (actor.isDead) return;
    if (!actor.customResources) actor.customResources = {};

    // Fortitude stacks: gain on damage, refresh duration to 4s, max 5 stacks
    if (typeof actor._fortTick === 'undefined') actor._fortTick = 0;
    actor._fortTick += dt;

    // scanning recent damage flagged by engine via customResources delta; keep simple: decay stacks over time
    if (!actor._fortDecayTimer) actor._fortDecayTimer = 0;
    actor._fortDecayTimer += dt;
    if (actor._fortDecayTimer >= 1.0) {
        actor._fortDecayTimer = 0;
        // gentle decay: reduce by 0.25 stacks per second out of combat
        if (!(actor.battleSystem && actor.battleSystem.enemies.some(e=>!e.isDead))) {
            actor.customResources['Fortitude'] = Math.max(0, (actor.customResources['Fortitude'] || 0) - 0.25);
        }
    }

    // Seismic Sense ambient values exposed for UI: accuracy bonus and reveal radius
    actor.customResources['SeismicSenseRadius'] = actor.customResources['SeismicSenseRadius'] || 30;
    actor.customResources['SeismicSenseAccuracyPct'] = actor.customResources['SeismicSenseAccuracyPct'] || 15;

    // Signature: Tenacity & Evasion flat bonuses
    actor.customResources['SignatureTenacityFlat'] = actor.customResources['SignatureTenacityFlat'] || 12;
    actor.customResources['SignatureEvasionFlat'] = actor.customResources['SignatureEvasionFlat'] || 8;
}

export async function getParsedAbility(ability, actor) {
    const name = String(ability.name || '').toLowerCase();

    if (name.includes('basic attack')) {
        return { typeCategory: 'basic', baseDmg: 0, scalePct: 1.0, scaleStat: 'atk', element: 'earth', multiHitCount: 1, cooldown: 1.8, visualKeyword: 'proj_sword' };
    }

    if (name.includes('seismic pulse')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.6,
            scaleStat: 'atk',
            isSingleTarget: true,
            cooldown: 6,
            statuses: [{ type: 'debuff_speed', duration: 2, value: 0.15, name: 'Seismic_Slow', applyOnLastHitOnly: false }],
            mechanics: { slowLinearDecay: true, slowDuration: 2, noStackIfExistingSlow: true, revealPriority: true },
            visualKeyword: 'vfx_beam'
        };
    }

    if (name.includes('seismic shelter')) {
        return {
            typeCategory: 'skill',
            isAoE: true,
            targeting: 'area',
            auraRadius: 30 * 40,
            baseShield: 0,
            mechanics: { shieldPercentOfDef: 1.20, duration: 5, displaceEnemies: true },
            cooldown: 24,
            visualKeyword: 'vfx_earth'
        };
    }

    if (name.includes('seismic sense') && ability.type && ability.type.toLowerCase().includes('passive')) {
        return {
            typeCategory: 'passive',
            statuses: [
                { type: 'buff_accuracy_pct', duration: Infinity, value: 0.15 },
                { type: 'buff_luck_flat', duration: Infinity, value: 6 }
            ],
            mechanics: { revealStealthRadius: 30 * 40, revealPreventsStealthTargeting: true }
        };
    }

    if (name.includes('resolute bind') || (ability.type || '').toLowerCase() === 'ultimate') {
        return {
            typeCategory: 'ultimate',
            isSingleTarget: true,
            scalePct: 1.0,
            scaleStat: 'atk',
            element: 'wind',
            cooldown: 75,
            mechanics: { benefitsFromLuck: true, burst: true },
            visualKeyword: 'vfx_slash_heavy'
        };
    }

    if (name.includes('signature')) {
        return {
            typeCategory: 'passive',
            mechanics: { fortitudeStackPct: 0.03, fortitudeDuration: 4, fortitudeMax: 5, flatTenacity: 12, flatEvasion: 8 },
            statuses: []
        };
    }

    return null;
}

export async function executeAction(battle, actor, decision, parsed) {
    const ui = battle.uiManager;
    const ability = decision.ability;
    const name = String(ability.name || '').toLowerCase();
    const targets = (decision.targets && Array.isArray(decision.targets)) ? decision.targets : (decision.targets ? [decision.targets] : []);
    const primary = targets[0];
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // Seismic Pulse
    if (name.includes('seismic pulse')) {
        if (!primary) return;
        ui.showAbilityName(actor, 'SEISMIC PULSE');
        ui.playVfx(actor, 'vfx_beam');
        await wait(220);
        const dmg = Math.floor((actor.effectiveAtk || actor.stats.atk || 0) * (parsed.scalePct || 0.6));
        const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'earth' });
        ui.showFloatingText(primary, res.amount, 'damage-number');
        // slow handling: if target already slowed, refresh to full duration else apply slow
        const hasSlow = primary.activeEffects.some(e => e.type === 'debuff_speed');
        if (hasSlow && parsed.mechanics && parsed.mechanics.noStackIfExistingSlow) {
            // extend existing slow durations to parsed slowDuration
            primary.activeEffects.forEach(e => { if (e.type === 'debuff_speed') e.duration = Math.max(e.duration, parsed.mechanics.slowDuration || 2); });
            ui.showFloatingText(primary, 'SLOW EXTENDED', 'status-text');
        } else {
            primary.applyStatus({ type: 'debuff_speed', value: parsed.statuses?.[0]?.value || 0.15, duration: parsed.statuses?.[0]?.duration || 2, name: 'Seismic_Slow' });
        }
        actor.cooldownTimers[ability.name] = parsed.cooldown || 6;
        return;
    }

    // Seismic Shelter
    if (name.includes('seismic shelter')) {
        ui.showAbilityName(actor, 'SEISMIC SHELTER');
        ui.playVfx(actor, 'vfx_earth');
        // Create a temporary "barrier" object represented as a lightweight effect: apply shield to allies inside radius and displace enemies
        const radiusPx = (parsed.auraRadius || (30 * 40));
        const alliesPool = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a => !a.isDead);
        const enemiesPool = (actor.team === 'ally' ? battle.enemies : battle.allies).filter(e => !e.isDead);

        // Shield value: X + 120% of actor.def (if parsed.baseShield absent, compute from def)
        const shieldBase = Math.floor((actor.stats.def || actor.effectiveDef || 0) * (parsed.mechanics?.shieldPercentOfDef || 1.2));
        alliesPool.forEach(a => {
            const dist = Math.hypot(a.x - actor.x, a.y - actor.y);
            if (dist <= radiusPx) {
                a.applyStatus({ type: 'shield', value: shieldBase, duration: parsed.mechanics?.duration || 5, name: 'Seismic_Shelter_Shield' });
                ui.showFloatingText(a, 'SHELTER', 'status-text buff');
                ui.playVfx(a, 'vfx_shield');
            }
        });

        // Displace enemies outward to nearest free space (simple nudge)
        enemiesPool.forEach(e => {
            const dist = Math.hypot(e.x - actor.x, e.y - actor.y);
            if (dist <= radiusPx) {
                const dx = e.x - actor.x;
                const dy = e.y - actor.y;
                const mag = Math.hypot(dx, dy) || 1;
                const nx = dx / mag;
                const ny = dy / mag;
                e.x += Math.round(nx * 120);
                e.y += Math.round(ny * 40);
                e.applyStatus({ type: 'debuff_speed', value: 0.12, duration: 1.2, name: 'Shelter_PushSlow' });
                ui.showFloatingText(e, 'DISPLACED', 'status-text');
            }
        });

        // Barrier exists conceptually; if enemies reduce its HP to 0 it would crumble - engine-level not implemented here.
        actor.cooldownTimers[ability.name] = parsed.cooldown || 24;
        return;
    }

    // Seismic Sense passive: handled by updatePassives / engine integration - no active execute

    // Resolute Bind (Ultimate)
    if (name.includes('resolute bind') || (decision.type === 'ultimate')) {
        if (!primary) return;
        ui.showAbilityName(actor, 'RESOLUTE BIND');
        ui.playVfx(primary, 'vfx_slash_heavy');
        // Wind-element single target burst influenced by luck for crit synergy
        const luck = Number(actor.stats.luck || 0);
        const luckBonus = 1 + Math.min(0.5, luck / 200);
        const dmg = Math.floor((actor.effectiveAtk || actor.stats.atk || 0) * (parsed.scalePct || 1.0) * luckBonus);
        const res = primary.receiveAction({ amount: dmg, type: 'physical', attackerElement: 'wind', isCrit: (Math.random() * 100) < (actor.stats.luck || 0) });
        ui.showFloatingText(primary, res.amount, `damage-number ${res.isCrit ? 'crit' : ''}`);
        // small short slow or minor control to complement utility
        primary.applyStatus({ type: 'debuff_speed', value: 0.10, duration: 1.2, name: 'Bind_Slow' });
        actor.energy = 0;
        actor.cooldownTimers[ability.name] = parsed.cooldown || 75;
        return;
    }

    // Basic fallback: let engine handle but award small seismic sense uptime feedback
    return;
}