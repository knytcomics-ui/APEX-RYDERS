# APEX RYDERS

2D motorcycle arcade endless runner. Phaser 3 + TypeScript + Vite.

## Run

    npm install
    npm run dev        # http://localhost:5180

`npm run build` type-checks and produces `dist/`. `npm run assets` regenerates the
game-ready sprites in `public/assets` from the untouched source art in `Assets/`.

## Layout

    src/core     constants, tuning values, seeded RNG
    src/world    section templates + connectors, procedural route, pickups/debris, environments
    src/sim      deterministic fixed-step gameplay simulation (no rendering, no input devices)
    src/input    keyboard + swipe -> intents
    src/render   camera/projection, road + scenery painters, generated textures
    src/scenes   Boot, Game (loop + presentation), Hud (HUD, title, game over)
    tools        asset preparation and headless test helpers

Debug URL flags: `?seed=7&autostart=1&god=1&lane=3&warp=10&find=split`.
Hazards: `find=chasm` / `find=pillars` with `lead=0&ride=<m>`, `momentum=<n>`, `mortal=1`.
Temporary Brute test mode: `rider=brute` (S = Smash).
Checks: `node tools/mechanics-test.mjs` (rules) and `node tools/chasm-drive.mjs` (real key presses); dev server must be running.
