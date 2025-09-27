import { BeastFeast } from "./feast-logic.js";
import { FeastDialog } from "./feast-ui.js";

const MOD = "beast-feast";

Hooks.once("init", () => {
  game.modules.get(MOD).api = { BeastFeast, FeastDialog };
  // Settings
  game.settings.register(MOD, "partyTier", {
    name: game.i18n.localize("BF.Setting.PartyTier.Name"),
    hint: game.i18n.localize("BF.Setting.PartyTier.Hint"),
    scope: "world", config: true, type: Number, default: 1
  });
  game.settings.register(MOD, "cookbookJournalId", {
    name: "Cookbook Journal Entry ID",
    scope: "world", config: false, type: String, default: ""
  });
});

Hooks.once("ready", async () => {
  // Ensure a world-level Cookbook journal exists
  const id = game.settings.get(MOD, "cookbookJournalId");
  if (!id || !game.journal.get(id)) {
    const je = await JournalEntry.create({ name: "Beast Feast Cookbook", pages: [{ name: "Index", type: "text", text: { content: "<p>Welcome to the party cookbook.</p>" } }] });
    await game.settings.set(MOD, "cookbookJournalId", je.id);
  }

  // UI injection: add Ingredients badge & buttons on Actor sheets (generic, non-invasive)
  Hooks.on("renderActorSheet", (sheet, html) => {
    try { injectActorUI(sheet, html); } catch (e) { console.warn(MOD, e); }
  });

  // Chat commands
  Hooks.on("chatMessage", (log, message, chatData) => {
    if (!message.startsWith("/feast")) return false;
    const [, sub, ...rest] = message.split(/\s+/);
    if (sub === "start") new FeastDialog().render(true);
    if (sub === "harvest") ui.notifications.info(game.i18n.localize("BF.Msg.UseHarvestButton"));
    if (sub === "bloom") ui.notifications.info(game.i18n.localize("BF.Msg.UseBloomButton"));
    if (sub === "cookbook") openCookbook();
    return true;
  });
});

function openCookbook() {
  const id = game.settings.get(MOD, "cookbookJournalId");
  const je = game.journal.get(id);
  if (je) je.sheet.render(true);
}

function injectActorUI(sheet, html) {
  const actor = sheet.actor;
  if (actor?.type !== "character") return; // keep it simple

  const cont = document.createElement("div");
  cont.classList.add("bf-actor-panel");

  const { max, used } = BeastFeast.getIngredientLimit(actor);
  cont.innerHTML = `
    <section class="bf-ingredients">
      <h3>🍲 Beast Feast</h3>
      <div class="bf-badge">${game.i18n.localize("BF.UI.Ingredients")} <b>${used}</b>/<b>${max}</b></div>
      <div class="bf-row">
        <button type="button" class="bf-btn" data-action="bf-harvest">${game.i18n.localize("BF.UI.Harvest")}</button>
        <button type="button" class="bf-btn" data-action="bf-bloom">${game.i18n.localize("BF.UI.Bloom")}</button>
        <button type="button" class="bf-btn" data-action="bf-feast">${game.i18n.localize("BF.UI.MakeFeast")}</button>
        <button type="button" class="bf-btn" data-action="bf-cookbook">${game.i18n.localize("BF.UI.Cookbook")}</button>
      </div>
      <div class="bf-list">${renderIngredientList(actor)}</div>
    </section>`;

  html[0].querySelector(".window-content")?.prepend(cont);

  cont.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".bf-btn"); if (!btn) return;
    const act = btn.dataset.action;
    if (act === "bf-harvest") return BeastFeast.promptHarvest(actor);
    if (act === "bf-bloom") return BeastFeast.gatherBloom(actor);
    if (act === "bf-feast") return new FeastDialog().render(true);
    if (act === "bf-cookbook") return openCookbook();
  });
}

function renderIngredientList(actor) {
  const list = BeastFeast.getIngredients(actor);
  if (!list.length) return `<em>${game.i18n.localize("BF.UI.NoIngredients")}</em>`;
  return list.map((ing, idx) => {
    const tags = ing.flavors.map(f => `<span class="bf-chip bf-${f.kind}">${game.i18n.localize("BF.Flavor."+f.kind)}${f.strength>1?`×${f.strength}`:""}</span>`).join(" ");
    return `<div class="bf-item" data-idx="${idx}">
      <span class="name">${PIXI.utils.encodeHTML(ing.name||"Ingredient")}</span>
      <span class="tags">${tags}</span>
      <a class="bf-remove" data-action="remove" title="${game.i18n.localize("BF.UI.Remove")}">×</a>
    </div>`;
  }).join("");
}