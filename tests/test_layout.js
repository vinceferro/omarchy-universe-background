// checks for layout.js, the zones the wallpaper's text lives in (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const L = new Function(src + "\nreturn { EDGE, TOP_GAP, RING, BRACKET, BEACON, DRIFT_X, DRIFT_Y, WIDE, tokens, textW, plan, toPx, hudAt, hudExtent, railRect, captionRect, storyRect, intersects, inSafe, pointIn, hits, beaconLabel, clampMarker, labelBoxAt, placeLabels, parseCutouts, cutoutTop };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol)
const R = x => Math.round(x)
// a small seeded generator, so a failure can be run again
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

// the two machines as Hyprland reports them, and a plain 16:9 screen with a bar
const CUT = L.parseCutouts(JSON.stringify({ panels: [
  { connector: "eDP", width: 3024, height: 1964, top: 64 }, { connector: "eDP", width: 3456, height: 2234, top: 64 },
  { connector: "eDP", width: 2560, height: 1664, top: 56 }, { connector: "eDP", width: 2880, height: 1864, top: 56 }] }))
const lapCut = L.cutoutTop(CUT, "eDP-1", 1728, 1117, 2, { width: 3456, height: 2234, transform: 0 })
const BOX = L.plan(5120, 2160, [0, 43, 0, 0], L.cutoutTop(CUT, "DP-1", 5120, 2160, 1, { width: 5120, height: 2160, transform: 0 }))
const LAP = L.plan(1728, 1117, [0, 32, 0, 0], lapCut)
const HD = L.plan(1920, 1080, [0, 26, 0, 0], 0)
const SCREENS = [["box", BOX], ["laptop", LAP], ["1920x1080", HD]]

// 1. the notch: from the platform's file, matched like the bar's
check("cutouts: the four panels parse", CUT.length === 4)
check("laptop: the notch is 32 logical px", lapCut === 32, lapCut)
check("box: no cutout (another connector)", L.cutoutTop(CUT, "DP-1", 5120, 2160, 1, null) === 0)
check("no mode yet: the logical size times the scale stands in", L.cutoutTop(CUT, "eDP-1", 1728, 1117, 2, null) === 32)
check("a turned panel has its notch elsewhere", L.cutoutTop(CUT, "eDP-1", 1117, 1728, 2, { width: 3456, height: 2234, transform: 1 }) === 0)
check("another mode on the same connector: none", L.cutoutTop(CUT, "eDP-1", 1920, 1200, 1, { width: 1920, height: 1200, transform: 0 }) === 0)
check("a missing or broken file: no cutouts", L.parseCutouts("").length === 0 && L.parseCutouts("{").length === 0 && L.parseCutouts('{"panels":[{"connector":"","width":1,"height":1,"top":1},{"connector":"x","width":10,"height":10,"top":10}]}').length === 0)

// 2. the safe rect
const sr = l => [R(l.safe.x0), R(l.safe.x1), R(l.safe.y0), R(l.safe.y1)].join(" ")
check("box: safe rect x 65..5055, y 75..2095", sr(BOX) === "65 5055 75 2095", sr(BOX))
check("laptop: safe rect x 34..1694 (33.5..1694.5), y 49..1084", near(LAP.safe.x0, 33.5, 0.01) && near(LAP.safe.x1, 1694.5, 0.01) && R(LAP.safe.y0) === 49 && near(LAP.safe.y1, 1083.5, 0.01), sr(LAP))
check("the notch is respected with the bar hidden", R(L.plan(1728, 1117, [0, 0, 0, 0], 32).safe.y0) === 49 && R(L.plan(1728, 1117, [0, 0, 0, 0], 0).safe.y0) === 17)
check("a bar taller than the notch wins", R(L.plan(1728, 1117, [0, 40, 0, 0], 32).safe.y0) === 57)
check("a bottom bar and a side dock are kept clear too", (() => { const l = L.plan(1920, 1080, [60, 0, 0, 30], 0); return near(l.safe.x0, 60 + 32.4, 0.01) && near(l.safe.y1, 1080 - 30 - 32.4, 0.01) })())
check("no reserved answer yet: the margins alone", near(L.plan(1920, 1080, undefined, 0).safe.y0, 16.2, 0.01))

