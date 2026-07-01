# Chicago Show Calendar — Venue Master List

**Source:** venue filter dropdown on `calendar.chicagoshowcalendar.com` (captured Jun 15 2026)
**Status:** working reference for data aggregation. Raw is preserved at the bottom; the canonical list above is a *proposed* cleanup — confirm the flagged clusters before treating it as final.

## Snapshot

- ~230 raw entries pulled from the dropdown.
- 7 of those are **not venues** — they're sort options (removed; listed below).
- After merging obvious duplicates/spelling variants: **≈190 distinct entries**, including ~10 sub-rooms tagged to a parent venue.
- The reduction depends on confirming the **variant clusters** in section 2 — those are likely-but-not-certain merges.

**Removed (sort controls, not venues):** Show Start (now → future), Show Start (future → now), Artist (a → z), Artist (z → a), Venue (a → z), Venue (z → a), and the "(all venues)" placeholder.

---

## 1. Canonical venues (proposed)

Sub-rooms are kept as their own entries and tagged with their parent, since which room a show is in matters for a calendar.

**#**
- 309 N Morgan St
- 4200 W Diversey
- 952 W Fulton St

**A**
- After Chicago
- Alhambra Palace
- aliveOne
- Andy's Jazz Club
- Aon Grand Ballroom
- Aragon Ballroom
- Arbella
- Athenaeum Center
- The Atlantic  *(see cluster 2a)*
- Auditorium Theatre
- Avondale Music Hall

**B**
- Bassline
- The Bassment
- Beat Kitchen
- Beat Kitchen Upstairs — *room of Beat Kitchen*
- Beauty Bar
- Bernice's Tavern
- Berwyn Stage
- Blind Barber
- The BlkRoom
- Blue Chicago
- Bond Chapel
- Bookclub
- Bottom Lounge
- Bourbon on Division
- Bricktown  *(see cluster 2d)*
- Broken Hearts
- Broken Shaker
- Brudder's Sports Bar  *(see cluster 2c)*
- Buddy Guy's Legends
- Burlington Bar

**C**
- Cafe Modulaire
- Cafe Mustache
- California Clipper
- Cara Cara Club
- Carol's Pub
- Cary's Lounge
- Casa Cafe
- Cermak Hall
- The Charleston  *(see cluster 2e)*
- The Checkout
- Chicago Theatre
- Chop Shop
- City Hall
- City Winery
- Clara
- Cobb Hall
- Cobra Lounge
- Cole's Bar
- Color Club
- Concord Music Hall
- Constellation
- Copernicus Center
- Credit Union 1 Arena
- Cubby Bear

**D**
- Dorian's
- Dorothy
- Drip Collective

**E**
- Easy Does It
- Elastic Arts
- Empty Bottle
- Epiphany Center for the Arts
- Experimental Sound Studio
- Expat
- EZ Inn

**F**
- Festival Hall
- Fulton Street Collective

**G**
- Gallery Cabaret
- Garcia's
- George Street Pub
- Giant Penny Whistle Tavern
- Gman Tavern
- Goldstar Bar
- Golden Dagger
- Grapes & Grains
- Green Mill
- Grill on 21

**H**
- The Hideout
- Home Away From Home
- Hoste
- House of Blues
- House of Blues Backporch Stage — *room of House of Blues*
- Hungry Brain
- Huntington Bank Pavilion
- HVAC Pub

**I**
- Icon Bar and Lounge
- Illuminated Brewery

**J**
- J Parker Rooftop
- Jarvis Square Tavern
- Jazz Showcase
- Joe's on Weed
- Judson & Moore

**K**
- Kimbark Fourth State
- Kingston Mines

**L**
- La Victoria Barra + Cocina
- Lazy Bird
- Le Piano
- Lee's Unleaded Blues  *(see cluster 2b)*
- Lemon
- Liar's Club
- Lincoln Hall
- LiveWire Lounge
- Local Option
- Local Soul
- Logan Center
- Los Globos

**M**
- Martyrs'
- Masada Nightclub
- Metro
- The Mine  *(see cluster 2f)*
- Monday Blues Lounge
- Montrose Saloon

**N**
- The Native
- Navy Pier
- Navy Pier Beer Garden — *room of Navy Pier*
- Necessary & Sufficient Coffee
- Never Have I Ever
- Nine Bar

**O**
- O's Tap
- Old Town School of Folk Music
- Outset
- Outset Patio — *room of Outset*
- The Owl

**P**
- Parallel Play
- Park West
- Phyllis' Musical Inn
- Pilsen Yards
- Podlasie Club
- Polk Bros Park
- Primary
- PRYSM
- Punch House

