# Anatomy rows: sources

Every number in `rows.json`, by body and row. `checked` says how it was confirmed on 2026-11-16:
`web` = read on the cited page in this pass; `code` = computed by or read from the wallpaper's code; `secondary` = confirmed only through a secondary page or a search summary of the cited source; `recalled` = not confirmed on the web in this pass.

## Kerr numbers (lib/kerr.js at a/M = 0.94, a = 0.47 Rs; Rs = 12,255,516 km, Rs/c = 40.88 s from lib/fall.js at 4.15 million Suns)

| Quantity | Function | Value |
|---|---|---|
| Outer / inner horizon | `horizons(a)` | 0.6706 / 0.3294 Rs |
| Horizon as drawn at the equator | sqrt(r+^2 + a^2) | 0.8189 Rs |
| Photon orbits: with spin / against / polar | `photonOrbit(a, +1/-1)`, `polarPhotonOrbit(a)` | 0.7126 / 1.9732 / 1.2535 Rs |
| ISCO with spin (against) | `isco(a, 1)` (`isco(a, -1)`) | 1.0118 Rs (4.4154 Rs) |
| Horizon angular velocity | `horizonOmega(r+, a)` | 0.70088 c/Rs: one turn in 366.5 s = 6.11 min |
| Gas angular velocity at the ISCO | `gasOmega(r, a)` | 0.52375 c/Rs: one orbit in 490.4 s = 8.17 min |
| Shadow edges from the equator, far away | closed form b(r) at the two photon orbits | 1.3208 and 3.4498 Rs: width 4.7706, offset 1.0645 Rs |
| No-spin shadow | 3 sqrt(3) M x 2 | 5.1962 Rs |
| Ergosphere at the equator / ring radius | 2M / a | 1.0 / 0.47 Rs |

## Rows

### Sagittarius A* (`sgrA`, unit Rs)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Shadow | live: {"fn": "shadowWidth", "atEquator": "4.77 Rs"} | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Flat edge | 1.32 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Round edge | 3.45 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Without spin | 5.20 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Centre and offset | 1.06 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Spin axis | one turn in 6.1 min | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun); EHT Collaboration 2022, ApJL 930 L12 (Sgr A* Paper I) | file:lib/kerr.js ; https://eventhorizontelescope.org/publications/first-sagittarius-event-horizon-telescope-results-i-shadow-supermassive-black-hole |
| Event horizon | 0.67 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Ergosphere | 1.0 Rs at the equator | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Photon shell | 0.71 to 1.97 Rs | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Inner edge of the gas | 1.01 Rs, 8.2 min orbit | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Bright side | live: {"fn": "N times brighter"} | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Dim side | live: {"fn": "1/N as bright"} | model | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Measured ring | 5.2 Rs across | measured | web | EHT Collaboration 2022, ApJL 930 L12 (Sgr A* Paper I) | https://eventhorizontelescope.org/publications/first-sagittarius-event-horizon-telescope-results-i-shadow-supermassive-black-hole |
| Inner horizon | 0.33 Rs | mathematics | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Ring singularity | 0.47 Rs | mathematics | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Far sheet | through the ring | mathematics | code | lib/kerr.js at a/M = 0.94 (Background.qml holeSpin); Rs from lib/fall.js (4.15e6 Msun) | file:lib/kerr.js |
| Star S2's closest pass | 120 AU | measured | web | GRAVITY Collaboration 2018, A&A 615 L15 | https://arxiv.org/abs/1807.09409 |
| Nuclear star cluster | 4.2 pc | measured | web | Schoedel et al. 2014, A&A 566 A47 | https://arxiv.org/abs/1403.6657 |

