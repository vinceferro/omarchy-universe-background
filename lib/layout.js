.pragma library
// layout.js — where the wallpaper's text may go on one screen. Plain JS,
// checked by tests/test_layout.js; Background.qml gives it the screen and
// reads every zone from the answer, and the shader's HUD rings read the same
// plan, so the rings and the text on them cannot disagree.
//
// Lengths are logical pixels with the origin at the screen's top left, as QML
// has them, except the HUD's, which are the shader's own `p` units: screen
// heights from the centre, x to the right and y down (toPx converts).
//
//   safe     the rect nothing leaves: the screen less Hyprland's reserved
//            bands (the bar) and a margin; its top also clears a camera notch
//            across the whole width, bar or no bar
//   rail     bottom left, grows upward: the place card over the key hints
//   caption  bottom centre, grows upward: the mode caption, or the toast
//   story    the lower third: the film (and tour) caption
//   hud      the cockpit: rings, clock, beacons and readouts
// The rail, the caption slot and the HUD are disjoint by construction,
// wherever the HUD drifts; scene labels take what is left (placeLabels).

const EDGE = 0.03            // margin inside the reserved bands, screen heights
const TOP_GAP = 0.015        // and under the bar or the notch
const RING = 0.25            // the HUD's radius at scale 1: universe.frag's cutoff
const BRACKET = 0.232        // its outermost line
const BEACON = 0.248         // where the beacons ride
const DRIFT_X = 0.10         // how far the HUD centre moves from its anchor: the
const DRIFT_Y = 0.08         //   slow drift (0.06, 0.04) plus the pointer's lean (0.04)
const WIDE = 2.0             // from this aspect on the readouts sit beside the ring
const STATS_W = 0.24         // beside: the readout column's width
const STATS_GAP = 0.03       // and its distance from the ring

// ---- type: every size the text uses, from the screen's height -------------
// Nothing is under 10 px (the laptop's 1117 px gave 8 before); letter spacing
// is in em (track), so it scales with the size it belongs to.
function tokens(H, s) {
  const px = (min, f) => Math.max(min, Math.round(H * f))
  return {
    micro: px(10, 0.0075),     // caption detail, beacon and galactic names
    label: px(11, 0.0085),     // names, markers, hints, caption titles
    body: px(12, 0.0105),      // readout rows
    title: px(13, 0.011),      // the card's name
    display: Math.round(H * 0.026 * (s || 1)),   // the clock, with the HUD's scale
    glyph: Math.round(H * 0.02),                 // the heading chevron
    filmTitle: Math.round(H * 0.026), filmBody: Math.round(H * 0.0185),   // sized for a phone or a 1080p player
    filmTrack: Math.round(H * 0.007),
    gap: Math.max(8, Math.round(H * 0.007)),     // a name's distance from its dot
    row: Math.max(2, Math.round(H * 0.004)),     // between rows of one block
    track: { tight: 0.05, normal: 0.11, wide: 0.17, title: 0.30 }
  }
}
// a line of text's width before it is laid out: what the label pass works with
function textW(chars, px, em) { return chars * px * (0.62 + (em || 0)) + 6 }

// ---- the plan for one screen ------------------------------------------------
// reserved: Hyprland's [left, top, right, bottom]; cutoutTop: the notch's
// height in logical pixels (0: none).
function plan(W, H, reserved, cutoutTop) {
  const r = reserved && reserved.length === 4 ? reserved : [0, 0, 0, 0]
  const safe = {
    x0: Number(r[0]) + EDGE * H,
    y0: Math.max(Number(r[1]), Number(cutoutTop) || 0) + TOP_GAP * H,
    x1: W - Number(r[2]) - EDGE * H,
    y1: H - Number(r[3]) - EDGE * H
  }
  const aspect = W / H
  const s = aspect >= WIDE ? 1 : Math.max(0.6, Math.min(1, 0.47 * aspect))
  const tok = tokens(H, s)

  const rail = { x: safe.x0, w: Math.min(0.30 * W, 0.45 * H), bottom: safe.y1 }
  const capW = Math.max(0, Math.min(2 * (W / 2 - (rail.x + rail.w) - 0.02 * H), 0.5 * W))
  // the tallest a caption gets: a title and four lines of detail
  const capH = 1.4 * tok.label + 4 * 1.4 * tok.micro + 3 * tok.row
  const caption = { x: W / 2 - capW / 2, w: capW, bottom: safe.y1, maxH: capH }
  const story = { x: 0.22 * W, y: 0.72 * H, w: 0.56 * W }

  // the HUD, in p units. Wide: where it always was (right of centre), moved
  // left only as far as the readout column needs. Narrow: smaller, in the top
  // right corner, the readouts under it down to the caption slot.
  const sr = (safe.x1 - W / 2) / H, st = safe.y0 / H - 0.5, sb = safe.y1 / H - 0.5
  const R = RING * s, dx = DRIFT_X * s, dy = DRIFT_Y * s
  const capTop = (caption.bottom - caption.maxH) / H - 0.5
  let hud
  if (aspect >= WIDE) {
    const ax = Math.min(0.57, sr - STATS_W - STATS_GAP - R - dx), ay = 0.02
    // the column is centred on the ring; on a very wide screen it can stand
    // over the caption slot's right end, and then stops above it
    const over = (ax - dx + R + STATS_GAP) * H < caption.x + caption.w - W / 2
    hud = { arr: "beside", ax: ax, ay: ay,
            stats: { dx: R + STATS_GAP, dy: 0, w: STATS_W, maxH: 2 * Math.min(ay - dy - st, (over ? capTop - 0.01 : sb) - ay - dy) } }
  } else {
    const ax = sr - 0.02 - R - dx, ay = st + 0.03 + R + dy
    hud = { arr: "under", ax: ax, ay: ay,
            stats: { dx: -(R + 0.02), dy: R + 0.02, w: 2 * R + 0.04, maxH: Math.max(0, capTop - 0.01 - (ay + dy + R + 0.02)) } }
  }
  hud.s = s; hud.R = R; hud.driftX = dx; hud.driftY = dy
  return { W: W, H: H, aspect: aspect, safe: safe, rail: rail, caption: caption, story: story, hud: hud, tok: tok }
}

