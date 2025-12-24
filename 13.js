/**
 * 13.js — Wendy Testaburger (South Park) ability module
 * Implements:
 *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
 *  - decideAction(actor, enemies, allies, battle)
 *  - executeAction(battle, actor, decision, parsed)
 *  - updatePassives(actor, dt)
 *
 * Kit includes:
 *  - Cancel Club Disapproval (single-target physical + Chill / CC extension)
 *  - Gotcha! Discredit Their Argument (magic single-target debuff 'Discredited' that scales and consumes Research Stacks)
 *  - Rally the Allies: Inspiring Speech! (shield + def buff, optional damage buff via Research Stacks)
 *  - Dignified Resolve (Poise stacking passive, Unyielding Stance)
 *  - Drama Queen: Virtue Signal! (ultimate state with periodic forced-target ability)
 *  - Signature Passive: Counter Argument (chance to negate CC and gain Research Stack + shield at high levels)
 */

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }
function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }

export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
    const key = (abilityName || '').toLowerCase();

    if (key.includes('cancel club') || key.includes('cancel culture') || key.includes('cancel club disapproval')) {
        return {
            typeCategory: 'skill',
            baseDmg: 28,
            scalePct: 0.20,
            scaleStat: 'atk',
            element: 'ice',
            multiHitCount: 1,
            cooldown: 6,
            visualKeyword: 'vfx-ice',
            mechanics: {
                applies: 'chill',
                chillDuration: 2,
                chillSlowPct: 0.20,
                chillAtkSpdPct: 0.10,
                ccExtendOnExisting: 0.5, // seconds
                evolvesAt: [10,50,100]
            }
        };
    }

    if (key.includes('gotcha') || key.includes('discredit')) {
        return {
            typeCategory: 'skill',
            baseDmg: 20,
            scalePct: 0.70, // base spec ~0.7 then upgrades increase
            scaleStat: 'magicAtk',
            element: 'magic',
            multiHitCount: 1,
            cooldown: 9,
            visualKeyword: 'vfx-magic',
            mechanics: {
                applies: 'discredited',
                duration: 5,
                atkDebuffPct: 0.15,
                matkDebuffPct: 0.15,
                researchConsumeStacks: 3,
                researchEnhanced: {
                    duration: 8,
                    scalePct: 1.10, // 110% magic atk when consuming stacks at mid levels
                    extraSlowPct: 0.20,
                    silenceOnHighRanksDuration: 2
                }
            }
        };
    }

    if (key.includes('rally the allies') || key.includes('inspiring speech')) {
        return {
            typeCategory: 'skill',
            baseDmg: 0,
            scalePct: 0.60,
            scaleStat: 'magicAtk',
            element: 'light',
            multiHitCount: 0,
            cooldown: 18,
            visualKeyword: 'vfx-holy-light',
            mechanics: {
                shieldBasePct: 0.6, // used as multiplier for magicAtk
                duration: 6,
                defBuffPct: 0.10,
                researchConsumeStacks: 2,
                researchDamageBuffPct: 0.15
            }
        };
    }

    if (key.includes('dignified resolve')) {
        return {
            typeCategory: 'passive',
            description: 'Poise stacking passive: gain Poise on applying debuff/buff; consume to become CC immune and damage reduced.',
            mechanics: {
                maxStacks: 5,
                perStackDefPct: 0.03,
                unyieldingDuration: 4,
                unyieldingMitigatePct: 0.20
            }
        };
    }

    if (key.includes('drama queen') || key.includes('virtue signal') || key.includes('ultimate')) {
        return {
            typeCategory: 'ultimate',
            baseDmg: 0,
            scalePct: 0,
            scaleStat: 'magicAtk',
            element: 'light',
            multiHitCount: 0,
            cooldown: 90,
            chargeTime: 0.8,
            visualKeyword: 'vfx-holy-light',
            mechanics: {
                duration: 12,
                statBoostPct: 0.25,
                cancelCultureCooldown: 4, // accessible ability "Cancel Culture" while ultimate active
                researchCostReduction: 1
            }
        };
    }

    if (key.includes('counter argument') || key.includes('signature passive')) {
        return {
            typeCategory: 'passive',
            description: 'Chance to negate incoming CC, gain Research Stack and reduce attacker tenacity temporarily; late-game grants shield on success.',
            mechanics: {
                counterChance: 0.30,
                tenacityReducePct: 0.10,
                grantResearch: 1,
                shieldOnSuccessAt200: { stacks: 1, shieldPct: 0.3, duration: 4 }
            }
        };
    }

    return null;
}