- Measured ring, derived: 51.8 +/- 2.3 microarcsec / (Rs 1.2256e7 km at the code's 8150 pc = 10.05 microarcsec) = 5.15 Rs
- Star S2's closest pass, derived: 120 AU / Rs(1.2256e7 km) = 1,465 Rs; the paper's rounded figure is ~1,400 Rs

### Sun (`sun`, unit Rsun)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Core | 0.25 R | model | web | Solar core, Wikipedia (99% of fusion power inside 0.24 R); NASA Science: Sun facts | https://en.wikipedia.org/wiki/Solar_core ; https://science.nasa.gov/sun/facts/ |
| Tachocline | 0.713 R | measured | web | Christensen-Dalsgaard et al. 1991; Basu & Antia 1997 (0.713 R), as reviewed in arXiv:1003.3888 | https://arxiv.org/abs/1003.3888 |
| Photosphere | 695,700 km | measured | web | NASA Sun Fact Sheet (NSSDCA); NASA Science: Sun facts | https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html ; https://science.nasa.gov/sun/facts/ |
| Edge of the corona | about 19 R | measured | web | NASA SVS 4958, Parker Solar Probe: crossing the Alfven surface (28 Apr 2021, 18.8 Rsun) | https://svs.gsfc.nasa.gov/4958 |
| Termination shock | 84 to 94 AU | measured | web | NASA Voyager interstellar mission | https://science.nasa.gov/mission/voyager/interstellar-mission |
| Heliopause | about 120 AU | measured | web | NASA Voyager interstellar mission; Voyager 2 heliopause papers 2019, Nature Astronomy (summary in Eos) | https://science.nasa.gov/mission/voyager/interstellar-mission ; https://eos.org/articles/voyager-2s-interstellar-arrival-was-kind-of-familiar-thats-surprising |

- Edge of the corona, note: The Alfven surface is wrinkled and moves; pre-crossing estimates were 10 to 20 Rsun.

### Mercury (`mercury`, unit km)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Solid inner core | about 1,000 km | model | web | Genova et al. 2019, GRL 46, 3625 | https://dspace.mit.edu/handle/1721.1/125259 |
| Core | 2,074 km | model | web | NASA Science: Mercury facts | https://science.nasa.gov/mercury/facts/ |
| Surface | 2,439.7 km | measured | web | NASA Mercury Fact Sheet (NSSDCA); NASA Science: Mercury facts | https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html ; https://science.nasa.gov/mercury/facts/ |

- Solid inner core, note: Genova 2019: inner core 0.3 to 0.7 of the outer core radius.

### Venus (`venus`, unit km)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Core | about 3,200 km | model | web | Venus review 2024 (clouds 47 to 70 km; core 3,200 km model; Margot et al. 2021: 3,500 +/- 500 km) | https://arxiv.org/abs/2404.07669 |
| Surface | 6,051.8 km | measured | web | NASA Venus Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html |
| Cloud deck | 48 to 70 km up | measured | web | Venus review 2024 (clouds 47 to 70 km; core 3,200 km model; Margot et al. 2021: 3,500 +/- 500 km) | https://arxiv.org/abs/2404.07669 |

### Earth (`earth`, unit km)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Inner core | 1,221 km | measured | web | NASA Science: Earth facts | https://science.nasa.gov/earth/facts/ |
| Outer core | 2,890 km down | measured | web | NASA Science: Earth facts; NASA Earth Fact Sheet (NSSDCA) | https://science.nasa.gov/earth/facts/ ; https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html |
| Mantle | 2,900 km thick | measured | web | NASA Science: Earth facts | https://science.nasa.gov/earth/facts/ |
| Crust and ocean | 30 km on land, 5 at sea | measured | web | NASA Science: Earth facts | https://science.nasa.gov/earth/facts/ |
| Inner Van Allen belt | 1,600 to 13,000 km up | measured | secondary | NASA SVS 11212, Van Allen belts | https://svs.gsfc.nasa.gov/11212 |
| Outer Van Allen belt | 19,000 to 40,000 km up | measured | secondary | NASA SVS 11212, Van Allen belts | https://svs.gsfc.nasa.gov/11212 |
| Magnetopause | about 10 Earth radii | measured | web | NOAA SWPC: Earth's magnetosphere | https://www.swpc.noaa.gov/phenomena/earths-magnetosphere |

### Moon (`moon`, unit km)

Headline numbers: Weber et al. 2011, Science 331, 309 (NASA release), https://geology.com/nasa/moon-internal-structure

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Solid inner core | 240 km | measured | web | Weber et al. 2011, Science 331, 309 (NASA release) | https://geology.com/nasa/moon-internal-structure |
| Fluid outer core | 330 km | measured | web | Weber et al. 2011, Science 331, 309 (NASA release) | https://geology.com/nasa/moon-internal-structure |
| Partly molten layer | 480 km | model | web | Weber et al. 2011, Science 331, 309 (NASA release) | https://geology.com/nasa/moon-internal-structure |
| Crust | 34 to 43 km thick | measured | web | Wieczorek et al. 2013, Science 339, 671; NASA Moon Fact Sheet (NSSDCA) | https://ntrs.nasa.gov/citations/20130013613 ; https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html |

### Mars (`mars`, unit km)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Liquid core | 1,650 to 1,830 km | measured | web | NASA Mars Fact Sheet (NSSDCA), with its 1,650 to 1,675 km footnote | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| Surface | 3,389.5 km | measured | web | NASA Mars Fact Sheet (NSSDCA), with its 1,650 to 1,675 km footnote; Knapmeyer-Endrun et al. 2021, Science 373, 438 (summary) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html ; https://www.sci.news/space/insight-crust-mantle-core-mars-09897.html |

### Jupiter (`jupiter`, unit km)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Dilute core | to about 0.6 R | model | web | Militzer et al. 2022, PSJ 3, 185 | https://resolver.caltech.edu/CaltechAUTHORS:20220804-981005000 |
| Metallic hydrogen | from about 0.8 R | model | secondary | Planetary models and laboratory work (transition near 0.8 to 0.9 R); NASA Science: Jupiter facts | https://physicsworld.com/a/has-liquid-metallic-hydrogen-on-jupiter-been-recreated-in-the-lab/ ; https://science.nasa.gov/jupiter/jupiter-facts/ |
| Cloud tops | 71,488 by 66,842 km | measured | web | Juno radio occultations, Nature Astronomy 2026 (NASA release) | https://science.nasa.gov/blogs/science-news/2026/02/04/nasas-juno-mission-redefines-size-shape-of-jupiter |
| Io's ring of gas | 5.9 Jupiter radii | measured | secondary | Io orbit 421,700 km = 5.9 RJ (Juno torus occultations) | https://meetingorganizer.copernicus.org/EGU25/EGU25-19287.html |
| Magnetopause | 63 to 92 radii | measured | web | Joy et al. 2002, JGR 107, 1309 | https://doi.org/10.1029/2001JA009146 |

- Cloud tops, note: Juno 2026 values at the 1-bar level; the NSSDCA fact sheet still lists 71,492 by 66,854 km. The code's mean radius 69,911 km is the older mean (new: 69,886).
- Magnetopause, note: NASA's Jupiter page gives 1 to 3 million km (14 to 42 radii), which disagrees with Joy et al. 2002; the paper is used.

### Saturn (`saturn`, unit km)

Headline numbers: NASA Saturnian Rings Fact Sheet (NSSDCA), https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Fuzzy core | to about 0.6 R | model | web | Mankovich & Fuller 2021, Nature Astronomy 5, 1103 | https://arxiv.org/abs/2104.13385 |
| Cloud tops | 60,268 by 54,364 km | measured | web | NASA Saturn Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html |
| D ring | 66,900 km | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html |
| C ring | 74,658 km | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html |
| B ring | 91,975 km | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html |
| Cassini Division | about 4,700 km wide | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA); NASA Science: Saturn facts | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html ; https://science.nasa.gov/saturn/facts/ |
| A ring | to 136,780 km | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA); NASA Science: Saturn facts | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html ; https://science.nasa.gov/saturn/facts/ |
| F ring | 139,826 km | measured | web | NASA Saturnian Rings Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html |

