import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons
import qs.Ui
import "lib/camera.js" as Cam
import "lib/fall.js" as Fall
import "lib/localgroup.js" as LG
import "lib/dwarfs.js" as Dw
import "lib/labels.js" as Lb

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
  // for frames.
  property real lastFrameAt: 0

  // ---- JARVIS navigation ----
  // While exploring, the HUD's readout column becomes navigation telemetry for
  // where you are (refreshed 5 times a second), and beacons around its ring
  // point toward the Sun, Earth, the target and the Galactic Centre, on or off
  // screen, like a compass. The system stats shrink to one line.
  property var navRows: []
  property var navBeacons: [null, null, null, null] // { name, ang (radians, screen), dist (text), color, behind }
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
  function fmtRa(h) { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return hh + "H " + (mm < 10 ? "0" : "") + mm + "M" }
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
      root.tick()
    }
  }
  Timer {
    interval: 16
    running: root.animate
    repeat: true
    onTriggered: if (root.explore === "universe" || Date.now() - root.lastFrameAt > 120) root.tick()
  }

  // The soft nebula layer drifts slowly, so it re-renders ~10 times a second.
  property real nebulaTime: 0
  Timer {
    interval: root.navigating ? 16 : 100
    running: root.animate
    repeat: true
    onTriggered: root.nebulaTime = root.shaderTime
  }

  // The JARVIS HUD: Super+Alt+J (or H while exploring, or
  // `omarchy-shell background toggleHud`) hides or shows it; hidden is
  // remembered by a flag file. `omarchy-shell background hud <level>` sets its
  // brightness until the shell restarts.
  property bool hudOn: true
  property real hudBrightness: 0.38
  readonly property real hudLevel: hudOn ? hudBrightness * (1 - filmMix) : 0

  // Film mode (IPC `film true`): for recording. The HUD, key hints, place
  // labels, markers and mode captions fade out over 1.5 s and the scene
  // stays; `caption <title> <body>` then shows a quiet lower-third caption
  // that fades in and out. Not remembered: a restart is back to normal.
  property bool film: false
  property real filmMix: film ? 1 : 0
  Behavior on filmMix { NumberAnimation { duration: 1500; easing.type: Easing.InOutSine } }
  readonly property real unclutter: 1 - filmMix   // multiplies every overlay that film mode hides
  // The label layer (L, IPC `labels <true/false>`): place markers and names
  // in the Milky Way view, planet names in the system view. On, it comes up
  // with any interaction (a key, the pointer, a flight) and fades Lb.HOLD_S
  // seconds after the last one, so a parked view puts no standing text on
  // the OLED; off, it stays away. Film mode hides it as before (unclutter).
  property bool labelsOn: true
  readonly property var labelClock: Lb.create()
  property real labelsMix: 1
  function touchLabels() { Lb.touch(labelClock) }
  function setLabels(on) { labelsOn = on; touchLabels() }
  property string captionTitle: ""
  property string captionBody: ""
  property int captionSerial: 0                   // each screen's caption follows this
  function setCaption(title, body) {
    captionTitle = title; captionBody = body
    captionSerial++
  }
  readonly property string hudHiddenFlag: stateHome + "/universe-background/hud-hidden"

  function setHud(on) {
    hudOn = on
    hudFlagProc.command = on ? ["rm", "-f", hudHiddenFlag]
                             : ["bash", "-c", "mkdir -p \"$(dirname \"$1\")\" && touch \"$1\"", "_", hudHiddenFlag]
    hudFlagProc.running = true
  }

  Process { id: hudFlagProc }
  Process {
    id: hudFlagCheck
    running: true
    command: ["test", "-e", root.hudHiddenFlag]
    onExited: function(code) { root.hudOn = code !== 0 }
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
    labels: new Cam.Spring(1, Cam.W_MODE),     // the label layer, up after an interaction
    exposure: new Cam.Spring(1, 1.3),          // the sky brightens slowly on an empty workspace
    fallFade: new Cam.Spring(0, 2.9)           // the fall's black, 2 s each way (0.98 at 2.0 s)
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
    if (explore !== "galaxy") { gxRateIndex = 0; fallReset() }
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
  readonly property var simRateNames: ["LIVE", "1 MIN/S", "1 HOUR/S", "1 DAY/S", "1 WEEK/S", "1 MONTH/S", "1 YEAR/S"]
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
  onGalacticChanged: setLimits()
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
  readonly property var hotspots: [{"name": "Sagittarius A*", "kind": "blackhole", "label": "supermassive black hole + nuclear star cluster", "pos": [0, 0, 0], "dpc": 8150, "size": 8, "color": "#ffb070", "blurb": "A 4.3 million solar-mass black hole at the dynamical centre of the Galaxy."},
    {"name": "Orion Nebula", "kind": "nebula", "label": "HII region / star-forming nebula", "pos": [-0.17796, 8.47092, -0.10828], "dpc": 389, "size": 7, "color": "#e8708a", "blurb": "The nearest site of massive star birth, lit by the Trapezium cluster."},
    {"name": "Pleiades", "kind": "cluster", "label": "open cluster with reflection nebula", "pos": [0.02879, 8.27058, -0.03315], "dpc": 135.2, "size": 4, "color": "#9fc3ff", "blurb": "A young blue cluster drifting through a dust cloud that reflects its light."},
    {"name": "Hyades", "kind": "cluster", "label": "open cluster", "pos": [-5e-05, 8.19347, 0.00294], "dpc": 47, "size": 18, "color": "#ffd9a0", "blurb": "The nearest open cluster, about 650 million years old, framing Taurus."},
    {"name": "Carina Nebula · Eta Carinae", "kind": "nebula", "label": "giant HII region / LBV binary", "pos": [-2.2399, 7.43959, -0.00504], "dpc": 2350, "size": 60, "color": "#ff7a6a", "blurb": "A vast star-forming complex around Eta Carinae, one of the most massive known stars."},
    {"name": "Eagle Nebula", "kind": "nebula", "label": "HII region / young cluster NGC 6611", "pos": [0.50723, 6.48574, 0.04479], "dpc": 1740, "size": 20, "color": "#e07a5f", "blurb": "Columns of cold gas sculpted by ultraviolet light from NGC 6611."},
    {"name": "Lagoon Nebula", "kind": "nebula", "label": "HII region / young cluster NGC 6530", "pos": [0.13962, 6.82161, -0.00718], "dpc": 1336, "size": 30, "color": "#ff6f7f", "blurb": "A bright emission nebula split by a dark dust lane, near the Galactic Centre direction."},
    {"name": "Crab Nebula", "kind": "remnant", "label": "supernova remnant / pulsar wind nebula", "pos": [-0.15809, 10.13353, -0.18076], "dpc": 2000, "size": 3.4, "color": "#e89a6a", "blurb": "The expanding debris of the supernova seen in 1054, powered by a central pulsar."},
    {"name": "Cygnus X / Cygnus OB2", "kind": "nebula", "label": "star-forming complex / OB association", "pos": [1.73425, 7.85107, 0.04537], "dpc": 1760, "size": 60, "color": "#c47a7a", "blurb": "One of the Galaxy's richest OB associations, behind the Great Rift in Cygnus."},
    {"name": "Rosette Nebula", "kind": "nebula", "label": "HII region / young cluster NGC 2244", "pos": [-0.70401, 9.57446, -0.03746], "dpc": 1590, "size": 40, "color": "#ff6a6a", "blurb": "A ring of glowing gas hollowed out by winds from the central cluster NGC 2244."},
    {"name": "Omega Centauri", "kind": "globular", "label": "globular cluster (likely stripped dwarf nucleus)", "pos": [-4.07092, 4.84166, 1.42344], "dpc": 5430, "size": 30, "color": "#ffe2b0", "blurb": "The Milky Way's most massive globular cluster, about ten million stars."},
    {"name": "47 Tucanae", "kind": "globular", "label": "globular cluster", "pos": [-2.59429, 6.27274, -3.16918], "dpc": 4520, "size": 20, "color": "#ffe6bb", "blurb": "A dense, metal-rich globular cluster seen beside the Small Magellanic Cloud."},
    {"name": "Ring Nebula", "kind": "remnant", "label": "planetary nebula", "pos": [0.68408, 7.804, 0.21165], "dpc": 790, "size": 0.3, "color": "#7fd1c0", "blurb": "A shell of gas shed by a dying Sun-like star, seen nearly end-on."},
    {"name": "Helix Nebula", "kind": "remnant", "label": "planetary nebula", "pos": [0.06438, 8.0619, -0.148], "dpc": 201, "size": 1.5, "color": "#6fc3c8", "blurb": "One of the nearest planetary nebulae, with thousands of cometary knots."},
    {"name": "Westerlund 1", "kind": "cluster", "label": "young super star cluster", "pos": [-1.43945, 4.28975, -0.00796], "dpc": 4120, "size": 4, "color": "#ff9a5a", "blurb": "The most massive young cluster known in the Galaxy, heavily reddened by dust."},
    {"name": "Betelgeuse", "kind": "star", "label": "red supergiant", "pos": [-0.05619, 8.30615, -0.00537], "dpc": 168, "size": 3.4e-05, "color": "#ffa060", "blurb": "A red supergiant so large it would reach past Mars into the asteroid belt"},
    {"name": "Alpha Centauri", "kind": "star", "label": "triple star system (A, B, Proxima)", "pos": [-0.00093, 8.14904, 0.02078], "dpc": 1.338, "size": 0.063, "color": "#fff4e0", "blurb": "The nearest star system to the Sun; Proxima hosts at least one rocky planet."},
    {"name": "Vega", "kind": "star", "label": "A0V main-sequence star with debris disc", "pos": [0.0067, 8.14722, 0.02333], "dpc": 7.68, "size": 0.001, "color": "#cad8ff", "blurb": "A bright, rapidly rotating star ringed by a faint disc of dust."},
    {"name": "Polaris", "kind": "star", "label": "Cepheid variable / supergiant, multiple system", "pos": [0.10246, 8.21725, 0.0818], "dpc": 136.9, "size": 1.7e-06, "color": "#fff2d0", "blurb": "The current north pole star, the nearest Cepheid to the Sun."},
    {"name": "Sirius", "kind": "star", "label": "A1V star + white dwarf binary", "pos": [-0.00191, 8.15177, 0.02039], "dpc": 2.64, "size": 0.0001, "color": "#d8e4ff", "blurb": "The brightest star in the night sky, orbited by the white dwarf Sirius B."},
    {"name": "Large Magellanic Cloud", "kind": "galaxy", "label": "satellite dwarf galaxy (barred Magellanic spiral)", "pos": [-40.94813, 0.58289, -26.90795], "dpc": 49590, "size": 9000, "color": "#e6e2f0", "blurb": "The Milky Way's largest satellite; the Tarantula (l=279.5, b=-31.7) is its starburst."},
    {"name": "Small Magellanic Cloud", "kind": "galaxy", "label": "satellite dwarf irregular galaxy", "pos": [-37.56312, -16.05778, -43.58825], "dpc": 62440, "size": 5800, "color": "#e8e4ee", "blurb": "A gas-rich dwarf galaxy being tidally stretched by the LMC and the Milky Way."},
    {"name": "Sagittarius Dwarf Spheroidal", "kind": "galaxy", "label": "disrupting satellite dwarf galaxy", "pos": [2.48612, -17.20543, -6.42588], "dpc": 26280, "size": 5000, "color": "#ffdcae", "blurb": "A dwarf galaxy being torn apart behind the bulge; its stream wraps the Galaxy."},
    {"name": "Andromeda Galaxy", "kind": "galaxy", "label": "spiral galaxy (Local Group)", "pos": [605.53871, 374.44407, -279.75147], "dpc": 761000, "size": 46000, "color": "#fff0d8", "blurb": "The nearest large spiral, approaching the Milky Way at about 110 km/s."},
    {"name": "Triangulum Galaxy", "kind": "galaxy", "label": "spiral galaxy (Local Group)", "pos": [519.51912, 503.0543, -436.751], "dpc": 840000, "size": 18700, "color": "#dfe6ff", "blurb": "A smaller, loosely wound spiral rich in star-forming regions like NGC 604."},
    {"name": "Gum Nebula", "kind": "remnant", "label": "ionised shell / old supernova remnant region", "pos": [-0.4399, 8.2435, 0.0051], "dpc": 450, "size": 290, "color": "#c85a6a", "blurb": "A faint 36-degree bubble of ionised gas around the Vela pulsar region."}]
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
  property int gxSel: -1           // hotspot index; -1 the Sun, -2 free flight
  property real gxMyr: 0           // time-lapse, million years from now
  property int gxRateIndex: 0
  readonly property var gxRates: [0, 0.1, 1, 5, 20]
  readonly property var gxRateNames: ["PAUSED", "100,000 YEARS/S", "1 MILLION YEARS/S", "5 MILLION YEARS/S", "20 MILLION YEARS/S"]
  readonly property real sunR0: 8.15
  readonly property real sunOmega: 30.32 / 977.79 // radians per million years
  property real gxExposure: 3.0
  property vector3d gxCamPos: Qt.vector3d(0, 8.15, 30)
  property vector3d gxFwd: Qt.vector3d(0, 0, -1)
  property vector3d gxRight: Qt.vector3d(1, 0, 0)
  property vector3d gxUp: Qt.vector3d(0, 1, 0)
  property real gxStars: 1
  property vector4d gxFocus: Qt.vector4d(0, 0, 0, 0)
  property vector4d gxFocusCol: Qt.vector4d(1, 1, 1, 4)
  property var gxScreen: []        // per hotspot, then the Sun: screen point, label shown
  readonly property var gxKinds: ({ nebula: 0, cluster: 1, globular: 2, remnant: 3, star: 4, blackhole: 5, galaxy: 6 })
  function gxIndex(name) { return hotspots.findIndex(h => h.name.startsWith(name)) }
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
  // ---- named viewpoints (V, IPC `fly "Milky Way from"`): stand somewhere real and look ----
  // From Andromeda, 761 kpc away, our Galaxy is a spindle about 2.5 degrees
  // long (its 34 kpc of disk: five full Moons), 21 degrees from edge-on and
  // seen from the south, since Andromeda lies at Galactic latitude -21.6.
  // The camera stands at Andromeda's centre and looks at Sagittarius A*;
  // scrolling in crosses the gap along that line.
  readonly property var gxViews: [{ name: "The Milky Way from Andromeda", from: "Andromeda", at: [0, 0, 0],
    label: "2.5 MILLION LY FROM HOME  ·  OUR GALAXY SPANS ABOUT 2.5°, FIVE FULL MOONS",
    blurb: "Seen from Andromeda the Milky Way is a thin spindle 21 degrees from edge-on, its south side toward us, with the Magellanic Clouds beside it. The light arriving there now left the Milky Way 2.5 million years ago. Scroll in to cross the gap; the view stays on this line." }]
  property int gxView: -1
  function gxGoView(i) {
    if (fallState) return
    const v = gxViews[i]
    const o = LG.viewFrom(hotspotPos(gxIndex(v.from)), v.at)
    gxFallArmed = false
    gxSel = -2
    gxFree = v.at.slice()
    gxView = i
    gxYawTarget = o.yaw + Math.round((gxYawTarget - o.yaw) / (2 * Math.PI)) * 2 * Math.PI
    gxPitchTarget = o.pitch
    gxDistGoal = o.dist
    touchLabels()
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
    if (i < 0) return 0.0008
    const h = place(i)
    if (h.kind === "blackhole") return 20 * rsKpc // straight down to the event horizon
    return h.kind === "star" ? 0.0005 : Math.max(0.0015, h.size / 1000 * 3.2)
  }
  // closest approach: 0.2 pc anywhere, down to 6 Schwarzschild radii at Sgr A*
  readonly property real rsKpc: 4.11e-10
  property vector3d gxCamRs: Qt.vector3d(0, 1e6, 0)   // camera from Sgr A*, in Schwarzschild radii
  property bool gxHoleNear: false
  function gxMinDist() {
    if (gxSel >= 0 && place(gxSel).kind === "blackhole") return 6 * rsKpc
    // a place with a photo: no closer than where its 2048 px fill ~1.4 screen heights
    if (gxSel >= 0 && photoOf(gxSel)) return photoWidthKpc(gxSel) * 0.7
    return 0.0002
  }
  // ---- the fall into Sgr A* (lib/fall.js) ----
  // B flies to the hole, B again goes down to 6 Rs, and parked there B (or
  // one more scroll in) lets go; free flight that carries the camera below
  // the horizon falls too. From there on nothing steers: the camera rides the
  // free-fall trajectory ("falling"), the view turning from the hole to the
  // side as the horizon nears, so that the dark fills the half of the sky
  // below and the outside squeezes into a bright band above. Drag and the
  // arrows only look around, on top of that turn (gxLook below). Near the
  // singularity the screen fades to black ("out"), holds two seconds, and
  // the camera is back beside the Sun, fading in ("in"). Esc gives up by the
  // same fade; leaving the view, sleep or a fullscreen window reset it all.
  property string fallPhase: ""
  property var fallState: null          // Fall.begin() state, plus x (outward radial) and the eased fwd/up
  property real fallR: 6                // radius, Schwarzschild radii
  property bool fallInside: false       // below the horizon (set once, not per frame: the hints bind to it)
  property real fallLeft: 0             // proper time to the singularity, s
  property real fallRate: 1             // proper seconds per screen second (the approach is compressed)
  property real gxFallE: 0              // the observer's energy per unit mass, for the shaders (0: not falling)
  property real fallFade: 0             // 0..1 black
  property real fallHold: 0             // seconds spent black
  property real fallHoldFor: 2
  property bool gxParkedAtHole: false   // Sgr A* chosen, camera at its closest approach: B lets go
  property bool gxFallArmed: false      // B pressed again on the way down: let go on arrival
  property bool gxCamJumped: false      // the camera was placed, not flown: no path to test this frame
  // looking around while falling: an offset on top of the scripted view, yaw
  // about its up and pitch about its right (radians). It turns the camera
  // only: the trajectory and the falling observer's frame stay radial. After
  // 2.5 s without input it eases back (1.5 s per e-fold), so the scripted
  // framing, the dark below and the band above, returns on its own: the
  // turn keeps changing on the way down and a held offset would lose it.
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
  // at: where the fall starts (kpc), when not the camera's last position
  function fallBegin(rStart, at) {
    if (fallState || explore !== "galaxy") return
    const cam = at || [gxCamPos.x, gxCamPos.y, gxCamPos.z]
    const l = Math.hypot(cam[0], cam[1], cam[2])
    const F = Fall.begin(rStart)
    F.x = l > 1e-15 ? [cam[0] / l, cam[1] / l, cam[2] / l] : [0, 1, 0]
    F.fwd = [gxFwd.x, gxFwd.y, gxFwd.z]
    F.up = [gxUp.x, gxUp.y, gxUp.z]
    // the side we turn toward once inside: where we already look, else north
    const fr = F.fwd[0] * F.x[0] + F.fwd[1] * F.x[1] + F.fwd[2] * F.x[2]
    let t = [F.fwd[0] - F.x[0] * fr, F.fwd[1] - F.x[1] * fr, F.fwd[2] - F.x[2] * fr]
    if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = [-F.x[0] * F.x[2], -F.x[1] * F.x[2], 1 - F.x[2] * F.x[2]]
    if (Math.hypot(t[0], t[1], t[2]) < 1e-3) t = [1, 0, 0]
    const tl = Math.hypot(t[0], t[1], t[2])
    F.t = [t[0] / tl, t[1] / tl, t[2] / tl]
    fallState = F
    fallLookReset()
    fallPhase = "falling"
    gxFallArmed = false
    fallHold = 0
    gxFallE = F.tl.E
    gxSel = gxIndex("Sagittarius A")
    gxTarget = [0, 0, 0]
    keysDown = ({})
  }
  // B: the hole; B again (on the way or there): down to 6 Rs and let go on
  // arrival; parked there: let go now
  function gxB() {
    const hole = gxIndex("Sagittarius A")
    if (gxParkedAtHole) fallBegin(gxDist / rsKpc)
    else if (gxSel === hole) { gxDistGoal = gxMinDist(); gxFallArmed = true }
    else gxFlyTo(hole)
  }
  // Esc: give up, fade out now and come back beside the Sun
  function fallAbort() { if (fallPhase === "falling") { fallPhase = "out"; fallHold = 0; fallHoldFor = 0.5 } }
  // the galaxy view's home pose, placed instantly (behind the black)
  function fallHome() {
    fallState = null
    fallLookReset()
    gxFallE = 0
    fallInside = false
    gxFlyTo(-1)
    const sp = sunPosAt(gxMyr)
    gxTarget = sp.slice(); gxFree = sp.slice()
    gxDist = gxDistGoal
    gxYaw = gxYawTarget; gxPitch = gxPitchTarget
    gxPrevCam = null; gxSpeed = 0   // an 8 kpc jump is not a speed
    gxCamJumped = true
    fallHoldFor = 2
  }
  function fallReset() {
    if (fallState) fallHome()
    fallLookReset()
    fallPhase = ""
    mix.fallFade.set(0); fallFade = 0
    fallHold = 0
  }
  function gxFlyTo(i) {
    if (fallState) return   // below the horizon, or on the way: nothing steers
    gxFallArmed = false
    gxView = -1
    touchLabels()
    if (i >= 0 && photoOf(i)) {
      // come in from Earth's side, as the photo was taken, framed to fill the view
      const P = hotspotPos(i), Sn = sunPosAt(gxMyr)
      const o = [Sn[0] - P[0], Sn[1] - P[1], Sn[2] - P[2]]
      const ol = Math.hypot(o[0], o[1], o[2])
      gxYawTarget = Math.atan2(o[0], o[1]) + Math.round((gxYawTarget - Math.atan2(o[0], o[1])) / (2 * Math.PI)) * 2 * Math.PI
      gxPitchTarget = Math.max(-1.45, Math.min(1.45, Math.asin(o[2] / ol)))
      gxSel = i
      gxDistGoal = Math.max(photoWidthKpc(i) / 0.85, gxMinDist())
      return
    }
    gxSel = i
    gxDistGoal = gxViewDist(i)
    if (i === -1) {
      // home: inside the disk just behind the Sun, looking toward the Centre,
      // the way we see our own Galaxy: a band of light across the sky with
      // the bulge glowing through the dust lanes
      gxYawTarget = sunOmega * gxMyr + Math.round((gxYawTarget - sunOmega * gxMyr) / (2 * Math.PI)) * 2 * Math.PI
      gxPitchTarget = 0.05
    }
  }
  // entered the Milky Way from the solar system: stepping back returns there
  property bool gxFromSystem: false
  function enterGalaxy() {
    if (!emptyWorkspace) return
    fallReset()
    gxFallArmed = false
    gxView = -1
    touchLabels()
    gxFromSystem = explore === "system"
    explore = "galaxy"
    gxMyr = 0
    gxRateIndex = 0
    gxSel = -1
    gxTarget = sunPosAt(0)
    gxDist = 0.0008
    gxDistGoal = 34
    gxYaw = gxYawTarget = 0.35
    gxPitch = 0.25
    gxPitchTarget = 1.0
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
    if (jump) { skyL = l; skyB = v.b; skyVfov = 46 }
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
  onChasingChanged: { mix.chase.g = chasing ? 1 : 0; setLimits() }
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

  // key hints shown under the HUD readouts, per mode
  readonly property var controlHints: explore === "flight" ? [
      ["W / S", "thrust forward / back"],
      ["A / D", "strafe left / right"],
      ["R / F", "up / down"],
      ["H", "hide / show the HUD"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ] : explore === "sky" ? [
      ["1 - 7  /  TAB", "the named views"],
      ["DRAG / ARROWS", "look around (WASD too)"],
      ["SCROLL / Q E", "zoom"],
      ["L", labelsOn ? "labels off" : "labels on (they fade after " + Lb.HOLD_S + " s)"],
      ["H", "hide / show the HUD"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ] : explore === "galaxy" && fallState ? [
      ["", fallInside ? "below the horizon there is no way out" : "falling: nothing steers now"],
      ["DRAG / ARROWS", "look around: you cannot steer"],
      ["H", "hide / show the HUD"],
      fallPhase === "falling" ? ["ESC / RIGHT-CLICK", "give up: fade back to the Sun"] : ["", "back beside the Sun in a moment"]
    ] : explore === "galaxy" ? [
      ["TAB", "next place (shift: previous)"],
      ["0", "back to the Sun (scroll in: the solar system)"],
      gxParkedAtHole ? ["B / SCROLL IN", gxFallArmed ? "letting go in a moment (or now: B)" : "let go: fall into the black hole"]
      : gxFallArmed ? ["SCROLL OUT / Q", "on the way down: you fall on arrival (scroll out to stay)"]
      : gxSel >= 0 && place(gxSel).kind === "blackhole" ? ["B", "down to 6 radii and let go (or scroll in, and B there)"]
      : ["B", "the black hole at the centre"],
      ["V", "the Milky Way from Andromeda"],
      ["CLICK", "fly to a place (a dwarf galaxy too: hover to find them)"],
      ["DRAG / ARROWS", "orbit the camera"],
      ["SCROLL / Q E", "closer / farther"],
      ["WASD", "fly freely"],
      ["[  ]", "time-lapse: the Galaxy turns (" + gxRateNames[gxRateIndex].toLowerCase() + ")"],
      ["N", "back to now"],
      ["X", "the solar system"],
      ["L", labelsOn ? "labels off" : "labels on (they fade after " + Lb.HOLD_S + " s)"],
      ["H", "hide / show the HUD"],
      ["ESC / RIGHT-CLICK", gxFromSystem ? "back to the solar system" : "back to the universe"]
    ] : explore !== "system" ? [] : galactic ? [
      ["-  =", galSlow === 1 ? "slow the Sun to see the coils" : "slower / faster Sun (now 1/" + galSlow + ")"],
      ["I", root.guides ? "hide the trails" : "show 2-year trails (guide lines)"],
      ["V", root.galBack ? "back to the side view" : "look back from the Sun along its path"],
      ["DRAG / ARROWS", "swing / tilt the camera"],
      ["SCROLL / Q E", "camera distance"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
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
      ["H", "hide / show the HUD"],
      ["V / ESC / RIGHT-CLICK", "back to the system"]
    ] : [
      ["CLICK / 1-6", "pin a planet"],
      ["M", "pin the Moon"],
      ["TAB", "next planet"],
      ["0", "the sun"],
      ["V", follow >= 0 ? "chase view behind " + followName.toUpperCase() : "chase view (pin first)"],
      ["G", "galactic motion (paths through space)"],
      ["X", "fly out to the Milky Way"],
      ["I", root.guides ? "hide orbit lines" : "show orbit lines"],
      ["L", labelsOn ? "labels off" : "labels on (they fade after " + Lb.HOLD_S + " s)"],
      ["SCROLL / Q E", "zoom"],
      ["DRAG / WASD", "pan"],
      ["RIGHT-DRAG", "orbit the camera"],
      ["ARROWS", "orbit / tilt the camera"],
      ["O", "auto orbit"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
      ["ESC / RIGHT-CLICK", "back to the universe"]
    ]

  // pointer over the solar system in the universe view, eased 0..1
  property bool hoverSystem: false
  property real sysHover: 0
  property vector2d sunScreen: Qt.vector2d(-0.64, 0.06)
  property real sys: 0 // 0 universe view .. 1 system view, for the overlays' opacity
  property int follow: 0 // -1 free camera, 0 sun, 1..6 planets, 7 the Moon
  readonly property string followName: follow === 7 ? "Moon" : follow > 0 ? planetInfo[follow - 1].name : follow === 0 ? "Sun" : ""
  onFollowChanged: {
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
  // Labels never sit on top of each other. Planet names give way to the
  // pinned body, then to the outer planets (the inner ones crowd together when
  // zoomed out); marker labels move down a row until they are clear.
  function labelBox(x, y, text, px) {
    return { x: x, y: y, w: text.length * (px * 0.62 + 2) + 6, h: px * 1.5 }
  }
  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  }
  function markerWanted(kind, w, h) {
    if (!root.liveBackground || root.sys < 0.5 || root.galMix > 0.5) return false
    const pr = markerProj(kind, w, h)
    const m = 70
    const off = pr.x < m || pr.x > w - m || pr.y < m || pr.y > h - m
    const inChase = chaseMix > 0.5
    if (kind === "moon") return follow !== 7 || inChase ? (off || pr.r < 10) : off
    if (kind === "earth") return follow !== 3 && (inChase ? (off || pr.r < 10) : off)
    return inChase && (off || pr.r < 14) // sun
  }
  // y of a marker's label: below its body, pushed down past earlier labels
  function markerLabelY(kind, w, h) {
    const px = Math.round(h * 0.0085)
    const m = 70
    const placed = []
    for (const k of ["sun", "earth", "moon"]) {
      if (!markerWanted(k, w, h)) { if (k === kind) return 0; continue }
      const pr = markerProj(k, w, h)
      const cx = Math.max(m, Math.min(w - m, pr.x)), cy = Math.max(m, Math.min(h - m, pr.y))
      const up = cy > h - m - 1
      const text = markerLabel(k)
      const b = labelBox(Math.min(cx + 16, w - text.length * (px * 0.62 + 2) - 8), cy - px * 0.75 + (up ? -18 : 18), text, px)
      let tries = 0
      while (tries++ < 6 && placed.some(o => boxesOverlap(o, b))) b.y += up ? -b.h : b.h
      placed.push(b)
      if (k === kind) return b.y
    }
    return 0
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
  // guide lines (orbit rings, the Sun vector, long galactic trails): L toggles
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
  // galactic or chase view, from the Milky Way to the solar system, else home
  function back() {
    if (fallPhase === "falling") { fallAbort(); return }   // never leaves the camera inside the hole
    if (fallPhase === "out") return
    if (galactic) toggleGalactic()
    else if (chasing) leaveChase()
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

  // HUD centre in shader coordinates: right third of the screen, drifting
  // slowly (OLED) and leaning toward the pointer.
  property vector2d hudCenter: Qt.vector2d(0.57, 0.02)

  function tick() {
    const now = Date.now()
    const dt = Math.min(0.1, (now - lastTick) / 1000)
    lastTick = now
    shaderTime = ((now - shaderEpoch) / 1000) % 600

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
    hudCenter = Qt.vector2d(
      0.57 + 0.06 * Math.sin(w * 2 * shaderTime) + view.x * 0.08,
      0.02 + 0.04 * Math.sin(w * 3 * shaderTime + 1.3) + view.y * 0.08)

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
      // the skip-box for the idle view: Saturn's whole orbit at the current
      // tilt, the bodies' sizes, the Sun's glow, turned by the screen spin,
      // as a box around the Sun on screen; computed each frame so tilting or
      // true scale never slices a planet
      const st = Math.sin(sysCam.pitch.x), ct = Math.cos(sysCam.pitch.x)
      const reach = dispA[5] * 1.06
      const pad = 3 * Math.max(...disp.map(b => b[3])) + sunR * 12 + 0.01
      const bx = reach + pad, by = reach * st + ct * moonOrbit + pad
      const sp = sysCam.project([0, 0, 0])
      sysBound = Qt.vector4d(sp.x, sp.y, (bx + 0.1 * by) / cb.h * 1.1, (by + 0.1 * bx) / cb.h * 1.1)
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
      skyL += (skyLTarget - skyL) * sk
      skyB += (skyBTarget - skyB) * sk
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
      // close to a named view and not being moved: settle exactly onto it
      const still = !key("left") && !key("right") && !key("up") && !key("down") && !key("q") && !key("e")
      const near = Math.abs(dl) < 0.5 && Math.abs(skyB - v.b) < 0.5 && Math.abs(skyVfov - 46) < 1.0
      if (near && still && !skyDragging) {
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
      if (inView && !fallState) {
        gxYawTarget += (key("right") - key("left")) * dt * 0.8
        gxPitchTarget = Math.max(-1.45, Math.min(1.45, gxPitchTarget + (key("up") - key("down")) * dt * 0.6))
      }
      if (inView) {
        const zk = key("e") - key("q")
        if (zk !== 0) gxDistGoal = Math.max(gxMinDist(), Math.min(2500, gxDistGoal * Math.pow(2.5, zk * dt)))
        if (zk > 0) gxFallArmed = false
      }
      const ek = Math.min(1, dt * 3)
      gxYaw += (gxYawTarget - gxYaw) * ek
      gxPitch += (gxPitchTarget - gxPitch) * ek
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
          if (gxSel !== -2) { gxFree = gxTarget.slice(); gxSel = -2 }
          gxView = -1
          const fh = Math.hypot(fwd.x, fwd.y) > 1e-3 ? [fwd.x / Math.hypot(fwd.x, fwd.y), fwd.y / Math.hypot(fwd.x, fwd.y)] : [up.x, up.y]
          const v = gxDist * 0.9 * dt
          gxFree = [gxFree[0] + (right.x * mv[0] + fh[0] * mv[1]) * v, gxFree[1] + (right.y * mv[0] + fh[1] * mv[1]) * v, gxFree[2]]
        }
      }
      // travel: the focus glides to its goal and the camera pulls back while
      // far from it, so long trips rise above the disk and come back down
      const goal = gxSel >= 0 ? hotspotPos(gxSel) : gxSel === -1 ? sunPosAt(gxMyr) : gxFree
      const tk = Math.min(1, dt * 1.6)
      gxTarget = gxTarget.map((v, j) => v + (goal[j] - v) * tk)
      const remain = Math.hypot(goal[0] - gxTarget[0], goal[1] - gxTarget[1], goal[2] - gxTarget[2])
      // twice the remaining trip keeps the destination within ~27 degrees of the centre: on screen
      const want = Math.max(gxDistGoal, remain * 2.0)
      gxDist = Math.exp(Math.log(gxDist) + (Math.log(want) - Math.log(gxDist)) * Math.min(1, dt * 1.6))
      let cam = [gxTarget[0] + off[0] * gxDist, gxTarget[1] + off[1] * gxDist, gxTarget[2] + off[2] * gxDist]
      // the fall: the horizon crossed in free flight starts it, judged on the
      // camera's path over this frame (far out, one frame's step is wider
      // than the hole); parked at the hole, B or a scroll in lets go (the key
      // and wheel handlers)
      {
        const parked = gxSel >= 0 && place(gxSel).kind === "blackhole" && gxDistGoal <= 6 * rsKpc * 1.001 && gxDist < 6.5 * rsKpc
        if (parked !== gxParkedAtHole) gxParkedAtHole = parked
        // asked on the way down: let go once settled at 6 Rs
        if (parked && gxFallArmed && !fallState && gxDist < 6.05 * rsKpc) fallBegin(gxDist / rsKpc)
        if (!fallState && inView) {
          const p0 = gxCamJumped ? cam : [gxCamPos.x, gxCamPos.y, gxCamPos.z]
          const d = [cam[0] - p0[0], cam[1] - p0[1], cam[2] - p0[2]]
          const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
          const t = dd > 0 ? Math.max(0, Math.min(1, -(p0[0] * d[0] + p0[1] * d[1] + p0[2] * d[2]) / dd)) : 1
          const q = [p0[0] + d[0] * t, p0[1] + d[1] * t, p0[2] + d[2] * t]   // the path's closest point to the hole
          const ql = Math.hypot(q[0], q[1], q[2])
          if (ql < rsKpc) fallBegin(ql / rsKpc, q)
        }
        gxCamJumped = false
      }
      mix.fallFade.g = fallPhase === "out" ? 1 : 0
      fallFade = mix.fallFade.step(dt)
      if (fallPhase === "out" && fallFade >= 0.98) {
        // black: hold, then back beside the Sun, and fade in
        fallHold += dt
        if (fallHold >= fallHoldFor) { fallHome(); fallPhase = "in" }
      } else if (fallPhase === "in" && fallFade <= 0.01) fallPhase = ""
      if (fallState) {
        // the camera rides the trajectory (lib/fall.js); the view turns from
        // the hole to the side over the approach (in log r), so at the
        // horizon the dark is below and the sky above; nothing else steers
        const F = fallState
        const o = Fall.step(F, dt)
        const r = Math.max(o.r, 0.03)
        fallR = r; fallLeft = o.left; fallRate = o.rate
        if ((r < 1) !== fallInside) fallInside = r < 1
        // the radius stops at 0.03 Rs, 0.14 s before the end, and the fade is
        // black 2.0 s after it starts: begin it so the camera is still moving
        if (fallPhase === "falling" && o.left < 2.2) { fallPhase = "out"; fallHold = 0; fallHoldFor = 2 }
        const chi = Math.PI / 2 * Math.min(1, Math.max(0, Math.log(F.tl.r0 / r) / Math.log(F.tl.r0)))
        const c = Math.cos(chi), sn = Math.sin(chi), k = Math.min(1, dt * 2.5)
        const gf = [-c * F.x[0] + sn * F.t[0], -c * F.x[1] + sn * F.t[1], -c * F.x[2] + sn * F.t[2]]
        const gu = [sn * F.x[0] + c * F.t[0], sn * F.x[1] + c * F.t[1], sn * F.x[2] + c * F.t[2]]
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
        cam = [F.x[0] * r * rsKpc, F.x[1] * r * rsKpc, F.x[2] * r * rsKpc]
        gxDist = r * rsKpc
        gxTarget = [0, 0, 0]
      }
      // only hand the shaders a new camera when it really moved: an unchanged
      // camera lets the galaxy volume skip redrawing (it is the costly pass)
      // (falling, the view turns every frame: always)
      const moved = !!fallState || Math.hypot(cam[0] - gxCamPos.x, cam[1] - gxCamPos.y, cam[2] - gxCamPos.z) > gxDist * 1e-5
                 || Math.abs(fwd.x - gxFwd.x) + Math.abs(fwd.y - gxFwd.y) + Math.abs(fwd.z - gxFwd.z) > 1e-6
      if (moved) gxCamPos = Qt.vector3d(cam[0], cam[1], cam[2])
      gxHoleNear = Math.hypot(cam[0], cam[1], cam[2]) < 1e-5
      if (gxHoleNear) gxCamRs = Qt.vector3d(cam[0] / rsKpc, cam[1] / rsKpc, cam[2] / rsKpc)
      if (moved) {
        if (fallState) {
          gxFwd = Qt.vector3d(fallState.lookFwd[0], fallState.lookFwd[1], fallState.lookFwd[2])
          gxUp = Qt.vector3d(fallState.lookUp[0], fallState.lookUp[1], fallState.lookUp[2])
          gxRight = gxFwd.crossProduct(gxUp)
          // while the look turns, the hole tracer gets the camera every
          // frame: at its 40 Hz the whole sky (all of it read from the
          // tracer when falling) would judder against the live edge
          if (holePass.near && (gxLookDragging || gxLookIdle < 0.1
              || Math.abs(gxLookYawTarget - gxLookYaw) + Math.abs(gxLookPitchTarget - gxLookPitch) > 1e-4)) {
            holePass.camPos = gxCamRs
            holePass.camFwd = gxFwd
            holePass.camRight = gxRight
            holePass.camUp = gxUp
          }
        } else {
          gxFwd = fwd
          gxRight = right
          gxUp = up
        }
      }
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
      // labels: projected, and laid out so none overlap (chosen place first,
      // then the Sun, then the biggest on screen). The hotspots always get
      // their marker; a dwarf galaxy only when chosen, big enough on screen
      // or under the pointer (dot), so the sky is not a field of dots
      const H = 1000, Wd = H * aspect, px = 8.5
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
      const order = pts.map((_, i) => i).filter(i => pts[i].dot)
        .sort((a, b) => (b === sel) - (a === sel) || (b === hov) - (a === hov) || (b === gxSunIndex) - (a === gxSunIndex) || pts[b].apparent - pts[a].apparent)
      const placed = []
      for (const i of order) {
        const name = i === gxSunIndex ? "SUN · YOU ARE HERE" : place(i).name
        const bx = labelBox((pts[i].x / aspect + 0.5) * Wd + 10, (pts[i].y + 0.5) * H - px * 0.75, name.toUpperCase(), px)
        if (placed.every(o => !boxesOverlap(o, bx))) { placed.push(bx); pts[i].show = true }
      }
      gxScreen = pts
    }

    // the label layer: up for Lb.HOLD_S after an interaction, then gone
    Lb.step(labelClock, dt)
    mix.labels.g = Lb.wanted(labelsOn, labelClock)
    labelsMix = mix.labels.step(dt)

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

    // labels and markers, projected once per tick through the same camera.
    // Planet names give way to the pinned body, then to the outer planets
    // (the inner ones crowd together when zoomed out).
    {
      const H = 1000, Wd = H * aspect, px = 8.5
      const pts = disp.map(b => { const pr = sysCam.project(b); return { x: pr.x, y: pr.y, r: b[3] * pr.scale, front: pr.front, show: false } })
      const order = []
      if (follow >= 1 && follow <= 6) order.push(follow - 1)
      for (let k = 5; k >= 0; k--) if (k !== follow - 1) order.push(k)
      const placed = []
      for (const k of order) {
        if (!pts[k].front) continue
        const bx = labelBox((pts[k].x / aspect + 0.5) * Wd + pts[k].r * H + 10, (pts[k].y + 0.5) * H - px * 0.75, planetInfo[k].name, px)
        if (placed.every(o => !boxesOverlap(o, bx))) { placed.push(bx); pts[k].show = true }
      }
      sysScreen = pts
      const mk = {}
      for (const [kind, P, R] of [["moon", moonD, moonD[3]], ["earth", disp[2], disp[2][3]], ["sun", [0, 0, 0], sunR]]) {
        const pr = sysCam.project(P)
        // behind the camera: pushed to the edge, mirrored
        const k = pr.front ? 1 : -1000
        mk[kind] = { x: pr.x * k, y: pr.y * k, r: pr.front ? R * pr.scale : 0, dist: Cam.len(Cam.sub(P, cb.C)) }
      }
      markerPts = mk
    }

    // JARVIS: beacons every frame, telemetry 5 times a second
    {
      const nb = [null, null, null, null]
      let rows = null
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
          rows = []
          if (at) {
            const rSun = Math.hypot(at[0], at[1], at[2])
            const rEarth = d(real[2])
            rows.push({ label: "TARGET", value: (follow === 7 ? "MOON" : follow === 0 ? "SUN" : planetInfo[follow - 1].name.toUpperCase()) + (chasing ? "  →  " + chaseTargetName.toUpperCase() : "") })
            if (follow !== 0) rows.push({ label: "FROM SUN", value: fmtAu(rSun) + "  ·  LIGHT " + fmtNum(rSun * 8.317, 1) + " MIN" })
            if (follow !== 3) rows.push({ label: "FROM EARTH", value: fmtAu(rEarth) + "  ·  LIGHT " + (rEarth * 8.317 < 1 ? fmtNum(rEarth * 499.0, 1) + " S" : fmtNum(rEarth * 8.317, 1) + " MIN") })
            if (follow >= 1 && follow <= 6) {
              const pl = planetInfo[follow - 1], a = orbits[follow - 1][3]
              const v = 29.7847 * Math.sqrt(Math.max(0, 2 / rSun - 1 / a))
              rows.push({ label: "ORBIT", value: fmtNum(v, 1) + " KM/S  ·  YEAR " + (a < 1.5 ? fmtNum(Math.pow(a, 1.5) * 365.25) + " D" : fmtNum(Math.pow(a, 1.5), 1) + " Y") })
              rows.push({ label: "DAY", value: fmtNum(Math.abs(pl.day) * 24, 1) + " H" + (pl.day < 0 ? "  ·  TURNS BACKWARD" : "") + "  ·  " + fmtNum(pl.km * 2) + " KM WIDE" })
            }
            if (follow === 3 || follow === 7) {
              // the Moon's phase: the Sun-Earth-Moon angle
              const s = [-real[2][0], -real[2][1], -real[2][2]]
              const c = (s[0] * mg[0] + s[1] * mg[1] + s[2] * mg[2]) / (Math.hypot(...s) * Math.hypot(...mg))
              rows.push({ label: "MOON", value: fmtNum((1 - c) / 2 * 100) + "% LIT  ·  " + fmtNum(moonDistanceKm) + " KM" })
            }
          } else rows.push({ label: "VIEW", value: "FREE  ·  PIN A BODY FOR ITS TELEMETRY" })
          rows.push({ label: "TIME", value: Qt.formatDateTime(new Date(simMs), "d MMM yyyy HH:mm").toUpperCase() + "  ·  " + simRateNames[simRateIndex] + (autoOrbit ? "  ·  AUTO ORBIT" : "") })
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
        // speed: how fast the camera moves, eased
        if (gxPrevCam) {
          const v = Math.hypot(cam[0] - gxPrevCam[0], cam[1] - gxPrevCam[1], cam[2] - gxPrevCam[2]) / Math.max(dt, 1e-3)
          gxSpeed += (v - gxSpeed) * Math.min(1, dt * 4)
        }
        gxPrevCam = cam
        if (refresh) {
          const h = vec(sp).map(x => -x)                     // camera from the Sun
          const hl = Math.max(len(h), 1e-12)
          const l = (Math.atan2(h[0], -h[1]) * 180 / Math.PI + 360) % 360
          const b = Math.asin(Math.max(-1, Math.min(1, h[2] / hl))) * 180 / Math.PI
          let near = -1, nd = 1e9
          for (let i = 0; i < hotspots.length; i++) { const dd = len(vec(hotspotPos(i))); if (dd < nd) { nd = dd; near = i } }
          const lyPerS = gxSpeed * ly
          rows = [
            { label: "HERE", value: fmtLy(hl * ly) + " FROM THE SUN  ·  l " + fmtNum(l, 1) + "°  b " + fmtNum(b, 1) + "°" },
            { label: "CENTRE", value: fmtLy(len(cam) * ly) + "  ·  " + (Math.abs(cam[2]) < 1 ? fmtNum(Math.abs(cam[2]) * ly) + " LY " + (cam[2] >= 0 ? "ABOVE" : "BELOW") + " THE DISK" : "OUTSIDE THE DISK") },
            { label: "SPEED", value: lyPerS < 0.01 ? "HOLDING" : fmtLy(lyPerS) + "/S  ·  " + (lyPerS * 31557600 >= 1e6 ? fmtNum(lyPerS * 31557600 / 1e6, 1) + " MILLION" : fmtNum(lyPerS * 31557600)) + " × LIGHT" },
            { label: "NEAREST", value: near >= 0 ? hotspots[near].name.toUpperCase() + "  ·  " + fmtLy(nd * ly) : "—" }
          ]
          if (gxSel >= 0) rows.splice(0, 0, { label: "TARGET", value: place(gxSel).name.toUpperCase() + "  ·  " + fmtLy(len(vec(hotspotPos(gxSel))) * ly) + " AWAY" })
          if (fallState) {
            // the fall: where we are in radii, and our own clock
            const left = fallLeft >= 60 ? fmtNum(Math.floor(fallLeft / 60)) + " MIN " + fmtNum(Math.floor(fallLeft % 60), 0) + " S" : fmtNum(fallLeft, 1) + " S"
            rows = [
              { label: "FALLING", value: fmtNum(fallR, 2) + " SCHWARZSCHILD RADII  ·  " + (fallR > 1 ? "OUTSIDE THE HORIZON" : "INSIDE THE HORIZON  ·  NO WAY OUT") },
              { label: "PROPER TIME", value: left + " TO THE SINGULARITY  ·  " + (fallRate > 1.05 ? "SHOWN " + fmtNum(fallRate) + "× FASTER" : "REAL TIME") }
            ]
          }
        }
      } else if (explore === "sky") {
        const R = [skyRight.x, skyRight.y, skyRight.z], U = [skyUp.x, skyUp.y, skyUp.z], F = [skyFwd.x, skyFwd.y, skyFwd.z]
        const sf = 0.5 / Math.tan(skyVfov * Math.PI / 360)
        nb[1] = beaconOf([0, -1, 0], R, U, F, "GALACTIC CENTRE", "26,000 LY", "#ffb070", sf)
        nb[2] = beaconOf([0, 0, 1], R, U, F, "GALACTIC NORTH", "", "#9fc3ff", sf)
        if (refresh) {
          const l = ((skyL % 360) + 360) % 360
          const eq = galToEq(l, skyB)
          rows = [
            { label: "POINTING", value: "l " + fmtNum(l, 1) + "°  b " + fmtNum(skyB, 1) + "°" },
            { label: "SKY", value: "RA " + fmtRa(eq[0]) + "  DEC " + (eq[1] >= 0 ? "+" : "") + fmtNum(eq[1], 1) + "°" },
            { label: "FIELD", value: fmtNum(skyVfov, 0) + "° TALL" + (skyStaticMix > 0.5 ? "  ·  " + skyViews[skyView].name : "") }
          ]
        }
      } else if (refresh) rows = []
      // beacons pointing nearly the same way stack their labels
      for (let i = 0; i < nb.length; i++) {
        if (!nb[i]) continue
        for (let j = 0; j < i; j++) if (nb[j] && Math.abs(Math.atan2(Math.sin(nb[i].ang - nb[j].ang), Math.cos(nb[i].ang - nb[j].ang))) < 0.22) nb[i].shift = Math.max(nb[i].shift, nb[j].shift + 1)
      }
      navBeacons = nb
      if (rows !== null) navRows = rows
    }

    mix.exposure.g = emptyWorkspace && explore === "universe" ? 1.9 : 1
    exposure = mix.exposure.step(dt)
  }

  // Live system stats for the HUD gauges, read every 2 s while it animates.
  property real cpu: 0
  property real gpu: 0
  property real mem: 0
  Behavior on cpu { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  Behavior on gpu { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  Behavior on mem { NumberAnimation { duration: 900; easing.type: Easing.OutCubic } }
  property var stats: ({ cpu: 0, cpuTemp: 0, gpu: 0, gpuWatts: 0, gpuTemp: 0, memUsed: 0, memTotal: 0 })
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
    if (g.length === 3 && !g.some(isNaN)) { s.gpu = g[0] / 100; s.gpuWatts = g[1]; s.gpuTemp = g[2] }
    if (lines[4] && !isNaN(Number(lines[4]))) s.cpuTemp = Number(lines[4]) / 1000
    stats = s
    cpu = s.cpu
    gpu = s.gpu
    mem = s.memTotal > 0 ? s.memUsed / s.memTotal : 0
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
    Color.loadColors(pendingColorsRaw)
    // Color.loadShell also refreshes Style so the type scale flips with the
    // background reveal instead of waiting for a separate reload path.
    Color.loadShell(pendingShellRaw)
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

    function toggleHud(): void {
      root.setHud(!root.hudOn)
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

    // a place by name prefix, the Sun, or a named viewpoint ("Milky Way from Andromeda")
    function fly(place: string): void {
      if (root.explore !== "galaxy") root.enterGalaxy()
      const v = root.gxViews.findIndex(w => w.name.toLowerCase().startsWith(place.toLowerCase()))
      if (v >= 0) root.gxGoView(v)
      else root.gxFlyTo(place === "sun" ? -1 : root.gxIndex(place))
    }

    // the label layer: on, it shows for a few seconds after each interaction
    function labels(on: bool): void {
      root.setLabels(on)
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

    // film mode: the scene without the HUD, hints, labels and markers
    function film(on: bool): void {
      root.film = on
      if (!on) root.setCaption("", "")
    }

    // a fading lower-third caption; caption "" "" clears it
    function caption(title: string, body: string): void {
      root.setCaption(title, body)
    }

    // for scripts: "<view> <fall phase or -> <radius in Rs>", e.g. "galaxy falling 1.84"
    function status(): string {
      return root.explore + " " + (root.fallPhase || "-") + " " + root.fallR.toFixed(2)
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
      // on this stack; a freshly created instance always animates.
      Loader {
        anchors.fill: parent
        active: root.liveBackground
        sourceComponent: Component {
          Item {
            // Soft layer (nebula, galaxies) at half size into a float texture:
            // a quarter of the pixels for the costliest noise, no banding.
            // It stays visible (hidden effects stop updating, see above) and
            // the opaque full-size pass below covers it.
            ShaderEffect {
              id: nebulaPass
              width: Math.ceil(panel.width / 2)
              height: Math.ceil(panel.height / 2)
              layer.enabled: true
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
            // Sgr A* up close: geodesic ray tracing at a third of the size, only near the hole
            ShaderEffect {
              id: holePass
              readonly property bool near: root.galaxyMix > 0 && root.gxHoleNear
              width: near ? Math.ceil(panel.width / 3) : 4
              height: near ? Math.ceil(panel.height / 3) : 4
              layer.enabled: true
              layer.format: ShaderEffectSource.RGBA16F
              layer.smooth: true
              fragmentShader: Qt.resolvedUrl("hole.qsb")
              property vector2d resolution: Qt.vector2d(width, height)
              property real shown: near ? 1 : 0
              // camera and gas clock are copied in at 40 Hz (holeClock below):
              // the layer only re-renders when they change, and the slow flow
              // does not need the display's 165 Hz
              property vector3d camPos: Qt.vector3d(0, 1e6, 0)
              property vector3d camFwd: Qt.vector3d(0, -1, 0)
              property vector3d camRight: Qt.vector3d(1, 0, 0)
              property vector3d camUp: Qt.vector3d(0, 0, 1)
              property real aspect: panel.width / Math.max(1, panel.height)
              // spin axis 30 degrees off our line of sight, the gas turning
              // clockwise on the sky (EHT 2022; GRAVITY flare loops)
              property vector3d spinAxis: Qt.vector3d(0, -0.8660, 0.5)
              // gas motion 30x faster than real (1 Rs/c = 42 s): an orbit at
              // the innermost stable radius takes ~1 minute instead of ~30
              property real flowTime: 0
              // bound, not clocked: universe.frag reads the fall's angles the
              // very frame it starts, so this layer must switch in that frame too
              property real fallE: root.gxFallE
            }
            Timer {
              id: holeClock
              interval: 25
              repeat: true
              running: holePass.near && root.animate
              triggeredOnStart: true
              onTriggered: {
                holePass.camPos = root.gxCamRs
                holePass.camFwd = root.gxFwd
                holePass.camRight = root.gxRight
                holePass.camUp = root.gxUp
                holePass.flowTime = root.shaderTime * 30 / 42.3
              }
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

            ShaderEffect {
              anchors.fill: parent
              blending: false
              fragmentShader: Qt.resolvedUrl("universe.qsb")
              property var nebulaTex: nebulaPass
              property real time: root.shaderTime
              property vector2d resolution: Qt.vector2d(panel.width, panel.height)
              property color accent: Color.accent
              property real hudLevel: root.hudLevel
              property vector2d view: root.view
              property vector2d hudCenter: root.hudCenter
              property real flight: root.flight
              property real cpu: root.cpu
              property real gpu: root.gpu
              property real mem: root.mem
              property real secs: (root.now.getSeconds() + root.now.getMilliseconds() / 1000) / 60
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

            // HUD readouts in the shell font: the time inside the rings and the
            // gauge values beside them, moving with the HUD centre.
            Item {
              id: readout
              readonly property real hudOpacity: Math.min(0.75, root.hudLevel * 1.8)
              readonly property real unit: panel.height
              readonly property real cx: (root.hudCenter.x * panel.height / panel.width + 0.5) * panel.width
              readonly property real cy: (root.hudCenter.y + 0.5) * panel.height
              readonly property real rowSize: Math.round(unit * 0.0105)

              Column {
                visible: root.hudLevel > 0
                opacity: readout.hudOpacity
                x: readout.cx - width / 2
                y: readout.cy - height / 2
                spacing: 0
                Text {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: Qt.formatTime(root.now, "HH:mm")
                  color: Color.foreground
                  font.family: Style.resolvedFontFamily
                  font.pixelSize: Math.round(readout.unit * 0.026)
                  font.weight: Font.Light
                }
                Text {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: Qt.formatDate(root.now, "ddd d MMM").toUpperCase()
                  color: Color.accent
                  font.family: Style.resolvedFontFamily
                  font.pixelSize: Math.round(readout.unit * 0.0085)
                  font.letterSpacing: 2
                }
              }

              // beacons on the ring: where the Sun, Earth, the target and the
              // Galactic Centre lie from here (hollow when behind you)
              Repeater {
                model: 4
                Item {
                  id: beacon
                  required property int index
                  readonly property var b: root.navBeacons[index]
                  readonly property real ringR: readout.unit * 0.248
                  visible: !!b && root.hudLevel > 0 && root.explore !== "universe"
                  opacity: readout.hudOpacity * (b && b.behind ? 0.55 : 1)
                  x: readout.cx + Math.cos(b ? b.ang : 0) * ringR
                  y: readout.cy + Math.sin(b ? b.ang : 0) * ringR
                  Text {
                    x: -width / 2; y: -height / 2
                    text: beacon.b && beacon.b.behind ? "△" : "▲"
                    rotation: (beacon.b ? beacon.b.ang : 0) * 180 / Math.PI + 90
                    color: beacon.b ? beacon.b.color : "white"
                    font.pixelSize: Math.round(readout.unit * 0.009)
                  }
                  Text {
                    // left half: label outside the ring; right half: inside, clear of the readout column
                    readonly property bool onLeft: true
                    x: onLeft ? -width - readout.unit * 0.01 : readout.unit * 0.01
                    y: -height / 2 + (beacon.b ? beacon.b.shift : 0) * height * 1.3
                    text: beacon.b ? beacon.b.name + (beacon.b.dist ? "  " + beacon.b.dist : "") : ""
                    color: beacon.b ? beacon.b.color : "white"
                    font.family: Style.resolvedFontFamily
                    font.pixelSize: Math.round(readout.unit * 0.0072)
                    font.letterSpacing: 1.5
                  }
                }
              }

              Column {
                visible: root.hudLevel > 0
                opacity: readout.hudOpacity
                id: statsColumn
                x: readout.cx + readout.unit * 0.255
                y: readout.cy - height / 2
                spacing: Math.round(readout.unit * 0.004)

                Repeater {
                  model: root.explore !== "universe" && root.explore !== "flight" && root.navRows.length > 0
                    ? [{ label: "SYS", color: Color.accent,
                         value: "CPU " + Math.round(root.stats.cpu * 100) + "%  ·  GPU " + Math.round(root.stats.gpu * 100) + "% " + Math.round(root.stats.gpuWatts) + " W  ·  MEM " + root.stats.memUsed.toFixed(1) + " GB" }]
                      .concat(root.navRows.map(r => ({ label: r.label, color: root.hudHighlight, value: r.value })))
                    : [
                    { label: "CPU", color: Color.accent,
                      value: Math.round(root.stats.cpu * 100) + "%  " + Math.round(root.stats.cpuTemp) + "°C" },
                    { label: "GPU", color: root.hudHighlight,
                      value: Math.round(root.stats.gpu * 100) + "%  " + Math.round(root.stats.gpuWatts) + " W  " + Math.round(root.stats.gpuTemp) + "°C" },
                    { label: "MEM", color: Color.accent,
                      value: root.stats.memUsed.toFixed(1) + " / " + root.stats.memTotal.toFixed(0) + " GB" },
                    { label: "NAV", color: root.hudHighlight, value: "FLIGHT", hidden: !root.navigating },
                    { label: "SYS", color: root.hudHighlight,
                      value: (root.chasing ? (root.chaseLocked ? "LOCKED ON " + root.chaseTargetName.toUpperCase() + " VECTOR  " : "CHASE  ") : "")
                        + (root.follow > 0 ? "PINNED " + root.followName.toUpperCase() + (root.chasing ? " → " + root.chaseTargetName.toUpperCase() : "") + "  "
                           : root.follow === 0 ? "SUN  " : "FREE  ")
                        + Qt.formatDateTime(new Date(root.simMs), "d MMM yyyy HH:mm").toUpperCase() + "  "
                        + root.simRateNames[root.simRateIndex] + (root.autoOrbit ? "  AUTO ORBIT" : ""),
                      hidden: root.explore !== "system" }
                  ]
                  Row {
                    required property var modelData
                    visible: !modelData.hidden
                    spacing: Math.round(readout.unit * 0.008)
                    Text {
                      text: modelData.label
                      color: modelData.color
                      font.family: Style.resolvedFontFamily
                      font.pixelSize: readout.rowSize
                      font.letterSpacing: 2
                    }
                    Text {
                      text: modelData.value
                      color: Color.foreground
                      font.family: Style.resolvedFontFamily
                      font.pixelSize: readout.rowSize
                    }
                  }
                }
              }

              // what each key does in the current mode, one per row: the
              // visor's edge (bottom left), clear of the view, gone with the HUD
              Column {
                visible: root.hudLevel > 0
                opacity: readout.hudOpacity * 0.9
                x: Math.round(readout.unit * 0.03)
                y: panel.height - height - Math.round(readout.unit * 0.03)
                spacing: Math.round(readout.unit * 0.003)

                Repeater {
                  model: root.controlHints
                  Row {
                    required property var modelData
                    Text {
                      width: readout.rowSize * 11
                      text: modelData[0]
                      color: Color.accent
                      font.family: Style.resolvedFontFamily
                      font.pixelSize: Math.round(readout.rowSize * 0.85)
                      font.letterSpacing: 1
                    }
                    Text {
                      text: modelData[1]
                      color: Color.foreground
                      font.family: Style.resolvedFontFamily
                      font.pixelSize: Math.round(readout.rowSize * 0.85)
                    }
                  }
                }
              }
            }
          }
        }
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
      Text {
        visible: root.liveBackground && root.sysHover > 0.01
        opacity: root.sysHover * 0.8 * root.unclutter
        x: (root.sunScreen.x / root.aspect + 0.5) * panel.width - width / 2
        y: (root.sunScreen.y + 0.5) * panel.height + panel.height * 0.05
        text: "SOLAR SYSTEM  ·  CLICK TO EXPLORE"
        color: Color.accent
        font.family: Style.resolvedFontFamily
        font.pixelSize: Math.round(panel.height * 0.0085)
        font.letterSpacing: 3
      }

      // Highlights for the Moon, Earth and the Sun: a bracket around the body
      // when it is tiny on screen, or a dot on the screen edge pointing at it
      // when it is off screen, with its name and distance. The Moon is marked in
      // the system and chase views; Earth and the Sun in the chase view (and
      // Earth when off screen in the system view).
      Repeater {
       model: ["moon", "earth", "sun"]
       Item {
        id: marker
        required property string modelData
        readonly property string kind: modelData
        readonly property color tint: kind === "moon" ? Color.accent : kind === "earth" ? "#6ab7ff" : "#ffd27a"
        readonly property var proj: root.markerProj(kind, panel.width, panel.height)
        readonly property real margin: 70
        readonly property bool offscreen: proj.x < margin || proj.x > panel.width - margin
                                          || proj.y < margin || proj.y > panel.height - margin
        readonly property real cx: Math.max(margin, Math.min(panel.width - margin, proj.x))
        readonly property real cy: Math.max(margin, Math.min(panel.height - margin, proj.y))
        readonly property bool inChase: root.chaseMix > 0.5
        readonly property bool wanted: root.markerWanted(kind, panel.width, panel.height)
        visible: wanted && root.unclutter > 0
        opacity: Math.min(1, (root.sys - 0.5) * 2) * 0.85 * root.unclutter

        Rectangle { // off screen only: a small dot at the edge (no box around bodies in view)
          visible: marker.offscreen
          x: marker.cx - width / 2
          y: marker.cy - height / 2
          width: 10
          height: width
          radius: width / 2
          color: marker.tint
        }
        Text { // arrow toward the body when it is off screen
          visible: marker.offscreen
          x: marker.cx - width / 2
          y: marker.cy - height / 2
          rotation: Math.atan2(marker.proj.y - marker.cy, marker.proj.x - marker.cx) * 180 / Math.PI
          transform: Translate { x: 14 }
          text: "➤"
          color: marker.tint
          font.pixelSize: Math.round(panel.height * 0.01)
        }
        Text {
          x: Math.min(marker.cx + 16, panel.width - width - 8)
          y: root.markerLabelY(marker.kind, panel.width, panel.height)
          text: root.markerLabel(marker.kind)
          color: Qt.alpha(Color.foreground, 0.6)
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.0085)
          font.letterSpacing: 2
        }
      }

      }

      // ---- galactic view: real paths through space, drawn from the tick's points ----
      Item {
        id: galOverlay
        width: panel.width
        height: panel.height
        visible: root.liveBackground && root.galMix > 0.01
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
                    // only with guide lines on (L): space has no trails; without them the
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
            opacity: root.unclutter
            color: Qt.alpha("#ffd27a", 0.8)
            font.pixelSize: Math.round(panel.height * 0.02)
          }
          Text {
            readonly property real reach: panel.height * 0.06
            x: root.galHeading.x * reach + (root.galHeading.x >= 0 ? 18 : -width - 18)
            y: root.galHeading.y * reach - height / 2
            text: "249 KM/S  ·  CYGNUS"
            opacity: root.unclutter
            color: Qt.alpha("#ffd27a", 0.7)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
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
            Text {
              x: body.d / 2 + 10
              y: -height / 2
              text: root.planetInfo[body.index].name.toUpperCase()
              opacity: root.unclutter
              color: Qt.alpha(Color.foreground, 0.55)
              font.family: Style.resolvedFontFamily
              font.pixelSize: Math.round(panel.height * 0.0075)
              font.letterSpacing: 2
            }
          }
        }

        // caption, bottom centre, in the HUD's voice
        Column {
          opacity: root.unclutter
          anchors.horizontalCenter: parent.horizontalCenter
          y: Math.round(panel.height * 0.86)
          spacing: Math.round(panel.height * 0.004)
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "GALACTIC FRAME"
            color: Color.accent
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.009)
            font.letterSpacing: 6
          }
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "THE SUN CARRIES THE PLANETS AT 249 KM/S  ·  THEIR PLANE TILTED 61° TO THE PATH"
            color: Qt.alpha(Color.foreground, 0.65)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
          }
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: (root.galSlow === 1 ? "TRUE SPEED" : "SUN SLOWED TO 1/" + root.galSlow + "  ·  EXAGGERATED")
                  + (root.guides ? "  ·  TRAILS " + root.galTrailYears + " YEARS" : "  ·  L SHOWS THE PATHS") + "  ·  TRUE SIZES: THE PLANETS ARE POINTS"
            color: root.galSlow === 1 ? Qt.alpha(Color.foreground, 0.45) : Qt.alpha("#ffd27a", 0.8)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
          }
        }
      }

      // ---- Sky mode caption ----
      Column {
        visible: root.liveBackground && root.skyMix > 0.01 && root.unclutter > 0
        opacity: root.skyMix * root.unclutter
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.round(panel.height * 0.90)
        spacing: Math.round(panel.height * 0.004)
        readonly property var v: root.skyViews[root.skyView]
        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          text: (root.skyStaticMix > 0.5 ? parent.v.name : "THE SKY FROM EARTH") + "  ·  l " + ((root.skyL % 360 + 360) % 360).toFixed(1) + "°  b " + root.skyB.toFixed(1) + "°  ·  " + root.skyVfov.toFixed(0) + "° FIELD"
          color: Color.accent
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.009)
          font.letterSpacing: 4
        }
        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          text: (root.skyStaticMix > 0.5 ? parent.v.note + "  ·  " : "") + "NASA SVS DEEP STAR MAPS 2020  ·  ESA/GAIA/DPAC"
          color: Qt.alpha(Color.foreground, 0.45)
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.0075)
          font.letterSpacing: 2
        }
      }

      // ---- Milky Way view: place markers, the chosen place's card, the clock ----
      Item {
        id: gxOverlay
        width: panel.width
        height: panel.height
        visible: root.liveBackground && root.galaxyMix > 0.01 && root.unclutter > 0
        opacity: root.galaxyMix * (1 - root.fallFade) * root.unclutter

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
            visible: pt.dot && root.labelsMix > 0.01
            opacity: root.labelsMix
            x: (pt.x / root.aspect + 0.5) * gxOverlay.width
            y: (pt.y + 0.5) * gxOverlay.height
            Rectangle {
              readonly property real d: mark.chosen ? 9 : mark.dwarf ? 3.5 : 5
              x: -d / 2; y: -d / 2; width: d; height: d; radius: d / 2
              color: mark.tint
              opacity: mark.chosen ? 0.9 : mark.dwarf ? 0.45 : 0.6
            }
            Text {
              visible: mark.pt.show
              x: 10
              y: -height / 2
              text: (mark.isSun ? "SUN  ·  YOU ARE HERE" : mark.h.name.toUpperCase())
              color: mark.chosen ? root.hudHighlight : Qt.alpha(Color.foreground, mark.isSun ? 0.85 : 0.55)
              font.family: Style.resolvedFontFamily
              font.pixelSize: Math.round(panel.height * 0.0085)
              font.letterSpacing: 2
            }
          }
        }

        // the chosen place: what it is, how far, how big, and how old its light is
        Column {
          x: Math.round(panel.width * 0.03)
          y: Math.round(panel.height * 0.80)
          spacing: Math.round(panel.height * 0.005)
          width: Math.round(panel.width * 0.3)
          readonly property var h: root.gxSel >= 0 ? root.place(root.gxSel) : null
          readonly property var vw: root.gxView >= 0 ? root.gxViews[root.gxView] : null   // a named viewpoint
          visible: root.gxSel !== -2 || !!vw
          Text {
            text: parent.h ? parent.h.name.toUpperCase() : parent.vw ? parent.vw.name.toUpperCase() : "THE SUN  ·  YOU ARE HERE"
            color: Color.accent
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.011)
            font.letterSpacing: 4
          }
          Text {
            text: parent.h ? parent.h.label.toUpperCase() : parent.vw ? parent.vw.label
                           : "26,600 LY FROM THE GALACTIC CENTRE  ·  ONE ORBIT EVERY ~203 MILLION YEARS AT 249 KM/S"
            color: Qt.alpha(Color.foreground, 0.6)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
          }
          Text {
            visible: !!parent.h
            text: parent.h && parent.h.kind === "blackhole" && root.fallPhase !== ""
                  ? "falling  ·  " + root.fallR.toFixed(2) + " Schwarzschild radii from the centre  ·  the longest anyone lasts inside: π GM/c³ = 64 s, ~29 s in free fall"
                  : parent.h && parent.h.kind === "blackhole" && root.gxDist < 2e-6
                  ? Math.round(root.gxDist / root.rsKpc) + " Schwarzschild radii from it (" + (root.gxDist * 2.0626e8).toFixed(1) + " AU)  ·  event horizon "
                    + (2 * root.rsKpc * 2.0626e8).toFixed(2) + " AU across"
                  : parent.h ? root.lightYears(parent.h.dpc) + " away  ·  " + root.sizeText(parent.h.size) + " across" : ""
            color: Color.foreground
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0085)
          }
          Text {
            width: parent.width
            wrapMode: Text.WordWrap
            text: parent.h ? (parent.h.kind === "blackhole" && root.fallPhase !== ""
                               ? "Letting go from 6 radii: free fall, the way down shown 45 times faster, the inside at the true rate. Nothing is felt crossing the horizon of a hole this large, but below it every direction leads to the centre. The outside sky squeezes into a thin bright band, blueshifted, with the dark filling the half of the sky below; straight overhead, the last of it reddens and goes out."
                               : parent.h.kind === "blackhole"
                               ? parent.h.blurb + "  Visible light never gets out to us through the dust; you see the crowded star cluster around it. Its shadow was imaged in radio by the Event Horizon Telescope in 2022."
                               : parent.h.blurb) + (parent.h.dpc * 3.26156 >= 10 ? "  The light you see left it " + root.lightYears(parent.h.dpc).replace(" ly", " years") + " ago." : "")
                           : parent.vw ? parent.vw.blurb
                           : "The Sun circles Sagittarius A* with everything around it, rising and sinking through the disk as it goes. Press [ ] to watch."
            color: Qt.alpha(Color.foreground, 0.7)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0085)
          }
        }

        Column {
          anchors.horizontalCenter: parent.horizontalCenter
          y: Math.round(panel.height * 0.90)
          spacing: Math.round(panel.height * 0.004)
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "MILKY WAY  ·  ABOUT 100,000 LY ACROSS  ·  TRUE SCALE"
            color: Color.accent
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.009)
            font.letterSpacing: 6
          }
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: Math.abs(root.gxMyr) < 0.0005 && root.gxRateIndex === 0 ? "NOW  ·  [ ] TO WATCH IT TURN"
                  : (root.gxMyr >= 0 ? "+" : "") + root.gxMyr.toFixed(root.gxMyr < 10 ? 2 : 1) + " MILLION YEARS  ·  " + root.gxRateNames[root.gxRateIndex]
                    + "  ·  " + (root.gxMyr * root.sunOmega * 180 / Math.PI % 360).toFixed(0) + "° AROUND THE CENTRE  ·  SIMPLIFIED: THE DISK TURNS AS ONE"
            color: root.gxRateIndex > 0 ? Qt.alpha("#ffd27a", 0.8) : Qt.alpha(Color.foreground, 0.45)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
          }
        }
      }

      // planet names in the system view, beside each planet
      Repeater {
        model: root.planetInfo
        Text {
          required property var modelData
          required property int index
          readonly property var pt: root.sysScreen[index] || ({ x: 0, y: 0, r: 0, show: false })
          visible: root.liveBackground && root.sys > 0.5 && root.chaseMix < 0.02 && root.galMix < 0.5 && pt.show && root.labelsMix > 0.01
          opacity: (root.sys - 0.5) * 1.4 * (1 - root.chaseMix) * root.unclutter * root.labelsMix
          x: (pt.x / root.aspect + 0.5) * panel.width + pt.r * panel.height + 10
          y: (pt.y + 0.5) * panel.height - height / 2
          text: modelData.name.toUpperCase()
          color: root.follow === index + 1 ? root.hudHighlight : Color.foreground
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.0085)
          font.letterSpacing: 2
        }
      }

      // film caption (IPC `caption <title> <body>`), lower third: a spaced
      // title over a dim line or two. A new caption waits for the old one to
      // fade out; nothing on it is bright, and none of it stays for long.
      Column {
        id: filmCaption
        property string title: ""
        property string body: ""
        property string nextTitle: ""
        property string nextBody: ""
        property int outFor: 0
        function show(t, b) {
          nextTitle = t; nextBody = b
          outFor = opacity > 0.01 ? Math.round(1800 * opacity) : 0
          captionSwap.restart()   // durations and targets are read at the start: set them first
        }
        visible: root.liveBackground && opacity > 0
        opacity: 0
        width: Math.round(panel.width * 0.56)
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.round(panel.height * 0.72)
        spacing: Math.round(panel.height * 0.008)
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          visible: text !== ""
          text: filmCaption.title.toUpperCase()
          color: Qt.alpha(Color.foreground, 0.7)
          font.family: Style.resolvedFontFamily
          // sized to read on a phone or a 1080p player, not just on the desk
          font.pixelSize: Math.round(panel.height * 0.026)
          font.letterSpacing: Math.round(panel.height * 0.007)
        }
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          wrapMode: Text.WordWrap
          lineHeight: 1.25
          visible: text !== ""
          text: filmCaption.body
          color: Qt.alpha(Color.foreground, 0.55)
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.0185)
          font.letterSpacing: 1
        }
        Connections {
          target: root
          function onCaptionSerialChanged() { filmCaption.show(root.captionTitle, root.captionBody) }
        }
        SequentialAnimation {
          id: captionSwap
          NumberAnimation { target: filmCaption; property: "opacity"; to: 0; duration: filmCaption.outFor; easing.type: Easing.InOutSine }
          ScriptAction { script: { filmCaption.title = filmCaption.nextTitle; filmCaption.body = filmCaption.nextBody } }
          PauseAnimation { duration: 400 }
          NumberAnimation { target: filmCaption; property: "opacity"; to: filmCaption.nextTitle || filmCaption.nextBody ? 1 : 0; duration: 2600; easing.type: Easing.InOutSine }
        }
      }

      Item {
        focus: root.explore !== "universe"
        Keys.onPressed: function(event) {
          root.touchLabels()
          if (event.key === Qt.Key_Escape) {
            root.back()
            event.accepted = true
            return
          }
          const k = event.text.toLowerCase()
          if (k === "h") { root.setHud(!root.hudOn); event.accepted = true; return }
          if (k === "l") { root.setLabels(!root.labelsOn); event.accepted = true; return }
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
            const n = root.hotspots.length
            if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
              const cur = root.gxSel < 0 ? (event.key === Qt.Key_Backtab ? 0 : -1) : root.gxSel
              root.gxFlyTo((cur + (event.key === Qt.Key_Backtab ? n - 1 : 1)) % n)
              event.accepted = true
              return
            }
            if (k === "0") { root.gxFlyTo(-1); event.accepted = true; return }
            if (k === "b") { root.gxB(); event.accepted = true; return }
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
        property point pressAt: Qt.point(0, 0)
        property point lastAt: Qt.point(0, 0)
        property real lastT: 0
        property bool dragged: false
        property bool orbiting: false
        onPressed: function(mouse) {
          root.touchLabels()
          pressAt = Qt.point(mouse.x, mouse.y)
          lastAt = pressAt
          lastT = Date.now() / 1000
          dragged = false
        }
        onPositionChanged: function(mouse) {
          if (root.explore !== "universe") root.touchLabels()
          if (root.explore === "galaxy" && !pressed) {
            // hovering: the tick finds the place under the pointer (gxHover)
            const pt = root.toP(mouse.x, mouse.y, width, height)
            root.gxPointer = [pt[0], pt[1], 1 / height]
          } else if (root.explore !== "galaxy" && root.gxPointer) root.gxPointer = null
          if (root.explore === "sky" && pressed) {
            root.skyDragging = true
            if (Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            // drag the sky: it follows the pointer
            const degPerPx = root.skyVfov / height
            root.skyLTarget += (mouse.x - lastAt.x) * degPerPx
            root.skyBTarget = Math.max(-89, Math.min(89, root.skyBTarget + (mouse.y - lastAt.y) * degPerPx))
            root.skyL = root.skyLTarget
            root.skyB = root.skyBTarget
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.explore === "galaxy" && pressed) {
            if (Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            // falling: look around instead, the view following the drag as
            // the orbit does (right looks right, down looks down)
            if (root.fallState) {
              root.gxLookDragging = true
              root.fallLookBy((mouse.x - lastAt.x) * 0.005, -(mouse.y - lastAt.y) * 0.004)
            } else {
              root.gxYawTarget += (mouse.x - lastAt.x) * 0.005
              root.gxPitchTarget = Math.max(-1.45, Math.min(1.45, root.gxPitchTarget + (mouse.y - lastAt.y) * 0.004))
            }
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.explore === "system" && pressed) {
            // The scene sticks to the pointer 1:1 and coasts on release. Right-drag
            // orbits (so does left-drag while a body is pinned: it stays centred
            // and pinned; panning would cast the view adrift); left-drag otherwise
            // grabs the ecliptic and pans.
            const t = Date.now() / 1000
            if (!dragged && Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            if (dragged) {
              if ((mouse.buttons & Qt.RightButton) || root.chasing || root.galactic || (root.follow > 0 && (mouse.buttons & Qt.LeftButton))) {
                // in the chase and galactic views the pitch is a real elevation: drag down to look down
                const sgn = root.chasing || root.galactic ? 1 : -1
                root.sysCam.orbit((mouse.x - lastAt.x) / height * 8.6, sgn * (mouse.y - lastAt.y) / height * 4.3, true, t - lastT)
                root.autoOrbit = false
                orbiting = true
              } else if (mouse.buttons & Qt.LeftButton) {
                if (!root.sysCam.grab) { root.follow = -1; root.sysCam.grabBegin(root.toP(pressAt.x, pressAt.y, width, height), lastT, root.ecliptic) }
                root.sysCam.grabMove(root.toP(mouse.x, mouse.y, width, height), t)
              }
            }
            lastAt = Qt.point(mouse.x, mouse.y)
            lastT = t
          } else if (root.explore === "universe") {
            root.viewTarget = Qt.vector2d(mouse.x / width - 0.5, mouse.y / height - 0.5)
            root.hoverSystem = root.overSystem(root.toP(mouse.x, mouse.y, width, height))
          }
        }
        onReleased: {
          root.skyDragging = false
          root.gxLookDragging = false
          if (root.sysCam.grab) root.sysCam.grabEnd()
          if (orbiting) { root.sysCam.orbitEnd(); orbiting = false }
        }
        onCanceled: root.gxLookDragging = false
        onExited: {
          root.viewTarget = Qt.vector2d(0, 0)
          root.hoverSystem = false
          root.gxPointer = null
        }
        onClicked: function(mouse) {
          if (dragged) return
          if (mouse.button === Qt.RightButton) { if (root.explore !== "universe") root.back(); return }
          if (mouse.button !== Qt.LeftButton) return
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
          root.touchLabels()
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
