# Open world: the city is the game

Direction (2026-10-18): free skate is the default, as in an open-world game. The whole map is always open,
you can drive, and there are many missions around. Funny characters with personalities, funny
storylines that are easy to skip and plentiful. A map to open and go places. Walk into stores, talk
to characters. Fewer people, more spots, less boring streets, better cars. Later, other maps
besides San Francisco.

This file is the shared plan for the open world. The specs for each part point here.

## Principles

1. **The city is the game.** The game boots into free roam at SoMa West. The pause menu (Esc) replaces
   the title menu. Nothing is locked: no Tour level gates, no area gates.
2. **Everything is optional and easy to skip.** Space or Enter advances a dialogue line, and Esc skips the
   whole conversation. Any mission can be declined, abandoned (Esc, then Abandon) or skipped. A skip
   marks it skipped and the story moves on. The story never blocks free skating.
3. **Plentiful.** Dozens of short side stories (one to three minutes), at least three per
   neighbourhood, each starting where its character stands. Walk up, press the talk key (F; E is step off), and it starts.
4. **Funny, with strong personalities.** Every character has one clear trait and is played straight.
   Lines are short (one or two sentences), voiced with generated voices (tools/gen_voices.py), and captioned.
5. **Reuse what exists.** Courier, bombs, Muni Race, Robotaxi Escape, S.K.A.T.E., Graffiti, gaps,
   goals, tapes and burritos become mission steps. Don't rebuild them.
6. **Places to go.** M opens the city map with markers. Set a waypoint and a route shows on the
   minimap. Fast travel to any place you have visited ("take Muni", with a short transition).
7. **More skating, fewer people.** Halve the pedestrians, add many more spots, and give the streets
   personality.

## Main story: Save SoMa West (six short chapters, each skippable)

The pitch: you just moved to SF with a board and a duffel bag. Karl the Fog, a smug cloud, appoints
himself your mentor. Chad Vantage, a tech landlord in a fleece vest (the Painted Ladies landlord from
the Hayes bomb), wants to turn SoMa West into a "micro-mobility experience hub". You make the city
care before the Board of Supervisors votes.

1. **New in Town.** Karl introduces himself. Rosa, the best local, calls your kickflip "mid". Chad
   rolls up in a robotaxi with a tablet: "We're going to activate this space." You land three tricks
   so Rosa lets you stay.
2. **Get Seen.** Marisol, a filmer who is never satisfied ("again, but with feeling"), needs footage:
   a line at Clarion Alley, a trick at Dolores, and an EMB ledge. She follows you with a fisheye.
3. **Get Sponsored.** Big Lou of Fog City Skate Shop (Mission), an ex-pro from 1994 whose every story ends
   in an injury, wants proof. You deliver his flyers (on the board or in the crew van) and win a
   S.K.A.T.E. game against Dre.
4. **Get Permits.** Gloria, the City Hall permit clerk, loves rules more than life. She wants
   signatures from five neighbourhood characters, and each one is a small side errand.
5. **Chad's Move.** Chad's robotaxis come to tow the ramps (a Robotaxi Escape twist). Then a Muni
   race gets the petition to City Hall before the clerk's window closes.
6. **The Jam.** The Save SoMa West jam: score attack in the park while the crowd and the Supervisors
   watch. The vote passes. Credits roll, then the city carries on as before with everything still to do.

## Cast

Recurring characters, each with one trait and a home spot:
- **Karl the Fog** (exists): mentor and narrator. Smug, takes credit for everything, roasts you gently.
- **Rosa** (exists, SoMa): deadpan. The best skater in SoMa. Everything is "mid".
- **Kenji, Dre, Tash** (exist): the crew. Kenji loses boards, Dre trash-talks, Tash is always filming on a flip phone.
- **Chad Vantage** (new, Hayes): fleece vest, startup jargon ("Let's circle back on your little hobby").
  Owns a robotaxi fleet. Never angry, always pivoting.
- **Big Lou** (new, Mission, inside Fog City Skate Shop): ex-pro, injury stories, sells you boards (the board shop moves here).
- **Marisol** (new, roams): filmer with a fisheye, perfectionist.
- **Gloria** (new, City Hall lobby): permit clerk, stamps, forms in triplicate.
- **Kevin from Three Bin** (exists as a racer): garbage-truck philosopher. "Everything is trash if you love it enough."
- **Grandma Wu** (new, Chinatown): the fastest grandma in SF. Races you with her shopping cart and pays in dumplings.
- **The Pigeon** (exists): runs the Union Square pigeon mafia. Favours for crumbs.
- **Captain Barnacle** (the Sea Lion, Pier 39): elder of the K-dock. His side story unlocks him as a skater.
- **Dolores** (new, Muni operator): permanently delayed, permanently calm. "We are being held."
- **Unit 7** (a robotaxi): becoming sentient and wants to be a skater. A running gag across the city.
- **Brayden** (new, Lombard and downtown): an e-scooter tech bro. Challenges you to races, pivots his startup every time you meet.
- **Sal** (new, Powell turntable): cable car gripman, strong opinions about tourists.

