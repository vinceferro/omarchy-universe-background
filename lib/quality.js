.pragma library
// quality.js — how many pixels the wallpaper shades, and how often, for the
// screen and GPU it finds itself on. Plain JS, checked by
// tests/test_quality.js; Background.qml feeds it the facts and applies the
// answer.
//
// The scene was tuned on an RTX 3080 Ti at scale 1, where the full pass
// shades every device pixel. On a HiDPI panel (Hyprland scale 2) the shaders
// already think in LOGICAL pixels (their `resolution`), so the extra device
// pixels buy only smoother edges, at four times the cost: there the full pass
// renders into a texture of `scale` x the device size and is stretched
// smoothly over the screen. The idle wallpaper drifts slowly, so a weak GPU
// also draws it less often (idleFps); exploring is never capped.
//
//   scale    render size / device size, per axis (1: no texture in between)
//   texels   rendered texels per logical pixel (scale x the monitor's scale)
//   res      what the shaders' `resolution` is multiplied by: 1 while there
//            is at least a texel per logical pixel, else `texels`, so a star
//            or a HUD line is never thinner than the texel that must carry it

const SCALE_MIN = 0.25       // an override cannot go below a quarter per axis
const AUTO_MIN = 0.35        // and the automatic choice stops here
const IDLE_FULL = 60         // the idle clock's own rate (a 16 ms timer)
const IDLE_SLOW = 30

// the named levels: render scale and idle frame rate, whatever the hardware
const LEVELS = {
  full: { scale: 1, idleFps: IDLE_FULL },
  high: { scale: 0.75, idleFps: IDLE_FULL },
  balanced: { scale: 0.5, idleFps: IDLE_SLOW },
  low: { scale: 0.35, idleFps: IDLE_SLOW }
}

// megapixels a second the full pass may shade while exploring (render size x
// refresh rate). NVIDIA is the reference and is never scaled (its own driver;
// nouveau mostly cannot raise the GPU's clocks, so it counts as unknown). The
// others are estimates from the reference (1825 MP/s on the 3080 Ti with room
// to spare), to be corrected with `perf true` on the machine itself.
const BUDGET = { nvidia: Infinity, apple: 300, amd: 300, intel: 120, unknown: 200 }

// DRM driver name (/sys/class/drm/card*/device/driver) to GPU class; "" for
// a driver that only scans out (Apple's display controller, simpledrm, USB
// docks), whose pixels another card renders
function gpuClass(driver) {
  const d = String(driver || "").toLowerCase()
  if (d === "nvidia") return "nvidia"
  if (d === "asahi" || d === "agx") return "apple"
  if (d === "i915" || d === "xe") return "intel"
  if (d === "amdgpu" || d === "radeon") return "amd"
  if (d === "apple-drm" || d === "appledrm" || d === "simpledrm" || d === "simple-framebuffer" || d === "evdi" || d === "udl" || d === "") return ""
  return "unknown"
}

// the probe prints one line per card, "* <driver>", and one per connector,
// "<connector> <driver>" (the driver of the card that owns it)
function parseProbe(text) {
  const probe = { cards: [], byConnector: {} }
  String(text || "").split("\n").forEach(line => {
    const f = line.trim().split(/\s+/)
    if (f.length !== 2) return
    if (f[0] === "*") probe.cards.push(f[1])
    else probe.byConnector[f[0]] = f[1]
  })
  return probe
}

// the GPU that renders a screen: its connector's card, or, when that card
// only scans out (or the probe has not answered), the first card that renders
function screenGpu(probe, connector) {
  const own = gpuClass(probe && probe.byConnector[connector])
  if (own !== "") return own
  const cards = probe ? probe.cards.map(gpuClass).filter(c => c !== "") : []
  return cards.length > 0 ? cards[0] : "unknown"
}

// a level as typed or read from the state file: "auto", a named level, or a
// render scale as a number ("0.6"); anything else is "auto"
function parseLevel(s) {
  const t = String(s === undefined || s === null ? "" : s).trim().toLowerCase()
  if (t === "auto" || LEVELS[t] !== undefined) return t
  const n = Number(t)
  if (t !== "" && isFinite(n) && n > 0) return String(Math.max(SCALE_MIN, Math.min(1, n)))
  return "auto"
}

function autoIdleFps(gpu) { return gpu === "nvidia" ? IDLE_FULL : IDLE_SLOW }

