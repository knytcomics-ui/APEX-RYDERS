# APEX RYDERS

**Read `PROGRESS.md` first** — it has the current state, where we stopped, next steps and the owner's decisions.

- Stack: Phaser 3 + TypeScript + Vite. Run `npm run dev` (port 5180), check with `npm run build`.
- Rules/tests: `node tools/mechanics-test.mjs` (dev server must be running).
- Tuning lives in `src/core/config.ts` (`TUNING`); ability/hazard rules in `src/world/hazards.ts`.
- Keep the simulation deterministic (no `Math.random` in `src/sim` or `src/world`).
- Never overwrite files in `Assets/` or `References/`.
- No Git operations unless the owner explicitly asks.
