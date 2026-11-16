// gen_anatomy.js: lib/anatomy-data.js from the fact-checked rows.
//   node tools/gen_anatomy.js            (run in the repository's root)
// tools/anatomy-rows.json holds every row as it was checked (name, label,
// fact, source, tag; docs/anatomy-sources.md says how each number was
// confirmed) with its shape as a descriptor; tools/anatomy-simbad.json the
// sky positions SIMBAD gave for the named objects (J2000 degrees; Trumpler 14
// and Cyg OB2 under SIMBAD's own names "Cl Trumpler 14" and "Ass Cyg OB 2"). This
// script turns each descriptor into one of lib/anatomy.js's shapes, says
// where each body is found in the views (WHERE) and writes the table. No
// wording is typed here: names, labels and facts are copied.
//
// A row whose place could not be fixed from a checked number (an orbit's
// orientation, a ring fitted on a photo, an unverified width) keeps its
// words and gets shape null: it is in the table and is never drawn.
const fs = require("fs"), path = require("path")
const here = path.dirname(process.argv[1])
const src = JSON.parse(fs.readFileSync(path.join(here, "anatomy-rows.json"), "utf8"))
const simbad = JSON.parse(fs.readFileSync(path.join(here, "anatomy-simbad.json"), "utf8"))
const norm = s => s.replace(/^(\* |NAME |V\* )/, "").replace(/\s+/g, " ").trim().toLowerCase()
const sky = {}
for (const k in simbad) sky[norm(k)] = simbad[k]
function Raw(code) { this.code = code }           // emitted as JavaScript, not as a string
const raw = code => new Raw(code)
const skyOf = name => { const p = sky[norm(name)]; return p ? { ra: +p[0].toFixed(5), dec: +p[1].toFixed(5) } : null }

// where each body is in the views, its own radius in its unit (what "inside
// the body" means, and when its points show), its axis and what holds it
const POLE = { earth: [0, 0.91748, -0.39778], mars: [0.44615, 0.89323, 0.05551], jupiter: [-0.0146, 0.99925, 0.03582], saturn: [0.08548, 0.88252, -0.46244] }
const WHERE = {
  sgrA: { place: "Sagittarius A", radius: 1, axis: "spin", parent: "milkyWay", kpcPerUnit: raw("c => c.rsKpc") },
  sun: { sys: 0, at: "sun", radius: 1, parent: "milkyWay" },
  mercury: { sys: 1, radius: 2439.7 }, venus: { sys: 2, radius: 6051.8 }, earth: { sys: 3, radius: 6371, axis: { v: POLE.earth } },
  mars: { sys: 4, radius: 3389.5, axis: { v: POLE.mars } }, jupiter: { sys: 5, radius: 69911, axis: { v: POLE.jupiter } },
  saturn: { sys: 6, radius: 58232, axis: { v: POLE.saturn } }, moon: { sys: 7, radius: 1737.4 },
  betelgeuse: { place: "Betelgeuse", radius: 764, axis: "sight" }, vega: { place: "Vega", radius: 2.818, axis: "sight" },
  sirius: { place: "Sirius", radius: 0.008 }, alphaCen: { place: "Alpha Centauri", radius: 0.0057 }, polaris: { place: "Polaris", radius: 46 },
  pleiades: { place: "Pleiades", radius: 2 }, hyades: { place: "Hyades", radius: 3.1 }, omegaCen: { place: "Omega Centauri", radius: 10.4 },
  tuc47: { place: "47 Tucanae", radius: 6.4 }, westerlund1: { place: "Westerlund 1", radius: 1 },
  orion: { place: "Orion Nebula", radius: 2, axis: "sight" }, carina: { place: "Carina Nebula", radius: 20 }, eagle: { place: "Eagle Nebula", radius: 8 },
  lagoon: { place: "Lagoon Nebula", radius: 15 }, crab: { place: "Crab Nebula", radius: 1.7 }, cygnusX: { place: "Cygnus X", radius: 25 },
  rosette: { place: "Rosette Nebula", radius: 20 }, ringNebula: { place: "Ring Nebula", radius: 0.15 }, helix: { place: "Helix Nebula", radius: 0.45, axis: "sight" },
  gum: { place: "Gum Nebula", radius: 145 },
  milkyWay: { at: "centre", sky: true, radius: 15, axis: "galactic", parent: "localGroup" },
  m31: { place: "Andromeda", radius: 23, axis: { disk: "m31" }, parent: "localGroup" }, m33: { place: "Triangulum", radius: 9, parent: "localGroup" },
  lmc: { place: "Large Magellanic", radius: 4.5, parent: "localGroup" }, smc: { place: "Small Magellanic", radius: 2.9, axis: "sight", parent: "localGroup" },
  sgrDwarf: { place: "Sagittarius Dwarf", radius: 2.587, axis: "sight", parent: "localGroup" },
  segue1: { place: "Segue (I)", radius: raw("c => c.place.rh"), axis: "sight", parent: "localGroup" },
  dwarf: { dwarf: true, radius: raw("c => c.place.rh"), axis: "sight", parent: "localGroup" },
  localGroup: { at: "centre", radius: 400 }
}
for (const id in WHERE) if (WHERE[id].place && !WHERE[id].parent) WHERE[id].parent = "milkyWay"