// the automatic render scale. devW x devH: the monitor's mode in device
// pixels; dpr: its scale; hz: its refresh rate
function autoScale(gpu, devW, devH, dpr, hz) {
  if (gpu === "nvidia") return 1
  // a texel per logical pixel is all the shaders were written for
  let s = dpr > 1 ? 1 / dpr : 1
  const budget = BUDGET[gpu] !== undefined ? BUDGET[gpu] : BUDGET.unknown
  const rate = devW * devH * hz / 1e6
  if (rate * s * s > budget) s = Math.floor(Math.sqrt(budget / rate) * 20) / 20   // steps of 0.05, rounded down
  // a texture in between softens the whole picture: not worth a tenth of the pixels
  if (s > 0.9) return 1
  return Math.max(AUTO_MIN, s)
}

// The answer for one screen. q: { level, gpu, width, height (logical size),
// dpr, hz }. Returns scale, texels and res (see the top), the full pass's
// texture size, layered (false: draw straight to the screen, as on the
// reference machine) and idleFps.
function choose(q) {
  const level = parseLevel(q.level)
  const gpu = BUDGET[q.gpu] !== undefined ? q.gpu : "unknown"
  const dpr = q.dpr > 0 ? q.dpr : 1
  const hz = q.hz > 0 ? q.hz : 60
  const w = Math.max(1, q.width), h = Math.max(1, q.height)
  let scale, idleFps
  if (level === "auto") {
    scale = autoScale(gpu, w * dpr, h * dpr, dpr, hz)
    idleFps = autoIdleFps(gpu)
  } else if (LEVELS[level] !== undefined) {
    scale = LEVELS[level].scale
    idleFps = LEVELS[level].idleFps
  } else {
    scale = Number(level)
    idleFps = autoIdleFps(gpu)
  }
  const texels = scale * dpr
  return {
    level: level, gpu: gpu, scale: scale, texels: texels,
    res: Math.min(1, texels),
    texW: Math.ceil(w * texels - 1e-6), texH: Math.ceil(h * texels - 1e-6),
    layered: scale < 1,
    idleFps: idleFps
  }
}

// ---- the hole's tracer (hole.frag's layer) ----
// Near Sgr A* every texel of a layer is a light ray marched through the Kerr
// metric: by far the dearest texels in the wallpaper. Measured on the
// reference machine (RTX 3080 Ti, tools/hole_layer.py time=, the desktop
// running beside it): 3.3 ns a texel, so 9 ms for a draw at half of
// 5120x2160 and 4.5 ms at a third. That cannot be drawn every frame at
// 165 Hz, and need not be: universe.frag reads the layer by direction, so a
// turning view is exact on every frame without a new trace; a new trace is
// only needed as the camera moves (the fall, a flight) and as the gas flows.
// So the layer's size and its rate are chosen together:
//   scale    the layer's size over the screen's logical size, per axis.
//            NVIDIA: 1 where a whole draw fits HOLE_FULL_MS, else a half;
//            every other GPU a third, as it always was
//   moveHz   how often the tracer takes the camera while it moves; idleHz
//            while only the gas flows. NVIDIA: what keeps the tracer within
//            HOLE_DUTY_MOVE / HOLE_DUTY_IDLE of the GPU's time, as a whole
//            fraction of the refresh rate (every frame where a draw is that
//            cheap), never under HOLE_HZ_MIN; elsewhere HOLE_HZ, as before
//   float32  the layer's format: 32-bit floats on NVIDIA (16-bit ones round
//            the bend vector by up to a few pixels); 16-bit elsewhere (not
//            every GLES driver filters 32-bit float textures)
//   over     the layer's field of view over the screen's: a margin for what
//            a turn brings in at the edge between two traces
// q.holeScale (IPC `holeScale`) overrides the scale, for comparing on screen.
const HOLE_NS = { nvidia: 3.3, apple: 30, amd: 30, intel: 60, unknown: 40 }   // ns per traced texel; only NVIDIA's is measured
const HOLE_FULL_MS = 2
const HOLE_DUTY_MOVE = 1 / 3, HOLE_DUTY_IDLE = 0.2
const HOLE_HZ = 40, HOLE_HZ_MIN = 15
const HOLE_OVER = 1.04
// the largest whole fraction of the refresh rate that is no more than `want`
function holeRate(hz, want) {
  return hz / Math.max(1, Math.ceil(hz / Math.max(want, 1e-3) - 1e-9))
}
function holeChoose(q) {
  const gpu = HOLE_NS[q.gpu] !== undefined ? q.gpu : "unknown"
  const hz = q.hz > 0 ? q.hz : 60
  const w = Math.max(1, q.width), h = Math.max(1, q.height)
  const ms = s => Math.ceil(w * s) * Math.ceil(h * s) * HOLE_NS[gpu] * 1e-6
  const asked = Number(q.holeScale)
  let scale
  if (asked > 0 && isFinite(asked)) scale = Math.max(SCALE_MIN, Math.min(1, asked))
  else if (gpu === "nvidia") scale = ms(1) <= HOLE_FULL_MS ? 1 : 0.5
  else scale = 1 / 3
  const drawMs = ms(scale)
  let moveHz, idleHz
  if (gpu === "nvidia") {
    moveHz = holeRate(hz, Math.max(HOLE_HZ_MIN, 1000 * HOLE_DUTY_MOVE / drawMs))
    idleHz = holeRate(hz, Math.max(HOLE_HZ_MIN, Math.min(HOLE_HZ, 1000 * HOLE_DUTY_IDLE / drawMs)))
  } else moveHz = idleHz = Math.min(hz, HOLE_HZ)
  return { gpu: gpu, scale: scale, texW: Math.ceil(w * scale), texH: Math.ceil(h * scale), drawMs: drawMs,
           moveHz: moveHz, idleHz: idleHz, float32: gpu === "nvidia", over: HOLE_OVER }
}
// is a new trace due? sinceMs: time since the tracer last took the camera;
// hz: its rate now; frameHz: the screen's (a rate at or above it: every frame)
function holeDue(sinceMs, hz, frameHz) {
  if (hz >= frameHz - 0.5) return true
  return sinceMs < 0 || sinceMs >= 1000 / hz - 0.45 * 1000 / frameHz
}
function holeDescribe(h) {
  return "hole " + h.texW + "x" + h.texH + (h.float32 ? " 32F" : " 16F") + ", " + h.moveHz.toFixed(0) + "/" + h.idleHz.toFixed(0) + " Hz, est. " + h.drawMs.toFixed(1) + " ms a draw"
}