- A ring, derived: 2 x 136,780 km = 273,560 km

### Betelgeuse (`betelgeuse`, unit Rsun)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Mars's orbit, for scale | 1.5 AU | measured | code | Background.qml planetInfo (JPL elements) | file:Background.qml |
| Surface | 764 Suns wide | model | web | Joyce et al. 2020, ApJ 902, 63 | https://arxiv.org/abs/2006.09837 |

- Surface, derived: 764 Rsun = 3.55 AU; Jupiter 5.20 AU

### Vega (`vega`, unit Rsun)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Flattened surface | 2.82 by 2.36 Suns | measured | web | Yoon et al. 2010, in van Belle 2012 review; Monnier et al. 2012 (0.71 d, pole-on); Monnier et al. 2012, ApJL 761 L3 | https://arxiv.org/abs/1204.2572 ; https://arxiv.org/abs/1211.6055 |

- Flattened surface, derived: 0.71 d = 17 h; 2.818 / 2.362 = 1.19

### Sirius (`sirius`, unit AU)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Sirius A | 2.06 Suns | measured | web | Bond et al. 2017, ApJ 840, 70 | https://arxiv.org/abs/1703.10625 |
| Sirius B's orbit | 8 to 31 AU | measured | web | Bond et al. 2017, ApJ 840, 70 | https://arxiv.org/abs/1703.10625 |
| Sirius B | Earth-sized | measured | web | Bond et al. 2017, ApJ 840, 70 | https://arxiv.org/abs/1703.10625 |