// the hole's rows read lib/kerr.js at the live spin (c.a), so they stay in step with the render
const KS = "Math.sqrt(Math.pow(%, 2) + c.a * c.a)"       // where Kerr-Schild coordinates draw an equatorial radius
const HOLE = {
  shadow: { shape: { s: "shadow" }, label: raw("(c, g) => g && g.width ? g.width.toFixed(2) + ' Rs wide' : '4.77 Rs wide'") },
  flatEdge: { shape: { s: "shadowEdge", which: "near" }, label: raw("(c, g) => g && g.near ? g.near.toFixed(2) + ' Rs' : '1.32 Rs'") },
  roundEdge: { shape: { s: "shadowEdge", which: "far" }, label: raw("(c, g) => g && g.far ? g.far.toFixed(2) + ' Rs' : '3.45 Rs'") },
  noSpin: { shape: { s: "impact", b: 1.5 * Math.sqrt(3) } },
  offset: { shape: { s: "shadowMid" }, label: raw("(c, g) => g && g.offset !== undefined ? g.offset.toFixed(2) + ' Rs' : '1.06 Rs'") },
  spinAxis: { shape: { s: "axis", len: 2.4, turn: 1 }, label: raw("c => 'one turn in ' + (2 * Math.PI / Kerr.horizonOmega(Kerr.horizons(c.a).rPlus, c.a) * c.unitS / 60).toFixed(1) + ' min'") },
  horizon: { shape: { s: "profile", f: raw("(c, t) => Kerr.ksPoint(Kerr.horizons(c.a).rPlus, t, c.a)") }, label: raw("c => Kerr.horizons(c.a).rPlus.toFixed(2) + ' Rs'") },
  ergosphere: { shape: { s: "profile", f: raw("(c, t) => Kerr.ksPoint(Kerr.ergoRadius(t, c.a), t, c.a)") } },
  photonShell: { shape: { s: "annulus", r0: raw("c => " + KS.replace("%", "Kerr.photonOrbit(c.a, 1)")), r1: raw("c => " + KS.replace("%", "Kerr.photonOrbit(c.a, -1)")) },
                 label: raw("c => Kerr.photonOrbit(c.a, 1).toFixed(2) + ' to ' + Kerr.photonOrbit(c.a, -1).toFixed(2) + ' Rs'") },
  isco: { shape: { s: "ring", r: raw("c => " + KS.replace("%", "Kerr.isco(c.a, 1)")), turn: 1 },
          label: raw("c => Kerr.isco(c.a, 1).toFixed(2) + ' Rs, ' + (2 * Math.PI / Kerr.gasOmega(Kerr.isco(c.a, 1), c.a) * c.unitS / 60).toFixed(1) + ' min orbit'") },
  brightSide: { shape: { s: "limb", side: 1, r: raw("c => " + KS.replace("%", "Kerr.isco(c.a, 1)")) }, label: raw("(c, g) => g && g.bright > 1.5 ? Math.round(g.bright) + ' times brighter' : 'the brighter side'"),
                fact: raw("(c, g, text) => g && g.bright > 1.5 ? text.replace('N times', Math.round(g.bright) + ' times') : text.replace(': N times brighter than the far side', '')") },
  dimSide: { shape: { s: "limb", side: -1, r: raw("c => " + KS.replace("%", "Kerr.isco(c.a, 1)")) }, label: raw("(c, g) => g && g.bright > 1.5 ? '1/' + Math.round(g.bright) + ' as bright' : 'the dimmer side'") },
  ehtRing: { shape: { s: "impact", b: 5.15 / 2, about: "shadowMid" } },
  innerHorizon: { shape: { s: "profile", f: raw("(c, t) => Kerr.ksPoint(Kerr.horizons(c.a).rMinus, t, c.a)") }, label: raw("c => Kerr.horizons(c.a).rMinus.toFixed(2) + ' Rs'") },
  ring: { shape: { s: "ring", r: raw("c => c.a") }, label: raw("c => c.a.toFixed(2) + ' Rs'") },
  farSheet: { shape: { s: "ring", r: raw("c => c.a") }, fold: "ring" }
}
// shapes the descriptor alone does not give (the body's id, then the row's)
const SHAPES = {
  "milkyWay.cmz": { s: "ring", r: 0.3 },
  "milkyWay.bar": { s: "bar", half: 5.0, dir: [0.45399, 0.89101] },      // galaxy.frag's bar: 27 degrees from the Sun's line, the near end at positive longitude
  "milkyWay.erosita": null,                                              // width not verified
  "betelgeuse.marsOrbit": { s: "ring", r: 327.6 },
  "orion.bar": { s: "ring", r: 0.24, pa: [90, 180], centre: skyOf("tet01 Ori C") },   // the arc from east to south of the Trapezium
  "carina.homunculus": null,                                             // the lobes' direction on the sky is not in the rows
  "crab.innerRing": null,                                                // tilted and off-centre: to be fitted on the photo
  "ringNebula.shell": null,                                              // an outline traced on the photo, no size verified
  "helix.mainRing": { s: "ring", r: 0.45 },
  "sirius.orbitB": null, "sirius.siriusB": null, "alphaCen.orbitAB": null, "alphaCen.proxima": null,   // the orbits' orientations are not in the rows
  "lmc.bridge": { s: "seg", to: { place: "Small Magellanic" } }, "smc.bridge": { s: "seg", to: { place: "Large Magellanic" } },
  "smc.depth": { s: "ell", a: 2.9, c: 11.5 }, "smc.stream": null,        // an arc on the sky, not a place
  "sgrDwarf.halfLight": { s: "skyEllipse", a: raw("c => c.place.rh / 1000"), ell: raw("c => c.place.ell || 0"), pa: raw("c => c.place.pa || 0") },
  "dwarf.halfLight": { s: "skyEllipse", a: raw("c => c.place.rh"), ell: raw("c => c.place.ell || 0"), pa: raw("c => c.place.pa || 0") },
  "dwarf.segueDark": { s: "ell", a: 29, c: 29 },
  "localGroup.mwHalo": { s: "ell", a: 282, c: 282 }, "localGroup.m31Halo": { s: "ell", a: 300, c: 300, centre: { place: "Andromeda" } },
  "localGroup.barycentre": { s: "pt", centre: { toPlace: "Andromeda", fraction: 0.55 } },
  "localGroup.zeroVelocity": { s: "ell", a: 960, c: 960, centre: { toPlace: "Andromeda", fraction: 0.55 } }
}
const LABELS = { "dwarf.halfLight": raw("c => Math.round(c.place.rh) + ' pc'") }