// 3. the zones' numbers (the design's table)
check("box: rail x 65..1037", R(BOX.rail.x) === 65 && R(BOX.rail.x + BOX.rail.w) === 1037)
check("laptop: rail x 34..536", near(LAP.rail.x, 33.5, 0.01) && R(LAP.rail.x + LAP.rail.w) === 536)
check("box: caption x 1280..3840", R(BOX.caption.x) === 1280 && R(BOX.caption.x + BOX.caption.w) === 3840)
check("laptop: caption x 558..1170, 611 px", near(LAP.caption.x, 558.5, 0.1) && near(LAP.caption.x + LAP.caption.w, 1169.5, 0.1) && R(LAP.caption.w) === 611, LAP.caption.w.toFixed(1))
check("box: story band x 1126..3994, y 1555", R(BOX.story.x) === 1126 && R(BOX.story.x + BOX.story.w) === 3994 && R(BOX.story.y) === 1555)
check("laptop: story band x 380..1348, y 804", R(LAP.story.x) === 380 && R(LAP.story.x + LAP.story.w) === 1348 && R(LAP.story.y) === 804)
check("rail and caption sit on the safe bottom", SCREENS.every(([, l]) => l.rail.bottom === l.safe.y1 && l.caption.bottom === l.safe.y1))

// 4. the HUD plan
const b0 = L.hudAt(BOX, [0, 0]), l0 = L.hudAt(LAP, [0, 0])
check("box: scale 1, readouts beside the ring", BOX.hud.s === 1 && BOX.hud.arr === "beside")
check("box: ring centre 3716, 1123, radius 540", R(b0.cx) === 3716 && R(b0.cy) === 1123 && R(b0.R) === 540, R(b0.cx) + " " + R(b0.cy))
check("box: readouts 518 px wide from x 4321", R(b0.stats.x) === 4321 && R(b0.stats.w) === 518, R(b0.stats.x) + " " + R(b0.stats.w))
check("laptop: scale 0.727, readouts under the ring", near(LAP.hud.s, 0.727, 0.001) && LAP.hud.arr === "under", LAP.hud.s.toFixed(4))
check("laptop: ring centre 1388, 350, radius 203", R(l0.cx) === 1388 && R(l0.cy) === 350 && R(l0.R) === 203, R(l0.cx) + " " + R(l0.cy) + " " + R(l0.R))
check("laptop: readouts 451 px wide, centred under the ring", R(l0.stats.w) === 451 && near(l0.stats.x + l0.stats.w / 2, l0.cx, 1e-6) && l0.stats.y > l0.cy + l0.R)
check("laptop: the drift shrinks with the ring: 81, 65 px", R(LAP.hud.driftX * 1117) === 81 && R(LAP.hud.driftY * 1117) === 65)
check("16:9: scale 0.836", near(HD.hud.s, 0.836, 0.001), HD.hud.s.toFixed(4))
const bx = L.hudExtent(BOX), lx = L.hudExtent(LAP)
check("box: the ring sweeps x 2960..4472, y 410..1836; readouts end at the safe edge", R(bx.ring.x) === 2960 && R(bx.ring.x + bx.ring.w) === 4472 && R(bx.ring.y) === 410 && R(bx.ring.y + bx.ring.h) === 1836 && near(bx.stats.x + bx.stats.w, BOX.safe.x1, 1e-6))
check("laptop: the ring sweeps x 1104..1672, y 82..618", R(lx.ring.x) === 1104 && R(lx.ring.x + lx.ring.w) === 1672 && R(lx.ring.y) === 82 && R(lx.ring.y + lx.ring.h) === 618, [lx.ring.x, lx.ring.x + lx.ring.w, lx.ring.y, lx.ring.y + lx.ring.h].map(R).join(" "))
check("laptop: at least 15 readout lines fit above the caption slot", lx.stats.h - (lx.stats.h - l0.stats.h) >= 15 * (LAP.tok.body * 1.4 + LAP.tok.row), (l0.stats.h / (LAP.tok.body * 1.4 + LAP.tok.row)).toFixed(1) + " lines")
check("the arrangement flips at aspect 2.0", L.plan(2160, 1080, [0, 0, 0, 0], 0).hud.arr === "beside" && L.plan(2159, 1080, [0, 0, 0, 0], 0).hud.arr === "under" && L.plan(3440, 1440, [0, 0, 0, 0], 0).hud.arr === "beside" && L.plan(2560, 1440, [0, 0, 0, 0], 0).hud.arr === "under")
check("scale: 0.47 x aspect, within 0.6..1", L.plan(1000, 1000, [0, 0, 0, 0], 0).hud.s === 0.6 && near(L.plan(1920, 1200, [0, 0, 0, 0], 0).hud.s, 0.752, 0.001))
check("toPx: p units are screen heights from the centre", L.toPx(BOX, 0, 0).join() === "2560,1080" && L.toPx(BOX, 0.5, -0.5).join() === "3640,0")

