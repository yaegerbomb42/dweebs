# Five games, one habit: what each mode is missing

A design read of the modes that carry their own rules — Dumb Ways to Die, Wall Drop,
Dweebscape, Mimic & Mutate, and Dweeb Warfare — with Knockout Brawl as the yardstick.
This is not a changelog. It is an attempt to answer one question per game: *what is this
game pretending to be, and where does the code stop pretending?*

The common thread is worth stating up front, because it shows up in all five: **each mode
is excellent at the moment of the event and thin at the moment after it.** The explosion
lands, the wall drops, the door blows, the pupil botches the copy, the wave clears — and
then the game moves on before the player gets to feel anything about it. Brawl escapes this
because its loop is externally paced: stocks tick down, the crowd gasps, the announcer
yells. The custom modes each have a *better* verb than brawl and a *weaker* rhythm around it.

---

## Knockout Brawl — the yardstick

Brawl is the only mode where every system in the repo is pulling in the same direction.
The clock pressures you, the blast lines give the pressure a shape, each KO produces three
separate feedback beats (the hit, the crowd, the announcer), and the round ends on a rule
everybody already understands. `ModeDirector` interrupts on a cadence that is short enough
to feel like weather and long enough to be survived, and `Mutators` re-rolls the physics
between rounds so the same stage is not the same stage twice.

It has one hole worth noting because it is the one the other modes fall into: **nothing in
the design rewards a good loss.** Brawl tracks style, trickshots and crowd hype, but those
numbers live in the HUD and die at the results screen. There is no route by which getting
launched beautifully makes the next round different. Dumb Ways to Die is the mode that
tried to fix this, and it is the mode that shows how hard it is.

---

## Dumb Ways to Die — a scoring system looking for a game

The pitch is perfect: die spectacularly, win the Darwin podium. The problem is that the
pitch has been implemented as a *leaderboard attached to a normal brawl* rather than as a
game whose objective is dying.

You can see the seam in `Match.js`. `awardDarwin()` is a clean little ledger, and
`roundStandings()` sorts on `darwinRound` before stocks, so the ranking genuinely disagrees
with brawl — but the round still ends the brawl way, on last Dweeb standing or the timer.
Which means the winning strategy is the one the mode was built to mock: play safe, let the
other Dweebs rack up Darwin points, and be the last one alive when the round is called.
The most spectacular player in the lobby can lose to the most boring one, and the sorting
rule that was supposed to prevent that only decides the *order* of losers, not the winner.

The second seam is sharper. Points are computed inside the KO handler in `main.js`, keyed
off `kind`, height, credited-or-not and vertical speed — a taxonomy of *how you left the
stage*. It never asks what you were doing on the way out. A Dweeb who self-destructs off a
trampoline into the crowd scores the same as one who walks off the edge, because the only
thing the scorer can see is the fall. But the mode's own name promises the *way*, and every
piece of information needed to judge it already exists in the combat system: what hit you,
what was in your hands, how many times you bounced, whether you were on fire, whether you
were already at 300% and survived the first hit.

What it wants, then, is to stop being a brawl with a scoreboard and become a **run**: one
life, no timer, and a round that ends when the stage is empty. Points become the *only*
way to win, so the timid strategy stops existing rather than being out-sorted. And the
score should be assembled from the whole arc of the death — a cause, a chain, a flourish —
with the HUD showing the receipt while the body is still in the air, so the player learns
the taxonomy by playing instead of by reading the standings.

The thing to fix first is the one that costs the most fun per line of code: the moment of
death is currently a *popup*. A big number appears and vanishes. It should be a beat — the
cause named, the chain counted up, and the total slammed onto the board with the crowd
reacting to the size of it, scaled by how absurd the death was.

---

## Wall Drop PVP — a great opening and then the wall is gone

Wall Drop has the best first eight seconds in the entire project. Two teams, a monolithic
slab down the centre, a countdown, and then fourteen metres of concrete slams into the
floor and the match begins. It also has the most anticlimactic minute and fifty afterwards,
because the wall is a one-shot prop: `dropTheWall()` is called on GO and never mentioned
again.