function shapeOf(bid, r) {
  const key = bid + "." + r.id, d = r.shape
  if (key in SHAPES) return SHAPES[key]
  let centre
  if (d.centre && d.centre.simbad) { centre = skyOf(d.centre.simbad); if (!centre) return null }
  else if (d.centre === "sun") centre = "sun"
  const withC = o => { if (centre) o.centre = centre; if (d.soft) o.soft = true; if (d.toward) o.toward = d.toward; return o }
  if (d.sphere !== undefined) return withC({ s: "ell", a: d.sphere, c: d.sphere })
  if (d.spheroid) return withC({ s: "ell", a: d.spheroid[0], c: d.spheroid[1] })
  if (d.shell) return withC({ s: "shell", r0: d.shell[0], r1: d.shell[1] })
  if (d.lobes && d.lobes.height && d.lobes.width) return withC({ s: "lobes", h: d.lobes.height, w: d.lobes.width })
  if (d.annulus) return withC({ s: "annulus", r0: d.annulus[0], r1: d.annulus[1] })
  if (d.ring !== undefined) { const o = withC({ s: "ring", r: d.ring }); if (d.turn) o.turn = d.turn; return o }
  if (d.at) return { s: "pt", at: d.at }
  if (d.simbad) { const p = skyOf(d.simbad); return p ? { s: "pt", centre: p } : null }
  return null
}
const lit = v => v instanceof Raw ? v.code : Array.isArray(v) ? "[" + v.map(lit).join(", ") + "]"
  : v && typeof v === "object" ? "{ " + Object.keys(v).map(k => k + ": " + lit(v[k])).join(", ") + " }" : JSON.stringify(v)