// 5. disjoint by construction, over the whole drift range, on every screen
const MORE = [["2560x1440", L.plan(2560, 1440, [0, 26, 0, 0], 0)], ["3440x1440", L.plan(3440, 1440, [0, 26, 0, 0], 0)], ["3840x2160", L.plan(3840, 2160, [0, 40, 0, 0], 0)],
              ["1920x1200", L.plan(1920, 1200, [0, 26, 0, 0], 0)], ["5120x1440", L.plan(5120, 1440, [0, 26, 0, 0], 0)], ["1512x982 notch", L.plan(1512, 982, [0, 32, 0, 0], 32)],
              ["2160x1080", L.plan(2160, 1080, [0, 0, 0, 0], 0)], ["laptop, bar hidden", L.plan(1728, 1117, [0, 0, 0, 0], 32)]]
const EPS = 1e-6
const grow = (b, e) => ({ x: b.x + e, y: b.y + e, w: b.w - 2 * e, h: b.h - 2 * e })   // touching edges are not an overlap
for (const [name, lay] of SCREENS.concat(MORE)) {
  const safe = lay.safe
  // the rail as its whole column (it may grow to the top) and the caption at its tallest
  const rail = L.railRect(lay, safe.y1 - safe.y0), cap = L.captionRect(lay, lay.caption.maxH)
  let ok = !L.intersects(grow(rail, EPS), grow(cap, EPS)), inside = L.inSafe(grow(rail, EPS), safe) && L.inSafe(grow(cap, EPS), safe), ringIn = true, worst = ""
  const N = 24
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const d = [L.DRIFT_X * (2 * i / N - 1), L.DRIFT_Y * (2 * j / N - 1)]
    const h = L.hudAt(lay, d)
    const ring = { x: h.cx - h.R, y: h.cy - h.R, w: 2 * h.R, h: 2 * h.R }, stats = grow(h.stats, EPS)
    if (!L.inSafe(grow(ring, EPS), safe)) { ringIn = false; worst = "ring " + d }
    if (!L.inSafe(stats, safe)) { inside = false; worst = "stats " + d }
    for (const zone of [rail, cap]) for (const part of [grow(ring, EPS), stats]) if (L.intersects(part, grow(zone, EPS))) { ok = false; worst = "overlap " + d }
    // the readouts never run onto the ring
    if (L.hits(stats, { cx: h.cx, cy: h.cy, r: h.R - EPS })) { ok = false; worst = "stats on ring " + d }
  }
  check(name + ": rail, caption and HUD pairwise disjoint over the whole drift", ok, worst || undefined)
  check(name + ": every zone inside the safe rect", inside, worst || undefined)
  check(name + ": the ring never leaves the safe rect", ringIn, worst || undefined)
  const ext = L.hudExtent(lay)
  check(name + ": the swept extent is disjoint from the rail and the caption too", [ext.ring, ext.stats].every(p => !L.intersects(grow(p, EPS), grow(rail, EPS)) && !L.intersects(grow(p, EPS), grow(cap, EPS))))
  check(name + ": the story band is inside the safe rect", lay.story.x >= safe.x0 && lay.story.x + lay.story.w <= safe.x1 && lay.story.y > safe.y0)
}
// who the story caption touches (rule 2), with the caption about 0.14 H tall
const storyB = L.storyRect(BOX, 0.14 * 2160), storyL = L.storyRect(LAP, 0.14 * 1117)
check("box: the story caption touches the ring's lower left, so the cockpit yields", L.intersects(storyB, bx.ring))
check("laptop: it touches the readouts under the ring", L.intersects(storyL, lx.stats))
check("laptop: a full rail (410 px) reaches it; a tour's four key rows do not", L.intersects(storyL, L.railRect(LAP, 410)) && !L.intersects(storyL, L.railRect(LAP, 4 * (LAP.tok.label * 1.4 + LAP.tok.row))))
check("box: neither rail touches it", !L.intersects(storyB, L.railRect(BOX, 800)))