- Sirius A, derived: code dpc 2.64 pc = 8.6 ly
- Sirius B, derived: 0.0081 Rsun = 5,640 km = 0.88 Earth radii

### Alpha Centauri (`alphaCen`, unit AU)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| A and B's orbit | 11 to 36 AU | measured | secondary | Akeson et al. 2021, AJ 162, 14; orbit range as tabulated on Wikipedia | https://en.wikipedia.org/wiki/Alpha_Centauri |
| Proxima | 13,000 AU | measured | web | Kervella et al. 2017, A&A 598 L7 | https://arxiv.org/abs/1611.03495 |

### Polaris (`polaris`, unit Rsun)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| The Sun, for scale | 1 Sun | measured | web | NASA Sun Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html |
| Surface | 46 Suns wide | measured | web | Evans et al. 2024, ApJ 971, 190; CHARA Array release on Polaris, 2024 | https://arxiv.org/abs/2407.09641 ; https://sciencedaily.com/releases/2024/08/240820124556.htm |

### Pleiades (`pleiades`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Edge of the cluster | 11.6 pc | model | web | Lodieu et al. 2019, A&A 628 A66 | https://arxiv.org/abs/1906.03924 |
| Merope's cloud | reflected light | measured | web | NASA Hubble Messier catalog: M45 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-45/ |

### Hyades (`hyades`, unit pc)

Headline numbers: Roeser et al. 2019, A&A 621 L2, https://arxiv.org/abs/1811.03845

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Core | 3.1 pc | model | web | Roeser et al. 2011, A&A 531 A92 | https://arxiv.org/abs/1105.6093 |
| Edge of the cluster | 9 pc | model | web | Roeser et al. 2011, A&A 531 A92; Roeser et al. 2019, A&A 621 L2 | https://arxiv.org/abs/1105.6093 ; https://arxiv.org/abs/1811.03845 |

### Omega Centauri (`omegaCen`, unit pc)

Headline numbers: Baumgardt globular cluster database: NGC 5139, https://people.smp.uq.edu.au/HolgerBaumgardt/globular/fits/ngc5139.html

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Central black hole | 8,200 Suns or more | measured | web | Haeberle et al. 2024, Nature 631, 285 | https://arxiv.org/abs/2405.06015 |
| Half the stars | 10.4 pc | model | web | Baumgardt globular cluster database: NGC 5139 | https://people.smp.uq.edu.au/HolgerBaumgardt/globular/fits/ngc5139.html |

### 47 Tucanae (`tuc47`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Half the stars | 6.4 pc | model | web | Baumgardt globular cluster database: NGC 104 | https://people.smp.uq.edu.au/HolgerBaumgardt/globular/fits/ngc0104.html |
| Pulsar swarm | 42 pulsars | measured | web | Freire: the 47 Tucanae pulsars (42 known, May 2026) | https://www3.mpifr-bonn.mpg.de/staff/pfreire/47Tuc/ |

### Westerlund 1 (`westerlund1`, unit pc)

Headline numbers: EWOCS-III (JWST), arXiv:2411.13051, https://arxiv.org/abs/2411.13051

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Magnetar | dead star | measured | web | EWOCS-III (JWST), arXiv:2411.13051 | https://arxiv.org/abs/2411.13051 |
| Giant stars | 24 Wolf-Rayet stars | measured | web | EWOCS-III (JWST), arXiv:2411.13051 | https://arxiv.org/abs/2411.13051 |

### Orion Nebula (`orion`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Trapezium | 44 Suns | measured | web | Kraus et al. 2009, A&A 497, 195; NASA Hubble Messier catalog: M42 | https://arxiv.org/abs/0902.0365 ; https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42/ |
| Orion Bar | 0.24 pc | measured | web | PDRs4All III, arXiv:2310.08720 (Bar 2 arcmin from theta1 Ori C; 414 pc) | https://arxiv.org/abs/2310.08720 |
| Cold cloud behind | hidden stars | model | recalled | O'Dell 2001, ARA&A 39, 99 (not web-checked in this pass) | https://doi.org/10.1146/annurev.astro.39.1.99 |

