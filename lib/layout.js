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
//   hud      the cockpit: one disc (rings, clock, the words in its gap) and
//            the beacons on its rim. It owns a radius, never a rect
// The rail, the caption slot and the HUD are disjoint by construction,
// wherever the HUD drifts; scene labels take what is left (placeLabels).

const EDGE = 0.03            // margin inside the reserved bands, screen heights
const TOP_GAP = 0.015        // and under the bar or the notch
const RING = 0.25            // the HUD's radius at scale 1: universe.frag's cutoff
const BRACKET = 0.232        // its outermost line
const BEACON = 0.248         // where the beacons ride
const DRIFT_X = 0.10         // how far the HUD centre moves from its anchor: the
const DRIFT_Y = 0.08         //   slow drift (0.06, 0.04) plus the pointer's lean (0.04)
const WIDE = 2.0             // from this aspect on the disc is right of centre, vertically centred
const PAD_WIDE = 0.11        // room for a beacon's name beside the rim, wide
const PAD_NARROW = 0.02      //   and narrow (there the names mostly hide)
const AX_MAX = 0.80          // a very wide screen: the disc stays within a glance of the centre

// The instrument's radii, in the HUD's own units (q: screen heights at scale
// 1), from the centre out: TIME, MACHINE, FLIGHT, WORLD. universe.frag's
// hud() has the same numbers as D_* constants (tests/test_layout.js compares
// them), so the words QML pins to a ring cannot miss it.
const DIAL = {
  HUB: 0.078,                  // the clock, the date and the readout line live inside this
  SECONDS: 0.085,              // the seconds ring
  DAY0: 0.100, DAY1: 0.112,    // the day ring: ticks from DAY0, the daylight arc up to DAY1
  CPU: 0.136, GPU: 0.154, MEM: 0.172,
  RANGE: 0.190, RANGE_TICK: 0.197, BUG_TIP: 0.192, BUG_BASE: 0.203,
  NEEDLE0: 0.206, TICK0: 0.212, TICK_MINOR: 0.217, TICK_MAJOR: 0.222, TICK_LONG: 0.228, RIM: 0.232,
  GAP0: 0.125, GAP1: 0.200, GAP_W: 0.024,   // the gap window, on the 6 o'clock radius
  GAP_TEXT: 0.020              // the gap's words start this far either side of that radius
}
const SWEEP0 = 225           // the gauges' sweep: from 7:30 (degrees clockwise from 12 o'clock) ...
const SWEEP = 270            //   ... through 270 degrees to 4:30; the gap is the other 90
const SWAY_MAX = 4 * Math.PI / 180   // the frame's slow rocking (hudSway), radians either way

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

  // the HUD, in p units: a disc. Wide: right of centre, vertically centred,
  // as far right as a beacon's name beside the rim allows. Narrow: smaller,
  // in the top right corner. Aspect picks the scale and the anchor, nothing
  // reflows: the HUD owns a radius, never a rect.
  const sr = (safe.x1 - W / 2) / H, st = safe.y0 / H - 0.5
  const R = RING * s, dx = DRIFT_X * s, dy = DRIFT_Y * s
  const wide = aspect >= WIDE, pad = wide ? PAD_WIDE : PAD_NARROW
  const hud = wide ? { ax: Math.min(AX_MAX, sr - R - dx - pad), ay: 0.02 }
                   : { ax: sr - pad - R - dx, ay: st + 0.03 + R + dy }
  hud.s = s; hud.R = R; hud.driftX = dx; hud.driftY = dy; hud.pad = pad
  return { W: W, H: H, aspect: aspect, safe: safe, rail: rail, caption: caption, story: story, hud: hud, tok: tok }
}

// p units to pixels on this screen
function toPx(lay, px, py) { return [lay.W / 2 + px * lay.H, (py + 0.5) * lay.H] }