The design says "1 life, slow arcing bullets, centre dividing wall drops." Three clauses,
and only the third has a real implementation. The wall drops *and stays down*, so the
central verb of the mode — the wall — participates exactly once. Meanwhile the "slow
arcing bullets" are approximated by spawning a melon cannon and a spiky ball on each side,
and the teams themselves exist only as a colour tag: `d.team` is set from the spawn index
so friendly fire is off and a teammate dive becomes a free cross-stage launch, which is a
lovely piece of accidental tech that nothing teaches you.

The structural problem is that the mode has no *shape*. A one-life match with no re-entry
on a symmetric map converges, very quickly, to both teams throwing things at each other
from behind cover until one side runs out of bodies. There is no reason to advance, no
reason to retreat, and no reason to care where the wall's remains are — even though those
remains are, physically, the most interesting terrain on the map.

The fix that pays for itself is to make the wall an *actor* instead of an event. It should
come down in stages, leave rubble that changes the map's cover, and go back up — forcing a
rotation rather than a single opening rush. A one-life mode needs pressure that arrives in
waves anyway; the wall is the only pressure source the mode has and it is being spent on
frame one.

The clear-to-fix second problem is information. A mode with two teams and a one-life rule
needs the player to know, at a glance, who is left on each side and how close the wall is
to moving again. Right now the team state is invisible and the wall state is invisible, so
the mode's whole premise has to be remembered rather than read.

---

## Dweebscape Island — the best toy in the repo, kept in a box

`EscapeSandbox.js` is the most ambitious file in the project and, I think, the best. Five
genuinely distinct physics solutions to one door — blow the hinges, load the counterweight,
carry the cell to the socket, stack crates to the vent, ride the mine cart — plus a patrol
drone with hearing and a cone of sight, a lockdown clock and three escalating hazards.
Nothing else here is that mechanically rich.

And the mode wraps it in a decision that cancels most of it out: on spawn, `bots = []`.
The vault is co-op with no partners, in a game whose entire selling point is Dweebs doing
physical comedy to each other. The best-designed room in Dweebs is played alone, by a
player whose only company is a drone.

That single line explains the mode's other weakness. The five exits are *alternatives*, not
*interactions*: you pick one and solve it, and the other four sit there as scenery. Because
nothing else is in the room, nothing can interfere with your chosen route, and because
nothing can interfere, there is no reason to switch. The counterweight is the clearest
case — it accepts props and Dweebs by mass, which is a co-op mechanic written for a lobby
that is always empty. The mine cart has a brake chock that only you would ever remove.

What the mode needs is a second body: someone to stand in the basket, someone to weigh
down the other end while you climb, someone to get zapped by the drone so you can run past
it. Failing that, it needs the props to fight back more, so that a route can collapse
mid-solve and force a scramble to a different door. Either way the goal is the same — make
the five exits into a *conversation* instead of a menu.

There is a smaller but real problem in how the run is scored. `_gradeFor()` blends time
remaining with a flat per-method bonus, which means the fastest route (demolition, if you
have barrels) and the cleverest route (vent) can be worth nearly the same, and a player who
fumbles the pulley for ninety seconds is graded on the clock alone. Grade it on the *mess*:
how many hazards fired while you worked, how often the drone caught you, whether you were
forced to change route. That is a score that rewards the interesting failure instead of
punishing it.

---

## Mimic & Mutate Lab — the only game here that grades the player

Mimic is doing something no other mode attempts: you perform, a crowd of pupils records
your actual inputs to a tape, and then they play your movement back at you — mutated. The
`_grade()` function compares the pupil's path to yours and calls it, and the whole thing is
built on a genuinely novel data structure for this codebase. When it fires, it is the
funniest thing in the game: your own panic-jump, re-enacted badly, on purpose, by six
Dweebs at once.