// 6. tokens: nothing under 10 px, the box's sizes as they were
check("laptop: no text under 10 px", [LAP.tok.micro, LAP.tok.label, LAP.tok.body, LAP.tok.title].join() === "10,11,12,13")
check("box: 16, 18, 23, 24 px", [BOX.tok.micro, BOX.tok.label, BOX.tok.body, BOX.tok.title].join() === "16,18,23,24")
check("the clock shrinks with the HUD: 56 px on the box, 21 on the laptop", BOX.tok.display === 56 && LAP.tok.display === 21, BOX.tok.display + " " + LAP.tok.display)
check("offsets: at least 8 px", LAP.tok.gap === 8 && BOX.tok.gap === 15)

// 7. beacon labels: radially outward, never on the ring
for (const [name, lay] of SCREENS) {
  let onRing = 0, wrongHide = 0, shown = 0, n = 0
  for (const d of [[0, 0], [-L.DRIFT_X, -L.DRIFT_Y], [L.DRIFT_X, L.DRIFT_Y], [L.DRIFT_X, -L.DRIFT_Y]]) {
    const h = L.hudAt(lay, d), rl = h.R * (L.BEACON / L.RING) + lay.tok.gap
    for (const [w, hh] of [[60, 14], [180, 16], [330, 22]]) for (let a = 0; a < 360; a++) for (const shift of [0, 1, 2]) {
      const ang = a * Math.PI / 180
      const at = L.beaconLabel(ang, w, hh, h.cx, h.cy, rl, lay.safe, h.stats, shift)
      const box = { x: at.x, y: at.y, w: w, h: hh }
      n++
      if (L.hits(box, { cx: h.cx, cy: h.cy, r: rl - 1e-6 })) onRing++
      const must = L.inSafe(box, lay.safe) && !L.intersects(box, h.stats)
      if (at.show !== must) wrongHide++
      if (at.show) shown++
    }
  }
  check(name + ": no beacon label ever touches the ring disc (360 angles, 3 sizes, stacked)", onRing === 0, n + " boxes")
  check(name + ": words hide exactly when the box leaves the safe rect or touches the readouts", wrongHide === 0, shown + " of " + n + " shown")
}
const lb = L.hudAt(LAP, [0, 0]), rlb = lb.R * (L.BEACON / L.RING) + LAP.tok.gap
const west = L.beaconLabel(Math.PI, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, lb.stats, 0)
check("laptop: a beacon to the left reads outside the ring, to its left (ANDROMEDA no longer on the rings)", west.show && near(west.x + 130, lb.cx - rlb, 1e-6))
check("laptop: one pointing down fits between the ring and the readouts; a second one stacked under it would run into them and hides",
  L.beaconLabel(Math.PI / 2, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, lb.stats, 0).show && !L.beaconLabel(Math.PI / 2, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, lb.stats, 1).show)
