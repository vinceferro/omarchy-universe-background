// checks for layout.js, the zones the wallpaper's text lives in (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const L = new Function(src + "\nreturn { EDGE, TOP_GAP, RING, BRACKET, BEACON, DRIFT_X, DRIFT_Y, WIDE, DIAL, SWEEP0, SWEEP, SWAY_MAX, tokens, textW, plan, toPx, hudCx, hudCy, hudAt, hudExtent, hudDisc, sweepAngle, dialPoint, swayPoint, gapSlots, hubLines, railRect, captionRect, storyRect, intersects, inSafe, pointIn, hits, beaconLabel, clampMarker, labelBoxAt, placeLabels, parseCutouts, cutoutTop };")()
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

// 4. the HUD plan: one disc, no column
const b0 = L.hudAt(BOX, [0, 0]), l0 = L.hudAt(LAP, [0, 0])
check("the plan has a disc and nothing else: no arrangement, no readout rect", BOX.hud.arr === undefined && BOX.hud.stats === undefined && b0.stats === undefined && L.hudExtent(BOX).ring === undefined)
check("box: scale 1, centre x 4061, y 1123, radius 540 (it was 3716)", BOX.hud.s === 1 && near(b0.cx, 4061, 1) && R(b0.cy) === 1123 && R(b0.R) === 540, b0.cx.toFixed(1) + " " + R(b0.cy))
check("box: the pad leaves room for a beacon's name beside the rim: 238 px", near(BOX.safe.x1 - (b0.cx + b0.R + BOX.hud.driftX * 2160), 0.11 * 2160, 1e-6) && BOX.hud.pad === 0.11)
check("laptop: scale 0.727, centre 1388, 350, radius 203 (unchanged)", near(LAP.hud.s, 0.727, 0.001) && R(l0.cx) === 1388 && R(l0.cy) === 350 && R(l0.R) === 203, R(l0.cx) + " " + R(l0.cy) + " " + R(l0.R))
check("laptop: the drift shrinks with the disc: 81, 65 px", R(LAP.hud.driftX * 1117) === 81 && R(LAP.hud.driftY * 1117) === 65)
check("16:9: scale 0.836, in the top right corner", near(HD.hud.s, 0.836, 0.001) && L.hudAt(HD, [0, 0]).cx > 1920 * 0.75 && L.hudAt(HD, [0, 0]).cy < 1080 * 0.4, HD.hud.s.toFixed(4))
const bx = L.hudExtent(BOX), lx = L.hudExtent(LAP)
check("box: the disc sweeps x 3305..4817, y 410..1836", near(bx.x, 3305, 1) && near(bx.x + bx.w, 4817, 1) && R(bx.y) === 410 && R(bx.y + bx.h) === 1836, [bx.x, bx.x + bx.w, bx.y, bx.y + bx.h].map(R).join(" "))
check("box: at rest the HUD is 1080 px wide, 21% of the screen, and 64% of the width is never touched", R(2 * b0.R) === 1080 && bx.x / 5120 > 0.64, (bx.x / 5120).toFixed(3))
check("laptop: the disc sweeps x 1104..1672, y 82..618", R(lx.x) === 1104 && R(lx.x + lx.w) === 1672 && R(lx.y) === 82 && R(lx.y + lx.h) === 618, [lx.x, lx.x + lx.w, lx.y, lx.y + lx.h].map(R).join(" "))
check("the anchor changes at aspect 2.0, the scale does not jump there", (() => { const a = L.plan(2160, 1080, [0, 0, 0, 0], 0), b = L.plan(2159, 1080, [0, 0, 0, 0], 0); return a.hud.ay === 0.02 && b.hud.ay < -0.1 && a.hud.s === 1 && b.hud.s > 0.93 })())
check("32:9: the disc stops at 0.80 screen heights right of centre", (() => { const l = L.plan(5120, 1440, [0, 26, 0, 0], 0); return l.hud.ax === 0.80 && R(L.hudAt(l, [0, 0]).cx) === 3712 })())
check("scale: 0.47 x aspect, within 0.6..1; a square or portrait screen gets 0.6", L.plan(1000, 1000, [0, 0, 0, 0], 0).hud.s === 0.6 && L.plan(1080, 1920, [0, 0, 0, 0], 0).hud.s === 0.6 && near(L.plan(1920, 1200, [0, 0, 0, 0], 0).hud.s, 0.752, 0.001))
check("toPx: p units are screen heights from the centre", L.toPx(BOX, 0, 0).join() === "2560,1080" && L.toPx(BOX, 0.5, -0.5).join() === "3640,0")
check("hudDisc: the disc as an obstacle, with a reach", (() => { const d = L.hudDisc(LAP, [0.03, -0.02], 8), h = L.hudAt(LAP, [0.03, -0.02]); return d.cx === h.cx && d.cy === h.cy && near(d.r, h.R + 8, 1e-9) && L.hudDisc(LAP, null).r === l0.R })())