// Idle pacing: the 16 ms clock asks before each tick. sinceMs: time since the
// last tick; lively: something is easing (the pointer's parallax, a mode
// fading out), which gets the clock's full rate so no transition steps. At
// 30 fps every second firing passes (32 ms against 33.3, less the timer's
// jitter); at IDLE_FULL every one does, as before there was a cap.
function idleDue(sinceMs, idleFps, lively) {
  if (lively || idleFps >= IDLE_FULL) return true
  return sinceMs >= 1000 / idleFps - 4
}

// ---- frame meter (IPC `perf true`) ----
// It times the INTERVAL between presented frames, as the GUI thread hears of
// them (frameSwapped is queued from the render thread, so a busy tick can
// lengthen one), not the GPU's time per frame: under the idle cap it reads
// 33 ms however light the frame, and shows headroom only while exploring.
// frame(): one presented frame at tMs; take(): the window's numbers, and a
// fresh window. An interval needs two frames, so the first of a window only
// starts the clock (it is kept across take(), so no interval is lost).
function perfCreate() { return { last: -1, n: 0, sum: 0, peak: 0 } }
function perfFrame(st, tMs) {
  if (st.last >= 0) {
    const d = tMs - st.last
    st.n++; st.sum += d
    if (d > st.peak) st.peak = d
  }
  st.last = tMs
}
function perfTake(st) {
  const r = { frames: st.n, avgMs: st.n > 0 ? st.sum / st.n : 0, peakMs: st.peak, fps: st.sum > 0 ? 1000 * st.n / st.sum : 0 }
  st.n = 0; st.sum = 0; st.peak = 0
  return r
}
function perfLine(name, r, mode, c) {
  return "universe perf " + name + " [" + mode + "]: " + r.fps.toFixed(1) + " fps, interval avg " + r.avgMs.toFixed(1) + " ms, peak " + r.peakMs.toFixed(0)
    + " ms, " + r.frames + " frames | " + describe(c)
}
// one line for `qualityInfo` and the perf log
function describe(c) {
  return c.level + " (" + c.gpu + "): scale " + c.scale.toFixed(2) + ", " + c.texW + "x" + c.texH + (c.layered ? "" : " direct") + ", idle " + c.idleFps + " fps"
}
