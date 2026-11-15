.pragma library
// labels.js — when the place and planet labels show. They are a layer that
// comes up after an interaction and fades again a few seconds later, so a
// view left parked puts no standing text on the OLED; L (or the IPC call
// `labels false`) turns the layer off for good. Plain JS, checked by
// tests/test_labels.js; Background.qml eases the result with a spring like
// its other overlays.

const HOLD_S = 8          // labels stay this long after the last interaction, then fade

// the layer's state: seconds since the last interaction
function create() { return { since: HOLD_S * 10 } }
function touch(st) { st.since = 0 }
function step(st, dt) { st.since += dt }
// what the layer wants to be: 1 while on and recently touched, else 0
function wanted(on, st) { return on && st.since < HOLD_S ? 1 : 0 }
