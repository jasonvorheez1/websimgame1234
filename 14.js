/**
 * 14.js — Kyubey (Madoka Magica) ability module
 * Exports:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Implements:
 *  - Basic Attack (ranged wind basic)
 *  - Enticing Offer: A Soul Gem's Promise (Contract buff with Despair stacking)
 *  - Soul Gem Resonance: Echoes of Potential (heal/shield + despair reduce/apply)
 *  - Inhibition Field: Suppressing Unforeseen Variables (ultimate, area drain)
 *  - Passive: Incubator's Calculation (energy regen, contract energy generation, triggers on despair/birth)
 *  - Signature Passive: Incubator's Resolve logic included as passive mechanics applied during updates/receive hooks
 */

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName||'').toLowerCase();

    if (key.includes('basic attack')) {
        return {
            typeCategory: 'basic',
            baseDmg: 18,
            scalePct: 0.22,
            scaleStat: 'atk',
            element: 'wind',
            multiHitCount: 1,
            cooldown: 1.0,
            visualKeyword: 'proj-magic'
        };
    }

    if (key.includes('enticing offer') || key.includes('contract')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicAtk',
            element: 'light',
            multiHitCount: 0,
            cooldown: 18,
            costEnergy: 30,
            visualKeyword: 'vfx-holy-light',
            mechanics: {
                contractDuration: 8,
                damageBuffPct: 0.30,
                healingReceivedPct: 0.20,
                despairPerTick: 1,
                despairTickInterval: 2,
                despairMax: 10,
                renewExtraDuration: 4,
                renewInstantDespair: 2,
                selfEffectiveness: 0.5
            }
        };
    }

    if (key.includes('soul gem resonance')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.45,
            scaleStat: 'magicAtk',
            element: 'wind',
            multiHitCount: 0,
            cooldown: 12,
            costEnergy: 20,
            visualKeyword: 'vfx-magic',
            mechanics: {
                healOverSeconds: 3,
                healScalePct: 1.0, // multiplied by scalePct * magicAtk
                despairReduce: 2,
                despairOnCleanTarget: 1,
                shieldPctNoDespair: 0.10,
                healingReductionPerDespairPct: 0.20
            }
        };
    }

    if (key.includes('inhibition field')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicAtk',
            element: 'wind',
            multiHitCount: 0,
            cooldown: 90,
            costEnergy: 50,
            visualKeyword: 'vfx-dark-void',
            mechanics: {
                duration: 6,
                enemyHealingReductionPct: 0.50,
                enemySpeedReducePct: 0.30,
                alliesDespairPerSec: 2, // stacks per second
                allyDamagePerDespairPct: 0.20, // per stack
                drainPerSec: 10, // energy per second
                immuneWhileActive: true,
                minEnergyToCast: 50
            }
        };
    }

    if (key.includes("incubator's calculation") || key.includes('passive')) {
        return {
            typeCategory: 'passive',
            description: 'Energy gen & triggers: base regen and contract ally generation; energy on despair threshold and permanent magic atk on contracted ally death.',
            mechanics: {
                baseEnergyPerSec: 5,
                contractEnergyPerSec: 2,
                gainOnDespairThreshold: 50,
                despairThresholdStacks: 10,
                energyOnThreshold: 50,
                magicAtkOnContractDeath: 10,
                cooldownResetOnContractDeath: true
            }
        };
    }

    if (key.includes("incubator's resolve") || key.includes('signature')) {
        return {
            typeCategory: 'passive',
            description: 'Signature: tenacity/evasion base and damage redirection while allies are contracted; despair modifies magic atk/tenacity and stun immunity at 10 stacks.',
            mechanics: {
                baseTenacity: 15,
                baseEvasion: 10,
                redirectPct: 0.10,
                redirectPctIfContracted: 0.05,
                despairMagicAtkReducePctPerStack: 0.02,
                despairTenacityPerStack: 3,
                stunImmuneAtStacks: 10
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    // Passive energy generation & decay of resource timers
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    // Base regen
    const parsedPassive = actor.data.abilities?.find(a=> (a.name||'').toLowerCase().includes("incubator's calculation"));
    const baseRegen = (parsedPassive && parsedPassive.upgrades) ? 5 : 5;
    const contractRegen = 2;

    // Increase energy per second (apply dt)
    let gain = baseRegen * dt;
    // Count contracted allies
    const allies = (actor.battleSystem && actor.battleSystem.allies) ? actor.battleSystem.allies.filter(a=>!a.isDead) : [];
    const contracted = allies.filter(a => a.activeEffects && a.activeEffects.some(e => e.type === 'contract'));
    gain += contracted.length * contractRegen * dt;
    if (!actor.customResources.energy) actor.customResources.energy = actor.energy || 0; // local mirror not strictly necessary
    actor.energy = Math.min(actor.maxEnergy, (actor.energy || 0) + gain);

    // If any ally's despair reached threshold, award energy and clear that flag with small cooldown
    for (const a of allies) {
        const despair = (a.customResources && a.customResources['Despair']) || (a.activeEffects && a.activeEffects.filter(e=>e.type==='despair').reduce((s,e)=>s+(e.stacks||1),0)) || 0;
        if (despair >= 10 && !(a._despairRewarded)) {
            actor.energy = Math.min(actor.maxEnergy, actor.energy + 50);
            a._despairRewarded = true;
            setTimeout(()=>{ a._despairRewarded = false; }, 4000);
        }
    }

    // Decay timers for customResources (like Research in other modules) — generic
    for (const k in actor.resourceDecayTimers) {
        actor.resourceDecayTimers[k] -= dt;
        if (actor.resourceDecayTimers[k] <= 0) delete actor.resourceDecayTimers[k];
    }

    // Apply signature passive effects that are continuous: adjust magic atk by despair stacks, grant tenacity
    const sig = getParsedAbility(actor.data.name, "Incubator's Resolve") || {};
    const mech = sig.mechanics || {};
    // compute despair stacks on Kyubey
    const kyDespair = Math.floor(actor.customResources['Despair'] || 0);
    // apply magic atk reduction via passiveModifiers (percent)
    actor.passiveModifiers = actor.passiveModifiers || {};
    actor.passiveModifiers.magicAtkPercentFromDespair = -(mech.despairMagicAtkReducePctPerStack || 0.02) * kyDespair;
    actor.passiveModifiers.tenacityFromDespair = (mech.despairTenacityPerStack || 3) * kyDespair;
    // stun immunity at threshold
    if (kyDespair >= (mech.stunImmuneAtStacks || 10)) {
        if (!actor.activeEffects.some(e => e.type === 'stun_immune')) {
            actor.applyStatus({ type: 'stun_immune', duration: Infinity });
        }
    } else {
        actor.activeEffects = actor.activeEffects.filter(e => e.type !== 'stun_immune');
    }
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e=>!e.isDead);
    const liveAllies = allies.filter(a=>!a.isDead && a !== actor);

    if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Force-cast ultimate if active conditions: enough energy and tactical value (many enemies)
    const ultimate = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('inhibition field'));
    if (ultimate && actor.energy >= 50 && !actor.cooldownTimers?.[ultimate.name]) {
        // prefer when 3+ enemies or when many allies already contracted (to exploit synergy)
        const contractedAllies = allies.filter(a => a.activeEffects && a.activeEffects.some(e => e.type === 'contract')).length;
        if (liveEnemies.length >= 3 || contractedAllies >= 2) return { ability: ultimate, targets: [], type: 'ultimate' };
    }

    // Use Soul Gem Resonance to heal low allies or to reduce despair stacks
    const resonance = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('soul gem resonance'));
    if (resonance && !actor.cooldownTimers?.[resonance.name] && actor.energy >= (resonance.costEnergy || 20)) {
        // pick ally with highest despair stacks or lowest HP
        let candidate = liveAllies.sort((a,b)=>{
            const da = (a.customResources?.Despair || 0), db = (b.customResources?.Despair || 0);
            const hpa = a.currentHp/a.maxHp, hpb = b.currentHp/b.maxHp;
            if (da !== db) return db - da;
            return hpa - hpb;
        })[0];
        if (!candidate) candidate = actor; // heal self fallback allowed (Kyubey cannot heal himself per signature, but module can still cast on self with effects)
        return { ability: resonance, targets: [candidate], type: 'skill' };
    }

    // Use Enticing Offer to buff a strong ally (or self at reduced effectiveness) if not on cooldown and energy available
    const enticing = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('enticing offer'));
    if (enticing && !actor.cooldownTimers?.[enticing.name] && actor.energy >= (enticing.costEnergy || 30)) {
        // prefer high-damage allies or those with low despair so they get benefit
        const bestAlly = liveAllies.sort((a,b)=> (b.pwr || 0) - (a.pwr || 0))[0];
        if (bestAlly) return { ability: enticing, targets: [bestAlly], type: 'skill' };
        // else if no allies, consider casting on self (reduced)
        return { ability: enticing, targets: [actor], type: 'skill' };
    }

    // Default: basic attack nearest enemy
    const basic = (actor.data.abilities||[]).find(a => (a.name||'').toLowerCase().includes('basic')) || { name: 'Basic Attack' };
    const nearest = liveEnemies.sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: basic, targets: [nearest], type: 'basic' };
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

    // Fetch parsed if not provided
    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, 1, ability.tags);

    // Basic attack implementation
    if (parsed.typeCategory === 'basic' || name.includes('basic attack')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 20;
        const base = parsed.baseDmg || 18;
        const dmg = Math.floor(base + atk * (parsed.scalePct || 0.22));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element, attackerAccuracy: 18 });
        ui.showProjectile(actor, t, parsed.element || 'physical');
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, parsed.visualKeyword || 'proj-magic');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
        return;
    }

    // ENTICING OFFER: CONTRACT
    if (name.includes('enticing offer') || name.includes('contract')) {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        if (!target) return;
        const mech = parsed.mechanics || {};
        // Energy cost enforcement
        if (parsed.costEnergy && actor.energy < parsed.costEnergy) return;
        if (parsed.costEnergy) actor.energy = Math.max(0, actor.energy - parsed.costEnergy);

        // If renewing contract on same target: extend + instant despair on target
        const existing = target.activeEffects.find(e => e.type === 'contract');
        if (existing) {
            existing.duration = (existing.duration || 0) + (mech.renewExtraDuration || 4);
            // instant despair stacks
            const ds = target.customResources || (target.customResources = {});
            ds['Despair'] = (ds['Despair'] || 0) + (mech.renewInstantDespair || 2);
            target.resourceDecayTimers = target.resourceDecayTimers || {};
            target.resourceDecayTimers['Despair'] = 6;
            ui.showFloatingText(target, `+${mech.renewInstantDespair || 2} DESPAIR`, 'status-text');
        } else {
            // Apply contract status
            target.applyStatus({ type: 'contract', duration: mech.contractDuration || 8, modifiers: { damageBoost: mech.damageBuffPct || 0.30, healingReceived: mech.healingReceivedPct || 0.20 } });
            // initialize per-target ticking of despair stacks
            target._contractTick = target._contractTick || 0;
            ui.showFloatingText(target, `CONTRACTED (+${Math.round((mech.damageBuffPct||0)*100)}% DMG)`, 'status-text buff');
        }

        // If cast on self reduce effectiveness
        if (target === actor && mech.selfEffectiveness) {
            // adjust modifier values to half in-place
            const c = target.activeEffects.find(e=>e.type==='contract');
            if (c) {
                c.modifiers.damageBoost = (c.modifiers.damageBoost || 0) * (mech.selfEffectiveness || 0.5);
                c.modifiers.healingReceived = (c.modifiers.healingReceived || 0) * (mech.selfEffectiveness || 0.5);
                ui.showFloatingText(target, 'SELF CONTRACT (50%)', 'status-text');
            }
        }

        // small cast feedback
        ui.playVfx(target, 'vfx-holy-light');
        actor.energy = Math.max(0, actor.energy); // already deducted
        return;
    }

    // SOUL GEM RESONANCE: heal over time + despair reduce or shield
    if (name.includes('soul gem resonance') || name.includes('echoes')) {
        const target = decision.targets && decision.targets[0] ? decision.targets[0] : actor;
        if (!target) return;
        if (parsed.costEnergy && actor.energy < parsed.costEnergy) return;
        if (parsed.costEnergy) actor.energy = Math.max(0, actor.energy - parsed.costEnergy);

        const mech = parsed.mechanics || {};
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 20;
        // Determine current despair stacks on target
        const despair = Math.floor((target.customResources && target.customResources['Despair']) || 0);
        // healing reduction per stack
        const healReduction = (mech.healingReductionPerDespairPct || 0.20) * despair;
        // base heal amount (total over healOverSeconds)
        const healTotal = Math.floor(( (parsed.scalePct || 0.45) * matk ) * (mech.healScalePct || 1.0) * (1 - healReduction));
        // If no despair, apply shield instead of despair reduction
        if (despair === 0) {
            const shieldAmt = Math.floor((target.maxHp || target.stats?.maxHp || 1000) * (mech.shieldPctNoDespair || 0.10));
            target.receiveAction({ amount: shieldAmt, effectType: 'shield' });
            ui.showFloatingText(target, `SHIELD ${shieldAmt}`, 'status-text buff');
            ui.playVfx(target, 'shield');
        } else {
            // reduce despair stacks by 2 (or as upgrade)
            const reduce = mech.despairReduce || mech.despairReduce === 0 ? mech.despairReduce : 2;
            if (target.customResources && target.customResources['Despair']) {
                target.customResources['Despair'] = Math.max(0, target.customResources['Despair'] - reduce);
            } else {
                // also remove active effects of type despair if present
                target.activeEffects = (target.activeEffects || []).map(e => {
                    if (e.type === 'despair') {
                        e.stacks = Math.max(0, (e.stacks || 1) - reduce);
                        e.duration = Math.max(0, (e.duration || 0) - 0.5);
                    }
                    return e;
                }).filter(e => !((e.type === 'despair') && (e.stacks <= 0)));
            }
            ui.showFloatingText(target, `- ${reduce} DESPAIR`, 'status-text buff');
        }

        // Apply heal over time: schedule ticks across healOverSeconds
        const secs = mech.healOverSeconds || 3;
        const perTick = Math.floor(healTotal / Math.max(1, Math.floor(secs)));
        for (let i=0;i<Math.floor(secs);i++) {
            setTimeout(()=> {
                if (target.isDead) return;
                const healed = target.receiveAction({ amount: perTick, effectType: 'heal' });
                ui.showFloatingText(target, `+${healed.amount}`, 'damage-number heal');
                ui.playVfx(target, 'vfx-heal');
            }, i * 1000);
        }

        // If target wasn't under contract, apply 1 despair stack
        if (!(target.activeEffects || []).some(e=>e.type==='contract')) {
            target.customResources = target.customResources || {};
            target.customResources['Despair'] = (target.customResources['Despair'] || 0) + (mech.despairOnCleanTarget || 1);
            target.resourceDecayTimers = target.resourceDecayTimers || {};
            target.resourceDecayTimers['Despair'] = 6;
            ui.showFloatingText(target, `+${mech.despairOnCleanTarget || 1} DESPAIR`, 'status-text');
        }

        actor.energy = Math.max(0, actor.energy);
        return;
    }

    // INHIBITION FIELD ultimate
    if (name.includes('inhibition field') || decision.type === 'ultimate') {
        const mech = parsed.mechanics || {};
        // cost & min requirement
        if (parsed.costEnergy && actor.energy < (parsed.costEnergy || 50)) return;
        if (parsed.costEnergy) actor.energy = Math.max(0, actor.energy - parsed.costEnergy);

        // Apply field status to enemies and allies within radius (centered on actor)
        const radius = 220;
        const duration = mech.duration || 6;
        const enemiesIn = (battle.enemies || []).filter(e => !e.isDead && Math.hypot(e.x - actor.x, e.y - actor.y) <= radius);
        const alliesIn = (battle.allies || []).filter(a => !a.isDead && Math.hypot(a.x - actor.x, a.y - actor.y) <= radius);

        // For the duration, create an interval that drains energy and applies effects each second
        let active = true;
        ui.playVfx(actor, 'vfx-dark-void');
        ui.showFloatingText(actor, 'INHIBITION FIELD', 'status-text buff');
        actor.applyStatus({ type: 'invulnerability', duration }); // Kyubey immune to status while active per design, use invulnerability flag
        // schedule periodic drain and effects
        let elapsed = 0;
        const tick = async () => {
            if (!active) return;
            // per-second application
            enemiesIn.forEach(en => {
                if (en.isDead) return;
                en.applyStatus({ type: 'debuff_heal', duration: 1.1, value: mech.enemyHealingReductionPct || 0.5 });
                en.applyStatus({ type: 'debuff_speed', duration: 1.1, value: mech.enemySpeedReducePct || 0.3 });
            });
            alliesIn.forEach(al => {
                if (al.isDead) return;
                // allies gain despair stacks per second
                al.customResources = al.customResources || {};
                al.customResources['Despair'] = (al.customResources['Despair'] || 0) + (mech.alliesDespairPerSec || 2);
                al.resourceDecayTimers = al.resourceDecayTimers || {};
                al.resourceDecayTimers['Despair'] = 6;
                // allies gain damage bonus per despair stack (handled by their getModifierSum if implemented or via status)
                al.applyStatus({ type: 'buff_atk', duration: 1.1, value: ((al.customResources['Despair'] || 0) * (mech.allyDamagePerDespairPct || 0.20)) });
            });
            // Drain energy
            actor.energy = Math.max(0, actor.energy - (mech.drainPerSec || 10));
            elapsed += 1;
            if (actor.energy <= 0) {
                // collapse field early
                active = false;
                ui.showFloatingText(actor, 'FIELD COLLAPSED (ENERGY)', 'status-text');
                return;
            }
            if (elapsed >= duration) {
                active = false;
                return;
            } else {
                setTimeout(tick, 1000);
            }
        };
        // start ticks
        setTimeout(tick, 1000);

        // set cooldown and drain enforcement handled by BattleSystem via cooldownTimers assignment
        actor.cooldownTimers = actor.cooldownTimers || {};
        actor.cooldownTimers[ability.name] = parsed.cooldown || 90;
        return;
    }

    // Passive signature invocation or fallback
    // Fallback: do nothing or small energy regen
    actor.energy = Math.min(actor.maxEnergy, actor.energy + 2);
}