**R**
- Radius
- Ramova Loft
- Ramova Theatre
- Recess
- Reed's Local
- Reggies Music Joint — *room at Reggies*
- Reggies Rock Club — *room at Reggies*
- The Renaissance Society
- Richard J. Daley-Bridgeport Library
- Riviera Theatre
- Rosa's Lounge

**S**
- Salt Shed
- Schubas
- Schubas Upstairs — *room of Schubas*
- Simon's Tavern
- Skylark
- Sleeping Village
- Smartbar
- Smoke & Mirrors
- Soldier Field
- Sound-Bar
- Sportsman's Club
- Spybar
- Stardust Lounge
- The Store
- Studebaker Theater
- Subterranean
- Subterranean Downstairs — *room of Subterranean*
- Sweethearts Bar
- Swig
- Symphony Center

**T**
- Tack Room
- TAO
- The Land School
- The Levee
- The Sovereign
- The Tonk
- The Vic
- The Whistler
- Thalia Hall
- Three Top Lounge
- Trace

**U**
- Uncommon Ground
- Underground Lounge
- Union League Club of Chicago
- United Center
- United Church Of Rogers Park

**W**
- Wave Wall Stage
- Wax  *(see cluster 2g)*
- Weeds Tavern
- West Town Bikes
- Wild Hare
- Winter's Jazz Club
- Wintrust Arena
- Wrigley Field

---

## 2. Variant clusters to confirm

These are merges I made on judgment, not certainty. Confirm or split before locking the master list.

- **2a — The Atlantic** ← `Atlantic`, `The Atlantic`, `The Atlantic Bar`, `Atlantic Bar`, `Atlantic Bar and Grill` *(5 spellings — almost certainly one venue)*
- **2b — Lee's Unleaded Blues** ← `Lee's Unleaded Blues`, `Lee's Unleaded Blues Lounge`, `Lee's Unleaded Blues Club`, `Lee's Unleaded Blues Bar`
- **2c — Brudder's Sports Bar** ← `Brudder's Sports Bar`, `Brudder's Bar`, `Brudders' Bar`, `Brudders'` *(apostrophe drifts)*
- **2d — Bricktown** ← `Bricktown`, `Bricktown Records` *(same record-store venue? confirm)*
- **2e — The Charleston** ← `The Charleston`, `Charleston Bar`
- **2f — The Mine** ← `The Mine`, `The Mine Chicago`
- **2g — Wax** ← `Wax`, `Wax Vinyl Bar` *(could be two different spots — verify)*

**Trivial merges already applied** (case / spacing / punctuation / typos — safe): Auditorium Theatre=Theater · Bourbon on/On Division · Joe's on/On Weed · LiveWire/Live Wire Lounge · Smartbar/Smart Bar · Sound-Bar/Sound-bar · Spybar/Spy Bar · Tack Room/Tackroom · The Checkout/CheckOut · The BlkRoom/BlkRoom · The Bassment/Bassment · Nine Bar/Nine Bar 九吧 · The Hideout/Hideout · The Renaissance Society/Renaissance Society · Old Town School of Folk Music/of Folk · Epiphany Center for/of the Arts · Podlasie/Podlaise Club · 309 N Morgan St/St. · Reed's Local (dupe) · Cole's Bar (dupe) · Liar's Club (dupe) · After Chicago/After.

**Open question — "Metro & Smartbar":** appeared as a combined entry. Metro and Smartbar share a building but are separate rooms; treat `Metro & Smartbar` as a co-listing that maps to both, not a third venue.

**Possible distinct-room pair to check:** `Bassline` vs `The Bassment` — kept separate (different names), but worth a glance.

---

## 3. Rooms within larger venues

Parent → rooms (for when the schema needs a venue↔room relationship):

- **Beat Kitchen** → Beat Kitchen Upstairs
- **House of Blues** → Backporch Stage
- **Navy Pier** → Beer Garden  *(also: Polk Bros Park, Aon Grand Ballroom, Wave Wall Stage may be Navy Pier areas — confirm)*
- **Outset** → Outset Patio
- **Reggies** → Music Joint, Rock Club
- **Schubas** → Schubas Upstairs
- **Subterranean** → Subterranean Downstairs
- **Metro** ↔ **Smartbar** (same building, co-listed)

---

## 4. Raw source (verbatim, venues only)

Preserved exactly as captured, sort options removed, for fidelity.