// p units to pixels on this screen
function toPx(lay, px, py) { return [lay.W / 2 + px * lay.H, (py + 0.5) * lay.H] }

// The HUD where it is now, in pixels. drift: the root's slow drift and pointer
// lean, [x, y] within +-0.10 and +-0.08; it shrinks with the HUD's scale.
// stats is the readouts' rect at its tallest (the column is shorter and, beside
// the ring, centred in it).
function hudAt(lay, drift) {
  const h = lay.hud, H = lay.H
  const c = toPx(lay, h.ax + (drift ? drift[0] : 0) * h.s, h.ay + (drift ? drift[1] : 0) * h.s)
  return { cx: c[0], cy: c[1], R: h.R * H, s: h.s, arr: h.arr,
           stats: { x: c[0] + h.stats.dx * H, y: c[1] + (h.arr === "beside" ? -h.stats.maxH / 2 : h.stats.dy) * H,
                    w: h.stats.w * H, h: h.stats.maxH * H } }
}
// everything the HUD can cover over its whole drift: the ring's and the readouts' swept rects
function hudExtent(lay) {
  const a = hudAt(lay, [-DRIFT_X, -DRIFT_Y]), b = hudAt(lay, [DRIFT_X, DRIFT_Y])
  return {
    ring: { x: a.cx - a.R, y: a.cy - a.R, w: b.cx - a.cx + 2 * a.R, h: b.cy - a.cy + 2 * a.R },
    stats: { x: a.stats.x, y: a.stats.y, w: b.stats.x - a.stats.x + a.stats.w, h: b.stats.y - a.stats.y + a.stats.h }
  }
}
// the rail and the caption slot as rects, h pixels tall (they grow upward)
function railRect(lay, h) { return { x: lay.rail.x, y: lay.rail.bottom - h, w: lay.rail.w, h: h } }
function captionRect(lay, h) { return { x: lay.caption.x, y: lay.caption.bottom - h, w: lay.caption.w, h: h } }
function storyRect(lay, h) { return { x: lay.story.x, y: lay.story.y, w: lay.story.w, h: h } }

// ---- geometry ---------------------------------------------------------------
function intersects(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h }
function inSafe(b, safe) { return b.x >= safe.x0 && b.y >= safe.y0 && b.x + b.w <= safe.x1 && b.y + b.h <= safe.y1 }
function pointIn(x, y, b) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h }
// an obstacle is a rect { x, y, w, h } or a disc { cx, cy, r }
function hits(b, o) {
  if (o.r === undefined) return intersects(b, o)
  const nx = Math.max(b.x, Math.min(b.x + b.w, o.cx)), ny = Math.max(b.y, Math.min(b.y + b.h, o.cy))
  return Math.hypot(nx - o.cx, ny - o.cy) < o.r
}

// ---- beacon labels: radially outward, never on the ring ---------------------
// A beacon rides the ring at angle `ang` (screen, y down). Its words are a
// w x h box whose centre sits along that angle, as far out as it takes for
// every point of the box to be at least rLabel from the HUD centre (cx, cy):
// rLabel plus the box's half extent toward the centre. Beacons pointing the
// same way stack (shift rows), away from the centre line. The words hide,
// and the triangle stays, when the box would leave the safe rect or touch
// the readouts (which carry the same names and distances).
function beaconLabel(ang, w, h, cx, cy, rLabel, safe, stats, shift) {
  const c = Math.cos(ang), s = Math.sin(ang)
  const d = rLabel + (Math.abs(c) * w + Math.abs(s) * h) / 2
  const b = { x: cx + c * d - w / 2, y: cy + s * d - h / 2 + (shift || 0) * h * 1.3 * (s >= 0 ? 1 : -1), w: w, h: h }
  return { x: b.x, y: b.y, show: inSafe(b, safe) && !(stats && intersects(b, stats)) }
}

