# APEX RYDERS

2D motorcycle arcade endless runner. Phaser 3 + TypeScript + Vite.

## Run

    npm install
    npm run dev        # http://localhost:5180

`npm run build` type-checks and produces `dist/`. `npm run assets` regenerates the
game-ready sprites in `public/assets` from the untouched source art in `Assets/`;
`npm run assets:ui` cuts the menu art into `public/assets/ui` from the reference sheets.

## Layout

    src/core     constants, tuning values, seeded RNG
    src/world    section templates + connectors, procedural route, pickups/debris, environments
    src/sim      deterministic fixed-step gameplay simulation (no rendering, no input devices)
    src/input    keyboard + swipe -> intents
    src/render   camera/projection, road + scenery painters, generated textures
    src/scenes   Boot, Game (loop + presentation), Hud (HUD, title, game over)
    src/ui       front-end menus (DOM overlay): home, modes, class select, garage, profile,
                 leaderboard, shop, settings, wallet, pause, run over. bridge.ts is the only
                 seam to the game; ?nomenu=1 skips the menus.
    tools        asset preparation and headless test helpers

Debug URL flags: `?seed=7&autostart=1&god=1&lane=3&warp=10&find=split`.
Hazards: `find=chasm` / `find=pillars` with `lead=0&ride=<m>`, `momentum=<n>`, `mortal=1`.
Temporary Brute test mode: `rider=brute` (S = Smash).
Checks: `node tools/mechanics-test.mjs` (rules) and `node tools/chasm-drive.mjs` (real key presses); dev server must be running.