export function updatePassives(actor, dt) {
    // Manage Poise decay timers or fusion timers if used elsewhere
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};

    // Decay Research stacks slowly if timer expires
    Object.keys(actor.resourceDecayTimers || {}).forEach(k => {
        actor.resourceDecayTimers[k] -= dt;
        if (actor.resourceDecayTimers[k] <= 0 && actor.customResources && actor.customResources[k] > 0) {
            actor.customResources[k] = Math.max(0, actor.customResources[k] - (2 * dt));
        }
    });

    // Passive: if has 'Unyielding Stance' active, ensure CC immunity (handled via status)
}

export async function decideAction(actor, enemies, allies, battle) {
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (liveEnemies.length === 0) return { ability: { name: 'Basic Attack' }, targets: [] };

    // Prioritize ultimate when energy full
    const ult = (actor.data.abilities || []).find(a => String(a.type||'').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('drama queen'));
    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
        return { ability: ult, targets: [ ...liveEnemies.slice(0,5) ], type: 'ultimate' };
    }

    // If allies low and Rally available, use it
    const rally = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('rally the allies') || (a.name||'').toLowerCase().includes('inspiring speech'));
    if (rally && !actor.cooldownTimers?.[rally.name]) {
        const vulnerable = allies.filter(a => a && !a.isDead).sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp))[0];
        if (vulnerable && (vulnerable.currentHp / vulnerable.maxHp) < 0.6) {
            return { ability: rally, targets: [actor, vulnerable], type: 'skill' };
        }
    }

    // Use Gotcha! against the highest-attack enemy (bruiser focus)
    const gotcha = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('gotcha'));
    if (gotcha && !actor.cooldownTimers?.[gotcha.name]) {
        const strong = liveEnemies.sort((a,b) => b.pwr - a.pwr)[0];
        if (strong) return { ability: gotcha, targets: [strong], type: 'skill' };
    }

    // Use Cancel Club Disapproval to apply Chill / extend CC
    const cancel = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('cancel club'));
    if (cancel && !actor.cooldownTimers?.[cancel.name]) {
        // prefer targets that are mobile or have active CC to extend
        const ccTarget = liveEnemies.find(e => e.activeEffects && e.activeEffects.some(s => ['stun','root','slow','taunt'].includes(s.type)));
        if (ccTarget) return { ability: cancel, targets: [ccTarget], type: 'skill' };
        const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
        return { ability: cancel, targets: [nearest], type: 'skill' };
    }

    // Default: basic attack nearest
    const basic = (actor.data.abilities || []).find(a => (a.tags||[]).includes('basic')) || { name: 'Basic Attack' };
    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
    return { ability: basic, targets: nearest ? [nearest] : [], type: 'basic' };
}

