# Trick list: our defaults against the classic arcade skate games

Audit of 2026-11-16, after a playtest report: the Inward Heelflip (up-right + flip, W + D and J) came out as a 360 Flip. The reference is the classic games' 2020 remake, the game this one takes its feel from (architecture.md section 10). Keys: W up, S down, A left, D right; J flip, L grab, I grind; a diagonal is two arrows held together. Directions are screen and stick directions, as in the classic games (up is up on the stick, whatever the stance).

## The answer to the report

- **Up-right + flip is the Inward Heelflip in the classic games and in the remake.** It is the Hardflip (street pros) or a Fingerflip (vert pros) in the first game, which has no inward heelflip. We had the 360 Flip there; it now gives the Inward Heelflip, where the remake players expect it.
- **The 360 Flip** in the remake is the double tap on the Varial Kickflip's slot: down-left, J, J. In the classic games it was Down, Down + flip for most pros. In real skating a 360 flip (tre flip) is a kickflip with a backside 360 shove-it: the board turns once along its length and a full turn flat, the tail going behind the rider.

## Sources

- ACT, DBL, GB, GP, SHK, SHKPC, GT: published control references, move lists and guides for the classic arcade skate games (the 2000 original and the 2020 remake), cross-checked against each other.
- Real skating: Wikipedia Flip trick https://en.wikipedia.org/wiki/Flip_trick, Kickflip https://en.wikipedia.org/wiki/Kickflip, Shove-it https://en.wikipedia.org/wiki/Shove-it, Slide https://en.wikipedia.org/wiki/Slide_(skateboarding); Empire, frontside boardslide https://thinkempire.com/blogs/news/empire-trick-tips-the-frontside-boardslide; Braille, frontside pop shove-it https://www.brailleskateboarding.com/blogs/news/how-to-frontside-pop-shove-it.

## How the three games differ (flip button)

| Slot | Original 1 (1999) | Original 2 (2000), most pros | Remake (2020) |
|---|---|---|---|
| ← | Kickflip | Kickflip | Kickflip (J J Double, J J J Triple) |
| → | Heelflip | Heelflip | Heelflip (Double, Triple) |
| ↑ | 360 Shove-It or Pop Shove-It | Pop Shove-It | Impossible (Double, Triple) |
| ↓ | Impossible | FS Shove-It | Pop Shove-It (360, 540 Shove-It) |
| ↖ | Kickflip to Indy | Hardflip | Hardflip (360 Hardflip) |
| ↗ | Hardflip (street) / Fingerflip (vert) | Inward Heelflip | Inward Heelflip (360 Inward Heelflip) |
| ↙ | Sex Change (street) / Varial (vert) | Varial Kickflip | Varial Kickflip (360 Flip) |
| ↘ | 360 Flip (street) / Front Foot Impossible (vert) | Varial Heelflip | Varial Heelflip (Laser Flip) |
| → → | none | FS Shove-It slot family (per pro) | FS Shove-It (360 FS Shove-It) |
| ↑ ↑, ↓ ↓, ← ← | none | per pro (360 Flip on ↓ ↓ for most) | Sal Flip, Ollie North, Ollie Airwalk |

The first game's sets differ per pro (street or vert). The second game's sets differ per pro too. The remake's defaults are the created skater's and can be rebound. Only the Double Kickflip's J J is stated outright by the publisher; the other second and third names are the guides' pairs, read as double and triple taps.

## Real-skating check (regular stance; goofy is the mirror image)

| Trick | Board | Our tricks.json turns |
|---|---|---|
| Kickflip | flips once along its length, toe edge up first (front foot flicks off the heel-side corner of the nose) | roll +1 |
| Heelflip | the other way, heel edge up first | roll -1 |
| Pop Shove-It (BS) | half turn flat, the tail behind the rider (heel side) | yaw +0.5 |
| FS Shove-It | half turn flat, the tail in front (toe side) | yaw -0.5 |
| 360 Shove-It | full BS turn flat | yaw +1 |
| Impossible | end over end round the back foot | pitch +1, pivot at the back foot |
| Varial Kickflip | kickflip + BS shove-it | roll +1, yaw +0.5 |
| Varial Heelflip | heelflip + FS shove-it | roll -1, yaw -0.5 |
| Hardflip | kickflip + FS shove-it, up between the legs | roll +1, yaw -0.5, stood up (flipTilt -72) |
| Inward Heelflip | heelflip + BS shove-it | roll -1, yaw +0.5 (flipTilt -45) |
| 360 Flip | kickflip + BS 360 shove-it | roll +1, yaw +1 |
| Laser Flip | heelflip + FS 360 shove-it | roll -1, yaw -1 |
| 360 Hardflip | kickflip + FS 360 shove-it | roll +1, yaw -1 |
| 360 Inward Heelflip | heelflip + BS 360 shove-it | roll -1, yaw +1 |
| Double / Triple Kickflip | two, three kickflip turns | roll +2, +3 |
| Double / Triple Heelflip | two, three heelflip turns | roll -2, -3 |
| 540 Shove-It | one and a half BS turns flat | yaw +1.5 |
| Double / Triple Impossible | two, three wraps round the back foot | pitch +2, +3 |
| Bigspin | BS 360 shove-it + BS 180 body turn | the 360 Shove-It's named trick |

