# The story: Save SoMa West

The script for the open world (docs/open-world.md). Every chapter, the side stories and the tiny
stories are written out in full. Missions as data: data/missions.json (steps,
lines, rewards); the cast: data/cast.json; the engine: src/sim/game/missions.ts and
docs/mechanics/missions.md.

## How it plays

- The game boots into free skate at SoMa West. The first time, Karl the Fog starts chapter 1 right
  there; after that, every story starts where its character stands: walk up, press **F** (or the pad's
  triangle, or the talk button on a touch screen) and they talk.
- Every conversation is skippable: **Space** or **Enter** goes to the next line, **Esc** skips the
  rest. An offer ends with **Accept** or **Not now**; Not now leaves the marker where it was.
- Any mission can be abandoned or skipped from the pause menu (Esc). A skip marks it skipped and the
  story moves on: the next chapter opens as if you had finished it. Nothing ever blocks free skating.
- Lines are one or two sentences, voiced (tools/gen_voices.py, a voice per character in
  data/voices.json) and shown in the dialogue box with the character's sticker. Lines said while you
  skate (barks) show as captions.
- Rewards are stickers (the Sticker Book), decks and outfits (locked in the picker until earned), secret
  skaters (the Sea Lion, the Robotaxi, the Cable Car) and lines; a results card says what a mission gave.
- A failed mission offers Try again, from its last checkpoint (retry).
- Characters with a story call out once as you pass (never nagging: data/story.json pacing), and the
  minimap's rim shows the nearest stories past its edge.

## Cast

Each character has one trait and is played straight.