```
aliveOne
Andy's Jazz Club
Aragon Ballroom
Arbella
Auditorium Theatre
Beat Kitchen
Beauty Bar
Blind Barber
Blue Chicago
Bookclub
Bottom Lounge
Bourbon on Division
Bricktown
Broken Hearts
Brudder's Sports Bar
Burlington Bar
Cafe Mustache
California Clipper
Cara Cara Club
Carol's Pub
Cary's Lounge
Cermak Hall
Charleston Bar
Chicago Theatre
Chop Shop
City Winery
Clara
Cobra Lounge
Cole's Bar
Color Club
Concord Music Hall
Constellation
Copernicus Center
Cubby Bear
Dorian's
Dorothy
Easy Does It
Elastic Arts
Empty Bottle
Epiphany Center for the Arts
Garcia's
Giant Penny Whistle Tavern
Gman Tavern
Golden Dagger
Green Mill
Hideout
Home Away From Home
House of Blues
Hungry Brain
Jazz Showcase
Joe's on Weed
Judson & Moore
Kingston Mines
Le Piano
Lee's Unleaded Blues
Lemon
Liar's Club
Lincoln Hall
LiveWire Lounge
Los Globos
Martyrs'
Masada Nightclub
Metro
Montrose Saloon
Navy Pier
Never Have I Ever
Old Town School of Folk Music
Outset
Park West
Phyllis' Musical Inn
Pilsen Yards
Podlasie Club
Primary
PRYSM
Punch House
Radius
Ramova Theatre
Reed's Local
Reggies Music Joint
Reggies Rock Club
Riviera Theatre
Rosa's Lounge
Salt Shed
Schubas
Schubas Upstairs
Sleeping Village
Smartbar
Smoke & Mirrors
Sound-Bar
Spybar
Subterranean
Subterranean Downstairs
Tack Room
TAO
Thalia Hall
The Atlantic
The BlkRoom
The CheckOut
The Owl
The Tonk
The Vic
The Whistler
Three Top Lounge
Trace
Uncommon Ground
Underground Lounge
United Center
Wax
Wild Hare
Winter's Jazz Club
Buddy Guy's Legends
Old Town School of Folk
Lee's Unleaded Blues Lounge
The Hideout
Cole's Bar
Grapes & Grains
Lazy Bird
Podlaise Club
309 N Morgan St
Athenaeum Center
Bassline
Ramova Loft
Swig
The Mine
Reed's Local
Brudders' Bar
Giant Penny Whistle
Joe's On Weed
O's Tap
Sportsman's Club
Avondale Music Hall
The Land School
Liar's Club
Drip Collective
Simon's Tavern
Jarvis Square Tavern
The Sovereign
Local Soul
Alhambra Palace
Bond Chapel
Hoste
Lee's Unleaded Blues Club
HVAC Pub
La Victoria Barra + Cocina
Wax Vinyl Bar
Cafe Modulaire
House of Blues Backporch Stage
Kimbark Fourth State
Live Wire Lounge
Beat Kitchen Upstairs
The Charleston
Festival Hall
The Levee
United Church Of Rogers Park
After Chicago
Epiphany Center of the Arts
Wintrust Arena
309 N Morgan St.
Bourbon On Division
Schubas (Upstairs)
Symphony Center
Credit Union 1 Arena
West Town Bikes
Broken Shaker
The Mine Chicago
Auditorium Theater
Grill on 21
Union League Club of Chicago
952 W Fulton St
The Atlantic Bar
Icon Bar and Lounge
Spy Bar
The Bassment
EZ Inn
Nine Bar | 九吧
George Street Pub
The Native
Atlantic Bar
Sweethearts Bar
Aon Grand Ballroom
Bricktown Records
Logan Center
Experimental Sound Studio
Fulton Street Collective
Gallery Cabaret
Atlantic Bar and Grill
Bassment
Brudders'
Lee's Unleaded Blues Bar
Monday Blues Lounge
Nine Bar
Cobb Hall
Metro & Smartbar
Illuminated Brewery
Necessary & Sufficient Coffee
Bernice's Tavern
After
City Hall
Sound-bar
Weeds Tavern
Studebaker Theater
The Checkout
Expat
Huntington Bank Pavilion
The Rhapsody Theater
Wrigley Field
Atlantic
Navy Pier Beer Garden
The Store
Tackroom
Wave Wall Stage
Berwyn Stage
Brudder's Bar
Outset Patio
Renaissance Society
Stardust Lounge
Polk Bros Park
J Parker Rooftop
Smart Bar
Goldstar Bar
Recess
4200 W Diversey
Soldier Field
Casa Cafe
Skylark
The Renaissance Society
Richard J. Daley-Bridgeport Library
Local Option
Parallel Play
BlkRoom
```