// The HUD's centre now, in pixels, from one axis of the drift: all that moves
// each frame, so the bindings that follow it take these two numbers.
function hudCx(lay, driftX) { return lay.W / 2 + (lay.hud.ax + (driftX || 0) * lay.hud.s) * lay.H }
function hudCy(lay, driftY) { return (lay.hud.ay + (driftY || 0) * lay.hud.s + 0.5) * lay.H }
// The HUD where it is now, in pixels. drift: the root's slow drift and pointer
// lean, [x, y] within +-0.10 and +-0.08; it shrinks with the HUD's scale.
function hudAt(lay, drift) {
  return { cx: hudCx(lay, drift ? drift[0] : 0), cy: hudCy(lay, drift ? drift[1] : 0), R: lay.hud.R * lay.H, s: lay.hud.s }
}
// everything the HUD can cover over its whole drift: the disc's swept rect
function hudExtent(lay) {
  const a = hudAt(lay, [-DRIFT_X, -DRIFT_Y]), b = hudAt(lay, [DRIFT_X, DRIFT_Y])
  return { x: a.cx - a.R, y: a.cy - a.R, w: b.cx - a.cx + 2 * a.R, h: b.cy - a.cy + 2 * a.R }
}
// the disc as an obstacle for the label pass (placeLabels takes discs);
// reach: pixels added to its radius
function hudDisc(lay, drift, reach) {
  const h = hudAt(lay, drift)
  return { cx: h.cx, cy: h.cy, r: h.R + (reach || 0) }
}

