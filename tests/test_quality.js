// checks for quality.js, the adaptive render scale and idle pacing (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Q = new Function(src + "\nreturn { SCALE_MIN, AUTO_MIN, IDLE_FULL, IDLE_SLOW, LEVELS, BUDGET, gpuClass, parseProbe, screenGpu, parseLevel, autoScale, choose, idleDue, perfCreate, perfFrame, perfTake, perfLine, describe };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const show = c => Q.describe(c)

// the two machines, as hyprctl and /sys/class/drm report them
const BOX = { gpu: "nvidia", width: 5120, height: 2160, dpr: 1, hz: 165 }
const LAP = { gpu: "apple", width: 1728, height: 1117, dpr: 2, hz: 120 }
const at = (m, level) => Q.choose(Object.assign({ level: level }, m))

// 1. the reference machine is untouched: every device pixel, straight to the screen, 60 fps idle
const box = at(BOX, "auto")
check("box: full scale, no texture in between", box.scale === 1 && !box.layered && box.res === 1, show(box))
check("box: the device size", box.texW === 5120 && box.texH === 2160)
check("box: idle at the clock's own rate", box.idleFps === Q.IDLE_FULL && Q.IDLE_FULL === 60)
check("NVIDIA is never scaled, whatever the pixel rate", Q.choose({ level: "auto", gpu: "nvidia", width: 3840, height: 2160, dpr: 2, hz: 240 }).scale === 1)

// 2. the laptop: Hyprland scale 2 renders at the logical size, a quarter of the pixels
const lap = at(LAP, "auto")
check("laptop: one texel per logical pixel", lap.scale === 0.5 && lap.texels === 1 && lap.layered, show(lap))
check("laptop: 1728x1117 instead of 3456x2234", lap.texW === 1728 && lap.texH === 1117)
check("laptop: the shaders' resolution stays logical", lap.res === 1)
check("laptop: idle at 30 fps", lap.idleFps === 30)
check("laptop: inside Apple's budget at 120 Hz", lap.texW * lap.texH * 120 / 1e6 <= Q.BUDGET.apple, (lap.texW * lap.texH * 120 / 1e6).toFixed(0) + " MP/s")

// 3. the pixel-rate budget: more pixels a second than the class allows scales down, in steps, to a floor
const igpu = Q.choose({ level: "auto", gpu: "intel", width: 2560, height: 1440, dpr: 1, hz: 60 })
check("Intel 1440p60: scaled to its budget", igpu.scale === 0.7 && igpu.texW * igpu.texH * 60 / 1e6 <= Q.BUDGET.intel, show(igpu))
check("  below a texel per pixel: resolution follows the texture", igpu.res === igpu.texels && igpu.res < 1)
const small = Q.choose({ level: "auto", gpu: "intel", width: 1920, height: 1080, dpr: 1, hz: 60 })
check("Intel 1080p60 just over budget: not worth a texture, direct", small.scale === 1 && !small.layered, show(small))
const step = Q.choose({ level: "auto", gpu: "intel", width: 1920, height: 1080, dpr: 1, hz: 75 })
check("Intel 1080p75: the first step that is taken is 0.85", step.scale === 0.85 && step.layered, show(step))
let gap = true
for (let hz = 30; hz <= 360; hz += 1) { const s = Q.autoScale("intel", 1920, 1080, 1, hz); if (s > 0.9 && s !== 1) gap = false }
check("no automatic scale between 0.9 and 1", gap && Q.autoScale("amd", 2016, 1134, 1.05, 60) === 1)
const fits = Q.choose({ level: "auto", gpu: "amd", width: 1920, height: 1080, dpr: 1, hz: 60 })
check("AMD 1080p60 fits: full scale, direct", fits.scale === 1 && !fits.layered && fits.idleFps === 30, show(fits))
const huge = Q.choose({ level: "auto", gpu: "intel", width: 3840, height: 2160, dpr: 1, hz: 144 })
check("the automatic floor", huge.scale === Q.AUTO_MIN, show(huge))
const frac = Q.choose({ level: "auto", gpu: "amd", width: 2048, height: 1152, dpr: 1.25, hz: 60 })
check("fractional scale 1.25: logical size", Math.abs(frac.scale - 0.8) < 1e-12 && frac.texW === 2048 && frac.texH === 1152 && frac.res === 1, show(frac))
let mono = true, prev = 1
for (let hz = 30; hz <= 360; hz += 15) {
  const s = Q.autoScale("unknown", 2560, 1440, 1, hz)
  if (s > prev + 1e-12 || s < Q.AUTO_MIN || s > 1) mono = false
  prev = s
}
check("a faster screen never raises the scale", mono)
check("an unknown GPU class counts as unknown", Q.choose({ level: "auto", gpu: "voodoo", width: 1920, height: 1080, dpr: 1, hz: 60 }).gpu === "unknown")
check("missing facts fall back (scale 1, 60 Hz)", Q.choose({ level: "auto", gpu: "apple", width: 1728, height: 1117 }).scale === 1)

