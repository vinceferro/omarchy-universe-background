.pragma library
// text.js — what text the wallpaper shows, and for how long. One setting, the
// text level, and one idle clock. Plain JS, checked by tests/test_text.js;
// Background.qml keeps the level, feeds the clock and multiplies every
// overlay by mix(group, zone).
//
// Every element belongs to one group, and a level is a set of groups:
//   off     nothing: the scene (a film, tour or fall caption and the level's own
//           toast are the only words that can appear)
//   names   what am I looking at: place and planet names, markers, the
//           card's head, a caption's title
//   full    names, plus the guide (the card's text, caption detail, key
//           hints) and the cockpit (the HUD's rings, clock, words, beacons)
// T cycles off, names, full; H (the cockpit key) goes between full and the
// last level below it. A hold (IPC textHold) is a temporary level for film
// and tours that is never saved, and film mode itself is `off`.
//
// The clock: every interaction touches it, and each zone then stays for as
// long as its words take to read (8 s, plus a second per 3.5 words, at most
// 40 s) and fades, so a parked view puts no standing text on the OLED. The
// one standing exception is the cockpit's rings, clock and date, which are
// dim and drift: they follow the level only (Background.qml).
//
// The cockpit's other words (the readout line, the labels in the disc's gap,
// landmark labels, beacon names) are the zone `dial`: up with the clock like
// any zone, and also by touches of its own that leave the rest of the text
// alone (touchZone): the pointer resting inside the disc (dwell), or an
// event worth a glance (a place passed, a horizon crossed), each for a few
// seconds. A quiet zone follows only its own touches: `sys`, the machine
// labels' own reason to show (a hot GPU, a full memory), and `units`, the
// unit words after a view change.

const LEVELS = ["off", "names", "full"]
const SHOWN = { off: [], names: ["names"], full: ["names", "guide", "cockpit"] }
const GROUPS = ["names", "guide", "cockpit"]
const HOLD_S = 8             // a zone stays this long after the last interaction
const WORDS_PER_S = 3.5      //   plus the time to read it
const HOLD_MAX_S = 40
const FADE_IN_S = 0.25       // a zone coming up with an interaction
const FADE_OUT_S = 0.8       //   and going after its hold
const LEVEL_S = 1.5          // a level change, film mode included
const TOAST_S = 1.5          // the level's name after a change
const DIAL_WORDS = 10        // the dial zone reads like ten words: about 11 s
const EVENT_S = 4            // an event holds its zone at least this long
const DWELL_S = 0.3          // the pointer rests this long inside the disc before the words come
const DWELL_HOLD_S = 2       //   and they stay this long after it leaves
const UNITS_S = 3            // the unit words after a view change

// ---- the level ----------------------------------------------------------------
function parseLevel(s) { const t = String(s === undefined || s === null ? "" : s).trim().toLowerCase(); return LEVELS.indexOf(t) >= 0 ? t : "" }
function next(level) { return LEVELS[(Math.max(0, LEVELS.indexOf(level)) + 1) % LEVELS.length] }
function prev(level) { return LEVELS[(Math.max(0, LEVELS.indexOf(level)) + LEVELS.length - 1) % LEVELS.length] }
// One change to the saved state { level, lower }, lower being the last level
// below full (what the cockpit key returns to). word: a level, "next",
// "prev" or "toggle"; anything else changes nothing (null).
function apply(st, word) {
  const w = String(word || "").trim().toLowerCase()
  const lower = parseLevel(st.lower) && st.lower !== "full" ? st.lower : "names"
  const to = w === "next" ? next(st.level) : w === "prev" ? prev(st.level)
           : w === "toggle" ? (st.level === "full" ? lower : "full") : parseLevel(w)
  if (to === "") return null
  return { level: to, lower: to !== "full" ? to : st.level !== "full" && parseLevel(st.level) ? st.level : lower }
}
// The level at startup. saved: the state file's text ("" when it is missing);
// hudHidden: the old hud-hidden flag exists. Before there was a level the
// names were always on and that flag hid the HUD, so each machine starts
// showing what it showed.
function migrate(saved, hudHidden) { return parseLevel(saved) || (hudHidden ? "names" : "full") }
// what is shown now: film is off, else a hold, else the saved level
function effective(saved, hold, film) { return film ? "off" : parseLevel(hold) || parseLevel(saved) || "off" }
function shows(level, group) { return group === "always" || (SHOWN[level] || []).indexOf(group) >= 0 }

// ---- the hold -------------------------------------------------------------------
function words(text) { const m = String(text || "").match(/[A-Za-z0-9][^\s]*/g); return m ? m.length : 0 }
function hold(nWords) { return Math.min(HOLD_MAX_S, HOLD_S + Math.max(0, nWords || 0) / WORDS_PER_S) }

// ---- the model: the clock, a gate per group, a presence per zone ------------------
// Gates and presences are kept as linear 0..1 ramps (so a fade takes its
// stated time at any frame rate) and read through one easing.
function create() {
  return { since: HOLD_MAX_S * 10, gate: { names: 0, guide: 0, cockpit: 0 }, zone: {}, own: {}, rest: 0, moving: false }
}
function touch(m) { m.since = 0 }
function wanted(m, nWords) { return m.since < hold(nWords) ? 1 : 0 }
// one zone alone, for at least `seconds` (EVENT_S when left out); the clock
// and the other zones are not touched
function touchZone(m, zone, seconds) { m.own[zone] = Math.max(m.own[zone] || 0, seconds === undefined ? EVENT_S : seconds) }
// the pointer: `inside` the disc or not, this step. Resting there DWELL_S
// brings the dial zone up and keeps it up; it stays DWELL_HOLD_S after
function dwell(m, inside, dt) {
  m.rest = inside ? m.rest + dt : 0
  if (m.rest >= DWELL_S) touchZone(m, "dial", DWELL_HOLD_S)
}
function ramp(x, goal, dt, upS, downS) {
  return goal > x ? Math.min(goal, x + dt / upS) : Math.max(goal, x - dt / downS)
}
// advance by dt at this level; zones: { name: words in it }; quiet: the
// zones that follow only their own touches, not the clock
function step(m, dt, level, zones, quiet) {
  m.since += dt
  let moving = false
  for (const g of GROUPS) {
    const x = ramp(m.gate[g], shows(level, g) ? 1 : 0, dt, LEVEL_S, LEVEL_S)
    if (x !== m.gate[g]) moving = true
    m.gate[g] = x
  }
  for (const z in zones) {
    const was = m.zone[z] || 0
    const own = m.own[z] > 0 ? 1 : 0
    if (own) m.own[z] = Math.max(0, m.own[z] - dt)
    const x = ramp(was, quiet && quiet.indexOf(z) >= 0 ? own : Math.max(own, wanted(m, zones[z])), dt, FADE_IN_S, FADE_OUT_S)
    if (x !== was) moving = true
    m.zone[z] = x
  }
  m.moving = moving
}
// the level as loaded at startup: there, not faded in
function snap(m, level) { for (const g of GROUPS) m.gate[g] = shows(level, g) ? 1 : 0 }
function ease(x) { return x * x * (3 - 2 * x) }
function gate(m, group) { return group === "always" ? 1 : ease(m.gate[group] || 0) }
function presence(m, zone) { return zone === "standing" ? 1 : ease(m.zone[zone] || 0) }
function mix(m, group, zone) { return gate(m, group) * presence(m, zone) }
