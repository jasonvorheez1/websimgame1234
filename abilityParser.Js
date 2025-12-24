export class AbilityParser {
    constructor() {
        this.cache = JSON.parse(localStorage.getItem('mugen_meta_ability_cache_v3') || '{}');
    }

    saveCache() {
        localStorage.setItem('mugen_meta_ability_cache_v3', JSON.stringify(this.cache));
    }

    async ensureParsed(characters, onProgress) {
        // Collect abilities that need parsing
        const toParse = [];
        const seen = new Set();

        characters.forEach(char => {
            if (!char.abilities) return;
            char.abilities.forEach(ab => {
                const key = `${char.name}_${ab.name}`;
                if (!this.cache[key] && !seen.has(key)) {
                    seen.add(key);
                    toParse.push({ key, charName: char.name, ability: ab });
                }
            });
        });

        if (toParse.length === 0) {
            if (onProgress) onProgress(100);
            return;
        }

        console.log(`[AbilityParser] AI Parsing ${toParse.length} new abilities...`);

        // Batch requests
        const batchSize = 5;
        const total = toParse.length;
        let processed = 0;

        for (let i = 0; i < total; i += batchSize) {
            const batch = toParse.slice(i, i + batchSize);
            await this.processBatch(batch);
            processed += batch.length;
            if (onProgress) onProgress(Math.min(99, (processed / total) * 100));
        }
        
        this.saveCache();
        if (onProgress) onProgress(100);
    }

    async processBatch(batch) {
        const descriptions = batch.map((item, idx) => 
            `ID: ${idx}\nName: ${item.ability.name}\nDescription: ${item.ability.description || ''}`
        ).join('\n---\n');

        const prompt = `
            Analyze these RPG ability descriptions and output a JSON object defining their mechanics.
            (Same schema as before — respond with a JSON object keyed by the IDs.)
            INPUT ABILITIES:
            ${descriptions}
        `;

        try {
            const completion = await window.websim.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a precise game mechanics parser. Output raw JSON only." },
                    { role: "user", content: prompt }
                ],
                json: true
            });

            const content = completion.content.trim().replace(/```json|```/g, '');
            let result = {};
            try {
                result = JSON.parse(content);
            } catch (parseErr) {
                // If AI returned something slightly malformed, attempt a safe extraction (best-effort)
                const jsonStart = content.indexOf('{');
                if (jsonStart !== -1) {
                    try {
                        result = JSON.parse(content.slice(jsonStart));
                    } catch (e) {
                        console.error('AbilityParser: failed to parse AI output', e);
                        result = {};
                    }
                } else {
                    console.error('AbilityParser: no JSON found in AI output');
                    result = {};
                }
            }

            // Helper: normalize and enrich parsed result with heuristics
            const enrichParsed = (rawParsed, item) => {
                const p = { ...(rawParsed || {}) };

                // Basic normalization & defaults
                p.typeCategory = (p.typeCategory || p.type || 'active').toString();
                p.baseDmg = Number(p.baseDmg || 0);
                p.scalePct = Number(p.scalePct || 0);
                p.scaleStat = (p.scaleStat || 'atk').toString();
                p.multiHitCount = Math.max(1, Number(p.multiHitCount || 1));
                p.targeting = p.targeting || 'single';
                p.element = (p.element || 'physical').toString();
                p.statuses = Array.isArray(p.statuses) ? p.statuses.slice() : (p.statuses ? [p.statuses] : []);
                p.cooldown = Number(p.cooldown || (p.typeCategory === 'ultimate' ? 18 : 6));
                p.scalePerStack = Number(p.scalePerStack || 0);
                p.scaleResource = p.scaleResource || null;
                p.isHeal = !!p.isHeal;
                p.isShield = !!p.isShield;
                p.isTransformation = !!p.isTransformation;
                p.copyAbility = !!p.copyAbility;
                p.tags = Array.isArray(p.tags) ? p.tags.map(t => String(t).toLowerCase()) : (p.tags ? [String(p.tags).toLowerCase()] : []);
                p.damageType = p.damageType || (p.isHeal ? 'heal' : (['magic','fire','ice'].includes(p.element) ? 'magic' : 'physical'));

                // Additional heuristic detection from name + description
                const nameDesc = ((item.ability.name || '') + ' ' + (item.ability.description || '')).toLowerCase();

                // lifesteal inference
                if (!p.lifestealPct && (/lifesteal|drain|siphon|heal for % of damage/.test(nameDesc))) {
                    p.lifestealPct = p.lifestealPct || 0.2;
                }

                // hp cost detection (e.g., "costs 20% of current HP")
                const hpCostMatch = nameDesc.match(/costs?\s+(\d+)%\s+of\s+(?:current\s+)?hp|costs?\s+(\d+)%\s+hp/);
                if (hpCostMatch) {
                    p.hpCostPercent = (parseInt(hpCostMatch[1] || hpCostMatch[2]) || 0) / 100;
                }

                // shield duration / value inference
                if (p.isShield && !p.statuses.some(s => s.type === 'shield')) {
                    const shieldValMatch = nameDesc.match(/shield(?:s)?\s+for\s+(\d+)%?\s*(?:of|of max|of max hp)?\s*(?:hp)?/);
                    const val = shieldValMatch ? Number(shieldValMatch[1]) : (p.baseDmg || 0);
                    p.statuses.push({ type: 'shield', duration: p.shieldDuration || 6, value: val });
                }

                // cooldown keyword extraction "cooldown: Xs" or "every X seconds"
                const cdMatch = nameDesc.match(/cooldown[:\s]*([0-9]+)s?|every\s+([0-9]+)\s+seconds?/);
                if (cdMatch) p.cooldown = Number(cdMatch[1] || cdMatch[2] || p.cooldown);

                // detect teleport, burst, aoe, multi-hit and projectile words
                if (/teleport|blink|warp|phase/.test(nameDesc)) p.isTeleport = true;
                if (/burst|execute|obliterate|massive/.test(nameDesc)) p.isBurst = true;
                if (/all enemies|area|aoe|surrounding|nearby|splash|wave|radius/.test(nameDesc)) p.targeting = 'aoe';
                
                // Enhanced Radius & Area Persistence Detection
                const radiusMatch = nameDesc.match(/(\d+)\s*(?:unit|m|meter)?\s*radius/);
                if (radiusMatch) p.auraRadius = parseInt(radiusMatch[1]) * 40; // Convert game units to pixels

                const persistMatch = nameDesc.match(/persists?\s+for\s+(\d+)\s+seconds?/);
                if (persistMatch) p.areaDuration = parseInt(persistMatch[1]);

                if (!p.multiHitCount) {
                    const hitMatch = nameDesc.match(/(fires|hits|strikes|attacks)\s+(three|four|five|six|seven|eight|nine|ten|\d+)/);
                    if (hitMatch) {
                        const map = {three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
                        p.multiHitCount = map[hitMatch[2]] || Number(hitMatch[2]) || 1;
                    }
                }
                if (/arrow|bolt|projectile|missile|shot/.test(nameDesc)) p.hasProjectile = true;

                // element inference
                if (!p.element || p.element === 'physical') {
                    if (/fire|flame|burn|ignite/.test(nameDesc)) p.element = 'fire';
                    else if (/ice|freeze|frost|shatter/.test(nameDesc)) p.element = 'ice';
                    else if (/electric|shock|tesla|zap/.test(nameDesc)) p.element = 'electric';
                    else if (/water|tidal|wave|aqua/.test(nameDesc)) p.element = 'water';
                    else if (/dark|shadow|abyss|void/.test(nameDesc)) p.element = 'dark';
                    else if (/holy|light|divine|smite/.test(nameDesc)) p.element = 'light';
                    else if (p.scaleStat && p.scaleStat.includes('magic')) p.element = 'magic';
                }

                // tags enrichment: quick tokenization of recognizable keywords
                const tokens = nameDesc.split(/[^a-z0-9]+/).filter(Boolean);
                const tagTokens = ['aoe','heal','shield','stun','silence','burst','teleport','multi','projectile','pierce','lifesteal','cleanse','trap','stealth','ultimate','passive','buff','debuff','bounce','chain','transform','dot','dot','regen'];
                tagTokens.forEach(t => { if (tokens.includes(t) && !p.tags.includes(t)) p.tags.push(t); });

                // statuses normalization to objects with default duration/value if needed
                p.statuses = p.statuses.map(s => {
                    if (typeof s === 'string') {
                        let type = s.toLowerCase();
                        let duration = 3;
                        // Heuristic for common durations in strings
                        const durM = nameDesc.match(new RegExp(`${type}\\s+(?:for|duration)\\s+(\\d+)`, 'i'));
                        if (durM) duration = parseInt(durM[1]);
                        return { type, duration, value: 0 };
                    }
                    
                    const statusType = (s.type || s.name || 'custom').toLowerCase();
                    
                    // Specific scaling logic for common CC
                    let baseDuration = (s.duration || s.duration === 0) ? s.duration : (s.valDuration || 3);
                    let scalingDuration = 0;
                    
                    // Regex for scaling durations like "1 second (+0.25 seconds per level)"
                    const scaleDurRegex = new RegExp(`${statusType}\\s+(?:for|duration)\\s+([\\d\\.]+)\\s*(?:seconds?)?\\s*\\(\\+([\\d\\.]+)\\s*seconds?\\s*per\\s*level\\)`, 'i');
                    const sdMatch = nameDesc.match(scaleDurRegex);
                    if (sdMatch) {
                        baseDuration = parseFloat(sdMatch[1]);
                        scalingDuration = parseFloat(sdMatch[2]);
                    }

                    return {
                        type: statusType,
                        duration: baseDuration,
                        durationScaling: scalingDuration,
                        value: (s.value || s.amount || 0),
                        stackLimit: s.stackLimit || s.stack || undefined,
                        name: s.name || undefined,
                        applyOnLastHitOnly: s.applyOnLastHitOnly || false,
                        modifiers: s.modifiers || s.mod || undefined,
                        auraRadius: p.auraRadius,
                        auraTarget: p.targeting === 'aoe' ? 'enemy' : 'self'
                    };
                });

                // visual keyword fallback
                p.visualKeyword = p.visualKeyword || (() => {
                    if (p.isTeleport) return 'teleport';
                    if (p.isBurst) return 'explosion';
                    if (['fire','ice','electric','dark','magic','water','light'].includes(p.element)) return p.element;
                    if (p.hasProjectile) return 'wind_gust';
                    return 'slash';
                })();

                // ensure numeric safety
                p.baseDmg = isNaN(p.baseDmg) ? 0 : Math.floor(p.baseDmg);
                p.scalePct = isNaN(p.scalePct) ? 0 : Number(p.scalePct);
                p.cooldown = isNaN(p.cooldown) ? (p.typeCategory === 'ultimate' ? 18 : 6) : Number(p.cooldown);

                return p;
            };

            // Iterate batch and populate cache with enriched objects
            batch.forEach((item, idx) => {
                const raw = result[idx] || result[String(idx)] || {};
                const enriched = enrichParsed(raw, item);

                // As a safety net, ensure some minimal fields exist so BattleSystem can rely on them
                enriched.typeCategory = enriched.typeCategory || 'active';
                enriched.baseDmg = enriched.baseDmg || 0;
                enriched.multiHitCount = Math.max(1, enriched.multiHitCount || 1);
                enriched.targeting = enriched.targeting || 'single';
                enriched.cooldown = Math.max(0.5, enriched.cooldown || 6);

                this.cache[item.key] = enriched;
            });

            // Persist after processing a batch
            this.saveCache();
        } catch (e) {
            console.error("AI Parse Error:", e);
            // On total failure, fallback to minimal safe entries per item
            batch.forEach(item => {
                this.cache[item.key] = { fallback: true, typeCategory: 'active', baseDmg: 0, multiHitCount: 1, targeting: 'single', cooldown: 6, visualKeyword: 'slash' };
            });
            this.saveCache();
        }
    }

    getParsedAbility(charName, abilityName) {
        const key = `${charName}_${abilityName}`;
        const data = this.cache[key];
        if (data && !data.fallback) return data;
        return null;
    }
}