Nollie pops the nose with the front foot (the view mirrors the pop and flick along the board; a nollie BS shove-it swings the nose behind the rider); fakie is the rider's stance rolling backward; switch the other stance. The turns are the data's; the review sheet out/strips/soma-skate-tricks-audit.png shows every flip from the front quarter, flick to catch (scenarios/flips.strips has no rows yet for the seven new flips).

Grind and slide names follow the approach (Wikipedia, Empire): frontside when the chest faced the rail on the way in; a frontside boardslide slides blind (back to the travel), a backside one facing forward; a backside noseslide and a frontside lipslide or tailslide face forward. grinds.md has the same rules; they were right.

## The table

Input → ours (after this audit) → the remake → correct → what changed. "Was" gives the old trick where it changed. In the remake column only the single taps and the Double Kickflip's J J are stated by the publisher; the other double and triple taps are the guides' trick pairs (DBL, GB) read as taps, so those rows are inferred.

### Flips (J)

| Input | Ours | Reference | Correct | Fix |
|---|---|---|---|---|
| ← J | Kickflip | Kickflip | yes | |
| → J | Heelflip | Heelflip | yes | |
| ↑ J | Impossible | Impossible | yes | |
| ↓ J | Pop Shove-It | Pop Shove-It | yes | |
| ↖ J | Hardflip | Hardflip | yes | |
| ↗ J | Inward Heelflip | Inward Heelflip | yes now | was 360 Flip; scenario lab-inwardheelflip-lands |
| ↙ J | Varial Kickflip | Varial Kickflip | yes | |
| ↘ J | Varial Heelflip | Varial Heelflip | yes | |
| ← J J | Double Kickflip | Double Kickflip | yes | |
| → J J | Double Heelflip | Double Heelflip | yes | |
| ↑ J J | Double Impossible | Double Impossible | yes now | was FS Shove-It; new flip, lab-doubleimpossible-lands |
| ↓ J J | 360 Shove-It | 360 Shove-It | yes | |
| ↖ J J | 360 Hardflip | 360 Hardflip | yes now | was FS 360 Shove-It; new flip, lab-360hardflip-lands |
| ↗ J J | 360 Inward Heelflip | 360 Inward Heelflip | yes now | had none; new flip, lab-360inwardheelflip-lands |
| ↙ J J | 360 Flip | 360 Flip | yes now | was Inward Heelflip; lab-360flip-lands |
| ↘ J J | Laser Flip | Laser Flip | yes | |
| ← J J J | Triple Kickflip | Triple Kickflip | yes now | new (triple tap), lab-triplekickflip-lands |
| → J J J | Triple Heelflip | Triple Heelflip | yes now | new, lab-tripleheelflip-lands |
| ↑ J J J | Triple Impossible | Triple Impossible | yes now | new, lab-tripleimpossible-lands |
| ↓ J J J | 540 Shove-It | 540 Shove-It | yes now | new, lab-540shoveit-lands |
| → → J | FS Shove-It | FS Shove-It | yes now | was ↑ J J; lab-fsshoveit-lands |
| → → J J | FS 360 Shove-It | 360 FS Shove-It | yes now | was ↖ J J; lab-fs360shoveit-lands |
| ↑ ↑ J | Impossible | Sal Flip | no | not built: needs a body animation (left) |
| ↓ ↓ J | Pop Shove-It | Ollie North | no | not built: a foot-off pose (left) |
| ← ← J | Kickflip | Ollie Airwalk | no | not built: an airwalk pose (left) |
| J, no arrow | Kickflip | (no default) | ours | kept |

Input timing: a diagonal's second key up to tricks.dirTicks (5 ticks, 42 ms) after J still counts (lab-diagonal-late-key; 8 ticks later is a spin, lab-diagonal-too-late). Perpendicular keys that went down that close together and are both held are a diagonal, never a special's two-direction sequence (lab-special-chord-diagonal). Points are ours (the classic games' values are not in the sources).

### Grabs (L)

| Input | Ours | Reference | Correct | Fix |
|---|---|---|---|---|
| ← L | Melon | Melon | yes | |
| → L | Indy | Indy | yes | |
| ↑ L | Nosegrab | Nosegrab | yes | |
| ↓ L | Tailgrab | Tailgrab | yes | |
| ↖ L | Japan | Japan | yes | |
| ↗ L | Method | Madonna | no | left: needs a Madonna pose (front foot kicked off); Method is the remake's ← L L |
| ↙ L | Benihana | Benihana | yes | |
| ↘ L | Stalefish | Airwalk | no | left: needs an Airwalk pose |
| → L L | Mute | Stiffy | no | left: needs a Stiffy pose |
| ← L L, ↑ L L, ↓ L L, ↖ L L, ↗ L L, ↙ L L, ↘ L L | none | Method, Rocket Air, One Foot Tailgrab, One Foot Japan, Judo, Sack Tap, Christ Air | no | left: needs poses (poses.json) |

### Grinds and slides (I, as you lock on)

Ours reads left and right relative to the rail (toward the far side, away to the approach side), which is how the classic games' left and right pairs behave too ("these vary depending on which way you are facing the grind", Bullet_Reload's move list).