const bodies = []
let nRows = 0, nWait = 0
function body(id, b, rows) {
  const w = WHERE[id]
  if (!w) throw new Error("no WHERE for " + id)
  const out = { id: id, title: id === "segue1" ? "Segue 1" : id === "dwarf" ? "Dwarf galaxy" : b.title, unit: b.unit, unitKm: b.unitKm }
  Object.assign(out, w)
  out.headline = b.headline
  out.rows = rows.map(r => {
    const h = id === "sgrA" ? HOLE[r.id] : null
    const o = { id: r.id, name: r.name, kind: r.kind, tag: r.tag }
    const shape = h && h.shape ? h.shape : shapeOf(b.id, r)
    o.shape = shape
    const label = h && h.label ? h.label : LABELS[b.id + "." + r.id] || r.label
    if (label && typeof label === "object" && !(label instanceof Raw)) throw new Error("no label for " + id + "." + r.id)
    o.label = label
    // a live fact starts from the words as checked
    o.fact = h && h.fact ? raw("(c, g) => (" + h.fact.code + ")(c, g, " + JSON.stringify(r.fact) + ")") : r.fact
    o.source = r.source
    if (r.math) o.math = true
    const fold = (h && h.fold) || r.fold
    if (fold) o.fold = fold
    nRows++; if (!shape) nWait++
    return o
  })
  bodies.push(out)
}
for (const b of src.bodies) {
  if (b.id === "dwarf") {
    body("dwarf", b, b.rows.filter(r => !(r.shape && r.shape.only)))
    body("segue1", b, b.rows)
  } else body(b.id, b, b.rows)
}
const txt = ".pragma library\n.import \"kerr.js\" as Kerr\n"
  + "// anatomy-data.js: the anatomy table, one record a body. GENERATED by\n// tools/gen_anatomy.js from tools/anatomy-rows.json (the fact-checked rows;\n"
  + "// docs/anatomy-sources.md). Do not edit: change the rows or the generator\n// and run it again. lib/anatomy.js says what the fields mean.\n"
  + "const LIMITS = " + lit(src.limits) + "\n"
  + "const BODIES = [\n" + bodies.map(b => "  { " + Object.keys(b).filter(k => k !== "rows").map(k => k + ": " + lit(b[k])).join(", ") + ",\n    rows: [\n"
      + b.rows.map(r => "      " + lit(r)).join(",\n") + "\n    ] }").join(",\n") + "\n]\n"
fs.writeFileSync(path.join(here, "..", "lib", "anatomy-data.js"), txt)
console.log(bodies.length + " records, " + nRows + " rows (" + nWait + " kept as words only: no checked place to draw them)")
