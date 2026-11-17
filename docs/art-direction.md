# Art direction: tape

## Goals (2026-11-09)

Simpler menus, and no basic or clumsy illustrations. The UI should look stylish and sophisticated, like a real
skateboarding game: a PlayStation 2 era look done with taste and kept minimal, as a careful product designer or
creative director would do it.

This file is the shared direction for every part of the UI. When a choice is not covered here, pick the quieter option.

## The idea

A skate video from 2002, played on a PS2. Skate culture's own picture language is the VX1000 camcorder with a
fisheye lens: the low wide angle, the dark corners, the date stamp, the timecode. The PS2 era adds wide heavy
type, flat black, one signal colour and low-poly models shown with pride. We take both and keep them clean.

What it is not: stickers with white die-cut outlines, comic bursts ("SICK!"), mascots in sunglasses, gradients,
glows, glass panels, rounded cards, drop-shadowed boxes, emoji, neon. All of that goes.

## Rules

1. **The game is the picture.** Menus sit over the live 3D scene (dimmed), never over an illustration. Anything
   that needs an image (a character, a board, a place, a reward) shows the real in-game model or place, rendered
   by the engine in the house treatment below. No drawn illustrations anywhere in the UI.
2. **Type does the work.** Three faces, all bundled locally (no CDN, the game works offline):
   - **Archivo** at width 125 (Expanded), weight 800 to 900, for display: uppercase, letter-spacing about
     -0.02em, line-height 0.95. Menu items, the wordmark, scores, names, titles.
   - **Inter** Regular and Medium (`assets/fonts/`, SIL OFL) for text: sentence case, upright. No
     italics anywhere (the old UI's slanted labels go).
   - **IBM Plex Mono** 500 for the camcorder layer: timecode, date stamp, key hints, counters, units. Small
     (11 to 13 px), uppercase, letter-spacing 0.06em.
3. **Three colours.** Ink `#0B0B0C`, paper `#F2EFE8`, and one accent: International Orange `#FF4F1F` (the Golden
   Gate Bridge's colour). Secondary text is paper at 55% opacity. Nothing else: no green for success, no red for
   danger, no per-character colours in the chrome. State is shown by the accent, weight, or position.
4. **Lists, not grids.** Every menu is one vertical list of words, at most six items at the top level, the
   selected item in the accent with a solid block cursor to its left. A choice opens the next list to the right
   (drill down), and one preview area shows the thing being chosen in 3D. No cards, tabs, tiles or panels.
5. **No boxes.** No borders, no divider lines, no panel backgrounds. Group with space and alignment. Text over
   the scene gets legibility from the scene's dimming (menus) or a tight 1 px ink shadow (HUD), not from a box.
6. **The camcorder layer** is the one decoration, and it is small: a date stamp in the VX style
   (`NOV 9 2026`) and a running timecode in a corner, `PAUSE` with two bars when paused, `REC` with a dot when a
   clip is recording. Mono, paper colour, never more than two of these on screen at once.
7. **Motion is short.** 120 to 180 ms, ease-out, lists stagger by 20 ms per item. One flourish only: a two-frame
   tape tracking glitch when the pause menu opens and closes. Honour prefers-reduced-motion.
8. **Copy is plain.** Short labels, sentence case in text, no exclamation marks, no middle dots or dashes as
   separators, no small caps label above a heading, no emoji.

## House treatment for images

Every image in the UI (portraits, boards, places, loading photographs) gets one treatment so they read as a set:
high contrast, near monochrome (ink to paper), a little grain, optionally the accent as a flat field behind a
cut-out subject. Character portraits are head-and-shoulders renders of the in-game model, lit from one side,
on a flat ink or accent field, square. Photographs (loading screens, chapter cards) are black and white fisheye
flash photographs in the style of an early-2000s skate magazine, and they are engine renders in the house
treatment, never AI photographs or real people: the game's own cast at the game's own places, staged in
`data/photos.json` and rendered into `assets/ui/photo/` by `./skate photos` (re-run it after a character or the
city changes).

## The wordmark

`SOMA SKATE` set in Archivo Expanded Black, uppercase, tight, in paper on ink (or ink on the accent). Type only:
no board, no fog, no outline. It replaces `assets/ui/logo.png`.

## Screens

- **Loading and title.** Ink screen, the wordmark, a one-pixel-high progress line in the accent, one line of
  status in mono, the date stamp. A loading photograph may sit behind at low brightness.
- **Pause (Esc).** The scene keeps drawing, dimmed to about 40% and slowly orbiting the skater. Left: the list.
  Right: the preview for the selected item. Bottom: key hints in mono. Top right: `PAUSE` and the timecode.
- **HUD.** As little as possible while skating: the trick string and combo score bottom centre in Archivo
  (the string in text weight, the score in display), the special and balance meters as thin lines, the minimap as
  a plain square with no frame, a mission prompt as one line. Everything else appears only when it changes.
- **Dialogue.** A lower third: the speaker's name in display type in the accent, the line in text type, a square
  portrait in the house treatment, the skip hint in mono.
- **Results, rewards, unlocks.** Big type and a number. A reward shows its 3D model turning slowly, not a sticker.

## In-game look

The world is low-poly with photographic textures; that is the PS2 part, and it stays. The look pass makes it
read as filmed: a filmic tone curve, warm low sun with long soft shadows, haze that takes the sky's colour, a
little grain, and the filmer's lens (a mild fisheye with darker corners on the chase camera, stronger on the
slow-motion trick cameras). An optional "PS2" picture mode (low internal resolution, ordered dither) may sit in
Settings for fun; it is not the default.
