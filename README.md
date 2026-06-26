# STELLAR DRIFT

A small browser-based **idle spaceship-colony survival sim** — keep a tiny crew alive aboard a drifting ship. Inspired by Space Haven / RimWorld, distilled to a single playable page of vanilla HTML/CSS/JS (no build step, no dependencies).

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8731
# then visit http://localhost:8731
```

## The loop

You manage a handful of named crew with roles and skills on a top-down tiled ship. They auto-pathfind around the ship to operate modules, sleep, eat, heal, and rush to emergencies. Keep production ahead of consumption — lose the whole crew and the run ends.

### Resources
- **Power** — the Reactor generates it; every module draws it (more when upgraded).
- **Life Support** — an engineer operates it to melt **Ice → Water**, turn **Water + Power → Oxygen**, and scrub **CO₂**. Crew breathe O₂ and exhale CO₂; damaged modules leak CO₂ too.
- **Storage** — Food (Hydroponics, from water + O₂), Water, Ice, Minerals (Mining Drone, from the sector's finite stock).
- **Fuel** — consumed to jump to a new, finite sector.

### Crew & modules
- Roles: **Engineer** (Reactor / Life Support), **Miner** (Mining Drone), **Botanist** (Hydroponics). Any crew can cover Life Support in an air emergency.
- Crew are **demand-driven**: they operate a module only while its output is needed and go idle (milling the corridor) once stores are full.
- **Per-module upgrades** — each module has independent attributes (output, storage, efficiency, beds, CO₂ scrub, water reclaim…), each with its own cost and effect preview.
- **Located hazards** — hull breaches and electrical fires appear at a spot on the ship; an engineer runs there and repairs on-site while it vents O₂ / leaks CO₂.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Page shell + UI containers |
| `style.css` | All styling (dark sci-fi theme) |
| `js/data.js` | Tunable config: resources, rooms, attributes, roles, events |
| `js/game.js` | State, simulation step, save/load, upgrades, events |
| `js/ship.js` | Top-down canvas ship: tilemap, A* pathfinding, crew pawns |
| `js/ui.js` | DOM rendering (top bar, crew panel, modals, build tray) |
| `js/main.js` | Bootstrap + the requestAnimationFrame game loop |

Progress auto-saves to `localStorage` (tab-open only).

## Status

Active prototype. Roadmap in progress: crew morale subsystem, mess hall, space-station blueprint economy, selectable sectors, schedules/day-clock.

🤖 Built with [Claude Code](https://claude.com/claude-code)
