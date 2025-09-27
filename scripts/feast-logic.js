export const BeastFeast = {
  // --- Data access ---
  getIngredients(actor) {
    return foundry.utils.getProperty(actor, "flags.beast-feast.ingredients") ?? [];
  },
  setIngredients(actor, arr) {
    return actor.update({ [`flags.beast-feast.ingredients`]: arr });
  },
  addIngredient(actor, ing) {
    const list = this.getIngredients(actor);
    list.push(ing);
    return this.setIngredients(actor, list);
  },
  removeIngredient(actor, idx) {
    const list = this.getIngredients(actor);
    list.splice(idx, 1);
    return this.setIngredients(actor, list);
  },

  // Limit = highest trait value (fallback 3)
  getIngredientLimit(actor) {
    const traits = foundry.utils.getProperty(actor, "system.abilities") || {};
    const values = Object.values(traits).map(t => Number(t?.value ?? 0));
    const max = Math.max(3, ...(values.length ? values : [3]));
    const used = this.getIngredients(actor).length;
    return { max, used };
  },

  // Flavor mapping → die faces
  flavorDie(kind) {
    return { sweet: 4, salty: 6, bitter: 8, sour: 10, savory: 12, weird: 20 }[kind];
  },

  // Harvest dialog (simple): input defeated creature Max HP → suggest 1..4 items
  async promptHarvest(actor) {
    const content = `
      <div class="bf-form">
        <label>Max HP</label>
        <input type="number" name="hp" value="10" min="1"/>
        <p class="hint">1–10 → 1 ing, 11–30 → 2, 31–60 → 3, 61+ → 4 (adjust as GM)</p>
        <label>${game.i18n.localize("BF.UI.Count")}</label>
        <input type="number" name="count" value="1" min="1" max="4"/>
      </div>`;
    const dlg = await Dialog.prompt({ title: game.i18n.localize("BF.UI.Harvest"), content, label: game.i18n.localize("BF.UI.OK"), callback: html => {
      const hp = Number(html.querySelector("input[name=hp]")?.value ?? 10);
      let count = Number(html.querySelector("input[name=count]")?.value ?? 1);
      if (!count) count = hp <= 10 ? 1 : hp <= 30 ? 2 : hp <= 60 ? 3 : 4;
      return { hp, count };
    }});
    if (!dlg) return;

    for (let i = 0; i < dlg.count; i++) {
      await this.addIngredient(actor, this.randomIngredient({ source: "beast" }));
    }
    ui.notifications.info(game.i18n.format("BF.Msg.HarvestedN", {n: dlg.count}));
    actor.sheet.render(false);
  },

  // Bloom: once per rest (not enforced here), spend 1 Hope (left to GM/players), roll d12 → flavor
  async gatherBloom(actor) {
    const roll = await new Roll("1d12").evaluate({async: true});
    roll.toMessage({ flavor: game.i18n.localize("BF.Roll.Bloom") });
    const map = { 1:"sweet", 2:"salty", 3:"bitter", 4:"sour", 5:"savory", 6:"weird", 7:"sweet", 8:"salty", 9:"bitter", 10:"sour", 11:"savory", 12:"weird" };
    const kind = map[roll.total];
    await this.addIngredient(actor, { name: game.i18n.localize("BF.Name.Bloom"), source: "bloom", flavors: [{ kind, strength: 1 }] });
    ui.notifications.info(game.i18n.localize("BF.Msg.BloomAdded"));
    actor.sheet.render(false);
  },

  // Random ingredient helper (simple, deterministic-ish)
  randomIngredient({ source = "beast" } = {}) {
    const kinds = ["sweet","salty","bitter","sour","savory","weird"];
    const count = Math.clamped(1 + Math.floor(Math.random()*3), 1, 3);
    const flavors = [];
    for (let i=0;i<count;i++) {
      const kind = kinds[Math.floor(Math.random()*kinds.length)];
      const strength = 1 + Math.floor(Math.random()*3);
      flavors.push({ kind, strength });
    }
    return { name: game.i18n.localize("BF.Name.Ingredient"), source, flavors };
  },

  // Build a flavor dice pool from a list of ingredients
  buildDicePool(ingredients) {
    const pool = [];
    for (const ing of ingredients) for (const f of (ing.flavors||[])) {
      for (let i=0;i<f.strength;i++) pool.push(this.flavorDie(f.kind));
    }
    return pool.sort((a,b)=>a-b); // nice to see
  },

  // Familiar profile logic: make a normalized key from summed strengths per flavor
  profileKey(ingredients) {
    const sum = {sweet:0,salty:0,bitter:0,sour:0,savory:0,weird:0};
    for (const ing of ingredients) for (const f of (ing.flavors||[])) sum[f.kind]+=f.strength;
    return Object.entries(sum).filter(([,v])=>v>0).map(([k,v])=>`${k}${v}`).join("-");
  },

  // Query familiar tokens for a profile
  familiarTokens(profileKey) {
    const tier = game.settings.get("beast-feast", "partyTier") || 1;
    const map = game.world.getFlag("beast-feast", "familiarProfiles") || {};
    return map[profileKey] ? tier : 0;
  },
  // Mark a profile as familiar
  async markFamiliar(profileKey) {
    const map = foundry.utils.duplicate(game.world.getFlag("beast-feast", "familiarProfiles") || {});
    map[profileKey] = true;
    await game.world.setFlag("beast-feast", "familiarProfiles", map);
  },

  // Core roll engine per RAW: keep rolling until one die remains; collect sets (>=2) each throw
  async cookAndScore(diceFaces, { tokens = 0 } = {}) {
    const history = [];
    const matches = [];
    let pool = diceFaces.map(d => ({ d }));

    while (pool.length > 1) {
      const formula = pool.map(x => `1d${x.d}`).join("+") || "";
      const roll = await new Roll(formula).evaluate({async: true});
      const values = roll.terms.filter(t=>t.results).flatMap(t=>t.results.map(r=>r.result));
      history.push({ formula, values });

      // group by face value
      const groups = values.reduce((acc,v,i)=>{ (acc[v]=acc[v]||[]).push(i); return acc; }, {});
      const facesWithSets = Object.entries(groups).filter(([,idx])=>idx.length>=2).map(([face, idx])=>({ face: Number(face), idx }));

      if (!facesWithSets.length) {
        if (tokens>0) { tokens--; continue; } // spend token instead of dropping a die
        else { pool.splice(0,1); continue; }   // drop one die (heuristic: smallest)
      }

      // collect matched dice; remove them from pool (by count)
      for (const set of facesWithSets) {
        matches.push(set.face);
        // remove as many dice as idx length from pool (any)
        for (let i=0;i<set.idx.length && pool.length>0;i++) pool.pop();
      }
    }

    const rating = matches.reduce((a,b)=>a+b,0);
    return { rating, history, matches, tokensLeft: tokens };
  }
};