export async function executeAction(battle, actor, decision, parsed) {
    if (!decision || !decision.ability) return;
    const ui = battle.uiManager;
    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
    const liveEnemies = enemies.filter(e => !e.isDead);
    if (liveEnemies.length === 0) return;

    const ability = decision.ability;
    const name = (ability.name || '').toLowerCase();
    const lvl = actor.data.level || actor.level || 1;
    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, 1, ability.tags);

    // windups
    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 120));

    // Helper: Research stack getters & consumers
    actor.customResources = actor.customResources || {};
    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
    const getResearch = () => Math.floor(actor.customResources['Research'] || 0);
    const consumeResearch = (n) => {
        actor.customResources['Research'] = Math.max(0, (actor.customResources['Research'] || 0) - n);
        actor.resourceDecayTimers['Research'] = 6;
    };

    // BASIC
    if (decision.type === 'basic' || parsed.typeCategory === 'basic') {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 30;
        const base = 16 + Math.floor((lvl - 1) * 0.2);
        const dmg = Math.floor(base + atk * 0.22);
        const res = t.receiveAction({ amount: dmg, type: 'physical', attackerAccuracy: 18 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'vfx-slash');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
        return;
    }

    // CANCEL CLUB DISAPPROVAL
    if (name.includes('cancel club')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 30;
        // Level upgrades: add scaling at Lv10 etc (handled in parsed/mechanics but we give modest level-based growth)
        let scale = parsed.scalePct || 0.2;
        if (lvl >= 10) scale += 0.10; // +0.1 atk scaling at 10 per design
        if (lvl >= 100) scale += 0.30; // big boost at 100
        const base = parsed.baseDmg || 28;
        const dmg = Math.max(6, Math.floor(base + atk * scale));
        const res = t.receiveAction({ amount: dmg, type: 'physical', element: 'ice', attackerAccuracy: 26 });
        ui.showProjectile(actor, t, 'proj-ice');
        await new Promise(r => setTimeout(r, 80));
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'vfx-ice');

        // Apply Chill
        t.applyStatus({ type: 'slow', duration: parsed.mechanics.chillDuration || 2, value: parsed.mechanics.chillSlowPct || 0.20, modifiers: { speed: -(parsed.mechanics.chillSlowPct || 0.20) } });
        t.applyStatus({ type: 'debuff_speed', duration: parsed.mechanics.chillDuration || 2, value: parsed.mechanics.chillAtkSpdPct || 0.10 });

        // If target already had CC (stun/slow/root/taunt), extend it
        const cc = t.activeEffects.find(e => ['stun','root','slow','taunt'].includes(e.type));
        if (cc) {
            cc.duration = (cc.duration || 0) + (parsed.mechanics.ccExtendOnExisting || 0.5);
            ui.showFloatingText(t, 'CC+0.5s', 'status-text');
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
        return;
    }

    // GOTCHA! DISCREDIT THEIR ARGUMENT
    if (name.includes('gotcha')) {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 20;
        let scale = parsed.scalePct || 0.7;
        let duration = parsed.mechanics.duration || 5;
        const research = getResearch();
        // upgrades: at certain thresholds, scale increases etc; emulate improvement with level tiers
        if (lvl >= 25) scale = 0.85;
        if (lvl >= 75) scale = 1.0;
        if (lvl >= 125) scale = 1.25;
        if (lvl >= 175) scale = 1.4;

        // If enough Research stacks, consume for enhanced effect
        if (research >= (parsed.mechanics.researchConsumeStacks || 3)) {
            consumeResearch(parsed.mechanics.researchConsumeStacks || 3);
            duration = parsed.mechanics.researchEnhanced?.duration || 8;
            scale = parsed.mechanics.researchEnhanced?.scalePct || scale;
            // apply extra movement slow if defined
        }

        const base = parsed.baseDmg || 20;
        const dmg = Math.max(8, Math.floor(base + matk * scale));
        const res = t.receiveAction({ amount: dmg, type: 'magic', element: 'magic', attackerAccuracy: 28 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'vfx-magic');

        // Apply 'Discredited' debuff
        const atkDeb = parsed.mechanics.atkDebuffPct || 0.15;
        const matkDeb = parsed.mechanics.matkDebuffPct || 0.15;
        t.applyStatus({ type: 'debuff_atk', duration, modifiers: { atk: -atkDeb, magicAtk: -matkDeb } });
        ui.showFloatingText(t, `DISCREDITED -${Math.round(atkDeb*100)}%`, 'status-text');

        // If research consumed & lvl>=75 apply movement slow or silence per design
        if (research >= (parsed.mechanics.researchConsumeStacks || 3) && lvl >= 75) {
            t.applyStatus({ type: 'debuff_speed', duration, value: parsed.mechanics.researchEnhanced?.extraSlowPct || 0.20 });
            if (lvl >= 175) {
                t.applyStatus({ type: 'silence', duration: parsed.mechanics.researchEnhanced?.silenceOnHighRanksDuration || 2 });
            }
            ui.showFloatingText(t, 'ENHANCED', 'status-text buff');
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 14);
        // grant Poise stack since this applied a debuff
        actor.addResource('Poise', 1, 999);
        return;
    }

    // RALLY THE ALLIES: INSPIRING SPEECH
    if (name.includes('rally the allies') || name.includes('inspiring speech')) {
        // Target self + two lowest hp allies
        const aliveFriends = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(f => !f.isDead);
        const sorted = aliveFriends.sort((a,b) => (a.currentHp/a.maxHp) - (b.currentHp/b.maxHp));
        const targets = [actor, ...(sorted.slice(0,2).filter(Boolean))];

        const matk = actor.effectiveMagicAtk || actor.stats.magicAtk || 20;
        const shieldBase = Math.floor((parsed.scalePct || 0.6) * matk + (parsed.baseDmg || 0));
        const duration = parsed.mechanics.duration || 6;
        const defBuff = parsed.mechanics.defBuffPct || 0.10;

        targets.forEach(t => {
            t.receiveAction({ amount: shieldBase, effectType: 'shield' });
            t.applyStatus({ type: 'buff_def', duration, value: defBuff });
            ui.showFloatingText(t, `SHIELD ${shieldBase}`, 'status-text buff');
            ui.playVfx(t, 'shield');
        });

        // If Research stacks >= 2 consume and grant damage buff
        const research = getResearch();
        if (research >= (parsed.mechanics.researchConsumeStacks || 2)) {
            consumeResearch(parsed.mechanics.researchConsumeStacks || 2);
            targets.forEach(t => {
                t.applyStatus({ type: 'buff_atk', duration, value: parsed.mechanics.researchDamageBuffPct || 0.15 });
                ui.showFloatingText(t, 'DMG +15%', 'status-text buff');
            });
        }

        actor.energy = Math.min(actor.maxEnergy, actor.energy + 14);
        // Grant Poise for buffing allies
        actor.addResource('Poise', 1, 999);
        return;
    }

    // ULTIMATE: DRAMA QUEEN: VIRTUE SIGNAL
    if (name.includes('drama queen') || name.includes('virtue signal') || decision.type === 'ultimate') {
        // Grant self buffs for duration and provide a periodic 'Cancel Culture' forced-target every n seconds
        const dur = parsed.mechanics.duration || 12;
        const boost = parsed.mechanics.statBoostPct || 0.25;
        actor.applyStatus({ type: 'buff_atk', value: boost, duration: dur });
        actor.applyStatus({ type: 'buff_def', value: boost, duration: dur });
        actor.applyStatus({ type: 'buff_matk', value: boost, duration: dur });
        actor.applyStatus({ type: 'buff_mdef', value: boost, duration: dur });
        ui.showFloatingText(actor, 'DRAMA QUEEN', 'status-text buff');
        ui.playVfx(actor, 'vfx-holy-light');

        // Reduce research cost effect by setting a transient flag
        actor.customResources = actor.customResources || {};
        actor.customResources._dramaActive = dur;
        actor.resourceDecayTimers._dramaActive = dur;

        // Also spawn an interval to force-cast a "Cancel Culture" like effect on cooldown (4s) during ultimate
        const intervalMs = (parsed.mechanics.cancelCultureCooldown || 4) * 1000;
        let casts = Math.floor(dur / (intervalMs / 1000));
        const castOnce = async () => {
            if (actor.isDead) return;
            // pick enemy to force to attack lowest hp ally
            const targetEnemy = pickRandom(battle.enemies.filter(e => !e.isDead));
            if (!targetEnemy) return;
            // find ally with lowest hp (on actor's team)
            const low = (actor.team === 'ally' ? battle.allies : battle.enemies).filter(a=>!a.isDead).sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
            if (!low) return;
            // If targetEnemy is immune to forced actions, stun them for 2s as backlash
            const isImmune = targetEnemy.activeEffects.some(e => e.type === 'taunt' || e.type === 'stun_immune' || e.type === 'invulnerability');
            if (isImmune) {
                targetEnemy.applyStatus({ type: 'stun', duration: 2 });
                ui.showFloatingText(targetEnemy, 'BACKFIRE STUN', 'status-text');
                ui.playVfx(targetEnemy, 'vfx-explosion');
            } else {
                // Force the enemy to attack chosen ally once: simulate by dealing a small forced-hit to that ally from enemy
                const fauxDmg = Math.floor((targetEnemy.effectiveAtk || targetEnemy.stats.atk || 30) * 0.5);
                const res = low.receiveAction({ amount: fauxDmg, type: 'physical', attackerAccuracy: 10 });
                ui.showFloatingText(low, res.amount, 'damage-number');
                ui.showFloatingText(low, `FORCED HIT`, 'status-text');
            }
        };

        // schedule casts (non-blocking)
        for (let i = 0; i < casts; i++) {
            setTimeout(() => castOnce(), i * intervalMs);
        }

        actor.energy = 0;
        return;
    }

    // SIGNATURE PASSIVE: Counter Argument (can be invoked reactively elsewhere); here allow manual invocation if needed
    if (name.includes('counter argument') || parsed.typeCategory === 'passive') {
        // Passive does not actively execute here; grant tiny resource to simulate activation if called
        actor.addResource('Research', 1, 999);
        actor.resourceDecayTimers['Research'] = 6;
        // At very high skill level (200-ish) grant shield upon success (handled by passive triggers in battle system ideally)
        if ((actor.data.skills && actor.data.skills[ability.name] || 1) >= 200) {
            const shield = Math.floor((actor.maxHp || actor.stats.maxHp || 1000) * 0.02 + (actor.effectiveMagicAtk || actor.stats.magicAtk || 0) * 0.3);
            actor.receiveAction({ amount: shield, effectType: 'shield' });
            ui.showFloatingText(actor, `SHIELD ${shield}`, 'status-text buff');
        }
        return;
    }

    // Fallback simple strike
    {
        const t = decision.targets && decision.targets[0] || liveEnemies[0];
        if (!t) return;
        const atk = actor.effectiveAtk || actor.stats.atk || 30;
        const dmg = Math.floor(14 + atk * 0.25);
        const res = t.receiveAction({ amount: dmg, type: 'physical', attackerAccuracy: 18 });
        ui.showFloatingText(t, res.amount, 'damage-number');
        ui.playVfx(t, 'vfx-slash');
        actor.energy = Math.min(actor.maxEnergy, actor.energy + 8);
    }
}