// 5. disjoint by construction, over the whole drift range, on every screen
const MORE = [["2560x1440", L.plan(2560, 1440, [0, 26, 0, 0], 0)], ["3440x1440 (21:9)", L.plan(3440, 1440, [0, 26, 0, 0], 0)], ["3840x2160", L.plan(3840, 2160, [0, 40, 0, 0], 0)],
              ["1920x1200", L.plan(1920, 1200, [0, 26, 0, 0], 0)], ["5120x1440 (32:9)", L.plan(5120, 1440, [0, 26, 0, 0], 0)], ["1512x982 notch", L.plan(1512, 982, [0, 32, 0, 0], 32)],
              ["2160x1080", L.plan(2160, 1080, [0, 0, 0, 0], 0)], ["laptop, bar hidden", L.plan(1728, 1117, [0, 0, 0, 0], 32)], ["1600x1200 (4:3)", L.plan(1600, 1200, [0, 26, 0, 0], 0)]]
const PORTRAIT = L.plan(1080, 1920, [0, 26, 0, 0], 0)
const EPS = 1e-6
const grow = (b, e) => ({ x: b.x + e, y: b.y + e, w: b.w - 2 * e, h: b.h - 2 * e })   // touching edges are not an overlap
for (const [name, lay] of SCREENS.concat(MORE).concat([["1080x1920 (portrait)", PORTRAIT]])) {
  const safe = lay.safe, ext = L.hudExtent(lay)
  // the rail as its whole column (it may grow to the top) and the caption at
  // its tallest. On a portrait screen the disc is wider than what the rail
  // leaves beside it: there the rail has the height under the disc's reach
  const tall = lay.aspect < 1
  const rail = L.railRect(lay, tall ? safe.y1 - (ext.y + ext.h) : safe.y1 - safe.y0), cap = L.captionRect(lay, lay.caption.maxH)
  let ok = !L.intersects(grow(rail, EPS), grow(cap, EPS)), inside = L.inSafe(grow(rail, EPS), safe) && L.inSafe(grow(cap, EPS), safe), ringIn = true, worst = ""
  const N = 24
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const d = [L.DRIFT_X * (2 * i / N - 1), L.DRIFT_Y * (2 * j / N - 1)]
    const h = L.hudAt(lay, d)
    const ring = { x: h.cx - h.R, y: h.cy - h.R, w: 2 * h.R, h: 2 * h.R }
    if (!L.inSafe(grow(ring, EPS), safe)) { ringIn = false; worst = "disc " + d }
    for (const zone of [rail, cap]) if (L.intersects(grow(ring, EPS), grow(zone, EPS))) { ok = false; worst = "overlap " + d }
    if (!L.inSafe(grow(ring, EPS), { x0: ext.x, y0: ext.y, x1: ext.x + ext.w, y1: ext.y + ext.h })) { ok = false; worst = "outside its extent " + d }
  }
  check(name + ": rail, caption and HUD pairwise disjoint over the whole drift", ok, worst || undefined)
  check(name + ": every zone inside the safe rect", inside, worst || undefined)
  check(name + ": the disc never leaves the safe rect", ringIn, worst || undefined)
  check(name + ": the swept extent is disjoint from the rail and the caption too", !L.intersects(grow(ext, EPS), grow(rail, EPS)) && !L.intersects(grow(ext, EPS), grow(cap, EPS)))
  check(name + ": the story band is inside the safe rect", lay.story.x >= safe.x0 && lay.story.x + lay.story.w <= safe.x1 && lay.story.y > safe.y0)
  if (tall) check(name + ": the rail keeps more than half the screen's height under the disc", rail.h > 0.5 * lay.H, R(rail.h) + " px")
}
// who the story caption touches (rule 2), with the caption about 0.14 H tall
const storyB = L.storyRect(BOX, 0.14 * 2160), storyL = L.storyRect(LAP, 0.14 * 1117)
check("box: the story caption touches the disc's lower left reach, so the cockpit yields", L.intersects(storyB, bx))
check("laptop: the disc is clear of the story band: the cockpit stays through a film caption", !L.intersects(storyL, lx) && !L.intersects(L.storyRect(LAP, 0.25 * 1117), lx))
check("laptop: a full rail (410 px) reaches it; a tour's four key rows do not", L.intersects(storyL, L.railRect(LAP, 410)) && !L.intersects(storyL, L.railRect(LAP, 4 * (LAP.tok.label * 1.4 + LAP.tok.row))))
check("box: neither rail touches it", !L.intersects(storyB, L.railRect(BOX, 800)))

