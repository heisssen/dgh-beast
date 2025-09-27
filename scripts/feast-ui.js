import { BeastFeast } from "./feast-logic.js";

export class FeastDialog extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "bf-feast",
      template: "modules/beast-feast/apps/FeastDialog.hbs",
      title: game.i18n.localize("BF.UI.MakeFeast"),
      width: 700, height: "auto", resizable: true,
      classes: ["bf-feast"]
    });
  }

  async getData() {
    const actors = game.actors?.contents?.filter(a=>a.type==="character") ?? [];
    const partyIngredients = [];
    for (const a of actors) {
      const list = BeastFeast.getIngredients(a).map((ing, i)=> ({ actorId: a.id, actorName: a.name, idx: i, ing }));
      partyIngredients.push(...list);
    }

    return {
      actors,
      partyIngredients,
      flavors: ["sweet","salty","bitter","sour","savory","weird"],
      t: (k)=>game.i18n.localize(k)
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action=select]", ev => this._toggleRow(ev));
    html.on("click", "[data-action=cook]", ev => this._cook(ev));
    html.on("click", "[data-action=distribute]", ev => this._distribute(ev));
  }

  _toggleRow(ev) {
    const row = ev.currentTarget.closest("tr");
    row?.classList.toggle("sel");
  }

  async _cook() {
    const sel = [...this.element[0].querySelectorAll("tr.sel")];
    if (!sel.length) return ui.notifications.warn(game.i18n.localize("BF.Msg.SelectIngredients"));

    // Collect ingredients and pessimistically mark consumed after success
    const picks = sel.map(tr => JSON.parse(tr.dataset.payload));
    const ingredients = picks.map(p=>p.ing);

    const profileKey = BeastFeast.profileKey(ingredients);
    const tokens = BeastFeast.familiarTokens(profileKey);
    const dice = BeastFeast.buildDicePool(ingredients);

    const { rating, history, matches, tokensLeft } = await BeastFeast.cookAndScore(dice, { tokens });

    // Post chat log
    const flavor = `${game.i18n.localize("BF.Chat.Cooked")} (${profileKey || "profile"})`;
    const content = `
      <p><b>${game.i18n.localize("BF.UI.MealRating")}:</b> ${rating}</p>
      <details><summary>${game.i18n.localize("BF.UI.RollHistory")}</summary>
      ${history.map(h=>`<div>${foundry.utils.escapeHTML(h.formula)} → [${h.values.join(", ")}]</div>`).join("")}
      </details>`;
    ChatMessage.create({ speaker: ChatMessage.getSpeaker(), flavor, content });

    // Stash result in app state for distribution step
    this._result = { picks, ingredients, profileKey, rating };

    // Mark profile familiar for future runs
    await BeastFeast.markFamiliar(profileKey);

    // UI update
    this.element[0].querySelector(".bf-result").innerHTML = `<div class="bf-rating">${rating}</div>`;
    this.element[0].querySelector(".bf-next").removeAttribute("disabled");
  }

  async _distribute() {
    if (!this._result) return;
    const actors = game.actors?.contents?.filter(a=>a.type==="character") ?? [];

    // Simple per-actor dialog to split rating into HP/Stress/Hope
    for (const a of actors) {
      const content = `
        <div class="bf-form">
          <label>${a.name}: ${game.i18n.localize("BF.UI.SplitTotal")} ${this._result.rating}</label>
          <label>HP</label><input type="number" name="hp" value="0" min="0" max="${this._result.rating}">
          <label>Stress</label><input type="number" name="stress" value="0" min="0" max="${this._result.rating}">
          <label>Hope</label><input type="number" name="hope" value="0" min="0" max="${this._result.rating}">
        </div>`;
      const res = await Dialog.prompt({ title: game.i18n.localize("BF.UI.Distribute"), content, label: game.i18n.localize("BF.UI.OK"), callback: html => {
        const hp = Number(html.querySelector("input[name=hp]")?.value ?? 0);
        const stress = Number(html.querySelector("input[name=stress]")?.value ?? 0);
        const hope = Number(html.querySelector("input[name=hope]")?.value ?? 0);
        if (hp + stress + hope !== this._result.rating) {
          ui.notifications.warn(game.i18n.localize("BF.Msg.SplitExact"));
          return false;
        }
        return { hp, stress, hope };
      }});
      if (res) {
        // Here we do not know Daggerheart exact paths; place values into flags & leave actual healing to GM/system
        await a.setFlag("beast-feast", "lastMealGain", res);
        ChatMessage.create({ content: `<b>${a.name}</b> → HP:${res.hp} / Stress:${res.stress} / Hope:${res.hope}` });
      }
    }

    // Remove consumed ingredients from owners
    for (const p of this._result.picks) {
      const act = game.actors.get(p.actorId);
      const list = BeastFeast.getIngredients(act);
      const idx = p.idx;
      if (list[idx]) { list.splice(idx,1); await BeastFeast.setIngredients(act, list); }
    }

    // Append entry into Cookbook (single page per dish instance)
    const je = game.journal.get(game.settings.get("beast-feast", "cookbookJournalId"));
    if (je) {
      await je.createEmbeddedDocuments("JournalEntryPage", [{
        name: `Meal ${new Date().toLocaleString()}`,
        type: "text",
        text: { content: `<p><b>Profile:</b> ${this._result.profileKey}</p><p><b>Rating:</b> ${this._result.rating}</p>` }
      }]);
    }

    ui.notifications.info(game.i18n.localize("BF.Msg.DistributionDone"));
    this.close();
  }
}