| Input | Ours | Reference | Correct | Fix |
|---|---|---|---|---|
| I | 50-50 (parallel), Boardslide or Lipslide (across) | 50-50, Boardslide or Lipslide by approach | yes | |
| ↑ I | Nosegrind (parallel), Noseslide (across) | Nosegrind | yes | |
| ↓ I | 5-0 (parallel), Tailslide (across) | 5-0 | yes | |
| toward / away I | Feeble / Smith (parallel) | Noseslide / Tailslide | no | left: would turn a parallel approach into a slide; a sim change, open |
| ↑ + toward / away I | Crooked / Overcrook | Crook / Overcrook (↗ / ↖) | yes, rail-relative | |
| ↓ + toward / away I | Feeble / Smith | Feeble / Smith (↙ / ↘) | yes, rail-relative | |
| ↓ + side I (across) | Bluntslide | ↓ ↓ I | differs | left |
| ↑ + side I (across) | Nosebluntslide | ↑ ↑ I (the classic games) | differs | left |
| I I (double tap) | Salad, Suski, Willy, Losi | none found | ours | kept (extra) |

### Lip tricks (I at the coping)

The remake's defaults are all inverts and plants (↑ FS Noseblunt, ↗ Switcheroo, → BS Boneless, ↘ One Foot Invert, ↓ Reacharound Invert, ↙ Gymnast Plant, ← Tuck-knee Invert, ↖ Andrect Invert); the second game's differ per pro. Ours (none Rock to Fakie, ↑ Axle Stall, ↓ Disaster, ← Nose Stall, → Blunt to Fakie, ↖ Invert, ↗ Handplant, ↙ Rock and Roll, ↘ Tail Stall) match neither slot for slot. Left: a lip set like the remake's needs eight new invert poses.

### Manuals, specials

| Input | Ours | Reference | Correct |
|---|---|---|---|
| ↑ ↓ | Manual | Manual | yes |
| ↓ ↑ | Nose Manual | Nose Manual | yes |
| → ↓ J (meter full) | Kickflip Superman | specials are per pro, two directions + a button | format yes |
| ← → L | Christ Air | | format yes |
| ↑ ↓ J | 540 Flip | | format yes |

## Other trick bugs found and fixed (2026-11-16)

- **Grinds and slides on a down rail went up it.** The catch took the ollie's climb as travel along the line (rising onto a down rail is uphill along it), and a slide's 2.5 m/s floor carried that sign: a boardslide across a handrail caught on the way up slid up, stalled and fell off backwards (1,058 of 10,800 side catches on city rails). Fixed in grind.ts (grinds.md); scenario sf-bart-rail-slide-downhill, tests/grinddownhill.test.ts over every sloped line.
- **The slow-motion grind camera filmed handrails from below.** The push-in sat ahead and below on a down rail, looking up the stairs: in slow motion the grind read as going up. A grind down a slope now gets a tracking shot from the approach side (director.ts, moments.json shots.track); tests/director.test.ts.
- **The director's grind side ignored the travel's way along the line** (g.far is relative to the line's point order): the tracking shot now uses the approach side for either direction.
- **Keyboard diagonals:** see Flips above (dirTicks, specials).

## Left

- Not audited this round: each trick's score against the classic games, the switch, nollie and fakie names trick by trick, and a scripted pass over grind switching, reverts, lips, specials and combo counts (beyond what is above).
- A side catch on a handrail's level stub at the top (the BART rails have 0.3 m of it) still takes the old near-standstill rule there (the board's heading decides); tests/grinddownhill.test.ts seeds its catches on the sloped part. The director already looks 3 m ahead; the sim could too.
- The tracking shot is pulled in close when the approach side is behind a stairwell wall (the BART 50-50 from the plaza, half way down); it could pick its side with the camera's blockedFrom, as the swing does.
- Grabs, lip tricks and the remake slots that need new poses (Madonna, Airwalk, Stiffy, the grab double taps, Sal Flip, Ollie North, Ollie Airwalk, eight lip inverts).
- Pure left or right + I as Noseslide / Tailslide on a parallel approach, and Bluntslide / Nosebluntslide on ↓ ↓ / ↑ ↑: a sim change, open.
- A handrail gap (BART HANDRAIL) pays on a grind that stalls part way; level-ledge gaps rely on that (sf-gap-lombard-bed, sf-gap-marini-ledge), so it stays until gaps get a length rule.
