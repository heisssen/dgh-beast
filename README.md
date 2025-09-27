# Beast Feast (minimal)

Automates Beast Feast without Berry & packs. Works on flags and a single Journal.

## Install (dev)
- Symlink this folder into `Data/modules/beast-feast`.
- Enable the module in a Daggerheart world.

## Use
- Open a character sheet → section **Beast Feast**.
- **Harvest**: quick-add random ingredients. **Bloom**: roll d12 to add a Bloom.
- **Make a Feast**: select party ingredients → Roll → Distribute Rating to each actor.
- A page is appended to **Beast Feast Cookbook** after each feast.

> Note: Actual HP/Stress/Hope application is stored in flags (`actor.flags['beast-feast'].lastMealGain`) to avoid touching system internals. GM may apply or wire to system updates.