const bb = L.hudAt(BOX, [0, 0]), rbb = bb.R * (L.BEACON / L.RING) + BOX.tok.gap
check("box: one pointing right hides its words in the readouts, one pointing left shows", !L.beaconLabel(0, 300, 20, bb.cx, bb.cy, rbb, BOX.safe, bb.stats, 0).show && L.beaconLabel(Math.PI, 300, 20, bb.cx, bb.cy, rbb, BOX.safe, bb.stats, 0).show)
const s0 = L.beaconLabel(2.8, 200, 20, bb.cx, bb.cy, rbb, BOX.safe, bb.stats, 0), s1 = L.beaconLabel(2.9, 200, 20, bb.cx, bb.cy, rbb, BOX.safe, bb.stats, 1)
check("beacons pointing the same way stack without overlap", !L.intersects({ x: s0.x, y: s0.y, w: 200, h: 20 }, { x: s1.x, y: s1.y, w: 200, h: 20 }))

// 8. edge markers: inside the safe rect, out of the rail and the caption
const keepL = [L.railRect(LAP, 410), L.captionRect(LAP, 60)]
let mkOk = true, offOk = true
for (let i = 0; i < 4000; i++) {
  const x = (rnd() * 3 - 1) * 1728, y = (rnd() * 3 - 1) * 1117
  const m = L.clampMarker(x, y, LAP.safe, keepL)
  if (m.x < LAP.safe.x0 || m.x > LAP.safe.x1 || m.y < LAP.safe.y0 || m.y > LAP.safe.y1) mkOk = false
  if (keepL.some(k => m.x > k.x && m.x < k.x + k.w && m.y > k.y && m.y < k.y + k.h)) mkOk = false
  if (m.off !== (x < LAP.safe.x0 || x > LAP.safe.x1 || y < LAP.safe.y0 || y > LAP.safe.y1)) offOk = false
}
check("4000 bodies anywhere: the marker is in the safe rect and never in the rail or the caption", mkOk)
check("off: exactly when the body is outside the safe rect", offOk)
const mIn = L.clampMarker(900, 300, LAP.safe, keepL)
check("a body in the open is its own marker", mIn.x === 900 && mIn.y === 300 && !mIn.off)
const mTop = L.clampMarker(900, 5, LAP.safe, keepL)
check("a body under the notch: the marker stops at the safe top", near(mTop.y, LAP.safe.y0, 1e-9) && mTop.off)

