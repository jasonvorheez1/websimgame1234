export class AbilityParser {
    constructor() {
        this.cache = JSON.parse(
            localStorage.getItem('mugen_meta_ability_cache_v3') || '{}'
        );
    }

    saveCache() {
        localStorage.setItem(
            'mugen_meta_ability_cache_v3',
            JSON.stringify(this.cache)
        );
    }

    /* ---------------------------------------------
       Utilities
    --------------------------------------------- */

    num(v, fallback = 0) {
        return Number.isFinite(v) ? v : fallback;
    }

    int(v, fallback = 0) {
        const n = parseInt(v);
        return Number.isFinite(n) ? n : fallback;
    }

    bool(v) {
        return !!v;
    }

    safeArray(v) {
        return Array.isArray(v) ? v : [];
    }

    /* ---------------------------------------------
       Public API
    --------------------------------------------- */

    async ensureParsed(characters, onProgress) {
        const toParse = [];
        const seen = new Set();

        characters.forEach(char => {
            char?.abilities?.forEach(ab => {
                const key = `${char.name}_${ab.name}`;
                if (!this.cache[key] && !seen.has(key)) {
                    seen.add(key);
                    toParse.push({
                        key,
                        charName: char.name,
                        ability: ab
                    });
                }
            });
        });

        if (!toParse.length) {
            onProgress?.(100);
            return;
        }

        const batchSize = 5;
        let processed = 0;

        for (let i = 0; i < toParse.length; i += batchSize) {
            const batch = toParse.slice(i, i + batchSize);
            await this.processBatch(batch);
            processed += batch.length;
            onProgress?.(Math.min(99, (processed / toParse.length) * 100));
        }

        this.saveCache();
        onProgress?.(100);
    }

    /* ---------------------------------------------
       AI Batch Processing
    --------------------------------------------- */

    async processBatch(batch) {
        const descriptions = batch.map((item, idx) => `
ID: ${idx}
Name: ${item.ability.name}
Description: ${item.ability.description || ''}
        `.trim()).join('\n---\n');

        const prompt = `
Analyze these RPG abilities and output RAW JSON only.
Return an object keyed by ID.
${descriptions}
        `;

        let result = {};

        try {
            const completion = await window.websim.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a precise game mechanics parser. Output raw JSON only." },
                    { role: "user", content: prompt }
                ],
                json: true
            });

            const content = completion.content
                .replace(/```json|```/g, '')
                .trim();

            result = JSON.parse(content);
        } catch (err) {
            console.error('[AbilityParser] AI parse failed', err);
            batch.forEach(item => {
                this.cache[item.key] = this.fallbackAbility();
            });
            this.saveCache();
            return;
        }

        batch.forEach((item, idx) => {
            const raw = result[idx] || result[String(idx)] || {};
            const enriched = this.enrich(raw, item);
            this.cache[item.key] = enriched;
        });

        this.saveCache();
    }

    /* ---------------------------------------------
       Enrichment + Heuristics (SAFE)
    --------------------------------------------- */

    enrich(raw, item) {
        const nameDesc = (
            (item.ability.name || '') + ' ' +
            (item.ability.description || '')
        ).toLowerCase();

        const p = {};

        /* ---------- Core fields ---------- */

        p.typeCategory = String(raw.typeCategory || raw.type || 'active');
        p.baseDmg = this.int(raw.baseDmg, 0);
        p.scalePct = this.num(raw.scalePct, 0);
        p.scaleStat = String(raw.scaleStat || 'atk');
        p.multiHitCount = Math.max(1, this.int(raw.multiHitCount, 1));
        p.cooldown = this.num(
            raw.cooldown,
            p.typeCategory === 'ultimate' ? 18 : 6
        );

        /* ---------- Flags ---------- */

        p.isHeal = this.bool(raw.isHeal);
        p.isShield = this.bool(raw.isShield);
        p.isTeleport = /teleport|blink|warp/.test(nameDesc);
        p.isBurst = /burst|execute|obliterate/.test(nameDesc);
        p.hasProjectile = /arrow|bolt|projectile|missile/.test(nameDesc);

        /* ---------- Element ---------- */

        p.element = raw.element || 'physical';
        if (/fire|burn|flame/.test(nameDesc)) p.element = 'fire';
        else if (/ice|frost|freeze/.test(nameDesc)) p.element = 'ice';
        else if (/shock|electric|zap/.test(nameDesc)) p.element = 'electric';
        else if (/water|wave|tidal/.test(nameDesc)) p.element = 'water';
        else if (/dark|void|shadow/.test(nameDesc)) p.element = 'dark';
        else if (/holy|light|divine/.test(nameDesc)) p.element = 'light';

        /* ---------- Radius / AOE (SAFE) ---------- */

        let auraRadius = null;
        const radiusMatch = nameDesc.match(/(\d+)\s*(?:m|meter|unit)?\s*radius/);
        if (radiusMatch) {
            auraRadius = this.int(radiusMatch[1], 0) * 40;
        }

        p.targeting = 'single';
        if (auraRadius !== null) {
            p.targeting = 'aoe';
            p.auraRadius = auraRadius;
            p.aoeCenter = 'caster'; // 🔒 critical
        }

        /* ---------- Lifesteal ---------- */

        if (/lifesteal|drain|siphon/.test(nameDesc)) {
            p.lifestealPct = this.num(raw.lifestealPct, 0.2);
        }

        /* ---------- Statuses (SANITIZED) ---------- */

        p.statuses = this.safeArray(raw.statuses).map(s => {
            const type = String(s.type || s.name || s).toLowerCase();
            return {
                type,
                duration: this.num(s.duration, 3),
                value: this.num(s.value || s.amount, 0),
                stackLimit: s.stackLimit ?? undefined,
                applyOnLastHitOnly: !!s.applyOnLastHitOnly,
                ...(auraRadius !== null ? { auraRadius } : {})
            };
        });

        /* ---------- Visual ---------- */

        p.visualKeyword =
            p.isTeleport ? 'teleport' :
            p.isBurst ? 'explosion' :
            p.hasProjectile ? 'wind_gust' :
            p.element;

        /* ---------- FINAL HARD CLAMP ---------- */

        p.baseDmg = this.int(p.baseDmg, 0);
        p.scalePct = this.num(p.scalePct, 0);
        p.cooldown = Math.max(0.5, this.num(p.cooldown, 6));
        p.multiHitCount = Math.max(1, p.multiHitCount);

        return p;
    }

    fallbackAbility() {
        return {
            fallback: true,
            typeCategory: 'active',
            baseDmg: 0,
            multiHitCount: 1,
            targeting: 'single',
            cooldown: 6,
            visualKeyword: 'slash',
            statuses: []
        };
    }

    getParsedAbility(charName, abilityName) {
        const key = `${charName}_${abilityName}`;
        const data = this.cache[key];
        return data && !data.fallback ? data : null;
    }
}
