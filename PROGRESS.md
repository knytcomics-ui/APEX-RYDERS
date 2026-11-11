# APEX RYDERS — Progress & Handover

_Last updated: 2026-11-11 (end of R7.3)._

## What this game is
A 2D-looking arcade motorcycle endless runner (Subway-Surfers-like) set in a Nigerian city (Lagos-inspired), built with Phaser 3 + TypeScript + Vite. Three riders — Mach, Brute, Lynn — each with a passive, an Ultimate and a secondary ability, race a seeded procedural five-lane road full of debris, pickups, forks and three class-specific lethal hazards. Score comes from the chain multiplier; distance is tracked separately.

## Finished and working (all verified)
- **Road/world:** five lanes, curves, sharp turns, forks (safe vs risky shortcut), lagoon bridge, Lagos city scenery, comic cel-shaded look; one shared world-space projection (`src/render/camera.ts`).
- **Rider:** procedural 3D Mach rig rendered to a sprite (`src/characters/`), riding/lean/drift animation; Brute and Lynn use the same rig in blue/green liveries (temporary).
- **Lethal hazards** (rules in `src/world/hazards.ts`, sim in `src/sim/sim.ts`):
  Chasm (ramp lane, or Mach's Surge), Pillars (gap lane, or Brute's Smash), Mutant Spill (gap lane, or Lynn's Repellent). Order is a seeded **shuffle bag** (one of each per 3). First hazard ~370–480 m, gaps median ~480 m.
- **Abilities (R7.2 kit):**
  | Rider | Passive (auto) | Ultimate (S / swipe down) | Secondary (E / tap) |
  |---|---|---|---|
  | Mach | Blink: auto one-lane dodge of debris (0.25 s window, 1.5 s cooldown) | Surge Jump (100 Momentum) | Phantom Drive (50; +25% speed 4 s, ×1.25 score, 8 s cooldown) |
  | Brute | Near-Miss: +1 Momentum per adjacent debris pass | Smash (50) | Scrap (−1 DEF → double chain 5 s) |
  | Lynn | Regen: +1 HP every 12 s after 5 s damage-free | Repellent (50) | Full Heal (50 → HP to max) |
  - **Double Jump for everyone**: 25 Momentum, once per ordinary jump (not ramp flights, not Surge).
- **HP 2 / DEF 2** (DEF absorbs first), Momentum pickups (+10/+25, cap 100, no regen), chain score, HUD, title, cause-specific game-over headline, restart.
- **Hazard warning banner**: above the horizon in landscape, at the bottom in portrait.
- **Performance**: ~60 fps / 16.7 ms on the dev laptop **on mains power** (on battery it throttles to ~43 fps — not a code issue).

## Where we stopped
R7.3 was an **audit only** (no code changed). The code is complete and builds. Waiting for owner approval on:
1. **GRABBED! toast overlaps the Mutant Spill game-over headline.** Proposed fix: in `src/scenes/HudScene.ts`, the `events.on('mode', …)` handler in `create()` (~line 51) — when mode becomes `'over'`, set `this.t.toast.setAlpha(0)` and reset `this.toastUntil`.
2. **Surge is locked while Phantom Drive is paused at a Chasm** (rule as approved, literally). In simulation this caused a Mach death. Owner to decide: allow Surge while Phantom is paused (one-line change in `Sim.signature()` in `src/sim/sim.ts`), or keep it and make the HUD say so.

## Next steps (in order)
1. Get owner decisions on the two items above; implement the approved ones.
2. Owner balance decisions from R7.3: Phantom drains the Momentum Surge needs; Lynn's Full Heal dominates survival (regen rarely matters); Double Jump has little purpose (nothing requires height except crates).
3. Re-run the balance audit after any tuning (scripts below), on mains power.
4. Then return to presentation: real Brute/Lynn models, Stage C/D animation (jump/crash), final art.
5. Later: character select screen, more maps (Desert, Beach, Sky, Future — `src/world/environment.ts` is built for this), audio.

## Known bugs / half-done
- GRABBED! toast overlap (above).
- Phantom's Chasm hold releases at the far edge even mid ramp-flight (speed jumps mid-air past the gap; harmless).
- Brute/Lynn are recoloured Mach rigs (temporary, by design for now). Rider crash is a simple tip-over.
- Mutant Spill organism draws over nearby road when ridden through (placeholder art).
- Test bots never use Double Jump; balance numbers reflect the bot policy.

## How to run and test
```
npm install
npm run dev          # http://localhost:5180  (port 5180 on purpose: 5173 was used by an old project)
npm run build        # type-check + production build
```
Dev server must be running for the test tools:
- `node tools/mechanics-test.mjs` — 100 rule checks run against the real Sim in a headless browser (all pass as of R7.2).
- `GPU=1 node tools/chasm-drive.mjs` — real-key browser scenarios; `ONLY=chasm|pillars|spill|abilities`.
- `node tools/drive.mjs`, `node tools/autopilot.mjs <seed> <mach|brute|lynn> [s]`, `node tools/profile.mjs` — driving/perf helpers.
- Tools kill their headless Edge by profile folder on exit (Edge's launcher leaks processes otherwise). Use `GPU=1` for timing; screenshots work via CDP.

Debug URL flags: `?autostart=1&seed=7&god=1&mortal=1&lane=2&warp=<s>&find=chasm|pillars|mutantSpill&lead=0&ride=<m>&momentum=<n>&hp=<n>&def=<n>&rider=brute|lynn` and `?lab=rider` (rig viewer).

## Decisions not obvious from the code
- **Owner rules win** over the old docs in `docs/` (those are outdated). The owner gives numbered briefs (R1…R7.x) and wants a /10 rating of each prompt, concise reports, tested vs untested clearly separated, and **no Git operations unless explicitly asked**.
- Mechanics first, art later (owner decision at R2).
- Normal play is always **Mach**; `?rider=brute|lynn` are temporary test modes.
- Controls: A/D lanes, W/Space jump (again = Double Jump), S = Ultimate, E = secondary; mobile: swipes + tap = secondary.
- Visual style: bold comic outlines, cel shading, sun from the upper right (shadows fall left), Lagos city identity; source art in `Assets/` and `References/` is never overwritten (`npm run assets` regenerates `public/assets`).
- Balance values all live in `TUNING` (`src/core/config.ts`); hazard/ability rules in `src/world/hazards.ts` (`HAZARD_BYPASS`, `CHARACTER_KIT`).
- Lethal hazards ignore HP/DEF and jump height; only the matching rider's Ultimate (or the safe lane/ramp) gets through.