// 4. overrides: named levels are the same on any hardware, a number is a render scale
check("full on the laptop: the old behaviour", at(LAP, "full").scale === 1 && !at(LAP, "full").layered && at(LAP, "full").idleFps === 60 && at(LAP, "full").texW === 3456)
check("high: 0.75, 60 fps idle", at(LAP, "high").scale === 0.75 && at(LAP, "high").texW === 2592 && at(LAP, "high").idleFps === 60 && at(LAP, "high").res === 1)
check("balanced on the box: half size, resolution follows", at(BOX, "balanced").scale === 0.5 && at(BOX, "balanced").texW === 2560 && at(BOX, "balanced").res === 0.5 && at(BOX, "balanced").idleFps === 30)
check("low", at(BOX, "low").scale === 0.35 && at(BOX, "low").layered)
check("a number is the scale, idle rate by GPU", at(LAP, "0.6").scale === 0.6 && at(LAP, "0.6").idleFps === 30 && at(BOX, "0.6").idleFps === 60)
check("parseLevel: names, case, whitespace", Q.parseLevel(" High\n") === "high" && Q.parseLevel("auto") === "auto" && Q.parseLevel("LOW") === "low")
check("parseLevel: numbers clamp", Q.parseLevel("0.1") === String(Q.SCALE_MIN) && Q.parseLevel("3") === "1" && Q.parseLevel("0.6") === "0.6")
check("parseLevel: nonsense is auto", ["", "ultra", "-1", "0", "NaN", undefined, null].every(s => Q.parseLevel(s) === "auto"))
check("every named level is in range", Object.keys(Q.LEVELS).every(k => Q.LEVELS[k].scale >= Q.SCALE_MIN && Q.LEVELS[k].scale <= 1 && Q.LEVELS[k].idleFps >= 24 && Q.LEVELS[k].idleFps <= 60))
let never = true
for (const m of [BOX, LAP]) for (const l of ["auto", "full", "high", "balanced", "low", "0.25", "0.9"]) {
  const c = at(m, l)
  // a star is a texel wide in `resolution` pixels: resolution x res must not exceed the texture
  if (c.res > c.texels + 1e-12 || c.res > 1 || c.texW < 1 || c.texW > Math.ceil(m.width * m.dpr) || c.layered !== (c.scale < 1)) never = false
}
check("resolution never finer than the texture, texture never larger than the screen", never)