// 5b. on the disc: the sweep, the gap's words, the hub
const deg = Math.PI / 180
check("the sweep: 7:30 clockwise through 270 degrees to 4:30, 12 o'clock at g = 0.5", near(Math.sin(L.sweepAngle(0.5, 0)), -1, 1e-12) && near(L.sweepAngle(0, 0), 135 * deg, 1e-12) && near(L.sweepAngle(1, 0) - L.sweepAngle(0, 0), 270 * deg, 1e-12) && L.SWEEP0 === 225 && L.SWEEP === 270)
{
  const h = { cx: 1000, cy: 500, R: 250, s: 1 }
  const top = L.dialPoint(h, L.DIAL.RIM, 0.5, 0), pin = L.dialPoint(h, L.DIAL.RIM, 0, 0), end = L.dialPoint(h, L.DIAL.RIM, 1, 0)
  check("dialPoint: g = 0.5 on the rim is straight above the centre, 232 px up", near(top.x, 1000, 1e-9) && near(top.y, 500 - 232, 1e-9))
  check("dialPoint: the pin is at 7:30 (down left), the end at 4:30 (down right)", near(pin.x, 1000 - 232 * Math.SQRT1_2, 1e-9) && near(pin.y, 500 + 232 * Math.SQRT1_2, 1e-9) && near(end.x, 1000 + 232 * Math.SQRT1_2, 1e-9) && near(end.y, pin.y, 1e-9))
  const sw = L.dialPoint(h, L.DIAL.RIM, 0.5, 4 * deg)
  check("the sway turns it clockwise: 4 degrees moves the top of the rim 16 px to the right", near(sw.x - top.x, 232 * Math.sin(4 * deg), 1e-9) && sw.y > top.y && near(L.SWAY_MAX, 4 * deg, 1e-12))
  check("swayPoint: the disc's own frame, turned the same way", (() => { const a = L.swayPoint(h, 0, L.DIAL.RIM, 4 * deg), b = L.dialPoint(h, L.DIAL.RIM, 0.5, 4 * deg); return near(a.x - 1000, -(b.x - 1000), 1e-9) && near(a.y - 500, -(b.y - 500), 1e-9) })())
}
// the gap's words: inside the gap sector and the disc at every sway, clear of each other and of the window, wide enough
const SQ = L.plan(1200, 1200, [0, 0, 0, 0], 0)
for (const [name, lay, machine, units] of [["box (s 1)", BOX, "GPU 100% 278 W", "THRUST"], ["laptop (s 0.727)", LAP, "GPU 100%", "THRUST"], ["portrait (s 0.6)", PORTRAIT, "GPU 100%", "THRUST"], ["1200x1200 (s 0.6)", SQ, "GPU 100%", "THRUST"]]) {
  let inGap = true, inDisc = true, apart = true, worst = "", wMin = Infinity, uMin = Infinity
  for (const d of [[0, 0], [L.DRIFT_X, -L.DRIFT_Y]]) for (const swDeg of [-4, -2, 0, 2, 4]) {
    const h = L.hudAt(lay, d), sw = swDeg * deg, g = L.gapSlots(h, lay.tok, sw)
    const boxes = g.machine.concat(g.units)
    // a point is in the gap when its angle from the swayed 6 o'clock radius is under 45 degrees
    const off = (x, y) => { const a = Math.atan2(y - h.cy, x - h.cx) - (Math.PI / 2 + sw); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) }
    for (const b of boxes.concat([g.window])) for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      if (off(x, y) > 45 * deg + 1e-9) { inGap = false; worst = "sway " + swDeg }
      if (Math.hypot(x - h.cx, y - h.cy) > h.R + 1e-9) { inDisc = false; worst = "sway " + swDeg }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) if (L.intersects(grow(boxes[i], EPS), grow(boxes[j], EPS))) { apart = false; worst = "rows " + i + " " + j }
      if (L.intersects(grow(boxes[i], EPS), g.window)) { apart = false; worst = "window " + i }
    }
    wMin = Math.min(wMin, ...g.machine.map(b => b.w)); uMin = Math.min(uMin, ...g.units.map(b => b.w))
    if (g.machine.length !== 3 || g.units.length !== 2 || g.machine.some(b => b.h < lay.tok.micro * 1.15)) apart = false
  }
  check(name + ": the gap's words and its window lie inside the gap at sway -4..+4", inGap, worst || undefined)
  check(name + ": and inside the disc", inDisc, worst || undefined)
  check(name + ": three machine rows, two unit rows and the window: none overlaps another", apart, worst || undefined)
  check(name + ": the longest machine label (" + machine + ") and unit word fit their rows", L.textW(machine.length, lay.tok.micro, lay.tok.track.normal) <= wMin && L.textW(units.length, lay.tok.micro, lay.tok.track.normal) <= uMin,
    R(L.textW(machine.length, lay.tok.micro, lay.tok.track.normal)) + " in " + R(wMin) + ", " + R(L.textW(units.length, lay.tok.micro, lay.tok.track.normal)) + " in " + R(uMin))
}
check("the gap's rows keep their width whatever the sway (a word never reflows as the frame rocks)", (() => { const h = L.hudAt(LAP, [0, 0]); return [-4, 0, 3].every(d => L.gapSlots(h, LAP.tok, d * deg).machine[0].w === L.gapSlots(h, LAP.tok, 0).machine[0].w) })())
check("the machine rows are right-aligned 0.02 left of the 6 o'clock radius, centred on the GPU arc", (() => { const h = L.hudAt(BOX, [0, 0]), g = L.gapSlots(h, BOX.tok, 0); return near(g.machine[0].x + g.machine[0].w, h.cx - 0.02 * 2160, 1e-6) && near(g.units[0].x, h.cx + 0.02 * 2160, 1e-6) && near(g.machine[1].y + g.machine[1].h / 2, h.cy + L.DIAL.GPU * 2160, 1e-6) })())
check("the gap window: 0.024 wide, from 0.125 to 0.200 under the centre", (() => { const h = L.hudAt(BOX, [0, 0]), w = L.gapSlots(h, BOX.tok, 0).window; return near(w.w, 0.024 * 2160, 1e-6) && near(w.y - h.cy, 0.125 * 2160, 1e-6) && near(w.y + w.h - h.cy, 0.2 * 2160, 1e-6) && near(w.x + w.w / 2, h.cx, 1e-6) })())
// the hub: HH:mm, the date and an 11-character readout inside rho 0.31
for (const [name, lay] of [["box (s 1)", BOX], ["laptop (s 0.727)", LAP], ["portrait (s 0.6)", PORTRAIT], ["1200x1200 (s 0.6)", SQ]]) {
  const h = L.hudAt(lay, [0, 0]), hb = L.hubLines(h, lay.tok), t = lay.tok
  const lines = [hb.clock, hb.date, hb.readout]
  const corners = lines.every(l => [l.y, l.y + l.h].every(y => Math.hypot(l.maxW / 2, y) <= hb.r + 1e-6))
  check(name + ": the hub's three lines stack inside rho 0.31, each as wide as the circle leaves it", corners && near(hb.r, 0.31 * h.R, 0.5 / 1000 * h.R + 1) && near(hb.clock.y + (hb.clock.h + hb.date.h + hb.readout.h) / 2, 0, 1e-9) && hb.date.y === hb.clock.y + hb.clock.h && hb.readout.y === hb.date.y + hb.date.h)
  check(name + ": HH:mm, MON 16 NOV and an 11-character readout fit", L.textW(5, t.display, 0) <= hb.clock.maxW && L.textW(10, t.label, t.track.normal) <= hb.date.maxW && L.textW(11, t.micro, t.track.normal) <= hb.readout.maxW,
    [L.textW(5, t.display, 0), hb.clock.maxW, L.textW(10, t.label, t.track.normal), hb.date.maxW, L.textW(11, t.micro, t.track.normal), hb.readout.maxW].map(R).join(" "))
  check(name + ": the hub's type sizes are the tokens (display, label, micro)", hb.clock.px === t.display && hb.date.px === t.label && hb.readout.px === t.micro)
}

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
    // another name already standing left of the disc
    const avoid = [{ x: h.cx - rl - 200, y: h.cy - 10, w: 200, h: 20 }]
    for (const [w, hh] of [[60, 14], [180, 16], [330, 22]]) for (let a = 0; a < 360; a++) for (const shift of [0, 1, 2]) {
      const ang = a * Math.PI / 180
      const at = L.beaconLabel(ang, w, hh, h.cx, h.cy, rl, lay.safe, avoid, shift)
      const box = { x: at.x, y: at.y, w: w, h: hh }
      n++
      if (L.hits(box, { cx: h.cx, cy: h.cy, r: rl - 1e-6 })) onRing++
      const must = L.inSafe(box, lay.safe) && !L.intersects(box, avoid[0])
      if (at.show !== must) wrongHide++
      if (at.show) shown++
    }
  }
  check(name + ": no beacon label ever touches the disc (360 angles, 3 sizes, stacked)", onRing === 0, n + " boxes")
  check(name + ": words hide exactly when the box leaves the safe rect or touches a name already placed", wrongHide === 0, shown + " of " + n + " shown")
}
const lb = L.hudAt(LAP, [0, 0]), rlb = lb.R * (L.BEACON / L.RING) + LAP.tok.gap
const west = L.beaconLabel(Math.PI, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, [], 0)
check("laptop: a beacon to the left reads outside the disc, to its left", west.show && near(west.x + 130, lb.cx - rlb, 1e-6))
check("laptop: with the column gone, names pointing down show too, one stacked under another",
  L.beaconLabel(Math.PI / 2, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, [], 0).show && L.beaconLabel(Math.PI / 2, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, null, 1).show)
