.pragma library
// text.js — what text the wallpaper shows, and for how long. One setting, the
// text level, and one idle clock. Plain JS, checked by tests/test_text.js;
// Background.qml keeps the level, feeds the clock and multiplies every
// overlay by mix(group, zone).
//
// Every element belongs to one group, and a level is a set of groups:
//   off     nothing: the scene (a film or tour caption and the level's own
//           toast are the only words that can appear)
//   names   what am I looking at: place and planet names, markers, the
//           card's head, a caption's title
//   full    names, plus the guide (the card's text, caption detail, key
//           hints) and the cockpit (the HUD's rings, clock, readouts, beacons)
// T cycles off, names, full; H (the cockpit key) goes between full and the
// last level below it. A hold (IPC textHold) is a temporary level for film
// and tours that is never saved, and film mode itself is `off`.
//
// The clock: every interaction touches it, and each zone then stays for as
// long as its words take to read (8 s, plus a second per 3.5 words, at most
// 40 s) and fades, so a parked view puts no standing text on the OLED. The
// one standing exception is the cockpit's rings, clock and readouts, which
// are dim and drift: they follow the level only (Background.qml).

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
  return { since: HOLD_MAX_S * 10, gate: { names: 0, guide: 0, cockpit: 0 }, zone: {}, moving: false }
}
function touch(m) { m.since = 0 }
function wanted(m, nWords) { return m.since < hold(nWords) ? 1 : 0 }
function ramp(x, goal, dt, upS, downS) {
  return goal > x ? Math.min(goal, x + dt / upS) : Math.max(goal, x - dt / downS)
}
// advance by dt at this level; zones: { name: words in it }
function step(m, dt, level, zones) {
  m.since += dt
  let moving = false
  for (const g of GROUPS) {
    const x = ramp(m.gate[g], shows(level, g) ? 1 : 0, dt, LEVEL_S, LEVEL_S)
    if (x !== m.gate[g]) moving = true
    m.gate[g] = x
  }
  for (const z in zones) {
    const was = m.zone[z] || 0
    const x = ramp(was, wanted(m, zones[z]), dt, FADE_IN_S, FADE_OUT_S)
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