// 5. the GPU probe (as printed on the two machines)
const lapProbe = Q.parseProbe("* asahi\n* apple-drm\nHDMI-A-1 apple-drm\neDP-1 apple-drm\n")
const boxProbe = Q.parseProbe("* nvidia\nDP-1 nvidia\nDP-2 nvidia\nDP-3 nvidia\nHDMI-A-1 nvidia\n")
check("laptop: the panel's card only scans out, the GPU is Apple's", Q.screenGpu(lapProbe, "eDP-1") === "apple")
check("box: NVIDIA", Q.screenGpu(boxProbe, "DP-1") === "nvidia")
const hybrid = Q.parseProbe("* i915\n* nvidia\neDP-1 i915\nDP-3 nvidia\n")
check("hybrid: each screen by its own card", Q.screenGpu(hybrid, "eDP-1") === "intel" && Q.screenGpu(hybrid, "DP-3") === "nvidia")
check("an unlisted connector: the first rendering card", Q.screenGpu(lapProbe, "DP-9") === "apple" && Q.screenGpu(hybrid, "DP-9") === "intel")
check("no probe yet, or an empty one: unknown", Q.screenGpu(null, "eDP-1") === "unknown" && Q.screenGpu(Q.parseProbe(""), "eDP-1") === "unknown")
check("driver names", Q.gpuClass("amdgpu") === "amd" && Q.gpuClass("xe") === "intel" && Q.gpuClass("nvidia") === "nvidia" && Q.gpuClass("nouveau") === "unknown" && Q.gpuClass("simpledrm") === "" && Q.gpuClass("vc4") === "unknown")
check("nouveau is not the reference: budgeted and idle at 30", (c => c.gpu === "unknown" && c.scale < 1 && c.idleFps === 30)(Q.choose({ level: "auto", gpu: Q.screenGpu(Q.parseProbe("* nouveau\nDP-1 nouveau\n"), "DP-1"), width: 5120, height: 2160, dpr: 1, hz: 165 })))
check("junk lines are skipped", Q.parseProbe("garbage\n\n* \n a b c\n* amdgpu").cards.join() === "amdgpu")

// 6. idle pacing off a 16 ms clock: 60 passes every firing, 30 every second one, lively always
function paced(idleFps, lively, jitter) {
  let last = 0, ticks = 0, t = 0
  for (let i = 0; i < 6000; i++) {
    t += 16 + (jitter ? ((i * 7) % 5) - 2 : 0)
    if (Q.idleDue(t - last, idleFps, lively)) { ticks++; last = t }
  }
  return ticks / (t / 1000)
}
check("60: every firing, as before", Math.abs(paced(60, false, false) - 62.5) < 0.01 && Math.abs(paced(60, false, true) - 62.5) < 0.1, paced(60, false, true).toFixed(2))
check("30: every second firing", Math.abs(paced(30, false, false) - 31.25) < 0.01, paced(30, false, false).toFixed(2))
check("30 with +-2 ms of timer jitter: still 28-32 fps", paced(30, false, true) > 28 && paced(30, false, true) < 32, paced(30, false, true).toFixed(2))
check("lively: the full rate whatever the cap", Math.abs(paced(30, true, true) - paced(60, false, true)) < 1e-9)
check("a long stall is due", Q.idleDue(500, 30, false))

// 7. the frame-time meter
const st = Q.perfCreate()
check("an empty window is zeros, not NaN", (r => r.frames === 0 && r.avgMs === 0 && r.fps === 0 && r.peakMs === 0)(Q.perfTake(st)))
let t = 1000
Q.perfFrame(st, t)
for (let i = 0; i < 119; i++) { t += i === 50 ? 40 : 8; Q.perfFrame(st, t) }
const r = Q.perfTake(st)
check("120 frames are 119 intervals", r.frames === 119)
check("average and peak", Math.abs(r.avgMs - (118 * 8 + 40) / 119) < 1e-9 && r.peakMs === 40, r.avgMs.toFixed(3) + " " + r.peakMs)
check("fps is frames over time", Math.abs(r.fps - 1000 / r.avgMs) < 1e-9)
Q.perfFrame(st, t + 10)
const r2 = Q.perfTake(st)
check("the next window starts clean and loses no interval", r2.frames === 1 && r2.avgMs === 10 && r2.peakMs === 10)
const line = Q.perfLine("eDP-1", r, "idle", lap)
check("the log line names screen, mode, numbers and quality", /^universe perf eDP-1 \[idle\]: [\d.]+ fps, interval avg [\d.]+ ms, peak 40 ms, 119 frames \| auto \(apple\): scale 0\.50, 1728x1117, idle 30 fps$/.test(line), line)
check("direct is said", /5120x2160 direct, idle 60 fps$/.test(show(box)), show(box))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