check("laptop: one pointing right has no room before the safe edge and hides (the bug still says how far)", !L.beaconLabel(0, 130, 12, lb.cx, lb.cy, rlb, LAP.safe, [], 0).show)
const bb = L.hudAt(BOX, [0, 0]), rbb = bb.R * (L.BEACON / L.RING) + BOX.tok.gap
check("box: a name pointing right fits in the pad at rest (220 px), and one pointing left always shows", L.beaconLabel(0, 220, 20, bb.cx, bb.cy, rbb, BOX.safe, [], 0).show && L.beaconLabel(Math.PI, 300, 20, bb.cx, bb.cy, rbb, BOX.safe, [], 0).show)
const s0 = L.beaconLabel(2.8, 200, 20, bb.cx, bb.cy, rbb, BOX.safe, [], 0), s1 = L.beaconLabel(2.9, 200, 20, bb.cx, bb.cy, rbb, BOX.safe, [], 1)
check("beacons pointing the same way stack without overlap", !L.intersects({ x: s0.x, y: s0.y, w: 200, h: 20 }, { x: s1.x, y: s1.y, w: 200, h: 20 }))
// a landmark label is placed the same way from its tick's angle, and gives way to a beacon's name
{
  const tick = L.dialPoint(bb, L.DIAL.RIM, 0.125, 0)
  const lm = L.beaconLabel(tick.ang, 40, 20, bb.cx, bb.cy, bb.R + BOX.tok.gap, BOX.safe, [], 0)
  const box = { x: lm.x, y: lm.y, w: 40, h: 20 }
  check("box: a landmark label stands just outside the rim on its tick's ray", lm.show && !L.hits(box, { cx: bb.cx, cy: bb.cy, r: bb.R }) && Math.hypot(lm.x + 20 - bb.cx, lm.y + 10 - bb.cy) < bb.R + BOX.tok.gap + 40
    && near(Math.atan2(lm.y + 10 - bb.cy, lm.x + 20 - bb.cx), Math.atan2(Math.sin(tick.ang), Math.cos(tick.ang)), 1e-9))
  check("a beacon's name on that spot wins it: the landmark label hides", !L.beaconLabel(tick.ang, 40, 20, bb.cx, bb.cy, bb.R + BOX.tok.gap, BOX.safe, [{ x: lm.x - 100, y: lm.y - 5, w: 150, h: 20 }], 0).show)
}

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
const mPad = L.clampMarker(5000, 5000, LAP.safe, keepL, 8)
check("with a pad the edge dot sits that far inside the corner", near(mPad.x, LAP.safe.x1 - 8, 1e-9) && near(mPad.y, LAP.safe.y1 - 8, 1e-9) && mPad.off && !L.clampMarker(LAP.safe.x1 - 2, 300, LAP.safe, keepL, 8).off)
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
const OBST = [L.railRect(LAP, 410), L.captionRect(LAP, 60), L.hudDisc(LAP, [0.03, -0.02])]
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
check("none touches the rail, the caption or the HUD's disc", onObst === 0)
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
// one side only (the heading's words, outward from the Sun): that side or hidden, whatever it had before
check("only left, in the open: left", (() => { const r = L.placeLabels([one(800, 500, { only: -1 })], [], LAP.safe, { a: 1 })[0]; return r.show && r.side === -1 })())
check("only left, left taken: hidden, not right", !L.placeLabels([one(800, 500, { only: -1 })], [{ x: 690, y: 490, w: 50, h: 20 }], LAP.safe, {})[0].show)
check("only right, right taken, remembered left: hidden", !L.placeLabels([one(800, 500, { only: 1 })], blockR, LAP.safe, { a: -1 })[0].show)
// the centre alone, as the bindings take it: the same place hudAt gives
{
  let off = 0
  for (const lay of [BOX, LAP]) for (const d of [[0, 0], [0.1, -0.08], [-0.037, 0.052]]) {
    const h = L.hudAt(lay, d), c = L.toPx(lay, lay.hud.ax + d[0] * lay.hud.s, lay.hud.ay + d[1] * lay.hud.s)
    const cx = L.hudCx(lay, d[0]), cy = L.hudCy(lay, d[1])
    off = Math.max(off, Math.abs(cx - h.cx), Math.abs(cy - h.cy), Math.abs(cx - c[0]), Math.abs(cy - c[1]))
  }
  check("hudCx / hudCy: hudAt's centre", off < 1e-9, off)
}
// a scene name next to the HUD: the disc is an obstacle like any other
const byRing = L.placeLabels([{ id: "p", x: hL.cx - hL.R - 30, y: hL.cy, r: 10, w: 120, h: 14, pin: false }], OBST, LAP.safe, {})[0]
check("a planet just left of the ring: its name goes left, off the rings", byRing.show && byRing.side === -1)
check("a place on the clock: no words there", !L.placeLabels([{ id: "p", x: hL.cx, y: hL.cy, r: 10, w: 120, h: 14, pin: false }], OBST, LAP.safe, {})[0].show)
check("textW grows with the letters and their spacing", L.textW(10, 10, 0) < L.textW(10, 10, 0.11) && L.textW(10, 10, 0.11) < L.textW(11, 10, 0.11))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
