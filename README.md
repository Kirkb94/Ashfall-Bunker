# Ashfall Bunker

Run a cramped underground bunker in side view, twenty years after the bombs. Keep the crew fed and rested,
man the turrets through nightly raids, scavenge the wasteland yourself, and finish the signal tower that
might get everyone out.

This is the **web prototype** (stage 1 of the design brief in `design/brief.md`).

## Run it

```
node server.js
```

Then open http://localhost:3000. No packages to install (Node 18+).

## What's in this version

- **The bunker:** a cutaway with a surface hatch, an outer wall, two turret slots, and three floors: Workshop and Signal Room, Kitchen & Hydroponics and Med Bay, Bunks and Common Room.
- **The crew:** Old Bram, Juno Park, Doc Reed and Tick, plus random survivors. Each person has stats (Aim, Build, Cook, Medic, Tech), needs (health, food, rest), a job and a sleep shift.
  - Past 16 hours awake, people's work slows down exponentially.
  - Meals are at 07:00, 13:00 and 19:00. Badly hurt crew go to the med bay on their own.
  - People with shared history (Bram, Doc and Tick) work better side by side, and grieve when one of them is lost.
- **Defense:** raids arrive every night at 21:00 and grow each night. Turrets only fire with someone on them, and they hit more often with a better shot. Enemies have to break through the wall, then the turrets, then the hatch. When the hatch breaks, the fight moves inside, floor by floor. Battle stations (G) wakes everyone.
  - Enemy types: mutant hounds, ash ghouls, raiders (ranged) and brutes.
  - Cinder and his raiders attack on night 3.
- **The Workshop** repairs the hatch, wall and turrets with scrap, and turns spare scrap into parts.
- **Scavenging:** walk off the right edge of the surface to play a side-scrolling trip. Search wrecks, crates and lockers, fight mutants, and invite wanderers back home. The bunker keeps running while you're gone.
- **Wanderers and revolts:** newcomers join from trips or knock at the hatch. If their morale drops, they may leave in the night with your supplies.
- **XP and levels** for the crew and Mara.
- **Goal:** build the 4-stage signal tower to win. You lose if everyone dies.
- **Lamp,** the bunker AI installed by the original builders (and maintained by Old Bram and Dr. Anand), narrates and gives tips.
- **Autosave** every in-game hour. Continue from the title screen.

## Controls

A/D move · W/S climb the shaft · Space jump · J or click to shoot · E interact
C crew · B build · T signal tower · G battle stations · P pause · 1-3 speed · H help · Esc menu

## Files

- `server.js`: a static file server for `public/`
- `public/index.html`: the page and its styles
- `public/game.js`: the whole game, with sections for data, state, simulation, the player, drawing, UI and the main loop
- `design/brief.md`: the design brief