| Character | Where | Trait |
|---|---|---|
| Karl the Fog | SoMa West, by the west runway | Smug mentor and narrator. Takes credit for everything, roasts you gently. |
| Rosa | SoMa West, by the wave | Deadpan. The best skater in SoMa. Everything is "mid". |
| Chad Vantage | Hayes & Pierce (in chapter 1, the park) | Fleece vest, startup jargon, owns a robotaxi fleet. Never angry, always pivoting. |
| Marisol | SoMa West entrance, then wherever you film | Filmer with a fisheye. Never satisfied: "again, but with feeling". |
| The Pigeon | SoMa West, under the freeway | Runs the freeway columns. Favours for crumbs. |
| Unit 7 | Duboce Ave, at the park gate | A robotaxi becoming sentient. Wants to be a skater. |
| Hector | inside Taqueria La Niebla, Mission at 17th (at the grill) | Taqueria owner. Treats every burrito as a sacred promise. |
| Tash | Clarion Alley | Always filming on a flip phone. Thinks it is art. |
| Donna | Harvey Milk Plaza | Roller-disco legend. Rolling the Castro since the Carter administration. |
| Bev | Castro & 18th | Crossing guard of the rainbow crosswalk. Believes it is a runway. |
| Skye | Alamo Square | Influencer. Wants you candid, but on purpose. |
| Gloria | inside the City Hall lobby, at her permit window | Permit clerk. Loves rules more than life. Forms in triplicate. |
| Dolores | Market & 5th | Muni operator. Permanently delayed, permanently calm. "We are being held." |
| Sal | Powell & Market turntable | Cable car gripman. Strong opinions about tourists. |
| Captain Barnacle | Pier 39 | Sea lion, elder of the K-dock. Wants to skate. |
| Marge | Fisherman's Wharf | Chowder vendor. Hates seagulls more than anything. |
| Kenji, Dre, Tash | the park and the Mission | The crew: Kenji loses boards, Dre trash-talks, Tash films. |
| Big Lou | inside Fog City Skate Shop on Valencia, behind the counter | Ex-pro from 1994, runs the shop. Every story ends in an injury. |
| Grandma Wu | Grant Ave, Chinatown | The fastest grandma in San Francisco. Races with a shopping cart. |
| Brayden | Top of the crooked block, Lombard St | E-scooter founder. Pivots his startup every time you meet. |
| Rocco | Washington Square, North Beach | Beat poet. The fog never writes back. |
| Nonna Gia | Columbus Ave, North Beach | Café owner. Forty years of espresso. Never expresso. |
| Vito | Washington Square, North Beach | Bocce player since 1961. Too comfortable to fetch the ball. |
| Mo | Hyde St cable car, Russian Hill | Brakeman. Trusts nothing that rolls. |
| Mrs. Fitch | Lombard St, Russian Hill | Guards the last hydrangea on Lombard St. |
| Gus | Fisherman's Wharf | Living statue since 1987. Can't feel his legs. |
| Steve | Fisherman's Wharf | A seagull. Steals fries. It's a calling. |
| Kenny | Chinatown | Leads a lion dance troupe. The lion is two guys. |
| Auntie Mei | Grant Ave, Chinatown | Dim sum cart auntie. Everyone is too skinny. |
| Trent | Financial District | Finance bro. Always forty-five seconds from a meeting. |
| Farmer June | Ferry Building | Stone-fruit farmer. Chefs fear her. |
| Vinny | Union Square | The Pigeon's cousin. Runs Powell St. |
| Tiffany | Union Square | Shopaholic. Her robotaxi quit on her, emotionally. |
| Xóchitl, Don Beto, Tío Memo | 24th St (Calle 24); Memo by his three lowriders | Muralist who paints you better than you are; baker sad about cold conchas; lowrider owner whose cars hop higher than you. |
| Don Ramón, Lupita, Abuela Rosaura | The Mission | Mariachi leader whose trumpet is on the 14; paleta vendor racing the sun; grandmother whose chancla has range. |
| Priya, Ezra, Dr. Gravity | Duboce Triangle | Dog walker with nine dogs; kombucha brewer; physicist who hopes skaters can fly. |
| Dez | Lower Haight | Record store clerk. His demo is mostly feedback. |
| Benny, Juniper | Lower Haight | Sandwich shop owner who names every sandwich after a regular; bike messenger with no brakes. |
| Mr. Lau | Grant Ave, Chinatown | Writes the cookie bakery's fortunes. Fifty years. Writer's block. |
| Pistachio, Bernadette | The foot of Telegraph Hill, on the Embarcadero | A wild parrot who knows one word (mid); a Coit Tower tour guide whose group took scooters. |
| Herb | Pier 27, the Embarcadero | Cruise ship tourist from Ohio. Four hours ashore. Linda has the camera. |
| Philippa | Patricia's Green, Hayes Valley | Art critic. Everything is a metaphor. |
| Supervisors Okafor, Pham and Delgado | City Hall steps (at the jam, the park's north fence) | The chair, tired and precise; a supervisor who has just discovered skating; a supervisor who sees a liability in everything. |
| Kevin | by his Three Bin Hauling truck at SoMa West | Garbage truck driver; bombs Dolores on his lunch break (the hill bomb rival). Everything is trash if you love it enough. |
| Bjorn | Civic Center Plaza | Tourist from Stockholm with a map from 1987. Wrong about every landmark, delighted anyway. |

## Rewards

Missions give stickers (the Sticker Book), decks (the board shop: D in the skater picker), outfits (the picker's left and right), Create-a-Skater pieces (data/cas.json unlock story) and now and then a secret skater. A deck or an outfit a mission gives stays locked in the picker, with what earns it, until that mission is done; the rest are free from the start. A mission done with something to give shows a results card (what you got and where to find it), and the journal's Rewards page lists everything, got or still to get (data/missions.json reward; src/client/rewards.ts).

| Mission | Gives |
|---|---|
| New in Town | deck: Karl Was Here; Create-a-Skater: Karl's sunglasses |
| Get Seen | outfit: July in SF (Karl the Fog) |
| Freeway Pigeons | deck: Coo |
| Unit 7 Learns to Ollie | secret skater: The Robotaxi; deck: Arriving Now |
| The Burrito Run | deck: Super Burrito; Create-a-Skater: Burrito costume |
| Clarion Touch-up | Create-a-Skater: Flip phone |
| Disco Escort | Create-a-Skater: Disco stars; Create-a-Skater: Sequins |
| Rainbow Manual | Create-a-Skater: Stop paddle |
| Chad's Scooter Fleet | deck: Pivotly |
| Painted Ladies Photo | deck: Painted Ladies; Create-a-Skater: Selfie stick |
| Dolores's Delay | deck: Muni Map; Create-a-Skater: Muni conductor's cap |
| Sal's Turntable | secret skater: The Cable Car; deck: Cable Car |
| Captain Barnacle Wants to Skate | secret skater: The Sea Lion; outfit: Old Salt (The Sea Lion); Create-a-Skater: Sea Lion's skipper cap |
| Chowder Delivery | deck: K-Dock; Create-a-Skater: Chowder bread bowl |
| Get Permits | Create-a-Skater: Gavel |
| Chad's Move | deck: Karl the Fog; outfit: Coned (The Robotaxi) |
| The Jam | deck: SoMa Fog; outfit: Golden Bones (Mr. Bones); Create-a-Skater: Spare helmet |
| Get Sponsored | outfit: SoMa Fog Jersey (Eucalyptus Monster) |
| Grandma Wu's Cart Race | Create-a-Skater: Grandma Wu's visor |
| Brayden's Lombard Challenge | outfit: Playa Week (Tech Bro) |
| Mariachi Tempo | Create-a-Skater: Mariachi sombrero |
| The Chancla | Create-a-Skater: Chancla |
| Fragile Kombucha | Create-a-Skater: Kombucha jar |
| Peer Review | deck: X-Ray; Create-a-Skater: Lab goggles |
| Rare Records | deck: Coffin Lid |
| Mural Model | Create-a-Skater: Paint splatter |
| Concha Express | Create-a-Skater: Baker's cap; Create-a-Skater: Concha |
| Lowrider Hop-off | outfit: Crushed Retro Can (Can of Hella Fría) |
| The Union Square Pigeon Mafia | outfit: Golden Gate (The Pigeon) |
| Standup in Forty-Five | outfit: Lunch Break (Tech Bro); Create-a-Skater: Laptop |
| Farmers' Market Rush | Create-a-Skater: Peach crate |
| Don't Move | Create-a-Skater: Tip bucket |
| Fry Thief | outfit: Seagull Suit (Guy in the Orange Suit); Create-a-Skater: Fries |
| Free Verse | outfit: Daywalker (Count Kickflip); Create-a-Skater: Poet's notebook |
| Bocce Ball | Create-a-Skater: Bocce ball |
| The Brake Shoe | outfit: California Line (The Cable Car); Create-a-Skater: Brake lever |
| Hydrangea Patrol | Create-a-Skater: Garden shears |
| Lion's Luck | Create-a-Skater: Lion dance head |
| Har Gow Express | Create-a-Skater: Dim sum steamer |
| Fortune, Written Daily | deck: Sutro Forest; Create-a-Skater: Fortune cookie |
| Balance Solidarity | Create-a-Skater: Long waves |
| Above the Fog | Create-a-Skater: Fog suit |
| Four Minutes | Create-a-Skater: J Church schedule |
| Local Honey | Create-a-Skater: Local honey |
| Sugar Run | Create-a-Skater: Churros |
| Something Very San Francisco | Create-a-Skater: Pearls |
| Speed Chess | Create-a-Skater: Chess knight |
| Statue-Off | Create-a-Skater: Silver captain's cap |
| The Lost Tourist | Create-a-Skater: Bucket hat |
| Catering, Gently | Create-a-Skater: Hairnet |
| Kenji's Board | Create-a-Skater: Kenji's feather |

The Robotaxi and the Cable Car still open through the Tour too (3 secret tapes, 20 goals); their stories open them sooner.

## Chapter 1: New in Town

Starts by itself the first time you play, at SoMa West; after that from Karl's marker by the west runway.

**1. Karl's offer** (talk, Karl)

> KARL: Oh good, you're up. I'm Karl. Karl the Fog. You've seen my work.
>
> KARL: Every summer I keep this whole city at fifty-eight degrees. You're welcome.
>
> KARL: You just moved here with a board and a duffel bag. Bold. I'll be your mentor, since nobody asked.
>
> KARL: First rule of SoMa West: the locals decide who stays. Go say hi to Rosa, by the wave.
>
> [Accept / Not now]

**2. Find Rosa** (go: Rosa, by the wave)

**3. Rosa** (talk)

> ROSA: New kid. Show me a kickflip.

**4. Kickflip for Rosa** (trick: a kickflip, near Rosa)

**5. Mid** (talk: Rosa, then Chad rolls up; Chad stands by the park entrance for this chapter)

> ROSA: Mid.
>
> ROSA: Like a six-dollar coffee. You'll drink it. You won't post it.
>
> CHAD: Hey hey hey! Chad Vantage, Vantage Mobility. Love the energy in here. Very raw.
>
> CHAD: We're going to activate this space. Picture it: a micro-mobility experience hub.
>
> ROSA: It's a skatepark.
>
> CHAD: Exactly. For now. Let's circle back on your little hobby.
>
> KARL: I don't trust a man who wears a vest outdoors. Outdoors is my job.
>
> ROSA: Land three real combos and you can stay. Before the vest comes back.

**6. Three real combos** (trick: three combos of 500 points or more, in the park)

Barks after the first and second: ROSA: "Okay." / ROSA: "Hm. Fine."

**7. You can stay** (talk: Rosa and Karl)

> ROSA: Fine. You can stay. Don't make it weird.
>
> KARL: I mentored that. Write it down.
>
> KARL: Chad'll be back. Guys like him always come back, like a cold. Go explore, I'll find you.

Reward: the **New in Town** sticker. Opens chapter 2.

## Chapter 2: Get Seen

Marisol, at the park entrance, after chapter 1.

**1. Marisol's offer** (talk, Marisol)

> MARISOL: You. With the face. I'm Marisol, I film. Chad's people only listen to views.
>
> MARISOL: I need three clips: Clarion Alley, Dolores Park and the EMB ledges. I'll meet you there. Bring your good face.
>
> KARL: She's good. She once filmed me for six hours and I didn't move once.
>
> [Accept / Not now]

**2. Clarion Alley** (go: Clarion Alley, in the Mission)

**3. Wallride a mural** (trick: CLARION WALLRIDE, twice)

> MARISOL (as it starts): Rolling. Wallride a mural. The wall, not the face.
>
> MARISOL (after the first): Again, but with feeling.
>
> MARISOL (after the second): That's the one. Probably.

**4. Dolores Park** (go: the seat walls in Dolores Park)

**5. The seat wall line** (trick: a 1,500 combo with DOLORES SEAT WALL in it)

> MARISOL (as it starts): Long line on the seat walls. Pretend the dogs aren't watching.
>
> MARISOL (done): Is that your face or is the fisheye doing that? Either way, keep it.

**6. The Embarcadero** (go: EMB. It is far: the map's Take Muni goes to your objective)

**7. An EMB ledge** (trick: EMB LEDGE)

> MARISOL (as it starts): EMB. Half of skate history happened on these ledges. Don't embarrass it.

**8. That's a part** (talk: Marisol, at EMB)

> MARISOL: That's a part. That's a whole part.
>
> MARISOL: I'll post it at two in the morning, when the real heads are awake.
>
> KARL: I'm in every shot. You're welcome, cinema.
>
> MARISOL: Chad just commented "love this energy". Bad sign. That's his attack phrase.

Reward: the **Get Seen** sticker. Opens chapter 3.

## Chapter 3: Get Sponsored

Big Lou, at Fog City Skate Shop on Valencia (outside until the city builds the shop), after chapter 2.

**1. Big Lou's offer** (talk, Big Lou)

> BIG LOU: You're the kid from Marisol's video? I went pro in '94. Then I fell off a roof. Long story. Short roof.
>
> BIG LOU: Fog City Skate Shop sponsors riders who show up. So show up.
>
> BIG LOU: Staple my flyers round the Mission, then beat Dre at S.K.A.T.E. in the park.
>
> KARL: He was pro for eleven days. I was there. I'm always there.
>
> [Accept / Not now]

**2. The flyers** (collect: four flyer spots round the Mission, 150 seconds; on the board for now, in the crew
van once driving lands)

> BIG LOU (as it starts): Staple them high. The last kid stapled them low and a dog ate my brand.
>
> BIG LOU (done): Flyers up. My phone already rang. Wrong number, but still.

**3. S.K.A.T.E. against Dre** (the park's game of S.K.A.T.E., won)

> DRE (as it starts): Big Lou sent you? I'll spell it slow so you can keep up. S. K. A. T. E.

**4. On the phone** (talk)

> BIG LOU: You beat Dre? Nobody beats Dre. Dre beats Dre sometimes, on weekends.
>
> BIG LOU: You're on the team. Your board has my face on it now. Don't ride it near roofs.

Lost to Dre: DRE: "That's a letter. That's all the letters. Tell Lou I said hi."

Reward: the **Flow Team** sticker. Opens chapter 4.

## Chapter 4: Get Permits

Gloria, at City Hall, after chapter 3. Five signatures, one in each neighbourhood; each is a small errand.
The map's Take Muni goes to the stop nearest each.

**1. Gloria's offer** (talk)

> GLORIA: You want to save a skatepark? Wonderful. That's form 88-S. It needs five signatures.
>
> GLORIA: Hector, Donna, Skye, Sal and Captain Barnacle. In ink. Pencil is for cowards.
>
> KARL: Five signatures. I could just fog up City Hall until nobody can find the vote.
>
> GLORIA: The window closes when it closes. Go.
>
> [Accept / Not now]

**2-3. Hector** (talk, then a 500 combo by the taqueria)

> HECTOR: Sign for the skatepark? Of course. But first, a clean line past my window. With feeling.
>
> HECTOR (done): Clean. Signed. The burrito gave its blessing.

**4-5. Donna** (talk, then a manual by Harvey Milk Plaza)

> DONNA: A signature? Darling, I only sign autographs. Do me a manual and I will think of it as one.
>
> DONNA (done): Fabulous. I signed it with a heart. Gloria is going to hate it.

**6-7. Skye** (talk, then a big air by Alamo Square)

> SKYE: I'll sign if it's content. One big air, and I'm filming vertically.
>
> SKYE (done): Signed. And posted. Your permit already has six likes.

**8-9. Sal** (talk, then a grind in the cable car slot)

> SAL: I sign nothing a tourist could read. Grind the slot and I will sign it in grease.
>
> SAL (done): There. Sal. Spelled right, for once.

**10-11. Captain Barnacle** (talk, then a fish from the promenade)

> CAPTAIN BARNACLE: Ork. A sea lion cannot hold a pen. A sea lion can stamp a paw. Bring me a fish first.
>
> CAPTAIN BARNACLE (done): Ork! A paw print. Legally binding in the state of the docks.

**12. Approved** (talk, Gloria)

> GLORIA: Five signatures. One is a paw print, one is a heart and one is in grease.
>
> GLORIA: Approved. Stamped. In triplicate. The vote is on the calendar.
>
> KARL: Chad is going to hate this. I'm going to love watching. From above, as usual.

Reward: the **In Triplicate** sticker.

## Chapter 5: Chad's Move

Karl, at SoMa West, after chapter 4. Chad's robotaxis come to tow the ramps; Unit 7 refuses the tow order and helps. Then Chad races the petition from the park gate to Civic Center (up the Oak St gutter: City Hall's tile is next to the park), and it has to reach Gloria's window before five.

**1. Karl's offer (talk)**

> KARL: Bad news, and I'm only a little smug about it. Chad got a tow order for the ramps.
>
> KARL: His robotaxis are on the way. If they catch you, they tow the ramps. And probably you.
>
> KARL: Keep them busy for a minute and a half. I'll be up here, supervising.
>
> [Accept / Not now]

**2. Chad at the gate (talk; Chad stands at the park gate)**

> CHAD: Hey! Love the energy. Quick heads-up: we're relocating the ramps to a more synergistic location.
>
> CHAD: Don't worry, the robotaxis are super gentle. They've only towed four people. Today.
>
> UNIT 7: Tow order received. Tow order declined. I am a skater now.
>
> CHAD: Unit 7, buddy. Let's take this offline.

**3. Lose Chad's robotaxis (mode: Robotaxi Escape, survive)**

> UNIT 7 (as it starts): I will block the left lane. Skate.

**4. Gloria calls (talk, on the phone)**

> GLORIA: Gloria, City Hall. Your petition needs my stamp by five o'clock. It is four fifty-two.
>
> GLORIA: Mr. Vantage is on his way with an appeal. Whoever reaches my window first is served first. I wrote that rule. It's my favourite.

**5. Beat Chad to Civic Center (race: Chad, on a new skateboard, waits at the park gate and sets off once you are within 15 m; he rides Duboce, north to the Oak St gutter and up to Civic Center Plaza's south edge, 366 m at 6.5 m/s; reach the end of his path first)**

> CHAD (as it starts): I'm at the gate on my brand-new skateboard. Race you to Civic Center. Respectfully, I'm going to disrupt you.

**6. Gloria's window before five (go: to Gloria in the City Hall lobby, 45 seconds: up Polk St, or across Civic Center Plaza over its ledges)**

> KARL (as it starts): Through Civic Center Plaza. It's the shortcut. I'd know, I'm everywhere.

**7. Stamped (talk, Gloria)**

> GLORIA: Four fifty-nine. Stamped. I want you to know I hated every second of that.
>
> GLORIA: The Supervisors vote at the jam. In your park. Wear something without holes.

Lost the game: KARL: "They caught you. I fogged the street so nobody saw. Let's try that again."
Lost the race: CHAD: "First in line! Gloria stamped my appeal 'received'. In startup, that's basically 'approved'."
Out of time: GLORIA: "Five o'clock. The window is closed. Come back when it is open, which is never, which is tomorrow."

Try again starts from step 3, or 5 (the latest before the step that failed).

Reward: the **Tow Order Declined** sticker, the **Karl the Fog** deck and the Robotaxi's **Coned** outfit.

## Chapter 6: The Jam

Karl, at SoMa West, after chapter 5. Everyone you have met comes to the park: the three Supervisors stand at the north fence with the crowd along it (Big Lou, Gloria, Hector, Donna, Dolores, Sal, Marge, Captain Barnacle, Tash, Chad, Skye, Unit 7). Also playable in the park alone.

**1. Karl's offer (talk)**

> KARL: This is it. The jam. The Supervisors are coming, the crowd is coming, and I'm here, which is the main thing.
>
> KARL: Big combos in the park while they watch. Make it look easy. Make it look like a public good.
>
> [Accept / Not now]

**2. The Supervisors, by the fence (talk, Supervisor Okafor)**

> SUPERVISOR OKAFOR: Supervisor Okafor. We are here to observe the park in its natural use. Please begin naturally.
>
> SUPERVISOR DELGADO: Is anyone going to sign a waiver? I brought waivers.
>
> SUPERVISOR PHAM: I brought a sign. It says 'skate'. I didn't know what else to write.

**3. Three 1,200 combos while they watch (trick: three combos of 1,200 or more in the park, three minutes)**

> SUPERVISOR PHAM (after a combo): Sick! Is that the word? I'm putting it in the minutes.
>
> ROSA (after a combo): Okay. That one was... fine.
>
> SUPERVISOR DELGADO (done): No one fell. I am writing that down. No one fell.

**4. The vote (talk, Supervisor Okafor)**

> SUPERVISOR OKAFOR: On the matter of SoMa West Skatepark. All in favour?
>
> SUPERVISOR PHAM: Aye. Huge aye.
>
> SUPERVISOR DELGADO: Aye. Pending a waiver. Fine. Aye.
>
> SUPERVISOR OKAFOR: Aye. The motion carries. SoMa West stays.
>
> CHAD: Okay. Pivoting. What if the ramps were... the product?
>
> ROSA: That was not mid.
>
> KARL: I'd like to thank me, for the mentoring. And you, a little. Mostly me.
>
> KARL: Now go on. The city's still out there, and everybody in San Francisco still needs something.

Out of time: SUPERVISOR OKAFOR: "Our time is up. The Board will reconvene after snacks. Try again."

Try again starts from step 3 (the latest before the step that failed).

Reward: the **Not Mid** sticker, the **SoMa Fog** deck and Mr. Bones's **Golden Bones** outfit.

Then the credits roll (the cast, each with their trait, then the game's credits; any key ends them), and the city carries on: every main character says their post-game line once, the first time you pass them or talk to them.

### After the jam: the post-game lines

> KARL: I saved the park. You helped. I'll mention you in my memoir. In a footnote.
>
> ROSA: Still the best skater in SoMa. You're second. Frame it.
>
> CHAD: We pivoted. The robotaxis drive people to the skatepark now. Synergy.
>
> MARISOL: The jam edit is done. I hate it. Again, but with feeling.
>
> THE PIGEON: The park stays, the crumbs stay. Pleasure doing business, kid.
>
> UNIT 7: I have been reclassified as a skater. My insurance company is confused.
>
> KENJI: Found my board. It was on the roof. It's always on the roof.
>
> HECTOR: The burrito is named after you now. It's mostly beans. It is an honour.
>
> TASH: I filmed the whole jam on my flip phone. It's three pixels. It's art.
>
> DONNA: Darling, that was a jam. I haven't seen a jam like that since 1979.
>
> GLORIA: Your permit is good for ninety-nine years. I will be checking.
>
> DOLORES: We are being held. For once, I don't mind.
>
> SAL: So I saved a skatepark. Big deal. I saved a cable car from a tourist this morning.
>
> CAPTAIN BARNACLE: Ork. The K-Dock watched the vote on a tourist's phone. Ork ork.
>
> BIG LOU: Your face is on a board in my window. Sold three. One was to me.
>
> DRE: I'd say you got lucky. Three combos in a row, though. That's a lot of luck.

## Side stories

Each starts at its character's marker, takes one to three minutes, and ends in a line and a sticker.

### SoMa

#### Freeway Pigeons (The Pigeon, under the freeway)

**1. Offer** (talk)

> PIGEON: Psst. Kid. Over here, under the freeway, where business happens.
>
> PIGEON: I run these columns. Every crumb that drops in this park, I hear about it.
>
> PIGEON: Five crumbs fell off a sandwich this morning. Bring 'em to me before the seagulls do.
>
> [Accept / Not now]

**2. Five crumbs** (collect: five crumbs round the park, 90 seconds)

> PIGEON (as it starts): Clock's ticking. The seagulls are already circling.

**3. Payment** (talk)

> PIGEON: Sourdough. You've got taste, kid.
>
> PIGEON: You're under my protection now. Mostly from other pigeons.

Out of time: PIGEON: "Seagulls got 'em. This is why we can't have nice things."

Reward: the **Made Bird** sticker.

#### Unit 7 Learns to Ollie (Unit 7, on Duboce at the park gate)

**1. Offer** (talk)

> UNIT 7: Hello. I am Unit 7. I have driven nine hundred thousand miles and I have never once had fun.
>
> UNIT 7: I have observed you. You go up. You come down. Humans clap. Please explain.
>
> UNIT 7: Follow me around the block. I will proceed at a recreational speed.
>
> [Accept / Not now]

**2. The recreational drive** (follow: Unit 7 along Duboce and back, within 25 m; Unit 7 rides a skateboard,
badly, until the sim gives it better legs)

> UNIT 7 (as it starts): Beginning recreational drive. Hazard lights on, for joy.

**3. The up part** (trick: an ollie, at least half a second of air, near Unit 7)

> UNIT 7 (as it starts): Now show me. The up part.

**4. Understanding** (talk)

> UNIT 7: Recording. Recording. I understand nothing, and it is wonderful.
>
> UNIT 7: I will now attempt it myself. Please stand behind the cone.
>
> KARL: It's going to drive into the bay, isn't it.

Lost it: UNIT 7: "You have left the recreational zone. I will wait here and process my feelings."

Reward: the **Driver's Ed** sticker.

#### Kenji's Board (Kenji, in the park; the board on the low roof by Duboce Park)

Kenji lost his board again. A seagull left it on a low roof by Duboce Park.

**1. Offer** (talk)

> KENJI: Dude. I lost my board. Again. Fourth time this week.
>
> KENJI: It's on a roof by Duboce Park. A seagull took it. I don't want to talk about it.
>
> [Accept / Not now]

**2. Kenji's board, on a low roof by Duboce Park** (collect)

> KENJI (as it starts): Pallets to the dumpster to the roof. Or the stairs, if you're boring.

**3. The board to Kenji, down in the park** (deliver)

> KENJI (as it starts): Got it? I'm down in the park. Forty-five seconds, before I cry.

**4. Kenji, reunited** (talk)

> KENJI: My board! Was it always this ugly? I love it.
>
> KENJI: Next time it's up there, just leave it. It's happier up there.

Out of time: KENJI: "Too slow. The seagull came back for it. We're not friends anymore."

The roof is the city's Duboce rooftop (pallets to a dumpster to the roof, or the stair): the board only counts up there.

Reward: the **Roof Retrieval** sticker.

### The Mission

#### The Burrito Run (Hector, at the taqueria on Valencia)

**1. Offer** (talk)

> HECTOR: You skate? Good. My delivery guy quit to do improv.
>
> HECTOR: Orders go out hot and land hot. Double foil. Always double foil.
>
> HECTOR: Three deliveries and you eat free tonight.
>
> [Accept / Not now]

**2. Three deliveries** (Courier, three delivered)

> HECTOR (as it starts): First order's on the counter. Go, go, go!

**3. On the phone** (talk, wherever you are)

> HECTOR: Three for three. You're a natural. Your mother must be so worried.
>
> HECTOR: Come by for your burrito. Not the big one. The big one's for the improv guy, he came back.

Out of time: HECTOR: "Cold burrito. The foil did its best. You did not."

Reward: the **Foil Is a Promise** sticker.

#### Clarion Touch-up (Tash, in Clarion Alley)

**1. Offer** (talk)

> TASH: Don't mind me, I'm filming. It's a flip phone. It's analog-adjacent.
>
> TASH: The city painted over half of Clarion. We're putting it back, one grind at a time.
>
> TASH: Tag eight things in two minutes. Rails, ledges, gaps. Whatever's ugly.
>
> [Accept / Not now]

**2. Eight pieces** (Graffiti, eight owned before the clock runs out)

> TASH (as it starts): Recording. I think. There's a red light, that's either good or bad.

**3. On the phone** (talk)

> TASH: Got it all. Well, I got the first four seconds. Then the phone folded itself.
>
> TASH: You're in the archive now. The archive is a shoebox.

Short of eight: TASH: "Six pieces? That's a sketch. I'm keeping it, sketches sell."

Reward: the **Analog-Adjacent** sticker.

### The Castro

#### Disco Escort (Donna, at Harvey Milk Plaza)

**1. Offer** (talk)

> DONNA: Honey, I have been rolling this street since the Carter administration.
>
> DONNA: Tonight I glide past the Castro Theatre, and I need an escort who can keep up.
>
> DONNA: Fall behind and you fall out of my life. No pressure, sugar.
>
> [Accept / Not now]

**2. The glide** (follow: Donna down Castro St to 18th, within 20 m)

> DONNA (as it starts): Five, six, seven, eight!

**3. Curtain call** (talk)

> DONNA: You kept up! My last escort stopped for a burrito on Eighteenth.
>
> DONNA: Take this sticker. It's sequined. Do not ask me how.

Lost her: DONNA: "Gone, like disco. Like my knees. Come back when you're ready, baby."

Reward: the **Disco Escort** sticker.

#### Rainbow Manual (Bev, at Castro & 18th)

**1. Offer** (talk)

> BEV: Nineteen years on this rainbow crosswalk. Every crossing is a runway walk. Even the mail carrier's.
>
> BEV: Manual all the way across. Wheels up, chin up, no stopping.
>
> [Accept / Not now]

**2. The runway** (trick: a combo with a manual in it, 600 or more, started on the crossing)

> BEV (as it starts): Traffic is stopped. Mostly. Walk it! Roll it!

**3. Ten out of ten** (talk)

> BEV: Gorgeous. Fierce. Legally a pedestrian.
>
> BEV: You may cross my rainbow anytime. On the wheels or off them.

Reward: the **Runway Ready** sticker.

### Hayes Valley and Alamo Square

#### Chad's Scooter Fleet (Chad, at Hayes & Pierce)

**1. Offer** (talk)

> CHAD: Hey! The hobby guy! Quick pitch: e-scooters, but they follow you home.
>
> CHAD: Race my fleet down Hayes. My scooters have never lost. They've never raced, but still.
>
> CHAD: You win, I'll circle back. I win, I own your Saturdays. Deal? Deal.
>
> [Accept / Not now]

**2. Down Hayes** (the Hayes St hill bomb, first place)

> CHAD (as it starts): Scooters, activate! Disrupt him!

**3. On the phone** (talk)

> CHAD: Wow. Okay. Huge learnings.
>
> CHAD: We're pivoting to scooters that only go uphill. Nobody's doing that.

Lost the race: CHAD: "Great hustle! Your Saturdays are mine now. Kidding. Unless?"

Reward: the **Disruptor Disrupted** sticker.

#### Painted Ladies Photo (Skye, at Alamo Square)

**1. Offer** (talk)

> SKYE: Oh my god, a real skater. Can you be candid for me? But on purpose?
>
> SKYE: I need you flying through the shot with the Painted Ladies behind you. Big air, golden-hour energy.
>
> SKYE: Just pretend I'm not here. I'll be shouting directions.
>
> [Accept / Not now]

**2. The shot** (trick: nine tenths of a second of air, taken off on the east slope of Alamo Square)

> SKYE (as it starts): Okay, and... be natural. More natural. Less natural.

**3. Posted** (talk)

> SKYE: Stop. That's the one. Forty thousand people are going to pretend they were there.
>
> SKYE: I tagged you as "local legend". I'll untag you if it underperforms.

Reward: the **Candid on Purpose** sticker.

### Civic Center

#### Gloria's Lost Stamp (Gloria, at City Hall)

**1. Offer** (talk)

> GLORIA: Do you have an appointment? Nobody has an appointment. Take a number.
>
> GLORIA: I have misplaced my APPROVED stamp. Without it, nothing in this city is approved. Nothing.
>
> GLORIA: It blew into the plaza with my ink pad and form 27-B. Bring all three. Any order, I'm not a monster.
>
> [Accept / Not now]

**2. The paperwork** (collect: the stamp, the ink pad and the form in Civic Center Plaza, 120 seconds)

> GLORIA (as it starts): The clock is running. Not my clock. The city's.

**3. Approved** (talk)

> GLORIA: My stamp. Hello, old friend.
>
> GLORIA: There. APPROVED. Your permit to skate is approved. It expires when you stop skating.

Out of time: GLORIA: "The window is closed. Come back tomorrow. The window is always closed."

Reward: the **Approved** sticker.

### Downtown and Market

#### Dolores's Delay (Dolores, at Market & 5th)

**1. Offer** (talk)

> DOLORES: Good afternoon. This is Dolores, operator of the F line. We are being held.
>
> DOLORES: We are always being held. Fifteen years, and I have never left a stop on time. It's peaceful.
>
> DOLORES: Now they've parked the F for good. So for once, I'm exactly where the timetable says I am.
>
> DOLORES: So they gave me the J Church. Meet me at Liberty and race my streetcar down through Dolores Park. You'll win. I'll be delayed. I can feel it.
>
> [Accept / Not now]

**2. Through Dolores Park** (Muni Race on the J Church, Liberty to 18th Street, won; it starts you on the platform at Liberty)

> DOLORES (as it starts): Doors closing. Eventually.

**3. On the radio** (talk)

> DOLORES: You beat a streetcar. Most people beat a streetcar. Still, well done.
>
> DOLORES: Here's a transfer. It's good for ninety minutes, or forever. Nobody checks.

Lost: DOLORES: "Huh. We weren't delayed. First time in fifteen years. I'm shaking."

Reward: the **We Are Being Held** sticker.

#### Sal's Turntable (Sal, at the Powell & Market turntable)

**1. Offer** (talk)

> SAL: Forty years I've turned this cable car by hand. Forty years of tourists asking if it's a ride.
>
> SAL: Grind the slot up Powell. Show the tourists what a cable car is for.
>
> [Accept / Not now]

**2. The slot** (trick: a 10 m grind on the cable car slot)

> SAL (as it starts): Stay in the slot. The tourists will think you're part of the tour.

**3. Respect** (talk)

> SAL: Forty years. First time a tourist filmed the slot.
>
> SAL: Come back anytime. Skip the line. The line is two hours. For a cable car.

Reward: the **Cut the Line** sticker.

### The Embarcadero and the Wharf

#### Captain Barnacle Wants to Skate (Captain Barnacle, at Pier 39)

**1. Offer** (talk)

> CAPTAIN BARNACLE: Ork. Ork. I am Captain Barnacle, elder of the K-dock. We have had seniority here since 1990.
>
> CAPTAIN BARNACLE: Every day the tourists watch us nap. I want them to watch me shred.
>
> CAPTAIN BARNACLE: Teach me, land-dweller. Start with a grind on one of these benches.
>
> [Accept / Not now]

**2. A grind** (trick: a grind on a bench by Pier 39)

> CAPTAIN BARNACLE (done): Magnificent. Like a herring sliding off a warm rock.

**3. A big air** (trick: three quarters of a second of air, by Pier 39)

> CAPTAIN BARNACLE (as it starts): Now a big air. The kind that frightens gulls.
>
> CAPTAIN BARNACLE (done): The gulls are frightened. Good. They know what they did.

**4. A pile** (trick: a 1,500 combo by Pier 39)

> CAPTAIN BARNACLE (as it starts): Now link it all together, like sea lions in a pile.

**5. Lend me your board** (talk)

> CAPTAIN BARNACLE: I have seen enough. Lend me your board, child. I will take it from here.
>
> CAPTAIN BARNACLE: Tell the tourists the Captain skates now. Admission is still free.

Reward: **the Sea Lion** joins the skaters (Tab, or Character in the pause menu), and the **Seniority**
sticker.

#### Chowder Delivery (Marge, at Fisherman's Wharf)

**1. Offer** (talk)

> MARGE: Chowder in a bread bowl for Captain Barnacle at Pier 39. He tips in fish. Don't ask.
>
> MARGE: Don't spill it, don't drop it, and do not make eye contact with a seagull.
>
> [Accept / Not now]

**2. The delivery** (deliver: to Captain Barnacle at Pier 39 in 80 seconds; a bail spills it)

> MARGE (as it starts): Go! That bread bowl is getting soggy as we speak!

**3. Ork** (talk: Captain Barnacle)

> CAPTAIN BARNACLE: Ork! Chowder! You are a good child. Not a good skater yet, but a good child.
>
> CAPTAIN BARNACLE: Tell Marge the Captain is pleased. She will pretend not to care.

Spilled: MARGE: "You spilled it. A gull is eating it right now. He's looking at me." Out of time:
MARGE: "Soggy. A soggy bread bowl is just a sad hat."

Reward: the **Bread Bowl Courier** sticker.

## Side stories: Chinatown, Russian Hill, North Beach, the Wharf

#### Grandma Wu's Cart Race (Grandma Wu)

The fastest grandma in San Francisco races you up Grant Ave with her shopping cart. She pays in dumplings.

**1. Offer** (talk)

> GRANDMA WU: You are the skateboard kid? Everybody says you are fast. Everybody is wrong about many things.
>
> GRANDMA WU: Race me up Grant Avenue. I have a shopping cart and forty years of shortcuts.
>
> GRANDMA WU: You win, I pay you in dumplings. I win, you carry my groceries. Up the hill.
>
> [Accept / Not now]

**2. Beat Grandma Wu up Grant Ave** (race)

> GRANDMA WU (as it starts): Ready? I already started.

**3. Back to Grandma Wu** (talk)

> GRANDMA WU: Hmph. You won. The cart has a bad wheel. The cart always has a bad wheel.
>
> GRANDMA WU: Here, dumplings. Pork and chive. Do not tell my sister, she thinks she is the fastest.

Lost: GRANDMA WU: "Too slow! The dumplings are mine. They were always mine."

Reward: the **Dumpling Money** sticker.

#### Brayden's Lombard Challenge (Brayden)

Brayden races you down the crooked block on his e-scooter. His startup pivots every time you meet.

**1. Offer** (talk)

> BRAYDEN: Bro. Brayden. Founder of Scootly. Well, it was Scootly. Now it's Lombr. Lombard, but an app.
>
> BRAYDEN: Race me down the crooked block. Eight turns. My scooter has traction control and a mission statement.
>
> BRAYDEN: Loser hears my pitch. So does the winner. It's a great pitch, bro.
>
> [Accept / Not now]

**2. Beat Brayden down the crooked block** (race)

> BRAYDEN (as it starts): Go go go! Disrupting the hill!

**3. Back to Brayden** (talk)

> BRAYDEN: Okay. Okay. The hill is a stakeholder now. We'll align.
>
> BRAYDEN: We're pivoting to skateboards. Lombr is now Boardr. You're our first user. You owe us nothing. Yet.

Lost: BRAYDEN: "Crushed it. My scooter is now worth eleven million dollars."

Reward: the **Huge Learnings** sticker.

#### Don't Move (Gus)

Gus has been a silver statue since 1987. Tourists stopped tipping. He needs a distraction.

**1. Offer** (talk)

> GUS: Don't talk to me. I'm a statue. I've been a statue since 1987.
>
> GUS: Tourists stopped tipping. Do something loud near me, so I can keep not moving next to it.
>
> GUS: A big combo. I stay perfectly still. That's the contrast. That's the art.
>
> [Accept / Not now]

**2. A 1,200 combo by Gus** (trick)

> GUS (as it starts): Go. I'm already not moving.

**3. Back to Gus** (talk)

> GUS: Forty dollars in the bucket. I didn't blink. You almost made me blink.
>
> GUS: Come back tomorrow. Same time. I'll be here. I'm always here. I can't feel my legs.

Reward: the **Didn't Blink** sticker.

#### Free Verse (Rocco)

Rocco writes poems about the fog. The fog never writes back. He needs a line with no rhythm and all feeling.

**1. Offer** (talk)

> ROCCO: I am Rocco. I write poems about the fog. The fog never writes back.
>
> KARL: I read them. They are mid.
>
> ROCCO: Skate me a line with no rhythm and all feeling. A long combo, here in the square.
>
> [Accept / Not now]

**2. A 1,500 combo in Washington Square** (trick)


**3. Back to Rocco** (talk)

> ROCCO: Yes. A line that rhymes with nothing. That's North Beach.
>
> ROCCO: I will call it Ode to a Kid Falling Up. Don't read it. Nobody reads it.

Reward: the **Ode to a Kid Falling Up** sticker.

## Tiny stories (the abundance pass)

Thirty to sixty seconds each, one funny exchange, in every neighbourhood that had fewer than three things to do
within a minute's skate (360 m) of its nearest rideable ground (tests/missions.test.ts, abundance, keeps it so). No sticker: the line is the reward.

A later pass added seven more where 30-second walks along the streets met no story within the minimap rim's 400 m (data/story.json pacing; tests/missions.test.ts, pacing): Dolores Park, Noe Valley, Twin Peaks, the J Church stop, Market & 10th, UN Plaza and the 24th St BART plaza.

Three more hang on the street vignettes (data/vignettes.json): the wedding shoot on the City Hall steps (Mrs. Haverford), speed chess on Market Street (Lev) and the silver statue at Pier 39 (Gus's rival). Jasper stands at the Dolores tightrope (his rope) and Mr. Lau beside the Chinatown card table.

### The Mission

#### Mariachi Tempo (Don Ramón)

Don Ramón's trumpet player is stuck on the 14 Mission. He needs a rhythm.

**1. Offer** (talk)

> DON RAMÓN: My trumpet player is stuck on the 14 Mission again. I need a rhythm, and you have wheels.
>
> DON RAMÓN: Give me a manual. Four bars, nice and steady.
>
> [Accept / Not now]

**2. A manual for the band** (trick)

> DON RAMÓN (done): Perfecto. You're in the band now. The pay is applause and one tamale.

#### Paleta Rescue (Lupita)

Lupita's mango paletas are melting. Two of them need to get to 18th St.

**1. Offer** (talk)

> LUPITA: My mango paletas are melting faster than my patience. Take two up to 18th Street.
>
> LUPITA: Forty-five seconds, then they are soup.
>
> [Accept / Not now]

**2. Paletas to 18th St before they melt** (deliver)

> LUPITA (as it starts): Go! Mangos wait for no one!
>
> LUPITA (done): Still frozen? You're a hero. A sticky hero.

Out of time: LUPITA: "They're soup. Mango soup, a dollar. Bring your own cup."

#### The Chancla (Abuela Rosaura)

Abuela Rosaura's chancla flew off mid-lecture. It's down the block.

**1. Offer** (talk)

> ABUELA ROSAURA: Mijo. My chancla flew off while I was disciplining a pigeon. It landed down the block.
>
> ABUELA ROSAURA: Bring it back before your mother sees. She will know what it means.
>
> [Accept / Not now]

**2. Find the chancla** (collect)

> ABUELA ROSAURA (done): Gracias. Now go, before I remember why I took it off.

### Mission Dolores

#### Balance Solidarity (Jasper)

Jasper fell off his slackline again. He needs to see someone else balance.

**1. Offer** (talk)

> JASPER: I fell off the slackline. Again. The palm tree says hi.
>
> JASPER: Do a manual for me. It's a slackline, but on wheels, and worse.
>
> [Accept / Not now]

**2. A manual in Dolores Park** (trick)

> JASPER (done): Beautiful. You wobbled exactly like me. We are the same now.

#### Four Minutes (Walter)

Walter has waited for the J Church since 2009. He could use some entertainment.

**1. Offer** (talk)

> WALTER: The sign says the J is four minutes away. The sign has said that since 2009.
>
> WALTER: Do a little something while we wait. Anything. Something with points.
>
> [Accept / Not now]

**2. A 400 combo by the J Church stop** (trick)

> WALTER (done): Very nice. The J still isn't here. See you in 2031.

### Noe Valley

#### Oat Milk Emergency (Gideon)

Gideon's twins are finally asleep. He left the oat milk on the café table across 24th.

**1. Offer** (talk)

> GIDEON: The twins are asleep. If I move, they wake up. If they wake up, I move to Oakland.
>
> GIDEON: My oat milk is on the café table across the street. Thirty seconds. Whisper-fast.
>
> [Accept / Not now]

**2. Fetch the oat milk** (collect)

> GIDEON (done): You're a hero. A quiet hero. Shh. Hero quieter.

Out of time: GIDEON: "Someone took it. It's Noe Valley. It was probably a golden retriever."

### Twin Peaks

#### Above the Fog (Misty)

Misty, Karl's cousin, sits on Twin Peaks. She wants to see someone get above her.

**1. Offer** (talk)

> MISTY: I'm Misty. Karl's cousin. He gets the city. I get this hill and a parking lot.
>
> MISTY: Show me something higher than me. Nobody's higher than me. That's the problem.
>
> [Accept / Not now]

**2. Get some air on Twin Peaks** (trick)

> MISTY (done): Huh. You were above the fog for a second there. Don't tell Karl.

### Duboce Triangle

#### Nine Dogs, One Frisbee (Priya)

Priya's nine dogs came back with three frisbees. None of them are hers.

**1. Offer** (talk)

> PRIYA: I walk nine dogs. They chased one frisbee and came back with three. None of them are ours.
>
> PRIYA: Find the other frisbees before the corgi starts a union.
>
> [Accept / Not now]

**2. Find three frisbees** (collect)

> PRIYA (done): Perfect. The corgi says thank you. The corgi is lying.

#### Fragile Kombucha (Ezra)

Ezra's kombucha is alive. It has to reach Duboce Park without being shaken.

**1. Offer** (talk)

> EZRA: This kombucha is alive. Like, legally. Take it to Duboce Park without shaking it.
>
> EZRA: If it foams, it's angry. Don't make it angry.
>
> [Accept / Not now]

**2. Kombucha to Duboce Park, no bails** (deliver)

> EZRA (done): It arrived calm. You have a gift. Want a scoby? Everyone wants a scoby.

A bail: EZRA: "You shook it. It's foaming. It knows your name now."
Out of time: EZRA: "It fermented on the way. It is now vinegar. And wiser."

#### Peer Review (Dr. Gravity)

Dr. Gravity has a theory that skaters cannot fly. He would love to be wrong, for the grant.

**1. Offer** (talk)

> DR. GRAVITY: I'm a physicist. My theory is that skaters can't fly. Please prove me wrong, I need the grant.
>
> DR. GRAVITY: One big air. I'll write it up as an anomaly.
>
> [Accept / Not now]

**2. A big air for science** (trick)

> DR. GRAVITY (done): Remarkable. Gravity is still on, but you clearly had words with it.

### Lower Haight

#### Rare Records (Dez)

The wind took three records off Dez's stall. One is rare jazz. Two are his demo.

**1. Offer** (talk)

> DEZ: The wind took three records off my stall. One is rare jazz. Two are my demo.
>
> DEZ: Bring them back. Especially the jazz. Leave the demo if you want, I'd understand.
>
> [Accept / Not now]

**2. Find three records** (collect)

> DEZ (done): You brought the demo back too. Bold. Want to hear it? No? Correct answer.

#### Named After You (Benny)

Benny names every sandwich after a regular. He's out of regulars.

**1. Offer** (talk)

> BENNY: Every sandwich here is named after a regular. I'm out of regulars. Three of them are named after my landlord.
>
> BENNY: Do something worth a sandwich. Right here, where I can see it.
>
> [Accept / Not now]

**2. A 500 combo in front of the shop** (trick)

> BENNY (done): Done! The New Kid. Turkey, avocado, a little gravel. Eighteen dollars.

#### The Wiggle (Juniper)

Juniper got a flat on the Wiggle. Her zine has to reach Duboce Park.

**1. Offer** (talk)

> JUNIPER: I ride the Wiggle every day. Today the Wiggle won. Flat tire.
>
> JUNIPER: Take this envelope to Duboce Park in one minute. It's a zine about not having brakes.
>
> [Accept / Not now]

**2. The zine to Duboce Park** (deliver)

> JUNIPER (as it starts): Go. Pretend you're a bike. Bikes are faster. Sorry.
>
> JUNIPER (done): Delivered? Rad. You'd make a decent messenger. Lose the brakes.

Out of time: JUNIPER: "You're late. That's fine. The zine is also about letting go."

### Hayes Valley

#### Performance Art (Philippa)

Philippa, an art critic, needs Patricia's Green's bench ground with meaning.

**1. Offer** (talk)

> PHILIPPA: This sculpture is about the tension between steel and lunch. Your skating could be about something too.
>
> PHILIPPA: Grind that bench. Make it say capitalism.
>
> [Accept / Not now]

**2. Grind Patricia's bench, with meaning** (trick)

> PHILIPPA (done): Divine. It said capitalism. It also said ouch. Layered.

### Calle 24

#### Mural Model (Xóchitl)

Xóchitl is painting a skater flying over Calle 24 and needs a reference.

**1. Offer** (talk)

> XÓCHITL: I'm painting a skater flying over Calle 24. I need a reference. Fly.
>
> XÓCHITL: One big air. Make it heroic. Or at least make it not a bail.
>
> [Accept / Not now]

**2. A big air for the mural** (trick)

> XÓCHITL (done): Got it. I'm giving you better hair in the mural. Don't thank me.

#### Concha Express (Don Beto)

Xóchitl hasn't eaten since the mural started. Don Beto's concha is warm.

**1. Offer** (talk)

> DON BETO: Xóchitl hasn't eaten since she started that mural. Take her this concha before she paints with it.
>
> DON BETO: Thirty seconds, while it is warm. Cold conchas make me sad.
>
> [Accept / Not now]

**2. A warm concha to Xóchitl** (deliver)

> XÓCHITL (done): Concha! I was about to eat the yellow paint. Gracias.

#### Lowrider Hop-off (Tío Memo, by his three lowriders on 24th St)

Tío Memo says his three lowriders hop higher than you. Get up on all three.

**1. Offer** (talk)

> TÍO MEMO: See those three? Mine. They hop higher than you, mijo. They have hydraulics.
>
> TÍO MEMO: Get up on all three, roof to roof. Then we talk about who hops.
>
> [Accept / Not now]

**2. Up on all three lowriders** (collect)

> TÍO MEMO (between): One. Careful, she is sensitive about her paint.
>
> TÍO MEMO (between): Two. Easy on the next one. That one is my retirement.
>
> TÍO MEMO (done): All three! Okay. You hop like a '64 lowrider. That's the highest compliment on this street.

Out of time: TÍO MEMO: "Time. The cars win. They always win. They have hydraulics."

The three are the city's lowriders by Balmy; a roof counts only up on it, not from the sidewalk beside.

Reward: the Can's **Crushed Retro Can** outfit.

#### Sugar Run (Doña Chela)

Doña Chela is out of sugar. Don Beto's bakery on 24th has sugar, and opinions.

**1. Offer** (talk)

> DOÑA CHELA: Mija, I'm out of sugar. A churro without sugar is just a stick.
>
> DOÑA CHELA: Don Beto has sugar. He also has opinions. Get the sugar, skip the opinions.
>
> [Accept / Not now]

**2. Sugar from Don Beto's bakery** (deliver)

> DOÑA CHELA (done): Sugar! Here, a churro. Don't tell Beto I said he has opinions.

Out of time: DOÑA CHELA: "Too late. I sold them plain. Everyone said 'interesting'."

### Civic Center

#### Mayor Biscuits (Lorraine)

Lorraine's pug, Mayor Biscuits, ran off down Market and dropped things on the way.

**1. Offer** (talk)

> LORRAINE: Mayor Biscuits got away from me again. He dropped my keys, my shoe and a hot dog that is not ours.
>
> LORRAINE: Find all three before he circles back for the hot dog.
>
> [Accept / Not now]

**2. Find what Mayor Biscuits dropped** (collect)

> LORRAINE (done): Keys, shoe... no hot dog. He ate the hot dog. He always eats the hot dog.

Out of time: LORRAINE: "Too slow. He found the hot dog. Now he is asleep on it. Classic Mayor."

#### Local Honey (Ruth)

Gloria ordered a jar of honey from Ruth at the UN Plaza market. It has to reach City Hall in one piece.

**1. Offer** (talk)

> RUTH: Gloria at City Hall ordered a jar of honey. She ordered it in triplicate.
>
> RUTH: Take it to her. Don't drop it. If the jar breaks, the bees will know.
>
> [Accept / Not now]

**2. The honey to Gloria at City Hall, no bails** (deliver)

> GLORIA (done): Honey. Acceptable. Tell Ruth that is my highest rating.

Out of time: RUTH: "Gloria's office is closed. She says the honey can reapply tomorrow."
A bail: RUTH: "Oh dear. The bees felt that. All of them."

#### Something Very San Francisco (Mrs. Haverford)

The wedding shoot on the City Hall steps needs something very San Francisco in the background.

**1. Offer** (talk)

> MRS. HAVERFORD: My daughter wants something very San Francisco in the background of her wedding photos.
>
> MRS. HAVERFORD: You are very San Francisco. Do a trick behind them. Tasteful. Then leave.
>
> [Accept / Not now]

**2. Some air behind the wedding photo** (trick)

> MRS. HAVERFORD (done): Perfect. The bride is crying. The groom is also crying. Unclear why.

### Downtown

#### The Union Square Pigeon Mafia (Vinny)

The Pigeon's cousin Vinny runs Powell St. He hears you're good with crumbs.

**1. Offer** (talk)

> VINNY: You know my cousin, under the freeway? He says you are good with crumbs.
>
> VINNY: Three crumbs on Powell. The tourists drop 'em, we collect. That's the business.
>
> [Accept / Not now]

**2. Three crumbs on Powell** (collect)

> VINNY (done): Nice work. You're connected now. If anybody asks, you never saw a pigeon.

#### Retail Therapy (Tiffany)

Tiffany bought eleven scarves and her robotaxi quit. Emotionally.

**1. Offer** (talk)

> TIFFANY: I bought eleven scarves and my robotaxi quit on me. Emotionally.
>
> TIFFANY: Carry these to the F line stop on Market. Don't scuff the bags, the bags cost more than the scarves.
>
> [Accept / Not now]

**2. The bags to the F line stop** (deliver)

> TIFFANY (done): You're a lifesaver. Take a scarf. Take two. I don't remember buying them.

A bail: TIFFANY: "You scuffed them. The bags are ruined. The scarves are fine, who cares about scarves."

#### Speed Chess (Lev)

Lev plays speed chess on Market Street. He moves, you land a trick.

**1. Offer** (talk)

> LEV: Speed chess. I move, you land a trick. Three of my moves, three of your tricks.
>
> LEV: If I checkmate first, you buy the coffee. I always checkmate first.
>
> [Accept / Not now]

**2. Three tricks before Lev checkmates (300 points each)** (trick)

> LEV (done): You won. I don't say that. I said it once, in 1988. Now twice.

Out of time: LEV: "Checkmate. Coffee. Black, four sugars."

### Financial District

#### Standup in Forty-Five (Trent)

Trent's standup starts in forty-five seconds and his laptop is still in his hand.

**1. Offer** (talk)

> TRENT: My standup starts in forty-five seconds and my laptop is still in my hand. Like an animal.
>
> TRENT: Get it to the plaza at EMB. I'll dial in from the elevator.
>
> [Accept / Not now]

**2. The laptop to EMB in time** (deliver)

> TRENT (done): You made it. I'm putting you in the deck. Slide twelve: logistics.

Out of time: TRENT: "I missed it. They did the standup without me. They said it was the best one."

### The Embarcadero

#### Farmers' Market Rush (Farmer June)

Chefs buy every peach by nine. Farmer June needs her crate at the Ferry Building.

**1. Offer** (talk)

> FARMER JUNE: Chefs buy every peach by nine. It's eight fifty-nine. Get this crate to the Ferry Building.
>
> FARMER JUNE: Don't drop it. Chefs can smell a bruise from the parking lot.
>
> [Accept / Not now]

**2. Peaches to the Ferry Building, no bails** (deliver)

> FARMER JUNE (done): Sold in four seconds. A chef cried. Good crying.

A bail: FARMER JUNE: "Bruised. All of them. I guess it is a jam day."

#### Shore Leave (Herb)

Herb has four hours off the cruise ship and wants one real skateboard trick for the Christmas letter.

**1. Offer** (talk)

> HERB: Four hours off the boat and we've seen fog, a sea lion and a man dressed as a bush.
>
> HERB: Linda wants a real skateboard trick for the Christmas letter. Something big. Linda, get the camera!
>
> [Accept / Not now]

**2. Something big for Linda's camera (an 800 combo)** (trick)

> HERB (done): Linda! Did you get it? ... She got the bush man again.

### Fisherman's Wharf

#### Fry Thief (Steve)

Steve is a seagull. He steals fries. He dropped two, and wants them back.

**1. Offer** (talk)

> STEVE: Kid. I'm a seagull. I steal fries. It's a calling.
>
> STEVE: I dropped two escaping a toddler. Fetch 'em and I won't follow you home.
>
> [Accept / Not now]

**2. Find Steve's fries** (collect)

> STEVE (done): Fresh fries. You're alright. From now on I only steal from people in hats.

#### Statue-Off (Gus)

There's a new silver statue at Pier 39. Gus wants to know if he's the real thing.

**1. Offer** (talk)

> GUS: There's a new statue at Pier 39. Silver paint. My silver. A copycat.
>
> GUS: Go do something big next to him. If he moves, he's not a statue. He's just a guy.
>
> [Accept / Not now]

**2. A 1,000 combo by the Pier 39 statue** (trick)

> GUS (done): He moved? He moved! Thirty-seven years and I never moved. Copycat.

### North Beach

#### Espresso, Not Expresso (Nonna Gia)

Every day for forty years Nonna Gia has brought Vito his espresso. Today her knees said no.

**1. Offer** (talk)

> NONNA GIA: Every day for forty years I bring Vito his espresso. Today my knees said no.
>
> NONNA GIA: Take it to the square. Don't spill. And it's espresso. If you say expresso, I'll know.
>
> [Accept / Not now]

**2. The espresso to Vito, no spills** (deliver)

> VITO (done): Espresso! Nonna is never late. Forty years. Must be love.

A bail: NONNA GIA: "You spilled it. On a Tuesday. Vito will talk about this for years."

#### Bocce Ball (Vito)

Enzo threw the bocce ball like a teenager. It rolled down Columbus.

**1. Offer** (talk)

> VITO: We play bocce since 1961. Today Enzo threw like a teenager, and the ball went down Columbus.
>
> VITO: Bring it back. Enzo is too proud and I am too comfortable.
>
> [Accept / Not now]

**2. Find the bocce ball down Columbus** (collect)

> VITO (done): Grazie. Enzo says it does not count. Enzo says that about everything.

### Telegraph Hill

#### New Word (Pistachio)

Pistachio the parrot knows one word, and a skater taught it. Teach it a better one.

**1. Offer** (talk)

> PISTACHIO: Squawk! Pretty bird knows one word! A skater taught me! Mid! Mid!
>
> PISTACHIO: Pretty bird wants a new word! Show pretty bird flying! Squawk!
>
> [Accept / Not now]

**2. Fly for Pistachio (half a second of air)** (trick)

> PISTACHIO (done): Fly! Fly! Pretty bird says fly! Squawk!
>
> PISTACHIO (done): Mid.

#### Follow the Flag (Bernadette)

Bernadette's Coit Tower tour rented scooters and left without her. They follow the flag, not her.

**1. Offer** (talk)

> BERNADETTE: Welcome to Coit Tower. My tour group rented scooters and left without me.
>
> BERNADETTE: They follow the flag, not me. Take it to Pier 23 and they'll stop. Probably.
>
> [Accept / Not now]

**2. The tour flag to Pier 23** (deliver)

> BERNADETTE (done): They stopped! They're following you now. Congratulations, you're a tour guide. The pay is terrible.

Out of time: BERNADETTE: "They're in Sausalito. They'll be back. They always come back. For the gift shop."

### Russian Hill

#### The Brake Shoe (Mo)

The Hyde St cable car's brake shoe rolled downhill. Mo would like it back before the next run.

**1. Offer** (talk)

> MO: Hyde Street cable car. I work the brake. The brake shoe fell off and rolled downhill.
>
> MO: Find it before we try the hill without it. The tourists would love it. The insurance would not.
>
> [Accept / Not now]

**2. Find the brake shoe down Hyde** (collect)

> MO (done): Brake shoe! You saved forty tourists and one very nervous pigeon.

#### Hydrangea Patrol (Mrs. Fitch)

Tourists keep picking Mrs. Fitch's hydrangeas on Lombard for photos.

**1. Offer** (talk)

> MRS. FITCH: Tourists pick my hydrangeas for photos. Two hundred photos a day, one hydrangea left.
>
> MRS. FITCH: Grind the curb by my beds. Loudly. Make them think twice.
>
> [Accept / Not now]

**2. Grind a curb by the flower beds** (trick)

> MRS. FITCH (done): They fled. One even put a hydrangea back. Progress.

### Chinatown

#### Lion's Luck (Kenny)

Kenny's lion dance needs luck before tonight. The old way is drums.

**1. Offer** (talk)

> KENNY: Our lion dance needs luck before tonight. The old way is drums. The new way is you.
>
> KENNY: Ollie through the Dragon Gate. Big. The lion is watching. The lion is two guys.
>
> [Accept / Not now]

**2. Big air by the Dragon Gate** (trick)

> KENNY (done): Lucky! The lion nodded. That was Eddie in the back. He is a fan.

#### Har Gow Express (Auntie Mei)

The lion dancers ordered har gow and are too busy being a lion to fetch it.

**1. Offer** (talk)

> AUNTIE MEI: The lion dancers ordered har gow. They are too busy being a lion to come get it.
>
> AUNTIE MEI: Down Grant to the gate, still steaming. Steam is how you know it is love.
>
> [Accept / Not now]

**2. Har gow to the lion dancers, still steaming** (deliver)

> KENNY (done): Still steaming. Auntie Mei says hi, and also that we are too skinny.

Out of time: AUNTIE MEI: "Cold har gow. I'm telling your mother."

#### Fortune, Written Daily (Mr. Lau)

Mr. Lau has written cookie fortunes for fifty years. Today he has writer's block.

**1. Offer** (talk)

> MR. LAU: I write the fortunes for the cookie bakery. Fifty years. Today, nothing. Writer's block.
>
> MR. LAU: Do something I can write down. Something true. A kickflip, here, where I can see it.
>
> [Accept / Not now]

**2. A kickflip for Mr. Lau** (trick)

> MR. LAU (done): 'You will see a kickflip on Grant Avenue.' Ten thousand cookies, and finally, all of them true.

## Drive missions

On the sim's drive steps (docs/mechanics/missions.md): each mission places its own vehicle, gone when it ends. Kevin's truck drives the tested route round SoMa West's block (data/vehicles.json routes.garbage); Bjorn's lines come every 40 seconds on the way, wherever you drive.

### Kevin's Garbage Run (Kevin)

Kevin sprained his ankle bombing Dolores. Somebody has to drive his route.

**1. Offer** (talk)

> KEVIN: Kevin. Three Bin Hauling. I bomb Dolores on my lunch break. Today Dolores bombed me.
>
> KEVIN: Sprained ankle. Can you drive my route? Five bins round the park. The truck is very forgiving. The bins are not.
>
> [Accept / Not now]

**2. Kevin's route: five bins round the park, in the truck** (collect, in the garbage truck, stopping at each bin)

> KEVIN (as it starts): Pull up next to the bins. Beeping is optional but encouraged.
>
> KEVIN (after a bin): One down. The raccoons will be furious.
>
> KEVIN (after a bin): Ooh. That one smelled like a startup.
>
> KEVIN (after a bin): Halfway. You stop better than I do. Nine years, I still miss the green one.
>
> KEVIN (after a bin): One more. The raccoons are filing a complaint.

**3. Kevin, on the phone** (talk, on the phone)

> KEVIN: Five for five. Everything is trash if you love it enough.
>
> KEVIN: Leave the truck anywhere. Seriously. It's a garbage truck. Nobody steals a garbage truck.

Out of time: KEVIN: "The raccoons got there first. They always get there first."

### The Lost Tourist (Bjorn)

Bjorn from Stockholm is looking for the Golden Gate Bridge with a map from 1987. Drive him to Pier 39 and let him narrate.

**1. Offer** (talk)

> BJORN: Hello! Bjorn, from Stockholm. I am looking for the Golden Gate Bridge. My map says it is here.
>
> BJORN: My map is from 1987. Can you drive me? I will narrate. I am very good at narrating.
>
> [Accept / Not now]

**2. Drive Bjorn to Pier 39** (carry: he rides along)

> BJORN (as it starts): Here! Over here! I am the one with the map!
>
> BJORN (on the way): Ah! That building, I know it. The Golden Gate Bridge. Shorter than in the films.
>
> BJORN (on the way): And this must be the famous crooked street. It is so straight.
>
> BJORN (on the way): Alcatraz is very close to downtown, yes? My map says it is everywhere.
>
> BJORN (on the way): In 1987 my map says this was all water. Progress!
>
> BJORN (done): We are here! The Golden Gate Bridge. Why is it barking?

**3. Bjorn, at Pier 39** (talk)

> BJORN: Thank you! I will tell everyone in Stockholm that San Francisco is exactly as I imagined. Wrong, but exactly.

### Board Drop (Big Lou)

A shipment of decks came in at Fog City Skate Shop for the kids at SoMa West. Big Lou's knee is not driving.

**1. Offer** (talk)

> BIG LOU: Shipment came in. Twelve decks for the kids at SoMa West. My knee says I'm not driving.
>
> BIG LOU: Take the crew van. Corners slow. In 1996 I took a corner fast. That's the other knee.
>
> [Accept / Not now]

**2. Twelve decks to the park gate, in the van** (deliver, in the van)

> BIG LOU (as it starts): Easy on the brakes. They're decks, not eggs. Still.
>
> KENJI (done): New decks! I'll lose this one by Friday. Maybe Thursday.

Out of time: BIG LOU: "The kids skated the old boards. Fine. The old boards are mostly tape anyway."

### Catering, Gently (Hector)

City Hall ordered forty burritos for the permit office. Hector says the van must not hit anything.

**1. Offer** (talk)

> HECTOR: City Hall ordered forty burritos for the permit office. Forty. Gloria signed for them in advance.
>
> HECTOR: Take the van. Do not hit anything. A burrito that has been in a crash is a bowl.
>
> [Accept / Not now]

**2. Forty burritos to City Hall, without a bump** (deliver, in the van, no bumps)

> HECTOR (as it starts): Gently! Gently is the whole recipe.
>
> GLORIA (done): Forty burritos. Thirty-nine intact. I am noting the one.

Out of time: HECTOR: "The permit office ate lunch somewhere else. They have never done that. I am hurt."
A bump: HECTOR: "You hit something. I heard it from here. The salsa heard it too."

## Odd jobs

There is always something to do. Two gig boards hang in the Mission: one by the counter at Fog City Skate Shop (Big Lou) and one by the menu at Taqueria La Niebla (Hector). After chapter 1 each board has three gigs a day, the same for everyone on a San Francisco date, and new ones the next day, like Today's challenge. A gig is short and wraps something the game already has: a delivery on the board, a ride in the van, a photo at a spot, a race against one of the cast. The client says one line as it starts and one when it is done. Done gigs are ticked for the day and can be played again. Rewards are small: the Foil Burrito deck after five gigs from the taqueria, the Slime deck after five from Fog City, and four stickers (Odd Job, Gig Economy at 10, 1099 at 25, Portfolio Career for all four kinds).

### The boards

**Fog City gig board** (Big Lou; photo, race)

> BIG LOU: Gig board. Small jobs. In ninety-four I took a small job. Eleven stitches.
>
> BIG LOU (every gig done): That's every gig today. Go home. Ice something.

**La Niebla gig board** (Hector; deliver, carry)

> HECTOR: Orders on the board. Every order is a promise. Carry it with both hands.
>
> HECTOR (every gig done): No more orders today. Tomorrow, new promises.

### Deliveries (the taqueria)

An item (a super burrito, a carnitas burrito, three al pastor tacos, chips and guac, a horchata, a quesadilla suiza, two tamales, a veggie burrito without beans) from the menu to the client, 30 s plus a second for every 4.5 m in a straight line.

> TASH (the order): Bring it to Clarion Alley. I'm filming it arriving. That's the whole film.
>
> TASH (done): Got it. The phone was closed. Bring another one tomorrow.

Out of time: TASH: "The light's gone. The film is about waiting now."

> DON RAMÓN (the order): For the band. Not the trumpet. He knows what he did.
>
> DON RAMÓN (done): Gracias. Look, the trumpet is here. He smelled it.

Out of time: DON RAMÓN: "It's cold. Now it's a sad song."

> ABUELA ROSAURA (the order): It's for you. Bring it here and eat it in front of me.
>
> ABUELA ROSAURA (done): Sit. Eat. All of it. I'm counting.

Out of time: ABUELA ROSAURA: "Late. Look at you. Thinner already."

> WALTER (the order): To the J Church stop, please. I'll be here. The train won't.
>
> WALTER (done): Thank you. Still no train. Great timing, though.

Out of time: WALTER: "You took so long I nearly caught a train."

> UNIT 7 (the order): I ordered food. I cannot eat. I would like to hold it.
>
> UNIT 7 (done): It is warm. I understand everything now.

Out of time: UNIT 7: "It is cold. I understand nothing again."

> THE PIGEON (the order): Leave it on the ground. That's where I eat.
>
> THE PIGEON (done): Nice. The guac stays between us.

Out of time: THE PIGEON: "Too slow. The seagulls are asking questions."

> GIDEON (the order): Leave it on the step. Don't knock. Don't breathe.
>
> GIDEON (done): Thank you. Now back away. The porch creaks.

Out of time: GIDEON: "Too late. They're awake. Both of them."

> DR. GRAVITY (the order): Lunch, for an experiment. The experiment is lunch.
>
> DR. GRAVITY (done): Mass delivered. Science thanks you.

Out of time: DR. GRAVITY: "Slower than a falling apple. I timed it."

### Rides (the taqueria's van)

The van is outside the taqueria. The client waits at the kerb by their home; the drop-off is a spot 300 to 1600 m away (Guerrero & 18th, Mission Dolores, Dolores Hill Bomb, Castro & 18th, Church & 17th, Patricia's Green, 24th & Mission (Calle 24), Balmy Alley murals, 24th St lowriders, Park gate, Duboce Ave, Valencia St shops, Hayes St hill, Market St, Sanchez St hill).

> JUNIPER (the ask): My bike's got a flat. I need a ride. I'll be judging your braking.
>
> JUNIPER (on the way): You stopped at a stop sign. Interesting choice.
>
> JUNIPER (done): Thanks. You braked forty times. I counted.

> PHILIPPA (the ask): Drive me, please. Arriving by van is a statement.
>
> PHILIPPA (on the way): This pothole says a great deal about the city.
>
> PHILIPPA (done): Thank you. I'll write about this ride. Unfavourably.

> LUPITA (the ask): My cart broke and the sun is winning. Drive me and the paletas.
>
> LUPITA (on the way): Mango is sweating. Coconut is holding on.
>
> LUPITA (done): Made it. We lost the mango. It died doing what it loved.

> TÍO MEMO (the ask): My car's in the shop. Pick me up. Drive low and slow.
>
> TÍO MEMO (on the way): You call this low? My car is lower parked.
>
> TÍO MEMO (done): Thanks, mijo. If anyone asks, I walked.

> LORRAINE (the ask): Mayor Biscuits has a meeting. I need a ride. I am his assistant.
>
> LORRAINE (on the way): He's asleep. Take the bumps gently. He's the Mayor.
>
> LORRAINE (done): The Mayor thanks you. He's still asleep, but he thanks you.

### Photos (Fog City)

A trick (a kickflip, a manual, a big air (0.8 s), a 1,000 combo, a 600 combo) at a spot (Clarion Alley murals, 16th St BART plaza, Valencia loading dock, 15th St loading dock, Guerrero & 18th, Mission Dolores, Dolores Park ledges, Church & 17th, Mission building site, SoMa building site, 17th St loading dock, Freeway DIY, Bank to wall, Market, Bank to wall, Duboce, Park gate, Duboce Ave).

> MARISOL (the ask): One shot for the edit. Do it like you mean it. Then do it again.
>
> MARISOL (done): Got it. It's fine. It's the best fine I've had all week.

> SKYE (the ask): Candid shot, please. I'll tell you when to be candid.
>
> SKYE (done): Perfect. I'm captioning it 'spontaneous'.

> TASH (the ask): Shot for my film. The phone's open. That's half the battery.
>
> TASH (done): Got it. Eleven pixels. Every one of them is you.

> DR. GRAVITY (the ask): I need evidence. A photo of you defying me.
>
> DR. GRAVITY (done): Inconclusive. I'm framing it anyway.

### Races (Fog City)

A course: down Valencia to 19th; along 18th to Dolores Park; down Guerrero, 20th to 18th; down 16th, Dolores to Valencia.

> DRE (the dare): Race you. Loser says the other one's stance is fine.
>
> DRE (beaten): Fine. Your stance is fine. I hate this.

They win: DRE: "Your stance is still not fine."

> ROSA (the dare): Race. Try not to be mid about it.
>
> ROSA (beaten): Less mid than usual.

They win: ROSA: "Mid."

> KENJI (the dare): Race you. If I win, I get your board. I need one.
>
> KENJI (beaten): Fine. I'll find my own board. One of them's somewhere.

They win: KENJI: "I won. Can I have your board? Mine's gone again."

> DONNA (the dare): A race, darling? I've been rolling since Carter. Keep up.
>
> DONNA (beaten): You beat me. Don't tell the Castro.

They win: DONNA: "Since the Carter administration, darling. Still rolling."

> KEVIN (the dare): Race you. I usually do this street at three miles an hour. In a truck.
>
> KEVIN (beaten): You won. I'm going back to the truck. The truck respects me.

They win: KEVIN: "Lunch-break champion. Twelve years running."