## Side stories (first set)

Each is one to three minutes and starts at its character. Where it fits, it ends in a funny reward line and a sticker.
- **SoMa:**
  - Freeway Pigeons (crumbs to the pigeon boss).
  - Kenji's Board (it's on a roof; find a way up).
  - Unit 7 Learns to Ollie (lead the robotaxi round the park).
- **Mission:**
  - The Burrito Run (courier, wrapped in a story).
  - Clarion Touch-up (tag the murals' blank walls, Graffiti rules).
  - Lowrider Hop-off (ollie over three parked lowriders).
- **Castro:**
  - Disco Escort (keep up with a roller-disco legend's route).
  - Rainbow Manual (manual the whole rainbow crosswalk).
- **Dolores and the hills:**
  - Kevin's Garbage Run (drive the garbage truck on his route).
  - The Tightrope Walker (stay balanced on a long rail while he does).
- **Hayes and Alamo:**
  - Chad's Scooter Fleet (outrun his rental scooters down Hayes).
  - Painted Ladies Photo (land a trick in the postcard angle).
- **Civic:**
  - Gloria's Lost Stamp.
  - The Lost Tourist (drive them to Pier 39 while they narrate everything wrong).
- **Downtown and Market:**
  - Dolores's Delay (clear the tracks for her streetcar).
  - The Union Square Pigeon Mafia.
  - Sal's Turntable (push the cable car round).
- **Embarcadero and Wharf:**
  - Captain Barnacle Wants to Skate.
  - Chowder Delivery (don't spill: a balance meter).
  - Farmers' Market Rush.
- **Chinatown and Lombard:**
  - Grandma Wu's Cart Race.
  - Brayden's Lombard Challenge.

## Systems and where they live

- **Story and missions:** this file's content, written out in docs/story.md. data/missions.json
  (missions as data: steps, characters, dialogue, rewards, flags). The mission engine in the sim
  (src/sim/game/missions.ts), with steps:
  - talk;
  - go to a place;
  - deliver;
  - reach a score, a gap or a trick at a spot;
  - race;
  - escape;
  - S.K.A.T.E.;
  - follow or escort;
  - drive to a place (once driving lands);
  - collect.

  The same part holds:
  - world markers;
  - the map screen (M) with waypoints, a minimap route and fast travel;
  - the journal (missions, challenges, the story);
  - booting into free roam, with the pause menu replacing the title menu;
  - the dialogue UI (portrait sticker, name, caption, voice line, skip);
  - generating the voice lines;
  - turning the Tour into open challenges per neighbourhood.

  First stage (done): the engine and its steps (talk, go, trick, collect, deliver, follow, mode), chapters 1 and 2
  and thirteen side stories voiced, free roam by default with the pause menu, the cast as stand-ins, markers, the
  talk key, the dialogue box, the journal, the city map with waypoints, the route and Take Muni, and the Tour as
  open challenges.
- **Sim (src/sim):**
  - Driving: the crew van first (the talk key, data/controls.json interact (F), to get in or out near it), then mission vehicles (the garbage truck). Arcade
    handling on the city's ground, collisions with buildings, traffic and the skater, pedestrians stepping away,
    deterministic, with scenarios.
  - The follow and escort movement that missions need.
- **Characters (src/client/skater, data/characters.json, data/cast.json):**
  - The new cast as characters in the sticker family: Chad, Big Lou, Marisol, Gloria,
    Grandma Wu, Brayden, Sal, Dolores and Unit 7's face. They stand at their spots, idle in
    character, turn to face you, and show a talk prompt.
  - Better car models for traffic and the van (from the asset research).
  - Fewer pedestrians, with more personality.
  - Character voices.
- **City (the world generator's city/build.py, src/client/city.ts):**
  - Interiors you can walk into: Fog City Skate Shop (Mission), a taqueria, a corner store or
    laundromat, and the City Hall lobby.
  - Many more skate spots: a DIY spot under the freeway, construction-site plywood ramps, handrails on stairs,
    plaza ledges, banks, and SF's real Potrero del Sol skatepark.
  - Street personality: food trucks, parklets, more murals, street furniture variety, varied ground floors.
  - Lombard, North Beach and Chinatown.
- **Asset research (docs/assets-research.md):** CC0 and CC-BY vehicles, city kits, interiors and skateparks, plus whole
  downloadable maps for other worlds. Licences verified, with recommendations. Nothing ripped from other games.
- **Client glue (src/client/main.ts):** the code that joins the parts above in the running game, and playtests.

## Not in scope (for now)

Stealing cars, combat, money. Rewards are stickers, unlocks, boards, outfits, and lines from characters.
