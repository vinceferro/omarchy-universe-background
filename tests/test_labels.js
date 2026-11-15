// checks for labels.js, the label layer's timer (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Lb = new Function(src + "\nreturn { HOLD_S, create, touch, step, wanted };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }

check("the hold is one named constant, a few seconds (OLED)", Number.isFinite(Lb.HOLD_S) && Lb.HOLD_S >= 3 && Lb.HOLD_S <= 20, Lb.HOLD_S)

// 1. a fresh clock is past its hold: nothing shows until something happens
const st = Lb.create()
check("fresh: nothing wanted", Lb.wanted(true, st) === 0)

// 2. an interaction brings the layer up, for HOLD_S, then it goes
Lb.touch(st)
check("touched: wanted", Lb.wanted(true, st) === 1)
let t = 0
while (Lb.wanted(true, st) === 1 && t < 100) { Lb.step(st, 1 / 165); t += 1 / 165 }
check("drops at HOLD_S (+- a frame)", Math.abs(t - Lb.HOLD_S) < 2 / 165, t.toFixed(3))

// 3. another interaction mid-way restarts the hold
Lb.touch(st)
for (let i = 0; i < 165 * (Lb.HOLD_S - 1); i++) Lb.step(st, 1 / 165)
check("still up 1 s before the hold ends", Lb.wanted(true, st) === 1)
Lb.touch(st)
for (let i = 0; i < 165 * (Lb.HOLD_S - 1); i++) Lb.step(st, 1 / 165)
check("a second touch restarted it", Lb.wanted(true, st) === 1)
for (let i = 0; i < 165 * 2; i++) Lb.step(st, 1 / 165)
check("and it still ends", Lb.wanted(true, st) === 0)

// 4. off is off, touched or not
Lb.touch(st)
check("off: never wanted", Lb.wanted(false, st) === 0)

// 5. frame-rate independent: the same hold at 60 Hz and through a hiccup
const a = Lb.create(); Lb.touch(a); let ta = 0
while (Lb.wanted(true, a) === 1) { Lb.step(a, 1 / 60); ta += 1 / 60 }
const b = Lb.create(); Lb.touch(b); Lb.step(b, 0.5); let tb = 0.5
while (Lb.wanted(true, b) === 1) { Lb.step(b, 1 / 165); tb += 1 / 165 }
check("same hold at 60 Hz and after a 0.5 s stall", Math.abs(ta - Lb.HOLD_S) < 1 / 60 + 1e-9 && Math.abs(tb - Lb.HOLD_S) < 1 / 165 + 1e-9, ta.toFixed(3) + " " + tb.toFixed(3))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