// ---- edge markers -----------------------------------------------------------
// A body's marker stays inside the safe rect (`off`: the body itself is
// outside it, so the marker is a dot on the edge pointing at it), and out of
// the rects in `keep` (the rail, the caption): pushed to the nearest of their
// edges that is still inside the safe rect.
function clampMarker(x, y, safe, keep) {
  const off = x < safe.x0 || x > safe.x1 || y < safe.y0 || y > safe.y1
  let mx = Math.max(safe.x0, Math.min(safe.x1, x)), my = Math.max(safe.y0, Math.min(safe.y1, y))
  for (const k of keep || []) {
    if (!(k.w > 0 && k.h > 0) || !pointIn(mx, my, k)) continue
    const ways = [[k.x - 1, my], [k.x + k.w + 1, my], [mx, k.y - 1], [mx, k.y + k.h + 1]]
      .filter(q => q[0] >= safe.x0 && q[0] <= safe.x1 && q[1] >= safe.y0 && q[1] <= safe.y1)
      .sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my))
    if (ways.length > 0) { mx = ways[0][0]; my = ways[0][1] }
  }
  return { x: mx, y: my, off: off }
}

// ---- scene labels: one pass per view ----------------------------------------
// items, most important first: { id, x, y, r, w, h, pin }. (x, y) is the
// thing named, r how far its name starts from it, w x h the name's box. A
// name goes to the right of its thing, else to the left, else it hides (its
// dot stays); it must lie inside the safe rect, clear of every obstacle and
// of every name placed before it. `sides` remembers the side each id had, so
// a name stays where it is while that side is free instead of flipping with
// every pixel of motion. A pinned item (hovered, selected) always shows: on
// its free side if it has one, else where it does least harm.
// Returns, per item: { show, side } with side 1 (right) or -1 (left).
function labelBoxAt(it, side) {
  return { x: side > 0 ? it.x + it.r : it.x - it.r - it.w, y: it.y - it.h / 2, w: it.w, h: it.h }
}
function placeLabels(items, obstacles, safe, sides) {
  const placed = [], out = []
  const free = b => inSafe(b, safe) && !obstacles.some(o => hits(b, o)) && !placed.some(o => intersects(b, o))
  for (const it of items) {
    const was = sides ? sides[it.id] : 0
    const order = was === -1 ? [-1, 1] : [1, -1]
    let side = 0
    for (const sd of order) if (free(labelBoxAt(it, sd))) { side = sd; break }
    if (side === 0 && it.pin) side = inSafe(labelBoxAt(it, order[0]), safe) || !inSafe(labelBoxAt(it, order[1]), safe) ? order[0] : order[1]
    if (side !== 0) { placed.push(labelBoxAt(it, side)); if (sides) sides[it.id] = side }
    out.push({ show: side !== 0, side: side || 1 })
  }
  return out
}

// ---- display cutouts ----------------------------------------------------------
// A camera notch is described by the platform's package, in
// /usr/share/omarchy-platform/display-cutouts.json (absent on most machines):
//   { "panels": [ { "connector": "eDP", "width": 3456, "height": 2234, "top": 64 } ] }
// width x height is the panel's physical mode and `top` the physical rows the
// notch covers; it has no width, so the whole top band is kept clear. Matched
// the way the bar does (BarModel.cutoutTop): the connector's name begins the
// screen's, the mode fits within 4 px, the panel is not turned.
function parseCutouts(text) {
  let parsed
  try { parsed = JSON.parse(String(text || "")) } catch (e) { return [] }
  const panels = parsed && Array.isArray(parsed.panels) ? parsed.panels : []
  const out = []
  for (const p of panels) {
    if (!p || typeof p.connector !== "string" || p.connector === "") continue
    const w = Number(p.width), h = Number(p.height), top = Number(p.top)
    if (!(w > 0) || !(h > 0) || !(top > 0) || top >= h) continue
    out.push({ connector: p.connector, width: w, height: h, top: top })
  }
  return out
}
// the notch's height on this screen in logical pixels, or 0. mode: the
// physical mode Hyprland reports ({ width, height, transform }), or null,
// when the logical size times dpr stands in for it.
function cutoutTop(cutouts, name, W, H, dpr, mode) {
  if (!(W > 0) || !(H > 0)) return 0
  let w = Number(mode && mode.width), h = Number(mode && mode.height)
  if (w > 0 && h > 0) {
    const tr = Number(mode.transform) || 0
    if (tr !== 0 && tr !== 4) return 0
    if ((w > h) !== (W > H)) return 0
  } else {
    const k = Number(dpr) > 0 ? Number(dpr) : 1
    w = Math.round(W * k); h = Math.round(H * k)
  }
  for (const p of Array.isArray(cutouts) ? cutouts : []) {
    if (String(name || "").indexOf(p.connector) !== 0) continue
    if (Math.abs(w - p.width) <= 4 && Math.abs(h - p.height) <= 4) return Math.ceil(p.top * W / w)
  }
  return 0
}