// ---- on the disc ------------------------------------------------------------
// A position on the gauges' sweep is g in 0..1 (7:30 clockwise to 4:30); the
// whole frame rocks by `sway` radians (clockwise positive), the shader's
// hudSway. sweepAngle: the screen angle (radians, x right, y down, as
// Math.atan2 has it) of g. dialPoint: the pixel of a point at radius q
// (HUD units) on that ray; h is hudAt()'s answer.
function sweepAngle(g, sway) { return (SWEEP0 + SWEEP * g - 90) * Math.PI / 180 + (sway || 0) }
function dialPoint(h, q, g, sway) {
  const a = sweepAngle(g, sway), r = q / RING * h.R
  return { x: h.cx + Math.cos(a) * r, y: h.cy + Math.sin(a) * r, ang: a }
}
// a point given in the disc's own frame (HUD units, x right, y down), turned
// with the sway: pixels
function swayPoint(h, qx, qy, sway) {
  const c = Math.cos(sway || 0), s = Math.sin(sway || 0), k = h.R / RING
  return { x: h.cx + (qx * c - qy * s) * k, y: h.cy + (qx * s + qy * c) * k }
}
// The words in the gap (the 90 degrees the gauges leave open at 6 o'clock)
// and the gap window between them. They turn with the sway by position, not
// orientation: every box stays level. Returns pixel rects:
//   machine  three rows (CPU, GPU, MEM), left of the window, right-aligned
//            at the box's right edge, centred on the GPU arc's radius
//   units    two rows (the range scale's unit over the dial's), right of
//            it, left-aligned
//   window   the gap window's box (the diamond's scale, or the Moon)
// Each row is as wide as the gap leaves it at any sway within SWAY_MAX, so a
// string that fits a row fits it wherever the frame has rocked to.
function gapSlots(h, tok, sway) {
  const k = h.R / RING, sw = sway || 0
  const pitch = Math.round(tok.micro * 1.2)
  const yq = DIAL.GPU                      // the rows' centre line, HUD units down from the centre
  // how wide a block of n rows may be: its outer corners stay inside the
  // gap (45 degrees either side of the swayed 6 o'clock radius) and inside
  // the disc, 2 px clear, at the sway's two ends and in the middle. Worked
  // for the left block; the right one is its mirror image at the opposite sway
  const rowsW = (n) => {
    let w = Infinity
    for (const sg of [-SWAY_MAX, 0, SWAY_MAX]) {
      const c = Math.cos(sg), sn = Math.sin(sg)
      const ax = (-DIAL.GAP_TEXT * c - yq * sn) * k, ay = (-DIAL.GAP_TEXT * sn + yq * c) * k   // the anchor, turned
      const top = ay - n * pitch / 2, bot = ay + n * pitch / 2
      const toGap = ax + (top * (c + sn) - 2) / (c - sn)
      const toRim = ax + Math.sqrt(Math.max(0, (h.R - 2) * (h.R - 2) - bot * bot))
      w = Math.min(w, toGap, toRim)
    }
    return Math.max(0, Math.floor(w))
  }
  const rows = (n, side) => {
    const w = rowsW(n), at = swayPoint(h, side * DIAL.GAP_TEXT, yq, sw), out = []
    for (let i = 0; i < n; i++) out.push({ x: side < 0 ? at.x - w : at.x, y: at.y + (i - n / 2) * pitch, w: w, h: pitch })
    return out
  }
  const wc = swayPoint(h, 0, (DIAL.GAP0 + DIAL.GAP1) / 2, sw), ww = DIAL.GAP_W * k, wh = (DIAL.GAP1 - DIAL.GAP0) * k
  return { machine: rows(3, -1), units: rows(2, 1), window: { x: wc.x - ww / 2, y: wc.y - wh / 2, w: ww, h: wh }, pitch: pitch }
}
// The hub: the clock, the date and the readout line, stacked and centred on
// the HUD's centre. Each line's top (pixels from the centre, y down), its
// height, its type size and the widest text the hub's circle leaves it.
function hubLines(h, tok) {
  const rh = DIAL.HUB / RING * h.R
  const hs = [Math.round(tok.display * 1.15), Math.round(tok.label * 1.35), Math.round(tok.micro * 1.35)]
  const px = [tok.display, tok.label, tok.micro]
  const total = hs[0] + hs[1] + hs[2]
  const out = []
  let y = -total / 2
  for (let i = 0; i < 3; i++) {
    const far = Math.max(Math.abs(y), Math.abs(y + hs[i]))
    out.push({ y: y, h: hs[i], px: px[i], maxW: 2 * Math.sqrt(Math.max(0, rh * rh - far * far)) })
    y += hs[i]
  }
  return { clock: out[0], date: out[1], readout: out[2], r: rh }
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
// one of the boxes in `avoid` (other names already placed: a beacon's name
// wins its spot over a landmark label). The dial's landmark labels are
// placed the same way, from the angle of their tick.
function beaconLabel(ang, w, h, cx, cy, rLabel, safe, avoid, shift) {
  const c = Math.cos(ang), s = Math.sin(ang)
  const d = rLabel + (Math.abs(c) * w + Math.abs(s) * h) / 2
  const b = { x: cx + c * d - w / 2, y: cy + s * d - h / 2 + (shift || 0) * h * 1.3 * (s >= 0 ? 1 : -1), w: w, h: h }
  return { x: b.x, y: b.y, show: inSafe(b, safe) && !(avoid || []).some(o => o && intersects(b, o)) }
}

// ---- edge markers -----------------------------------------------------------
// A body's marker stays inside the safe rect, `pad` in from its edge so the
// dot and its arrow do too (`off`: the body itself is outside the rect, so
// the marker is a dot at the edge pointing at it), and out of the rects in
// `keep` (the rail, the caption): pushed to the nearest of their edges that
// is still inside.
function clampMarker(x, y, safe, keep, pad) {
  const off = x < safe.x0 || x > safe.x1 || y < safe.y0 || y > safe.y1
  const d = pad || 0, x0 = safe.x0 + d, x1 = safe.x1 - d, y0 = safe.y0 + d, y1 = safe.y1 - d
  let mx = off ? Math.max(x0, Math.min(x1, x)) : x, my = off ? Math.max(y0, Math.min(y1, y)) : y
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
// its free side if it has one, else where it does least harm. An item with
// `only` (1 or -1) has one side: words that point away from something (the
// heading's, outward from the Sun) go there or hide.
// Returns, per item: { show, side } with side 1 (right) or -1 (left).
function labelBoxAt(it, side) {
  return { x: side > 0 ? it.x + it.r : it.x - it.r - it.w, y: it.y - it.h / 2, w: it.w, h: it.h }
}
function placeLabels(items, obstacles, safe, sides) {
  const placed = [], out = []
  const free = b => inSafe(b, safe) && !obstacles.some(o => hits(b, o)) && !placed.some(o => intersects(b, o))
  for (const it of items) {
    const was = sides ? sides[it.id] : 0
    const order = it.only ? [it.only] : was === -1 ? [-1, 1] : [1, -1]
    let side = 0
    for (const sd of order) if (free(labelBoxAt(it, sd))) { side = sd; break }
    if (side === 0 && it.pin) side = order.length < 2 || inSafe(labelBoxAt(it, order[0]), safe) || !inSafe(labelBoxAt(it, order[1]), safe) ? order[0] : order[1]
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
