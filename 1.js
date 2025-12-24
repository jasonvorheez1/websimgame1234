+/**
+ * 1.js — Knuckles (Sonic) ability module
+ * Exports:
+ *  - getParsedAbility(charName, abilityName, description, skillLevel, tags)
+ *  - decideAction(actor, enemies, allies, battle)
+ *  - executeAction(battle, actor, decision, parsed)
+ *  - updatePassives(actor, dt)
+ *
+ * Implements kit described in the DB: Basic Attack, Maximum Heat Knuckles Attack,
+ * Drill Claw Excavation, Guardian's Resolve (passive), Angel Island Avalanche (ultimate),
+ * and signature Echidna Resilience passive.
+ */
+
+function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
+function pickRandom(arr){ return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
+function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }
+
+export function getParsedAbility(charName, abilityName, description = "", skillLevel = 1, tags = []) {
+    const key = (abilityName||'').toLowerCase();
+    const lvlMult = 1 + ((skillLevel - 1) * 0.10);
+
+    if (key.includes('basic')) {
+        return {
+            typeCategory: 'basic',
+            baseDmg: Math.floor(14 * lvlMult),
+            scalePct: 0.22 * lvlMult,
+            scaleStat: 'atk',
+            element: 'fire',
+            multiHitCount: 1,
+            cooldown: 1.0,
+            visualKeyword: 'proj-fire'
+        };
+    }
+
+    if (key.includes('maximum heat') || key.includes('maximum heat knuckles')) {
+        return {
+            typeCategory: 'skill',
+            baseDmg: Math.floor(40 * lvlMult),
+            scalePct: 0.30 * lvlMult,
+            scaleStat: 'atk',
+            element: 'fire',
+            multiHitCount: 1,
+            cooldown: 6,
+            mechanics: {
+                burnChance: 0.10,
+                burnDur: 3,
+                burnPerSecPctOfAtk: 0.02,
+                knockback: 1,
+                preferLowestDef: true,
+                empowerBelowHpPct: 0.5 // doubles burn chance
+            },
+            visualKeyword: 'vfx-slash-heavy'
+        };
+    }
+
+    if (key.includes('drill claw')) {
+        return {
+            typeCategory: 'skill',
+            baseDmg: Math.floor(32 * lvlMult),
+            scalePct: 0.28 * lvlMult,
+            scaleStat: 'atk',
+            element: 'earth',
+            multiHitCount: 1,
+            cooldown: 8,
+            mechanics: {
+                aoeRadius: 100,
+                stunDur: 1.0,
+                defReducePct: 0.12,
+                defReduceDur: 4,
+                prioritizeHighestHp: true
+            },
+            visualKeyword: 'vfx-earth'
+        };
+    }
+
+    if (key.includes("guardian's resolve") || key.includes('guardian stance')) {
+        return {
+            typeCategory: 'passive',
+            description: 'Passive damage reduction that scales as health is missing; grants Tenacity below 50%.',
+            mechanics: {
+                baseReductionPct: 0.05,
+                per25MissingPct: 0.05,
+                maxAdditionalPct: 0.15,
+                tenacityOnBelow50: 0.0 // numeric bonus applied in updatePassives
+            }
+        };
+    }
+
+    if (key.includes('angel island') || key.includes('avalanche')) {
+        return {
+            typeCategory: 'ultimate',
+            baseDmg: Math.floor(20 * lvlMult), // per tick base
+            scalePct: 0.20 * lvlMult,
+            scaleStat: 'atk',
+            element: 'earth',
+            multiHitCount: 6, // repeated ticks over channel window
+            cooldown: 90,
+            mechanics: {
+                duration: 3.0,
+                tickInterval: 0.5,
+                slowPct: 0.30,
+                slowDur: 1.0,
+                ccImmuneDuring: true,
+                guardianBoostWhileChannelPct: 0.10,
+                targetDensityPrefer: true
+            },
+            visualKeyword: 'vfx-fire-storm'
+        };
+    }
+
+    if (key.includes('echidna resilience') || key.includes('signature')) {
+        return {
+            typeCategory: 'passive',
+            description: 'Dodging grants a shield on cooldown; provides Tenacity/Evasion baseline and atk buff above 75% HP.',
+            mechanics: {
+                baseTenacity: 10,
+                baseEvasionPct: 0.10,
+                dodgeShieldPctMaxHp: 0.05,
+                shieldCooldown: 6,
+                atkBuffWhileHighHpPct: 0.10,
+                highHpThresholdPct: 0.75
+            }
+        };
+    }
+
+    return null;
+}
+
+export function updatePassives(actor, dt) {
+    actor.customResources = actor.customResources || {};
+    actor.resourceDecayTimers = actor.resourceDecayTimers || {};
+
+    // Guardian's Resolve: calculate current damage reduction based on missing HP
+    const parsed = getParsedAbility(actor.data.name, "Guardian's Resolve") || {};
+    const mech = parsed.mechanics || {};
+    const base = mech.baseReductionPct || 0.05;
+    const per25 = mech.per25MissingPct || 0.05;
+
+    const hpPct = (actor.currentHp || actor.maxHp || actor.stats.maxHp || 1) / (actor.maxHp || actor.stats.maxHp || 1);
+    const missingPct = 1 - hpPct;
+    const steps = Math.floor(missingPct / 0.25);
+    const add = Math.min(mech.maxAdditionalPct || 0.15, steps * per25);
+    actor.passiveModifiers = actor.passiveModifiers || {};
+    actor.passiveModifiers.guardianDamageReduction = base + add;
+
+    // Tenacity refresh below 50% HP
+    if (hpPct <= 0.5) {
+        actor.passiveModifiers.guardianTenacity = (mech.tenacityOnBelow50 || 0) || 15;
+        // ensure it persists at least 5s — set a timer resource
+        actor.resourceDecayTimers._guardian_tenacity = actor.resourceDecayTimers._guardian_tenacity || 5;
+        actor.resourceDecayTimers._guardian_tenacity = Math.max(actor.resourceDecayTimers._guardian_tenacity, 5);
+    } else {
+        // let timer tick down elsewhere; if expired, remove
+        if (!actor.resourceDecayTimers._guardian_tenacity || actor.resourceDecayTimers._guardian_tenacity <= 0) {
+            delete actor.passiveModifiers.guardianTenacity;
+        }
+    }
+
+    // Signature: baseline tenacity/evasion & attack buff when above threshold
+    const sig = getParsedAbility(actor.data.name, 'Echidna Resilience') || {};
+    const sm = sig.mechanics || {};
+    actor.passiveModifiers.echidnaTenacity = sm.baseTenacity || 10;
+    actor.passiveModifiers.echidnaEvasion = sm.baseEvasionPct || 0.10;
+
+    if ((actor.currentHp || 0) / (actor.maxHp || 1) >= (sm.highHpThresholdPct || 0.75)) {
+        actor.passiveModifiers.echidnaAtkBuff = sm.atkBuffWhileHighHpPct || 0.10;
+    } else {
+        delete actor.passiveModifiers.echidnaAtkBuff;
+    }
+
+    // Shield cooldown tracking stored in customResources as timestamp-like timer (seconds)
+    if (actor.resourceDecayTimers._dodge_shield_cd > 0) actor.resourceDecayTimers._dodge_shield_cd -= dt;
+}
+
+export async function decideAction(actor, enemies, allies, battle) {
+    const liveEnemies = enemies.filter(e => !e.isDead);
+    if (!liveEnemies.length) return { ability: { name: 'Basic Attack' }, targets: [] };
+
+    const ult = (actor.data.abilities || []).find(a => (a.type||'').toLowerCase() === 'ultimate' || (a.name||'').toLowerCase().includes('angel island'));
+    const heat = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('maximum heat'));
+    const drill = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('drill claw'));
+    const basic = (actor.data.abilities || []).find(a => (a.name||'').toLowerCase().includes('basic')) || { name: 'Basic Attack' };
+
+    // Ultimate if energy full and multiple enemies clustered
+    if (actor.energy >= actor.maxEnergy && ult && !actor.cooldownTimers?.[ult.name]) {
+        // prefer clustered area: if 2+ enemies within 140px of a point
+        for (const e of liveEnemies) {
+            const nearby = liveEnemies.filter(x => Math.hypot(x.x - e.x, x.y - e.y) <= 140);
+            if (nearby.length >= 2) return { ability: ult, targets: nearby, type: 'ultimate' };
+        }
+    }
+
+    // Drill Claw: prefer highest HP enemy and when >=2 enemies in small radius
+    if (drill && !actor.cooldownTimers?.[drill.name]) {
+        const best = liveEnemies.sort((a,b)=>b.maxHp - a.maxHp)[0];
+        if (best) {
+            // if cluster near best
+            const cluster = liveEnemies.filter(e => Math.hypot(e.x - best.x, e.y - best.y) <= 120);
+            if (cluster.length >= 2) return { ability: drill, targets: [best], type: 'skill' };
+            // else use heat instead if single target low def
+        }
+    }
+
+    // Maximum Heat: target lowest DEF enemy or finishers
+    if (heat && !actor.cooldownTimers?.[heat.name]) {
+        const lowDef = liveEnemies.sort((a,b)=> (a.effectiveDef || a.stats.def) - (b.effectiveDef || b.stats.def))[0];
+        if (lowDef) return { ability: heat, targets: [lowDef], type: 'skill' };
+    }
+
+    // Fallback basic nearest
+    const nearest = liveEnemies.sort((a,b) => Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
+    return { ability: basic, targets: [nearest], type: 'basic' };
+}
+
+export async function executeAction(battle, actor, decision, parsed) {
+    if (!decision || !decision.ability) return;
+    const ui = battle.uiManager;
+    const enemies = actor.team === 'ally' ? battle.enemies : battle.allies;
+    const friends = actor.team === 'ally' ? battle.allies : battle.enemies;
+    const liveEnemies = enemies.filter(e => !e.isDead);
+    if (!liveEnemies.length) return;
+
+    const ability = decision.ability;
+    const name = (ability.name||'').toLowerCase();
+    const lvl = actor.data.level || actor.level || 1;
+
+    parsed = parsed || getParsedAbility(actor.data.name, ability.name, ability.description, (actor.data.skills && actor.data.skills[ability.name]) || 1, ability.tags || []);
+
+    // Windup
+    await new Promise(r => setTimeout(r, (decision.type === 'ultimate') ? 320 : 120));
+
+    // BASIC
+    if (parsed.typeCategory === 'basic' || name.includes('basic')) {
+        const t = decision.targets && decision.targets[0] || liveEnemies[0];
+        if (!t) return;
+        const atk = actor.effectiveAtk || actor.stats.atk || 30;
+        const dmg = Math.floor((parsed.baseDmg || 14) + atk * (parsed.scalePct || 0.22));
+        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element, attackerAccuracy: 18 });
+        ui.showProjectile(actor, t, parsed.element || 'physical');
+        ui.showFloatingText(t, res.amount, 'damage-number');
+        ui.playVfx(t, parsed.visualKeyword || 'proj-fire');
+        actor.energy = Math.min(actor.maxEnergy, actor.energy + 10);
+        return;
+    }
+
+    // MAXIMUM HEAT KNUCKLES ATTACK
+    if (name.includes('maximum heat')) {
+        const t = decision.targets && decision.targets[0] || liveEnemies[0];
+        if (!t) return;
+        let scale = parsed.scalePct || 0.30;
+        if (lvl >= 20) scale *= 1.15;
+        if (lvl >= 180) scale *= 1.25;
+        const atk = actor.effectiveAtk || actor.stats.atk || 40;
+        const base = parsed.baseDmg || 40;
+        const dmg = Math.floor(base + atk * scale);
+        const res = t.receiveAction({ amount: dmg, type: 'physical', element: parsed.element, attackerAccuracy: 28 });
+        ui.showProjectile(actor, t, parsed.element || 'physical');
+        await new Promise(r => setTimeout(r, 80));
+        ui.showFloatingText(t, res.amount, 'damage-number');
+        ui.playVfx(t, 'vfx-slash-heavy');
+
+        // Burn chance doubled when below 50% HP
+        let burnChance = parsed.mechanics.burnChance || 0.10;
+        if ((actor.currentHp || 0) / (actor.maxHp || 1) < (parsed.mechanics.empowerBelowHpPct || 0.5)) burnChance *= 2;
+        if (Math.random() < burnChance) {
+            // Burn as DoT using a percent of atk per second
+            const perSec = Math.max(1, Math.floor((atk * (parsed.mechanics.burnPerSecPct || 0.02))));
+            t.applyStatus({ type: 'burn', duration: parsed.mechanics.burnDur || 3, value: perSec });
+            ui.showFloatingText(t, 'BURN', 'status-text');
+        }
+
+        // Knockback visual (small displacement)
+        try {
+            const dx = t.x - actor.x || 1;
+            const dy = t.y - actor.y || 0;
+            const d = Math.hypot(dx, dy) || 1;
+            t.x += Math.round((dx / d) * 60);
+            t.y += Math.round((dy / d) * 12);
+        } catch (e) {}
+
+        actor.energy = Math.min(actor.maxEnergy, actor.energy + 12);
+        return;
+    }
+
+    // DRILL CLAW EXCAVATION
+    if (name.includes('drill claw')) {
+        const primary = decision.targets && decision.targets[0] ? decision.targets[0] : pickRandom(liveEnemies);
+        if (!primary) return;
+        const mech = parsed.mechanics || {};
+        const atk = actor.effectiveAtk || actor.stats.atk || 40;
+        const base = parsed.baseDmg || 32;
+        const dmg = Math.floor(base + atk * (parsed.scalePct || 0.28));
+        // VFX & small delay for emergence
+        ui.playVfx(primary, 'vfx-earth');
+        await new Promise(r => setTimeout(r, 160));
+
+        // Apply to enemies in radius
+        const targets = liveEnemies.filter(e => Math.hypot(e.x - primary.x, e.y - primary.y) <= (mech.aoeRadius || 100));
+        targets.forEach(e => {
+            const res = e.receiveAction({ amount: dmg, type: 'physical', element: parsed.element, attackerAccuracy: 24 });
+            ui.showFloatingText(e, res.amount, 'damage-number');
+            e.applyStatus({ type: 'stun', duration: mech.stunDur || 1.0 });
+            // Def reduction
+            e.applyStatus({ type: 'debuff_def', duration: mech.defReduceDur || 4, modifiers: { def: -(mech.defReducePct || 0.12) } });
+            ui.showFloatingText(e, 'STUNNED', 'status-text');
+            ui.playVfx(e, 'vfx-earth');
+        });
+
+        actor.energy = Math.min(actor.maxEnergy, actor.energy + 14);
+        return;
+    }
+
+    // ANGEL ISLAND AVALANCHE (ULTIMATE)
+    if (name.includes('angel island') || decision.type === 'ultimate') {
+        const mech = parsed.mechanics || {};
+        const duration = mech.duration || 3.0;
+        const interval = mech.tickInterval || 0.5;
+        const ticks = Math.floor(duration / interval) || Math.floor(parsed.multiHitCount || 6);
+        const atk = actor.effectiveAtk || actor.stats.atk || 40;
+        // While channeling, make actor CC-immune and boost Guardian damage reduction
+        actor.applyStatus({ type: 'invulnerability', duration: duration }); // prevents CC; visuals handled by UI
+        actor.passiveModifiers.guardianExtraWhileChannel = mech.guardianBoostWhileChannelPct || 0.10;
+
+        // Optionally reposition to best density center — approximate by choosing enemy with max nearby
+        let center = liveEnemies[0];
+        let bestCnt = 0;
+        for (const e of liveEnemies) {
+            const cnt = liveEnemies.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= 140).length;
+            if (cnt > bestCnt) { bestCnt = cnt; center = e; }
+        }
+
+        ui.showAbilityName(actor, ability.name);
+        ui.playVfx(actor, 'vfx-fire-storm');
+
+        for (let i = 0; i < ticks; i++) {
+            // each tick deals damage to enemies within large radius centered on center
+            const rawDmg = Math.floor((parsed.baseDmg || 20) + atk * (parsed.scalePct || 0.20));
+            const aoeRadius = 220;
+            const hitTargets = liveEnemies.filter(e => Math.hypot(e.x - center.x, e.y - center.y) <= aoeRadius);
+            hitTargets.forEach(e => {
+                const res = e.receiveAction({ amount: rawDmg, type: 'physical', element: parsed.element, attackerAccuracy: 26 });
+                ui.showFloatingText(e, res.amount, 'damage-number');
+                // apply slow for short duration
+                e.applyStatus({ type: 'debuff_speed', duration: mech.slowDur || 1.0, value: mech.slowPct || 0.30 });
+                ui.playVfx(e, 'vfx-earth');
+            });
+            await new Promise(r => setTimeout(r, interval * 1000));
+        }
+
+        // Clean up channel flags
+        delete actor.passiveModifiers.guardianExtraWhileChannel;
+        actor.energy = 0;
+        actor.cooldownTimers = actor.cooldownTimers || {};
+        actor.cooldownTimers[ability.name] = parsed.cooldown || 90;
+        return;
+    }
+
+    // SIGNATURE PASSIVE invoked manually (rare) - provide small shield if dodge event set a marker
+    if (name.includes('echidna resilience') || parsed.typeCategory === 'passive') {
+        // Attempt to apply passive baseline buffs (visual feedback)
+        const sig = parsed.mechanics || {};
+        actor.applyStatus({ type: 'buff_tenacity', value: sig.baseTenacity || 10, duration: 6 });
+        actor.applyStatus({ type: 'buff_evasion', value: sig.baseEvasionPct || 0.10, duration: 6 });
+        ui.showFloatingText(actor, 'RESILIENCE', 'status-text buff');
+        return;
+    }
+
+    // fallback: no-op
+}