// 9. the label pass, on random scenes
const scene = n => {
  const items = []
  for (let i = 0; i < n; i++) {
    const w = 40 + rnd() * 220, pin = i === 0
    items.push({ id: "i" + i, x: rnd() * 1728, y: rnd() * 1117, r: 8 + rnd() * 20, w: w, h: 14, pin: pin })
  }
  return items
}
const hL = L.hudAt(LAP, [0.03, -0.02])
const OBST = [L.railRect(LAP, 410), L.captionRect(LAP, 60), { cx: hL.cx, cy: hL.cy, r: hL.R }, { x: hL.stats.x, y: hL.stats.y, w: hL.stats.w, h: 180 }]
let overlap = 0, onObst = 0, outside = 0, pinHidden = 0, prioBroken = 0, shownN = 0, hiddenN = 0
for (let k = 0; k < 400; k++) {
  const items = scene(3 + Math.floor(rnd() * 40))
  const res = L.placeLabels(items, OBST, LAP.safe, {})
  const boxes = items.map((it, i) => res[i].show ? L.labelBoxAt(it, res[i].side) : null)
  for (let i = 0; i < items.length; i++) {
    if (!boxes[i]) { hiddenN++; if (items[i].pin) pinHidden++; continue }
    shownN++
    for (let j = 0; j < i; j++) if (boxes[j] && L.intersects(boxes[i], boxes[j]) && !items[i].pin) overlap++
    if (items[i].pin) continue
    if (OBST.some(o => L.hits(boxes[i], o))) onObst++
    if (!L.inSafe(boxes[i], LAP.safe)) outside++
  }
  // priority: a hidden item must be blocked by the zones or by something placed BEFORE it,
  // never only by a later one: placing the first i items alone gives the same answer for them
  const cut = Math.floor(items.length / 2)
  const head = L.placeLabels(items.slice(0, cut), OBST, LAP.safe, {})
  for (let i = 0; i < cut; i++) if (head[i].show !== res[i].show || head[i].side !== res[i].side) prioBroken++
}
check("400 random scenes: no two shown names overlap", overlap === 0, shownN + " shown, " + hiddenN + " hidden")
check("none touches the rail, the caption, the ring or the readouts", onObst === 0)
check("none leaves the safe rect (bar and notch included)", outside === 0)
check("the hovered or selected one always shows", pinHidden === 0)
check("higher priority always wins: later items never change earlier ones", prioBroken === 0)
// sides: right first, then left, then hidden; and a side is kept while it is free
const one = (x, y, extra) => Object.assign({ id: "a", x: x, y: y, r: 10, w: 100, h: 14, pin: false }, extra || {})
check("in the open: to the right", (() => { const r = L.placeLabels([one(800, 500)], [], LAP.safe, {})[0]; return r.show && r.side === 1 })())
check("at the right edge: to the left", (() => { const r = L.placeLabels([one(1650, 500)], [], LAP.safe, {})[0]; return r.show && r.side === -1 })())
check("boxed in on both sides: the words hide", !L.placeLabels([one(800, 500)], [{ x: 805, y: 480, w: 60, h: 40 }, { x: 700, y: 480, w: 95, h: 40 }], LAP.safe, {})[0].show)
check("under the bar or the notch: hidden", !L.placeLabels([one(800, 40)], [], LAP.safe, {})[0].show)
check("pinned and boxed in: shown all the same", L.placeLabels([one(800, 500, { pin: true })], [{ x: 805, y: 480, w: 60, h: 40 }, { x: 700, y: 480, w: 95, h: 40 }], LAP.safe, {})[0].show)
check("pinned at the right edge: on the side that is on screen", L.placeLabels([one(1650, 500, { pin: true })], [{ x: 0, y: 0, w: 1728, h: 1117 }], LAP.safe, {})[0].side === -1)
const sides = {}
const blockR = [{ x: 815, y: 490, w: 50, h: 20 }]
let r1 = L.placeLabels([one(800, 500)], blockR, LAP.safe, sides)[0]
check("right is taken: left, and remembered", r1.side === -1 && sides.a === -1)
let kept = true
for (let i = 0; i < 200; i++) { const r = L.placeLabels([one(800 + (rnd() - 0.5) * 2, 500 + (rnd() - 0.5) * 2)], [], LAP.safe, sides)[0]; if (!r.show || r.side !== -1) kept = false }
check("the obstacle leaves and the point jitters by a pixel: the name keeps its side", kept)
r1 = L.placeLabels([one(800, 500)], [{ x: 690, y: 490, w: 50, h: 20 }], LAP.safe, sides)[0]
check("its side is taken: it moves over, once", r1.show && r1.side === 1 && sides.a === 1)
// a scene name next to the HUD: the ring and the readouts are obstacles like any other
const byRing = L.placeLabels([{ id: "p", x: hL.cx - hL.R - 30, y: hL.cy, r: 10, w: 120, h: 14, pin: false }], OBST, LAP.safe, {})[0]
check("a planet just left of the ring: its name goes left, off the rings", byRing.show && byRing.side === -1)
check("a place on the clock: no words there", !L.placeLabels([{ id: "p", x: hL.cx, y: hL.cy, r: 10, w: 120, h: 14, pin: false }], OBST, LAP.safe, {})[0].show)
check("textW grows with the letters and their spacing", L.textW(10, 10, 0) < L.textW(10, 10, 0.11) && L.textW(10, 10, 0.11) < L.textW(11, 10, 0.11))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