- Orion Bar, derived: 2 arcmin at 414 pc (1 arcsec = 0.002 pc) = 0.24 pc, projected

### Carina Nebula · Eta Carinae (`carina`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Eta Carinae | 5 million Suns bright | measured | secondary | Smith 2017, MNRAS 471, 4465; Astronomy magazine on Eta Carinae | https://arxiv.org/abs/1709.06210 |
| Homunculus | about 1 light-year | measured | web | NASA SVS 11568: Eta Carinae and the Homunculus | https://svs.gsfc.nasa.gov/old/11568 |
| Trumpler 14 | 2.5 million years old | measured | web | NASA Hubble: The Carina Nebula, star birth in the extreme | https://science.nasa.gov/missions/hubble/the-carina-nebula-star-birth-in-the-extreme/ |

### Eagle Nebula (`eagle`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Pillars of Creation | 4 to 5 light-years tall | measured | web | NASA Hubble Messier catalog: M16 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-16 |
| Cluster NGC 6611 | 1 to 2 million years old | measured | secondary | NASA Hubble Messier catalog: M16 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-16 |

### Lagoon Nebula (`lagoon`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Herschel 36 | 200,000 Suns bright | measured | web | NASA/ESA Hubble 28th anniversary: Lagoon Nebula | https://esahubble.org/images/comparisons/heic1808a/ |
| Cluster NGC 6530 | several thousand stars | measured | web | NASA Hubble Messier catalog: M8 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-8/ |

### Crab Nebula (`crab`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Pulsar | 30 turns a second | measured | web | NASA Hubble Messier catalog: M1 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-1/ |
| Shock ring | 1 light-year across | measured | web | Chandra X-ray Center: Crab Nebula (Weisskopf et al. 2000) | https://chandra.si.edu/photo/1999/0052/0052_hand.html |
| Expanding shell | 11 light-years | measured | web | NASA Hubble: a giant mosaic of the Crab Nebula | https://science.nasa.gov/missions/hubble/a-giant-hubble-mosaic-of-the-crab-nebula/ |

- Shock ring, derived: 1 ly diameter = 0.15 pc radius; the ring is tilted, its axis must be fitted on the photo
- Expanding shell, derived: 11 ly = 3.4 pc across (matches the hotspot size 3.4)

### Cygnus X / Cygnus OB2 (`cygnusX`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Cygnus OB2 | 16,500 Suns | measured | web | Wright et al. 2015, MNRAS 449, 741 | https://arxiv.org/abs/1502.05718 |
| Cosmic-ray cocoon | 50 pc wide | measured | web | Ackermann et al. 2011, Science 334, 1103 | https://pubmed.ncbi.nlm.nih.gov/22116880/ |

### Rosette Nebula (`rosette`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Cluster NGC 2244 | over 70 giant stars | measured | secondary | Rosette stellar-wind model paper, arXiv:1802.04828 (cavity radius 6.2 pc) | https://arxiv.org/abs/1802.04828 |
| Central hollow | 6.2 pc | measured | secondary | Rosette stellar-wind model paper, arXiv:1802.04828 (cavity radius 6.2 pc) | https://arxiv.org/abs/1802.04828 |

### Ring Nebula (`ringNebula`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Central star | 135,000 K | measured | web | Wesson et al. 2024, MNRAS 528, 3392 (JWST) | https://arxiv.org/abs/2308.09027 |
| Shell of globules | 20,000 globules | measured | web | Wesson et al. 2024, MNRAS 528, 3392 (JWST) | https://arxiv.org/abs/2308.09027 |

### Helix Nebula (`helix`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Central star | over 100,000 K | measured | secondary | Helix central star, about 104,000 to 120,000 K (Napiwotzki 1999, as cited) | https://en.wikipedia.org/wiki/Helix_Nebula |
| Main ring | nearly 3 light-years | measured | web | NASA Hubble: iridescent glory of the nearby Helix Nebula; Matsuura et al. 2009, ApJ 700, 1067 | https://science.nasa.gov/missions/hubble/iridescent-glory-of-nearby-helix-nebula/ ; https://arxiv.org/abs/0906.2870 |

