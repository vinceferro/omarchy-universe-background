import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons
// qualified as well: Omarchy 4.0.2 (still the newest on aarch64) only resolves
// Color through the module name; 4.0.6 accepts both
import qs.Commons as Commons
import qs.Ui
import "lib/camera.js" as Cam
import "lib/fall.js" as Fall
import "lib/kerr.js" as Kerr
import "lib/localgroup.js" as LG
import "lib/dwarfs.js" as Dw
import "lib/text.js" as Tx
import "lib/drag.js" as Dr
import "lib/quality.js" as Q
import "lib/layout.js" as Lay
import "lib/dial.js" as Dial
import "lib/sun.js" as Sun
import "lib/anatomy.js" as Anat

Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string stateHome: home + "/.local/state"
  readonly property string currentBackgroundLink: stateHome + "/omarchy/current/background"

  property string currentBackground: ""
  property string displayedBackground: ""
  property string incomingBackground: ""
  property string oldBackground: ""
  property bool finishingTransition: false
  property int backgroundVersion: 0
  property int revealStartedVersion: -1
  property int pendingThemeVersion: -1
  property string pendingColorsRaw: ""
  property string pendingShellRaw: ""
  property real revealProgress: 1
  property real shaderEpoch: Date.now()
  property real shaderTime: 0

  // Event-loop driven clock for the live shader. Session-relative seconds
  // wrapped at 600 keeps float32 sin() arguments small enough for GPU range
  // reduction, and a Timer (unlike NumberAnimation) keeps ticking even when
  // the compositor would otherwise idle and stall QML's animation driver.
  // Animate unless a visible workspace has a fullscreen window (a game, a video):
  // then the shader freezes on its current frame so the GPU goes to the game.
  // It also sleeps while the screen is locked or off (`omarchy-shell
  // background sleep true`, sent by ~/.local/bin/desk-idle-guard), keeping
  // whatever view you were exploring for when you come back.
  property bool sleeping: false
  readonly property bool animate: !sleeping && !Hyprland.monitors.values.some(m => m.activeWorkspace && m.activeWorkspace.hasFullscreen)

  // While exploring, the clock is the display itself: one tick per rendered
  // frame (165 Hz here), so camera motion never steps in an uneven 2-3-2-3
  // cadence. The idle wallpaper moves slowly and keeps the cheaper 60 Hz
  // timer, which also stands in as a watchdog if the compositor stops asking
  // for frames. On a GPU that needs the rest (idleFps below 60, see the
  // quality section) the settled idle sky skips every second firing; while
  // anything eases (idleBusy: the pointer's parallax, a view fading out) it
  // has all of them, so no transition steps.
  property real lastFrameAt: 0
  property bool idleBusy: true

  // ---- JARVIS navigation ----
  // While exploring, the HUD's instrument reads where you are (refreshed 5
  // times a second: see dialWant), and beacons around its rim point toward
  // the Sun, Earth, the target, the Galactic Centre and the nearest place, on
  // or off screen, like a compass: the beacon says which way, the bug of the
  // same colour on the range scale how far.
  property var navBeacons: [null, null, null, null, null] // { name, ang (radians, screen), dist (text), color, behind }
  property real navNextAt: 0
  property var gxPrevCam: null
  property real gxSpeed: 0                           // kpc per second, eased
  function fmtNum(n, d) { return n.toLocaleString(Qt.locale("en_US"), "f", d === undefined ? 0 : d) }
  function fmtLy(ly) {
    return ly >= 1e6 ? fmtNum(ly / 1e6, 2) + " MLY" : ly >= 1000 ? fmtNum(ly) + " LY" : ly >= 1 ? fmtNum(ly, 1) + " LY" : fmtNum(ly * 63241, 0) + " AU"
  }
  function fmtAu(au) {
    return au < 0.02 ? fmtNum(au * auKm) + " KM" : fmtNum(au, au < 10 ? 3 : 2) + " AU"
  }
  // galactic (l, b) to equatorial (RA hours, Dec degrees), J2000
  function galToEq(lDeg, bDeg) {
    const l = lDeg * Math.PI / 180, b = bDeg * Math.PI / 180
    const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]
    const T = [[-0.0548755604, 0.4941094279, -0.8676661490], [-0.8734370902, -0.4448296300, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]]
    // rows of T are the equatorial axes in galactic coordinates: eq = T g
    const e = [0, 1, 2].map(j => T[j][0] * g[0] + T[j][1] * g[1] + T[j][2] * g[2])
    let ra = Math.atan2(e[1], e[0]) * 12 / Math.PI
    if (ra < 0) ra += 24
    return [ra, Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180 / Math.PI]
  }
  // screen angle of a direction v from the eye, given a camera basis and focal
  // length (works behind the camera too). Things already on screen are
  // labelled there, so they get no beacon (null)
  function beaconOf(v, right, up, fwd, name, dist, color, focal) {
    const x = v[0] * right[0] + v[1] * right[1] + v[2] * right[2]
    const y = -(v[0] * up[0] + v[1] * up[1] + v[2] * up[2])
    const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2]
    const k = (focal || 1) / Math.max(z, 1e-12)
    if (z > 0 && Math.abs(x * k) < aspect * 0.5 && Math.abs(y * k) < 0.5) return null
    return { name: name, ang: Math.atan2(y, x), dist: dist, color: color, behind: z < 0, shift: 0 }
  }
  FrameAnimation {
    running: root.animate && root.explore !== "universe"
    onTriggered: {
      root.lastFrameAt = Date.now()
      root.tick(frameTime)
    }
  }
  Timer {
    interval: 16
    running: root.animate
    repeat: true
    onTriggered: {
      const now = Date.now()
      if (root.explore !== "universe") { if (now - root.lastFrameAt > 120) root.tick() }
      else if (Q.idleDue(now - root.lastTick, root.idleFps, root.idleBusy || root.viewTarget.x !== root.view.x || root.viewTarget.y !== root.view.y)) root.tick()
    }
  }

  // The soft nebula layer drifts slowly, so it re-renders ~10 times a second.
  // Under an idle cap the tick itself moves it on (every third 32 ms tick):
  // a timer on its own phase would present extra frames between the capped ones.
  property real nebulaTime: 0
  property real lastNebulaAt: 0
  Timer {
    interval: root.navigating ? 16 : 100
    running: root.animate && (root.navigating || root.idleFps >= Q.IDLE_FULL)
    repeat: true
    onTriggered: root.nebulaTime = root.shaderTime
  }

  // The text level (lib/text.js): one setting for every word and line the
  // wallpaper draws over the scene. T cycles off, names, full while exploring
  // (Shift+T back); H, Super+Alt+J and IPC `toggleHud` switch the cockpit:
  // full, and the last level below it. IPC `text <level>` sets it from a
  // script. The level is one word in a state file and survives a restart.
  // Every element belongs to a group the level shows or not:
  //   names    place and planet names, markers, the card's head, a caption's title
  //   guide    the card's text, caption detail, the key hints (full only)
  //   cockpit  the HUD's rings, clock, words and beacons (full only)
  // and to a zone that comes up with any interaction (a key, the pointer, a
  // flight) and fades once its words have had time to be read, so a parked
  // view puts no standing text on the OLED: opacity = textMix(group, zone).
  // Only the cockpit's rings, clock and date stand while the level is
  // full: they are dim and drift; its other words are the zone `dial`. `omarchy-shell background hud <level>` sets
  // the cockpit's brightness until the shell restarts.
  property string textLevel: ""                   // "" until the state file is read: nothing shows
  property string textLower: "names"              // the last level below full: where the cockpit key returns to
  property string textHold: ""                    // IPC textHold: a level for a film or a tour, never saved
  readonly property string textShown: Tx.effective(textLevel, textHold, film)
  readonly property var textModel: Tx.create()
  property real gateNames: 0                      // the groups, eased over a level change
  property real gateGuide: 0
  property real gateCockpit: 0
  property real presLabel: 0                      // the zones: names, markers and beacons (8 s),
  property real presCard: 0                       //   the place card, by its words,
  property real presHints: 0                      //   the key hints,
  property real presCaption: 0                    //   the mode caption,
  property real presDial: 0                       //   the cockpit's words (the readout line, the gap, landmarks),
  property real presSys: 0                        //   its machine labels (with the dial's, or on a machine event)
  property real presUnits: 0                      //   and its unit words (with the dial's, or after a view change)
  property bool hudPointerIn: false               // the pointer is inside the HUD's disc (it brings the dial's words)
  function textMix(group, zone) {
    return (group === "names" ? gateNames : group === "guide" ? gateGuide : group === "cockpit" ? gateCockpit : 1)
         * (zone === "label" ? presLabel * nameYield : zone === "card" ? presCard : zone === "hints" ? presHints : zone === "caption" ? presCaption : 1)
  }
  function readTextModel() {
    gateNames = Tx.gate(textModel, "names"); gateGuide = Tx.gate(textModel, "guide"); gateCockpit = Tx.gate(textModel, "cockpit")
    presLabel = Tx.presence(textModel, "label"); presCard = Tx.presence(textModel, "card")
    presHints = Tx.presence(textModel, "hints"); presCaption = Tx.presence(textModel, "caption")
    presDial = Tx.presence(textModel, "dial")
    presSys = Math.max(presDial, Tx.presence(textModel, "sys")); presUnits = Math.max(presDial, Tx.presence(textModel, "units"))
    presAnat = Tx.presence(textModel, "anat")
  }
  function touchText() { Tx.touch(textModel) }
  // word: a level, "next", "prev", or "toggle" (the cockpit key). It ends a
  // hold, is saved, and names itself in the story band
  function setText(word, from) {
    const st = Tx.apply({ level: textLevel || "full", lower: textLower }, word)
    if (!st) return
    // the shell's log says what changed the level (a key and an IPC call leave no other trace)
    if (st.level !== textLevel) console.info("universe.background: text level " + (textLevel || "unset") + " -> " + st.level + " (" + word + ", " + (from || "a call") + ")")
    textHold = ""
    textLower = st.lower
    if (st.level !== textLevel) { textLevel = st.level; saveText() }
    touchText()
    gone("text")                         // the level named a moment ago is not the level any more
    say("text", st.level === "off" ? "TEXT OFF  ·  T BRINGS IT BACK" : "TEXT  ·  " + st.level.toUpperCase(), "")
  }
  // ---- Anatomy (C, IPC `anatomy <on|off|toggle>`; lib/anatomy.js) ----
  // What the body in front is made of, as thin lines with short labels: one
  // table and one set of rules for every body. It describes the view's one
  // subject (anatSubject): the pinned body, the chosen place, or the view's
  // own object (the Sun in the system view, the Milky Way in its own view
  // and in Sky mode). It is a setting like the text level: one word in a
  // state file, named in the story band when it changes.
  //
  // Where it is drawn follows from one rule (Anat.choose), for every body:
  // with a line 18% of the screen's height or more it is drawn on the body
  // itself, in the view's own projection (anatStage); smaller, it is drawn
  // in the lens (anatGlass): the HUD's disc shows it through a telescope
  // from the same eye, to scale, the HUD's readouts dimmed, a leader from
  // the rim to where the body is. The lens is the anatomy's, not the
  // cockpit's: with the cockpit off (`names`, `off`) it stands alone in the
  // disc's place of the plan (Lay.hudAt), glass, rim, lines and leader with
  // no gauge, and the scene's names keep out of it as they do of the disc. The two cross-fade (anatLens), and the
  // size has to fall to 15% to go back. The lens magnifies up to ten
  // million times; where that does not reach the subject, the record that
  // holds it answers by the same rule (the Sun from the Galaxy's home: its
  // Galaxy).
  //
  // It joins what the text already has, with no rule of its own: the lines
  // are a drawing (shown at every level, like the orbit lines), the names
  // are `names`, the numbers `guide`; all of it is one zone on the idle
  // clock (`anat`), so a parked view keeps nothing lit; the headline and the
  // facts go to the story band at `full` (turning it on walks the lines
  // once, the largest first, each lit while its fact is up; any key ends the
  // walk; pointing at a line says its fact); the scene's names step back
  // while it is up (nameYield); lines keep inside the safe rect and out of
  // the rail, the caption, the HUD's disc and a story caption, and the
  // labels stand in one column beside the drawing; mathematics rows show
  // with K only; a journey (a flight to a place, the fall, the way home)
  // fades the lines and they return on arrival.
  //
  // What it costs: nothing while it is off, faded or away. While it is up a
  // drawing is worked out again only when its view moved by a pixel or what
  // it shows changed (anatKeep), at most a fifth of the time while the view
  // moves and once exactly when it has rested; the HUD's drift moves the
  // lens as one item and the stage's room in steps of 8 px.
  property bool anatomy: false
  readonly property string anatFile: stateHome + "/universe-background/anatomy"
  property real anatMix: 0                        // eased 0..1: on, with a subject, parked
  property real anatLens: 0                       // eased 0..1: on the body (0), in the lens (1)
  property real presAnat: 0                       // its zone on the idle clock
  property var anatOut: null                      // the drawing that answers the choice in force (Anat.compose)
  property var anatStage: null                    // what is drawn on the body, in the first screen's pixels
  property var anatGlass: null                    // what is drawn in the lens, in the lens's own pixels (anatLensD(lay0) across)
  property var anatAim: null                      // the lens's subject on the first screen: [x, y, radius], or null out of sight
  property int anatWords: 0                       // the words of its labels, for the clock
  property string anatLit: ""                     // the row being told
  property var anatPointer: null                  // the pointer, in the first screen's pixels
  function anatSlot() { return { key: "", probe: null, movedAt: 0, still: true, at: 0, last: 0, sel: null } }
  readonly property var anatRun: ({ sel: null, stage: anatSlot(), glass: anatSlot(), blank: ({}), said: "", subject: "", walk: null, hover: "", c: null, readoutUntil: 0, passes: 0, ms: 0, arrived: false })
  readonly property real anatLevel: Math.min(0.75, hudBrightness * 1.8)   // the lines' brightness: the hints'
  // the scene's names while the anatomy is up: one rule for every view
  readonly property real nameYield: 1 - 0.8 * anatMix * presAnat
  // how far the lens is up, and the HUD's readouts while its disc is the lens
  readonly property real lensUp: anatMix * presAnat * anatLens
  readonly property real lensYield: 1 - 0.85 * lensUp
  readonly property var anatHint: ["C", "anatomy: show / hide what it is made of"]
  // the lens on a screen: the dial's rim
  function anatLensD(l) { return 2 * Lay.DIAL.RIM * l.hud.s * l.H }
  function setAnatomy(word) {
    const w = String(word || "").trim().toLowerCase()
    const to = w === "on" ? true : w === "off" ? false : w === "toggle" ? !anatomy : null
    if (to === null) return
    touchText()
    anatRun.said = ""; anatRun.subject = ""
    anatRun.walk = to ? { pending: true } : null
    gone("anatomy")                      // what the band was saying about the body belongs to the lines that were up
    if (!to) { say("anatomy", "ANATOMY OFF  ·  C BRINGS IT BACK", ""); if (anatLit !== "") anatLit = "" }
    if (to === anatomy) return
    anatomy = to
    anatFileProc.command = ["bash", "-c", "mkdir -p \"$(dirname \"$1\")\" && printf '%s\\n' \"$2\" > \"$1\"", "_", anatFile, to ? "on" : "off"]
    anatFileProc.running = true
  }
  // any key ends the walk (the caption up is read out)
  function anatEndWalk() { if (anatRun.walk) { anatRun.walk = null; say("anatomy", "", "") } }
  Process { id: anatFileProc }
  Process {
    running: true
    command: ["cat", root.anatFile]
    stdout: StdioCollector { onStreamFinished: if (String(text || "").trim() === "on") root.anatomy = true }
  }
  // IPC anatomyDemo: go to a body of the table and turn its anatomy on (the
  // rule above then draws it on the body or in the lens, as for any visit).
  // It returns at once; the drawing comes when the visit has landed: the
  // whole flight (about 11 s from home to the hole), the view at rest, then
  // the headline. About 20 s in all: a script polls anatomyReport for
  // `parked`, `still` and `drawn` rather than sleeping.
  function anatGo(id) {
    const rec = Anat.byId(String(id || "").trim())
    if (!rec || !emptyWorkspace) return
    if (rec.sys !== undefined) {
      if (explore !== "system") enterSystem()
      focusBody(rec.sys)
    } else {
      if (explore !== "galaxy") enterGalaxy()
      let i = -1
      if (rec.place !== undefined) i = placeIndex(rec.place)
      else if (rec.dwarf) { for (let j = hotspots.length + 1; j <= hotspots.length + dwarfPlaces.length && i < 0; j++) if (Anat.byPlace(place(j).name, true) === rec) i = j }
      gxFlyTo(i)                                  // the Milky Way and the Local Group: home, where the rule draws the Milky Way
    }
    setAnatomy("on")
  }
  // the view's one subject, as a record of the table (null: this view has none)
  function anatSubject() {
    if (explore === "system") return Anat.bySys(follow >= 0 && !galactic ? follow : 0)
    if (explore === "galaxy") return gxSel >= 0 ? Anat.byPlace(place(gxSel).name, !!place(gxSel).dwarf) : Anat.byAt(gxSel === -1 ? "sun" : "centre")
    if (explore === "sky") return Anat.byAt("centre")
    return null
  }
  // parked: no journey under way (zooming and orbiting are not journeys)
  function anatParked() {
    if (explore === "system") return !sysCam.flying()
    if (explore === "galaxy") return !fallState && !gxReturn && gxVoyage.remain < 0.03 * gxVoyage.dist()
    return explore === "sky"
  }
  // a sky position (J2000 degrees) as a point of the Milky Way view, at the place's own distance and carried with it
  function anatSkyPoint(C, pl, ra, dec) {
    const rad = Math.PI / 180, e = [Math.cos(dec * rad) * Math.cos(ra * rad), Math.cos(dec * rad) * Math.sin(ra * rad), Math.sin(dec * rad)]
    const T = [[-0.0548755604, 0.4941094279, -0.8676661490], [-0.8734370902, -0.4448296300, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]]
    const g = [0, 1, 2].map(j => T[0][j] * e[0] + T[1][j] * e[1] + T[2][j] * e[2])     // galactic: toward the centre, toward l = 90, north
    const s0 = sunPosAt(0), d = pl.dpc / 1000
    const o = [s0[0] + g[1] * d - pl.pos[0], s0[1] - g[0] * d - pl.pos[1], s0[2] + g[2] * d - pl.pos[2]]   // from the place's centre, today
    const carried = !(pl.kind === "galaxy" || Math.hypot(pl.pos[0], pl.pos[1]) > 20), b = carried ? sunOmega * gxMyr : 0, c = Math.cos(b), sn = Math.sin(b)
    return [C[0] + o[0] * c + o[1] * sn, C[1] + o[1] * c - o[0] * sn, C[2] + o[2]]
  }
  // A record's frame in the view in front (lib/anatomy.js: where its centre
  // is, how long its unit is there, its axes, the eye), with the context its
  // live values read; null when the record has no place in this view.
  function anatFrame(rec) {
    const c = { a: holeSpin, rsKpc: rsKpc, unitS: rec.unitKm / 299792.458, place: ({}), t: gxMyr }
    let f = null
    if (rec.sys !== undefined && explore === "system") {
      // the system view: display units, the body as it is drawn
      const i = rec.sys, P = bodyP(i), R = bodyR(i), b = sysCam.b, pl = Math.hypot(P[0], P[1], P[2])
      if (!b) return null
      f = { C: P, k: R / rec.radius, basis: Anat.basisOf(rec.axis && rec.axis.v ? rec.axis.v : [0, 1, 0]),
            cam: { C: b.C, right: b.right, up: b.up, fwd: b.fwd, focal: b.focal, o: b.o },
            sunDir: pl > 0 ? [-P[0] / pl, -P[1] / pl, -P[2] / pl] : null,
            oneScale: sysCam.sigma.x > 0.999 && !galactic, limb: rec.radius, resolve: () => null }
    } else if (explore === "galaxy" || explore === "sky") {
      // the Milky Way view and Sky mode: kiloparsecs
      const sky = explore === "sky"
      if (sky && !rec.sky) return null
      let C = null, pl = null
      if (rec.place !== undefined) { const i = placeIndex(rec.place); if (i < 0) return null; C = hotspotPos(i); pl = place(i) }
      else if (rec.dwarf) { if (gxSel < 0 || !place(gxSel).dwarf) return null; C = hotspotPos(gxSel); pl = place(gxSel) }
      else if (rec.at === "sun") C = sunPosAt(sky ? 0 : gxMyr)
      else if (rec.at === "centre") C = [0, 0, 0]
      else return null
      if (pl) c.place = Dw.list().find(d => d.name === pl.name || d.hotspot === pl.name) || pl
      const myr = sky ? 0 : gxMyr   // Sky mode is the sky today
      const sun = sunPosAt(myr), b = sunOmega * myr, ax = rec.axis
      const basis = ax === "spin" ? Anat.basisOf([holeSpinAxis.x, holeSpinAxis.y, holeSpinAxis.z])
                  : ax === "sight" ? Anat.basisOf([sun[0] - C[0], sun[1] - C[1], sun[2] - C[2]], ncpDir)        // ex: north on the sky, ey: east
                  : ax === "galactic" ? [[Math.cos(b), -Math.sin(b), 0], [Math.sin(b), Math.cos(b), 0], [0, 0, 1]]  // turning with the disk
                  : ax && ax.disk === "m31" ? Anat.basisOf(m31Disk.normal, m31Disk.major)
                  : Anat.basisOf(ax && ax.v ? ax.v : [0, 0, 1])
      f = { C: C, k: rec.kpcPerUnit ? rec.kpcPerUnit(c) : rec.unitKm / 3.0856776e16, basis: basis,
            cam: sky ? { C: sunPosAt(0), right: [skyRight.x, skyRight.y, skyRight.z], up: [skyUp.x, skyUp.y, skyUp.z], fwd: [skyFwd.x, skyFwd.y, skyFwd.z], focal: skyFocal(), o: [0, 0] }
                     : { C: gxCam, right: [gxRight.x, gxRight.y, gxRight.z], up: [gxUp.x, gxUp.y, gxUp.z], fwd: [gxFwd.x, gxFwd.y, gxFwd.z], focal: 1, o: [0, 0] },
            sunDir: null, oneScale: true,
            resolve: spec => {
              if (spec === "sun") return sun
              const i = spec.place !== undefined ? placeIndex(spec.place) : spec.toPlace !== undefined ? placeIndex(spec.toPlace) : -1
              if (spec.place !== undefined) return i >= 0 ? hotspotPos(i) : null
              if (spec.toPlace !== undefined) { if (i < 0) return null; const Q = hotspotPos(i); return [C[0] + (Q[0] - C[0]) * spec.fraction, C[1] + (Q[1] - C[1]) * spec.fraction, C[2] + (Q[2] - C[2]) * spec.fraction] }
              return spec.ra !== undefined && pl ? anatSkyPoint(C, pl, spec.ra, spec.dec) : null
            } }
    }
    return f ? { frame: f, c: c } : null
  }
  // The stage's room: what the lines are cut at and what the labels' column
  // keeps out of. Nothing in it follows a frame: the HUD's disc is taken in
  // steps of 8 px (it drifts under 3 px a second), the rail and a story
  // caption in steps of 16; the column avoids all the HUD can sweep.
  function anatRoom() {
    const l = lay0, obs = [], avoid = []
    if (railNow > 0) obs.push(Lay.railRect(l, Math.ceil(railNow / 16) * 16))
    if (captionUp) obs.push(Lay.captionRect(l, l.caption.maxH))
    if (storyNow > 0) obs.push(Lay.storyRect(l, Math.ceil(storyNow / 16) * 16))
    if (gateCockpit > 0.01) {
      const h = Lay.hudAt(l, [hudDrift.x, hudDrift.y])
      obs.push({ cx: Math.round(h.cx / 8) * 8, cy: Math.round(h.cy / 8) * 8, r: h.R + 8 })
      avoid.push(Lay.hudExtent(l))
    }
    return { obstacles: obs, avoid: avoid, key: obs.map(o => o.r !== undefined ? o.cx + "," + o.cy + "," + Math.round(o.r) : Math.round(o.x) + "," + Math.round(o.y) + "," + Math.round(o.w) + "," + Math.round(o.h)).join(";") }
  }
  // One drawing kept in step with its view (S: its slot, cur: what is up,
  // sel: what it is to be, or null). It is worked out again when its view
  // moved by a pixel (Anat.probe) or what it shows changed: at most a fifth
  // of the time while the view moves, so a line is a few frames behind at
  // worst, and once more when the view has rested for 150 ms (what takes
  // long, the hole's exact shadow and the gas's light, waits for that).
  function anatKeep(S, cur, sel, frameOf, env, lensE, now) {
    const rec = sel ? Anat.byId(sel.id) : null, f = rec ? frameOf(rec) : null
    if (!f) { S.key = ""; S.probe = null; S.sel = null; S.still = true; return null }
    const e = sel.lens ? lensE : env
    const key = sel.id + "|" + e.key + "|" + f.c.a
    const p = Anat.probe(sel.lens ? Anat.lensFrame(rec, f.frame, f.c, mathMode) : f.frame, f.c, e)
    if (Anat.probeMoved(S.probe, p, 0.75)) S.movedAt = now
    const moved = S.movedAt === now, rest = now - S.movedAt >= 150
    S.sel = sel
    if (!(key !== S.key || moved || (rest && !S.still))) return cur
    if (!(rest || S.key === "" || now - S.at >= Math.max(10, 5 * S.last))) return cur
    env.still = rest; lensE.still = rest
    const t0 = Date.now()
    const out = Anat.draw(sel, frameOf, env, lensE)
    S.key = key; S.probe = p; S.still = rest
    S.at = Date.now(); S.last = S.at - t0
    anatRun.passes++; anatRun.ms += S.last        // what the passes cost (IPC anatomyReport)
    return out
  }
  // is a drawing still to be brought up to date? (the tick keeps running until it is)
  function anatBusy() { return mix.lens.moving() || (anatRun.stage.sel && !anatRun.stage.still) || (anatRun.glass.sel && !anatRun.glass.still) }
  // Once a tick (after the label passes).
  function anatStep(dt, now) {
    const R = anatRun
    const rec = anatomy && liveBackground ? anatSubject() : null
    const parked = rec && anatParked() ? 1 : 0
    if (parked && mix.anat.g === 0) { Tx.touchZone(textModel, "anat"); R.arrived = true }   // an arrival brings the lines back, like a key
    if (anatomy && !parked && mix.anat.g === 1) gone("anatomy")       // a journey begins: the body left behind is said no more, and its caption up goes at once
    mix.anat.g = parked
    const m = mix.anat.step(dt)
    if (m !== anatMix) anatMix = m
    if (!rec || (m === 0 && mix.anat.g === 0)) {
      if (anatOut || anatStage || anatGlass) { anatOut = null; anatStage = null; anatGlass = null; anatWords = 0; R.stage = anatSlot(); R.glass = anatSlot(); R.sel = null }
      if (anatAim) anatAim = null
      if (anatLit !== "") anatLit = ""
      if (!rec) { R.said = ""; R.subject = "" }
      return
    }
    // faded on the idle clock: nothing is worked out until something brings the text back
    if (presAnat === 0 && R.sel && !R.walk) return
    // leaving on a journey: the last of the fade keeps the drawing it has
    if (mix.anat.g === 0 && m < 0.1) return
    const L0 = lay0, room = anatRoom(), mode = (mathMode ? "K" : "") + "|" + anatLit
    const frames = {}, frameOf = r => frames[r.id] !== undefined ? frames[r.id] : (frames[r.id] = anatFrame(r))
    const D = anatLensD(L0), h0 = Lay.hudAt(L0, [0, 0])
    const env = { W: L0.W, H: L0.H, lensD: D, safe: L0.safe, obstacles: room.obstacles, avoid: room.avoid, key: "S|" + room.key + "|" + mode, math: mathMode, lit: anatLit, still: true,
                  tok: { name: L0.tok.anat, num: L0.tok.anatNum, gap: L0.tok.gap, row: L0.tok.row }, textW: anatTextW }
    // the choice: on the body or in the lens (a few multiplications a row)
    // (a drawing that came out empty, its lines all cut away, stands aside
    // for half a second, and for as long after as the view of the one that
    // answers in its place has not moved: a view at rest is not tried again,
    // and a try that comes out empty again changes nothing on the screen)
    const first = !R.sel, skip = {}, was = R.sel, up = was ? (was.lens ? R.glass : R.stage) : null
    for (const k in R.blank) { const b = R.blank[k]; if (b.until > now || (up && up.key !== "" && up.movedAt < b.at && b.mode === mode)) skip[k] = true; else delete R.blank[k] }
    const sel = Anat.choose(rec, frameOf, env, was, skip)
    R.sel = sel
    mix.lens.g = sel && sel.lens ? 1 : 0
    if (first || m < 0.02) mix.lens.set(mix.lens.g)
    const lens = mix.lens.step(dt)
    if (lens !== anatLens) anatLens = lens
    // the lens's own screen, and where its subject is on the real one
    const shown = sel && sel.lens ? Anat.byId(sel.id) : null, f0 = shown ? frameOf(shown) : null
    let aim = null
    if (f0) {
      const P = Anat.project(f0.frame.cam, f0.frame.C, env), v = [f0.frame.C[0] - f0.frame.cam.C[0], f0.frame.C[1] - f0.frame.cam.C[1], f0.frame.C[2] - f0.frame.cam.C[2]]
      const rad = (typeof shown.radius === "function" ? shown.radius(f0.c) || 0 : shown.radius) * f0.frame.k * f0.frame.cam.focal / (Math.hypot(v[0], v[1], v[2]) || 1) * L0.H
      if (P && P[0] > 0 && P[0] < L0.W && P[1] > 0 && P[1] < L0.H) aim = [P[0], P[1], rad]
    }
    if (!aim ? !!anatAim : !anatAim || Math.hypot(aim[0] - anatAim[0], aim[1] - anatAim[1]) > 0.5 || Math.abs(aim[2] - anatAim[2]) > 0.5) anatAim = aim
    const to = aim ? [Math.round((aim[0] - h0.cx + D / 2) / 16) * 16, Math.round((aim[1] - h0.cy + D / 2) / 16) * 16] : null
    const x0 = h0.cx - D / 2, sway = L0.hud.driftX * L0.H      // the lens's corner, and how far the drift carries it
    const lensE = Anat.lensEnv(env, D, to, { x0: L0.safe.x0 - x0 + sway, x1: L0.safe.x1 - x0 - sway })
    lensE.key = "L|" + Math.round(D) + "|" + (to ? to.join(",") : "") + "|" + mode
    // the drawings: the chosen one, and the one it replaces while that fades
    const onStage = sel && !sel.lens ? sel : sel && lens < 0.99 ? R.stage.sel : null
    const inLens = sel && sel.lens ? sel : sel && lens > 0.01 ? R.glass.sel : null
    const st = anatKeep(R.stage, anatStage, onStage, frameOf, env, lensE, now)
    if (st !== anatStage) anatStage = st
    const gl = anatKeep(R.glass, anatGlass, inLens, frameOf, env, lensE, now)
    if (gl !== anatGlass) anatGlass = gl
    const out = sel ? (sel.lens ? gl : st) : null
    if (sel && !out && (sel.lens ? R.glass : R.stage).key !== "") {
      R.blank[sel.id + (sel.lens ? "|L" : "|S")] = { at: now, until: now + 500, mode: mode }
      // the drawing that is up stays: the next tick chooses again without this one
      if (anatOut && was && (was.id !== sel.id || was.lens !== sel.lens)) { R.sel = was; mix.lens.g = was.lens ? 1 : 0; return }
    }
    if (out !== anatOut) {
      anatOut = out
      anatWords = Tx.words(Anat.wordsOf(out))
      R.c = out ? frameOf(Anat.byId(out.id)).c : null
    }
    // like a key: the drawing an arrival brings stays a glance and its
    // labels' reading time, however long the flight ran the idle clock down
    // (at `names` and `off` no walk through the story band holds it up)
    if (R.arrived && out) { R.arrived = false; Tx.touchZone(textModel, "anat", Tx.hold(anatWords)) }
    const settled = sel ? (sel.lens ? R.glass.still : R.stage.still) : true
    // what it says, at `full`: the body's headline when the drawing becomes
    // another body's (where no line of it can be drawn, the subject's own,
    // once: C always answers), and once after C the lines one by one, the
    // largest first
    const guide = Tx.shows(textShown, "guide") && !film
    const named = out ? Anat.byId(out.id) : rec
    if (m > 0.5 && settled && (out ? out.id !== R.said : rec.id !== R.subject)) {
      R.said = named.id
      R.subject = rec.id
      R.readoutUntil = now + 4000
      Tx.touchZone(textModel, "dial")
      gone("anatomy")                    // another body's caption yields at once
      say("anatomy", "ANATOMY  ·  " + named.title, guide ? named.headline : "")
      if (R.walk && R.walk.pending) R.walk = guide && out ? { told: ({}) } : null
    }
    if (!out) { if (anatLit !== "") anatLit = ""; return }
    const row = id => out.rows.find(r => r.id === id)
    const fact = id => Anat.factOf(named.rows.find(r => r.id === id), R.c, out.g)
    const mine = story.cur && story.cur.who === "anatomy" ? story.cur : null
    if (R.walk && !R.walk.pending) {
      Tx.touchZone(textModel, "anat", 1)   // the lines stay up while they are told
      const waiting = story.line.some(c => c.who === "anatomy")
      if (!guide || mix.anat.g === 0) R.walk = null
      else if (!waiting && (!mine || (story.up >= 1 && mine.age >= mine.need))) {
        // the largest line drawn now that has not been told
        const next = out.rows.find(r => !R.walk.told[r.id])
        if (next) { R.walk.told[next.id] = true; say("anatomy", next.name, fact(next.id)) }
        else R.walk = null
      }
    } else if (!R.walk) {
      // pointing at a line says its fact (in the lens: in the lens's own pixels, where the disc is now)
      let px = anatPointer
      if (px && out.lens) { const h = Lay.hudAt(L0, [hudDrift.x, hudDrift.y]); px = [px[0] - h.cx + D / 2, px[1] - h.cy + D / 2] }
      const over = px && m > 0.5 && presAnat > 0.5 ? Anat.hit(out, px[0], px[1], 7) : ""
      if (over !== R.hover) { R.hover = over; if (over !== "" && guide) say("anatomy", row(over).name, fact(over)) }
    }
    // lit: the row whose fact is up, else the one under the pointer
    const told = mine && storyShow > 0.05 ? out.rows.find(r => r.name === mine.title) : null
    const lit = told ? told.id : !R.walk && R.hover !== "" && row(R.hover) ? R.hover : ""
    if (lit !== anatLit) anatLit = lit
  }
  property real hudBrightness: 0.38
  readonly property real hudLevel: hudBrightness * gateCockpit * cockpitYield * lensYield

  // The story band (lib/text.js): the one place the wallpaper says a
  // sentence, whoever says it: the fall's events ("fall"), the way home
  // ("home"), the level's name after a change ("text"), a tour's or a
  // film's script (IPC `caption`: "script"). One caption at a time, each up
  // for at least its reading time, later ones waiting their turn; it shows
  // at every text level. A script's caption stays until the script says
  // something else; every other one leaves once read. The reading time
  // holds a caption against others about the same thing; a caption about
  // what is no longer on the screen goes at once (gone).
  //
  // Film mode (IPC `film true`): for recording. It is the level `off` for as
  // long as it is on, reached over the same 1.5 s: the cockpit, key hints,
  // names, markers and mode captions go and the scene stays, and only the
  // script speaks in the story band. Neither film nor a hold touches the
  // saved level, and film itself is not remembered: a restart is back to
  // normal.
  property bool film: false
  onFilmChanged: if (film) Tx.storyOnly(story, "script")
  readonly property var story: Tx.storyCreate()
  property string storyTitle: ""                  // the caption up, as the tick last read the model
  property string storyBody: ""
  property real storyShow: 0                      // its opacity
  function say(who, title, body, stay) {
    if (film && who !== "script") return
    Tx.say(story, who, title, body, !!stay)
  }
  // what `who` was speaking about has left the screen (a journey began, the
  // subject or the setting changed): its caption goes at once, read or not
  function gone(who) { Tx.storyLeft(story, who) }
  // Legibility, one rule for every text (scrim.frag): a soft black backing
  // behind the words, feathered to nothing, as strong as the picture under
  // it is bright (read from the screen's own picture at low resolution, the
  // panel's sceneLuma). Invisible over a dark scene; over the fall's closing
  // light or the glowing gas it keeps the words readable. It carries the
  // text's opacity, so it comes and goes with the words. `over`: the block
  // it backs, its parent (a line of text: Words below) or a sibling (a
  // column: then it backs the width its lines are painted over, in the
  // middle when they are centred); `host`: the panel's { scene, w, h };
  // `show`: what the block's own opacity does not say (its words' level
  // and zone).
  component Scrim: ShaderEffect {
    id: scrim
    property Item over: parent
    property var host: null
    property real show: 1
    property bool centred: false
    property real feather: 24
    property real strength: 0.78
    readonly property bool inside: over === parent
    readonly property var scene: host ? host.scene : null
    // the width the words are painted over: the widest line of a column of text, else the block's own
    readonly property real blockW: {
      let w = 0, n = 0
      for (const c of over.children) if (c !== scrim && c.visible && c.contentWidth !== undefined) { w = Math.max(w, c.contentWidth); n++ }
      return n > 0 ? Math.min(w, over.width) : over.width
    }
    z: -1
    x: (inside ? 0 : over.x) + (centred ? (over.width - blockW) / 2 : 0) - feather
    y: (inside ? 0 : over.y) - feather
    width: blockW + 2 * feather
    height: over.height + 2 * feather
    visible: !!scene && opacity > 0.004 && (inside || over.visible) && over.width > 0 && over.height > 0
    opacity: (inside ? 1 : over.opacity) * show
    // where it lies on the screen: read through its own place and its
    // ancestors', so a name beside a moving marker takes its backing along
    function origin() {
      let moved = 0   // (read, so that the binding follows them)
      for (let it = scrim, n = 0; it && n < 6; it = it.parent, n++) moved += it.x + it.y
      return isFinite(moved) ? mapToItem(null, 0, 0) : Qt.point(0, 0)
    }
    readonly property point at: origin()
    readonly property vector4d under: host ? Qt.vector4d(at.x / host.w, at.y / host.h, width / host.w, height / host.h) : Qt.vector4d(0, 0, 1, 1)
    readonly property vector2d size: Qt.vector2d(width, height)
    fragmentShader: Qt.resolvedUrl("scrim.qsb")
  }
  // The anatomy's one renderer, for a drawing on the body and for one in
  // the lens (out: Anat.compose's answer; kx, ky: its pixels to this
  // screen's): a stroke per row, solid, dashed or dotted by its tag (the
  // renderer cuts the dashes), its crosses and arrowheads, its name and
  // number in the column, and the leader from its line to them.
  component AnatDrawing: Item {
    id: draw
    property var out: null
    property var host: null
    property var tok: null
    property real kx: 1
    property real ky: 1
    readonly property var rows: out ? out.rows : []
    Repeater {
      model: draw.rows.length
      Item {
        id: arow
        required property int index
        readonly property var r: draw.rows[index] || null
        readonly property bool lit: !!r && r.id === root.anatLit
        readonly property color ink: Qt.alpha(lit ? root.hudHighlight : Color.foreground, root.anatLevel * (lit ? 1 : r && r.soft ? 0.5 : 0.8))
        readonly property real wide: lit ? 1.8 : 1.2
        readonly property bool named: !!r && r.lab.show
        function pts(list) { return list.map(s => s.map(p => Qt.point(p[0] * draw.kx, p[1] * draw.ky))) }
        Shape {
          preferredRendererType: Shape.CurveRenderer
          ShapePath {
            strokeColor: arow.ink; strokeWidth: arow.wide; fillColor: "transparent"
            capStyle: ShapePath.RoundCap; joinStyle: ShapePath.RoundJoin
            strokeStyle: arow.r && arow.r.dash ? ShapePath.DashLine : ShapePath.SolidLine
            dashPattern: arow.r && arow.r.dash ? [arow.r.dash[0] / arow.wide, arow.r.dash[1] / arow.wide] : [1, 0]
            PathMultiline { paths: arow.r ? arow.pts(arow.r.segs) : [] }
          }
          ShapePath {
            strokeColor: arow.ink; strokeWidth: arow.wide; fillColor: "transparent"
            capStyle: ShapePath.RoundCap; joinStyle: ShapePath.RoundJoin
            PathMultiline { paths: arow.r ? arow.pts(arow.r.marks) : [] }
          }
          ShapePath {
            strokeColor: Qt.alpha(arow.lit ? root.hudHighlight : Color.foreground, root.anatLevel * 0.45 * root.gateNames); strokeWidth: 1; fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            PathMultiline { paths: arow.named && arow.r.lead ? arow.pts([arow.r.lead]) : [] }
          }
        }
        Row {
          visible: arow.named
          x: arow.r ? arow.r.lab.x * draw.kx : 0
          y: arow.r ? (arow.r.lab.y + arow.r.lab.h / 2) * draw.ky - height / 2 : 0
          spacing: draw.tok ? draw.tok.gap : 8
          Words {
            host: draw.host
            opacity: root.gateNames
            text: arow.r ? arow.r.text : ""
            color: arow.lit ? root.hudHighlight : Qt.alpha(Color.foreground, 0.85)
            font.family: Style.resolvedFontFamily
            font.pixelSize: draw.tok ? draw.tok.anat : 14
            font.letterSpacing: draw.tok ? draw.tok.anat * draw.tok.track.normal : 1.5
          }
          Words {
            host: draw.host
            anchors.baseline: parent.children[0].baseline
            opacity: root.gateGuide
            text: arow.r ? arow.r.num : ""
            color: Qt.alpha(Color.foreground, 0.6)
            font.family: Style.resolvedFontFamily
            font.pixelSize: draw.tok ? draw.tok.anatNum : 12
            font.letterSpacing: draw.tok ? draw.tok.anatNum * draw.tok.track.normal : 1.3
          }
        }
      }
    }
  }
  // a line of text in the scene (a name, a marker's words, the HUD's): Text with its backing
  component Words: Text {
    id: words
    property var host: null
    Scrim { host: words.host; feather: Math.round(words.font.pixelSize * 2.5) }
  }
  // Text widths are measured in the shell font at the size and tracking the
  // words are drawn with (the label pass keeps names apart by them)
  FontMetrics { id: fmLabel; font.family: Style.resolvedFontFamily; font.pixelSize: root.lay0.tok.label; font.letterSpacing: root.lay0.tok.label * root.lay0.tok.track.normal }
  FontMetrics { id: fmMicro; font.family: Style.resolvedFontFamily; font.pixelSize: root.lay0.tok.micro; font.letterSpacing: root.lay0.tok.micro * root.lay0.tok.track.normal }
  readonly property var textWidths: ({ key: "", w: {}, n: 0 })
  // the width of `text` as a label (px: tok.label) or as small words (tok.micro) on the first screen, with the label pass's margin.
  // Remembered per text; a beacon's words carry a distance that counts as it flies, so the memory starts over at 500 texts
  function textW(text, px) {
    const small = px !== lay0.tok.label, fm = small ? fmMicro : fmLabel
    const key = fm.font.family + "|" + lay0.tok.label + "|" + lay0.tok.micro
    if (textWidths.key !== key || textWidths.n >= 500) { textWidths.key = key; textWidths.w = {}; textWidths.n = 0 }
    const k = (small ? "m" : "l") + text
    let w = textWidths.w[k]
    if (w === undefined) { w = fm.advanceWidth(text) + 6; textWidths.w[k] = w; textWidths.n++ }
    return w
  }
  // the anatomy's words, at their own sizes (measured once a text: a pass measures nothing it has seen)
  FontMetrics { id: fmAnat; font.family: Style.resolvedFontFamily; font.pixelSize: root.lay0.tok.anat; font.letterSpacing: root.lay0.tok.anat * root.lay0.tok.track.normal }
  FontMetrics { id: fmAnatNum; font.family: Style.resolvedFontFamily; font.pixelSize: root.lay0.tok.anatNum; font.letterSpacing: root.lay0.tok.anatNum * root.lay0.tok.track.normal }
  readonly property var anatWidths: ({ key: "", w: {}, n: 0 })
  function anatTextW(text, small) {
    const fm = small ? fmAnatNum : fmAnat, M = anatWidths
    const key = fm.font.family + "|" + lay0.tok.anat + "|" + lay0.tok.anatNum
    if (M.key !== key || M.n >= 500) { M.key = key; M.w = {}; M.n = 0 }
    const k = (small ? "n" : "a") + text
    let w = M.w[k]
    if (w === undefined) { w = fm.advanceWidth(text) + 6; M.w[k] = w; M.n++ }
    return w
  }
  readonly property string galHeadingText: "247 KM/S  ·  TOWARD CYGNUS"

  // The mode caption: what the view in front is, a title and a line or two
  // of detail in the HUD's voice, in the caption slot. One for every view;
  // the last one is kept while its view fades out.
  readonly property var modeCaptionNow: galactic ? { key: "galactic", title: "THE SOLAR SYSTEM ON THE MOVE", lines: [
        { text: "THE SUN CARRIES ITS PLANETS ALONG AT 247 KM/S  ·  THEIR ORBITS ARE TILTED 61° TO THE PATH, SO EACH ONE DRAWS A CORKSCREW" },
        { text: (galSlow === 1 ? "TRUE SPEED" : "SUN SLOWED TO 1/" + galSlow + " SO THE COILS SHOW") + (guides ? "  ·  TRAILS: THE LAST " + galTrailYears + " YEARS" : "  ·  I DRAWS THE PATHS")
                + "  ·  TRUE SIZES: THE PLANETS ARE PINPOINTS", warm: galSlow !== 1, dim: true }] }
    : explore === "sky" ? { key: "sky", title: (skyStaticMix > 0.5 ? skyViews[skyView].name : "THE SKY FROM EARTH") + "  ·  GALACTIC LONGITUDE " + ((skyL % 360 + 360) % 360).toFixed(1)
                + "°  LATITUDE " + skyB.toFixed(1) + "°  ·  " + skyVfov.toFixed(0) + "° VIEW",
        lines: [{ text: (skyStaticMix > 0.5 ? skyViews[skyView].note + "  ·  " : "") + "NASA SVS DEEP STAR MAPS 2020  ·  ESA/GAIA/DPAC", dim: true }] }
    : explore === "galaxy" ? { key: "galaxy", title: "MILKY WAY  ·  ABOUT 100,000 LY ACROSS  ·  TRUE SCALE", lines: [
        { text: fallDetail !== "" ? fallDetail
                : Math.abs(gxMyr) < 0.0005 && gxRateIndex === 0 ? "NOW  ·  [ ] TO WATCH IT TURN"
                : (gxMyr >= 0 ? "+" : "") + gxMyr.toFixed(gxMyr < 10 ? 2 : 1) + " MILLION YEARS  ·  " + gxRateNames[gxRateIndex]
                  + "  ·  THE SUN IS " + (((gxMyr * sunOmega * 180 / Math.PI) % 360 + 360) % 360).toFixed(0) + "° ALONG ITS ORBIT  ·  SIMPLIFIED: THE WHOLE DISK TURNS TOGETHER",
          warm: gxRateIndex > 0, dim: true }] }
    : null
  property var modeCaption: null
  onModeCaptionNowChanged: if (modeCaptionNow) modeCaption = modeCaptionNow
  readonly property real modeCaptionMix: !modeCaption ? 0 : modeCaption.key === "galactic" ? galMix : modeCaption.key === "sky" ? skyMix : galaxyMix * (1 - fallFade)

  readonly property string textFile: stateHome + "/universe-background/text-level"
  // what remembered a hidden HUD before there was a level: read once at the
  // start when there is no text-level yet (present: names, absent: full, so
  // each machine starts showing what it showed), never written again
  readonly property string hudHiddenFlag: stateHome + "/universe-background/hud-hidden"

  function saveText() {
    if (textFileProc.running) return              // its exit writes the newer level
    textFileProc.written = textLevel
    textFileProc.command = ["bash", "-c", "mkdir -p \"$(dirname \"$1\")\" && printf '%s\\n' \"$2\" > \"$1\"", "_", textFile, textLevel]
    textFileProc.running = true
  }
  Process {
    id: textFileProc
    property string written: ""
    onExited: if (written !== root.textLevel) root.saveText()
  }
  Process {
    id: textFileCheck
    running: true
    command: ["sh", "-c", "cat \"$1\" 2>/dev/null; echo; [ -e \"$2\" ] && echo hud-hidden", "_", root.textFile, root.hudHiddenFlag]
    stdout: StdioCollector {
      onStreamFinished: {
        if (root.textLevel !== "") return         // set by hand before the file answered
        const lines = String(text || "").split("\n")
        root.textLevel = Tx.migrate(lines[0], lines.slice(1).some(l => l.trim() === "hud-hidden"))
        // the level the shell starts with is simply there (the rings have their own draw-in)
        Tx.snap(root.textModel, root.textShown)
        root.readTextModel()
      }
    }
  }

  // Adaptive quality (lib/quality.js): how many pixels the full pass shades
  // and how often the idle sky redraws, chosen per screen from its scale,
  // refresh rate and the GPU behind it. On NVIDIA at scale 1 (where this was
  // tuned) nothing changes: every device pixel, straight to the screen. On a
  // HiDPI panel with a smaller GPU the full pass renders at the logical size
  // into a texture that is stretched smoothly over the screen, and the
  // settled idle sky redraws at 30 fps; the QML text and markers on top stay
  // at device resolution. `quality`: "auto", "full", "high", "balanced",
  // "low", or a render scale as a number (0.25-1); IPC `quality <level>`
  // sets it and remembers it in a file like the HUD's ("auto" removes it).
  property string quality: "auto"
  readonly property string qualityFile: stateHome + "/universe-background/quality"
  property var gpuProbe: null                     // DRM drivers by card and connector; null until read
  function setQuality(level) {
    quality = Q.parseLevel(level)
    qualityFileProc.command = quality === "auto" ? ["rm", "-f", qualityFile]
      : ["bash", "-c", "mkdir -p \"$(dirname \"$1\")\" && printf '%s\\n' \"$2\" > \"$1\"", "_", qualityFile, quality]
    qualityFileProc.running = true
  }
  function refreshOf(name) {
    const m = Hyprland.monitors.values.find(m => m.name === name)
    const o = m ? m.lastIpcObject : null
    return o && o.refreshRate > 0 ? o.refreshRate : 60
  }
  // the answer for one screen (a ShellScreen). Until the GPU is known it is
  // "full", so the reference machine never starts through a texture
  function qualityOf(screen) {
    const m = Hyprland.monitors.values.find(m => m.name === screen.name)
    return Q.choose({ level: gpuProbe === null ? "full" : quality, gpu: Q.screenGpu(gpuProbe, screen.name),
                      width: screen.width, height: screen.height, name: screen.name,
                      dpr: m && m.scale > 0 ? m.scale : screen.devicePixelRatio, hz: refreshOf(screen.name) })
  }
  // one clock for every screen that is drawn: the slowest idle rate any of them asks for
  readonly property int idleFps: Math.min(Q.IDLE_FULL, ...Quickshell.screens.map(s => qualityOf(s)).filter(q => !q.still).map(q => q.idleFps))
  // the hole's tracer on one screen: its layer's size, format and rates
  // (lib/quality.js, holeChoose). holeScale (IPC `holeScale`, not
  // remembered): the layer's scale, to compare on screen; 0: automatic
  property real holeScale: 0
  function holeOf(screen) {
    const m = Hyprland.monitors.values.find(m => m.name === screen.name)
    return Q.holeChoose({ gpu: Q.screenGpu(gpuProbe, screen.name), width: screen.width, height: screen.height,
                          dpr: m && m.scale > 0 ? m.scale : screen.devicePixelRatio, hz: refreshOf(screen.name), holeScale: holeScale })
  }
  function qualityInfo() {
    return Quickshell.screens.map(s => s.name + " " + Math.round(refreshOf(s.name)) + " Hz: " + Q.describe(qualityOf(s)) + " | " + Q.holeDescribe(holeOf(s))).join("; ")
  }
  // Frame meter (IPC `perf true`): every 5 s each screen logs its presented
  // frames (rate, average and longest interval between them, as this thread
  // hears of them; not the GPU's time per frame) with console.warn
  property bool perf: false

  Process { id: qualityFileProc }
  Process {
    id: qualityFileCheck
    running: true
    command: ["cat", root.qualityFile]
    stdout: StdioCollector {
      onStreamFinished: if (String(text || "").trim() !== "") root.quality = Q.parseLevel(text)
    }
  }
  Process {
    id: gpuProbeProc
    running: true
    command: ["sh", "-c", "cd /sys/class/drm 2>/dev/null && for c in card*; do n=${c%%-*}; d=$(basename \"$(readlink \"$n/device/driver\")\"); [ \"$c\" = \"$n\" ] && echo \"* $d\" || echo \"${c#\"$n\"-} $d\"; done"]
    stdout: StdioCollector {
      onStreamFinished: root.gpuProbe = Q.parseProbe(text)
    }
  }

  // Where text may go (lib/layout.js): per screen, a safe rect inside
  // Hyprland's reserved bands (the bar) and under a camera notch, and in it
  // the rail (bottom left), the caption slot (bottom centre), the story band
  // and the HUD's plan. The notch comes from the platform's cutouts file, as
  // the bar reads it, so it is respected with the bar hidden; the file is
  // absent on most machines. Hyprland's answer is asked for again a moment
  // after the start (the bar may reserve its band after this layer maps) and
  // with every change of view.
  property var displayCutouts: Lay.parseCutouts(cutoutsFile.text())
  FileView {
    id: cutoutsFile
    path: "/usr/share/omarchy-platform/display-cutouts.json"
    blockLoading: true
    watchChanges: true
    printErrors: false
    onLoaded: root.displayCutouts = Lay.parseCutouts(text())
    onLoadFailed: root.displayCutouts = []
    onFileChanged: reload()
  }
  Timer { interval: 1500; running: true; onTriggered: Hyprland.refreshMonitors() }
  function layOf(screen) {
    const m = Hyprland.monitors.values.find(m => m.name === screen.name)
    const o = m ? m.lastIpcObject : null
    const mode = m && m.width > 0 && m.height > 0 ? { width: m.width, height: m.height, transform: o ? o.transform : 0 } : null
    return Lay.plan(screen.width, screen.height, o && o.reserved ? o.reserved : null,
                    Lay.cutoutTop(displayCutouts, screen.name, screen.width, screen.height, screen.devicePixelRatio, mode))
  }
  // the first screen's plan: the camera and the label pass work in its aspect
  readonly property var lay0: Quickshell.screens.length > 0 ? layOf(Quickshell.screens[0]) : Lay.plan(2370, 1000, null, 0)
  // for scripts and checks, as JSON: the level, what is showing right now,
  // and every screen's zones in logical pixels
  function textReport() {
    const px = b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })
    const up = v => v > 0.01
    const exploring = explore !== "universe"
    const showing = []
    if (up(hudLevel)) showing.push("cockpit")
    if (up(hudLevel * presLabel) && exploring && navBeacons.some(b => !!b)) showing.push("beacons")
    if (up(gateNames * presLabel) && exploring && explore !== "flight") showing.push("names")
    if (cardShown && up(cardMix * gateNames * presCard)) showing.push("card")
    if (cardShown && cardBlurb !== "" && up(cardMix * gateGuide * presCard)) showing.push("blurb")
    if (up(hudLevel * presDial)) showing.push("dial words")
    else if (up(hudLevel * presSys)) showing.push("machine labels")
    if (railRows.length > 0 && up((touring ? gateNames : gateGuide) * presHints)) showing.push(touring ? "tour keys" : "hints")
    if (captionUp) showing.push("caption")
    if (captionWords > 0 && up(gateGuide * presCaption)) showing.push("caption detail")
    if (up(sysHover * gateNames)) showing.push("hover hint")
    if (storyShow > 0.01) showing.push("story caption")
    if (anatOut && up(anatMix * presAnat)) showing.push("anatomy")
    return JSON.stringify({ level: textLevel, hold: textHold, film: film, shown: textShown, showing: showing, screens: Quickshell.screens.map(s => {
      const l = layOf(s), e = Lay.hudExtent(l), h = Lay.hudAt(l, [hudDrift.x, hudDrift.y])
      return { screen: s.name, size: [s.width, s.height],
               safe: { x0: Math.round(l.safe.x0), y0: Math.round(l.safe.y0), x1: Math.round(l.safe.x1), y1: Math.round(l.safe.y1) },
               rail: { x: Math.round(l.rail.x), w: Math.round(l.rail.w), bottom: Math.round(l.rail.bottom) },
               caption: { x: Math.round(l.caption.x), w: Math.round(l.caption.w), bottom: Math.round(l.caption.bottom) },
               story: { x: Math.round(l.story.x), y: Math.round(l.story.y), w: Math.round(l.story.w) },
               hud: { scale: Math.round(h.s * 1000) / 1000, centre: [Math.round(h.cx), Math.round(h.cy)], radius: Math.round(h.R), reach: px(e) } }
    }) })
  }

  // Pointer parallax: the pointer over the desktop shifts each layer by its
  // depth; `view` eases toward `viewTarget` (both -0.5..0.5 from the centre).
  property vector2d view: Qt.vector2d(0, 0)
  property vector2d viewTarget: Qt.vector2d(0, 0)

  // Explore modes, each ended by Esc or a fullscreen window:
  //   "universe"  the default view
  //   "flight"    cruise through the stars: W/S thrust, A/D R/F strafe.
  //               Middle double-click the desktop, or
  //               `omarchy-shell background navigate`.
  //   "system"    the solar system up close: scroll to zoom, drag to pan,
  //               click a planet (or 1-6, Tab for the next, 0 for the sun) to
  //               pin the camera to it, right-drag or arrows to orbit the
  //               camera, O to orbit on its own, [ ] to slow down or speed up
  //               time, WASD pan, Q/E zoom. V with a planet pinned: chase
  //               view, a 3D camera behind the planet looking toward the sun
  //               along the planet-sun vector (scroll moves it, X or a
  //               right-drag swings it off the line, Esc or V back). In the
  //               system view the pinned planet's vector to the sun shows as
  //               a dashed line. Click or scroll up over the solar system,
  //               Super+Alt+U, or `omarchy-shell background system`.
  // Flight and system take the keyboard while on.
  property string explore: "universe"
  readonly property bool navigating: explore === "flight"
  property real flight: 0
  property real flightSpeed: 0
  property real navMix: 0          // eased flight-mode amount, for the shader
  property real gxRealSky: 0
  property vector2d pan: Qt.vector2d(0, 0)
  property vector2d panVelocity: Qt.vector2d(0, 0)
  property var keysDown: ({})
  property real lastTick: Date.now()
  // One motion law for every fade (lib/camera.js): a critically damped spring,
  // exact for any frame time, settled (and snapped) 4.75/w seconds after its
  // goal last moved. Opacity and mode mixes only; the cameras come next.
  readonly property var mix: ({
    nav: new Cam.Spring(0, Cam.W_MODE),        // flight mode, for the shader
    speed: new Cam.Spring(0, 2),               // flight: cruise speed ramps slowly
    strafeX: new Cam.Spring(0, 4), strafeY: new Cam.Spring(0, 4),
    viewX: new Cam.Spring(0, 5), viewY: new Cam.Spring(0, 5),   // pointer parallax
    guide: new Cam.Spring(0, Cam.W_MODE),
    gal: new Cam.Spring(0, Cam.W_MODE),
    sky: new Cam.Spring(0, Cam.W_MODE),
    skyStatic: new Cam.Spring(0, Cam.W_MODE),
    galaxy: new Cam.Spring(0, Cam.W_MODE),
    hover: new Cam.Spring(0, Cam.W_MODE),
    sys: new Cam.Spring(0, Cam.W_MODE),        // overlays fade in with the system view
    chase: new Cam.Spring(0, Cam.W_MODE),      // labels give way to markers in the chase view
    yield: new Cam.Spring(1, Cam.W_MODE),      // the HUD steps back for a subject inside its ring
    exposure: new Cam.Spring(1, 1.3),          // the sky brightens slowly on an empty workspace
    fallFade: new Cam.Spring(0, 2.9),          // the fall's black, 2 s each way (0.98 at 2.0 s)
    anat: new Cam.Spring(0, Cam.W_MODE),       // the anatomy's lines: away on a journey, back on arrival
    lens: new Cam.Spring(0, Cam.W_MODE)        //   and where they are drawn: on the body, in the lens
  })

  onAnimateChanged: if (!animate && !sleeping) explore = "universe"
  onSleepingChanged: {
    if (!animate && !sleeping) explore = "universe"
    if (sleeping) fallReset()   // wake up beside the Sun, never inside the hole
  }
  // Flight and system grab the keyboard, so leave them as soon as the user
  // is on a workspace with windows (or switches away).
  onEmptyWorkspaceChanged: if (!emptyWorkspace) explore = "universe"
  onExploreChanged: {
    keysDown = ({})
    touchText()   // a view entered from a script or a binding brings its text up like a key does
    Hyprland.refreshMonitors()   // the bar may have come or gone: the safe rect follows
    if (explore !== "galaxy") { gxRateIndex = 0; fallReset(); gone("home") }
    if (explore !== "system") {
      chasing = false
      galactic = false
      galBack = false
      autoOrbit = false
      simRateIndex = 0
      if (camPose !== "universe") universePose(!animate)
    }
    setLimits()
  }

  readonly property real aspect: Quickshell.screens.length > 0
    ? Quickshell.screens[0].width / Quickshell.screens[0].height : 2.37

  // Solar system (see universe.frag), live: positions come from the real date
  // with JPL's approximate Keplerian elements (Standish, valid 1800-2050) at
  // J2000 and their rates per century: semi-major axis `au`, eccentricity `e`,
  // mean longitude `L` and longitude of perihelion `w` in degrees; inclination
  // `incl` and ascending node `node` are used by the galactic view (helio3),
  // while the overview keeps every orbit in the ecliptic. `a` and `r` are the
  // compressed distance and size for the overview; `km` is the real radius,
  // used at true scale in the chase view; `day` is the rotation period in
  // Earth days (negative is retrograde).
  readonly property var planetInfo: [
    { name: "Mercury", a: 0.050, r: 0.0028, km: 2439.7, day: 58.646,
      au: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], L: [252.25032350, 149472.67411175], w: [77.45779628, 0.16047689] , incl: [7.00497902, -0.00594749], node: [48.33076593, -0.12534081] },
    { name: "Venus",   a: 0.078, r: 0.0042, km: 6051.8, day: -243.025,
      au: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], L: [181.97909950, 58517.81538729], w: [131.60246718, 0.00268329] , incl: [3.39467605, -0.00078890], node: [76.67984255, -0.27769418] },
    { name: "Earth",   a: 0.110, r: 0.0045, km: 6371.0, day: 0.99727,
      au: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364] , incl: [-0.00001531, -0.01294668], node: [0.0, 0.0] },
    { name: "Mars",    a: 0.150, r: 0.0034, km: 3389.5, day: 1.02596,
      au: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088] , incl: [1.84969142, -0.00813131], node: [49.55953891, -0.29257343] },
    { name: "Jupiter", a: 0.225, r: 0.0105, km: 69911,  day: 0.41354,
      au: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668] , incl: [1.30439695, -0.00183714], node: [100.47390909, 0.20469106] },
    { name: "Saturn",  a: 0.305, r: 0.0085, km: 58232,  day: 0.44401,
      au: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216] , incl: [2.48599187, 0.00193609], node: [113.66242448, -0.28867794] }
  ]
  readonly property real auKm: 149597870.7
  readonly property real sunRadiusAu: 695700 / auKm
  readonly property real moonRadiusAu: 1737.4 / auKm
  // Earth's axial tilt and where we live (Amsterdam), for the globe marker
  readonly property real obliquity: 23.439 * Math.PI / 180
  readonly property real homeLat: 52.37
  readonly property real homeLon: 4.90

  // Simulated time (ms since the epoch). The universe view is always live;
  // in the system view [ ] step through these rates and N returns to now.
  readonly property var simRates: [1, 60, 3600, 86400, 604800, 2629800, 31557600]
  property int simRateIndex: 0
  readonly property real simRate: simRates[simRateIndex]
  property real simMs: Date.now()
  property var spins: [0, 0, 0, 0, 0, 0]
  property real earthTheta: 0
  property vector3d homeDir: Qt.vector3d(1, 0, 0)
  // Earth-Moon distance in the overview: exaggerated when zoomed out so the
  // Moon clears Earth, true (60 Earth radii) once zoomed in; and the real one
  property real moonOrbit: 0.024
  property real moonDistanceKm: 384400
  property vector3d moonFace: Qt.vector3d(1, 0, 0)

  // heliocentric ecliptic position (AU) of planet i at Julian date jd, in the
  // shader's frame: x = ecliptic x, y = ecliptic north, z = -ecliptic y
  function planetPos(pl, T) {
    const deg = Math.PI / 180
    const a = pl.au[0] + pl.au[1] * T
    const e = pl.e[0] + pl.e[1] * T
    const w = (pl.w[0] + pl.w[1] * T) * deg
    const M = ((pl.L[0] + pl.L[1] * T) * deg - w) % (2 * Math.PI)
    let E = M
    for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    const xp = a * (Math.cos(E) - e)
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
    const x = xp * Math.cos(w) - yp * Math.sin(w)
    const y = xp * Math.sin(w) + yp * Math.cos(w)
    return [x, 0, -y, a, e, w]
  }

  // geocentric Moon (AU) at days since J2000, low precision (~0.5 deg)
  function moonPos(d) {
    const deg = Math.PI / 180
    const L = (218.316 + 13.176396 * d) * deg
    const M = (134.963 + 13.064993 * d) * deg
    const F = (93.272 + 13.229350 * d) * deg
    const lon = L + 6.289 * deg * Math.sin(M)
    const lat = 5.128 * deg * Math.sin(F)
    const r = (385001 - 20905 * Math.cos(M)) / auKm
    return [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)]
  }
  // ---- the one camera (lib/camera.js) ----
  // The system overview, a pinned body and the universe's corner view are ONE
  // orbit camera: focus F (display units, doubles), view height h = e^ell at
  // the focus plane, yaw and pitch on the sphere around F, screen roll (-0.10,
  // the old SPIN), principal point o (where the corner view sits on screen),
  // field of view (2.4 degrees here: it looks orthographic) and sigma, the
  // world's scale blend 0 squeezed .. 1 true. Every channel moves on the same
  // critically damped spring; picks and view changes are van Wijk & Nuij
  // flights that any input interrupts; a tracked body is followed with zero
  // lag. The shader, picks, labels, markers and beacons all read its basis.
  readonly property real fovOrtho: Math.log(Math.tan(0.021))     // ln tan(fov/2): 2.4 degrees
  readonly property real fovPersp: Math.log(Math.tan(0.4636))    // 53 degrees: focal length 1
  readonly property var ecliptic: ({ n: [0, 1, 0], d: 0 })
  readonly property real overviewH: 1 / 3.2                   // view height of the system overview
  readonly property real overviewPitch: Math.asin(0.30)
  readonly property var sysCam: new Cam.Camera({ e1: [1, 0, 0], e2: [0, 0, 1], up: [0, 1, 0],
                                                 ell: [-60, 60], pitch: [Math.asin(0.12), Math.asin(0.98)] })
  property bool autoOrbit: false
  property string camPose: "universe"   // where the camera is or is heading: "universe" | "system"
  property int scaleAnchor: -1          // the body whose rescale the camera rides while sigma moves
  // Galactic view (G in the system view): the Solar System moving through the
  // Milky Way, drawn in the Galactic rest frame. The Sun moves at 248.9 km/s
  // (52.5 AU per year) toward ecliptic longitude 341.4, latitude +60.9 (Cygnus):
  // Reid & Brunthaler 2020, Schoenrich et al. 2010, IAU 2006 obliquity. Each
  // planet leaves the trail of where it has really been: long, stretched
  // helices around the Sun's straight path, its orbit tilted 61 degrees to the
  // direction of travel. Orbit tilts and nodes from JPL (Standish). `-` / `=`
  // slow the Sun's galactic speed so the coils show; the HUD says by how much.
  property bool galactic: false
  property real galMix: 0
  property int galSlowIndex: 0
  readonly property var galSlows: [1, 2, 5, 10, 20, 50, 100, 200]
  readonly property real galSlow: galSlows[galSlowIndex]
  onGalacticChanged: { setLimits(); touchText() }
  onGalBackChanged: setLimits()
  // a galactic-view pose as the eye's direction from the Sun, in the Sun's
  // velocity frame (yaw around the velocity's vertical, pitch above the plane)
  function galDir(yaw, pitch) {
    const f0 = sunVelocity, s0 = Cam.norm(Cam.cross(f0, [0, 1, 0])), u0 = Cam.norm(Cam.cross(s0, f0))
    return Cam.add(Cam.mul(Cam.add(Cam.mul(s0, Math.cos(yaw)), Cam.mul(f0, Math.sin(yaw))), Math.cos(pitch)), Cam.mul(u0, Math.sin(pitch)))
  }
  readonly property real galTrailYears: 2
  readonly property var sunVelocity: [0.46129, 0.87358, 0.15514] // shader frame: x, ecliptic north, -y
  readonly property real sunAuPerYear: 52.5
  readonly property var galColors: ["#ffd27a", "#9a9a9a", "#e8d3a3", "#5aa9ff", "#e0603a", "#d8b48a", "#e7cf8e"]
  property var galTrails: []   // per body (Sun, then the planets): screen points
  property var galNow: []      // per body: screen point and size now
  property vector4d galFlow: Qt.vector4d(0, 0, 0, 0) // dust drift: accumulated offset, screen direction
  property point galHeading: Qt.point(0, 0)           // screen direction the Sun is heading

  // Heliocentric position with the real orbit tilt (JPL elements at T Julian
  // centuries), in the shader frame and squeezed to the overview's distances.
  function helio3(pl, T) {
    const deg = Math.PI / 180
    const a = pl.au[0] + pl.au[1] * T
    const e = pl.e[0] + pl.e[1] * T
    const I = (pl.incl[0] + pl.incl[1] * T) * deg
    const O = (pl.node[0] + pl.node[1] * T) * deg
    const wbar = (pl.w[0] + pl.w[1] * T) * deg
    const M = ((pl.L[0] + pl.L[1] * T) * deg - wbar) % (2 * Math.PI)
    let E = M
    for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    const xp = a * (Math.cos(E) - e)
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
    const w = wbar - O
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I)
    const X = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp
    const Y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp
    const Z = (sw * sI) * xp + (cw * sI) * yp
    const k = pl.a / a
    return [X * k, Z * k, -Y * k]
  }

  // V in the galactic view: from just ahead of the Sun, look back along its path
  property bool galBack: false
  function toggleGalBack() {
    galBack = !galBack
    if (galBack && !guides) guides = true   // the paths are the point of this view
    const a = sysCam.anglesOf(galDir(galBack ? Math.PI / 2 : -0.7, galBack ? 0.12 : 0.35))
    sysCam.flyTo({ focus: [0, 0, 0], ell: Math.log(galBack ? 0.06 : 1.3), yaw: a.yaw, pitch: a.pitch })
  }
  // the same camera flies to the galactic pose (the Sun in focus, perspective,
  // the squeezed world) and back to the overview, re-pinning the body it had
  function toggleGalactic() {
    if (explore !== "system") return
    galactic = !galactic
    galBack = false
    if (galactic) {
      if (!chasing) { savedYaw = sysCam.yaw.x; savedPitch = sysCam.pitch.x }
      chasing = false
      if (simRateIndex < 4) simRateIndex = 4 // a week per second: Earth laps in under a minute
      if (scaleAnchor < 0) scaleAnchor = follow >= 1 ? follow : nearestBody()
      const a = sysCam.anglesOf(galDir(-0.7, 0.35))
      sysCam.flyTo({ focus: [0, 0, 0], ell: Math.log(1.3), yaw: a.yaw, pitch: a.pitch, fovT: fovPersp, roll: 0, sigma: 0, o: [0, 0] },
                   { time: 1.2, uScale: squeezeRatio(scaleAnchor) })
    } else {
      if (follow < 0) follow = 0
      const back = { yaw: savedYaw, pitch: savedPitch, fovT: fovOrtho, roll: -0.10 }
      if (follow >= 1) sysCam.flyTo(Object.assign({ track: bodyTrack(follow), ellRel: landingEllRel(follow), sigma: 1 }, back), { time: 1.2 })
      else sysCam.flyTo(Object.assign({ track: bodyTrack(0), ell: Math.log(overviewH), sigma: 0 }, back), { time: 1.2 })
    }
  }

  // ---- the Milky Way (X in the system view, IPC `milkyway`) ----
  // Our Galaxy at true scale, in kiloparsecs (Reid et al. 2019 frame: X toward
  // Galactic longitude 90, Y from the Centre to the Sun, Z north). galaxy.frag
  // draws the measured arms, bar, bulge and dust; these are real places to fly
  // to, from a catalog checked against Gaia/VLBI distances. Time-lapse turns
  // the disk around Sagittarius A* at the Sun's angular speed (30.3 km/s/kpc:
  // one lap in ~203 million years) with the Sun bobbing through the plane, and
  // carries the disk's objects along. Simplified: real disks shear (the inner
  // parts turn faster) and the arm pattern turns slower than the Sun.
  // generated from the verified catalog (scratchpad milkyway-data.json); kpc, Galactocentric
  readonly property var hotspots: [{"name": "Sagittarius A*", "kind": "blackhole", "label": "supermassive black hole and its star cluster", "pos": [0, 0, 0], "dpc": 8150, "size": 8, "color": "#ffb070", "blurb": "A black hole with the mass of about 4 million Suns, at the exact centre the whole Galaxy turns around."},
    {"name": "Orion Nebula", "kind": "nebula", "label": "star-forming nebula", "pos": [-0.17796, 8.47092, -0.10828], "dpc": 389, "size": 7, "color": "#e8708a", "blurb": "The nearest place where massive stars are being born, lit from inside by the young Trapezium stars."},
    {"name": "Pleiades", "kind": "cluster", "label": "open cluster with reflection nebula", "pos": [0.02879, 8.27058, -0.03315], "dpc": 135.2, "size": 4, "color": "#9fc3ff", "blurb": "A young blue cluster, about 100 million years old, drifting through a dust cloud that glows with its reflected light."},
    {"name": "Hyades", "kind": "cluster", "label": "open cluster", "pos": [-5e-05, 8.19347, 0.00294], "dpc": 47, "size": 18, "color": "#ffd9a0", "blurb": "The nearest star cluster of all, about 650 million years old: the V-shaped face of Taurus the Bull."},
    {"name": "Carina Nebula · Eta Carinae", "kind": "nebula", "label": "giant star-forming nebula · unstable giant double star", "pos": [-2.2399, 7.43959, -0.00504], "dpc": 2350, "size": 60, "color": "#ff7a6a", "blurb": "A vast star-forming cloud around Eta Carinae, one of the most massive and luminous stars known."},
    {"name": "Eagle Nebula", "kind": "nebula", "label": "star-forming nebula · young cluster NGC 6611", "pos": [0.50723, 6.48574, 0.04479], "dpc": 1740, "size": 20, "color": "#e07a5f", "blurb": "Home of the Pillars of Creation: columns of cold gas carved by ultraviolet light from its young stars."},
    {"name": "Lagoon Nebula", "kind": "nebula", "label": "star-forming nebula · young cluster NGC 6530", "pos": [0.13962, 6.82161, -0.00718], "dpc": 1336, "size": 30, "color": "#ff6f7f", "blurb": "A bright glowing cloud split by a dark lane of dust, seen close to the direction of the Galactic Centre."},
    {"name": "Crab Nebula", "kind": "remnant", "label": "supernova remnant lit by a pulsar", "pos": [-0.15809, 10.13353, -0.18076], "dpc": 2000, "size": 3.4, "color": "#e89a6a", "blurb": "The still-expanding debris of a supernova people watched in 1054, kept glowing by a pulsar that spins 30 times a second."},
    {"name": "Cygnus X / Cygnus OB2", "kind": "nebula", "label": "star-forming complex · massive young stars", "pos": [1.73425, 7.85107, 0.04537], "dpc": 1760, "size": 60, "color": "#c47a7a", "blurb": "One of the Galaxy's richest gatherings of massive young stars, hidden behind the dark Great Rift in Cygnus."},
    {"name": "Rosette Nebula", "kind": "nebula", "label": "star-forming nebula · young cluster NGC 2244", "pos": [-0.70401, 9.57446, -0.03746], "dpc": 1590, "size": 40, "color": "#ff6a6a", "blurb": "A ring of glowing gas, hollowed out by the winds of the young stars at its centre."},
    {"name": "Omega Centauri", "kind": "globular", "label": "globular cluster, probably the core of a swallowed dwarf galaxy", "pos": [-4.07092, 4.84166, 1.42344], "dpc": 5430, "size": 30, "color": "#ffe2b0", "blurb": "The Milky Way's most massive globular cluster: about ten million stars in one ball."},
    {"name": "47 Tucanae", "kind": "globular", "label": "globular cluster", "pos": [-2.59429, 6.27274, -3.16918], "dpc": 4520, "size": 20, "color": "#ffe6bb", "blurb": "A dense ball of ancient stars. In our sky it sits beside the Small Magellanic Cloud, which is 14 times farther away."},
    {"name": "Ring Nebula", "kind": "remnant", "label": "planetary nebula: a dying star's shell", "pos": [0.68408, 7.804, 0.21165], "dpc": 790, "size": 0.3, "color": "#7fd1c0", "blurb": "The shell of gas a dying Sun-like star has blown off; we look almost straight down its barrel."},
    {"name": "Helix Nebula", "kind": "remnant", "label": "planetary nebula: a dying star's shell", "pos": [0.06438, 8.0619, -0.148], "dpc": 201, "size": 1.5, "color": "#6fc3c8", "blurb": "One of the nearest dying-star shells, studded with thousands of comet-shaped knots."},
    {"name": "Westerlund 1", "kind": "cluster", "label": "young super star cluster", "pos": [-1.43945, 4.28975, -0.00796], "dpc": 4120, "size": 4, "color": "#ff9a5a", "blurb": "The most massive young star cluster known in the Galaxy, reddened by the dust between us."},
    {"name": "Betelgeuse", "kind": "star", "label": "red supergiant", "pos": [-0.05619, 8.30615, -0.00537], "dpc": 168, "size": 3.4e-05, "color": "#ffa060", "blurb": "A red supergiant so large that, in the Sun's place, it would swallow Mars and the asteroid belt."},
    {"name": "Alpha Centauri", "kind": "star", "label": "triple star system (A, B, Proxima)", "pos": [-0.00093, 8.14904, 0.02078], "dpc": 1.338, "size": 0.063, "color": "#fff4e0", "blurb": "The nearest stars to the Sun. The smallest of the three, Proxima, has at least one planet about as heavy as Earth."},
    {"name": "Vega", "kind": "star", "label": "blue-white star with a dust disc", "pos": [0.0067, 8.14722, 0.02333], "dpc": 7.68, "size": 0.001, "color": "#cad8ff", "blurb": "A bright star that spins once every 16 hours, ringed by a faint disc of dust."},
    {"name": "Polaris", "kind": "star", "label": "pulsating supergiant in a triple system", "pos": [0.10246, 8.21725, 0.0818], "dpc": 136.9, "size": 1.7e-06, "color": "#fff2d0", "blurb": "Today's north pole star, and the nearest pulsating Cepheid to the Sun."},
    {"name": "Sirius", "kind": "star", "label": "bright star with a white-dwarf companion", "pos": [-0.00191, 8.15177, 0.02039], "dpc": 2.64, "size": 0.0001, "color": "#d8e4ff", "blurb": "The brightest star in the night sky, circled by a white dwarf, Sirius B."},
    {"name": "Large Magellanic Cloud", "kind": "galaxy", "label": "satellite galaxy with a central bar", "pos": [-40.94813, 0.58289, -26.90795], "dpc": 49590, "size": 9000, "color": "#e6e2f0", "blurb": "The Milky Way's largest companion, a small galaxy in its own right. Its Tarantula Nebula is the most furious star factory in our whole Local Group."},
    {"name": "Small Magellanic Cloud", "kind": "galaxy", "label": "small irregular satellite galaxy", "pos": [-37.56312, -16.05778, -43.58825], "dpc": 62440, "size": 5800, "color": "#e8e4ee", "blurb": "A gas-rich dwarf galaxy, pulled out of shape by the Large Cloud and the Milky Way."},
    {"name": "Sagittarius Dwarf Spheroidal", "kind": "galaxy", "label": "dwarf galaxy being absorbed", "pos": [2.48612, -17.20543, -6.42588], "dpc": 26280, "size": 5000, "color": "#ffdcae", "blurb": "A dwarf galaxy the Milky Way is absorbing: its stars are strung in a stream that wraps the whole Galaxy."},
    {"name": "Andromeda Galaxy", "kind": "galaxy", "label": "spiral galaxy in our Local Group", "pos": [605.53871, 374.44407, -279.75147], "dpc": 761000, "size": 46000, "color": "#fff0d8", "blurb": "The nearest large spiral and the Local Group's biggest galaxy, closing on the Milky Way at about 110 km/s."},
    {"name": "Triangulum Galaxy", "kind": "galaxy", "label": "spiral galaxy in our Local Group", "pos": [519.51912, 503.0543, -436.751], "dpc": 840000, "size": 18700, "color": "#dfe6ff", "blurb": "A smaller, loosely wound spiral, busy with star-forming clouds such as NGC 604."},
    {"name": "Gum Nebula", "kind": "remnant", "label": "giant glowing shell, probably an old supernova remnant", "pos": [-0.4399, 8.2435, 0.0051], "dpc": 450, "size": 290, "color": "#c85a6a", "blurb": "A faint bubble of glowing gas 36 degrees wide in our sky, around the Vela supernova remnant."}]
  // from tools/deproject_galaxy.py: in-plane axes signed like the photo
  readonly property var m31Disk: {"major": [-0.09263, 0.69656, 0.71149], "minor": [0.64068, 0.58869, -0.49293], "normal": [-0.76220, 0.41018, -0.50080]}
  readonly property var m33Disk: {"major": [0.25011, 0.47969, 0.84103], "minor": [0.08069, 0.85529, -0.51182], "normal": [-0.96485, 0.19588, 0.17521]}
  // the galaxies drawn in 3D from their own photos hand over to the photo
  // card by view angle (lib/localgroup.js handoff): 1 the model, 0 the card
  property real m31Fade: 1
  property real m33Fade: 1
  property real lmcFade: 1
  property real smcFade: 1
  readonly property var gxModels: ({ "Andromeda": "m31", "Triangulum": "m33", "Large Magellanic": "lmc", "Small Magellanic": "smc" })
  function modelOf(h) { for (const k in gxModels) if (h.name.startsWith(k)) return gxModels[k]; return "" }
  function gxResetFades() { m31Fade = 1; m33Fade = 1; lmcFade = 1; smcFade = 1 }
  function v3(a) { return Qt.vector3d(a[0], a[1], a[2]) }
  function v4(a) { return Qt.vector4d(a[0], a[1], a[2], a[3]) }
  // the Large Magellanic Cloud's disk, bar and lopsidedness (lib/localgroup.js)
  readonly property var lmcModel: LG.lmcModel(hotspots[gxIndex("Large Magellanic")].pos)
  // Andromeda's two close ellipticals, from the dwarf table: centre and
  // half-light radius (kpc); ellipticity, position angle (radians), M_V
  function ellUniform(name) { const d = Dw.find(name); return Qt.vector4d(d.pos[0], d.pos[1], d.pos[2], d.rh / 1000) }
  function ellShape(name) { const d = Dw.find(name); return Qt.vector4d(d.ell, d.pa * Math.PI / 180, d.mv, 0) }

  property real galaxyMix: 0
  property var gxTarget: [0, 8.15, 0.0208]
  property var gxFree: [0, 8.15, 0.0208]
  property real gxDist: 0.001
  property real gxDistGoal: 30
  property real gxYaw: 0.35
  property real gxYawTarget: 0.35
  property real gxPitch: 0.95
  property real gxPitchTarget: 0.95
  // the orbit's angles glide to their targets on critically damped springs
  // (lib/camera.js): keys move the targets at input stiffness, the drag writes
  // the state and throws it on release (lib/drag.js), a flight aims (gxAim)
  // at a one-second glide that keeps pace with the distance, restored once it
  // lands
  readonly property var gxOrbit: ({ yaw: new Cam.Spring(0.35, Cam.W_INPUT), pitch: new Cam.Spring(0.95, Cam.W_INPUT) })
  readonly property real wGlide: 4.75   // 95% of a flight's turn in 1 s
  // T: the turn settles with a trip of that many seconds (the way home)
  function gxAim(yaw, pitch, T) {
    gxYawTarget = yaw + Math.round((gxYawTarget - yaw) / (2 * Math.PI)) * 2 * Math.PI
    gxPitchTarget = Math.max(-1.45, Math.min(1.45, pitch))
    gxOrbit.yaw.w = T ? 4.75 / T : wGlide; gxOrbit.pitch.w = gxOrbit.yaw.w
  }
  property int gxSel: -1           // hotspot index; -1 the Sun, -2 free flight
  property real gxMyr: 0           // time-lapse, million years from now
  property int gxRateIndex: 0
  readonly property var gxRates: [0, 0.1, 1, 5, 20]
  readonly property var gxRateNames: ["PAUSED", "100,000 YEARS/S", "1 MILLION YEARS/S", "5 MILLION YEARS/S", "20 MILLION YEARS/S"]
  readonly property real sunR0: 8.15
  readonly property real sunOmega: 30.32 / 977.79 // radians per million years
  property real gxExposure: 3.0
  property vector3d gxCamPos: Qt.vector3d(0, 8.15, 30)
  property var gxCam: [0, 8.15, 30]               // the same eye in doubles (the anatomy's lines are worked out from it)
  property vector3d gxFwd: Qt.vector3d(0, 0, -1)
  property vector3d gxRight: Qt.vector3d(1, 0, 0)
  property vector3d gxUp: Qt.vector3d(0, 1, 0)
  property real gxStars: 1
  property vector4d gxFocus: Qt.vector4d(0, 0, 0, 0)
  property vector4d gxFocusCol: Qt.vector4d(1, 1, 1, 4)
  property var gxScreen: []        // per hotspot, then the Sun: screen point, label shown
  readonly property var gxKinds: ({ nebula: 0, cluster: 1, globular: 2, remnant: 3, star: 4, blackhole: 5, galaxy: 6 })
  function gxIndex(name) { return hotspots.findIndex(h => h.name.startsWith(name)) }
  // any place by name prefix (IPC `fly`): a hotspot first, then a dwarf galaxy; -1 for none
  function placeIndex(name) {
    const h = gxIndex(name)
    if (h >= 0 || name === "") return h
    const d = dwarfPlaces.findIndex(p => !p.hidden && p.name.startsWith(name))
    return d >= 0 ? hotspots.length + 1 + d : -1
  }
  function gxGalaxy(name, scale) {
    const h = hotspots[gxIndex(name)]
    return Qt.vector4d(h.pos[0], h.pos[1], h.pos[2], scale)
  }
  readonly property vector4d m31Pos: gxGalaxy("Andromeda", 1.0) // its own map is in true kpc
  readonly property vector4d m33Pos: gxGalaxy("Triangulum", 1.0) // so is Triangulum's
  // The places of the view, by one index: the hotspots, then the Sun
  // (gxSunIndex), then the dwarf galaxies of lib/dwarfs.js as places of
  // their own (lib/localgroup.js dwarfPlace). gxSel, gxScreen, the markers,
  // the click and the HUD card all go through place(i); Tab cycles the
  // hotspots only. galaxy.frag draws the dwarfs in 3D; they get a marker up
  // close, under the pointer or when chosen, so the sky is not a field of dots.
  readonly property var dwarfPlaces: Dw.list().map(d => LG.dwarfPlace(d))
  readonly property int gxSunIndex: hotspots.length
  function place(i) { return i < hotspots.length ? hotspots[i] : dwarfPlaces[i - hotspots.length - 1] }
  property var gxPointer: null     // the pointer in p units (x, y) and the size of a pixel, while it is over the Milky Way view
  property int gxHover: -1         // the place under it
  // ---- named viewpoints (V, IPC `fly "Milky Way from Andromeda"`): stand somewhere real and look ----
  // From Andromeda, 761 kpc away, our Galaxy is a spindle about 2.7 degrees
  // long (its 34 kpc of disk: five full Moons), 21 degrees from edge-on and
  // seen from the south, since Andromeda lies at Galactic latitude -21.6.
  // The camera stands 35 kpc short of Andromeda's centre on our side (its
  // drawn disk ends at 24.5 kpc, and our line of sight is 13 degrees from its
  // plane: from inside, its own light would fog the whole view white) and
  // looks at Sagittarius A*; scrolling in crosses the gap along that line.
  // The name is what IPC `fly` matches by prefix; the card shows it.
  readonly property var gxViews: [{ name: "Milky Way from Andromeda", from: "Andromeda", standoff: 35, at: [0, 0, 0],
    label: "2.5 MILLION LY FROM HOME  ·  OUR GALAXY SPANS ABOUT 2.7° OF SKY, FIVE FULL MOONS SIDE BY SIDE",
    blurb: "From Andromeda's outskirts the Milky Way is a slim tilted oval, 21 degrees from edge-on, showing its southern face, with the Magellanic Clouds beside it. The light arriving here left home 2.5 million years ago, when our ancestors were making their first stone tools. Scroll in to fly home along this line." }]
  property int gxView: -1
  function gxGoView(i) {
    if (fallState) return
    const v = gxViews[i]
    const o = LG.viewFrom(hotspotPos(gxIndex(v.from)), v.at, v.standoff)
    gone("home")
    gxFallArmed = false
    gxSel = -2
    gxFree = v.at.slice()
    gxView = i
    gxAim(o.yaw, o.pitch)
    gxDistGoal = o.dist
    touchText()
  }
  readonly property vector4d lmcPos: { const h = hotspots[gxIndex("Large Magellanic")]; return Qt.vector4d(h.pos[0], h.pos[1], h.pos[2], h.size / 4000) }
  readonly property vector4d smcPos: { const h = hotspots[gxIndex("Small Magellanic")]; return Qt.vector4d(h.pos[0], h.pos[1], h.pos[2], h.size / 4000) }

  function sunPosAt(myr) {
    const b = sunOmega * myr
    // vertical oscillation through the plane: ~70 pc, ~70 million years
    // (approximate; it matches today's 21 pc height and ~7 km/s northward)
    const z = 0.07 * Math.sin(2 * Math.PI * myr / 70 + 0.301)
    return [sunR0 * Math.sin(b), sunR0 * Math.cos(b), z]
  }
  function hotspotPos(i) {
    const h = place(i)
    const p = h.pos
    if (h.kind === "galaxy" || Math.hypot(p[0], p[1]) > 20) return p // not in the disk: not carried
    const b = sunOmega * gxMyr
    const c = Math.cos(b), sn = Math.sin(b)
    // the Sun's neighbours bob through the plane with it
    const near = Math.hypot(p[0], p[1] - sunR0, p[2]) < 0.3 ? sunPosAt(gxMyr)[2] - sunPosAt(0)[2] : 0
    return [p[0] * c + p[1] * sn, p[1] * c - p[0] * sn, p[2] + near]
  }
  function gxViewDist(i) {
    const h = place(i)
    if (h.kind === "blackhole") return 20 * rsKpc // straight down to the event horizon
    return h.kind === "star" ? 0.0005 : Math.max(0.0015, h.size / 1000 * 3.2)
  }
  // closest approach: 0.2 pc anywhere, down to 6 Schwarzschild radii at Sgr A*
  readonly property real rsKpc: 4.11e-10
  property vector3d gxCamRs: Qt.vector3d(0, 1e6, 0)   // camera from Sgr A*, in Schwarzschild radii
  // the tick, near the hole: the camera is this frame's, for the tracers to
  // take (a signal, because the tick cannot see the per-screen passes);
  // lively: it is moving
  signal holeSync(bool lively)
  property bool gxHoleNear: false
  function gxMinDist() {
    if (gxSel >= 0 && place(gxSel).kind === "blackhole") return 6 * rsKpc
    // a place with a photo: no closer than where its 2048 px fill ~1.4 screen heights
    if (gxSel >= 0 && photoOf(gxSel)) return photoWidthKpc(gxSel) * 0.7
    return 0.0002
  }
  // ---- the fall into Sgr A* (lib/fall.js, lib/kerr.js) ----
  // B flies to the hole, B again goes down to 6 Rs on the spin axis, and
  // parked there B (or one more scroll in) lets go; free flight that carries
  // the camera below the horizon falls too. From there on nothing steers: the
  // camera rides the free-fall trajectory down the axis, and where it looks
  // is scripted (fall.js look()): down at the hole, a glance back at the sky
  // being left, the shadow's rim held in the lower part of the screen
  // through the horizon (for someone falling in the shadow is never more
  // than 80 degrees across: it does not fill half the sky), a slow look
  // around inside. The picture's exposure follows what is in view
  // (gxHoleExp). Drag and the arrows only look around, on top of that
  // (gxLook below). The phases ("falling", "outer-horizon", "inner-horizon";
  // in mathematics mode on through "ring" and "other-universe") come from
  // fall.js and go to the HUD and status(). At the end the screen fades to
  // black ("out"), holds two seconds, and the way home begins ("in": the
  // same return every view of the Galaxy has, below). Esc ends the fall by
  // the same road; leaving the view, sleep or a fullscreen window reset it
  // all.
  //
  // The realistic ending is told, not just cut (fall.js): the fall is shown
  // slowing into the inner horizon over 6 s, the light falling in after us
  // closes in from the pole we fell from (fallClose, universe.frag), and
  // only then the fade. What it is goes to the story band (say): fall.js
  // names the events (the glance back, the event horizon, the inner horizon
  // and, in mathematics mode, the ring and the other universe) and the band
  // gives each its reading time, at every text level.
  //
  // The spin: a/M = 0.94, one of the EHT 2022 Sgr A* Paper V favoured models (a MAD
  // flow at 30 degrees inclination; Daly et al. 2024 find ~0.9 from the
  // outflow method, Fragione & Loeb 2020 argue for < 0.1 from the S stars'
  // orbits). It is not measured: one number here changes it, and 0 gives
  // the Schwarzschild hole this replaced. In Schwarzschild radii, M = 0.5.
  readonly property real holeSpin: 0.94 * 0.5
  readonly property real holeRPlus: Kerr.horizons(holeSpin).rPlus   // the outer horizon, Rs (0.67 at this spin; 1 at a = 0)
  // the spin axis, 30 degrees off our line of sight from the Sun's side, the
  // gas turning clockwise on the sky (EHT 2022; GRAVITY flare loops); the
  // fall goes down this line, from the pole on the camera's side
  readonly property vector3d holeSpinAxis: Qt.vector3d(0, -Math.sqrt(3) / 2, 0.5)
  // Mathematics mode (K, or IPC mathMode): the fall follows the maximally
  // extended Kerr solution through the inner horizon, the disk inside the
  // ring and into the negative-r universe. Beyond tested physics: a
  // from-rest fall cannot even get there (fall.js), so the mode plunges at
  // 0.8 c. One fall with two endings: the realistic one stops where the
  // equations stop predicting, this one follows them on. Off by
  // default, not remembered; a change takes effect at the next fall.
  property bool mathMode: false
  property string fallPhase: ""         // the fall's phase, then its return: "out" (to black) and "in" (flying home)
  property string fallWhere: ""         // the fall's phase alone (fall.js), kept through the fade: the hint and the card describe where the fall ended
  property bool fallMath: false         // the running (or just finished) fall's mode: K mid-fall applies to the next one, the captions keep this
  property var fallState: null          // Fall.begin() state, plus x (the pole we fell from) and the eased fwd/up
  property real fallR: 6                // radius, Schwarzschild radii, signed: negative on the far sheet
  property bool fallInside: false       // below the outer horizon (set once, not per frame: the hints bind to it)
  property real fallLeft: 0             // proper time to the end (the inner horizon; math: -12 Rs), s
  property real fallRate: 1             // proper seconds per screen second (the approach is compressed)
  property real gxFallE: 0              // the energy per unit mass of the frame the view is drawn in, for the shaders (0: not falling)
  property real gxHoleExp: 1            // the hole's picture's exposure: the falling eye's adaptation (fall.js), 1 hovering
  property real gxCamSheet: 1           // -1 once through the disk: the shaders' r < 0 sheet
  property real fallFlash: 1            // > 1 in the last seconds before the inner horizon: the glow's blueshift (cartoon)
  property real fallClose: 0            // 0..1 over the last 5 s before the inner horizon: its light closing in (cartoon)
  property real fallFade: 0             // 0..1 black
  property bool fallInvite: false       // back from a realistic fall: the hints offer the mathematics
  property bool gxParkedAtHole: false   // Sgr A* chosen, camera at its closest approach: B lets go
  property bool gxFallArmed: false      // B pressed again on the way down: let go on arrival
  property bool gxCamJumped: false      // the camera was placed, not flown: no path to test this frame
  // looking around while falling: an offset on top of the scripted view, yaw
  // about its up and pitch about its right (radians). It turns the camera
  // only: the trajectory and the falling observer's frame stay radial. After
  // 2.5 s without input it eases back (1.5 s per e-fold), so the scripted
  // framing returns on its own: the script keeps turning on the way down
  // and a held offset would lose it.
  // Set over IPC (fallLook) it holds until the next drag or arrow.
  property real gxLookYaw: 0
  property real gxLookPitch: 0
  property real gxLookYawTarget: 0
  property real gxLookPitchTarget: 0
  property real gxLookIdle: 0           // seconds since the last look input
  property bool gxLookHold: false       // set over IPC: no easing back
  property bool gxLookDragging: false   // a look drag is held: a still pointer is not a pause
  function fallLookBy(dYaw, dPitch) {
    gxLookYawTarget += dYaw   // all the way round: straight back at the hole, or up at the sky
    gxLookPitchTarget = Math.max(-1.45, Math.min(1.45, gxLookPitchTarget + dPitch))   // never over the top
    gxLookIdle = 0
    gxLookHold = false
  }
  function fallLookSet(yaw, pitch) {
    gxLookYawTarget = yaw
    gxLookPitchTarget = Math.max(-1.45, Math.min(1.45, pitch))
    gxLookIdle = 0
    gxLookHold = true
  }
  function fallLookReset() {
    gxLookYaw = 0; gxLookPitch = 0
    gxLookYawTarget = 0; gxLookPitchTarget = 0
    gxLookIdle = 0
    gxLookHold = false
  }
  // the pole of the spin axis on the camera's side (unit, world): where the
  // fall is let go from, on the axis
  function holePole(cam) {
    const ax = [holeSpinAxis.x, holeSpinAxis.y, holeSpinAxis.z]
    const side = cam[0] * ax[0] + cam[1] * ax[1] + cam[2] * ax[2] >= 0 ? 1 : -1
    return [ax[0] * side, ax[1] * side, ax[2] * side]
  }
  // the Kerr (Boyer-Lindquist) radius of a point p (world, Rs) on our sheet:
  // the horizon is a surface of constant r, not of constant distance (r+ is
  // 0.67 Rs on the axis and the Cartesian distance sqrt(r+^2 + a^2) = 0.82
  // on the equator)
  function kerrRadius(p) {
    const z = p[0] * holeSpinAxis.x + p[1] * holeSpinAxis.y + p[2] * holeSpinAxis.z
    const rho2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2]
    return Kerr.ksRadius([Math.sqrt(Math.max(rho2 - z * z, 0)), 0, z], holeSpin, 1)
  }
  // is the orbit camera on the pole (within half a degree)?
  function gxAtPole() {
    const o = [Math.cos(gxPitch) * Math.sin(gxYaw), Math.cos(gxPitch) * Math.cos(gxYaw), Math.sin(gxPitch)]
    const pole = holePole(o)
    return o[0] * pole[0] + o[1] * pole[1] + o[2] * pole[2] > Math.cos(0.5 * Math.PI / 180)
  }
  // steer the orbit camera to that pole (the easing takes it there in ~1.5 s)
  function gxAimAtPole() {
    const o = [Math.cos(gxPitch) * Math.sin(gxYaw), Math.cos(gxPitch) * Math.cos(gxYaw), Math.sin(gxPitch)]
    const pole = holePole(o)
    gxAim(Math.atan2(pole[0], pole[1]), Math.asin(pole[2]))
    gxView = -1
  }
  // at: where the fall starts (kpc), when not the camera's last position. The
  // fall is always down the axis: from the pole on that side, at that radius
  // (a jump when free flight crossed the horizon off the axis: the rare path)
  function fallBegin(rStart, at) {
    if (fallState || explore !== "galaxy") return
    const cam = at || [gxCamPos.x, gxCamPos.y, gxCamPos.z]
    const F = Fall.begin(rStart, holeSpin, mathMode)
    F.x = holePole(cam)
    F.fwd = [gxFwd.x, gxFwd.y, gxFwd.z]
    F.up = [gxUp.x, gxUp.y, gxUp.z]
    // the side we turn toward once inside: where we already look, else north
    const fr = F.fwd[0] * F.x[0] + F.fwd[1] * F.x[1] + F.fwd[2] * F.x[2]
    let t = [F.fwd[0] - F.x[0] * fr, F.fwd[1] - F.x[1] * fr, F.fwd[2] - F.x[2] * fr]
    // looking straight down the axis (the parked view): the screen's up, so the view does not roll as the fall starts
    if (Math.hypot(t[0], t[1], t[2]) < 1e-3) { const ur = F.up[0] * F.x[0] + F.up[1] * F.x[1] + F.up[2] * F.x[2]; t = [F.up[0] - F.x[0] * ur, F.up[1] - F.x[1] * ur, F.up[2] - F.x[2] * ur] }
    if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = [-F.x[0] * F.x[2], -F.x[1] * F.x[2], 1 - F.x[2] * F.x[2]]
    if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = [1, 0, 0]
    const tl = Math.hypot(t[0], t[1], t[2])
    F.t = [t[0] / tl, t[1] / tl, t[2] / tl]
    F.next = Fall.next(F.tl, Fall.tau(F.tl, F.s))
    fallState = F
    fallLookReset()
    fallPhase = "falling"
    fallWhere = "falling"
    fallMath = F.tl.math
    fallInvite = false
    gxFallArmed = false
    gxCamSheet = 1
    fallFlash = 1
    fallClose = 0
    gxFallE = Fall.viewE(F.tl, F.s)
    gxHoleExp = 1
    gxSel = gxIndex("Sagittarius A")
    gxTarget = [0, 0, 0]
    keysDown = ({})
  }
  // B: the hole; B again (on the way or there): down to 6 Rs on the spin
  // axis and let go on arrival; parked there: let go now (if the camera was
  // dragged off the pole, it glides there first and lets go on arrival)
  function gxB() {
    const hole = gxIndex("Sagittarius A")
    if (gxParkedAtHole && gxAtPole()) fallBegin(gxDist / rsKpc)
    else if (gxParkedAtHole) { gxAimAtPole(); gxFallArmed = true }
    else if (gxSel === hole) { gxDistGoal = gxMinDist(); gxAimAtPole(); gxFallArmed = true }
    else gxFlyTo(hole)
  }
  // the fall is over: the shaders are back in the hovering frame
  function fallEnd() {
    fallState = null
    fallLookReset()
    gxFallE = 0
    gxHoleExp = 1
    gxCamSheet = 1
    fallFlash = 1
    fallClose = 0
    fallInside = false
  }
  // leaving the view, sleep: no fall and no return under way, the camera at home
  function fallReset() {
    fallInvite = false
    if (fallState || gxReturn) {
      fallEnd()
      say("fall", "", "")
      gxSel = -1; gxDistGoal = gxHomePose.dist
      gxPlace(sunPosAt(gxMyr), gxHomePose.dist, sunOmega * gxMyr + gxHomePose.yaw, gxHomePose.pitch)
    }
    gxReturn = null
    fallPhase = ""
    mix.fallFade.set(0); fallFade = 0
  }

  // ---- travel in the Milky Way view, and the way home (lib/camera.js) ----
  // The focus and the distance ride gxVoyage (the tick steps it toward the
  // chosen place); the orbit angles are gxOrbit's springs. gxPlace puts the
  // camera somewhere without flying.
  //
  // Home is one pose: the Sun in the middle of the screen with its Galaxy
  // around it (gxHomePose), where the view opens (enterGalaxy) and where
  // every return lands: 0, a click on the Sun, IPC `fly sun`, Esc at any
  // place of the view or during a fall, and the end of both falls all call
  // gxHome, which takes no argument:
  // where the camera is decides how it goes. From a view that can be flown
  // out of it is a flight; from inside the hole (a fall under way) the
  // screen goes black first, the view opens over the Galactic Centre (gxCentrePose) and, once
  // the picture is half back, the same flight goes out along the disk to the
  // Sun, the Galaxy in frame all the way. On arrival the Sun's marker and its card come up, and
  // the story band says where we are: "Back home", after every return.
  readonly property var gxVoyage: new Cam.Voyage([0, 8.15, 0.0208], 0.001)
  readonly property var gxHomePose: ({ dist: 34, yaw: 0.35, pitch: 1.0 })
  readonly property var gxCentrePose: ({ dist: 1.2, pitch: 0.45 })
  property var gxReturn: null           // the return under way (Cam.homeBegin), or null
  function gxHome() {
    if (gxReturn) return                 // on the way home already
    const falling = !!fallState
    gxReturn = Cam.homeBegin(falling)
    gxReturn.fall = falling              // what to say on arrival
    gxReturn.math = fallMath
    if (falling) {
      say("fall", "", "")                // nothing more of the fall's story comes up on the way home
      fallPhase = "out"
    }
  }
  function gxPlace(focus, dist, yaw, pitch) {
    gxVoyage.place(focus, dist)
    gxTarget = focus.slice(); gxFree = focus.slice()
    gxDist = dist
    gxYaw = yaw; gxPitch = pitch
    gxYawTarget = yaw; gxPitchTarget = pitch
    gxOrbit.yaw.set(yaw); gxOrbit.pitch.set(pitch)
    gxPrevCam = null; gxSpeed = 0   // a jump is not a speed
    gxCamJumped = true
  }
  // one frame of the return (the tick, before the travel)
  function gxReturnStep(dt) {
    const H = gxReturn
    if (H.phase === "flight" && gxSel !== -1) {          // another place was chosen on the way
      gxReturn = null
      if (fallPhase === "in") fallPhase = ""
      return
    }
    const ev = Cam.homeStep(H, dt, fallFade, gxVoyage.arrived())
    if (ev === "place") {
      fallEnd()
      // over the Galactic Centre, parked there until the flight departs
      gxSel = -2
      gxDistGoal = gxCentrePose.dist
      gxPlace([0, 0, 0], gxCentrePose.dist, sunOmega * gxMyr + gxHomePose.yaw, gxCentrePose.pitch)
      fallPhase = "in"
    }
    if (ev === "depart") {
      gxFallArmed = false
      gxView = -1
      gxSel = -1
      gxDistGoal = gxHomePose.dist
      gxAim(sunOmega * gxMyr + gxHomePose.yaw, gxHomePose.pitch, Cam.HOME_S)
      gxVoyage.depart(Cam.HOME_S)
      touchText()
    }
    if (ev === "arrive") {
      touchText()                                        // the Sun's marker and its card
      say("home", "Back home", "The Sun: one star in the Orion Arm, 26,600 light-years from the centre of the Milky Way.")
      if (H.fall) fallInvite = !H.math
      if (fallPhase === "in") fallPhase = ""
      gxReturn = null
    }
  }
  function gxFlyTo(i) {
    if (fallState) return   // below the horizon, or on the way: nothing steers
    if (i === -1) { gxHome(); return }
    gone("home")            // leaving again: "Back home" is said at home only, and goes with it
    gxFallArmed = false
    gxView = -1
    touchText()
    if (i >= 0 && photoOf(i)) {
      // come in from Earth's side, as the photo was taken, framed to fill the view
      const P = hotspotPos(i), Sn = sunPosAt(gxMyr)
      const o = [Sn[0] - P[0], Sn[1] - P[1], Sn[2] - P[2]]
      const ol = Math.hypot(o[0], o[1], o[2])
      gxAim(Math.atan2(o[0], o[1]), Math.asin(o[2] / ol))
      gxSel = i
      gxDistGoal = Math.max(photoWidthKpc(i) / 0.85, gxMinDist())
      return
    }
    gxSel = i
    gxDistGoal = gxViewDist(i)
  }
  // entered the Milky Way from the solar system: stepping back returns there
  property bool gxFromSystem: false
  function enterGalaxy() {
    if (!emptyWorkspace) return
    fallReset()
    gxFallArmed = false
    gxView = -1
    touchText()
    gxFromSystem = explore === "system"
    explore = "galaxy"
    gxMyr = 0
    gxRateIndex = 0
    // out of the Sun's neighbourhood, up to the home view
    gxSel = -1
    gxPlace(sunPosAt(0), 0.0008, gxHomePose.yaw, 0.25)
    gxDistGoal = gxHomePose.dist
    gxAim(gxHomePose.yaw, gxHomePose.pitch)
  }
  function sizeText(pc) {
    const ly = pc * 3.26156
    if (ly >= 0.01) return lightYears(pc)
    const au = pc * 206264.8
    return (au >= 10 ? Math.round(au) : au.toFixed(au >= 1 ? 1 : 2)) + " AU"
  }
  function lightYears(pc) {
    const ly = pc * 3.26156
    return ly >= 1e6 ? (ly / 1e6).toFixed(ly >= 1e7 ? 0 : 1) + " million ly"
         : ly >= 10 ? Math.round(ly).toLocaleString(Qt.locale("en_US"), "f", 0) + " ly"
         : ly.toFixed(ly >= 1 ? 1 : 3) + " ly"
  }

  // ---- Sky mode (Super+Alt+K, IPC `sky`): the real sky around Earth ----
  // NASA SVS Deep Star Maps 2020 (Gaia DR2 and more), galactic coordinates.
  // Look anywhere; the named views match the static 5K wallpapers
  // (tools/make_sky_views.py, 46 degrees per screen height), and when the
  // camera sits exactly on one, that native render fades in.
  readonly property var skyViews: [
    { name: "MILKY WAY CORE", note: "Sagittarius · the Galactic Centre", l: 0.0, b: -1.5, file: "sky-1-milky-way-core.jpg" },
    { name: "CYGNUS RIFT", note: "the Great Rift through the Summer Triangle", l: 78.0, b: 1.0, file: "sky-2-cygnus-rift.jpg" },
    { name: "AQUILA · SCUTUM", note: "the Scutum star cloud and Aquila's dust", l: 28.0, b: -1.5, file: "sky-3-aquila-scutum.jpg" },
    { name: "CARINA · SOUTHERN CROSS", note: "the Carina arm and the Coalsack", l: 295.0, b: -1.0, file: "sky-4-carina-southern-cross.jpg" },
    { name: "MAGELLANIC CLOUDS", note: "our two satellite galaxies, 160,000 and 200,000 ly away", l: 291.0, b: -38.0, file: "sky-5-magellanic-clouds.jpg" },
    { name: "CENTAURUS · NORMA", note: "toward the Norma and Scutum-Centaurus arms", l: 320.0, b: -0.5, file: "sky-6-centaurus-norma.jpg" },
    { name: "SCORPIUS · OPHIUCHUS", note: "the Rho Ophiuchi clouds above the bulge", l: 353.0, b: 16.0, file: "sky-7-scorpius-ophiuchus.jpg" }
  ]
  readonly property string skyDir: "file://" + Quickshell.env("HOME") + "/.local/share/universe-background/sky/"
  property real skyMix: 0
  property real skyL: 0
  property real skyLTarget: 0
  property real skyB: -1.5
  property real skyBTarget: -1.5
  property real skyVfov: 46
  property real skyVfovTarget: 46
  property int skyView: 0
  property bool skyDragging: false
  // l and b (degrees) glide to their targets on springs, as the Milky Way's
  // orbit does (gxOrbit): keys and the named views move the targets, the drag
  // writes the state and throws it
  readonly property var skyOrbit: ({ l: new Cam.Spring(0, Cam.W_INPUT), b: new Cam.Spring(-1.5, Cam.W_INPUT) })
  function skyFocal() { return 0.5 / Math.tan(skyVfov * Math.PI / 360) }
  property real skyStaticMix: 0
  property vector3d skyFwd: Qt.vector3d(0, -1, 0)
  property vector3d skyRight: Qt.vector3d(-1, 0, 0)
  property vector3d skyUp: Qt.vector3d(0, 0, 1)
  function enterSky(i) {
    if (!emptyWorkspace) return
    explore = "sky"
    skyGo(i === undefined ? skyView : i, true)
  }
  function skyGo(i, jump) {
    skyView = ((i % skyViews.length) + skyViews.length) % skyViews.length
    const v = skyViews[skyView]
    // the short way round in longitude
    let l = v.l
    while (l - skyLTarget > 180) l -= 360
    while (l - skyLTarget < -180) l += 360
    skyLTarget = l
    skyBTarget = v.b
    skyVfovTarget = 46
    if (jump) { skyL = l; skyB = v.b; skyVfov = 46; skyOrbit.l.set(l); skyOrbit.b.set(v.b) }
    else { skyOrbit.l.w = wGlide; skyOrbit.b.w = wGlide }
  }

  // real photos of the places (textures/photos.jpg, tools/make_atlas.py):
  // tile and width on the sky in arcminutes
  readonly property var photoTiles: {"Orion Nebula": [0, 35.49, "photos/orion-nebula.jpg"], "Carina Nebula": [1, 66.354, "photos/carina-nebula.jpg"], "Eagle Nebula": [2, 32.08, "photos/eagle-nebula.jpg"], "Lagoon Nebula": [3, 93.49, "photos/lagoon-nebula.jpg"], "Rosette Nebula": [4, 94.75, "photos/rosette-nebula.jpg"], "Crab Nebula": [5, 6.41, "photos/crab-nebula.jpg"], "Ring Nebula": [6, 2.484, "photos/ring-nebula.jpg"], "Helix Nebula": [7, 26.835, "photos/helix-nebula.jpg"], "Pleiades": [8, 69.321, "photos/pleiades.jpg"], "Omega Centauri": [9, 31.88, "photos/omega-centauri.jpg"], "47 Tucanae": [10, 42.067, "photos/47-tucanae.jpg"], "Westerlund 1": [11, 6.511, "photos/westerlund-1.jpg"], "Large Magellanic Cloud": [12, 266.122, "photos/large-magellanic-cloud.jpg"], "Small Magellanic Cloud": [13, 408.986, "photos/small-magellanic-cloud.jpg"], "Andromeda Galaxy": [14, 169.919, "photos/andromeda-galaxy.jpg"], "Triangulum Galaxy": [15, 68.01, "photos/triangulum-galaxy.jpg"]} // tile, width (arcmin), 2048 px close-up (Triangulum's tile is black until the atlas is rebuilt; its close-up loads in its place)
  property vector4d gxPhoto: Qt.vector4d(0, 0, 0, 0)
  readonly property var ncpDir: [0.74698, 0.48383, 0.45599] // celestial north pole (l 122.932, b 27.128), this frame
  function photoOf(i) {
    if (i < 0) return null
    const name = place(i).name
    for (const k in photoTiles) if (name.startsWith(k)) return photoTiles[k]
    return null
  }
  function photoWidthKpc(i) {
    const ph = photoOf(i)
    return ph ? place(i).dpc / 1000 * ph[1] / 60 * Math.PI / 180 : 0
  }

  // ---- chase view: two-point framing on the same camera ----
  // The camera sits behind a foreground body A (the pinned one) and looks
  // along the line to a target B (the Sun by default), A centred and B in
  // frame; X puts the eye exactly on the line or over the shoulder, E or a
  // click chooses another B, R swaps A and B. It is the overview camera dolly-
  // zoomed to a 53-degree field (view height held, so A keeps its size) with
  // its yaw riding the A-B azimuth, so the pair stays framed as they orbit.
  property bool chasing: false
  property int chaseTarget: 0        // B: 0 the Sun, 1..6 planets, 7 the Moon
  property bool chaseLocked: false   // the eye on the A-B line, or angled (yaw 0.35, pitch 0.18 off it)
  readonly property string chaseTargetName: bodyName(chaseTarget)
  property real savedYaw: 0          // the overview's orbit angles, restored on the way back
  property real savedPitch: Math.asin(0.30)
  function bodyName(i) { return i === 7 ? "Moon" : i > 0 ? planetInfo[i - 1].name : i === 0 ? "Sun" : "" }
  function chaseTrack(a, b) {
    return () => {
      const pa = bodyP(a), pb = bodyP(b), d = Cam.sub(pa, pb)
      return { p: pa, lnr: Math.log(bodyR(a)), az: Math.atan2(d[0], d[2]) }
    }
  }
  property real chaseMix: 0          // 0 overview .. 1 chase, for the overlays' opacity
  onChasingChanged: { mix.chase.g = chasing ? 1 : 0; setLimits(); touchText() }
  function chaseGoals() {
    sysCam.yaw.g = Cam.unwrap(sysCam.ref.az + (chaseLocked ? 0 : 0.35), sysCam.yaw.x)
    sysCam.pitch.g = chaseLocked ? 0 : 0.18
  }
  // the one scene for universe.frag's systemScene: every body relative to the
  // focus (the scene reference point), in display units, and the camera's
  // eye and basis relative to it
  property var sceneBodies: planetInfo.map(() => Qt.vector4d(0, 0, 0, 0))
  property vector4d sceneMoon: Qt.vector4d(0, 0, 0, 0)
  property vector4d sceneSun: Qt.vector4d(0, 0, 0, 0.006)
  property real scenePlaneY: 0
  property vector3d camPos: Qt.vector3d(0, 0.05, 0.3)
  property vector3d camFwd: Qt.vector3d(0, 0, -1)
  property vector3d camRight: Qt.vector3d(1, 0, 0)
  property vector3d camUp: Qt.vector3d(0, 1, 0)
  property real focal: 23.8
  property vector2d principal: Qt.vector2d(-0.64, 0.06)

  function toggleChase() {
    if (explore !== "system" || galactic) return
    if (chasing) { leaveChase(); return }
    if (follow < 0) return
    if (chaseTarget === follow) chaseTarget = follow === 0 ? 3 : 0
    savedYaw = sysCam.yaw.x; savedPitch = sysCam.pitch.x
    chasing = true
    sysCam.flyTo({ track: chaseTrack(follow, chaseTarget), yawRel: chaseLocked ? 0 : 0.35, pitch: chaseLocked ? 0 : 0.18,
                   fovT: fovPersp, roll: 0, sigma: 1, o: [0, 0] }, { time: 0.9 })
  }
  function leaveChase() {
    chasing = false
    sysCam.flyTo({ track: bodyTrack(follow), yaw: savedYaw, pitch: savedPitch, fovT: fovOrtho, roll: -0.10 }, { time: 0.9 })
  }
  // B: look along the line to another body (the next one, or a chosen one)
  function chaseLook(b) {
    if (b === undefined) { b = chaseTarget; do b = (b + 1) % 8; while (b === follow) }
    if (b === follow || b < 0 || b > 7) return
    chaseTarget = b
    sysCam.follow(chaseTrack(follow, chaseTarget))
    chaseGoals()
  }
  // swap A and B: stand behind the other one, looking back
  function chaseSwap() {
    const a = follow, b = chaseTarget
    follow = b
    chaseTarget = a
    sysCam.flyTo({ track: chaseTrack(b, a), ellRel: Math.log(16.7), yawRel: chaseLocked ? 0 : 0.35, pitch: chaseLocked ? 0 : 0.18 })
  }
  function setChaseLocked(on) {
    chaseLocked = on
    if (chasing) chaseGoals()
  }
  // the camera's ranges per view: zoom (ln of the view height) and pitch
  function setLimits() {
    if (explore !== "system") { sysCam.lim.ell = [-60, 60]; sysCam.lim.pitch = [Math.asin(0.12), Math.asin(0.98)] }
    else if (galactic) { sysCam.lim.ell = [Math.log(galBack ? 0.03 : 0.25), Math.log(8)]; sysCam.lim.pitch = [-1.4, 1.4] }
    else if (chasing) { const R = trueRadius(follow); sysCam.lim.ell = [Math.log(R * 2.2), Math.log(R * 3000)]; sysCam.lim.pitch = [-1.2, 1.2] }
    else { sysCam.lim.ell = [Math.log(1 / 150), Math.log(1 / 1.3)]; sysCam.lim.pitch = [Math.asin(follow > 0 ? 0.04 : 0.12), Math.asin(0.98)] }
  }

  // A tour's own keys (IPC `tourKeys "SPACE=next; B=back; ESC=leave"`, ""
  // ends it): while set, the rail shows these rows instead of the mode's
  // hints, at `names` and `full` (not at `off` or in a film, where only a
  // story caption shows), and no place card: the tour's caption is the card.
  property var tourKeys: []
  function setTourKeys(spec) {
    tourKeys = String(spec || "").split(";").map(r => r.split("=")).filter(r => r.length >= 2 && r[0].trim() !== "")
      .map(r => [r[0].trim().toUpperCase(), r.slice(1).join("=").trim()])
    touchText()
  }
  readonly property bool touring: tourKeys.length > 0
  // key hints in the rail, per mode
  readonly property var railRows: touring ? tourKeys : controlHints
  readonly property var textHint: ["T", "text: names / full / off (now " + textShown + ")"]
  readonly property int hintWords: Tx.words(railRows.map(r => r[0] + " " + r[1]).join(" "))
  readonly property var controlHints: explore === "flight" ? [
      ["W / S", "thrust forward / back"],
      ["A / D", "strafe left / right"],
      ["R / F", "up / down"],
      textHint,
      ["H", "cockpit on / off"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ] : explore === "sky" ? [
      ["1 - 7  /  TAB", "the named views"],
      ["DRAG / ARROWS", "look around (WASD too)"],
      ["SCROLL / Q E", "zoom"],
      anatHint,
      textHint,
      ["H", "cockpit on / off"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ] : explore === "galaxy" && fallState ? [
      // fallWhere, not fallPhase: the hint stays through the fade; the mode is
      // the running fall's, not the K key's current setting
      ["", fallWhere === "other-universe" ? "the far side of the ring: a universe that exists in the mathematics"
         : fallWhere === "ring" ? "through the open middle of the ring singularity: Kerr's mathematics, beyond tested physics"
         : fallWhere === "inner-horizon" ? (fallMath ? "the inner horizon: the mathematics leads on from here" : "the inner horizon: the edge of what physics can predict")
         : fallInside ? "inside the horizon: every path leads inward" : "free fall down the spin axis: gravity is flying now"],
      ["DRAG / ARROWS", "look around as you fall"],
      textHint,
      ["H", "cockpit on / off"],
      fallPhase !== "out" ? ["ESC / RIGHT-CLICK", "end the fall: fly home to the Sun"] : ["", "flying home: the Sun, 26,600 light-years out in the disk"]
    ] : explore === "galaxy" ? (fallInvite ? [["K, THEN B", "next time, follow the mathematics through the ring"]] : []).concat([
      ["TAB", "next place (shift: previous)"],
      ["0", "home: the Sun in its Galaxy"],
      gxParkedAtHole ? ["B / SCROLL IN", gxFallArmed ? "letting go in a moment (B: now)" : "let go: fall into the black hole"]
      : gxFallArmed ? ["SCROLL OUT / Q", "flying down: the fall starts on arrival (scroll out to stay parked)"]
      : gxSel >= 0 && place(gxSel).kind === "blackhole" ? ["B", "fly down to 6 radii and fall in (or scroll in, then B)"]
      : ["B", "visit the black hole at the centre"],
      ["K", mathMode ? "mathematics mode is on: the fall goes on through the ring, where only the equations lead" : "mathematics mode: follow Kerr's equations through the ring"],
      ["V", "the Milky Way from Andromeda"],
      ["CLICK", "fly to a place (hover to find the dwarf galaxies)"],
      ["DRAG / ARROWS", "orbit the camera"],
      ["SCROLL / Q E", "closer / farther"],
      ["WASD", "fly freely"],
      ["[  ]", "time-lapse: the Galaxy turns (" + gxRateNames[gxRateIndex].toLowerCase() + ")"],
      ["N", "back to now"],
      ["X", "the solar system"],
      anatHint,
      textHint,
      ["H", "cockpit on / off"],
      ["ESC / RIGHT-CLICK", gxSel !== -1 || gxView >= 0 ? "home: the Sun in its Galaxy" : gxFromSystem ? "back to the solar system" : "back to the universe"]
    ]) : explore !== "system" ? [] : galactic ? [
      ["-  =", galSlow === 1 ? "slow the Sun to see the coils" : "slower / faster Sun (now 1/" + galSlow + ")"],
      ["I", root.guides ? "hide the trails" : "show 2-year trails (guide lines)"],
      ["V", root.galBack ? "back to the side view" : "look back from the Sun along its path"],
      ["DRAG / ARROWS", "swing / tilt the camera"],
      ["SCROLL / Q E", "camera distance"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      anatHint,
      textHint,
      ["H", "cockpit on / off"],
      ["G / ESC / RIGHT-CLICK", "back to the system"]
    ] : chasing ? [
      ["X", chaseLocked ? "angled view" : "lock on the " + chaseTargetName.toUpperCase() + " vector"],
      ["E / CLICK", "look toward another body (now " + chaseTargetName.toUpperCase() + ")"],
      ["R", "swap: stand behind " + chaseTargetName.toUpperCase()],
      ["DRAG / ARROWS", "swing the camera"],
      ["SCROLL / Q E", "closer / farther along the vector"],
      ["TAB / 0-6 / M", "chase another body (M: Moon)"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      anatHint,
      textHint,
      ["H", "cockpit on / off"],
      ["V / ESC / RIGHT-CLICK", "back to the system"]
    ] : [
      ["CLICK / 1-6", "pin a planet"],
      ["M", "pin the Moon"],
      ["TAB", "next planet"],
      ["0", "the Sun"],
      ["V", follow >= 0 ? "chase view behind " + followName.toUpperCase() : "chase view (pin a planet first)"],
      ["G", "the Sun's journey through the Galaxy"],
      ["X", "fly out to the Milky Way"],
      ["I", root.guides ? "hide orbit lines" : "show orbit lines"],
      ["SCROLL / Q E", "zoom"],
      ["DRAG", "orbit the camera (let go and it coasts)"],
      ["RIGHT-DRAG / WASD", "pan (Shift-drag too)"],
      ["ARROWS", "orbit / tilt the camera"],
      ["O", "auto orbit"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      anatHint,
      textHint,
      ["H", "cockpit on / off"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ]

  // The chosen place's card as text: its name, what it is, a line of facts
  // and the blurb. The rail shows it; its words set how long it stays.
  readonly property var cardPlace: gxSel >= 0 ? place(gxSel) : null
  readonly property var cardView: gxView >= 0 ? gxViews[gxView] : null   // a named viewpoint
  // In the system view the card is the pinned body's (sysCard, from the nav
  // producer): the facts that describe the body
  property var sysCard: null
  property string fallDetail: ""          // the fall's line under the Milky Way caption's title (from the nav producer)
  readonly property bool sysCardOn: explore === "system" && !galactic && !!sysCard
  readonly property real cardMix: sysCardOn ? sys : galaxyMix * (1 - fallFade)
  readonly property bool cardShown: (sysCardOn || gxSel !== -2 || !!cardView) && !touring
  readonly property string cardTitle: sysCardOn ? sysCard.title : cardPlace ? cardPlace.name.toUpperCase() : cardView ? cardView.name.toUpperCase() : "THE SUN  ·  YOU ARE HERE"
  readonly property string cardSub: sysCardOn ? sysCard.sub : cardPlace ? cardPlace.label.toUpperCase() : cardView ? cardView.label
    : "26,600 LY FROM THE GALACTIC CENTRE  ·  ONE LAP EVERY 203 MILLION YEARS AT 247 KM/S"
  // one radius: the black hole's Schwarzschild radius (the unit every fall figure uses), said once on its card
  readonly property string radiusIs: "one radius = " + fmtNum(Fall.RS_KM / 1e6, 1) + " million km"
  readonly property string cardFacts: {
    if (sysCardOn) return sysCard.facts
    const h = cardPlace
    if (!h) return ""
    if (h.kind === "blackhole" && fallState) {
      const tl = fallState.tl
      return "FALLING  ·  " + (fallR < 0 ? fmtNum(-fallR, 2) + " radii beyond the ring" : fmtNum(fallR, 2) + " radii from the centre") + " (" + radiusIs + ")  ·  horizons at "
        + fmtNum(tl.rPlus, 2) + " and " + fmtNum(tl.rMinus, 2) + " radii, " + fmtNum(tl.tauInner - tl.tauHorizon, 0) + " s apart on our own clock"
    }
    if (h.kind === "blackhole" && gxDist < 2e-6) {
      // the horizon of the spinning hole as drawn: 2 r+ across (0.67 radii at this spin, not the 1 of a still hole)
      const acrossKm = 2 * holeRPlus * Fall.RS_KM
      return Math.round(gxDist / rsKpc) + " radii from it (" + (gxDist * 2.0626e8).toFixed(1) + " AU)  ·  " + radiusIs + "  ·  the horizon is "
        + (acrossKm / auKm).toFixed(2) + " AU across, about " + Math.round(acrossKm / 1391400) + " Suns side by side"
    }
    return lightYears(h.dpc) + " away  ·  " + sizeText(h.size) + " across"
  }
  readonly property string cardBlurb: {
    if (sysCardOn) return ""
    const h = cardPlace
    if (!h) return cardView ? cardView.blurb
      : "This is home. The Sun circles the centre of the Galaxy together with its neighbours, bobbing gently up and down through the disk as it goes. Press [ ] to watch."
    if (h.kind === "blackhole" && fallState) {
      // the figures are the running fall's own (lib/fall.js)
      const tl = fallState.tl
      return fallMath
        ? "Mathematics mode: Kerr's equations followed all the way, beyond what physics has tested. A hard push sends us down the spin axis at " + fmtNum(Fall.localSpeed(tl, tl.r0, tl.E), 1)
          + " c (a fall from rest would bounce back just inside the inner horizon), through both horizons and the open middle of the ring singularity, out into a second space where distance counts below zero and the hole pushes away. The equations say that space is there; its stars are our invention."
        : "We let go " + fmtNum(tl.r0, 0) + " radii above the pole and fall freely. The " + fmtNum(tl.tauHorizon / 60, 0) + "-minute approach is shown about " + fmtNum(Math.round(tl.tauHorizon / Fall.S_HORIZON / 10) * 10)
          + " times faster; inside the horizon you watch in real time. The event horizon passes as smoothly as open space, because a hole this big is gentle at its edge. Inside, every path leads inward, while the sky we left still shines in. The journey ends at the inner horizon, where the light falling in behind us piles up without limit: the edge of what physics can predict."
    }
    if (h.kind === "blackhole")
      return h.blurb + "  Dust hides it from our eyes, so what you see here is the crowded star cluster around it. Radio waves pass through the dust: the Event Horizon Telescope revealed its shadow in 2022. Drawn spinning at 94% of the maximum, one of the EHT's favoured models (the real spin is still unmeasured): the gas circles with the spin, and from the side the shadow is flattened on one edge."
    // how old the light is, to three figures (the distances are no better)
    const ly = h.dpc * 3.26156
    return h.blurb + (ly >= 10 ? "  The light you see left it about " + lightYears(Number(ly.toPrecision(3)) / 3.26156).replace(" ly", " years") + " ago." : "")
  }
  // the facts line changes every frame of a fall: it counts as a dozen words
  readonly property int cardWords: cardShown ? Tx.words(cardSub) + 12 + Tx.words(cardBlurb) : 0
  // the mode caption's words (a title and a line or two of detail)
  readonly property int captionWords: modeCaptionNow ? Tx.words(modeCaptionNow.title + " " + modeCaptionNow.lines.map(l => l.text).join(" ")) : 0

  // pointer over the solar system in the universe view, eased 0..1
  property bool hoverSystem: false
  property real sysHover: 0
  property vector2d sunScreen: Qt.vector2d(-0.64, 0.06)
  property real sys: 0 // 0 universe view .. 1 system view, for the overlays' opacity
  property int follow: 0 // -1 free camera, 0 sun, 1..6 planets, 7 the Moon
  readonly property string followName: follow === 7 ? "Moon" : follow > 0 ? planetInfo[follow - 1].name : follow === 0 ? "Sun" : ""
  onFollowChanged: {
    touchText()
    if (follow < 0 && chasing) leaveChase()
    setLimits()
  }
  // display positions this tick: the planets [x, y, z, radius] and the Moon
  property var dispBodies: planetInfo.map(pl => [0, 0, 0, pl.r])
  property var moonDisp: [0, 0, 0, 0.0012]
  function bodyP(i) { return i === 7 ? moonDisp.slice(0, 3) : i <= 0 ? [0, 0, 0] : dispBodies[i - 1].slice(0, 3) }
  function bodyR(i) { return i === 7 ? moonDisp[3] : i <= 0 ? sunR : dispBodies[i - 1][3] }
  // what the camera rides: a body's position and, for everything but the Sun,
  // its radius (so a scale change never changes the pinned body's size on screen)
  function bodyTrack(i) { return i <= 0 ? () => ({ p: [0, 0, 0] }) : () => ({ p: bodyP(i), lnr: Math.log(bodyR(i)) }) }
  // the display scale of body i's orbit (K: planetK or an older copy of it)
  function bodyK(i, K) { return i <= 0 ? 1 : K[i === 7 ? 2 : i - 1] }
  // how much the world around body i shrinks when the scale blend returns to the overview
  function squeezeRatio(i) { if (i <= 0) return 1; const j = i === 7 ? 2 : i - 1; return planetInfo[j].a / orbitParams[j][0] }
  // the body nearest the screen centre (what a free camera is looking at)
  function nearestBody() {
    let best = 0, bd = 1e9
    for (let i = 0; i <= 7; i++) { const pr = sysCam.project(bodyP(i)); const d = pr.front ? Math.hypot(pr.x, pr.y) : 1e9; if (d < bd) { bd = d; best = i } }
    return best
  }
  property var sysScreen: []     // per planet: screen point (p units), radius, label shown
  property var markerPts: ({})   // moon / earth / sun: screen point (p units), radius, distance

  // Screen position (pixels) and on-screen radius of the Moon, Earth or the Sun,
  // through the chase camera when it is active, else the system view.
  function markerProj(kind, w, h) {
    const m = markerPts[kind] || { x: 0, y: 0, r: 0, dist: 0 }
    return { x: (m.x / aspect + 0.5) * w, y: (m.y + 0.5) * h, r: m.r * h, dist: m.dist }
  }
  // A marker is wanted when its body is outside the safe rect (a dot on the
  // edge points at it) or too small to see. lay: the screen's plan
  function markerWanted(kind, lay) {
    if (!root.liveBackground || root.sys < 0.5 || root.galMix > 0.5) return false
    const pr = markerProj(kind, lay.W, lay.H)
    const off = Lay.clampMarker(pr.x, pr.y, lay.safe, []).off
    const inChase = chaseMix > 0.5
    if (kind === "moon") return follow !== 7 || inChase ? (off || pr.r < 10) : off
    if (kind === "earth") return follow !== 3 && (inChase ? (off || pr.r < 10) : off)
    return inChase && (off || pr.r < 14) // sun
  }
  function markerLabel(kind) {
    var fmt = function(n) { return Math.round(n).toLocaleString(Qt.locale("en_US"), "f", 0) }
    if (kind === "moon") return "MOON  ·  " + fmt(moonDistanceKm) + " km from Earth"
    if (chaseMix > 0.5) {
      var d = markerProj(kind, 1, 1).dist
      // display units: at true scale, trueAu per AU
      return kind === "earth" ? "EARTH  ·  " + fmt(d / trueAu * auKm) + " km"
                              : "SUN  ·  " + (d / trueAu).toFixed(2) + " AU"
    }
    return kind === "earth" ? "EARTH" : "SUN"
  }

  // orbit ellipse for the shader: a, e, perihelion turned by the camera yaw
  property var orbitParams: planetInfo.map(pl => [pl.a, pl.e[0], 0])
  // True scale: pinning a planet or the Moon moves the whole system to real
  // proportions, anchored on Earth's radius: real orbit distances, real planet
  // radii, the real Sun. The overview squeezes orbits a thousandfold so they
  // fit on screen; zooming back out returns to it. The blend is the camera's
  // sigma channel, so it runs WITH a pick's flight, not after it.
  // guide lines (orbit rings, the Sun vector, long galactic trails): I toggles
  property bool guides: false
  property real guideMix: 0
  readonly property real trueAu: 0.0045 * auKm / 6371 // display units per AU at true scale
  property real sunR: 0.006
  property vector4d sysBound: Qt.vector4d(-0.64, 0.06, 0.4, 0.2)
  function trueRadius(i) { return i === 7 ? 0.0045 * 1737.4 / 6371 : i <= 0 ? 0.0045 * 695700 / 6371 : 0.0045 * planetInfo[i - 1].km / 6371 }
  function orbitUniform(i) {
    const o = orbitParams[i]
    return Qt.vector4d(o[0], o[1], -o[2], 0) // a, e, longitude of perihelion: world frame
  }

  function enterSystem() {
    if (!emptyWorkspace) return
    gxFromSystem = false
    explore = "system"
    camPose = "system"
    follow = 0
    autoOrbit = false
    setLimits()
    // the corner view glides to the centre while it zooms: one path
    sysCam.flyTo({ track: bodyTrack(0), ell: Math.log(overviewH), o: [0, 0], sigma: 0 }, { time: 1.0 })
  }
  // back to the universe's corner view: the reverse flight (instant while
  // hidden). If the scale blend is on, the world collapses to the overview
  // under the flight, which rides that collapse (uScale, scaleFlight).
  function universePose(instant) {
    camPose = "universe"
    chasing = false
    galactic = false
    if (scaleAnchor < 0) scaleAnchor = follow >= 1 ? follow : nearestBody()
    const uScale = squeezeRatio(scaleAnchor)
    follow = 0
    const pose = { track: bodyTrack(0), ell: 0, o: [sunScreen.x, sunScreen.y], sigma: 0,
                   yaw: 0, pitch: overviewPitch, roll: -0.10, fovT: fovOrtho }
    if (instant) {
      sysCam.flight = null; sysCam.anchor = null; sysCam.grab = null
      sysCam.follow(pose.track)
      sysCam.F.set([0, 0, 0]); sysCam.ell.set(0); sysCam.o.set(pose.o); sysCam.sigma.set(0)
      sysCam.yaw.set(0); sysCam.pitch.set(overviewPitch); sysCam.roll.set(-0.10); sysCam.fovT.set(fovOrtho)
    } else sysCam.flyTo(pose, { time: 1.0, uScale: uScale })
  }
  // A pick is ONE motion: a van Wijk & Nuij flight (2003; the camera rises and
  // descends along the path of constant perceived speed, so a long hop never
  // rushes at the end) to the body as it moves, landing at a set size in its
  // radii, while the scale blend runs alongside with the body's size held.
  // Any input interrupts it and continues from the current velocity.
  // The landing: the body's radius 6% of the screen height, within the zoom range.
  function landingEllRel(i) {
    const R = trueRadius(i)
    return Math.log(Math.max(1 / 150, Math.min(1 / 3.6, R / 0.06)) / R)
  }
  function focusBody(i) {
    if (explore !== "system" || galactic) return
    const prev = follow
    if (chasing) {
      // chase another body: it becomes A; if it was B, B becomes the old A (a swap)
      follow = i
      if (chaseTarget === i) chaseTarget = prev >= 0 ? prev : 0
      setLimits()
      sysCam.flyTo({ track: chaseTrack(i, chaseTarget), ellRel: Math.log(16.7), yawRel: chaseLocked ? 0 : 0.35, pitch: chaseLocked ? 0 : 0.18 })
      return
    }
    follow = i
    if (i === 0) {
      // the Sun: the squeezed overview, the world collapsing under the flight
      scaleAnchor = prev >= 1 ? prev : nearestBody()
      sysCam.flyTo({ track: bodyTrack(0), ell: Math.log(overviewH), o: [0, 0], sigma: 0 }, { uScale: squeezeRatio(scaleAnchor) })
    } else {
      sysCam.flyTo({ track: bodyTrack(i), ellRel: landingEllRel(i), o: [0, 0], sigma: 1 })
    }
  }
  property var planetK: planetInfo.map(() => 1) // display scale of each orbit (grows with true scale)
  // screen pixel -> shader p coordinates (x in +-aspect/2, y in +-0.5)
  // one level back (Esc, or a right-click on empty space): out of the
  // galactic or chase view; from a place of the Milky Way view home to the
  // Sun (gxHome, the one way home); from there to the solar system, else to
  // the universe view
  function back() {
    if (fallState) { gxHome(); return }   // never leaves the camera inside the hole: the way home first
    if (galactic) toggleGalactic()
    else if (chasing) leaveChase()
    else if (explore === "galaxy" && gxReturn) return                              // on the way home already
    else if (explore === "galaxy" && (gxSel !== -1 || gxView >= 0)) gxHome()       // from any place of the Milky Way view: the way home first
    else if (explore === "galaxy" && gxFromSystem) enterSystem()
    else explore = "universe"
  }
  function toP(x, y, w, h) { return [(x / w - 0.5) * aspect, y / h - 0.5] }
  function overSystem(pt) {
    const qx = pt[0] - sunScreen.x, qy = pt[1] - sunScreen.y
    return (qx / 0.34) * (qx / 0.34) + (qy / 0.14) * (qy / 0.14) < 1
  }
  // the body under the pointer: within 2.5 radii of its drawn disc, or a small halo
  function pickBody(pt) {
    let best = -1
    let bestD = 1e9
    for (let i = 0; i <= 7; i++) {
      const pr = sysCam.project(bodyP(i))
      if (!pr.front) continue
      const d = Math.hypot(pr.x - pt[0], pr.y - pt[1])
      if (d < Math.max(bodyR(i) * pr.scale * 2.5, 0.014) && d < bestD) { best = i; bestD = d }
    }
    return best
  }

  // Lighter sky on an empty workspace, deep black behind windows.
  readonly property bool emptyWorkspace: {
    const ws = Hyprland.focusedWorkspace
    return !!ws && !!ws.toplevels && ws.toplevels.values.length === 0
  }
  property real exposure: 1
  property real bootLevel: 0
  NumberAnimation on bootLevel { from: 0; to: 1; duration: 3000; easing.type: Easing.InOutQuad }

  function key(name) { return keysDown[name] ? 1 : 0 }

  // The HUD centre's offset from its anchor, in shader coordinates: drifting
  // slowly (OLED) and leaning toward the pointer, within +-0.10 and +-0.08.
  // Each screen has its own anchor and HUD scale (lib/layout.js: right of
  // centre on a wide screen, the top right corner on a narrow one) and adds
  // this, times the scale, to it; the rings and the text read that one place.
  property vector2d hudDrift: Qt.vector2d(0, 0)
  // The label pass (lib/layout.js placeLabels) runs once a tick for the view
  // in front, on the first screen (the camera works in its aspect): every
  // scene name goes right of its thing, else left, else hides, clear of the
  // bar and notch, the rail, the caption, the HUD's disc and the words on
  // its rim, a story caption, and every name placed before it. The
  // first screen's panel says how tall its zones stand right now.
  property real railNow: 0
  property real storyNow: 0
  readonly property bool captionUp: captionWords > 0 && presCaption * gateNames > 0.01
  readonly property var labelState: ({ sides: {}, beacons: [] })   // the side each name had; the beacon words' boxes
  property var markerLabels: ({})   // moon / earth / sun: label shown, side
  property var galLabels: []        // galactic view: the heading's words, then the planets: shown, side
  // the HUD steps back (to 0.3) while the chosen or hovered thing is inside its ring, so its name reads
  property real cockpitYield: 1
  // a pass's answers reach the label bindings only when one of them changed
  function labelsDiffer(was, now) {
    const ks = Object.keys(now)
    return Object.keys(was).length !== ks.length || ks.some(k => !was[k] || was[k].show !== now[k].show || was[k].side !== now[k].side)
  }
  function labelZones() {
    const l = lay0, keep = []
    if (railNow > 0) keep.push(Lay.railRect(l, railNow))
    if (captionUp) keep.push(Lay.captionRect(l, l.caption.maxH))
    const cover = keep.slice()   // where a dot hides too: the rail, the caption
    // the disc's place in the plan is taken by the cockpit, or by the
    // anatomy's lens alone when the cockpit is off: names keep out of both
    let disc = null
    if (gateCockpit > 0.01 || lensUp > 0.01) {
      disc = Lay.hudDisc(l, [hudDrift.x, hudDrift.y])
    }
    return { keep: keep, cover: cover, disc: disc,
             all: cover.concat(disc ? [disc] : [], disc ? labelState.beacons : [], storyNow > 0 ? [Lay.storyRect(l, storyNow)] : []) }
  }
  // IPC `textDebug true`: the plan drawn over the scene (safe rect, rail,
  // caption slot, story band, the HUD's reach, and a circle that must lie
  // on the instrument's rim at any render scale)
  property bool textDebug: false

  // frameDt: the FrameAnimation's own clock (monotonic, sub-millisecond); the
  // fallback Timer passes nothing and the wall clock serves (whole milliseconds:
  // a 6 ms frame measured as 6 or 7 is a 16% jitter in every spring step)
  function tick(frameDt) {
    const now = Date.now()
    const dt = Math.min(0.1, frameDt !== undefined ? frameDt : (now - lastTick) / 1000)
    lastTick = now
    let subjectInRing = false   // the chosen or hovered thing is inside the HUD's ring (set by the label pass)
    shaderTime = ((now - shaderEpoch) / 1000) % 600
    if (idleFps < Q.IDLE_FULL && !navigating && now - lastNebulaAt >= 90) { nebulaTime = shaderTime; lastNebulaAt = now }

    const thrust = navigating ? key("w") - key("s") : 0
    mix.speed.g = navigating ? 0.25 + thrust * 0.9 : 0
    flightSpeed = mix.speed.step(dt)
    mix.nav.g = navigating ? 1 : 0
    navMix = mix.nav.step(dt)
    if (flightSpeed !== 0) flight = ((flight + flightSpeed * dt) % 64 + 64) % 64

    mix.strafeX.g = navigating ? (key("d") - key("a")) * 0.35 : 0
    mix.strafeY.g = navigating ? (key("f") - key("r")) * 0.35 : 0
    panVelocity = Qt.vector2d(mix.strafeX.step(dt), mix.strafeY.step(dt))
    if (panVelocity.length() > 0) pan = pan.plus(panVelocity.times(dt))

    mix.viewX.g = viewTarget.x; mix.viewY.g = viewTarget.y
    view = Qt.vector2d(mix.viewX.step(dt), mix.viewY.step(dt))

    // Same one-cycle-per-600 s rates as the shader, so the wrap never jumps.
    const w = 2 * Math.PI / 600
    hudDrift = Qt.vector2d(
      0.06 * Math.sin(w * 2 * shaderTime) + view.x * 0.08,
      0.04 * Math.sin(w * 3 * shaderTime + 1.3) + view.y * 0.08)

    // solar system: the Sun's place in the universe view (left third, drifting),
    // which the camera's principal point follows while it is the corner view
    sunScreen = Qt.vector2d(
      -aspect * 0.27 + 0.05 * Math.sin(w * 2 * shaderTime + 2.1) + view.x * 0.05 - pan.x * 0.8,
      0.06 + 0.035 * Math.sin(w * 3 * shaderTime + 0.4) + view.y * 0.05 - pan.y * 0.8)
    // Kepler: solve E - e sin E = M for each planet, place it on its ellipse
    // (sun at a focus), turn by perihelion; the camera's basis does the rest.
    if (explore === "system") simMs += dt * 1000 * simRate
    else simMs = Date.now()
    const jd = simMs / 86400000 + 2440587.5
    const days = jd - 2451545.0
    const T = days / 36525
    const deg = Math.PI / 180

    // ---- the system camera: held keys are rates into goals; the springs do the rest ----
    const cdt = Math.min(dt, 1 / 30)   // the camera never lurches after a stall
    if (explore === "system") {
      // every system view: arrows orbit, Q/E zoom (E in chase is "look toward")
      const yk = key("right") - key("left"), pk = key("up") - key("down")
      if (yk !== 0 || pk !== 0) sysCam.orbit(yk * 0.8 * dt, pk * 0.5 * dt, false)
      const zk = (chasing ? 0 : key("e")) - key("q")
      if (zk !== 0) {
        if (zk < 0 && !chasing && !galactic && sysCam.ell.g >= Math.log(1 / 1.3) - 1e-9) explore = "universe"
        else sysCam.zoomBy(-zk * Math.log(2.5) * dt)
      }
    }
    if (explore === "system" && !galactic && !chasing) {
      const mvx = key("d") - key("a"), mvy = key("s") - key("w")
      if (mvx !== 0 || mvy !== 0) { follow = -1; sysCam.move(sysCam.screenToWorld([mvx * 0.6 * dt, mvy * 0.6 * dt])) }
      if (autoOrbit) sysCam.yaw.g += 0.12 * dt
      // true scale comes with a pick and goes once zoomed out to the overview's
      // framing; a pinned body gets it back two notches further in (hysteresis)
      if (explore === "system" && !sysCam.flying()) {
        if (sysCam.ell.g > Math.log(1 / 3.4)) sysCam.sigma.g = 0
        else if (follow >= 1 && sysCam.ell.g < Math.log(0.19)) sysCam.sigma.g = 1
      }
    }
    // the corner view sits on the drifting HUD layout (pointer parallax included)
    if (explore !== "system" && !sysCam.flying()) sysCam.o.set([sunScreen.x, sunScreen.y])

    // real positions (AU, kept in doubles) and the display copy: same
    // direction and ellipse shape, distance scaled to the display orbit `a`,
    // or to true scale as the camera's scale blend sigma rises
    const orbits = planetInfo.map(pl => planetPos(pl, T))
    const real = orbits.map((o, i) => [o[0], o[1], o[2], planetInfo[i].km / auKm])
    const sg = sysCam.sigma.x
    const tm = sg * sg * (3 - 2 * sg)
    mix.guide.g = guides ? 1 : 0
    guideMix = mix.guide.step(dt)
    // display distance and radius: geometric blend from the overview to true scale
    const dispA = orbits.map((o, i) => Math.pow(planetInfo[i].a, 1 - tm) * Math.pow(o[3] * trueAu, tm))
    const prevK = planetK
    planetK = orbits.map((o, i) => dispA[i] / o[3])
    orbitParams = orbits.map((o, i) => [dispA[i], o[4], -o[5]])
    sunR = Math.pow(0.006, 1 - tm) * Math.pow(trueRadius(0), tm)
    // display positions in 3D (true directions, the overview's distances or
    // true scale as blended), shared by the overview and chase cameras
    const disp = orbits.map((o, i) => {
      const kk = planetK[i]
      return [real[i][0] * kk, real[i][1] * kk, real[i][2] * kk, Math.pow(planetInfo[i].r, 1 - tm) * Math.pow(trueRadius(i + 1), tm)]
    })
    spins = planetInfo.map(pl => (2 * Math.PI * days / pl.day) % (2 * Math.PI))

    // Earth's rotation (Greenwich sidereal angle) and our spot on the globe
    earthTheta = ((280.46061837 + 360.98564736629 * days) % 360) * deg
    {
      // celestial pole and equatorial axes in this frame (x, ecliptic north, -ecliptic y)
      const n = Qt.vector3d(0, Math.cos(obliquity), -Math.sin(obliquity))
      const xe = Qt.vector3d(1, 0, 0)
      const ye = Qt.vector3d(0, -Math.sin(obliquity), -Math.cos(obliquity))
      const lat = homeLat * deg
      const lon = homeLon * deg + earthTheta
      homeDir = xe.times(Math.cos(lat) * Math.cos(lon)).plus(ye.times(Math.cos(lat) * Math.sin(lon))).plus(n.times(Math.sin(lat)))
    }

    // the Moon: real geocentric position. The Earth-Moon pair blends from an
    // exaggerated layout (zoomed out) to true scale: real size ratio (27%)
    // and real distance (about 60 Earth radii).
    const mg = moonPos(days)
    moonFace = Qt.vector3d(-mg[0], -mg[1], -mg[2]).normalized()
    const earthR = planetInfo[2].r
    moonDistanceKm = Math.hypot(mg[0], mg[1], mg[2]) * auKm
    {
      // the Moon's phase for the HUD's gap window: the Sun-Earth-Moon angle,
      // and waxing while the Moon is east of the Sun (ecliptic longitudes)
      const sx = -real[2][0], sy = -real[2][1], sz = -real[2][2]
      const c = (sx * mg[0] + sy * mg[1] + sz * mg[2]) / (Math.hypot(sx, sy, sz) * Math.hypot(mg[0], mg[1], mg[2]))
      const ph = Sun.moonLit(c, Math.sin(Math.atan2(-mg[2], mg[0]) - Math.atan2(-sz, sx)) > 0)
      if (Math.abs(ph.lit - moonNow.lit) > 0.002 || ph.waxing !== moonNow.waxing) moonNow = ph
    }
    const trueDist = earthR * moonDistanceKm / 6371
    moonOrbit = 0.024 + (trueDist - 0.024) * tm
    const moonD = (() => {
      const ml = Math.max(1e-12, Math.hypot(mg[0], mg[2]))
      const e2 = disp[2]
      return [e2[0] + mg[0] / ml * moonOrbit, e2[1] + mg[1] / ml * moonOrbit, e2[2] + mg[2] / ml * moonOrbit, earthR * 1737.4 / 6371]
    })()
    dispBodies = disp
    moonDisp = moonD

    // The scale blend moves the world about the Sun. A pinned body is tracked
    // anyway; a free camera rides the rescale of the body nearest the screen
    // centre (chosen when the blend starts), and a Sun-bound flight carries
    // it in its remaining offset: what you look at stays put.
    if (prevK.some((k, i) => Math.abs(planetK[i] / k - 1) > 1e-12)) {
      if (scaleAnchor < 0) scaleAnchor = follow >= 1 ? follow : nearestBody()
      const k = bodyK(scaleAnchor, planetK) / bodyK(scaleAnchor, prevK)
      if (sysCam.flight) { if (sysCam.flight.scaled) sysCam.scaleFlight(k) }
      else if (!sysCam.track) sysCam.F.carry(Cam.mul(sysCam.F.x, k - 1))
    } else if (!sysCam.sigma.moving()) scaleAnchor = -1   // a goal just set keeps the anchor chosen with it

    // the step: tracked reference carried, flight or springs advanced, basis built
    const cb = sysCam.update(cdt)
    const camF = cb.F
    {
      // the skip-box: the system's whole volume (Saturn's orbit, the bodies'
      // drawn sizes, the Sun's glow, the Moon's orbit above and below the
      // ecliptic) projected corner by corner, so close-ups and true scale never
      // slice a planet. A corner behind the eye means the volume can wrap the
      // screen (mirrored), so then nothing is skipped (z = 0); the old box,
      // sized at the focus plane around the Sun's mirrored projection, dropped
      // the pinned body whenever the Sun went behind the camera.
      const r = dispA[5] * 1.06 + 3 * Math.max(...disp.map(b => b[3])) + sunR * 12 + 0.01
      const yh = dispA[5] * 0.13 + moonOrbit + 3 * Math.max(...disp.map(b => b[3])) + sunR * 12 + 0.01
      const corners = []
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * r, sy * yh, sz * r])
      const box = sysCam.screenBox(corners, cb)
      sysBound = box ? Qt.vector4d(box.x, box.y, box.hx * 1.05 + 0.01, box.hy * 1.05 + 0.01) : Qt.vector4d(0, 0, 0, 0)
    }
    chaseMix = mix.chase.step(dt)
    mix.gal.g = galactic ? 1 : 0
    galMix = mix.gal.step(dt)
    if (galMix > 0) {
      // the trails and the bodies' points, through the one camera (the Sun in
      // focus; the overlay draws what the shader scene fades out of)
      const proj = (x, y, z) => { const pr = sysCam.project([x, y, z]); return { x: pr.x, y: pr.y, z: pr.z, scale: pr.scale } }
      // the Sun's travel at the overview's scale (Earth's 1 AU = 0.11), slowed by galSlow
      const vDisp = sunAuPerYear * 0.11 / galSlow
      const N = 150
      const trails = []
      const now = []
      const sunPts = []
      for (let j = 0; j <= N; j++) {
        const tau = galTrailYears * j / N
        sunPts.push(proj(-sunVelocity[0] * vDisp * tau, -sunVelocity[1] * vDisp * tau, -sunVelocity[2] * vDisp * tau))
      }
      trails.push(sunPts)
      const s0p = proj(0, 0, 0)
      // true radii at this view's scale (1 AU = 0.11): the Sun a small disc, planets points
      now.push({ x: s0p.x, y: s0p.y, z: s0p.z, r: 695700 / auKm * 0.11 * s0p.scale })
      for (let i = 0; i < planetInfo.length; i++) {
        const pts = []
        for (let j = 0; j <= N; j++) {
          const tau = galTrailYears * j / N
          const h = helio3(planetInfo[i], T - tau / 100)
          pts.push(proj(h[0] - sunVelocity[0] * vDisp * tau, h[1] - sunVelocity[1] * vDisp * tau, h[2] - sunVelocity[2] * vDisp * tau))
        }
        trails.push(pts)
        now.push({ x: pts[0].x, y: pts[0].y, z: pts[0].z, r: planetInfo[i].km / auKm * 0.11 * pts[0].scale })
      }
      galTrails = trails
      galNow = now
      // interstellar dust is at rest in the Galaxy, so from the Sun it streams
      // backward; the shader drifts its dust by this accumulated offset
      const ahead = proj(sunVelocity[0] * 0.05, sunVelocity[1] * 0.05, sunVelocity[2] * 0.05)
      const hx = ahead.x - s0p.x, hy = ahead.y - s0p.y
      const hl = Math.max(1e-6, Math.hypot(hx, hy))
      galHeading = Qt.point(hx / hl, hy / hl)
      const flow = Math.min(0.6, 0.004 + vDisp * simRate / 31557600 * 0.5 / cb.h) // screen units per second
      galFlow = Qt.vector4d(galFlow.x - hx / hl * flow * dt, galFlow.y - hy / hl * flow * dt, -hx / hl, -hy / hl)
    }

    mix.sky.g = explore === "sky" ? 1 : 0
    skyMix = mix.sky.step(dt)
    if (skyMix > 0) {
      if (explore === "sky") {
        const pan = skyVfov / 46
        skyLTarget += (key("left") - key("right") + key("a") - key("d")) * dt * 30 * pan
        skyBTarget = Math.max(-89, Math.min(89, skyBTarget + (key("up") - key("down") + key("w") - key("s")) * dt * 20 * pan))
        const zk = key("e") - key("q")
        if (zk !== 0) skyVfovTarget = Math.max(8, Math.min(130, skyVfovTarget * Math.pow(2, -zk * dt)))
      }
      const sk = Math.min(1, dt * 3)
      skyOrbit.l.g = skyLTarget; skyOrbit.b.g = skyBTarget
      skyL = skyOrbit.l.step(dt, 1e-5); skyOrbit.b.step(dt, 1e-5)
      skyB = skyOrbit.b.limit(-89, 89)   // a fling stops at the pole clamp instead of overshooting past it
      if (!skyOrbit.l.moving() && !skyOrbit.b.moving()) { skyOrbit.l.w = Cam.W_INPUT; skyOrbit.b.w = Cam.W_INPUT }
      skyVfov += (skyVfovTarget - skyVfov) * sk
      const l = skyL * Math.PI / 180, b = skyB * Math.PI / 180
      const fw = Qt.vector3d(Math.cos(b) * Math.sin(l), -Math.cos(b) * Math.cos(l), Math.sin(b))
      const rt = Qt.vector3d(-Math.cos(l), -Math.sin(l), 0)
      skyFwd = fw
      skyRight = rt
      skyUp = rt.crossProduct(fw)
      // exactly on a named view: its native 5K render
      const v = skyViews[skyView]
      let dl = ((skyL - v.l) % 360 + 540) % 360 - 180
      // close to a named view and not being moved (nor coasting through it): settle exactly onto it
      const still = !key("left") && !key("right") && !key("up") && !key("down") && !key("q") && !key("e")
                 && !skyDragging && Math.abs(skyOrbit.l.v) < 2 && Math.abs(skyOrbit.b.v) < 2
      const near = Math.abs(dl) < 0.5 && Math.abs(skyB - v.b) < 0.5 && Math.abs(skyVfov - 46) < 1.0
      if (near && still) {
        skyLTarget = skyL - dl
        skyBTarget = v.b
        skyVfovTarget = 46
      }
      mix.skyStatic.g = Math.abs(dl) < 0.05 && Math.abs(skyB - v.b) < 0.05 && Math.abs(skyVfov - 46) < 0.1 ? 1 : 0
      skyStaticMix = mix.skyStatic.step(dt)
    }
    mix.galaxy.g = explore === "galaxy" ? 1 : 0
    galaxyMix = mix.galaxy.step(dt)
    if (galaxyMix > 0) {
      gxMyr += dt * gxRates[gxRateIndex]
      const inView = explore === "galaxy"
      if (gxReturn) gxReturnStep(dt)
      if (inView && !fallState) {
        gxYawTarget += (key("right") - key("left")) * dt * 0.8
        gxPitchTarget = Math.max(-1.45, Math.min(1.45, gxPitchTarget + (key("up") - key("down")) * dt * 0.6))
        // orbiting leaves a named viewpoint's line: its card goes
        if (key("right") + key("left") + key("up") + key("down") > 0) gxView = -1
      }
      if (inView) {
        const zk = key("e") - key("q")
        if (zk !== 0) gxDistGoal = Math.max(gxMinDist(), Math.min(2500, gxDistGoal * Math.pow(2.5, zk * dt)))
        if (zk > 0) gxFallArmed = false
      }
      gxOrbit.yaw.g = gxYawTarget; gxOrbit.pitch.g = gxPitchTarget
      gxYaw = gxOrbit.yaw.step(dt, 1e-7); gxOrbit.pitch.step(dt, 1e-7)
      gxPitch = gxOrbit.pitch.limit(-1.45, 1.45)   // a fling stops at the clamp: past pi/2 the view would turn over
      if (!gxOrbit.yaw.moving() && !gxOrbit.pitch.moving()) { gxOrbit.yaw.w = Cam.W_INPUT; gxOrbit.pitch.w = Cam.W_INPUT }
      const cp = Math.cos(gxPitch), sp = Math.sin(gxPitch)
      const off = [cp * Math.sin(gxYaw), cp * Math.cos(gxYaw), sp]
      const fwd = Qt.vector3d(-off[0], -off[1], -off[2])
      const right = fwd.crossProduct(Qt.vector3d(0, 0, 1)).normalized()
      const up = right.crossProduct(fwd)
      // WASD: free flight, level with the disk, at a speed matching the view
      // (not while falling: nothing steers then)
      if (inView && !fallState) {
        const mv = [key("d") - key("a"), key("w") - key("s")]
        if (mv[0] !== 0 || mv[1] !== 0) {
          if (gxSel !== -2) { gxFree = gxTarget.slice(); gxSel = -2; gone("home") }
          gxView = -1
          const fh = Math.hypot(fwd.x, fwd.y) > 1e-3 ? [fwd.x / Math.hypot(fwd.x, fwd.y), fwd.y / Math.hypot(fwd.x, fwd.y)] : [up.x, up.y]
          const v = gxDist * 0.9 * dt
          gxFree = [gxFree[0] + (right.x * mv[0] + fh[0] * mv[1]) * v, gxFree[1] + (right.y * mv[0] + fh[1] * mv[1]) * v, gxFree[2]]
        }
      }
      // travel: the focus glides to its goal and the camera pulls back while
      // far from it, so long trips rise above the disk and come back down
      // (lib/camera.js Voyage; a place that moves with the time-lapse is
      // followed without lag, free flight is a goal that is flown to)
      if (!fallState) {
        const goal = gxSel >= 0 ? hotspotPos(gxSel) : gxSel === -1 ? sunPosAt(gxMyr) : gxFree
        gxTarget = gxVoyage.step(goal, gxDistGoal, dt, gxSel === -2 ? "free" : gxSel, gxSel !== -2)
        gxDist = gxVoyage.dist()
      }
      let cam = [gxTarget[0] + off[0] * gxDist, gxTarget[1] + off[1] * gxDist, gxTarget[2] + off[2] * gxDist]
      // the fall: the horizon crossed in free flight starts it, judged on the
      // camera's path over this frame (far out, one frame's step is wider
      // than the hole); parked at the hole, B or a scroll in lets go (the key
      // and wheel handlers)
      {
        const parked = gxSel >= 0 && place(gxSel).kind === "blackhole" && gxDistGoal <= 6 * rsKpc * 1.001 && gxDist < 6.5 * rsKpc
        if (parked !== gxParkedAtHole) gxParkedAtHole = parked
        // asked on the way down: let go once settled at 6 Rs, on the pole
        if (parked && gxFallArmed && !fallState && gxDist < 6.05 * rsKpc && gxAtPole()) fallBegin(gxDist / rsKpc)
        if (!fallState && inView) {
          const p0 = gxCamJumped ? cam : [gxCamPos.x, gxCamPos.y, gxCamPos.z]
          const d = [cam[0] - p0[0], cam[1] - p0[1], cam[2] - p0[2]]
          const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
          const t = dd > 0 ? Math.max(0, Math.min(1, -(p0[0] * d[0] + p0[1] * d[1] + p0[2] * d[2]) / dd)) : 1
          const q = [p0[0] + d[0] * t, p0[1] + d[1] * t, p0[2] + d[2] * t]   // the path's closest point to the hole
          // judged by the Kerr radius against r+ (the horizon is not a sphere of 1 Rs)
          const qr = kerrRadius([q[0] / rsKpc, q[1] / rsKpc, q[2] / rsKpc])
          if (qr < holeRPlus) fallBegin(qr, q)
        }
        gxCamJumped = false
      }
      // black while a return that cannot be flown waits to be placed
      mix.fallFade.g = gxReturn && gxReturn.phase === "out" ? 1 : 0
      fallFade = mix.fallFade.step(dt)
      if (fallState) {
        // the camera rides the trajectory (lib/fall.js) and looks where the
        // fall's script says (below); nothing else steers
        const F = fallState
        const o = Fall.step(F, dt)
        // the radius is signed (negative past the disk); never exactly 0 for the shaders
        const r = Math.abs(o.r) < 1e-3 ? (o.r >= 0 ? 1e-3 : -1e-3) : o.r
        fallR = r; fallLeft = o.left; fallRate = o.rate
        if ((r < F.tl.rPlus) !== fallInside) fallInside = r < F.tl.rPlus
        const sheet = r < 0 ? -1 : 1
        if (sheet !== gxCamSheet) gxCamSheet = sheet
        // the inner horizon's flash (realistic mode, the last 2.5 s of proper
        // time, which the ending shows over 6): the glow below shifted blue
        // by sqrt(2.5 s / time left),
        // a cartoon of the unbounded blueshift there (Poisson & Israel 1990)
        const flash = F.tl.math ? 1 : Math.max(1, Math.sqrt(2.5 / Math.max(o.left, 0.05)))
        if (Math.abs(flash - fallFlash) > 1e-3) fallFlash = flash
        // and its light closing in, over the last 5 s on screen (universe.frag)
        if (Math.abs(o.light - fallClose) > 1e-4 || (o.light === 1) !== (fallClose === 1)) fallClose = o.light
        // what the fall says, to the story band (nothing new once the
        // screen is going black)
        if (o.say !== "" && !gxReturn) say("fall", Fall.CAPTIONS[o.say].title, Fall.CAPTIONS[o.say].body)
        // the fall's own phase, kept through the fade (fall.js turns it to
        // "inner-horizon" 4 s before r-, so it is seen before the fade starts)
        if (fallWhere !== o.phase) fallWhere = o.phase
        // the fade is black 2.0 s after it starts. fall.js says when: at the
        // inner horizon once the fall has slowed into it and the light has
        // closed; at the mathematics mode's end on the far sheet early
        // enough that the camera is still moving when the screen goes dark
        if (!gxReturn) {
          if (o.fade) gxHome()
          else if (fallPhase !== o.phase) fallPhase = o.phase
        }
        // the frame the view is drawn in (the mathematics mode's shove comes
        // on over its first seconds) and the landmark ahead, for the HUD
        if (Math.abs(o.E - gxFallE) > 1e-5) gxFallE = o.E
        F.next = o.next
        // the scripted view (fall.js look()): a tilt from straight down the
        // axis toward the side we face (F.t) and a pan about the axis; down
        // at the hole, a glance back at the sky, the shadow's rim through
        // the horizon, a look around inside, and past the disk back at the ring
        const cyw = Math.cos(o.yaw), syw = Math.sin(o.yaw)
        const xt = [F.x[1] * F.t[2] - F.x[2] * F.t[1], F.x[2] * F.t[0] - F.x[0] * F.t[2], F.x[0] * F.t[1] - F.x[1] * F.t[0]]
        const ty = [F.t[0] * cyw + xt[0] * syw, F.t[1] * cyw + xt[1] * syw, F.t[2] * cyw + xt[2] * syw]
        const c = Math.cos(o.tilt), sn = Math.sin(o.tilt), k = Math.min(1, dt * 2.5)
        const gf = [-c * F.x[0] + sn * ty[0], -c * F.x[1] + sn * ty[1], -c * F.x[2] + sn * ty[2]]
        const gu = [sn * F.x[0] + c * ty[0], sn * F.x[1] + c * ty[1], sn * F.x[2] + c * ty[2]]
        let fw = F.fwd.map((v, j) => v + (gf[j] - v) * k)
        let fl = Math.hypot(fw[0], fw[1], fw[2]); fw = fw.map(v => v / fl)
        let u = F.up.map((v, j) => v + (gu[j] - v) * k)
        const uf = u[0] * fw[0] + u[1] * fw[1] + u[2] * fw[2]
        u = u.map((v, j) => v - fw[j] * uf)
        const ul = Math.hypot(u[0], u[1], u[2]); u = u.map(v => v / ul)
        F.fwd = fw; F.up = u
        // looking around (drag, arrows, fallLook): right arrow looks right,
        // up looks up, as the arrows do in the sky view (the orbit's up
        // raises the camera instead); eased like the orbit, back after a pause
        const lk = [key("right") - key("left"), key("up") - key("down")]
        if (inView && (lk[0] !== 0 || lk[1] !== 0)) fallLookBy(lk[0] * dt * 0.8, lk[1] * dt * 0.6)
        gxLookIdle = gxLookDragging ? 0 : gxLookIdle + dt
        if (!gxLookHold && gxLookIdle > 2.5) {
          // the short way home: whole turns dropped first
          const w = Math.round(gxLookYawTarget / (2 * Math.PI)) * 2 * Math.PI
          gxLookYawTarget -= w; gxLookYaw -= w
          const d = Math.min(1, dt / 1.5)
          gxLookYawTarget -= gxLookYawTarget * d
          gxLookPitchTarget -= gxLookPitchTarget * d
        }
        const ek = Math.min(1, dt * 3)
        gxLookYaw += (gxLookYawTarget - gxLookYaw) * ek
        gxLookPitch += (gxLookPitchTarget - gxLookPitch) * ek
        // the view handed to the shaders: the scripted one turned by the
        // offset. They take the radial direction from the camera's position,
        // not from the view, so the observer's frame is untouched.
        const cy = Math.cos(gxLookYaw), sy = Math.sin(gxLookYaw)
        const cq = Math.cos(gxLookPitch), sq = Math.sin(gxLookPitch)
        const rt = [fw[1] * u[2] - fw[2] * u[1], fw[2] * u[0] - fw[0] * u[2], fw[0] * u[1] - fw[1] * u[0]]
        const f1 = fw.map((v, j) => v * cy + rt[j] * sy)
        F.lookFwd = f1.map((v, j) => v * cq + u[j] * sq)
        F.lookUp = u.map((v, j) => v * cq - f1[j] * sq)
        // the exposure follows what is in view (the user's own look too),
        // easing like an eye: it closes for a brighter view faster than it
        // opens for a darker one (6 and 2.5 e-folds a second), so turning
        // back down onto the boosted gas does not flare for a second
        F.tilt = Math.acos(Math.max(-1, Math.min(1, -(F.lookFwd[0] * F.x[0] + F.lookFwd[1] * F.x[1] + F.lookFwd[2] * F.x[2]))))
        const wantExp = Fall.exposure(F.tl, r, o.E, F.tilt, aspect)
        const ex = Math.exp(Math.log(gxHoleExp) + (Math.log(wantExp) - Math.log(gxHoleExp)) * Math.min(1, dt * (wantExp < gxHoleExp ? 6 : 2.5)))
        if (Math.abs(ex / gxHoleExp - 1) > 1e-3) gxHoleExp = ex
        cam = [F.x[0] * r * rsKpc, F.x[1] * r * rsKpc, F.x[2] * r * rsKpc]
        gxDist = r * rsKpc
        gxTarget = [0, 0, 0]
      }
      // only hand the shaders a new camera when it really moved: an unchanged
      // camera lets the galaxy volume skip redrawing (it is the costly pass)
      // (falling, the view turns every frame: always)
      const moved = !!fallState || Math.hypot(cam[0] - gxCamPos.x, cam[1] - gxCamPos.y, cam[2] - gxCamPos.z) > gxDist * 1e-5
                 || Math.abs(fwd.x - gxFwd.x) + Math.abs(fwd.y - gxFwd.y) + Math.abs(fwd.z - gxFwd.z) > 1e-6
      if (moved) { gxCamPos = Qt.vector3d(cam[0], cam[1], cam[2]); gxCam = cam }
      gxHoleNear = Math.hypot(cam[0], cam[1], cam[2]) < 1e-5
      if (gxHoleNear) gxCamRs = Qt.vector3d(cam[0] / rsKpc, cam[1] / rsKpc, cam[2] / rsKpc)
      if (moved) {
        if (fallState) {
          gxFwd = Qt.vector3d(fallState.lookFwd[0], fallState.lookFwd[1], fallState.lookFwd[2])
          gxUp = Qt.vector3d(fallState.lookUp[0], fallState.lookUp[1], fallState.lookUp[2])
          gxRight = gxFwd.crossProduct(gxUp)
        } else {
          gxFwd = fwd
          gxRight = right
          gxUp = up
        }
      }
      // near the hole its tracer (holePass, one per screen) is offered this
      // frame's camera; it takes it at its own rate, the faster one while
      // the camera moves. (A view that only turns needs no new trace:
      // universe.frag reads the layer by direction.)
      if (gxHoleNear) holeSync(moved)
      // the Milky Way's own stars thin out once we are outside it
      const outside = Math.max(Math.hypot(cam[0], cam[1]) - 15, Math.abs(cam[2]) - 0.5, 0)
      gxStars = 1 - 0.85 * Math.min(1, outside / 10)
      {
        // the real sky (as seen from the Sun) holds while the view would barely
        // differ: the band's light comes from kiloparsecs away, so a few
        // hundred parsecs change little. It hands over to the model gradually,
        // in log distance from 0.2 to 2.5 kpc, sooner once we leave the disk.
        const s0 = sunPosAt(0)
        const ds = Math.hypot(cam[0] - s0[0], cam[1] - s0[1], cam[2] - s0[2])
        const reach = Math.abs(cam[2]) > 0.6 ? 0.8 : 2.5
        const near = 1 - Math.min(1, Math.max(0, Math.log(Math.max(ds, 1e-6) / 0.2) / Math.log(reach / 0.2)))
        const nowish = 1 - Math.min(1, Math.max(0, (Math.abs(gxMyr) - 0.2) / 0.8))
        const rs = near * near * (3 - 2 * near) * nowish
        if (Math.abs(rs - gxRealSky) > 1e-3 || (rs === 0) !== (gxRealSky === 0)) gxRealSky = rs
      }
      // exposure adapts like an eye: dimmer inside the disk, where light
      // comes from every side, and much dimmer in the crowded bulge
      // (the same old-disk and bulge light as galaxy.frag, at the camera)
      {
        const b = sunOmega * gxMyr, c = Math.cos(b), sn = Math.sin(b)
        const mx = cam[0] * c - cam[1] * sn, my = cam[1] * c + cam[0] * sn
        const R = Math.hypot(mx, my), az = Math.abs(cam[2])
        const u = mx * 0.45399 + my * 0.89101, v = mx * 0.89101 - my * 0.45399
        const local = Math.exp(-R / 2.6) * (Math.exp(-az / 0.3) + 0.12 * Math.exp(-az / 0.9)) * 0.55
                    + Math.exp(-Math.sqrt((u / 0.7) ** 2 + (v / 0.44) ** 2 + (cam[2] / 0.18) ** 2))
        const inside = (1 - Math.min(1, Math.max(0, (az - 0.3) / 1.5))) * (1 - Math.min(1, Math.max(0, (R - 14) / 4)))
        const want = 3.0 / (1 + 4 * inside + 10 * local)
        const ex = Math.exp(Math.log(gxExposure) + (Math.log(want) - Math.log(gxExposure)) * Math.min(1, dt * 2))
        if (Math.abs(ex / gxExposure - 1) > 1e-3) gxExposure = ex // settled: stop nudging it
      }
      // the chosen place, drawn up close in universe.frag
      if (gxSel >= 0) {
        const h = place(gxSel)
        const hp = hotspotPos(gxSel)
        const hx = parseInt(h.color.slice(1), 16)
        const c = { r: (hx >> 16 & 255) / 255, g: (hx >> 8 & 255) / 255, b: (hx & 255) / 255 }
        // a dwarf galaxy is drawn in 3D by galaxy.frag: no card for it
        gxFocus = Qt.vector4d(hp[0], hp[1], hp[2], h.dwarf ? 0 : h.size / 1000)
        gxFocusCol = Qt.vector4d(c.r, c.g, c.b, gxKinds[h.kind])
        // its photo, weighted by how close we are to Earth's line of sight
        const ph = photoOf(gxSel)
        if (ph) {
          const Sn = sunPosAt(gxMyr)
          const a = [cam[0] - hp[0], cam[1] - hp[1], cam[2] - hp[2]]
          const s = [Sn[0] - hp[0], Sn[1] - hp[1], Sn[2] - hp[2]]
          const cosA = (a[0] * s[0] + a[1] * s[1] + a[2] * s[2]) / Math.max(1e-12, Math.hypot(...a) * Math.hypot(...s))
          // cos of our view against Earth's: the shader shows the photo, or its
          // mirror image from the far side, crossfading in between
          // celestial north on screen, clockwise from up
          const n = ncpDir, fd = fwd.x * n[0] + fwd.y * n[1] + fwd.z * n[2]
          const ns = [n[0] - fwd.x * fd, n[1] - fwd.y * fd, n[2] - fwd.z * fd]
          const ang = Math.atan2(ns[0] * right.x + ns[1] * right.y + ns[2] * right.z, ns[0] * up.x + ns[1] * up.y + ns[2] * up.z)
          gxPhoto = Qt.vector4d(ph[0], photoWidthKpc(gxSel), ang, Math.max(-1, Math.min(1, cosA)))
          // the galaxies drawn in 3D from their photos (Andromeda, Triangulum,
          // the Magellanic Clouds) hand over to the card by view angle: the
          // model fades out as our view nears Earth's line of sight and the
          // card (kind 7 in universe.frag) fades in, by the same rule
          const model = modelOf(h)
          const fade = model ? LG.handoff(cosA).model : 1
          m31Fade = model === "m31" ? fade : 1
          m33Fade = model === "m33" ? fade : 1
          lmcFade = model === "lmc" ? fade : 1
          smcFade = model === "smc" ? fade : 1
          if (model) gxFocusCol = Qt.vector4d(gxFocusCol.x, gxFocusCol.y, gxFocusCol.z, 7)
        } else { gxPhoto = Qt.vector4d(0, 0, 0, 0); gxResetFades() }
      } else if (gxSel === -1) {
        gxPhoto = Qt.vector4d(0, 0, 0, 0)
        gxResetFades()
        const sp0 = sunPosAt(gxMyr)
        gxFocus = Qt.vector4d(sp0[0], sp0[1], sp0[2], 0.00001)
        gxFocusCol = Qt.vector4d(1.0, 0.96, 0.88, 4)
      } else {
        gxFocus = Qt.vector4d(0, 0, 0, 0)
        gxPhoto = Qt.vector4d(0, 0, 0, 0)
        gxResetFades()
      }
      // labels: projected, and laid out by the one label pass (the chosen and
      // the hovered place first, then the Sun, the hotspots by size, the
      // dwarfs). The hotspots always get their marker; a dwarf galaxy only
      // when chosen, big enough on screen or under the pointer (dot), so
      // the sky is not a field of dots
      const pts = []
      const nAll = gxSunIndex + 1 + dwarfPlaces.length
      for (let i = 0; i < nAll; i++) {
        const isSunI = i === gxSunIndex
        const h = isSunI ? null : place(i)
        if (h && h.hidden) { pts.push({ x: 0, y: 0, front: false, z: 1, apparent: 0, show: false, dot: false }); continue }
        const P = isSunI ? sunPosAt(gxMyr) : hotspotPos(i)
        const v = [P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]]
        const zc = v[0] * fwd.x + v[1] * fwd.y + v[2] * fwd.z
        const x = (v[0] * right.x + v[1] * right.y + v[2] * right.z) / Math.max(zc, 1e-9)
        const y = -(v[0] * up.x + v[1] * up.y + v[2] * up.z) / Math.max(zc, 1e-9)
        const isSel = isSunI ? gxSel === -1 : i === gxSel
        const size = h ? h.size / 1000 : 0.0001
        const apparent = size / Math.max(zc, 1e-12)
        const filling = isSel && apparent > 0.08
        const front = zc > 0 && Math.abs(x) < aspect * 0.5 && Math.abs(y) < 0.5 && !filling
        pts.push({ x: x, y: y, front: front, z: zc, apparent: apparent, show: false, dot: front && (!h || !h.dwarf || isSel || apparent > 0.015) })
      }
      // the place under the pointer (within 28 px): hovered, and marked if a dwarf
      let hov = -1
      if (gxPointer) {
        let bestD = 28 * gxPointer[2]
        for (let i = 0; i < nAll; i++) {
          if (!pts[i].front) continue
          const d = Math.hypot(pts[i].x - gxPointer[0], pts[i].y - gxPointer[1])
          if (d < bestD) { bestD = d; hov = i }
        }
        if (hov >= 0) pts[hov].dot = true
      }
      if (hov !== gxHover) gxHover = hov
      const sel = gxSel >= 0 ? gxSel : gxSel === -1 ? gxSunIndex : -1
      const L0 = lay0, tok0 = L0.tok, zones = labelZones()
      const toX = x => L0.W / 2 + x * L0.H, toY = y => (y + 0.5) * L0.H
      // a dot under the bar or notch, the card or the caption
      // hides (and cannot be clicked); inside the ring it stays: thin lines
      for (const pt of pts) {
        if (pt.dot && (toY(pt.y) < L0.safe.y0 || zones.cover.some(k => Lay.pointIn(toX(pt.x), toY(pt.y), k)))) pt.dot = false
      }
      const isDwarf = i => i !== gxSunIndex && !!place(i).dwarf
      const order = pts.map((_, i) => i).filter(i => pts[i].dot)
        .sort((a, b) => (b === sel) - (a === sel) || (b === hov) - (a === hov) || (b === gxSunIndex) - (a === gxSunIndex)
                        || isDwarf(a) - isDwarf(b) || pts[b].apparent - pts[a].apparent)
      const res = Lay.placeLabels(order.map(i => {
        const name = i === gxSunIndex ? "SUN  ·  YOU ARE HERE" : place(i).name
        return { id: "g" + i, x: toX(pts[i].x), y: toY(pts[i].y), r: tok0.gap, w: textW(name.toUpperCase(), tok0.label), h: tok0.label * 1.5,
                 pin: i === sel || i === hov }
      }), zones.all, L0.safe, labelState.sides)
      order.forEach((i, n) => { pts[i].show = res[n].show; pts[i].side = res[n].side })
      if (zones.disc) for (const i of [sel, hov]) {
        if (i >= 0 && pts[i] && pts[i].front && Math.hypot(toX(pts[i].x) - zones.disc.cx, toY(pts[i].y) - zones.disc.cy) < zones.disc.r) subjectInRing = true
      }
      gxScreen = pts
    }

    // the text model: the level's gates, and each zone up for as long as its
    // words take after an interaction, then gone. A fall is scripted (nothing
    // steers, so nothing would touch the clock): it holds its own text up
    if (fallState) touchText()
    Tx.dwell(textModel, hudPointerIn && gateCockpit > 0.5, dt)
    Tx.step(textModel, dt, textShown, { label: 0, card: cardWords, hints: hintWords, caption: captionWords, dial: Tx.DIAL_WORDS, sys: 0, units: 0, anat: anatWords }, ["sys", "units"])
    readTextModel()
    // the story band: the caption up and how far (the screens' bands bind to these)
    Tx.storyStep(story, dt)
    {
      const c = story.cur, up = Tx.storyOpacity(story)
      if (c && (c.title !== storyTitle || c.body !== storyBody)) { storyTitle = c.title; storyBody = c.body }
      if (up !== storyShow) storyShow = up
    }

    mix.hover.g = hoverSystem && explore === "universe" ? 1 : 0
    sysHover = mix.hover.step(dt)
    mix.sys.g = explore === "system" ? 1 : 0
    sys = mix.sys.step(dt)

    // the shader's scene: every body relative to the focus (the reference
    // point, in doubles), the eye relative to it, the basis and focal length.
    // Qt vectors are built here only, never read back.
    {
      const Rw = camF
      sceneBodies = disp.map(b => Qt.vector4d(b[0] - Rw[0], b[1] - Rw[1], b[2] - Rw[2], b[3]))
      sceneMoon = Qt.vector4d(moonD[0] - Rw[0], moonD[1] - Rw[1], moonD[2] - Rw[2], moonD[3])
      sceneSun = Qt.vector4d(-Rw[0], -Rw[1], -Rw[2], sunR)
      scenePlaneY = -Rw[1]
      camPos = Qt.vector3d(cb.relC[0], cb.relC[1], cb.relC[2])
      camFwd = Qt.vector3d(cb.fwd[0], cb.fwd[1], cb.fwd[2])
      camRight = Qt.vector3d(cb.right[0], cb.right[1], cb.right[2])
      camUp = Qt.vector3d(cb.up[0], cb.up[1], cb.up[2])
      focal = cb.focal
      principal = Qt.vector2d(cb.o[0], cb.o[1])
    }

    // labels and markers, projected once per tick through the same camera,
    // and laid out by the one label pass: the pinned body first, then the
    // Moon, Earth and Sun markers, then the outer planets before the inner
    // (which crowd together when zoomed out). In the galactic view its own
    // names take the pass: the heading's words, then the planets.
    {
      const L0 = lay0, tk = L0.tok
      const toX = x => L0.W / 2 + x * L0.H, toY = y => (y + 0.5) * L0.H
      const pts = disp.map(b => { const pr = sysCam.project(b); return { x: pr.x, y: pr.y, r: b[3] * pr.scale, front: pr.front, show: false, side: 1 } })
      const mk = {}
      for (const [kind, P, R] of [["moon", moonD, moonD[3]], ["earth", disp[2], disp[2][3]], ["sun", [0, 0, 0], sunR]]) {
        const pr = sysCam.project(P)
        // behind the camera: pushed to the edge, mirrored
        const k = pr.front ? 1 : -1000
        mk[kind] = { x: pr.x * k, y: pr.y * k, r: pr.front ? R * pr.scale : 0, dist: Cam.len(Cam.sub(P, cb.C)) }
      }
      markerPts = mk
      const items = [], put = []   // put: where each item's answer goes
      // no name of these shows outside the system and galactic views (the
      // universe view, the galaxy, the sky): no pass, and nothing to place
      const zones = sys > 0.5 || galMix > 0.5 ? labelZones() : null
      if (!zones) {
        if (galLabels.length > 0) galLabels = []
        if (labelsDiffer(markerLabels, {})) markerLabels = ({})
      } else if (galMix > 0.5) {
        const gl = galNow.map(() => ({ show: false, side: 1 }))
        const s0 = galNow[0]
        if (s0 && s0.z > 0.004) {
          const reach = 0.06 * L0.H
          // the heading's words point away from the Sun, never back across it
          items.push({ id: "gal-heading", x: toX(s0.x) + galHeading.x * reach, y: toY(s0.y) + galHeading.y * reach, r: tk.gap + tk.glyph * 0.3,
                       w: textW(galHeadingText, tk.micro), h: tk.micro * 1.5, pin: false, only: galHeading.x >= 0 ? 1 : -1 })
          put.push(gl[0])
        }
        for (let i = 1; i < galNow.length; i++) {
          const b = galNow[i]
          if (!(b.z > 0.004)) continue
          items.push({ id: "gal-" + i, x: toX(b.x), y: toY(b.y), r: Math.max(4, b.r * L0.H * 2) / 2 + tk.gap,
                       w: textW(planetInfo[i - 1].name.toUpperCase(), tk.micro), h: tk.micro * 1.5, pin: false })
          put.push(gl[i])
        }
        const res = Lay.placeLabels(items, zones.all, L0.safe, labelState.sides)
        res.forEach((r, n) => { put[n].show = r.show; put[n].side = r.side })
        if (labelsDiffer(galLabels, gl)) galLabels = gl
        if (labelsDiffer(markerLabels, {})) markerLabels = ({})
      } else {
        const ml = {}
        const planet = k => {
          if (!pts[k].front) return
          items.push({ id: "p" + k, x: toX(pts[k].x), y: toY(pts[k].y), r: pts[k].r * L0.H + tk.gap,
                       w: textW(planetInfo[k].name.toUpperCase(), tk.label), h: tk.label * 1.5, pin: k === follow - 1 })
          put.push(pts[k])
        }
        const named = chaseMix < 0.5   // the chase view has markers only
        if (named && follow >= 1 && follow <= 6) planet(follow - 1)
        for (const kind of ["sun", "earth", "moon"]) {
          ml[kind] = { show: false, side: 1 }
          if (!markerWanted(kind, L0)) continue
          const pr = markerProj(kind, L0.W, L0.H)
          const at = Lay.clampMarker(pr.x, pr.y, L0.safe, zones.keep, tk.gap)
          items.push({ id: "m-" + kind, x: at.x, y: at.y, r: tk.gap + 6, w: textW(markerLabel(kind), tk.label), h: tk.label * 1.5, pin: false })
          put.push(ml[kind])
        }
        if (named) for (let k = 5; k >= 0; k--) if (k !== follow - 1) planet(k)
        const res = Lay.placeLabels(items, zones.all, L0.safe, labelState.sides)
        res.forEach((r, n) => { put[n].show = r.show; put[n].side = r.side })
        if (labelsDiffer(markerLabels, ml)) markerLabels = ml
        if (zones.disc && explore === "system" && follow >= 1 && follow <= 6 && pts[follow - 1].front
            && Math.hypot(toX(pts[follow - 1].x) - zones.disc.cx, toY(pts[follow - 1].y) - zones.disc.cy) < zones.disc.r) subjectInRing = true
      }
      sysScreen = pts
    }
    mix.yield.g = subjectInRing && gateNames * presLabel > 0.01 ? 0.3 : 1
    cockpitYield = mix.yield.step(dt)

    // JARVIS: beacons every frame, telemetry 5 times a second
    {
      const nb = [null, null, null, null, null]
      let card = null   // the pinned body's card (system view), on a refresh
      let want = null   // what the instrument should show (dialWant), on a refresh
      const refresh = now >= navNextAt
      if (refresh) navNextAt = now + 200
      if (explore === "system" && !galactic) {
        // the one camera's basis, directions from its eye
        const R = cb.right, U = cb.up, F = cb.fwd
        const fi = follow === 7 ? -2 : follow - 1          // index into real[], -1 the Sun, -2 the Moon
        const at = fi === -1 ? [0, 0, 0] : fi === -2 ? [real[2][0] + mg[0], real[2][1] + mg[1], real[2][2] + mg[2]] : follow < 0 ? null : real[fi]
        const from = at || [0, 0, 0]
        const d = (a) => Math.hypot(a[0] - from[0], a[1] - from[1], a[2] - from[2])
        // directions in display space (what is drawn), distances in real AU
        const subD = (a) => Cam.sub(a, cb.C)
        if (fi !== -1) nb[0] = beaconOf(subD([0, 0, 0]), R, U, F, "SUN", fmtAu(d([0, 0, 0])), "#ffd27a", cb.focal)
        if (fi !== 2) nb[1] = beaconOf(subD(disp[2]), R, U, F, "EARTH", fmtAu(d(real[2])), "#6ab7ff", cb.focal)
        if (fi === 2 || fi === -2) {
          nb[2] = beaconOf(fi === 2 ? subD(moonD) : subD(disp[2]), R, U, F, fi === 2 ? "MOON" : "EARTH", fmtNum(moonDistanceKm) + " KM", "#cfd6e6", cb.focal)
        }
        if (chasing && chaseTarget !== 0 && chaseTarget !== 3 && chaseTarget !== 7) {
          nb[3] = beaconOf(subD(bodyP(chaseTarget)), R, U, F, chaseTargetName.toUpperCase(), fmtAu(d(real[chaseTarget - 1])), root.hudHighlight, cb.focal)
        }

        if (refresh) {
          if (at) {
            // the pinned body's card: what it is aimed at, how far the Sun
            // and Earth are and how old their light is, its orbit and its day
            const rSun = Math.hypot(at[0], at[1], at[2])
            const rEarth = d(real[2])
            const dist = []
            if (follow !== 0) dist.push("FROM THE SUN " + fmtAu(rSun) + "  ·  ITS LIGHT TAKES " + fmtNum(rSun * 8.317, 1) + " MIN")
            if (follow !== 3) dist.push("FROM EARTH " + fmtAu(rEarth) + "  ·  ITS LIGHT TAKES " + (rEarth * 8.317 < 1 ? fmtNum(rEarth * 499.0, 1) + " S" : fmtNum(rEarth * 8.317, 1) + " MIN"))
            const facts = []
            if (follow >= 1 && follow <= 6) {
              const pl = planetInfo[follow - 1], a = orbits[follow - 1][3]
              const v = 29.7847 * Math.sqrt(Math.max(0, 2 / rSun - 1 / a))
              facts.push("Moving at " + fmtNum(v, 1) + " km/s  ·  one year = " + (a < 1.5 ? fmtNum(Math.pow(a, 1.5) * 365.25) + " days" : fmtNum(Math.pow(a, 1.5), 1) + " years"))
              // one turn against the stars (not sunrise to sunrise: Mercury's day is 176 of ours, its spin 58.6), in days past 48 hours
              const spin = Math.abs(pl.day)
              facts.push("One spin: " + (spin > 2 ? fmtNum(spin, spin < 100 ? 1 : 0) + " days" : fmtNum(spin * 24, 1) + " hours") + (pl.day < 0 ? ", backward" : "") + "  ·  " + fmtNum(pl.km * 2) + " km wide")
            }
            if (follow === 3 || follow === 7) facts.push("Moon " + fmtNum(moonNow.lit * 100) + "% lit, " + (moonNow.waxing ? "waxing" : "waning") + "  ·  " + fmtNum(moonDistanceKm) + " km from Earth")
            card = { title: (follow === 7 ? "MOON" : follow === 0 ? "SUN" : planetInfo[follow - 1].name.toUpperCase()) + (chasing ? "  →  " + chaseTargetName.toUpperCase() : ""),
                     sub: dist.join("\n"), facts: facts.join("\n") }
          }
          // the instrument: the time rate on seven detents; how far the Sun,
          // Earth, the Moon and the chase target are from the pinned body
          // (log AU; a free camera is nowhere, so no scale); the Moon's
          // phase beside Earth; a year ring while the clock is not now
          want = dialWant("system")
          want.mode = 2; want.g = Dial.detentG(simRateIndex, simRates.length); want.majors = simRates.length - 1; want.snap = true
          want.landmarks = [{ g: 0, text: "LIVE" }, { g: 0.5, text: "DAY" }, { g: 1, text: "YEAR" }]
          const lapse = Math.abs(simMs - now) > 90000
          if (lapse) want.time = [1, Sun.yearFraction(new Date(simMs)), -1, -1]
          let targetAu = -1
          if (at) {
            const bugAt = (dAu, color) => Object.assign(Dial.logG(dAu, 0.001, 100), { color: color })
            want.range = { mode: 1, n: 5, tape: 0 }
            if (fi !== -1) want.bugs[0] = bugAt(d([0, 0, 0]), "#ffd27a")
            if (fi !== 2) want.bugs[1] = bugAt(d(real[2]), "#6ab7ff")
            if (fi === 2) want.bugs[2] = bugAt(moonDistanceKm / auKm, "#cfd6e6")
            if (chasing) {
              const tp = chaseTarget === 0 ? [0, 0, 0] : chaseTarget === 7 ? [real[2][0] + mg[0], real[2][1] + mg[1], real[2][2] + mg[2]] : real[chaseTarget - 1]
              if (tp) {
                targetAu = d(tp)
                if (chaseTarget !== 0 && chaseTarget !== 3 && chaseTarget !== 7) want.bugs[3] = bugAt(targetAu, root.hudHighlight)
              }
            }
            if (follow === 3 || follow === 7) want.gap = gapMoon()
          }
          want.units = [at ? "AU" : "", "RATE"]
          want.readout = Dial.readout("system", { targetAu: targetAu, date: lapse ? Qt.formatDate(new Date(simMs), "d MMM yyyy").toUpperCase() : "", sunAu: at ? Math.hypot(at[0], at[1], at[2]) : 0 }, dialChars)
        }
      } else if (explore === "galaxy") {
        const cam = [gxCamPos.x, gxCamPos.y, gxCamPos.z]
        const R = [gxRight.x, gxRight.y, gxRight.z], U = [gxUp.x, gxUp.y, gxUp.z], F = [gxFwd.x, gxFwd.y, gxFwd.z]
        const sp = sunPosAt(gxMyr)
        const ly = 3261.56
        const vec = (P) => [P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]]
        const len = (v) => Math.hypot(v[0], v[1], v[2])
        nb[0] = beaconOf(vec(sp), R, U, F, "SUN", fmtLy(len(vec(sp)) * ly), "#ffd27a")
        nb[1] = beaconOf(vec([0, 0, 0]), R, U, F, "CENTRE", fmtLy(len(vec([0, 0, 0])) * ly), "#ffb070")
        if (gxSel >= 0 && !place(gxSel).name.startsWith("Sagittarius A")) {
          const P = hotspotPos(gxSel)
          nb[2] = beaconOf(vec(P), R, U, F, place(gxSel).name.toUpperCase(), fmtLy(len(vec(P)) * ly), root.hudHighlight)
        }
        const m31 = hotspots[gxIndex("Andromeda")].pos
        if (gxSel !== gxIndex("Andromeda")) nb[3] = beaconOf(vec(m31), R, U, F, "ANDROMEDA", fmtLy(len(vec(m31)) * ly), "#fff0d8")
        // the nearest place (found on the refresh), unless it is the target or already has a beacon
        const ni = dialRun.near
        if (ni >= 0 && ni < hotspots.length && ni !== gxSel && ni !== gxIndex("Andromeda") && !fallState && !hotspots[ni].name.startsWith("Sagittarius A")) {
          const P = hotspotPos(ni)
          nb[4] = beaconOf(vec(P), R, U, F, hotspots[ni].name.toUpperCase(), fmtLy(len(vec(P)) * ly), "#fff0d8")
        }
        // speed: how fast the camera moves, eased
        if (gxPrevCam) {
          const v = Math.hypot(cam[0] - gxPrevCam[0], cam[1] - gxPrevCam[1], cam[2] - gxPrevCam[2]) / Math.max(dt, 1e-3)
          gxSpeed += (v - gxSpeed) * Math.min(1, dt * 4)
        }
        gxPrevCam = cam
        if (refresh) {
          const h = vec(sp).map(x => -x)                     // camera from the Sun
          const hl = Math.max(len(h), 1e-12)
          let near = -1, nd = 1e9
          for (let i = 0; i < hotspots.length; i++) { const dd = len(vec(hotspotPos(i))); if (dd < nd) { nd = dd; near = i } }
          const lyPerS = gxSpeed * ly
          dialRun.near = near
          // what the fall's caption says under its title: where we are and
          // what is ahead (lib/fall.js values only; the hub's clock counts down)
          let detail = ""
          if (fallState) {
            const tl = fallState.tl
            // the realistic fall ends exactly at r-: that is "at", not "past"
            const where = fallR > tl.rPlus ? "ABOVE THE EVENT HORIZON (" + fmtNum(tl.rPlus, 2) + " RS)"
                        : fallR > tl.rMinus ? "BETWEEN THE HORIZONS  ·  EVERY PATH LEADS INWARD"
                        : fallR >= tl.rMinus - 1e-6 ? "AT THE INNER HORIZON (" + fmtNum(tl.rMinus, 2) + " RS)"
                        : fallR > 0 ? "PAST THE INNER HORIZON (" + fmtNum(tl.rMinus, 2) + " RS)"
                        : fallR > -tl.a ? "THROUGH THE MIDDLE OF THE RING" : "THE FAR SIDE  ·  THE HOLE PUSHES US AWAY"
            // the landmark ahead: how far (the radius is 12.3 million km) and how long on our own clock
            const nx = fallState.next
            const nxR = nx.what === "outer-horizon" ? tl.rPlus : nx.what === "inner-horizon" ? tl.rMinus : nx.what === "disk" ? 0 : tl.rEnd
            const nxKm = Math.abs(fallR - nxR) * Fall.RS_KM
            const nxIn = nx.left >= 60 ? fmtNum(Math.floor(nx.left / 60)) + " MIN " + fmtNum(Math.floor(nx.left % 60), 0) + " S" : fmtNum(nx.left, 1) + " S"
            const nxName = nx.what === "outer-horizon" ? "EVENT HORIZON" : nx.what === "inner-horizon" ? "INNER HORIZON" : nx.what === "disk" ? "THE MIDDLE OF THE RING" : tl.math ? "THE JOURNEY'S END" : "INNER HORIZON"
            detail = where + "  ·  AHEAD: " + nxName + "  ·  " + (nxKm >= 1e6 ? fmtNum(nxKm / 1e6, 1) + " MILLION KM" : fmtNum(Math.round(nxKm / 1000) * 1000) + " KM") + (fallR < 0 ? " OUT" : " BELOW")
                   + "  ·  " + nxIn + " AWAY ON OUR OWN CLOCK" + (tl.math ? "  ·  KERR'S EQUATIONS, BEYOND TESTED PHYSICS" : "")
          }
          if (fallDetail !== detail) fallDetail = detail
          const ev = dialRun.ev
          if (ev.key !== (fallState ? "fall" : "galaxy")) { ev.key = fallState ? "fall" : "galaxy"; ev.near = {}; ev.side = {}; ev.disk = {}; ev.hor = {}; ev.hold = {} }
          let event = false
          if (fallState) {
            // the fall: the radius on one signed-log scale from where it began
            // to where it ends (lib/fall.js), a hairline at the photon orbit,
            // redlines at the horizons; in mathematics mode the rim is dashed
            // past the inner horizon and r = 0 has a mark. The time ring drains
            // with the proper time left. No range scale: fall.js's speedAt is
            // dr/dtau, not a speed anyone measures locally (it passes c inside)
            const tl = fallState.tl, gOf = r => Dial.fallG(r, tl.r0, tl.rEnd)
            want = dialWant("fall")
            want.mode = 1; want.g = gOf(fallR)
            want.red = [gOf(tl.rPlus), tl.a > 0 ? gOf(tl.rMinus) : -1]
            want.hair = [gOf(tl.rPhoton), tl.math ? gOf(0) : -1]
            if (tl.math) want.dash = gOf(tl.rMinus)
            want.time = [2, tl.tauEnd > 0 ? Math.max(0, Math.min(1, fallLeft / tl.tauEnd)) : 0, -1, -1]
            want.units = ["", "RS"]
            want.readout = Dial.readout("fall", { r: fallR }, dialChars)
            event = Dial.changed(ev.hor, fallR > tl.rPlus ? 0 : fallR > tl.rMinus ? 1 : fallR > 0 ? 2 : 3)
          } else {
            // the Galaxy: speed as a multiple of light (log, 10^5..10^13), on the
            // pin while holding; how far the Sun, the centre, the target (or
            // Andromeda) and the nearest place are (log ly); the height over
            // the disk plane as the diamond (a decade a dot, hollow past 1 kpc)
            const xc = lyPerS * 31557600, KPC = 3261.56
            const bugAt = (dLy, color) => Object.assign(Dial.logG(dLy, 1, 1e7), { color: color })
            const sgr = gxSel >= 0 && place(gxSel).name.startsWith("Sagittarius A")
            const targetLy = gxSel >= 0 ? len(vec(hotspotPos(gxSel))) * ly : -1
            want = dialWant("galaxy")
            want.mode = 1; want.g = lyPerS < 0.01 ? 0 : Dial.logG(xc, 1e5, 1e13).g; want.majors = 8; want.minor = 1; want.long = 3 + 1 / 16
            want.range = { mode: 1, n: 7, tape: 0 }
            want.bugs[0] = bugAt(hl * ly, "#ffd27a")
            want.bugs[1] = bugAt(len(cam) * ly, "#ffb070")
            want.bugs[2] = gxSel >= 0 ? (sgr ? null : bugAt(targetLy, root.hudHighlight)) : bugAt(len(vec(m31)) * ly, "#fff0d8")
            if (near >= 0 && near !== gxSel) want.bugs[3] = bugAt(nd * ly, "#fff0d8")
            const hgt = Dial.signedLogG(cam[2] * ly, 1, KPC)
            want.gap = { mode: 1, v: hgt.g, flag: hgt.hollow ? 1 : 0, pitch: Dial.signedLogPitch(1, KPC) }
            want.units = ["LY", "× C"]
            want.landmarks = [{ g: 1 / 8, text: "1M" }, { g: 4 / 8, text: "1B" }, { g: 7 / 8, text: "1T" }]
            want.readout = Dial.readout("galaxy", { xc: lyPerS < 0.01 ? 0 : xc, targetLy: targetLy, sunLy: hl * ly }, dialChars)
            // worth a glance: another place is the nearest, the disk plane
            // crossed, the disk left or entered, a flight arrived
            const e1 = Dial.changed(ev.near, near), e2 = Dial.changed(ev.side, cam[2] >= 0), e3 = Dial.changed(ev.disk, Math.abs(cam[2]) < 1)
            const e4 = Dial.changed(ev.hold, lyPerS < 0.01) && lyPerS < 0.01 && gxSel >= 0
            event = e1 || e2 || e3 || e4
          }
          if (event) Tx.touchZone(textModel, "dial")
        }
      } else if (explore === "sky") {
        const R = [skyRight.x, skyRight.y, skyRight.z], U = [skyUp.x, skyUp.y, skyUp.z], F = [skyFwd.x, skyFwd.y, skyFwd.z]
        const sf = 0.5 / Math.tan(skyVfov * Math.PI / 360)
        nb[1] = beaconOf([0, -1, 0], R, U, F, "GALACTIC CENTRE", "26,600 LY", "#ffb070", sf)
        nb[2] = beaconOf([0, 0, 1], R, U, F, "GALACTIC NORTH", "", "#9fc3ff", sf)
        if (refresh) {
          const l = ((skyL % 360) + 360) % 360
          const eq = galToEq(l, skyB)
          // the sky: the field of view as an arc of its true angle; galactic
          // longitude on a heading tape (growing leftward, as on the sky); latitude as the diamond (+-90, a dot every 30)
          want = dialWant("sky")
          want.mode = 3; want.g = skyVfov / 360
          want.range = { mode: 2, n: 0, tape: l }
          want.gap = { mode: 1, v: Math.max(-1, Math.min(1, skyB / 90)), flag: 0, pitch: 1 / 3 }
          want.units = ["l °", "FIELD"]
          want.readout = Dial.readout("sky", { ra: eq[0], dec: eq[1] }, dialChars)
        }
      }
      // beacons pointing nearly the same way stack their labels
      for (let i = 0; i < nb.length; i++) {
        if (!nb[i]) continue
        for (let j = 0; j < i; j++) if (nb[j] && Math.abs(Math.atan2(Math.sin(nb[i].ang - nb[j].ang), Math.cos(nb[i].ang - nb[j].ang))) < 0.22) nb[i].shift = Math.max(nb[i].shift, nb[j].shift + 1)
      }
      navBeacons = nb
      if (refresh) {
        const was = sysCard
        if (!card !== !was || (card && (card.title !== was.title || card.sub !== was.sub || card.facts !== was.facts))) sysCard = card
        if (explore !== "galaxy" && fallDetail !== "") fallDetail = ""
      }
      if (refresh && !want) {
        want = dialWant(explore === "system" ? "galactic" : explore)
        if (explore === "flight") {
          // the star layers have no physical unit: the throttle, relative, never a speed
          const th = flightSpeed / 1.15
          want.mode = 1; want.g = Math.min(1, Math.abs(th)); want.majors = 4; want.minor = 2
          want.units = ["", "THRUST"]
          want.readout = Dial.readout("flight", { thrust: th * 100 }, dialChars)
        } else if (explore === "universe") want.gap = gapMoon()   // parked: the Moon as it is tonight
      }
      // the hub's line names the anatomy for a moment when it comes up or turns to another body
      if (want && now < anatRun.readoutUntil) want.readout = "ANATOMY"
      if (want) dialRun.want = want
      // where the beacons' words and the dial's landmark labels stand on the
      // first screen (as the readout places them, from measured widths):
      // scene names keep clear of them
      const words = []
      if (gateCockpit > 0.01 && explore !== "universe") {
        const h0 = Lay.hudAt(lay0, [hudDrift.x, hudDrift.y]), tk = lay0.tok
        for (const b of nb) {
          if (!b) continue
          const bw = textW(b.name + (b.dist ? "  " + b.dist : ""), tk.micro), bh = tk.micro * 1.4
          const at = Lay.beaconLabel(b.ang, bw, bh, h0.cx, h0.cy, h0.R * Lay.BEACON / Lay.RING + tk.gap, lay0.safe, [], b.shift)
          if (at.show) words.push({ x: at.x, y: at.y, w: bw, h: bh })
        }
        if (h0.s >= 0.8 && presDial > 0.01) for (const m of dialLandmarks) {
          const mw = textW(m.text, tk.micro), mh = tk.micro * 1.4
          const at = Lay.beaconLabel(Lay.sweepAngle(m.g, hudSway), mw, mh, h0.cx, h0.cy, h0.R + tk.gap / 2, lay0.safe, [], 0)
          if (at.show) words.push({ x: at.x, y: at.y, w: mw, h: mh })
        }
      }
      labelState.beacons = words
      dialStep(dt, now)
    }

    anatStep(dt, now)

    mix.exposure.g = emptyWorkspace && explore === "universe" ? 1.9 : 1
    exposure = mix.exposure.step(dt)

    // anything still easing keeps the idle clock at its full rate (see idleFps)
    idleBusy = bootLevel < 1 || sys > 0 || galaxyMix > 0 || skyMix > 0 || navMix > 0 || galMix > 0 || fallFade > 0 || sysCam.flying()
      || mix.viewX.moving() || mix.viewY.moving() || mix.hover.moving() || mix.exposure.moving()
      || mix.speed.moving() || mix.strafeX.moving() || mix.strafeY.moving() || textModel.moving || story.moving || mix.yield.moving() || mix.anat.moving() || (anatMix > 0 && anatBusy())
    gauges = Qt.vector3d(cpu, gpu, mem)
  }

  // Live system stats for the HUD gauges, read every 2 s while it animates.
  property real cpu: 0
  property real gpu: 0
  property real mem: 0
  Behavior on cpu { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  Behavior on gpu { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  Behavior on mem { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  // the gauges as of the last tick: under an idle cap the shader reads these,
  // or the 0.9 s easing above would redraw it at the display's rate
  property vector3d gauges: Qt.vector3d(0, 0, 0)
  property var stats: ({ cpu: 0, cpuTemp: 0, gpu: 0, gpuKnown: false, gpuWatts: 0, gpuTemp: 0, memUsed: 0, memTotal: 0 })
  property var lastCpu: null

  Process {
    id: statsProc
    command: ["bash", "-c",
      "head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; " +
      "nvidia-smi --query-gpu=utilization.gpu,power.draw,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || echo; " +
      "for h in /sys/class/hwmon/hwmon*; do [[ $(<$h/name) == coretemp ]] && cat $h/temp1_input && break; done"]
    stdout: StdioCollector {
      onStreamFinished: root.parseStats(String(text || ""))
    }
  }

  Timer {
    interval: 2000
    running: root.animate && root.liveBackground && root.hudLevel > 0
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!statsProc.running) statsProc.running = true
  }

  function parseStats(out) {
    const lines = out.split("\n")
    const s = Object.assign({}, stats)
    const j = lines[0].trim().split(/\s+/).slice(1).map(Number)
    if (j.length >= 5) {
      const idle = j[3] + (j[4] || 0)
      const total = j.reduce((a, b) => a + b, 0)
      if (lastCpu && total > lastCpu.total) s.cpu = 1 - (idle - lastCpu.idle) / (total - lastCpu.total)
      lastCpu = { idle: idle, total: total }
    }
    const kb = name => { const l = lines.find(x => x.startsWith(name)); return l ? Number(l.split(/\s+/)[1]) : 0 }
    s.memTotal = kb("MemTotal:") / 1048576
    s.memUsed = s.memTotal - kb("MemAvailable:") / 1048576
    const g = (lines[3] || "").split(",").map(x => Number(x.trim()))
    s.gpuKnown = g.length === 3 && !g.some(isNaN)   // nvidia-smi answered: without it the GPU arc is a bare track
    if (s.gpuKnown) { s.gpu = g[0] / 100; s.gpuWatts = g[1]; s.gpuTemp = g[2] }
    if (lines[4] && !isNaN(Number(lines[4]))) s.cpuTemp = Number(lines[4]) / 1000
    stats = s
    {
      // a machine event brings the machine labels up for a few seconds: the
      // CPU over 85% for 5 s, the GPU over 80 C, memory over 90% (and each
      // has to fall 5 points before it can fire again)
      const ev = dialRun.ev, dtS = 2
      const a = Dial.event(ev.cpu, s.cpu, 0.85, 0.80, dtS, Tx.EVENT_S, 5)
      const b = Dial.event(ev.gpuT, s.gpuKnown ? s.gpuTemp : 0, 80, 75, dtS, Tx.EVENT_S, 0)
      const c = Dial.event(ev.mem, s.memTotal > 0 ? s.memUsed / s.memTotal : 0, 0.90, 0.85, dtS, Tx.EVENT_S, 0)
      if (a || b || c) Tx.touchZone(textModel, "sys")
    }
    hudTemp = Qt.vector2d(s.cpuTemp > 0 ? Dial.tempG(s.cpuTemp) : -1, s.gpuKnown && s.gpuTemp > 0 ? Dial.tempG(s.gpuTemp) : -1)
    cpu = s.cpu
    gpu = s.gpu
    mem = s.memTotal > 0 ? s.memUsed / s.memTotal : 0
  }

  // ---- the HUD's instrument (universe.frag hud(), lib/dial.js) ----
  // One disc. Its inner zones (time, machine) look the same in every view;
  // the flight zone (the range scale with its bugs, the primary dial with
  // its needle, the gap window) is re-bound per view. The tick's nav
  // producer says five times a second what the instrument should show
  // (dialRun.want, see dialWant); dialStep eases the needle, the bugs and
  // the diamond toward it every frame and cross-fades the flight zone over a
  // view change. A scale with no honest value stays a bare track.
  property real hudSway: 0                                        // the frame's rocking, radians
  property vector4d hudTimeRing: Qt.vector4d(0, 0, -1, -1)
  property vector2d hudTemp: Qt.vector2d(-1, -1)
  property vector4d hudDial: Qt.vector4d(0, 0, 0, 0)
  property vector4d hudDialMark: Qt.vector4d(-1, -1, -1, 0)
  property vector4d hudDialAux: Qt.vector4d(-1, -1, 0, 0)
  property vector4d hudRange: Qt.vector4d(0, 0, 0, 1)
  property vector4d hudBug0: Qt.vector4d(0, 0, 0, -1)
  property vector4d hudBug1: Qt.vector4d(0, 0, 0, -1)
  property vector4d hudBug2: Qt.vector4d(0, 0, 0, -1)
  property vector4d hudBug3: Qt.vector4d(0, 0, 0, -1)
  property vector4d hudGap: Qt.vector4d(0, 0, 0, 1)
  // the words that go with it (the hub's readout line, the unit words in
  // the gap, the landmark labels outside the rim)
  property string dialKey: "universe"
  property string dialReadout: ""
  property var dialUnits: ["", ""]                                // the range scale's unit, the dial's
  property var dialLandmarks: []                                  // [{ g, text }], at most three
  property real dialFade: 1                                       // the flight zone's cross-fade
  // IPC `hudDemo <view>`: fixed, invented values on the instrument, so every
  // element can be looked at without flying there; the hub says DEMO
  property string hudDemo: ""
  readonly property var dialRun: ({ want: null, shown: null, needle: [0, 0], arc: 0, bugs: [-1, -1, -1, -1], gap: 0, fade: 1, pulse: [0, 0], side: [0, 0],
                                    near: -1,
                                    ev: { key: "", near: {}, side: {}, disk: {}, hor: {}, hold: {}, cpu: {}, gpuT: {}, mem: {} } })
  // how many characters the hub's readout line holds on the first screen (11 at most)
  readonly property int dialChars: {
    const hb = Lay.hubLines(Lay.hudAt(lay0, null), lay0.tok)
    return Math.max(6, Math.min(11, Math.floor((hb.readout.maxW - 6) / (lay0.tok.micro * (0.62 + lay0.tok.track.normal)))))
  }
  // daylight at home today (lib/sun.js), found once a day
  property var sunToday: ({ key: "", rise: -1, set: -1 })
  function rgb3(c) {
    if (typeof c === "string") { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
    return [c.r, c.g, c.b]
  }
  // what the instrument shows: every view starts from this (a dormant dial,
  // no range scale, an empty gap, the day ring) and fills in what it knows
  function dialWant(key) {
    return { key: key, mode: 0, g: 0, majors: 0, minor: 0, long: 0, red: [-1, -1], dash: -1, hair: [-1, -1], snap: false,
             range: { mode: 0, n: 0, tape: 0 }, bugs: [null, null, null, null], gap: { mode: 0, v: 0, flag: 0, pitch: 1 },
             time: null, readout: "", units: ["", ""], landmarks: [] }
  }
  // the Moon in the gap window: lit fraction and side (moonNow, from the tick)
  property var moonNow: ({ lit: 0, waxing: true })
  function gapMoon() { return { mode: 2, v: moonNow.lit, flag: moonNow.waxing ? 1 : -1, pitch: 1 } }
  function hudDemoWant(name) {
    const w = dialWant("demo-" + name), hi = hudHighlight
    const KPC = 3261.56
    if (name === "universe") w.gap = gapMoon()
    else if (name === "flight") {
      w.mode = 1; w.g = 0.7; w.majors = 4; w.minor = 2; w.readout = "70%"; w.units = ["", "THRUST"]
    } else if (name === "system" || name === "year") {
      w.mode = 2; w.g = Dial.detentG(name === "year" ? 5 : 3, 7); w.majors = 6; w.snap = true
      w.range = { mode: 1, n: 5, tape: 0 }
      w.bugs = [Object.assign(Dial.logG(1.0, 0.001, 100), { color: "#ffd27a" }), null, Object.assign(Dial.logG(0.00257, 0.001, 100), { color: "#cfd6e6" }), Object.assign(Dial.logG(0.52, 0.001, 100), { color: hi })]
      w.gap = { mode: 2, v: 0.38, flag: 1, pitch: 1 }
      if (name === "year") w.time = [1, 0.875, -1, -1]
      w.readout = name === "year" ? "16 NOV 2027" : "> 0.520 AU"; w.units = ["AU", "RATE"]
      w.landmarks = [{ g: 0, text: "LIVE" }, { g: 0.5, text: "DAY" }, { g: 1, text: "YEAR" }]
    } else if (name === "galaxy" || name === "outside") {
      const out = name === "outside"
      w.mode = 1; w.g = out ? 0 : Dial.logG(5275 * 31557600, 1e5, 1e13).g; w.majors = 8; w.minor = 1; w.long = 3 + 1 / 16
      w.range = { mode: 1, n: 7, tape: 0 }
      w.bugs = [Object.assign(Dial.logG(out ? 2.5e7 : 1344, 1, 1e7), { color: "#ffd27a" }), Object.assign(Dial.logG(out ? 2.5e7 : 26000, 1, 1e7), { color: "#ffb070" }),
                Object.assign(Dial.logG(out ? 1200 : 2.48e6, 1, 1e7), { color: "#fff0d8" }), Object.assign(Dial.logG(out ? 1500 : 420, 1, 1e7), { color: "#fff0d8" })]
      const hgt = Dial.signedLogG(out ? 9000 : 85, 1, KPC)
      w.gap = { mode: 1, v: hgt.g, flag: hgt.hollow ? 1 : 0, pitch: Dial.signedLogPitch(1, KPC) }
      w.readout = out ? "> 1,200 LY" : "166G × C"; w.units = ["LY", "× C"]
      w.landmarks = [{ g: 1 / 8, text: "1M" }, { g: 4 / 8, text: "1G" }, { g: 7 / 8, text: "1T" }]
    } else if (name === "sky") {
      w.mode = 3; w.g = 46 / 360
      w.range = { mode: 2, n: 0, tape: 28 }
      w.gap = { mode: 1, v: 18 / 90, flag: 0, pitch: 1 / 3 }
      w.readout = "RA 5H35 +22"; w.units = ["l °", "FIELD"]
    } else if (name === "fall" || name === "math") {
      const math = name === "math", rp = 0.6706, rm = 0.3294, end = math ? -12 : rm
      w.mode = 1; w.g = Dial.fallG(math ? -2.0 : 1.84, 6, end)
      w.red = [Dial.fallG(rp, 6, end), Dial.fallG(rm, 6, end)]
      w.hair = [Dial.fallG(1.5, 6, end), math ? Dial.fallG(0, 6, end) : -1]
      if (math) w.dash = Dial.fallG(rm, 6, end)
      w.time = [2, math ? 0.2 : 0.45, -1, -1]
      w.readout = math ? "-2.00 RS" : "1.84 RS"; w.units = ["", "RS"]
    }
    return w
  }
  // one frame of the instrument; dt seconds, nowMs the wall clock
  function dialStep(dt, nowMs) {
    const run = dialRun
    if (hudDemo !== "") { run.want = hudDemoWant(hudDemo); Tx.touchZone(textModel, "dial", 1) }
    if (!run.want) run.want = dialWant(explore)
    const w = run.want
    if (!run.shown) run.shown = w
    // a view change: the old scales fade out and the needle falls to its pin, then the new ones come
    const changing = w.key !== run.shown.key
    if (changing) {
      run.fade = Math.max(0, run.fade - dt / 0.2)
      if (run.fade === 0) { run.shown = w; run.bugs = [-1, -1, -1, -1]; run.gap = w.gap.v; run.arc = 0; run.side = [0, 0]; Tx.touchZone(textModel, "units", Tx.UNITS_S) }
    } else {
      run.shown = w
      run.fade = Math.min(1, run.fade + dt / 0.2)
    }
    const sh = run.shown
    const goal = changing ? 0 : sh.g
    run.needle = Dial.spring(run.needle[0], run.needle[1], goal, dt, sh.snap ? 40 : undefined)   // a detent snaps: 150 ms
    run.arc = Dial.ease(run.arc, goal, dt)
    run.gap = Dial.ease(run.gap, sh.gap.v, dt)
    // a redline crossed: its tick pulses once, 600 ms
    for (let i = 0; i < 2; i++) {
      const side = sh.red[i] < 0 || sh.mode !== 1 ? 0 : run.needle[0] >= sh.red[i] ? 1 : -1
      if (side !== 0 && run.side[i] !== 0 && side !== run.side[i]) run.pulse[i] = 1
      else run.pulse[i] = Math.max(0, run.pulse[i] - dt / 0.6)
      run.side[i] = side
    }
    const bugs = Dial.bugs(sh.bugs), codes = []
    for (let i = 0; i < 4; i++) {
      const b = bugs[i]
      if (!b) { run.bugs[i] = -1; codes.push(Qt.vector4d(0, 0, 0, -1)); continue }
      run.bugs[i] = run.bugs[i] < 0 ? b.g : Dial.ease(run.bugs[i], b.g, dt)
      const c = rgb3(b.color || "#ffffff")
      codes.push(Qt.vector4d(c[0], c[1], c[2], Dial.bugCode({ g: run.bugs[i], hollow: b.hollow, small: b.small })))
    }
    hudBug0 = codes[0]; hudBug1 = codes[1]; hudBug2 = codes[2]; hudBug3 = codes[3]
    hudDial = Qt.vector4d(sh.mode, sh.mode === 3 ? run.arc : Math.max(0, run.needle[0]), sh.majors, sh.minor)
    hudDialMark = Qt.vector4d(sh.red[0], sh.red[1], sh.dash, sh.long)
    hudDialAux = Qt.vector4d(sh.hair[0], sh.hair[1], run.pulse[0], run.pulse[1])
    // the sky's tape follows the camera every frame (the 5 Hz refresh alone would step it under a drag)
    hudRange = Qt.vector4d(sh.range.mode, sh.range.n, sh.key === "sky" ? ((skyL % 360) + 360) % 360 : sh.range.tape, run.fade)
    hudGap = Qt.vector4d(sh.gap.mode, sh.gap.mode === 1 ? run.gap : sh.gap.v, sh.gap.flag, sh.gap.pitch)
    dialFade = run.fade
    if (dialKey !== sh.key) dialKey = sh.key
    if (dialReadout !== sh.readout) dialReadout = sh.readout
    if (dialUnits[0] !== sh.units[0] || dialUnits[1] !== sh.units[1]) dialUnits = sh.units
    if (dialLandmarks.length !== sh.landmarks.length || dialLandmarks.some((l, i) => l.text !== sh.landmarks[i].text || l.g !== sh.landmarks[i].g)) dialLandmarks = sh.landmarks
    // the time ring: the day at home (the daylight arc, now), unless the view has its own
    const d = new Date(nowMs)
    const key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()
    if (sunToday.key !== key) {
      const st = Sun.sunTimes(d, homeLat, homeLon)
      sunToday = { key: key, rise: st.polar === "none" ? -1 : st.rise, set: st.polar === "all" ? 1.01 : st.set }
    }
    hudTimeRing = sh.time ? Qt.vector4d(sh.time[0], sh.time[1], sh.time[2], sh.time[3]) : Qt.vector4d(0, Sun.dayFraction(d), sunToday.rise, sunToday.set)
    // the frame rocks +-4 degrees on a 13-minute sine (its own clock: the shader's wraps at 600 s)
    hudSway = Lay.SWAY_MAX * Math.sin(2 * Math.PI * ((nowMs / 1000) % 780) / 780)
  }

  // The HUD's second colour: the accent hue turned like the shader's highlight.
  readonly property color hudHighlight: Qt.hsva((Math.max(0, Color.accent.hsvHue) + 0.38) % 1, 0.85, 1, 1)
  property date now: new Date()
  Timer {
    interval: 1000
    running: root.animate && root.liveBackground && root.hudLevel > 0
    repeat: true
    onTriggered: root.now = new Date()
  }

  // GPU-animated backgrounds: a file named "*-live.webp" is rendered by the
  // universe shader at native refresh rate instead of being shown as an image.
  readonly property bool liveBackground: displayedBackground.endsWith("-live.webp")

  function imageUrl(path) {
    return Util.fileUrl(path)
  }

  function refreshBackground() {
    if (!readlinkProc.running) readlinkProc.running = true
  }

  function setBackground(path, instant) {
    transitionBackground("", path, path, instant, false)
  }

  function transitionBackground(fromPath, path, finalPath, instant, force) {
    path = String(path || "").trim()
    finalPath = String(finalPath || path).trim()
    fromPath = String(fromPath || "").trim()
    if (!path || (!force && finalPath === currentBackground)) return
    currentBackground = finalPath
    backgroundVersion += 1
    revealStartedVersion = -1

    revealAnimation.stop()
    finishingTransition = false

    if (instant || !displayedBackground) {
      oldBackground = ""
      incomingBackground = ""
      displayedBackground = path
      revealProgress = 1
      return
    }

    oldBackground = fromPath || displayedBackground
    incomingBackground = path
    revealProgress = 0
  }

  function setPendingTheme(colorsB64, shellB64) {
    pendingColorsRaw = Util.decodeBase64(colorsB64)
    pendingShellRaw = Util.decodeBase64(shellB64)
    pendingThemeVersion = backgroundVersion
    pendingThemeFallbackTimer.restart()
  }

  function applyPendingTheme() {
    // Background polling can advance backgroundVersion while a theme switch is
    // pending; the latest theme payload should still apply.
    if (pendingThemeVersion < 0) return
    pendingThemeFallbackTimer.stop()
    Commons.Color.loadColors(pendingColorsRaw)
    // Commons.Color.loadShell also refreshes Style so the type scale flips with the
    // background reveal instead of waiting for a separate reload path.
    Commons.Color.loadShell(pendingShellRaw)
    Style.scheduleRefresh()
    pendingThemeVersion = -1
    pendingColorsRaw = ""
    pendingShellRaw = ""
  }

  function transitionBackgroundWithTheme(fromPath, path, finalPath, colorsB64, shellB64) {
    transitionBackground(fromPath, path, finalPath, false, true)
    setPendingTheme(colorsB64, shellB64)
    if (!incomingBackground || revealProgress >= 1) applyPendingTheme()
  }

  function startReveal(panel) {
    if (!incomingBackground) return
    panel.maskReady = true
    if (revealStartedVersion === backgroundVersion) return
    revealStartedVersion = backgroundVersion
    applyPendingTheme()
    revealAnimation.restart()
  }

  function openSelector() {
    if (!bgSwitchProc.running) bgSwitchProc.running = true
  }

  function openThemeSwitcher() {
    if (!themeSwitchProc.running) themeSwitchProc.running = true
  }

  Process {
    id: bgSwitchProc
    command: ["bash", "-c", "background=$(omarchy-theme-bg-switcher); [[ -n $background ]] && omarchy-theme-bg-set \"$background\""]
    onExited: root.refreshBackground()
  }

  Process {
    id: themeSwitchProc
    command: ["bash", "-c", "theme=$(omarchy-theme-switcher); [[ -n $theme ]] && omarchy-theme-set \"$theme\" >/dev/null 2>&1 &"]
    onExited: root.refreshBackground()
  }

  Process {
    id: readlinkProc
    command: ["readlink", "-f", root.currentBackgroundLink]
    stdout: StdioCollector {
      onStreamFinished: root.setBackground(String(text || "").trim(), false)
    }
  }

  IpcHandler {
    target: "background"

    // Omarchy 4.5 calls these on the stock background (owed's setSuspended,
    // omarchy-theme-set's prepare). This one renders its own scene and pauses
    // through sleep(), so they are accepted and ignored; without them the
    // callers could re-enable the stock background over this one.
    function setSuspended(reason: string): void {}
    function prepare(path: string): void {}

    function sleep(on: bool): void {
      root.sleeping = on
    }

    function refresh(): void {
      root.refreshBackground()
    }

    function set(path: string): void {
      root.setBackground(path, false)
    }

    function setInstant(path: string): void {
      root.setBackground(path, true)
    }

    function transition(fromPath: string, path: string): void {
      root.transitionBackground(fromPath, path, path, false, false)
    }

    function hud(level: real): void {
      root.hudBrightness = Math.max(0, Math.min(1, level))
    }

    // the cockpit key (Super+Alt+J): full, and the last level below it
    function toggleHud(): void {
      root.setText("toggle", "IPC toggleHud")
    }

    // the text level: off, names or full; next and prev cycle (T, Shift+T);
    // toggle is toggleHud. Remembered across restarts
    function text(level: string): void {
      root.setText(level, "IPC text")
    }

    // a level for now (a film, a tour), over the saved one and never saved;
    // "" lets go of it, and so does any T or H
    function textHold(level: string): void {
      root.textHold = Tx.parseLevel(level)
      root.touchText()
    }

    function navigate(): void {
      root.explore = root.explore === "flight" || !root.emptyWorkspace ? "universe" : "flight"
    }

    function chase(): void {
      root.toggleChase()
    }

    // chase view exactly on the A-B line (true) or angled (false)
    function align(on: bool): void {
      root.setChaseLocked(on)
    }

    function universe(): void {
      root.explore = "universe"
    }

    function system(): void {
      if (root.explore === "system") root.explore = "universe"
      else root.enterSystem()
    }

    // 0 = sun, 1-6 = planets, 7 = the Moon
    function focus(body: int): void {
      if (root.explore !== "system") root.enterSystem()
      root.focusBody(Math.max(0, Math.min(7, body)))
    }

    // chase camera aim (B): a body name ("sun", "earth", "moon", "mars" ...) or 0-7
    function look(target: string): void {
      const t = String(target).trim().toLowerCase()
      const i = /^[0-7]$/.test(t) ? Number(t) : [0, 1, 2, 3, 4, 5, 6, 7].find(j => root.bodyName(j).toLowerCase().startsWith(t))
      if (i === undefined) return
      if (root.chasing) root.chaseLook(i); else root.chaseTarget = i
    }

    function sky(): void {
      root.enterSky()
    }

    function skyView(view: int): void {
      root.enterSky(Math.max(0, view - 1))
    }

    function milkyway(): void {
      root.enterGalaxy()
    }

    // a place by name prefix (a hotspot or a dwarf galaxy), the Sun, or a
    // named viewpoint ("Milky Way from Andromeda"); an unknown or empty name
    // flies home
    function fly(place: string): void {
      if (root.explore !== "galaxy") root.enterGalaxy()
      const v = place.length > 0 ? root.gxViews.findIndex(w => w.name.toLowerCase().startsWith(place.toLowerCase())) : -1
      if (v >= 0) root.gxGoView(v)
      else root.gxFlyTo(place === "sun" ? -1 : root.placeIndex(place))
    }

    function hole(): void {
      if (root.explore !== "galaxy") root.enterGalaxy()
      root.gxB()
    }

    // falling into Sgr A*: look this far from the scripted view (degrees,
    // yaw right and pitch up), held until the next drag or arrow; for tests
    // and filming (a fall that starts after the call resets it)
    function fallLook(yawDeg: real, pitchDeg: real): void {
      root.fallLookSet(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180)
    }

    function galactic(): void {
      if (root.explore !== "system") root.enterSystem()
      if (!root.galactic) root.toggleGalactic()
    }

    // film mode: the scene with no text but the caption (the level off, for now)
    function film(on: bool): void {
      root.film = on
      if (!on) root.say("script", "", "")
    }

    // a script's caption in the story band: it stays until the next one;
    // caption "" "" ends it (it is never cut before its reading time)
    function caption(title: string, body: string): void {
      root.say("script", title, body, true)
      root.touchText()
    }

    // anatomy: what the body in front is made of, as lines and labels (C):
    // on, off or toggle. Remembered across restarts
    function anatomy(state: string): void {
      root.setAnatomy(state)
    }

    // go to a body of the table (a record's id: anatomyReport lists them)
    // and turn its anatomy on: a planet or the Sun is pinned in the system
    // view, a place of the Milky Way view is flown to, the Milky Way and the
    // Local Group go home (the Sun in its Galaxy, where the Milky Way's lines
    // are drawn). What is then drawn, and where, is the anatomy's one rule:
    // on the body when it is large, else in the lens
    function anatomyDemo(body: string): void {
      root.anatGo(body)
    }

    // as JSON: the setting, the subject, the record drawn and where (on the
    // body or in the lens: `lens`, with the lens's centre and width and the
    // subject's place on the first screen), every row of it (tag, size and
    // strokes in the first screen's pixels, its label and where it stands),
    // how many passes were worked out and the milliseconds they took in
    // all, and the table's ids
    function anatomyReport(): string {
      const o = root.anatOut, sub = root.anatSubject(), r2 = v => Math.round(v * 10) / 10, R = root.anatRun, sel = R.sel
      const D = root.anatLensD(root.lay0), h = Lay.hudAt(root.lay0, [root.hudDrift.x, root.hudDrift.y])
      const ox = o && o.lens ? h.cx - D / 2 : 0, oy = o && o.lens ? h.cy - D / 2 : 0
      return JSON.stringify({ on: root.anatomy, subject: sub ? sub.id : "", parked: root.anatParked(), mix: r2(root.anatMix), presence: r2(root.presAnat),
        math: root.mathMode, drawn: o ? o.id : "", lens: !!(sel && sel.lens), lensMix: r2(root.anatLens), span: sel ? Math.round(sel.span) : 0,
        glass: sel && sel.lens ? { cx: Math.round(h.cx), cy: Math.round(h.cy), d: Math.round(D), aim: root.anatAim ? root.anatAim.map(v => Math.round(v)) : null } : null,
        lit: root.anatLit, still: sel ? (sel.lens ? R.glass.still : R.stage.still) : true, measured: o && o.g ? o.g : null, passes: R.passes, passMs: R.ms,
        nameYield: r2(root.nameYield), hudYield: r2(root.lensYield),
        rows: o ? o.rows.map(r => ({ id: r.id, tag: r.tag, size: Math.round(r.size), strokes: r.segs.length + r.marks.length, text: r.text, num: r.num, folded: r.folded,
          label: r.lab.show ? { x: Math.round(r.lab.x + ox), y: Math.round(r.lab.y + oy), w: Math.round(r.lab.w), h: Math.round(r.lab.h), side: r.lab.side } : null,
          box: r.seen.length ? (() => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of r.seen) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) } return [Math.round(x0 + ox), Math.round(y0 + oy), Math.round(x1 + ox), Math.round(y1 + oy)] })() : null })) : [],
        records: Anat.records().map(b => b.id) })
    }

    // mathematics mode: the fall follows the extended Kerr solution through
    // the inner horizon and the ring into the other universe (not physics);
    // takes effect at the next fall
    function mathMode(on: bool): void {
      root.mathMode = on
      root.fallInvite = false
    }

    // for scripts: "<view> <fall phase or -> <radius in Rs, signed> <real|math>",
    // e.g. "galaxy outer-horizon 0.52 real"; the phases are falling,
    // outer-horizon, inner-horizon, ring, other-universe, out, in. The mode
    // is the running fall's, through its return (a K press mid-fall applies
    // to the next one); with no fall, the mode the next fall would use
    function status(): string {
      const math = root.fallPhase !== "" ? root.fallMath : root.mathMode
      return root.explore + " " + (root.fallPhase || "-") + " " + root.fallR.toFixed(2) + " " + (math ? "math" : "real")
    }

    // render quality: auto, full, high, balanced, low, or a render scale
    // (0.25-1); remembered across restarts
    function quality(level: string): void {
      root.setQuality(level)
    }

    // per screen: "<name> <Hz>: <level> (<gpu>): scale, render size, idle rate"
    function qualityInfo(): string {
      return root.qualityInfo()
    }

    // the hole tracer's layer as a fraction of the screen (0.25-1; 0: the
    // automatic choice), to compare on screen; not remembered
    function holeScale(scale: real): void {
      root.holeScale = scale > 0 ? scale : 0
    }

    // frame-time meter: logs each screen's frame rate, average and peak
    // frame time every 5 s (console.warn, so the shell's log)
    function perf(on: bool): void {
      root.perf = on
    }

    // the text level, what is showing, and every screen's zones (safe rect,
    // rail, caption slot, story band, the HUD's plan and reach) as JSON
    function textReport(): string {
      return root.textReport()
    }

    // a tour's keys in the rail: "KEY=what it does; KEY=..."; "" ends it
    function tourKeys(rows: string): void {
      root.setTourKeys(rows)
    }

    // the instrument with fixed, invented values, to look at every element
    // without flying there: universe, flight, system, year (a time-lapse),
    // galaxy, outside (bugs pinned hollow, the diamond off its scale), sky,
    // fall, math; "" or off returns to the live values. The hub says DEMO
    function hudDemo(view: string): void {
      const v = String(view).trim().toLowerCase()
      root.hudDemo = ["universe", "flight", "system", "year", "galaxy", "outside", "sky", "fall", "math"].indexOf(v) >= 0 ? v : ""
      root.touchText()
    }

    // draw the zones over the scene, to check them by eye
    function textDebug(on: bool): void {
      root.textDebug = on
    }

    function themeTransition(fromPath: string, path: string, finalPath: string, colorsB64: string, shellB64: string): void {
      root.transitionBackgroundWithTheme(fromPath, path, finalPath, colorsB64, shellB64)
    }
  }

  Timer {
    id: pendingThemeFallbackTimer
    interval: 300
    repeat: false
    onTriggered: root.applyPendingTheme()
  }

  NumberAnimation {
    id: revealAnimation
    target: root
    property: "revealProgress"
    from: 0
    to: 1
    duration: 420
    easing.type: Easing.InOutCubic
    onFinished: {
      if (root.incomingBackground) {
        root.displayedBackground = root.currentBackground || root.incomingBackground
        root.finishingTransition = true
      }
      root.revealProgress = 1
    }
  }

  Component.onCompleted: {
    sysCam.pitch.set(overviewPitch); sysCam.roll.set(-0.10); sysCam.fovT.set(fovOrtho)
    sysCam.o.set([sunScreen.x, sunScreen.y]); sysCam.follow(bodyTrack(0)); sysCam.update(0)
    refreshBackground()
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData

      screen: modelData
      visible: !remapGuard.remapping
      anchors { top: true; bottom: true; left: true; right: true }

      ScreenMoveRemap {
        id: remapGuard
        window: panel
      }
      color: "transparent"
      // Keep render updates enabled. The background layer has been observed to
      // lose its committed buffer while parked with updatesEnabled=false,
      // leaving a black desktop until omarchy-shell is restarted. The wallpaper
      // itself is static, so this favors correctness over a small render-loop
      // optimization.
      updatesEnabled: true

      property bool maskReady: false

      // this screen's render scale and idle rate (lib/quality.js)
      readonly property var q: root.qualityOf(modelData)
      readonly property var hq: root.holeOf(modelData)
      // and its zones and type sizes (lib/layout.js)
      readonly property var lay: root.layOf(modelData)
      readonly property var tok: lay.tok
      // its HUD, in pixels: the disc at its anchor, and the centre where it
      // is now. The drift moves every frame, so it comes in as two numbers
      // and nothing is built for it.
      readonly property var hud: Lay.hudAt(lay, null)
      readonly property real hudCx: Lay.hudCx(lay, root.hudDrift.x)
      readonly property real hudCy: Lay.hudCy(lay, root.hudDrift.y)
      // the first screen tells the label pass how tall its zones stand
      readonly property bool first: Quickshell.screens.length > 0 && Quickshell.screens[0].name === modelData.name
      Binding { target: root; property: "railNow"; value: rail.visible ? rail.height : 0; when: panel.first }
      // A story caption (the fall, the way home, a tour, IPC `caption`) wins its band: while it
      // shows, a zone its rect touches steps aside, the whole cockpit
      // together (never rings without their text), over the HUD's whole
      // drift so it does not flicker; a rail of a few rows stays clear of it,
      // and so does the caption slot unless the story runs to many lines.
      readonly property bool storyUp: filmCaption.opacity > 0.01
      readonly property var storyBox: Lay.storyRect(lay, filmCaption.height)
      readonly property var hudReach: Lay.hudExtent(lay)
      property real cockpitStep: storyUp && Lay.intersects(storyBox, hudReach) ? 0 : 1
      Behavior on cockpitStep { NumberAnimation { duration: Tx.FADE_OUT_S * 1000; easing.type: Easing.InOutSine } }
      property real railStep: storyUp && Lay.intersects(storyBox, Lay.railRect(lay, rail.height)) ? 0 : 1
      Behavior on railStep { NumberAnimation { duration: Tx.FADE_OUT_S * 1000; easing.type: Easing.InOutSine } }
      property real captionStep: storyUp && Lay.intersects(storyBox, Lay.captionRect(lay, lay.caption.maxH)) ? 0 : 1
      Behavior on captionStep { NumberAnimation { duration: Tx.FADE_OUT_S * 1000; easing.type: Easing.InOutSine } }
      // what a mode caption has of its slot: a story caption comes first
      readonly property real captionSlot: captionStep
      Binding { target: root; property: "storyNow"; value: filmCaption.opacity > 0.01 ? filmCaption.height : 0; when: panel.first }
      // where a marker may not sit: this screen's rail and caption as they stand
      readonly property var keepRects: [Lay.railRect(lay, rail.visible ? rail.height : 0), Lay.captionRect(lay, root.captionUp ? lay.caption.maxH : 0)]
      // A still screen (lib/quality.js: a remote desktop's virtual output)
      // draws the idle sky for a moment, keeps that one frame as a picture
      // and stops: no shader, no clock, no words, nothing to send. A new
      // wallpaper, theme or size takes a new frame.
      readonly property bool live: root.liveBackground && !q.still
      property var stillShot: null                  // the held frame (an ItemGrabResult)
      readonly property string stillKey: root.displayedBackground + "|" + Color.accent + "|" + Color.background + "|" + width + "x" + height
      onStillKeyChanged: stillShot = null
      Timer {
        interval: Q.STILL_WARM_MS
        running: panel.q.still && root.liveBackground && root.explore === "universe" && !panel.stillShot && !!sceneLoader.item
        onTriggered: sceneLoader.item.grabToImage(function(shot) { panel.stillShot = shot })
      }
      // this screen's picture and size, for the text's backing (Scrim)
      readonly property var under: ({ scene: sceneLoader.item ? sceneLuma : null, w: Math.max(1, width), h: Math.max(1, height) })
      readonly property var perfMeter: Q.perfCreate()
      Connections {
        target: base.Window.window
        enabled: root.perf && root.liveBackground
        function onFrameSwapped() { Q.perfFrame(panel.perfMeter, Date.now()) }
      }
      Timer {
        interval: 5000
        repeat: true
        running: root.perf && root.liveBackground
        onRunningChanged: { panel.perfMeter.last = -1; Q.perfTake(panel.perfMeter) }
        onTriggered: console.warn(Q.perfLine(panel.modelData.name, Q.perfTake(panel.perfMeter),
          root.explore === "universe" ? "idle" : root.explore + (root.fallPhase ? " " + root.fallPhase : ""), panel.q))
      }

      function maybeStartReveal() {
        if (!root.incomingBackground || root.revealProgress !== 0 || maskReady) return
        if (incomingFrame.status !== Image.Ready) return
        Qt.callLater(function() {
          if (!root.incomingBackground || root.revealProgress !== 0 || maskReady) return
          if (incomingFrame.status !== Image.Ready) return
          root.startReveal(panel)
        })
      }

      WlrLayershell.namespace: "omarchy-background"
      WlrLayershell.layer: WlrLayer.Background
      // OnDemand: the sky takes keys once clicked, and gives them back to the
      // bar, popups and windows when they are clicked (Exclusive froze them)
      WlrLayershell.keyboardFocus: root.explore !== "universe" ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.None
      exclusionMode: ExclusionMode.Ignore

      Image {
        id: base
        anchors.fill: parent
        source: root.imageUrl(root.displayedBackground)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
        visible: true
        onStatusChanged: {
          if (status === Image.Ready && root.finishingTransition) {
            root.incomingBackground = ""
            root.oldBackground = ""
            root.finishingTransition = false
          }
        }
      }

      // The live shader is created through a Loader so it is fully destroyed
      // when showing a static background and freshly recreated when the live
      // one returns. A long-lived ShaderEffect that has been hidden (either
      // via `visible` or `opacity`) stops receiving uniform updates for good
      // on this stack; a freshly created instance always animates. Turning
      // the full pass's layer on takes it out of the scene in the same way,
      // so a change of `layered` (the GPU probe answering, IPC `quality`)
      // recreates it too: an instance keeps the layer it was created with.
      // The picture at low resolution (96 texels across): what the text's
      // backing reads the brightness under it from. In the scene so that it
      // keeps up, one pixel in the corner under the opaque full pass. It is
      // the full pass alone (the scene's `picture`), not the scene item: the
      // HUD's words live in that item, and their backings read this texture,
      // so drawing them into it would be a texture read while it is written.
      ShaderEffectSource {
        id: sceneLuma
        width: 1; height: 1
        sourceItem: sceneLoader.item ? sceneLoader.item.picture : null
        live: true
        hideSource: false
        smooth: true
        textureSize: Qt.size(96, Math.max(8, Math.round(96 * panel.height / Math.max(1, panel.width))))
      }
      Loader {
        id: sceneLoader
        anchors.fill: parent
        readonly property bool wanted: root.liveBackground && !panel.stillShot
        active: wanted
        readonly property bool layered: panel.q.layered
        onLayeredChanged: if (active) { active = false; active = Qt.binding(() => sceneLoader.wanted) }
        sourceComponent: Component {
          Item {
            readonly property Item picture: fullPass   // what the screen shows under every word (sceneLuma)
            // Soft layer (nebula, galaxies) at half size into a float texture:
            // a quarter of the pixels for the costliest noise, no banding.
            // It stays visible (hidden effects stop updating, see above) and
            // the opaque full-size pass below covers it. Under a render scale
            // the soft layers follow it (softSize), instead of the monitor's.
            readonly property real softTexels: panel.q.layered ? panel.q.texels : 0
            function softSize(item) { return Qt.size(Math.ceil(item.width * softTexels), Math.ceil(item.height * softTexels)) }
            ShaderEffect {
              id: nebulaPass
              width: Math.ceil(panel.width / 2)
              height: Math.ceil(panel.height / 2)
              layer.enabled: true
              layer.textureSize: parent.softSize(nebulaPass)
              layer.format: ShaderEffectSource.RGBA16F
              layer.smooth: true
              fragmentShader: Qt.resolvedUrl("nebula.qsb")
              property real time: root.nebulaTime
              property vector2d pan: root.pan
              property vector2d resolution: Qt.vector2d(panel.width, panel.height)
              property color accent: Color.accent
              property color themeBase: Color.background
            }

            // The Milky Way volume, at a third of the screen (it is soft), only
            // while the galaxy view is open; otherwise a few pixels doing nothing.
            ShaderEffect {
              id: galaxyPass
              width: root.galaxyMix > 0 ? Math.ceil(panel.width / 3) : 4
              height: root.galaxyMix > 0 ? Math.ceil(panel.height / 3) : 4
              layer.enabled: true
              layer.textureSize: parent.softSize(galaxyPass)
              layer.format: ShaderEffectSource.RGBA16F
              layer.smooth: true
              fragmentShader: Qt.resolvedUrl("galaxy.qsb")
              property vector2d resolution: Qt.vector2d(width, height)
              property real shown: root.galaxyMix > 0 ? 1 : 0
              property vector3d camPos: root.gxCamPos
              property vector3d camFwd: root.gxFwd
              property vector3d camRight: root.gxRight
              property vector3d camUp: root.gxUp
              property real aspect: panel.width / Math.max(1, panel.height)
              property vector4d m31Pos: root.m31Pos
              property vector3d m31Major: Qt.vector3d(root.m31Disk.major[0], root.m31Disk.major[1], root.m31Disk.major[2])
              property vector3d m31Minor: Qt.vector3d(root.m31Disk.minor[0], root.m31Disk.minor[1], root.m31Disk.minor[2])
              property vector3d m31Normal: Qt.vector3d(root.m31Disk.normal[0], root.m31Disk.normal[1], root.m31Disk.normal[2])
              property real m31Fade: root.m31Fade
              property var m31Tex: m31FaceTex
              property vector4d m33Pos: root.m33Pos
              property vector3d m33Major: root.v3(root.m33Disk.major)
              property vector3d m33Minor: root.v3(root.m33Disk.minor)
              property vector3d m33Normal: root.v3(root.m33Disk.normal)
              property real m33Fade: root.m33Fade
              property var m33Tex: m33FaceTex
              property vector4d m32: root.ellUniform("M32")
              property vector4d m32Shape: root.ellShape("M32")
              property vector4d n205: root.ellUniform("NGC 205")
              property vector4d n205Shape: root.ellShape("NGC 205")
              property vector4d lmc: root.lmcPos
              property vector4d smc: root.smcPos
              property vector3d lmcMajor: root.v3(root.lmcModel.major)
              property vector3d lmcMinor: root.v3(root.lmcModel.minor)
              property vector3d lmcNormal: root.v3(root.lmcModel.normal)
              property vector4d lmcBar: root.v4(root.lmcModel.bar)
              property vector4d lmcOff: root.v4(root.lmcModel.off)
              property real exposure: root.gxExposure
              property real spin: root.sunOmega * root.gxMyr
              // a Magellanic Cloud's volume gives way to its photo near Earth's line of sight, like Andromeda's
              property vector2d cloudFade: Qt.vector2d(root.lmcFade, root.smcFade)
              property var dwarfTex: dwarfDataTex
              property real dwarfCount: root.dwarfPlaces.length
              property var youngTex: mwYoungTex
              property var dustTex: mwDustTex
            }
            // Sgr A* up close: geodesic ray tracing, only near the hole, into
            // a layer whose size, format and rate lib/quality.js chooses for
            // this screen's GPU (holeChoose: a half of the screen on NVIDIA,
            // a third elsewhere)
            ShaderEffect {
              id: holePass
              readonly property bool near: root.galaxyMix > 0 && root.gxHoleNear
              width: near ? panel.hq.texW : 4
              height: near ? panel.hq.texH : 4
              layer.enabled: true
              // one texel per unit of this item whatever the monitor's scale:
              // universe.frag's four-texel gather (holeRes) counts on it
              layer.textureSize: Qt.size(width, height)
              layer.format: panel.hq.float32 ? ShaderEffectSource.RGBA32F : ShaderEffectSource.RGBA16F
              layer.smooth: true
              fragmentShader: Qt.resolvedUrl("hole.qsb")
              property vector2d resolution: Qt.vector2d(width, height)
              property real shown: near ? 1 : 0
              // camera and gas clock are copied in at the tracer's own rate
              // (take(), called by the tick through root.holeSync): the layer
              // only re-renders when they change. A draw is milliseconds of
              // GPU time, so it is not every frame; universe.frag reads the
              // layer by direction (holeFwd/holeRight/holeUp below are this
              // camera), so a view that has turned since is still exact
              property vector3d camPos: Qt.vector3d(0, 1e6, 0)
              property vector3d camFwd: Qt.vector3d(0, -1, 0)
              property vector3d camRight: Qt.vector3d(1, 0, 0)
              property vector3d camUp: Qt.vector3d(0, 0, 1)
              property real aspect: panel.width / Math.max(1, panel.height)
              property vector3d spinAxis: root.holeSpinAxis
              property real spin: root.holeSpin
              property real camSheet: 1   // clocked with camPos: the two must flip together at the disk
              // gas motion 30x faster than real (1 Rs/c = 42 s): an orbit at
              // the innermost stable radius takes ~1 minute instead of ~30
              property real flowTime: 0
              // bound, not clocked: universe.frag reads the fall's frame the
              // very frame it starts, so this layer must switch in that frame too
              property real fallE: root.gxFallE
              property real flash: root.fallFlash
              // the layer covers a little more than the screen: what a turn
              // brings in at the edge before the next trace
              property real over: panel.hq.over
              property real takenAt: -1
              onNearChanged: takenAt = -1
              // lively: the camera is moving (the fall, a flight, a drag)
              function take(lively) {
                const t = Date.now()
                if (!near || !Q.holeDue(takenAt < 0 || t < takenAt ? -1 : t - takenAt, lively ? panel.hq.moveHz : panel.hq.idleHz, root.refreshOf(panel.modelData.name))) return
                takenAt = t
                camPos = root.gxCamRs
                camSheet = root.gxCamSheet
                camFwd = root.gxFwd
                camRight = root.gxRight
                camUp = root.gxUp
                flowTime = root.shaderTime * 30 / Fall.RS_C   // 30 times life, in Rs/c (lib/fall.js: 40.88 s at 4.15 million Suns, the mass the labels are worked out with)
              }
            }
            Connections {
              target: root
              function onHoleSync(lively) { holePass.take(lively) }
            }

            // face-on maps built from the measured arms (gen_milkyway.py)
            Image { id: mwYoungTex; source: "textures/milkyway-young.png"; visible: false; mipmap: true; smooth: true }
            Image { id: mwDustTex; source: "textures/milkyway-dust.png"; visible: false; mipmap: true; smooth: true }
            Image { id: m31FaceTex; source: "textures/m31-faceon.jpg"; visible: false; mipmap: true; smooth: true }
            Image { id: m33FaceTex; source: "textures/m33-faceon.jpg"; visible: false; mipmap: true; smooth: true }
            // the dwarf galaxy table as bytes (tools/gen_dwarfs.py): read exactly, so no filtering
            Image { id: dwarfDataTex; source: "textures/dwarfs.png"; visible: false; mipmap: false; smooth: false }

            // the real sky (NASA SVS Deep Star Maps 2020, tools/make_sky.py)
            Image { id: skyFullTex; source: "textures/sky-full.jpg"; visible: false; smooth: true; mipmap: true }
            // the named view's native 5K render (made by tools/make_sky_views.py)
            Image { id: skyStaticTex; source: root.skyMix > 0 ? root.skyDir + root.skyViews[root.skyView].file : ""; visible: false; smooth: true; asynchronous: true }
            // real photos of the places (tools/make_atlas.py; credits in textures/CREDITS.md)
            Image { id: photoAtlasTex; source: "textures/photos.jpg"; visible: false; smooth: true; mipmap: true }
            // the chosen place's own 2048 px photo, for close-ups (the atlas tile is 1024)
            Image {
              id: photoHiTex
              readonly property var ph: root.galaxyMix > 0 ? root.photoOf(root.gxSel) : null
              source: ph ? "textures/" + ph[2] : ""
              visible: false; smooth: true; mipmap: true; asynchronous: true
            }

            // NASA maps (public domain): Blue Marble, Black Marble, LRO Moon
            Image { id: earthDayTex; source: "textures/earth-day.jpg"; visible: false; mipmap: true; smooth: true }
            Image { id: earthNightTex; source: "textures/earth-night.jpg"; visible: false; mipmap: true; smooth: true }
            Image { id: moonMapTex; source: "textures/moon.jpg"; visible: false; mipmap: true; smooth: true }

            // The full pass. At render scale 1 it draws straight to the
            // screen; below, into a texture of that size, stretched smoothly
            // (lib/quality.js). `resolution` stays the logical size while the
            // texture has a texel per logical pixel and shrinks with it below
            // that: the stars and HUD lines are sized in `resolution` pixels,
            // so none gets thinner than a texel and flickers.
            ShaderEffect {
              id: fullPass
              anchors.fill: parent
              blending: false
              layer.enabled: panel.q.layered
              layer.textureSize: Qt.size(Math.ceil(panel.width * panel.q.texels - 1e-6), Math.ceil(panel.height * panel.q.texels - 1e-6))
              layer.smooth: true
              fragmentShader: Qt.resolvedUrl("universe.qsb")
              property var nebulaTex: nebulaPass
              property real time: root.shaderTime
              property vector2d resolution: Qt.vector2d(panel.width * panel.q.res, panel.height * panel.q.res)
              property color accent: Color.accent
              property real hudLevel: panel.q.still ? 0 : root.hudLevel * panel.cockpitStep   // a held frame shows no clock
              property vector2d view: root.view
              property vector2d hudCenter: Qt.vector2d((panel.hudCx - panel.lay.W / 2) / panel.lay.H, panel.hudCy / panel.lay.H - 0.5)
              property real hudScale: panel.lay.hud.s
              property real flight: root.flight
              property real cpu: root.idleFps < Q.IDLE_FULL ? root.gauges.x : root.cpu
              property real gpu: root.idleFps < Q.IDLE_FULL ? root.gauges.y : root.gpu
              property real mem: root.idleFps < Q.IDLE_FULL ? root.gauges.z : root.mem
              property real secs: (root.now.getSeconds() + root.now.getMilliseconds() / 1000) / 60
              property real hudSway: root.hudSway
              property vector4d timeRing: root.hudTimeRing
              property vector2d hudTemp: root.hudTemp
              property vector4d dial: root.hudDial
              property vector4d dialMark: root.hudDialMark
              property vector4d dialAux: root.hudDialAux
              property vector4d range: root.hudRange
              property vector4d bug0: root.hudBug0
              property vector4d bug1: root.hudBug1
              property vector4d bug2: root.hudBug2
              property vector4d bug3: root.hudBug3
              property vector4d gapWin: root.hudGap
              property vector2d pan: root.pan
              property real exposure: root.exposure
              property real boot: root.bootLevel
              property vector4d orbit0: root.orbitUniform(0)
              property vector4d orbit1: root.orbitUniform(1)
              property vector4d orbit2: root.orbitUniform(2)
              property vector4d orbit3: root.orbitUniform(3)
              property vector4d orbit4: root.orbitUniform(4)
              property vector4d orbit5: root.orbitUniform(5)
              property vector4d spinA: Qt.vector4d(root.spins[0], root.spins[1], root.spins[2], root.spins[3])
              property vector2d spinB: Qt.vector2d(root.spins[4], root.spins[5])
              property real sysHover: root.sysHover
              property vector3d camPos: root.camPos
              property vector3d camFwd: root.camFwd
              property vector3d camRight: root.camRight
              property vector3d camUp: root.camUp
              property real focal: root.focal
              property vector2d principal: root.principal
              property vector4d body0: root.sceneBodies[0]
              property vector4d body1: root.sceneBodies[1]
              property vector4d body2: root.sceneBodies[2]
              property vector4d body3: root.sceneBodies[3]
              property vector4d body4: root.sceneBodies[4]
              property vector4d body5: root.sceneBodies[5]
              property real pinned: root.explore === "system" && !root.chasing && root.follow > 0 ? root.follow : 0
              property real earthTheta: root.earthTheta
              property vector3d earthPole: Qt.vector3d(0, Math.cos(root.obliquity), -Math.sin(root.obliquity))
              property vector3d home: root.homeDir
              property real moonOrbit: root.moonOrbit
              property real galactic: root.galMix
              property vector4d sysBound: root.sysBound
              property real guides: root.guideMix
              property real galaxyMix: root.galaxyMix
              property var galaxyTex: galaxyPass
              property var holeTex: holePass
              property vector3d gxCam: root.gxCamPos
              property vector3d gxFwd: root.gxFwd
              property vector3d gxRight: root.gxRight
              property vector3d gxUp: root.gxUp
              property vector4d gxFocus: root.gxFocus
              property vector4d gxFocusCol: root.gxFocusCol
              property real gxStars: root.gxStars
              property real gxRealSky: root.gxRealSky
              property real gxFallE: root.gxFallE
              property real gxFallFade: root.fallFade
              property real gxFallClose: root.fallClose
              property vector3d gxSpinAxis: root.holeSpinAxis
              property real gxSpin: root.holeSpin
              property real gxCamSheet: root.gxCamSheet
              property vector2d holeRes: Qt.vector2d(holePass.width, holePass.height)
              property vector3d holeFwd: holePass.camFwd
              property vector3d holeRight: holePass.camRight
              property vector3d holeUp: holePass.camUp
              property real holeOver: holePass.over
              property real gxHoleExp: root.gxHoleExp
              property var skyFull: skyFullTex
              property vector4d gxPhoto: root.gxPhoto
              property var photoAtlas: photoAtlasTex
              property var photoHi: photoHiTex
              property real photoHiReady: photoHiTex.status === Image.Ready ? 1 : 0
              property real skyMix: root.skyMix
              property vector3d skyFwd: root.skyFwd
              property vector3d skyRight: root.skyRight
              property vector3d skyUp: root.skyUp
              property real skyFocal: 0.5 / Math.tan(root.skyVfov * Math.PI / 360)
              property real skyStaticMix: root.skyStaticMix
              property var skyStatic: skyStaticTex
              property vector4d galFlow: root.galFlow
              property vector4d moonBody: root.sceneMoon
              property vector4d sunBody: root.sceneSun
              property real planeY: root.scenePlaneY
              property vector3d moonFace: root.moonFace
              property var earthDay: earthDayTex
              property var earthNight: earthNightTex
              property var moonTex: moonMapTex
            }

            // The HUD's words in the shell font, moving with its centre and
            // sized with its scale; every one of them is inside the disc,
            // level, and the frame's sway moves them by position only
            // (lib/layout.js hubLines, gapSlots, dialPoint). At rest only the
            // clock and the date stand; the readout line, the machine labels
            // and unit words in the gap, the landmark labels and the beacons'
            // names are the dial zone: up with an interaction, the pointer
            // resting in the disc or an event, then gone (lib/text.js).
            Item {
              id: readout
              visible: !panel.q.still
              readonly property real hudOpacity: Math.min(0.75, root.hudLevel * 1.8) * panel.cockpitStep
              readonly property real unit: panel.height
              readonly property real s: panel.lay.hud.s
              readonly property real cx: panel.hudCx
              readonly property real cy: panel.hudCy
              // the text joins the rings' draw-in over its last 40%
              readonly property real bootIn: Math.max(0, Math.min(1, (root.bootLevel - 0.6) / 0.4))
              readonly property real words: hudOpacity * bootIn
              // the sway in steps of a ninth of a degree: the words' places are
              // worked out again every second or so, not every frame
              readonly property real sway: Math.round(root.hudSway / 0.002) * 0.002
              readonly property var disc: ({ cx: 0, cy: 0, R: panel.hud.R, s: panel.lay.hud.s })   // about its own centre
              readonly property var hub: Lay.hubLines(disc, panel.tok)
              readonly property var gap: Lay.gapSlots(disc, panel.tok, sway)
              readonly property bool demo: root.hudDemo !== ""
              // a fall: the hub counts the time left on our own clock; the wall clock is in the bar
              readonly property bool falling: !!root.fallState && !demo

              // the hub: the clock, the date, and one readout line (the needle's exact figure)
              Words {
                host: panel.under
                visible: root.hudLevel > 0
                opacity: readout.words
                x: readout.cx - width / 2
                y: readout.cy + readout.hub.clock.y + (readout.hub.clock.h - height) / 2
                text: readout.falling ? Dial.clock(root.fallLeft) : Qt.formatTime(root.now, "HH:mm")
                color: Color.foreground
                font.family: Style.resolvedFontFamily
                font.pixelSize: panel.tok.display
                font.weight: Font.Light
              }
              Words {
                host: panel.under
                visible: root.hudLevel > 0
                opacity: readout.words
                x: readout.cx - width / 2
                y: readout.cy + readout.hub.date.y + (readout.hub.date.h - height) / 2
                text: readout.demo ? "DEMO  " + root.hudDemo.toUpperCase()
                    : readout.falling ? (root.fallRate > 1.05 ? (readout.s >= 0.8 ? "OUR CLOCK  ×" : "CLOCK ×") + Math.round(root.fallRate) : root.fallRate < 0.95 ? "SLOWED TO WATCH" : "REAL TIME")
                    : Qt.formatDate(root.now, "ddd d MMM").toUpperCase()
                color: Color.accent
                font.family: Style.resolvedFontFamily
                font.pixelSize: panel.tok.label
                font.letterSpacing: panel.tok.label * panel.tok.track.normal
              }
              Words {
                host: panel.under
                visible: opacity > 0.01 && implicitWidth <= readout.hub.readout.maxW
                opacity: readout.words * root.presDial * root.dialFade
                x: readout.cx - width / 2
                y: readout.cy + readout.hub.readout.y + (readout.hub.readout.h - height) / 2
                text: root.dialReadout
                color: root.hudHighlight
                font.family: Style.resolvedFontFamily
                font.pixelSize: panel.tok.micro
                font.letterSpacing: panel.tok.micro * panel.tok.track.normal
              }

              // the machine labels, left in the gap, each in its arc's colour.
              // A small disc drops the watts and shows memory as a share; with
              // no nvidia-smi there is no GPU figure, so no GPU label
              Repeater {
                model: 3
                Words {
                  host: panel.under
                  required property int index
                  readonly property var box: readout.gap.machine[index]
                  visible: opacity > 0.01 && (index !== 1 || root.stats.gpuKnown) && implicitWidth <= box.w
                  opacity: readout.words * root.presSys
                  x: readout.cx + box.x + box.w - width
                  y: readout.cy + box.y + (box.h - height) / 2
                  text: index === 0 ? "CPU " + Math.round(root.stats.cpu * 100) + "%"
                      : index === 1 ? "GPU " + Math.round(root.stats.gpu * 100) + "%" + (readout.s >= 0.8 ? " " + Math.round(root.stats.gpuWatts) + " W" : "")
                      : readout.s >= 0.8 ? "MEM " + root.stats.memUsed.toFixed(1) + " GB" : "MEM " + Math.round(root.mem * 100) + "%"
                  color: index === 1 ? root.hudHighlight : Color.accent
                  font.family: Style.resolvedFontFamily
                  font.pixelSize: panel.tok.micro
                  font.letterSpacing: panel.tok.micro * panel.tok.track.normal
                }
              }
              // the unit words, right in the gap: the range scale's over the dial's
              Repeater {
                model: 2
                Words {
                  host: panel.under
                  required property int index
                  readonly property var box: readout.gap.units[index]
                  visible: opacity > 0.01 && text !== "" && implicitWidth <= box.w
                  opacity: readout.words * root.presUnits * root.dialFade
                  x: readout.cx + box.x
                  y: readout.cy + box.y + (box.h - height) / 2
                  text: root.dialUnits[index] || ""
                  color: Qt.alpha(Color.foreground, 0.8)
                  font.family: Style.resolvedFontFamily
                  font.pixelSize: panel.tok.micro
                  font.letterSpacing: panel.tok.micro * panel.tok.track.normal
                }
              }
              // landmark labels: what a long tick of the dial stands for, just
              // outside the rim on the tick's ray. Only on a disc with room for
              // them (scale 0.8 up); a beacon pointing the same way wins the spot
              Repeater {
                model: readout.s >= 0.8 ? root.dialLandmarks : []
                Words {
                  host: panel.under
                  required property var modelData
                  readonly property real ang: Lay.sweepAngle(modelData.g, readout.sway)
                  readonly property var at: Lay.beaconLabel(ang, width, height, readout.cx, readout.cy, panel.hud.R + panel.tok.gap / 2, panel.lay.safe, [], 0)
                  readonly property bool taken: root.navBeacons.some(b => !!b && Math.abs(Math.atan2(Math.sin(b.ang - ang), Math.cos(b.ang - ang))) < 0.2)
                  visible: opacity > 0.01 && at.show && !taken
                  opacity: readout.words * root.presDial * root.dialFade
                  x: at.x
                  y: at.y
                  text: modelData.text
                  color: Qt.alpha(Color.foreground, 0.7)
                  font.family: Style.resolvedFontFamily
                  font.pixelSize: panel.tok.micro
                  font.letterSpacing: panel.tok.micro * panel.tok.track.normal
                }
              }

              // beacons on the rim: where the Sun, Earth, the target, the
              // Galactic Centre and the nearest place lie from here (hollow
              // when behind you). The bug of the same colour on the range
              // scale says how far
              Repeater {
                model: 5
                Item {
                  id: beacon
                  required property int index
                  readonly property var b: root.navBeacons[index]
                  readonly property real ringR: readout.unit * Lay.BEACON * readout.s
                  visible: !!b && root.hudLevel > 0 && root.explore !== "universe"
                  opacity: readout.hudOpacity * root.presLabel * (b && b.behind ? 0.55 : 1)
                  x: readout.cx + Math.cos(b ? b.ang : 0) * ringR
                  y: readout.cy + Math.sin(b ? b.ang : 0) * ringR
                  Text {
                    x: -width / 2; y: -height / 2
                    text: beacon.b && beacon.b.behind ? "△" : "▲"
                    rotation: (beacon.b ? beacon.b.ang : 0) * 180 / Math.PI + 90
                    color: beacon.b ? beacon.b.color : "white"
                    font.pixelSize: panel.tok.label
                  }
                  Words {
                    host: panel.under
                    // the name and distance stand radially outside the disc, every
                    // point of them (lib/layout.js beaconLabel). Where they would
                    // leave the safe rect the words hide and the triangle stays
                    readonly property var at: Lay.beaconLabel(beacon.b ? beacon.b.ang : 0, width, height, readout.cx, readout.cy,
                                                              beacon.ringR + panel.tok.gap, panel.lay.safe, [], beacon.b ? beacon.b.shift : 0)
                    visible: at.show
                    x: at.x - beacon.x
                    y: at.y - beacon.y
                    text: beacon.b ? beacon.b.name + (beacon.b.dist ? "  " + beacon.b.dist : "") : ""
                    color: beacon.b ? beacon.b.color : "white"
                    font.family: Style.resolvedFontFamily
                    font.pixelSize: panel.tok.micro
                    font.letterSpacing: panel.tok.micro * panel.tok.track.normal
                  }
                }
              }
            }
          }
        }
      }

      // a still screen's held frame
      Image {
        anchors.fill: parent
        visible: root.liveBackground && !!panel.stillShot
        source: panel.stillShot ? panel.stillShot.url : ""
      }

      Image {
        id: oldFrame
        anchors.fill: parent
        source: root.imageUrl(root.oldBackground)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: false
        smooth: true

        visible: root.oldBackground !== "" && root.revealProgress < 1
        onStatusChanged: panel.maybeStartReveal()
      }

      Item {
        id: incomingLayer
        anchors.fill: parent
        visible: root.incomingBackground !== "" && incomingFrame.status === Image.Ready && (root.revealProgress >= 1 || panel.maskReady)
        layer.enabled: root.incomingBackground !== "" && root.revealProgress < 1
        layer.smooth: true
        layer.effect: MultiEffect {
          maskEnabled: true
          maskSource: revealMask
          maskThresholdMin: 0.5
          maskSpreadAtMin: 0.02
        }

        Image {
          id: incomingFrame
          anchors.fill: parent
          source: root.imageUrl(root.incomingBackground)
          fillMode: Image.PreserveAspectCrop
          asynchronous: true
          cache: false
          smooth: true
          onStatusChanged: panel.maybeStartReveal()
        }
      }

      Item {
        id: revealMask
        anchors.fill: parent
        visible: false
        layer.enabled: true

        readonly property real slant: -0.18
        readonly property real centerTop: width / 2 - slant * height / 2
        readonly property real centerBottom: width / 2 + slant * height / 2
        readonly property real reach: width / 2 + Math.abs(slant) * height / 2 + 4
        readonly property real spread: reach * root.revealProgress

        Shape {
          anchors.fill: parent
          antialiasing: true
          preferredRendererType: Shape.CurveRenderer
          ShapePath {
            fillColor: "white"
            strokeColor: "transparent"
            startX: revealMask.centerTop - revealMask.spread; startY: 0
            PathLine { x: revealMask.centerTop + revealMask.spread; y: 0 }
            PathLine { x: revealMask.centerBottom + revealMask.spread; y: revealMask.height }
            PathLine { x: revealMask.centerBottom - revealMask.spread; y: revealMask.height }
            PathLine { x: revealMask.centerTop - revealMask.spread; y: 0 }
          }
        }
      }

      Connections {
        target: root
        function onIncomingBackgroundChanged() {
          panel.maskReady = false
          panel.maybeStartReveal()
        }
      }

      // hint beside the sun while the pointer is over the solar system
      Words {
        host: panel.under
        visible: panel.live && root.sysHover > 0.01
        opacity: root.sysHover * 0.8 * root.gateNames
        x: (root.sunScreen.x / root.aspect + 0.5) * panel.width - width / 2
        y: (root.sunScreen.y + 0.5) * panel.height + panel.height * 0.05
        text: "SOLAR SYSTEM  ·  CLICK TO EXPLORE"
        color: Color.accent
        font.family: Style.resolvedFontFamily
        font.pixelSize: panel.tok.label
        font.letterSpacing: panel.tok.label * panel.tok.track.wide
      }

      // Highlights for the Moon, Earth and the Sun: a dot on the safe rect's
      // edge pointing at the body when it is outside it, and its name and
      // distance (beside the body itself when it is in view but tiny). The dot
      // keeps out of the rail and the caption; the words come from the label
      // pass. The Moon is marked in the system and chase views; Earth and the
      // Sun in the chase view (and Earth when off screen in the system view).
      Repeater {
       model: ["moon", "earth", "sun"]
       Item {
        id: marker
        required property string modelData
        readonly property string kind: modelData
        readonly property color tint: kind === "moon" ? Color.accent : kind === "earth" ? "#6ab7ff" : "#ffd27a"
        readonly property var proj: root.markerProj(kind, panel.width, panel.height)
        readonly property var at: Lay.clampMarker(proj.x, proj.y, panel.lay.safe, panel.keepRects, panel.tok.gap)
        readonly property bool offscreen: at.off
        readonly property real cx: at.x
        readonly property real cy: at.y
        readonly property bool wanted: root.markerWanted(kind, panel.lay)
        readonly property var lab: root.markerLabels[kind] || ({ show: false, side: 1 })
        visible: wanted && opacity > 0
        opacity: Math.min(1, (root.sys - 0.5) * 2) * 0.85 * root.textMix("names", "label")

        Rectangle { // off screen only: a small dot at the edge (no box around bodies in view)
          visible: marker.offscreen
          x: marker.cx - width / 2
          y: marker.cy - height / 2
          width: Math.round(panel.tok.gap * 0.7)
          height: width
          radius: width / 2
          color: marker.tint
        }
        Text { // arrow toward the body when it is off screen
          visible: marker.offscreen
          x: marker.cx - width / 2
          y: marker.cy - height / 2
          rotation: Math.atan2(marker.proj.y - marker.cy, marker.proj.x - marker.cx) * 180 / Math.PI
          transform: Translate { x: panel.tok.gap }
          text: "➤"
          color: marker.tint
          font.pixelSize: panel.tok.body
        }
        Words {
          host: panel.under
          visible: marker.lab.show
          x: marker.lab.side < 0 ? marker.cx - panel.tok.gap - 6 - width : marker.cx + panel.tok.gap + 6
          y: marker.cy - height / 2
          text: root.markerLabel(marker.kind)
          color: Qt.alpha(Color.foreground, 0.6)
          font.family: Style.resolvedFontFamily
          font.pixelSize: panel.tok.label
          font.letterSpacing: panel.tok.label * panel.tok.track.normal
        }
       }
      }

      // ---- galactic view: real paths through space, drawn from the tick's points ----
      Item {
        id: galOverlay
        width: panel.width
        height: panel.height
        visible: panel.live && root.galMix > 0.01
        opacity: root.galMix
        readonly property int segments: 6
        function sx(pt) { return (pt.x / root.aspect + 0.5) * width }
        function sy(pt) { return (pt.y + 0.5) * height }

        // soft bloom under the trails: the same lines, blurred
        MultiEffect {
          anchors.fill: galLines
          source: galLines
          autoPaddingEnabled: false
          blurEnabled: true
          blur: 1.0
          blurMax: 48
          brightness: 0.15
          opacity: 0.9
        }

        // trails, brightest where the body is now and fading into the past
        Item {
          id: galLines
          anchors.fill: parent
          Repeater {
            model: root.galTrails.length
            Item {
              id: trail
              required property int index
              anchors.fill: parent
              readonly property var pts: root.galTrails[index] || []
              readonly property color tint: root.galColors[index]
              Repeater {
                model: galOverlay.segments
                Shape {
                  required property int index
                  readonly property real age: index / galOverlay.segments
                  anchors.fill: parent
                  preferredRendererType: Shape.CurveRenderer
                  ShapePath {
                    // only with guide lines on (I): space has no trails; without them the
                    // streaming dust and the heading mark show the motion
                    strokeColor: Qt.alpha(trail.tint, (trail.index === 0 ? 0.45 : 0.95) * root.guideMix * Math.pow(1 - age, 1.6))
                    strokeWidth: (trail.index === 0 ? 1.4 : 2.2) * (1 - 0.6 * age)
                    capStyle: ShapePath.RoundCap
                    joinStyle: ShapePath.RoundJoin
                    fillColor: "transparent"
                    PathPolyline {
                      path: {
                        const n = trail.pts.length - 1
                        if (n < 1) return []
                        const a = Math.floor(n * index / galOverlay.segments)
                        const b = Math.min(n, Math.floor(n * (index + 1) / galOverlay.segments) + 1)
                        // points behind the camera are left out (the back view sits among the planets)
                        return trail.pts.slice(a, b + 1).filter(pt => pt.z > 0.004).map(pt => Qt.point(galOverlay.sx(pt), galOverlay.sy(pt)))
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // the Sun: a hot core in a wide warm glow, and where it is heading
        Item {
          readonly property var b: root.galNow[0] || ({ x: 0, y: 0, z: 1, r: 0 })
          visible: b.z > 0.004
          x: galOverlay.sx(b)
          y: galOverlay.sy(b)
          // the Sun's true disc, with a glow scaled to it
          readonly property real disc: Math.max(2.5, b.r * panel.height)
          Rectangle {
            x: -parent.disc; y: -parent.disc; width: 2 * parent.disc; height: width; radius: parent.disc
            color: "#fff6e6"
          }
          Shape {
            id: sunGlow
            readonly property real g: Math.max(panel.height * 0.012, parent.disc * 7)
            x: -g; y: -g; width: 2 * g; height: 2 * g
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
              strokeColor: "transparent"
              fillGradient: RadialGradient {
                centerX: sunGlow.width / 2; centerY: sunGlow.height / 2; centerRadius: sunGlow.width / 2
                focalX: centerX; focalY: centerY
                GradientStop { position: 0.0; color: "#fffaf0" }
                GradientStop { position: 0.06; color: "#ffe6a8" }
                GradientStop { position: 0.16; color: Qt.alpha("#ffc35a", 0.45) }
                GradientStop { position: 0.45; color: Qt.alpha("#ff9a3a", 0.08) }
                GradientStop { position: 1.0; color: "transparent" }
              }
              PathAngleArc { centerX: sunGlow.width / 2; centerY: sunGlow.height / 2; radiusX: sunGlow.width / 2; radiusY: sunGlow.height / 2; startAngle: 0; sweepAngle: 360 }
            }
          }
          // heading: a quiet chevron ahead of the Sun
          Text {
            readonly property real reach: panel.height * 0.06
            x: root.galHeading.x * reach - width / 2
            y: root.galHeading.y * reach - height / 2
            rotation: Math.atan2(root.galHeading.y, root.galHeading.x) * 180 / Math.PI
            text: "›"
            opacity: root.textMix("names", "label")
            color: Qt.alpha("#ffd27a", 0.8)
            font.pixelSize: panel.tok.glyph
          }
          Words {
            host: panel.under
            readonly property real reach: panel.height * 0.06
            readonly property var lab: root.galLabels[0] || ({ show: false, side: 1 })
            readonly property real off: panel.tok.gap + panel.tok.glyph * 0.3
            visible: lab.show
            x: root.galHeading.x * reach + (lab.side < 0 ? -width - off : off)
            y: root.galHeading.y * reach - height / 2
            text: root.galHeadingText
            opacity: root.textMix("names", "label")
            color: Qt.alpha("#ffd27a", 0.7)
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.micro
            font.letterSpacing: panel.tok.micro * panel.tok.track.normal
          }
        }

        // planets: lit from the Sun's side, with a faint halo and a name
        Repeater {
          model: Math.max(0, root.galNow.length - 1)
          Item {
            id: body
            required property int index
            readonly property var b: root.galNow[index + 1] || ({ x: 0, y: 0, z: 1, r: 0 })
            visible: b.z > 0.004 // not behind the camera
            readonly property var sun: root.galNow[0] || ({ x: 0, y: 0 })
            readonly property color tint: root.galColors[index + 1]
            // true size; a planet is far below a pixel, so it shows as a point of its colour
            readonly property real d: Math.max(4, b.r * panel.height * 2)
            readonly property real lx: galOverlay.sx(sun) - galOverlay.sx(b)
            readonly property real ly: galOverlay.sy(sun) - galOverlay.sy(b)
            readonly property real ll: Math.max(1e-3, Math.hypot(lx, ly))
            x: galOverlay.sx(b)
            y: galOverlay.sy(b)

            Shape { // halo
              id: haloShape
              x: -body.d * 1.6; y: -body.d * 1.6; width: body.d * 3.2; height: body.d * 3.2
              preferredRendererType: Shape.CurveRenderer
              ShapePath {
                strokeColor: "transparent"
                fillGradient: RadialGradient {
                  centerX: haloShape.width / 2; centerY: haloShape.height / 2; centerRadius: haloShape.width / 2
                  focalX: centerX; focalY: centerY
                  GradientStop { position: 0.25; color: Qt.alpha(body.tint, 0.22) }
                  GradientStop { position: 1.0; color: "transparent" }
                }
                PathAngleArc { centerX: haloShape.width / 2; centerY: haloShape.height / 2; radiusX: haloShape.width / 2; radiusY: haloShape.height / 2; startAngle: 0; sweepAngle: 360 }
              }
            }
            Shape { // the lit sphere
              id: sphereShape
              x: -body.d / 2; y: -body.d / 2; width: body.d; height: body.d
              preferredRendererType: Shape.CurveRenderer
              ShapePath {
                strokeColor: "transparent"
                fillGradient: RadialGradient {
                  centerX: sphereShape.width / 2; centerY: sphereShape.height / 2; centerRadius: sphereShape.width / 2
                  focalX: sphereShape.width / 2 + body.lx / body.ll * sphereShape.width * 0.3
                  focalY: sphereShape.height / 2 + body.ly / body.ll * sphereShape.height * 0.3
                  GradientStop { position: 0.0; color: Qt.lighter(body.tint, 1.5) }
                  GradientStop { position: 0.5; color: body.tint }
                  GradientStop { position: 1.0; color: Qt.darker(body.tint, 5) }
                }
                PathAngleArc { centerX: sphereShape.width / 2; centerY: sphereShape.height / 2; radiusX: sphereShape.width / 2; radiusY: sphereShape.height / 2; startAngle: 0; sweepAngle: 360 }
              }
            }
            Words {
              host: panel.under
              readonly property var lab: root.galLabels[body.index + 1] || ({ show: false, side: 1 })
              visible: lab.show
              x: lab.side < 0 ? -body.d / 2 - panel.tok.gap - width : body.d / 2 + panel.tok.gap
              y: -height / 2
              text: root.planetInfo[body.index].name.toUpperCase()
              opacity: root.textMix("names", "label")
              color: Qt.alpha(Color.foreground, 0.55)
              font.family: Style.resolvedFontFamily
              font.pixelSize: panel.tok.micro
              font.letterSpacing: panel.tok.micro * panel.tok.track.normal
            }
          }
        }

      }

      // ---- Milky Way view: place markers (the chosen place's card is in the rail) ----
      Item {
        id: gxOverlay
        width: panel.width
        height: panel.height
        visible: panel.live && root.galaxyMix > 0.01
        opacity: root.galaxyMix * (1 - root.fallFade)

        // the label layer: every place's marker and name (the hotspots, the
        // Sun, then the dwarf galaxies, which show up close or under the pointer)
        Repeater {
          model: root.hotspots.length + 1 + root.dwarfPlaces.length
          Item {
            id: mark
            required property int index
            readonly property bool isSun: index === root.gxSunIndex
            readonly property var h: isSun ? null : root.place(index)
            readonly property bool dwarf: !!h && !!h.dwarf
            readonly property var pt: root.gxScreen[index] || ({ x: 0, y: 0, front: false, show: false, dot: false })
            readonly property bool chosen: isSun ? root.gxSel === -1 : root.gxSel === index
            readonly property color tint: isSun ? "#fff4e0" : h.color
            // moving the pointer brings the names up, so a dim dwarf under it
            // can be identified; with the text off, nothing shows
            visible: pt.dot && opacity > 0.01
            opacity: root.textMix("names", "label")
            x: (pt.x / root.aspect + 0.5) * gxOverlay.width
            y: (pt.y + 0.5) * gxOverlay.height
            Rectangle {
              readonly property real d: mark.chosen ? 9 : mark.dwarf ? 3.5 : 5
              x: -d / 2; y: -d / 2; width: d; height: d; radius: d / 2
              color: mark.tint
              opacity: mark.chosen ? 0.9 : mark.dwarf ? 0.45 : 0.6
            }
            Words {
              host: panel.under
              visible: mark.pt.show
              x: mark.pt.side < 0 ? -width - panel.tok.gap : panel.tok.gap
              y: -height / 2
              text: (mark.isSun ? "SUN  ·  YOU ARE HERE" : mark.h.name.toUpperCase())
              color: mark.chosen ? root.hudHighlight : Qt.alpha(Color.foreground, mark.isSun ? 0.85 : 0.55)
              font.family: Style.resolvedFontFamily
              font.pixelSize: panel.tok.label
              font.letterSpacing: panel.tok.label * panel.tok.track.normal
            }
          }
        }

      }

      // ---- the mode caption (root.modeCaption), in the caption slot, in the HUD's voice ----
      Scrim { over: modeCaption; host: panel.under; centred: true; show: root.textMix("names", "caption"); feather: panel.tok.label * 4 }
      Column {
        id: modeCaption
        readonly property var c: root.modeCaption
        visible: panel.live && !!c && opacity > 0.01
        opacity: root.modeCaptionMix * panel.captionSlot
        x: panel.lay.caption.x
        width: panel.lay.caption.w
        y: panel.lay.caption.bottom - height
        spacing: panel.tok.row
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          opacity: root.textMix("names", "caption")
          text: modeCaption.c ? modeCaption.c.title : ""
          color: Color.accent
          font.family: Style.resolvedFontFamily
          font.pixelSize: panel.tok.label
          font.letterSpacing: panel.tok.label * panel.tok.track.title
        }
        Repeater {
          model: modeCaption.c ? modeCaption.c.lines : []
          Text {
            required property var modelData
            width: modeCaption.width
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            maximumLineCount: 3
            elide: Text.ElideRight
            visible: opacity > 0
            opacity: root.textMix("guide", "caption")
            text: modelData.text
            color: modelData.warm ? Qt.alpha("#ffd27a", 0.8) : Qt.alpha(Color.foreground, modelData.dim ? 0.45 : 0.65)
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.micro
            font.letterSpacing: panel.tok.micro * panel.tok.track.normal
          }
        }
      }

      // ---- anatomy (lib/anatomy.js): the lines and the labels of the body in front ----
      // One renderer (AnatDrawing), two places: on the body, in the first
      // screen's pixels, and in the lens, which is one item riding the
      // HUD's disc (its drift moves it and redraws nothing). Nothing exists
      // while the anatomy is off, faded on the idle clock or away on a
      // journey.
      Loader {
        id: anatLayer
        anchors.fill: parent
        active: panel.live && !!root.anatStage && root.anatMix * root.presAnat * (1 - root.anatLens) > 0.004
        sourceComponent: Component {
          AnatDrawing {
            out: root.anatStage
            host: panel.under; tok: panel.tok
            kx: panel.width / root.lay0.W; ky: panel.height / root.lay0.H
            opacity: root.anatMix * root.presAnat * (1 - root.anatLens)
          }
        }
      }
      Loader {
        id: anatGlassLayer
        active: panel.live && !!root.anatGlass && root.lensUp > 0.004
        sourceComponent: Component {
          Item {
            id: glass
            readonly property real d: root.anatLensD(panel.lay)
            readonly property real k: d / root.anatLensD(root.lay0)
            x: panel.hudCx - d / 2; y: panel.hudCy - d / 2; width: d; height: d
            opacity: root.lensUp
            // the glass: the scene dimmed inside the rim, so the lines read as a drawing
            Rectangle { anchors.fill: parent; radius: glass.d / 2; color: Qt.rgba(0, 0, 0, 0.6); border.width: 1.2; border.color: Qt.alpha(Color.foreground, root.anatLevel * 0.8) }
            AnatDrawing { out: root.anatGlass; host: panel.under; tok: panel.tok; kx: glass.k; ky: glass.k }
            // from the rim to the body itself, and a ring round it
            Item {
              id: aim
              readonly property var a: root.anatAim
              readonly property real ax: a ? a[0] * panel.width / root.lay0.W - glass.x : 0
              readonly property real ay: a ? a[1] * panel.height / root.lay0.H - glass.y : 0
              readonly property real len: Math.hypot(ax - glass.d / 2, ay - glass.d / 2)
              readonly property real ring: a ? Math.max(a[2] * panel.height / root.lay0.H + 0.6 * panel.tok.gap, 1.2 * panel.tok.gap) : 0
              visible: !!a && len > glass.d / 2 + ring + 4
              Item {
                x: glass.d / 2; y: glass.d / 2
                rotation: Math.atan2(aim.ay - glass.d / 2, aim.ax - glass.d / 2) * 180 / Math.PI
                Rectangle { x: glass.d / 2; y: -0.6; width: Math.max(0, aim.len - glass.d / 2 - aim.ring); height: 1.2; color: Qt.alpha(Color.foreground, root.anatLevel * 0.8); antialiasing: true }
              }
              Rectangle { x: aim.ax - aim.ring; y: aim.ay - aim.ring; width: 2 * aim.ring; height: 2 * aim.ring; radius: aim.ring; color: "transparent"; border.width: 1.2; border.color: Qt.alpha(Color.foreground, root.anatLevel * 0.8); antialiasing: true }
            }
          }
        }
      }

      // planet names in the system view, beside each planet
      Repeater {
        model: root.planetInfo
        Words {
          host: panel.under
          required property var modelData
          required property int index
          readonly property var pt: root.sysScreen[index] || ({ x: 0, y: 0, r: 0, show: false })
          visible: panel.live && root.sys > 0.5 && root.chaseMix < 0.02 && root.galMix < 0.5 && pt.show && opacity > 0.01
          opacity: (root.sys - 0.5) * 1.4 * (1 - root.chaseMix) * root.textMix("names", "label")
          x: (pt.x / root.aspect + 0.5) * panel.width + (pt.side < 0 ? -pt.r * panel.height - panel.tok.gap - width : pt.r * panel.height + panel.tok.gap)
          y: (pt.y + 0.5) * panel.height - height / 2
          text: modelData.name.toUpperCase()
          color: root.follow === index + 1 ? root.hudHighlight : Color.foreground
          font.family: Style.resolvedFontFamily
          font.pixelSize: panel.tok.label
          font.letterSpacing: panel.tok.label * panel.tok.track.normal
        }
      }

      // ---- the rail: the chosen place's card over the key hints ----
      // One column at the bottom left, standing on the safe rect's bottom
      // and growing upward, so the card and the hints cannot share a corner.
      // A part that is not showing takes no room: the rest stands lower.
      Scrim {
        over: rail; host: panel.under; feather: panel.tok.label * 4
        show: Math.max(card.visible ? root.cardMix * root.textMix("names", "card") : 0, hints.visible ? root.textMix(root.touring ? "names" : "guide", "hints") : 0)
      }
      Column {
        id: rail
        visible: panel.live
        opacity: panel.railStep
        x: panel.lay.rail.x
        width: panel.lay.rail.w
        y: panel.lay.rail.bottom - height
        spacing: panel.tok.gap * 2

        // the chosen place: what it is, how far, how big, and how old its light is
        Column {
          id: card
          width: parent.width
          spacing: panel.tok.row
          visible: root.cardShown && root.cardMix > 0.01 && root.gateNames > 0 && root.presCard > 0
          opacity: root.cardMix
          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            opacity: root.textMix("names", "card")
            text: root.cardTitle
            color: Color.accent
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.title
            font.letterSpacing: panel.tok.title * panel.tok.track.wide
          }
          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            opacity: root.textMix("names", "card")
            text: root.cardSub
            color: Qt.alpha(Color.foreground, 0.6)
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.micro
            font.letterSpacing: panel.tok.micro * panel.tok.track.normal
          }
          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            visible: root.cardFacts !== ""
            opacity: root.textMix("names", "card")
            text: root.cardFacts
            color: Color.foreground
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.label
          }
          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            maximumLineCount: 6
            elide: Text.ElideRight
            visible: opacity > 0 && root.cardBlurb !== ""
            opacity: root.textMix("guide", "card")
            text: root.cardBlurb
            color: Qt.alpha(Color.foreground, 0.7)
            font.family: Style.resolvedFontFamily
            font.pixelSize: panel.tok.label
          }
        }

        // what each key does in the current mode, one per row
        Column {
          id: hints
          width: parent.width
          spacing: Math.max(1, panel.tok.row - 2)
          readonly property real keyW: Math.round(panel.tok.label * 13.5)
          visible: opacity > 0 && root.railRows.length > 0
          opacity: Math.min(0.75, root.hudBrightness * 1.8) * 0.9 * root.textMix(root.touring ? "names" : "guide", "hints")
          Repeater {
            model: root.railRows
            Row {
              required property var modelData
              Text {
                width: hints.keyW
                text: modelData[0]
                color: Color.accent
                font.family: Style.resolvedFontFamily
                font.pixelSize: panel.tok.label
                font.letterSpacing: panel.tok.label * panel.tok.track.tight
              }
              Text {
                width: hints.width - hints.keyW
                wrapMode: Text.WordWrap
                text: modelData[1]
                color: Color.foreground
                font.family: Style.resolvedFontFamily
                font.pixelSize: panel.tok.label
              }
            }
          }
        }
      }

      // The story band (root.say, lib/text.js), lower third: a spaced title
      // over a line or two. Whoever speaks, it is this one band; the model
      // gives every caption its reading time.
      Scrim { over: filmCaption; host: panel.under; centred: true; feather: panel.tok.filmBody * 4.5 }
      Column {
        id: filmCaption
        visible: panel.live && opacity > 0
        opacity: root.storyShow
        x: Math.round(panel.lay.story.x)
        width: Math.round(panel.lay.story.w)
        y: Math.round(panel.lay.story.y)
        spacing: Math.round(panel.height * 0.008)
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WordWrap
          visible: text !== ""
          text: root.storyTitle.toUpperCase()
          color: Qt.alpha(Color.foreground, 0.8)
          font.family: Style.resolvedFontFamily
          // sized to read on a phone or a 1080p player, not just on the desk
          font.pixelSize: panel.tok.filmTitle
          font.letterSpacing: panel.tok.filmTrack
        }
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WordWrap
          lineHeight: 1.25
          visible: text !== ""
          text: root.storyBody
          color: Qt.alpha(Color.foreground, 0.7)
          font.family: Style.resolvedFontFamily
          font.pixelSize: panel.tok.filmBody
          font.letterSpacing: 1
        }
      }

      // IPC `textDebug true`: this screen's plan, outlined
      Item {
        id: zoneDebug
        anchors.fill: parent
        visible: root.textDebug && panel.live
        readonly property var ext: Lay.hudExtent(panel.lay)
        Rectangle { color: "transparent"; border.width: 1; border.color: "#40ff80"; x: panel.lay.safe.x0; y: panel.lay.safe.y0; width: panel.lay.safe.x1 - x; height: panel.lay.safe.y1 - y }
        Rectangle { color: "transparent"; border.width: 1; border.color: "#ff3060"; x: panel.lay.rail.x; y: rail.y; width: panel.lay.rail.w; height: rail.height }
        Rectangle { color: "transparent"; border.width: 1; border.color: "#ff3060"; x: panel.lay.caption.x; y: panel.lay.caption.bottom - height; width: panel.lay.caption.w; height: panel.lay.caption.maxH }
        Rectangle { color: "transparent"; border.width: 1; border.color: "#ffd27a"; x: panel.lay.story.x; y: panel.lay.story.y; width: panel.lay.story.w; height: Math.max(filmCaption.height, panel.lay.H * 0.14) }
        // the HUD's whole reach as it drifts, then where it is now
        Rectangle { color: "transparent"; border.width: 1; border.color: "#406080"; x: zoneDebug.ext.x; y: zoneDebug.ext.y; width: zoneDebug.ext.w; height: zoneDebug.ext.h }
        // the instrument's rim (0.232 of the HUD's unit)
        Rectangle {
          readonly property real r: panel.hud.R * Lay.BRACKET / Lay.RING
          color: "transparent"; border.width: 1; border.color: "#ff3060"
          x: panel.hudCx - r; y: panel.hudCy - r; width: 2 * r; height: 2 * r; radius: r
        }
      }

      Item {
        id: keyTaker
        focus: root.explore !== "universe"
        Keys.onPressed: function(event) {
          root.touchText()
          root.anatEndWalk()
          if (event.key === Qt.Key_Escape) {
            root.back()
            event.accepted = true
            return
          }
          const k = event.text.toLowerCase()
          if (k === "h") { root.setText("toggle", "key H"); event.accepted = true; return }
          if (k === "t") { root.setText(event.modifiers & Qt.ShiftModifier ? "prev" : "next", "key T"); event.accepted = true; return }
          if (k === "c" && root.explore !== "flight") { root.setAnatomy("toggle"); event.accepted = true; return }
          if (root.explore === "sky") {
            const arrowsS = { [Qt.Key_Left]: "left", [Qt.Key_Right]: "right", [Qt.Key_Up]: "up", [Qt.Key_Down]: "down" }
            if (arrowsS[event.key]) {
              if (!event.isAutoRepeat) root.keysDown = Object.assign({}, root.keysDown, { [arrowsS[event.key]]: true })
              event.accepted = true
              return
            }
            if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
              root.skyGo(root.skyView + (event.key === Qt.Key_Backtab ? -1 : 1), false)
              event.accepted = true
              return
            }
            if (k.length === 1 && k >= "1" && k <= "7") { root.skyGo(Number(k) - 1, false); event.accepted = true; return }
          }
          if (root.explore === "galaxy") {
            const arrows = { [Qt.Key_Left]: "left", [Qt.Key_Right]: "right", [Qt.Key_Up]: "up", [Qt.Key_Down]: "down" }
            if (arrows[event.key]) {
              if (!event.isAutoRepeat) root.keysDown = Object.assign({}, root.keysDown, { [arrows[event.key]]: true })
              event.accepted = true
              return
            }
            // a fall: nothing steers and no other view is a key away. Esc (the
            // way home), T and H above, and the arrows look around
            if (root.fallState) { event.accepted = true; return }
            const n = root.hotspots.length
            if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
              // from the Sun, free flight or a dwarf galaxy (past the hotspots): start at the first
              const cur = root.gxSel < 0 || root.gxSel >= n ? (event.key === Qt.Key_Backtab ? 0 : -1) : root.gxSel
              root.gxFlyTo((cur + (event.key === Qt.Key_Backtab ? n - 1 : 1)) % n)
              event.accepted = true
              return
            }
            if (k === "0") { root.gxFlyTo(-1); event.accepted = true; return }
            if (k === "b") { root.gxB(); event.accepted = true; return }
            if (k === "k") { root.mathMode = !root.mathMode; root.fallInvite = false; event.accepted = true; return }
            if (k === "v") { root.gxGoView(0); event.accepted = true; return }
            if (k === "[" || k === "]") {
              root.gxRateIndex = Math.max(0, Math.min(root.gxRates.length - 1, root.gxRateIndex + (k === "]" ? 1 : -1)))
              event.accepted = true
              return
            }
            if (k === "n") { root.gxMyr = 0; root.gxRateIndex = 0; event.accepted = true; return }
            if (k === "x") { root.enterSystem(); event.accepted = true; return }
          }
          if (root.explore === "system") {
            const arrows = { [Qt.Key_Left]: "left", [Qt.Key_Right]: "right", [Qt.Key_Up]: "up", [Qt.Key_Down]: "down" }
            if (arrows[event.key]) {
              if (!event.isAutoRepeat) root.keysDown = Object.assign({}, root.keysDown, { [arrows[event.key]]: true })
              event.accepted = true
              return
            }
            if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
              const step = event.key === Qt.Key_Backtab ? 6 : 1
              root.focusBody(((root.follow < 0 ? 0 : root.follow) + step) % 7)
              event.accepted = true
              return
            }
            if (k === "g") { root.toggleGalactic(); event.accepted = true; return }
            if (k === "v" && root.galactic) { root.toggleGalBack(); event.accepted = true; return }
            if (k === "i" && root.explore === "system") { root.guides = !root.guides; event.accepted = true; return }
            if (root.galactic && (k === "-" || k === "=" || k === "+")) {
              root.galSlowIndex = Math.max(0, Math.min(root.galSlows.length - 1, root.galSlowIndex + (k === "-" ? 1 : -1)))
              event.accepted = true
              return
            }
            if (k === "m") { root.focusBody(7); event.accepted = true; return }
            if (k === "e" && root.chasing) { root.chaseLook(); event.accepted = true; return }
            if (k === "r" && root.chasing) { root.chaseSwap(); event.accepted = true; return }
            if (k.length === 1 && "0123456".includes(k)) {
              root.focusBody(Number(k))
              event.accepted = true
              return
            }
            if (k === "o") { root.autoOrbit = !root.autoOrbit; event.accepted = true; return }
            if (k === "x" && !root.chasing) { root.enterGalaxy(); event.accepted = true; return }
            if (k === "v") { root.toggleChase(); event.accepted = true; return }
            if (k === "x" && root.chasing) { root.setChaseLocked(!root.chaseLocked); event.accepted = true; return }
            if (k === "[" || k === "]") {
              root.simRateIndex = Math.max(0, Math.min(root.simRates.length - 1, root.simRateIndex + (k === "]" ? 1 : -1)))
              event.accepted = true
              return
            }
            if (k === "n") {
              root.simMs = Date.now()
              root.simRateIndex = 0
              event.accepted = true
              return
            }
          }
          if (k.length === 1 && "wasdrfqe".includes(k)) {
            if (!event.isAutoRepeat) root.keysDown = Object.assign({}, root.keysDown, { [k]: true })
            event.accepted = true
          }
        }
        Keys.onReleased: function(event) {
          const arrows = { [Qt.Key_Left]: "left", [Qt.Key_Right]: "right", [Qt.Key_Up]: "up", [Qt.Key_Down]: "down" }
          const k = arrows[event.key] || event.text.toLowerCase()
          if (root.keysDown[k] && !event.isAutoRepeat) {
            const next = Object.assign({}, root.keysDown)
            delete next[k]
            root.keysDown = next
            event.accepted = true
          }
        }
      }

      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
        hoverEnabled: true
        // One gesture for every view (lib/drag.js): the pointer holds something,
        // it follows the pointer 1:1, and a release throws it with the measured
        // velocity onto the springs; a press stops a coast dead, where it is
        // (a flight's turn goes on until the drag moves, then it is taken over
        // from the pose it has reached). What is held:
        //   sky      the direction under the pointer (an exact angular grab)
        //   galaxy   the orbit about the focus, arcball: half a screen height of
        //            drag is a right angle (falling: look around, the far field
        //            under the pointer)
        //   system   left button: the same arcball orbit about the focus, in every
        //            view; right or middle button, or Shift: grab the ecliptic
        //            and pan (the chase and galactic views have nothing to pan:
        //            they orbit on any button)
        // A click (under 4 px and 0.35 s) picks; a drag never does. Event times
        // are the wall clock in seconds: nothing divides by one event's dt.
        property var gesture: null
        property string mode: ""          // "sky", "look", "gxorbit", "orbit", "pan"
        property bool wasClick: false
        property bool focusing: false     // the press is bringing keyboard focus to the wallpaper
        function now() { return Date.now() / 1000 }
        onPressed: function(mouse) {
          root.touchText()
          const pt = root.toP(mouse.x, mouse.y, width, height), t = now()
          focusing = !keyTaker.activeFocus
          wasClick = false
          gesture = null
          if (root.explore === "sky") {
            mode = "sky"
            root.skyOrbit.l.hold(); root.skyOrbit.b.hold()   // a coast stops dead; a glide to a view goes on until the drag moves
            root.skyLTarget = root.skyOrbit.l.g; root.skyBTarget = root.skyOrbit.b.g
            gesture = new Dr.Gesture(pt, t, 1 / height, [root.skyL, root.skyB])
            gesture.held = Dr.skyRay(root.skyL * Math.PI / 180, root.skyB * Math.PI / 180, pt, root.skyFocal())
          } else if (root.explore === "galaxy") {
            mode = root.fallState ? "look" : "gxorbit"
            root.gxOrbit.yaw.hold(); root.gxOrbit.pitch.hold()
            root.gxYawTarget = root.gxOrbit.yaw.g; root.gxPitchTarget = root.gxOrbit.pitch.g
            gesture = new Dr.Gesture(pt, t, 1 / height, [root.gxYaw, root.gxPitch])
          } else if (root.explore === "system") {
            const pan = (mouse.button !== Qt.LeftButton || (mouse.modifiers & Qt.ShiftModifier)) && !root.chasing && !root.galactic
            mode = pan ? "pan" : "orbit"
            root.sysCam.stop()
            gesture = new Dr.Gesture(pt, t, 1 / height, pan ? root.sysCam.F.x : [root.sysCam.yaw.x, root.sysCam.pitch.x])
          }
        }
        onPositionChanged: function(mouse) {
          root.hudPointerIn = Math.hypot(mouse.x - panel.hudCx, mouse.y - panel.hudCy) < panel.hud.R
          if (root.explore !== "universe") root.touchText()
          root.anatPointer = [mouse.x * root.lay0.W / width, mouse.y * root.lay0.H / height]
          const pt = root.toP(mouse.x, mouse.y, width, height)
          if (root.explore === "galaxy" && !pressed) {
            // hovering: the tick finds the place under the pointer (gxHover)
            root.gxPointer = [pt[0], pt[1], 1 / height]
          } else if (root.explore !== "galaxy" && root.gxPointer) root.gxPointer = null
          if (root.explore === "universe") {
            root.viewTarget = Qt.vector2d(mouse.x / width - 0.5, mouse.y / height - 0.5)
            root.hoverSystem = root.overSystem(pt)
            return
          }
          if (!pressed || !gesture) return
          const g = gesture, prev = g.s
          const wasDrag = g.dragging
          const drag = g.move(pt, now())
          // nothing is written until the pointer has moved past the click
          // threshold: a wobbly click neither stops a flight's turn nor unpins.
          // The first move that makes it a drag takes over from the pose the
          // view has reached by then (a glide went on under the press), with
          // the pointer where it is now, so nothing jumps
          if (!drag) return
          if (mode === "sky") {
            // the patch of sky under the pointer goes back under it (lib/drag.js skyAnglesFor)
            if (!wasDrag) g.held = Dr.skyRay(root.skyL * Math.PI / 180, root.skyB * Math.PI / 180, pt, root.skyFocal())
            root.skyDragging = true
            const a = Dr.skyAnglesFor(g.held, pt, root.skyFocal(), root.skyL * Math.PI / 180, root.skyB * Math.PI / 180, 89 * Math.PI / 180)
            root.skyL = root.skyLTarget = a.l * 180 / Math.PI
            root.skyB = root.skyBTarget = a.b * 180 / Math.PI
            root.skyOrbit.l.set(root.skyL); root.skyOrbit.b.set(root.skyB)
            g.record([root.skyL, root.skyB])
          } else if (mode === "look") {
            // falling: look around, the far field following the pointer
            root.gxLookDragging = true
            root.fallLookBy((pt[0] - prev[0]) * Dr.LOOK_RATE, -(pt[1] - prev[1]) * Dr.LOOK_RATE)
          } else if (mode === "gxorbit") {
            // the pose at the drag's start plus the pointer's offset since: a clamp loses nothing
            const o = g.offset()
            if (!wasDrag) g.x0 = [root.gxYaw - o[0] * Dr.ORBIT_RATE, root.gxPitch - o[1] * Dr.ORBIT_RATE]
            root.gxYaw = root.gxYawTarget = g.x0[0] + o[0] * Dr.ORBIT_RATE
            root.gxPitch = root.gxPitchTarget = Math.max(-1.45, Math.min(1.45, g.x0[1] + o[1] * Dr.ORBIT_RATE))
            root.gxOrbit.yaw.set(root.gxYaw); root.gxOrbit.pitch.set(root.gxPitch)
            root.gxOrbit.yaw.w = Cam.W_INPUT; root.gxOrbit.pitch.w = Cam.W_INPUT
            root.gxView = -1   // orbiting leaves a named viewpoint's line
            g.record([root.gxYaw, root.gxPitch])
          } else if (mode === "orbit") {
            // by steps: the chase's yaw rides the tracked azimuth, so there is no
            // absolute pose to hold. In the chase and galactic views the pitch is
            // a real elevation: drag down to look down
            const sgn = root.chasing || root.galactic ? 1 : -1
            root.sysCam.orbit((pt[0] - prev[0]) * Dr.ORBIT_RATE, sgn * (pt[1] - prev[1]) * Dr.ORBIT_RATE, true)
            root.autoOrbit = false
            g.record([root.sysCam.yaw.x, root.sysCam.pitch.x])
          } else if (mode === "pan") {
            // the ecliptic point under the pointer sticks to it. The grab begins
            // past the click threshold, on the point under the pointer NOW (so
            // nothing jumps), and unpins the body: a wobbly click unpins nothing
            if (!root.sysCam.grab) { root.follow = -1; root.sysCam.grabBegin(pt, root.ecliptic) }
            root.sysCam.grabMove(pt)
            g.record(root.sysCam.F.x)
          }
        }
        onReleased: {
          root.skyDragging = false
          root.gxLookDragging = false
          const g = gesture, t = now()
          gesture = null
          wasClick = g ? g.isClick(t) : true
          if (!g) return
          // no drag happened: the springs are left as they are, so a click (or
          // a long press, or the press that only focused) does not freeze a
          // flight's turn or a glide to a named view by setting its goal here
          if (!g.dragging) { mode = ""; return }
          // the throw: the state's velocity over the last 60 ms of the drag,
          // then the spring coasts it v tau and stops (camera.js fling)
          const v = g.velocity(t, Cam.FLING_TAU)
          if (mode === "sky") {
            root.skyOrbit.l.set(root.skyL, v[0]); root.skyOrbit.b.set(root.skyB, v[1])
            root.skyOrbit.l.fling(); root.skyOrbit.b.fling()
            root.skyLTarget = root.skyOrbit.l.g
            root.skyBTarget = Math.max(-89, Math.min(89, root.skyOrbit.b.g))
          } else if (mode === "gxorbit") {
            root.gxOrbit.yaw.set(root.gxYaw, v[0]); root.gxOrbit.pitch.set(root.gxPitch, v[1])
            root.gxOrbit.yaw.fling(); root.gxOrbit.pitch.fling()
            root.gxYawTarget = root.gxOrbit.yaw.g
            root.gxPitchTarget = Math.max(-1.45, Math.min(1.45, root.gxOrbit.pitch.g))
          } else if (mode === "orbit") root.sysCam.orbitEnd(v[0], v[1])
          else if (mode === "pan" && root.sysCam.grab) root.sysCam.grabEnd(v)
          mode = ""
        }
        onCanceled: {
          gesture = null; mode = ""; wasClick = false
          root.skyDragging = false
          root.gxLookDragging = false
          if (root.sysCam.grab) root.sysCam.grabEnd()
        }
        onExited: {
          root.viewTarget = Qt.vector2d(0, 0)
          root.hoverSystem = false
          root.hudPointerIn = false
          root.gxPointer = null
          root.anatPointer = null
        }
        onClicked: function(mouse) {
          if (!wasClick) return
          wasClick = false
          if (mouse.button === Qt.RightButton) { if (root.explore !== "universe") root.back(); return }
          if (mouse.button !== Qt.LeftButton) return
          // the click that brought keyboard focus back to the wallpaper (a
          // window had it) only focuses: it was aimed at the desk, not at a
          // marker or a planet
          if (focusing && keyTaker.activeFocus && root.explore !== "universe") return
          const pt = root.toP(mouse.x, mouse.y, width, height)
          if (root.explore === "galaxy") {
            // fly to the nearest marked place under the pointer (a dwarf
            // galaxy counts once its marker shows: up close or hovered)
            let best = -2
            let bestD = 28
            for (let i = 0; i < root.gxScreen.length; i++) {
              const g = root.gxScreen[i]
              if (!g.dot) continue
              const d = Math.hypot((g.x / root.aspect + 0.5) * width - mouse.x, (g.y + 0.5) * height - mouse.y)
              if (d < bestD) { bestD = d; best = i === root.gxSunIndex ? -1 : i }
            }
            if (best !== -2) root.gxFlyTo(best)
          } else if (root.explore === "universe" && root.overSystem(pt)) root.enterSystem()
          else if (root.explore === "system" && !root.galactic) {
            const b = root.pickBody(pt)
            if (b >= 0) { if (root.chasing) root.chaseLook(b); else root.focusBody(b) }
          }
        }
        onWheel: function(wheel) {
          root.touchText()
          const pt = root.toP(wheel.x, wheel.y, width, height)
          const steps = wheel.angleDelta.y / 120
          if (root.explore === "sky") root.skyVfovTarget = Math.max(8, Math.min(130, root.skyVfovTarget * Math.pow(1.12, -steps)))
          else if (root.explore === "galaxy") {
            // scrolling in on the Sun, already at the closest approach, lands in the solar system
            if (steps > 0 && root.gxSel === -1 && root.gxDistGoal <= root.gxMinDist() * 1.001) root.enterSystem()
            else if (steps > 0 && root.gxParkedAtHole) root.fallBegin(root.gxDist / root.rsKpc)   // one more notch at 6 Rs: let go
            else if (!root.fallState) {
              root.gxDistGoal = Math.max(root.gxMinDist(), Math.min(2500, root.gxDistGoal * Math.pow(1.2, -steps)))
              if (steps < 0) root.gxFallArmed = false
            }
          }
          else if (root.galactic || root.chasing) root.sysCam.zoomBy(-steps * Math.log(1.15))
          else if (root.explore === "system") {
            // zoom about the point under the pointer (on the ecliptic), exact at
            // every frame; about the body while one is pinned; out past the
            // overview's limit leaves to the universe
            if (steps < 0 && root.sysCam.ell.g >= Math.log(1 / 1.3) - 1e-9) root.explore = "universe"
            else root.sysCam.zoomAt(pt, -steps * Math.log(1.25), root.ecliptic)
          }
          else if (root.explore === "universe" && steps > 0 && root.overSystem(pt)) root.enterSystem()
          wheel.accepted = true
        }
        onDoubleClicked: function(mouse) {
          const pt = root.toP(mouse.x, mouse.y, width, height)
          if (mouse.button === Qt.RightButton && root.explore === "universe") root.openThemeSwitcher()
          else if (mouse.button === Qt.MiddleButton) root.explore = root.explore === "flight" ? "universe" : "flight"
          else if (root.explore === "universe" && !root.overSystem(pt)) root.openSelector()
          mouse.accepted = true
        }
      }
    }
  }
}