It is also the mode with the least *game* in it. There is no failure state, no objective,
and no accumulation — the chain counter resets after seven seconds, the mutation cooldown
clamps how much comedy you can generate to one event every 2.5 seconds, and the only thing
that persists about a run is a leaderboard of nothing. The player's job is to keep doing
physical things, and the game rewards that with a popup, forever, until they get bored.

The deeper structural issue is that **the pupil's performance is graded and the player's
is not.** `_grade()` tells the pupil "NAILED IT" or "WHAT WAS THAT", which is a joke at the
pupil's expense — but the player's *demonstration* is never judged. Did you give them
anything good to copy? A player who spends the run doing single jumps and one grab teaches
the crowd nothing, and the game has no way to say so. The interesting axis is *teaching*:
how outrageous, how varied, how well-chained were the demonstrations, and can you build a
crowd that ends the round doing something you could never have done yourself.

Which suggests the mode's real ceiling: a **repertoire**. The crowd's mutation history
should accrue — a pupil who learned "MEGA THROW" from you two minutes ago should still
have it, and by the end there should be a visible record of what this lab has been taught.
Right now the tape is four seconds deep and the lab forgets everything else on the next
frame, which wastes the single best idea in the file.

---

## Dweeb Warfare — a good game under a bad interface

Warfare is the most complete of the five: a deterministic sim, a wave curve with a real
difficulty ramp, counter-relationships between units, a commander AI with personalities, a
six-mission campaign with persistent veterans, and lockstep online. It is also the mode
where the player's attention is pointed slightly away from the game at all times.

The pattern is the same one from the other four, in its purest form: the *event* is
excellent, the *aftermath* is a banner. Look at what happens between waves. The sim has a
14-second prep window (`PREP_BETWEEN`), which is exactly the right shape for a strategy
game — the part where you spend coins, reposition the rally flag and decide what the next
wave's threat actually is. And to its credit the prep card already does the hard half of the
job: it names the countdown, the wave number, and `wavePreview()` spells out the next wave's
composition in emoji. That is better than most games manage.

What the card will not tell you is anything about *your own side*. After a wave you get
`hud.banner('WAVE CLEARED', '+🪙 120 · your army patches up', 'good')`, and then you are
looking at a battlefield to work out, by eye, what survived. How many shields did I lose?
Did the rocket I recruited two waves ago make it? Is that a veteran in the crowd or a fresh
recruit? The information exists — `st.stats.blue.lost`, the living units and their
`veteran` flag are all right there — and the one moment it would be most useful is the one
moment it is not shown. The asymmetry is telling: the mode tells you about the enemy's next
move and asks you to squint at your own army.

The second issue is tempo. Wave income is flat (`waveReward = 80 + 20n`) and the recruit
costs are fixed, so the correct opening is the same every time — there is no wave where the
budget forces a different answer. A wave curve that changes shape, not just difficulty,
would make the prep window feel like a decision instead of a formality. And the campaign,
which is the mode's best idea, hides its veterans: survivors get +15% max HP, and the only
feedback they generate is a toast the first time the mechanic fires. The one thing that
makes the campaign a *war* rather than six skirmishes has no UI at all.

What Warfare mostly needs is not new mechanics but a moment of quiet, spent on the half of
the board that is currently invisible: fourteen seconds, once a wave, to see what the last
wave cost you and what is left standing.

---

## What this suggests as one change

Four of these five games are missing the same beat, so the highest-leverage change is not
per-game at all: **give each mode one moment after its signature event where the game says
what just happened.** For the derby that is the death receipt; for wall drop it is the
state of the war; for the vault it is the mess you made; for the lab it is the repertoire;
for warfare it is the quiet before the next wave. Brawl already has them (crowd, announcer,
photo finish), which is precisely why it feels finished.

The implementations selected from this pass are the two that are both cheap and load-bearing
in their mode: the **derby death receipt** (which turns the score from a hidden sort key
into the thing you are actually playing for) and the **warfare after-action line** (which
says what the wave cost you, in the window where you are deciding what to buy next). Both
were built after this review; see the commit that follows.