- Main ring, derived: 3 ly diameter = 0.45 pc radius

### Gum Nebula (`gum`, unit pc)

Headline numbers: Gum Nebula studies 2026 (ionised by gamma2 Vel and zeta Pup; Vela pulsar inside the shell), https://arxiv.org/abs/2601.05791

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Shell | about 290 pc wide | model | secondary | Gum Nebula studies 2026 (ionised by gamma2 Vel and zeta Pup; Vela pulsar inside the shell); Background.qml hotspots (size and position) | https://arxiv.org/abs/2601.05791 ; file:Background.qml |
| Vela pulsar | dead star | measured | web | Gum Nebula studies 2026 (ionised by gamma2 Vel and zeta Pup; Vela pulsar inside the shell) | https://arxiv.org/abs/2601.05791 |

### Milky Way (`milkyWay`, unit kpc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Central molecular zone | 300 pc | measured | web | Henshaw et al. 2023, Protostars and Planets VII | https://arxiv.org/abs/2203.11223 |
| Bar | 5 kpc each way | measured | web | Wegg, Gerhard & Portail 2015, MNRAS 450, 4050 | https://arxiv.org/abs/1504.01401 |
| Local Bubble | 1,000 light-years | measured | web | Zucker et al. 2022, Nature 601, 334 (CfA release) | https://www.cfa.harvard.edu/news/1000-light-year-wide-bubble-surrounding-earth-source-all-nearby-young-stars |
| Sun's orbit | 8.15 kpc | measured | web | Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529; Background.qml hotspots (size and position) | https://arxiv.org/abs/1602.07702 ; file:Background.qml |
| Fermi bubbles | about 10 kpc tall | measured | web | Su, Slatyer & Finkbeiner 2010, ApJ 724, 1044 | https://arxiv.org/abs/1005.5480 |
| eROSITA bubbles | 14 kpc tall | measured | web | Predehl et al. 2020, Nature 588, 227 | https://arxiv.org/abs/2012.05840 |
| Dark halo | about 280 kpc | model | web | Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529; Deason et al. 2020, MNRAS 496, 3929 | https://arxiv.org/abs/1602.07702 ; https://arxiv.org/abs/2002.09497 |

- Sun's orbit, derived: BH&G 2016: 248 +/- 3 km/s, 30.24 km/s/kpc, so 2 pi / Omega = 203 Myr; code 248.9 km/s at 8.15 kpc = 201 Myr
- Fermi bubbles, derived: 50 degrees and 40 degrees wide at the code's R0 8.15 kpc: tan(50)*8.15 = 9.7 kpc, 2*tan(20)*8.15 = 5.9 kpc; Su et al. quote roughly 10 kpc at R0 8.5
- eROSITA bubbles, note: width not verified; take it from the eROSITA map when drawn

### Andromeda Galaxy (`m31`, unit kpc)

Headline numbers: van der Marel et al. 2012, ApJ 753, 8, https://arxiv.org/abs/1205.6864

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Central black hole | 140 million Suns | measured | web | Bender et al. 2005, ApJ 631, 280; van der Marel et al. 2012, ApJ 753, 8 | https://arxiv.org/abs/astro-ph/0509839 ; https://arxiv.org/abs/1205.6864 |
| Ring of fire | 10 kpc | measured | web | Gordon et al. 2006, ApJL 638 L87 | https://arxiv.org/abs/astro-ph/0601314 |
| Halo | about 300 kpc | model | web | Lehner et al. 2020, ApJ 900, 9 (Project AMIGA); Ibata et al. 2014, ApJ 780, 128 (PAndAS) | https://arxiv.org/abs/2002.07818 ; https://arxiv.org/abs/1311.5888 |

- Central black hole, derived: 1.4e8 / 4.15e6 (code) = 34

### Triangulum Galaxy (`m33`, unit kpc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Centre | no giant black hole | measured | web | Gebhardt et al. 2001, AJ 122, 2469 | https://arxiv.org/abs/astro-ph/0107135 |
| NGC 604 | 1,300 light-years | measured | web | NASA/JPL: peering into the tendrils of NGC 604 with Webb | https://www.jpl.nasa.gov/news/peering-into-the-tendrils-of-ngc-604-with-nasas-webb/ |
| M33 X-7 | black hole, 16 Suns | measured | web | Orosz et al. 2007, Nature 449, 872 | https://arxiv.org/abs/0710.3165 |

### Large Magellanic Cloud (`lmc`, unit kpc)

Headline numbers: Erkal et al. 2019, MNRAS 487, 2685, https://arxiv.org/abs/1812.08192

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Tarantula Nebula | 1,000 light-years | measured | secondary | Kalari et al. 2022, ApJ 935, 162; NASA APOD 2024 March 8: the Tarantula zone (more than 1,000 light-years) | https://arxiv.org/abs/2207.13078 ; https://science.nasa.gov/image-article/apod-2024-march-8-the-tarantula-zone/ |
| Supernova 1987A | exploded 1987 | measured | web | NASA Hubble: Supernova 1987A ring (1.37 light-years) | https://science.nasa.gov/asset/hubble/supernova-1987a/ |
| Magellanic Bridge | 24 kpc | measured | secondary | Magellanic Bridge: gas and young stars stripped from the SMC about 200 Myr ago (search summary; arXiv:1112.6191); Background.qml hotspots (size and position) | https://arxiv.org/abs/1112.6191 ; file:Background.qml |

- Tarantula Nebula, note: size from a NASA-hosted summary (about 1,000 ly); estimates run from 650 to 1,860 ly
- Magellanic Bridge, derived: distance between the code's LMC and SMC positions = 23.8 kpc

### Small Magellanic Cloud (`smc`, unit kpc)

Headline numbers: SMC red clump depth study, arXiv:1310.4824 (search summary), https://arxiv.org/abs/1310.4824

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Depth | up to 23 kpc deep | measured | secondary | SMC red clump depth study, arXiv:1310.4824 (search summary) | https://arxiv.org/abs/1310.4824 |
| Magellanic Bridge | 24 kpc | measured | secondary | Magellanic Bridge: gas and young stars stripped from the SMC about 200 Myr ago (search summary; arXiv:1112.6191); Background.qml hotspots (size and position) | https://arxiv.org/abs/1112.6191 ; file:Background.qml |
| Magellanic Stream | 200 degrees of sky | measured | web | Nidever et al. 2010, ApJ 723, 1618 | https://arxiv.org/abs/1009.0001 |

- Magellanic Bridge, derived: distance between the code's LMC and SMC positions = 23.8 kpc

### Sagittarius Dwarf (`sgrDwarf`, unit kpc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Half its light | 2.6 kpc | measured | code | McConnachie 2012 via lib/dwarfs.js | file:lib/dwarfs.js |

### Dwarf galaxies (lib/dwarfs.js) (`dwarf`, unit pc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Half its light | live: {"fn": "dwarf.rh"} | measured | code | McConnachie 2012 via lib/dwarfs.js | file:lib/dwarfs.js |
| Dark matter | 580,000 Suns | measured | web | Simon et al. 2011, ApJ 733, 46; McConnachie 2012 via lib/dwarfs.js | https://arxiv.org/abs/1007.4198 ; file:lib/dwarfs.js |

### Local Group (`localGroup`, unit kpc)

| Row | Label | Tag | Checked | Source | URL |
|---|---|---|---|---|---|
| Milky Way's halo | about 280 kpc | model | web | Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529 | https://arxiv.org/abs/1602.07702 |
| Andromeda's halo | about 300 kpc | model | web | Lehner et al. 2020, ApJ 900, 9 (Project AMIGA); Background.qml hotspots (size and position) | https://arxiv.org/abs/2002.07818 ; file:Background.qml |
| Centre of mass | 55% of the way | model | web | Karachentsev et al. 2009, MNRAS 393, 1265 | https://arxiv.org/abs/0811.4610 |
| Edge of the group | 0.96 Mpc | measured | web | Karachentsev et al. 2009, MNRAS 393, 1265; van der Marel et al. 2012, ApJ 753, 8 | https://arxiv.org/abs/0811.4610 ; https://arxiv.org/abs/1205.6864 |

## Design numbers corrected

| Design said | Rows use | Why |
|---|---|---|
| `unitKm: 1.270e7` for Sgr A* | 12,255,516 km | lib/fall.js uses 4.15 million Suns (GRAVITY 2019): Rs/c = 40.88 s. 1.270e7 km is a 4.30-million-Sun hole. |
| Gas orbit at the inner edge: 8.5 minutes | 8.2 minutes | same cause: 2 pi / gasOmega x 40.88 s = 490 s. The README fix in step 1 should say 8.2 too. |
| Horizon turns once in 6.3 minutes | 6.1 minutes | same cause: 2 pi / horizonOmega x 40.88 s = 367 s. |
| Mercury's core at 83% of the radius | 85% (2,074 km) | NASA Mercury facts. |
| Fermi bubbles 8 to 9 kpc; 'about as tall as the Sun is far from the centre' | about 10 kpc (9.7 at the code's R0) | Su et al. 2010: 50 degrees, 'roughly 10 kpc'. Wording now says 'farther than the Sun is from the centre'. |
| Crab shock ring 0.1 pc | about 1 light-year across (0.15 pc radius) | Chandra X-ray Center. |
| Moon cores 330 to 360 km and 240 to 260 km | 330 km and 240 km | Weber et al. 2011 (NASA release). |
| Alfven surface 13 to 20 R | about 19 R (crossed at 18.8) | only the 18.8 R crossing and a 10 to 20 R estimate were confirmed. |
| Local Group surface 1 Mpc | 0.96 Mpc | Karachentsev et al. 2009. |
| Milky Way dark halo 200 to 290 kpc | about 280 kpc | 282 +/- 30 (Bland-Hawthorn & Gerhard 2016); 292 +/- 61 (Deason et al. 2020). |
| Jupiter (no radii given; code mean 69,911 km) | 71,488 by 66,842 km | Juno, Nature Astronomy, February 2026. |
| Saturn 'rings span 270,000 km' | 273,600 km (main rings, edge to edge) | NSSDCA rings fact sheet: A ring outer edge 136,780 km. |

Confirmed as written: shadow 4.77 Rs, edges 1.32 and 3.45 Rs, no-spin 5.20 Rs, offset 1.06 Rs, horizon 0.67 (0.82 drawn), photon shell 0.71 / 1.97 / 1.25, ISCO 1.01, inner horizon 0.33, ring 0.47; Sun core 0.25 R, tachocline 0.713 R, termination shock 84 to 94 AU, heliopause 121.6 AU; Earth 1,221 km and 2,891 km; Venus clouds 48 to 70 km; Mars 1,650 to 1,830 km; Moon crust 34 to 43 km; Saturn 60,268 by 54,364 km and 60% fuzzy core; eROSITA bubbles 14 kpc; Betelgeuse about 760 Suns.

## Open doubts

- Photo positions: point rows on the nebula photos carry a SIMBAD name, not coordinates. The CDS name resolver did not answer from this machine, so no RA/Dec was written unverified. Resolve the names at build time.
- Orion 'cold cloud behind' is the one row not confirmed on the web (O'Dell 2001 from memory).
- Van Allen belt altitudes are NASA's as quoted by a search summary of SVS 11212; the page itself did not load. Other sources give the inner belt up to 12,000 km and the outer to 60,000 km.
- Jupiter's magnetopause: NASA's Jupiter page says 1 to 3 million km (14 to 42 radii); Joy et al. 2002 says 63 and 92 radii. The rows use the paper.
- Jupiter's metallic hydrogen depth (about 0.8 R) is model-dependent (0.8 to 0.9 R in the literature).
- Vega's radii are Yoon et al. 2010 (2.818 by 2.362); Monnier et al. 2012 found slower rotation but its radii were not read in this pass.
- eROSITA bubbles: height confirmed, width not. Fermi bubble width is derived from 40 degrees of longitude.
- Tarantula Nebula size (about 1,000 light-years) ranges from 650 to 1,860 in the literature.
- Helix central star temperature: 104,000 to 120,000 K by source; the label says 'over 100,000 K'.
- Crab shock ring is tilted and off-centre by 0.9 arcsec; its ellipse must be fitted on the photo.
- Mars core: one sphere at 1,650 km with the label '1,650 to 1,830 km'. The 2023 molten-silicate-layer papers were confirmed only through the NSSDCA footnote.
- Magellanic Bridge and SMC depth are confirmed through search summaries only.
- Alpha Centauri orbit range (11.2 to 35.6 AU) is from Wikipedia's table of the Akeson et al. 2021 orbit.
- Kept off screen, as the design says: Mars's solid inner core (2025), Betelgeuse's companion (2025), Milky Way-Andromeda merger odds (2025).
