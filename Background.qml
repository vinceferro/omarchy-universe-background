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
  readonly property bool animate: !Hyprland.monitors.values.some(m => m.activeWorkspace && m.activeWorkspace.hasFullscreen)

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
  // screen angle of a direction v given a camera basis (works behind the camera too)
  // `ortho`: the overview camera (no perspective). Things already on screen
  // are labelled there, so they get no beacon (null)
  function beaconOf(v, right, up, fwd, name, dist, color, ortho) {
    const x = v[0] * right[0] + v[1] * right[1] + v[2] * right[2]
    const y = -(v[0] * up[0] + v[1] * up[1] + v[2] * up[2])
    const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2]
    const sx = ortho ? x * ortho : x / Math.max(z, 1e-12), sy = ortho ? y * ortho : y / Math.max(z, 1e-12)
    if ((ortho || z > 0) && Math.abs(sx) < aspect * 0.5 && Math.abs(sy) < 0.5) return null
    return { name: name, ang: Math.atan2(y, x), dist: dist, color: color, behind: !ortho && z < 0, shift: 0 }
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
  readonly property real hudLevel: hudOn ? hudBrightness : 0
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
    exposure: new Cam.Spring(1, 1.3)           // the sky brightens slowly on an empty workspace
  })

  onAnimateChanged: if (!animate) explore = "universe"
  // Flight and system grab the keyboard, so leave them as soon as the user
  // is on a workspace with windows (or switches away).
  onEmptyWorkspaceChanged: if (!emptyWorkspace) explore = "universe"
  onExploreChanged: {
    keysDown = ({})
    if (explore !== "galaxy") gxRateIndex = 0
    if (explore !== "system") {
      chasing = false
      galactic = false
      galBack = false
      autoOrbit = false
      simRateIndex = 0
      viewYawTarget = 0
      viewTiltTarget = 0.30
    }
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
  property vector4d moon2d: Qt.vector4d(0, 0, 0, 0.0012)
  // Earth-Moon distance in the overview: exaggerated when zoomed out so the
  // Moon clears Earth, true (60 Earth radii) once zoomed in; and the real one
  property real moonOrbit: 0.024
  property real moonDistanceKm: 384400
  property vector4d moonBody: Qt.vector4d(0, 0, 0, 0)
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
  // camera around the system: yaw turns the orbit plane, tilt is how far
  // above it we look from (orbit-plane squash)
  property real viewYaw: 0
  property real viewYawTarget: 0
  property real viewTilt: 0.30
  property real viewTiltTarget: 0.30
  property bool autoOrbit: false
  // chase view: 3D camera near the pinned planet (see universe.frag)
  property bool chasing: false
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
  property real galYaw: -0.7
  property real galYawTarget: -0.7
  property real galPitch: 0.35
  property real galPitchTarget: 0.35
  property real galDist: 1.3
  property real galDistTarget: 1.3
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
    if (galBack) {
      galYawTarget = Math.PI / 2   // camera on the velocity line, ahead of the Sun
      galPitchTarget = 0.12
      galDistTarget = 0.06
      if (!guides) guides = true   // the paths are the point of this view
    } else {
      galYawTarget = -0.7
      galPitchTarget = 0.35
      galDistTarget = 1.3
    }
  }
  function toggleGalactic() {
    if (explore !== "system") return
    galactic = !galactic
    if (galactic) {
      chasing = false
      if (simRateIndex < 4) simRateIndex = 4 // a week per second: Earth laps in under a minute
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
  // from tools/deproject_m31.py: in-plane axes signed like the photo
  readonly property var m31Disk: {"major": [-0.09263, 0.69656, 0.71149], "minor": [0.64068, 0.58869, -0.49293], "normal": [-0.76220, 0.41018, -0.50080]}
  property real m31Fade: 1
  readonly property var m33Disk: {"major": [0.22554, 0.50077, 0.83568], "normal": [0.97135, -0.18151, -0.15339]}

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
  readonly property vector4d m33Pos: gxGalaxy("Triangulum", 0.6)
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
    const h = hotspots[i]
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
    const h = hotspots[i]
    if (h.kind === "blackhole") return 20 * rsKpc // straight down to the event horizon
    return h.kind === "star" ? 0.0005 : Math.max(0.0015, h.size / 1000 * 3.2)
  }
  // closest approach: 0.2 pc anywhere, down to 6 Schwarzschild radii at Sgr A*
  readonly property real rsKpc: 4.11e-10
  property vector3d gxCamRs: Qt.vector3d(0, 1e6, 0)   // camera from Sgr A*, in Schwarzschild radii
  property bool gxHoleNear: false
  function gxMinDist() {
    if (gxSel >= 0 && hotspots[gxSel].kind === "blackhole") return 6 * rsKpc
    // a place with a photo: no closer than where its 2048 px fill ~1.4 screen heights
    if (gxSel >= 0 && photoOf(gxSel)) return photoWidthKpc(gxSel) * 0.7
    return 0.0002
  }
  function gxFlyTo(i) {
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
  function enterGalaxy() {
    if (!emptyWorkspace) return
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
  readonly property var photoTiles: {"Orion Nebula": [0, 35.49, "photos/orion-nebula.jpg"], "Carina Nebula": [1, 66.354, "photos/carina-nebula.jpg"], "Eagle Nebula": [2, 32.08, "photos/eagle-nebula.jpg"], "Lagoon Nebula": [3, 93.49, "photos/lagoon-nebula.jpg"], "Rosette Nebula": [4, 94.75, "photos/rosette-nebula.jpg"], "Crab Nebula": [5, 6.41, "photos/crab-nebula.jpg"], "Ring Nebula": [6, 2.484, "photos/ring-nebula.jpg"], "Helix Nebula": [7, 26.835, "photos/helix-nebula.jpg"], "Pleiades": [8, 69.321, "photos/pleiades.jpg"], "Omega Centauri": [9, 31.88, "photos/omega-centauri.jpg"], "47 Tucanae": [10, 42.067, "photos/47-tucanae.jpg"], "Westerlund 1": [11, 6.511, "photos/westerlund-1.jpg"], "Large Magellanic Cloud": [12, 266.122, "photos/large-magellanic-cloud.jpg"], "Small Magellanic Cloud": [13, 408.986, "photos/small-magellanic-cloud.jpg"], "Andromeda Galaxy": [14, 169.919, "photos/andromeda-galaxy.jpg"]} // tile, width (arcmin), 2048 px close-up
  property vector4d gxPhoto: Qt.vector4d(0, 0, 0, 0)
  readonly property var ncpDir: [0.74698, 0.48383, 0.45599] // celestial north pole (l 122.932, b 27.128), this frame
  function photoOf(i) {
    if (i < 0) return null
    const name = hotspots[i].name
    for (const k in photoTiles) if (name.startsWith(k)) return photoTiles[k]
    return null
  }
  function photoWidthKpc(i) {
    const ph = photoOf(i)
    return ph ? hotspots[i].dpc / 1000 * ph[1] / 60 * Math.PI / 180 : 0
  }

  // what the chase camera looks toward from behind the pinned body: "sun" or
  // "earth" (E switches; from Earth itself it is always the Sun)
  property string chaseLook: "sun"
  readonly property string chaseLookNow: chaseLook === "earth" && follow !== 3 ? "earth" : "sun"
  readonly property bool vectorLocked: Math.abs(chaseYawTarget) < 0.01 && Math.abs(chasePitchTarget) < 0.01
  property real chaseMix: 0
  property real chaseYaw: 0.35
  property real chaseYawTarget: 0.35
  property real chasePitch: 0.18
  property real chasePitchTarget: 0.18
  property real chaseDist: 7
  property real chaseDistTarget: 7
  property var bodies: planetInfo.map(() => Qt.vector4d(0, 0, 0, 0)) // relative to the chase camera (markers)
  // the one scene for universe.frag's systemScene: every body relative to a
  // reference point near what is looked at, in display units
  property var sceneBodies: planetInfo.map(() => Qt.vector4d(0, 0, 0, 0))
  property vector4d sceneMoon: Qt.vector4d(0, 0, 0, 0)
  property vector4d sceneSun: Qt.vector4d(0, 0, 0, 0.006)
  property vector3d sceneCam: Qt.vector3d(0, 0, 1)
  property vector3d orthoC: Qt.vector3d(0, 0, 0)
  property vector3d orthoRight: Qt.vector3d(1, 0, 0)
  property vector3d orthoDown: Qt.vector3d(0, 0.3, 0.95)
  property vector3d orthoView: Qt.vector3d(0, -0.3, -0.95)
  property real scenePlaneY: 0
  property real sceneBack: 1
  property vector3d camPos: Qt.vector3d(0, 0.05, 0.3)
  property vector3d camFwd: Qt.vector3d(0, 0, -1)
  property vector3d camRight: Qt.vector3d(1, 0, 0)
  property vector3d camUp: Qt.vector3d(0, 1, 0)
  readonly property real focal: 1.0
  property var chaseCam: [0, 0.05, 0.3] // chase camera, display units, doubles
  onFollowChanged: if (follow <= 0) chasing = false

  function toggleChase() {
    if (explore !== "system" || galactic) return
    if (chasing) { chasing = false; return }
    if (follow <= 0) return
    // start locked on the sun-planet vector: behind the planet, facing the sun
    chaseYaw = chaseYawTarget = 0
    chasePitch = chasePitchTarget = 0
    chaseDist = chaseDistTarget = 12
    chasing = true
  }

  // key hints shown under the HUD readouts, per mode
  readonly property var controlHints: explore === "flight" ? [
      ["W / S", "thrust forward / back"],
      ["A / D", "strafe left / right"],
      ["R / F", "up / down"],
      ["H", "hide / show the HUD"],
      ["ESC", "back to the universe"]
    ] : explore === "sky" ? [
      ["1 - 7  /  TAB", "the named views"],
      ["DRAG / ARROWS", "look around (WASD too)"],
      ["SCROLL / Q E", "zoom"],
      ["H", "hide / show the HUD"],
      ["ESC", "back to the universe"]
    ] : explore === "galaxy" ? [
      ["TAB", "next place (shift: previous)"],
      ["0", "back to the Sun"],
      ["B", "fall into the black hole at the centre"],
      ["CLICK", "fly to a place"],
      ["DRAG / ARROWS", "orbit the camera"],
      ["SCROLL / Q E", "closer / farther"],
      ["WASD", "fly freely"],
      ["[  ]", "time-lapse: the Galaxy turns (" + gxRateNames[gxRateIndex].toLowerCase() + ")"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
      ["ESC", "back to the universe"]
    ] : explore !== "system" ? [] : galactic ? [
      ["-  =", galSlow === 1 ? "slow the Sun to see the coils" : "slower / faster Sun (now 1/" + galSlow + ")"],
      ["L", root.guides ? "hide the trails" : "show 2-year trails (guide lines)"],
      ["V", root.galBack ? "back to the side view" : "look back from the Sun along its path"],
      ["RIGHT-DRAG", "swing the camera"],
      ["ARROWS", "swing / tilt the camera"],
      ["SCROLL", "camera distance"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
      ["G / ESC", "back to the system"]
    ] : chasing ? [
      ["X", vectorLocked ? "angled view" : "lock on the " + chaseLookNow + " vector"],
      ["E", chaseLookNow === "earth" ? "look toward the Sun" : "look toward Earth"],
      ["RIGHT-DRAG", "swing the camera"],
      ["SCROLL", "slide along the vector"],
      ["TAB / 1-6 / M", "chase another body (M: Moon)"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
      ["V / ESC", "back to the system"]
    ] : [
      ["CLICK / 1-6", "pin a planet"],
      ["M", "pin the Moon"],
      ["TAB", "next planet"],
      ["0", "the sun"],
      ["V", follow > 0 ? "chase view behind it" : "chase view (pin first)"],
      ["G", "galactic motion (paths through space)"],
      ["X", "fly out to the Milky Way"],
      ["L", root.guides ? "hide orbit lines" : "show orbit lines"],
      ["SCROLL / Q E", "zoom"],
      ["DRAG / WASD", "pan"],
      ["RIGHT-DRAG", "orbit the camera"],
      ["ARROWS", "orbit / tilt the camera"],
      ["O", "auto orbit"],
      ["[  ]", "slower / faster time"],
      ["N", "back to now"],
      ["H", "hide / show the HUD"],
      ["ESC", "back to the universe"]
    ]

  // pointer over the solar system in the universe view, eased 0..1
  property bool hoverSystem: false
  property real sysHover: 0
  property var planets: planetInfo.map(() => Qt.vector4d(0, 0, 1, 0))
  property vector2d sunScreen: Qt.vector2d(-0.64, 0.06)
  property real sys: 0 // 0 universe view .. 1 system view, eased
  property real sysZoom: 3.2
  property real sysZoomTarget: 3.2
  property vector2d sysCam: Qt.vector2d(0, 0)
  property vector2d sysCamTarget: Qt.vector2d(0, 0)
  property int follow: 0 // -1 free camera, 0 sun, 1..6 planets, 7 the Moon
  readonly property string followName: follow === 7 ? "Moon" : follow > 0 ? planetInfo[follow - 1].name : follow === 0 ? "Sun" : ""
  // camera mapping for the shader: q = (p - sysOrigin) / sysScale + sysCam
  readonly property vector2d sysOrigin: sunScreen.times(1 - sys)
  readonly property real sysScale: Math.pow(sysZoom, sys)
  readonly property vector2d sysCamNow: sysCam.times(sys)

  // Screen position (pixels) and on-screen radius of the Moon, Earth or the Sun,
  // through the chase camera when it is active, else the system view.
  function markerProj(kind, w, h) {
    if (chaseMix > 0.5) {
      var v = kind === "moon" ? Qt.vector3d(moonBody.x, moonBody.y, moonBody.z)
            : kind === "earth" ? Qt.vector3d(bodies[2].x, bodies[2].y, bodies[2].z)
            : camPos.times(-1)
      var rad = kind === "moon" ? moonBody.w : kind === "earth" ? bodies[2].w : sunR
      var zc = v.dotProduct(camFwd)
      var sx = v.dotProduct(camRight) / Math.max(Math.abs(zc), 1e-12) * focal
      var sy = -v.dotProduct(camUp) / Math.max(Math.abs(zc), 1e-12) * focal
      if (zc < 0) { sx = -sx * 1000; sy = -sy * 1000 } // behind: push to the edge, mirrored
      return { x: (sx / aspect + 0.5) * w, y: (sy + 0.5) * h, r: zc > 0 ? rad / zc * focal * h : 0, dist: v.length() }
    }
    var b = kind === "moon" ? Qt.vector2d(moon2d.x, moon2d.y) : kind === "earth" ? bodyPos(3) : Qt.vector2d(0, 0)
    var rr = kind === "moon" ? moon2d.w : kind === "earth" ? planetInfo[2].r : 0.006
    var p = b.minus(sysCamNow).times(sysScale).plus(sysOrigin)
    return { x: (p.x / aspect + 0.5) * w, y: (p.y + 0.5) * h, r: rr * sysScale * h, dist: 0 }
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
  function planetLabelPos(i, w, h) {
    const pl = planets[i]
    const at = Qt.vector2d(pl.x, pl.y).minus(sysCamNow).times(sysScale).plus(sysOrigin)
    return Qt.point((at.x / aspect + 0.5) * w + pl.w * sysScale * h + 10, (at.y + 0.5) * h)
  }
  function planetLabelShown(i, w, h) {
    const px = Math.round(h * 0.0085)
    const order = []
    if (follow >= 1 && follow <= planetInfo.length) order.push(follow - 1)
    for (let k = planetInfo.length - 1; k >= 0; k--) if (k !== follow - 1) order.push(k)
    const placed = []
    for (const k of order) {
      const q = planetLabelPos(k, w, h)
      const b = labelBox(q.x, q.y - px * 0.75, planetInfo[k].name, px)
      const free = placed.every(o => !boxesOverlap(o, b))
      if (k === i) return free
      if (free) placed.push(b)
    }
    return true
  }
  function markerWanted(kind, w, h) {
    if (!root.liveBackground || root.sys < 0.5 || root.galMix > 0.5) return false
    if (chaseMix > 0.02 && chaseMix < 0.98) return false // mid-morph neither projection is right
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

  function bodyPos(i) {
    if (i === 7) return Qt.vector2d(moon2d.x, moon2d.y)
    return i <= 0 ? Qt.vector2d(0, 0) : Qt.vector2d(planets[i - 1].x, planets[i - 1].y)
  }
  function bodyRadius(i) { return i === 7 ? moon2d.w : i <= 0 ? 0.006 : planetInfo[i - 1].r }
  // orbit ellipse for the shader: a, e, perihelion turned by the camera yaw
  property var orbitParams: planetInfo.map(pl => [pl.a, pl.e[0], 0])
  // True scale: pinning a planet or the Moon (and staying zoomed in) moves the
  // whole system to real proportions, anchored on Earth's radius: real orbit
  // distances, real planet radii, the real Sun. The overview squeezes orbits
  // a thousandfold so they fit on screen; zooming back out returns to it.
  property real trueMix: 0
  property bool trueLatch: false   // stays at true scale after panning away from a pinned body
  property real lastEk: 0
  // guide lines (orbit rings, the Sun vector, long galactic trails): L toggles
  property bool guides: false
  property real guideMix: 0
  readonly property real trueAu: 0.0045 * auKm / 6371 // display units per AU at true scale
  property real sunR: 0.006
  property vector2d sysBound: Qt.vector2d(0.4, 0.2)
  function trueRadius(i) { return i === 7 ? 0.0045 * 1737.4 / 6371 : i <= 0 ? 0.0045 * 695700 / 6371 : 0.0045 * planetInfo[i - 1].km / 6371 }
  function orbitUniform(i) {
    const o = orbitParams[i]
    return Qt.vector4d(o[0], o[1], -o[2], 0) // a, e, longitude of perihelion: world frame
  }

  function enterSystem() {
    if (!emptyWorkspace) return
    sysZoom = 3.2
    sysZoomTarget = 3.2
    sysCam = Qt.vector2d(0, 0)
    sysCamTarget = sysCam
    follow = 0
    autoOrbit = false
    explore = "system"
  }
  // a pick starts a timed flight: eased, always the same length, the camera
  // pulling back mid-way on long hops so the target never leaves the view
  // A pick is two calm steps: first a timed flight at the current scale (the
  // camera glides over and zooms in, pulling back on long hops just enough
  // to keep the target in view), then, once there, the blend to true scale
  // with the target held in the centre while everything else recedes.
  // The flight follows van Wijk & Nuij's smooth zoom-and-pan path (2003):
  // the camera rises (zooms out) and descends along the curve that keeps the
  // perceived speed constant, so a long hop never rushes its zoom at the end.
  property real sysFlyT: -1
  property vector2d sysFlyFrom: Qt.vector2d(0, 0)
  property vector2d sysFlyTo: Qt.vector2d(0, 0)   // target where the flight was planned
  property real sysFlyZoomFrom: 1
  property real sysFlyTime: 1.1
  property var sysFlyPath: null                   // { w0, r0, S, rho, u1 } or { w0, S, k } for a pure zoom
  function planFlight(c0, c1, z0, z1) {
    const rho = 1.6 // a little more rise than the paper's 1.42: the destination shows sooner
    const w0 = 1 / z0, w1 = 1 / z1
    const u1 = c1.minus(c0).length()
    if (u1 < 1e-9) {
      const S = Math.abs(Math.log(w1 / w0)) / rho
      return { pure: true, w0: w0, k: w1 > w0 ? 1 : -1, S: S, rho: rho }
    }
    const b = (i, wi) => (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho * rho * rho * rho * u1 * u1) / (2 * wi * rho * rho * u1)
    const r = (bb) => Math.log(-bb + Math.sqrt(bb * bb + 1))
    const r0 = r(b(0, w0)), r1 = r(b(1, w1))
    return { pure: false, w0: w0, r0: r0, S: (r1 - r0) / rho, rho: rho, u1: u1 }
  }
  function flightAt(P, s) {
    if (P.pure) return { u: 0, w: P.w0 * Math.exp(P.k * P.rho * s) }
    const c = Math.cosh(P.r0), rr = P.rho * P.rho
    return { u: P.w0 / rr * (c * Math.tanh(P.rho * s + P.r0) - Math.sinh(P.r0)), w: P.w0 * c / Math.cosh(P.rho * s + P.r0) }
  }
  property var planetK: planetInfo.map(() => 1) // display scale of each orbit (grows with true scale)
  function bodyScale(i) { return i >= 1 && i <= 6 ? planetK[i - 1] : i === 7 ? planetK[2] : 1 }
  function focusBody(i) {
    if (explore === "system") {
      sysFlyT = 0
      sysFlyFrom = sysCam
      sysFlyZoomFrom = sysZoom
      sysFlyTo = bodyPos(i)
      const z1 = i === 0 ? 3.2 : Math.max(3.6, Math.min(150, 0.06 / trueRadius(i)))
      sysFlyPath = planFlight(sysCam, sysFlyTo, sysZoom, z1)
      // longer hops take a little longer: 0.8 s up to 2.2 s
      sysFlyTime = Math.max(0.8, Math.min(2.2, 0.55 + 0.3 * Math.abs(sysFlyPath.S)))
    }
    follow = i
    sysZoomTarget = i === 0 ? 3.2 : Math.max(3.6, Math.min(150, 0.06 / trueRadius(i)))
  }
  // screen pixel -> shader p coordinates
  function toP(x, y, w, h) { return Qt.vector2d((x / w - 0.5) * aspect, y / h - 0.5) }
  function toSystem(pt) { return pt.minus(sysOrigin).times(1 / sysScale).plus(sysCamNow) }
  function overSystem(pt) {
    const q = pt.minus(sunScreen)
    return (q.x / 0.34) * (q.x / 0.34) + (q.y / 0.14) * (q.y / 0.14) < 1
  }
  function pickBody(pt) {
    const q = toSystem(pt)
    let best = -1
    let bestD = 1e9
    for (let i = 0; i <= 7; i++) {
      const d = q.minus(bodyPos(i)).length()
      if (d < Math.max(bodyRadius(i) * 2.5, 0.014 / sysScale) && d < bestD) { best = i; bestD = d }
    }
    return best
  }
  function zoomAt(pt, steps) {
    const z = Math.max(1, Math.min(150, sysZoomTarget * Math.pow(1.25, steps)))
    if (steps < 0 && z < 1.3) { explore = "universe"; return }
    if (follow < 0) {
      // keep the point under the pointer still
      const q = toSystem(pt)
      sysCamTarget = q.minus(pt.times(1 / z))
    }
    sysZoomTarget = z
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

    // solar system: sun position in the universe view (left third, drifting)
    // and the planets in system coordinates (orbit plane TILT 0.30, SPIN -0.10)
    sunScreen = Qt.vector2d(
      -aspect * 0.27 + 0.05 * Math.sin(w * 2 * shaderTime + 2.1) + view.x * 0.05 - pan.x * 0.8,
      0.06 + 0.035 * Math.sin(w * 3 * shaderTime + 0.4) + view.y * 0.05 - pan.y * 0.8)
    // Kepler: solve E - e sin E = M for each planet, place it on its ellipse
    // (sun at a focus), turn by perihelion and camera yaw, then squash by the
    // view tilt and turn by the screen SPIN (-0.10) as universe.frag does.
    if (explore === "system") simMs += dt * 1000 * simRate
    else simMs = Date.now()
    const jd = simMs / 86400000 + 2440587.5
    const days = jd - 2451545.0
    const T = days / 36525
    if (autoOrbit && explore === "system") viewYawTarget += dt * 0.12
    viewYaw += (viewYawTarget - viewYaw) * Math.min(1, dt * 3)
    viewTilt += (viewTiltTarget - viewTilt) * Math.min(1, dt * 3)
    const deg = Math.PI / 180
    const cs = Math.cos(-0.10)
    const sn = Math.sin(-0.10)
    // real positions (AU, kept in doubles; the chase view gets them relative
    // to its camera) and the overview's compressed copy: same direction and
    // ellipse shape, distance scaled to the display orbit `a`
    const orbits = planetInfo.map(pl => planetPos(pl, T))
    const real = orbits.map((o, i) => [o[0], o[1], o[2], planetInfo[i].km / auKm])
    // y (height above the ecliptic) moves a point up the screen, as the 3D
    // overview camera sees it (only the Moon leaves the plane)
    const project = (x, z, y) => {
      const ox = x * Math.cos(viewYaw) - z * Math.sin(viewYaw)
      const oy = x * Math.sin(viewYaw) + z * Math.cos(viewYaw)
      const ey = oy * viewTilt - (y || 0) * Math.sqrt(Math.max(0, 1 - viewTilt * viewTilt))
      return [ox * cs - ey * sn, ox * sn + ey * cs, oy]
    }
    {
      if (follow > 0) trueLatch = true
      if (follow === 0 || sysZoomTarget <= 3.4 || explore !== "system") trueLatch = false
      // true scale waits for the pick's flight to land (sysFlyT < 0)
      const goal = explore === "system" && !galactic && (chasing || (trueLatch && sysZoomTarget > 3.4)) ? 1 : 0
      const blendNow = sysFlyT < 0
      if (blendNow) trueMix += (goal - trueMix) * Math.min(1, dt * 2.2)
      if (Math.abs(goal - trueMix) < 0.0005) trueMix = goal
    }
    const tm = trueMix * trueMix * (3 - 2 * trueMix)
    mix.guide.g = guides ? 1 : 0
    guideMix = mix.guide.step(dt)
    // display distance and radius: geometric blend from the overview to true scale
    const dispA = orbits.map((o, i) => Math.pow(planetInfo[i].a, 1 - tm) * Math.pow(o[3] * trueAu, tm))
    planets = orbits.map((o, i) => {
      const k = dispA[i] / o[3]
      const p = project(o[0] * k, o[2] * k)
      return Qt.vector4d(p[0], p[1], p[2], Math.pow(planetInfo[i].r, 1 - tm) * Math.pow(trueRadius(i + 1), tm))
    })
    orbitParams = orbits.map((o, i) => [dispA[i], o[4], -o[5]])
    planetK = orbits.map((o, i) => dispA[i] / o[3])
    sunR = Math.pow(0.006, 1 - tm) * Math.pow(trueRadius(0), tm)
    {
      // the skip-box for the idle view: Saturn's whole orbit at the current
      // tilt, the bodies' sizes, the Sun's glow, turned by the screen spin;
      // computed each frame so tilting or true scale never slices a planet
      const reach = dispA[5] * 1.06
      const pad = 3 * Math.max(...planets.map(pl => pl.w)) + sunR * 12 + 0.01
      const bx = reach + pad, by = reach * viewTilt + Math.sqrt(Math.max(0, 1 - viewTilt * viewTilt)) * moonOrbit + pad
      sysBound = Qt.vector2d(bx + 0.1 * by, by + 0.1 * bx)
    }
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

    // the Moon: real geocentric position. In the overview the Earth-Moon pair
    // blends from an exaggerated layout (zoomed out) to true scale (zoomed in):
    // real size ratio (27%) and real distance (about 60 Earth radii).
    const mg = moonPos(days)
    const earth = real[2]
    const moonReal = [earth[0] + mg[0], earth[1] + mg[1], earth[2] + mg[2], moonRadiusAu]
    moonFace = Qt.vector3d(-mg[0], -mg[1], -mg[2]).normalized()
    {
      const mlen = Math.hypot(mg[0], mg[2])
      const ek = Math.pow(planetInfo[2].a, 1 - tm) * Math.pow(orbits[2][3] * trueAu, tm) / orbits[2][3]
      // not following anything: keep the camera over the same place as the scale changes
      if (follow < 0 && lastEk > 0 && Math.abs(ek / lastEk - 1) > 1e-9) {
        sysCam = sysCam.times(ek / lastEk)
        sysCamTarget = sysCamTarget.times(ek / lastEk)
      }
      lastEk = ek
      const earthR = planetInfo[2].r
      moonDistanceKm = Math.hypot(mg[0], mg[1], mg[2]) * auKm
      const trueDist = earthR * moonDistanceKm / 6371
      moonOrbit = 0.024 + (trueDist - 0.024) * tm
      const mp = project(earth[0] * ek + mg[0] / mlen * moonOrbit, earth[2] * ek + mg[2] / mlen * moonOrbit, mg[1] / mlen * moonOrbit)
      moon2d = Qt.vector4d(mp[0], mp[1], mp[2], earthR * 1737.4 / 6371)
    }
    // display positions in 3D (true directions, the overview's distances or
    // true scale as blended), shared by the overview and chase cameras
    const disp = orbits.map((o, i) => {
      const kk = dispA[i] / o[3]
      return [real[i][0] * kk, real[i][1] * kk, real[i][2] * kk, planets[i].w]
    })
    const moonD = (() => {
      const ml = Math.max(1e-12, Math.hypot(mg[0], mg[2]))
      const e2 = disp[2]
      return [e2[0] + mg[0] / ml * moonOrbit, e2[1] + mg[1] / ml * moonOrbit, e2[2] + mg[2] / ml * moonOrbit, moon2d.w]
    })()
    chaseMix += ((chasing ? 1 : 0) - chaseMix) * Math.min(1, dt * 1.8)
    if (Math.abs((chasing ? 1 : 0) - chaseMix) < 0.0005) chaseMix = chasing ? 1 : 0
    if (follow > 0 && (chasing || chaseMix > 0)) {
      const ck = Math.min(1, dt * 3)
      chaseYaw += (chaseYawTarget - chaseYaw) * ck
      chasePitch += (chasePitchTarget - chasePitch) * ck
      chaseDist += (chaseDistTarget - chaseDist) * ck
      // behind the body as seen from what we look toward (the Sun, or Earth),
      // swung by yaw and pitch, looking between the body and that target so
      // both are in frame
      const B = follow === 7 ? moonD : disp[follow - 1]
      const Tg = chaseLookNow === "earth" ? disp[2] : [0, 0, 0]
      const P = Qt.vector3d(B[0], B[1], B[2])
      const d = Qt.vector3d(B[0] - Tg[0], B[1] - Tg[1], B[2] - Tg[2]).normalized()
      const up = Qt.vector3d(0, 1, 0)
      const side = up.crossProduct(d).normalized()
      const o = d.times(Math.cos(chaseYaw)).plus(side.times(Math.sin(chaseYaw)))
      const off = o.times(Math.cos(chasePitch)).plus(up.times(Math.sin(chasePitch)))
      // vector3d holds floats, so the camera offset is added in doubles
      const dist = B[3] * chaseDist
      const C = [B[0] + off.x * dist, B[1] + off.y * dist, B[2] + off.z * dist]
      const toPlanet = off.times(-1)
      const toTarget = Qt.vector3d(Tg[0] - C[0], Tg[1] - C[1], Tg[2] - C[2]).normalized()
      const fwd = toPlanet.times(0.45).plus(toTarget.times(0.55)).normalized()
      const right = fwd.crossProduct(up).normalized()
      camPos = Qt.vector3d(C[0], C[1], C[2])
      chaseCam = C
      bodies = disp.map(b => Qt.vector4d(b[0] - C[0], b[1] - C[1], b[2] - C[2], b[3]))
      moonBody = Qt.vector4d(moonD[0] - C[0], moonD[1] - C[1], moonD[2] - C[2], moonD[3])
      camFwd = fwd
      camRight = right
      camUp = right.crossProduct(fwd)
    }
    mix.gal.g = galactic ? 1 : 0
    galMix = mix.gal.step(dt)
    if (galMix > 0) {
      const gk = Math.min(1, dt * 3)
      if (galactic && explore === "system") {
        galYawTarget += (key("right") - key("left")) * dt * 0.8
        galPitchTarget = Math.max(-1.4, Math.min(1.4, galPitchTarget + (key("up") - key("down")) * dt * 0.6))
      }
      galYaw += (galYawTarget - galYaw) * gk
      galPitch += (galPitchTarget - galPitch) * gk
      galDist += (galDistTarget - galDist) * gk
      // camera rides with the Sun, beside its path: basis from its velocity
      const f0 = Qt.vector3d(sunVelocity[0], sunVelocity[1], sunVelocity[2])
      const Yn = Qt.vector3d(0, 1, 0)
      const s0 = f0.crossProduct(Yn).normalized()
      const u0 = s0.crossProduct(f0).normalized()
      const off = s0.times(Math.cos(galYaw)).plus(f0.times(Math.sin(galYaw))).times(Math.cos(galPitch)).plus(u0.times(Math.sin(galPitch)))
      const cam = off.times(galDist)
      const gf = off.times(-1)
      const gr = gf.crossProduct(Yn).normalized()
      const gu = gr.crossProduct(gf)
      const proj = (x, y, z) => {
        const vx = x - cam.x, vy = y - cam.y, vz = z - cam.z
        const zr = vx * gf.x + vy * gf.y + vz * gf.z
        const zc = Math.max(1e-4, zr)
        return { x: (vx * gr.x + vy * gr.y + vz * gr.z) / zc * focal,
                 y: -(vx * gu.x + vy * gu.y + vz * gu.z) / zc * focal, z: zr }
      }
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
      now.push({ x: s0p.x, y: s0p.y, z: s0p.z, r: 695700 / auKm * 0.11 / Math.max(1e-4, s0p.z) })
      for (let i = 0; i < planetInfo.length; i++) {
        const pts = []
        for (let j = 0; j <= N; j++) {
          const tau = galTrailYears * j / N
          const h = helio3(planetInfo[i], T - tau / 100)
          pts.push(proj(h[0] - sunVelocity[0] * vDisp * tau, h[1] - sunVelocity[1] * vDisp * tau, h[2] - sunVelocity[2] * vDisp * tau))
        }
        trails.push(pts)
        now.push({ x: pts[0].x, y: pts[0].y, z: pts[0].z, r: planetInfo[i].km / auKm * 0.11 / Math.max(1e-4, pts[0].z) })
      }
      galTrails = trails
      galNow = now
      // interstellar dust is at rest in the Galaxy, so from the Sun it streams
      // backward; the shader drifts its dust by this accumulated offset
      const ahead = proj(sunVelocity[0] * 0.05, sunVelocity[1] * 0.05, sunVelocity[2] * 0.05)
      const hx = ahead.x - s0p.x, hy = ahead.y - s0p.y
      const hl = Math.max(1e-6, Math.hypot(hx, hy))
      galHeading = Qt.point(hx / hl, hy / hl)
      const flow = Math.min(0.6, 0.004 + vDisp * simRate / 31557600 * 0.5 / galDist) // screen units per second
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
      if (inView) {
        gxYawTarget += (key("right") - key("left")) * dt * 0.8
        gxPitchTarget = Math.max(-1.45, Math.min(1.45, gxPitchTarget + (key("up") - key("down")) * dt * 0.6))
        const zk = key("e") - key("q")
        if (zk !== 0) gxDistGoal = Math.max(gxMinDist(), Math.min(2500, gxDistGoal * Math.pow(2.5, zk * dt)))
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
      if (inView) {
        const mv = [key("d") - key("a"), key("w") - key("s")]
        if (mv[0] !== 0 || mv[1] !== 0) {
          if (gxSel !== -2) { gxFree = gxTarget.slice(); gxSel = -2 }
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
      const cam = [gxTarget[0] + off[0] * gxDist, gxTarget[1] + off[1] * gxDist, gxTarget[2] + off[2] * gxDist]
      // only hand the shaders a new camera when it really moved: an unchanged
      // camera lets the galaxy volume skip redrawing (it is the costly pass)
      const moved = Math.hypot(cam[0] - gxCamPos.x, cam[1] - gxCamPos.y, cam[2] - gxCamPos.z) > gxDist * 1e-5
                 || Math.abs(fwd.x - gxFwd.x) + Math.abs(fwd.y - gxFwd.y) + Math.abs(fwd.z - gxFwd.z) > 1e-6
      if (moved) gxCamPos = Qt.vector3d(cam[0], cam[1], cam[2])
      gxHoleNear = Math.hypot(cam[0], cam[1], cam[2]) < 1e-5
      if (gxHoleNear) gxCamRs = Qt.vector3d(cam[0] / rsKpc, cam[1] / rsKpc, cam[2] / rsKpc)
      if (moved) {
        gxFwd = fwd
        gxRight = right
        gxUp = up
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
        const h = hotspots[gxSel]
        const hp = hotspotPos(gxSel)
        const hx = parseInt(h.color.slice(1), 16)
        const c = { r: (hx >> 16 & 255) / 255, g: (hx >> 8 & 255) / 255, b: (hx & 255) / 255 }
        gxFocus = Qt.vector4d(hp[0], hp[1], hp[2], h.size / 1000)
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
          // Andromeda is drawn in 3D from its photo; its card takes over only near Earth's view
          const isM31 = h.name.startsWith("Andromeda")
          m31Fade = isM31 ? 1 - Math.min(1, Math.max(0, (cosA - 0.85) / 0.12)) : 1
          if (isM31) gxFocusCol = Qt.vector4d(gxFocusCol.x, gxFocusCol.y, gxFocusCol.z, 7)
        } else { gxPhoto = Qt.vector4d(0, 0, 0, 0); m31Fade = 1 }
      } else if (gxSel === -1) {
        gxPhoto = Qt.vector4d(0, 0, 0, 0)
        const sp0 = sunPosAt(gxMyr)
        gxFocus = Qt.vector4d(sp0[0], sp0[1], sp0[2], 0.00001)
        gxFocusCol = Qt.vector4d(1.0, 0.96, 0.88, 4)
      } else {
        gxFocus = Qt.vector4d(0, 0, 0, 0)
        gxPhoto = Qt.vector4d(0, 0, 0, 0)
      }
      // labels: projected, and laid out so none overlap (chosen place first,
      // then the Sun, then the biggest on screen)
      const H = 1000, Wd = H * aspect, px = 8.5
      const pts = []
      for (let i = 0; i <= hotspots.length; i++) {
        const P = i < hotspots.length ? hotspotPos(i) : sunPosAt(gxMyr)
        const v = [P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]]
        const zc = v[0] * fwd.x + v[1] * fwd.y + v[2] * fwd.z
        const x = (v[0] * right.x + v[1] * right.y + v[2] * right.z) / Math.max(zc, 1e-9)
        const y = -(v[0] * up.x + v[1] * up.y + v[2] * up.z) / Math.max(zc, 1e-9)
        const isSel = i < hotspots.length ? i === gxSel : gxSel === -1
        const filling = isSel && (i < hotspots.length ? hotspots[i].size / 1000 : 0) / Math.max(zc, 1e-12) > 0.08
        const front = zc > 0 && Math.abs(x) < aspect * 0.5 && Math.abs(y) < 0.5 && !filling
        const size = i < hotspots.length ? hotspots[i].size / 1000 : 0.0001
        pts.push({ x: x, y: y, front: front, z: zc, apparent: size / Math.max(zc, 1e-9), show: false })
      }
      const sel = gxSel >= 0 ? gxSel : gxSel === -1 ? hotspots.length : -1
      const order = pts.map((_, i) => i).filter(i => pts[i].front)
        .sort((a, b) => (b === sel) - (a === sel) || (b === hotspots.length) - (a === hotspots.length) || pts[b].apparent - pts[a].apparent)
      const placed = []
      for (const i of order) {
        const name = i < hotspots.length ? hotspots[i].name : "SUN · YOU ARE HERE"
        const bx = labelBox((pts[i].x / aspect + 0.5) * Wd + 10, (pts[i].y + 0.5) * H - px * 0.75, name.toUpperCase(), px)
        if (placed.every(o => !boxesOverlap(o, bx))) { placed.push(bx); pts[i].show = true }
      }
      gxScreen = pts
    }

    mix.hover.g = hoverSystem && explore === "universe" ? 1 : 0
    sysHover = mix.hover.step(dt)

    // system camera: ease in and out of the view, zoom and follow
    const goal = explore === "system" ? 1 : 0
    sys += (goal - sys) * Math.min(1, dt * 1.6)
    if (Math.abs(goal - sys) < 0.01) sys = goal // the last 1% would leave a large camera offset at true scale
    if (explore === "system" && !galactic) {
      const move = Qt.vector2d(key("d") - key("a"), key("s") - key("w"))
      if (move.length() > 0) {
        follow = -1
        sysCamTarget = sysCamTarget.plus(move.times(0.6 * dt / sysZoom))
      }
      const yawKey = key("right") - key("left")
      const tiltKey = key("up") - key("down")
      if (yawKey !== 0) viewYawTarget += yawKey * dt * 0.8
      if (tiltKey !== 0) viewTiltTarget = Math.max(follow > 0 ? 0.04 : 0.12, Math.min(0.98, viewTiltTarget + tiltKey * dt * 0.5))
      const zk = key("e") - key("q")
      if (zk !== 0) sysZoomTarget = Math.max(1.3, Math.min(80, sysZoomTarget * Math.pow(2.5, zk * dt)))
      // a copy: reading a vector2d property gives a live reference, which would
      // follow the update below and leave the carry-along step at zero
      const before = Qt.vector2d(sysCamTarget.x, sysCamTarget.y)
      if (follow >= 0) sysCamTarget = bodyPos(follow)
      if (sysFlyT >= 0 && follow >= 0) {
        // along the smooth zoom-and-pan path, eased in and out; the target's
        // own motion since the plan is carried along
        sysFlyT = Math.min(1, sysFlyT + dt / sysFlyTime)
        const e = sysFlyT * sysFlyT * (3 - 2 * sysFlyT)
        const P = sysFlyPath
        const f = flightAt(P, e * P.S)
        const dir = P.pure ? Qt.vector2d(0, 0) : sysFlyTo.minus(sysFlyFrom).times(1 / P.u1)
        sysCam = sysFlyFrom.plus(dir.times(f.u)).plus(sysCamTarget.minus(sysFlyTo).times(e))
        sysZoom = 1 / f.w
        if (sysFlyT >= 1) { sysFlyT = -1; sysCam = sysCamTarget; sysZoom = sysZoomTarget }
      } else {
        sysFlyT = -1
        const kz = Math.min(1, dt * 4)
        sysZoom = sysZoom * Math.pow(sysZoomTarget / sysZoom, kz)
        // move with a moving target (a followed planet), then close the gap
        const carried = sysCam.plus(sysCamTarget.minus(before))
        sysCam = carried.plus(sysCamTarget.minus(carried).times(kz))
      }
    }

    // the shader's camera, built after this frame's camera update (built before
    // it, the scene was drawn with last frame's camera: at true scale an orbit
    // step moved the view by screen heights per frame)
    {
      // The overview as a real orthographic camera: the same yaw, tilt and
      // screen spin as the 2D layout (`project` above), so a body drawn at a
      // screen point is exactly where picks and labels expect it.
      const sY = Math.sin(viewYaw), cY = Math.cos(viewYaw)
      const st = viewTilt, ct = Math.sqrt(Math.max(0, 1 - st * st))
      const eox = [cY, 0, -sY], eoy = [sY, 0, cY]
      const right = eox
      const down = [eoy[0] * st, -ct, eoy[2] * st]
      const toward = [eoy[0] * ct, st, eoy[2] * ct]
      const Rs = [right[0] * cs - down[0] * sn, right[1] * cs - down[1] * sn, right[2] * cs - down[2] * sn]
      const Ds = [right[0] * sn + down[0] * cs, right[1] * sn + down[1] * cs, right[2] * sn + down[2] * cs]
      // the screen centre's point on the ecliptic (system coords back to the world)
      const qc = sysCamNow
      const sx = qc.x * cs + qc.y * sn, sy = -qc.x * sn + qc.y * cs
      const ox = sx, oy = sy / Math.max(st, 1e-6)
      const Oc = [eox[0] * ox + eoy[0] * oy, 0, eox[2] * ox + eoy[2] * oy]
      // reference point: the chase camera when it leads, else the overview centre
      const Rw = chaseMix > 0.5 ? chaseCam : Oc
      const rel = (a) => Qt.vector3d(a[0] - Rw[0], a[1] - Rw[1], a[2] - Rw[2])
      sceneBodies = disp.map(b => Qt.vector4d(b[0] - Rw[0], b[1] - Rw[1], b[2] - Rw[2], b[3]))
      sceneMoon = Qt.vector4d(moonD[0] - Rw[0], moonD[1] - Rw[1], moonD[2] - Rw[2], moonD[3])
      sceneSun = Qt.vector4d(-Rw[0], -Rw[1], -Rw[2], sunR)
      sceneCam = rel(chaseCam)
      orthoC = rel(Oc)
      orthoRight = Qt.vector3d(Rs[0], Rs[1], Rs[2])
      orthoDown = Qt.vector3d(Ds[0], Ds[1], Ds[2])
      orthoView = Qt.vector3d(-toward[0], -toward[1], -toward[2])
      scenePlaneY = -Rw[1]
      // behind every body as seen by the overview camera, for the morph
      let back = 0.1
      for (const b of disp.concat([moonD, [0, 0, 0, sunR]])) back = Math.max(back, (b[0] - Oc[0]) * toward[0] + (b[1] - Oc[1]) * toward[1] + (b[2] - Oc[2]) * toward[2] + 2 * b[3])
      sceneBack = back * 1.2
    }

    // JARVIS: beacons every frame, telemetry 5 times a second
    {
      const nb = [null, null, null, null]
      let rows = null
      const refresh = now >= navNextAt
      if (refresh) navNextAt = now + 200
      if (explore === "system" && !galactic) {
        // camera basis: the overview's (spin applied) or the chase camera's
        const useChase = chaseMix > 0.5
        const oz = useChase ? 0 : sysScale
        const R = useChase ? [camRight.x, camRight.y, camRight.z] : [orthoRight.x, orthoRight.y, orthoRight.z]
        const U = useChase ? [camUp.x, camUp.y, camUp.z] : [-orthoDown.x, -orthoDown.y, -orthoDown.z]
        const F = useChase ? [camFwd.x, camFwd.y, camFwd.z] : [orthoView.x, orthoView.y, orthoView.z]
        const fi = follow === 7 ? -2 : follow - 1          // index into real[], -1 the Sun, -2 the Moon
        const at = fi === -1 ? [0, 0, 0] : fi === -2 ? [real[2][0] + mg[0], real[2][1] + mg[1], real[2][2] + mg[2]] : follow < 0 ? null : real[fi]
        const from = at || [0, 0, 0]
        const d = (a) => Math.hypot(a[0] - from[0], a[1] - from[1], a[2] - from[2])
        const sub = (a) => [a[0] - from[0], a[1] - from[1], a[2] - from[2]]
        // directions in display space (what is drawn), distances in real AU
        const fromD = fi === -1 || !at ? [0, 0, 0] : fi === -2 ? moonD : disp[fi]
        const subD = (a) => [a[0] - fromD[0], a[1] - fromD[1], a[2] - fromD[2]]
        if (fi !== -1) nb[0] = beaconOf(subD([0, 0, 0]), R, U, F, "SUN", fmtAu(d([0, 0, 0])), "#ffd27a", oz)
        if (fi !== 2) nb[1] = beaconOf(subD(disp[2]), R, U, F, "EARTH", fmtAu(d(real[2])), "#6ab7ff", oz)
        if (fi === 2 || fi === -2) {
          const mw = [real[2][0] + mg[0], real[2][1] + mg[1], real[2][2] + mg[2]]
          nb[2] = beaconOf(fi === 2 ? subD(moonD) : subD(disp[2]), R, U, F, fi === 2 ? "MOON" : "EARTH", fmtNum(moonDistanceKm) + " KM", "#cfd6e6", oz)
        }

        if (refresh) {
          rows = []
          if (at) {
            const rSun = Math.hypot(at[0], at[1], at[2])
            const rEarth = d(real[2])
            rows.push({ label: "TARGET", value: (follow === 7 ? "MOON" : follow === 0 ? "SUN" : planetInfo[follow - 1].name.toUpperCase()) })
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
        if (gxSel >= 0 && !hotspots[gxSel].name.startsWith("Sagittarius A")) {
          const P = hotspotPos(gxSel)
          nb[2] = beaconOf(vec(P), R, U, F, hotspots[gxSel].name.toUpperCase(), fmtLy(len(vec(P)) * ly), root.hudHighlight)
        }
        const m31 = hotspots[gxIndex("Andromeda")].pos
        if (gxSel < 0 || !hotspots[gxSel].name.startsWith("Andromeda")) nb[3] = beaconOf(vec(m31), R, U, F, "ANDROMEDA", fmtLy(len(vec(m31)) * ly), "#fff0d8")
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
          if (gxSel >= 0) rows.splice(0, 0, { label: "TARGET", value: hotspots[gxSel].name.toUpperCase() + "  ·  " + fmtLy(len(vec(hotspotPos(gxSel))) * ly) + " AWAY" })
        }
      } else if (explore === "sky") {
        const R = [skyRight.x, skyRight.y, skyRight.z], U = [skyUp.x, skyUp.y, skyUp.z], F = [skyFwd.x, skyFwd.y, skyFwd.z]
        nb[1] = beaconOf([0, -1, 0], R, U, F, "GALACTIC CENTRE", "26,000 LY", "#ffb070")
        nb[2] = beaconOf([0, 0, 1], R, U, F, "GALACTIC NORTH", "", "#9fc3ff")
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

    // chase view exactly on the planet-sun line (1) or angled (0)
    function align(on: bool): void {
      root.chaseYawTarget = on ? 0 : 0.35
      root.chasePitchTarget = on ? 0 : 0.18
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

    // chase camera aim: "sun" or "earth"
    function look(target: string): void {
      root.chaseLook = target === "earth" ? "earth" : "sun"
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

    function fly(place: string): void {
      if (root.explore !== "galaxy") root.enterGalaxy()
      root.gxFlyTo(place === "sun" ? -1 : root.gxIndex(place))
    }

    function galactic(): void {
      if (root.explore !== "system") root.enterSystem()
      if (!root.galactic) root.toggleGalactic()
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

  Component.onCompleted: refreshBackground()

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
              property vector3d m33Major: Qt.vector3d(root.m33Disk.major[0], root.m33Disk.major[1], root.m33Disk.major[2])
              property vector3d m33Normal: Qt.vector3d(root.m33Disk.normal[0], root.m33Disk.normal[1], root.m33Disk.normal[2])
              property vector4d lmc: root.lmcPos
              property vector4d smc: root.smcPos
              property real exposure: root.gxExposure
              property real spin: root.sunOmega * root.gxMyr
              // a Magellanic Cloud's soft volume gives way to its photo as we close in
              property vector2d cloudFade: {
                const h = root.gxSel >= 0 ? root.hotspots[root.gxSel] : null
                const near = h ? Math.min(1, Math.max(0, (Math.log(root.gxDist / (h.size / 1000)) - Math.log(3)) / Math.log(4))) : 1
                return Qt.vector2d(h && h.name.startsWith("Large Magellanic") ? near : 1, h && h.name.startsWith("Small Magellanic") ? near : 1)
              }
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
            }
            Timer {
              id: holeClock
              interval: 25
              repeat: true
              running: holePass.near
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
              property color themeBase: Color.background
              property real hudLevel: root.hudLevel
              property vector2d view: root.view
              property vector2d hudCenter: root.hudCenter
              property real flight: root.flight
              property real cpu: root.cpu
              property real gpu: root.gpu
              property real mem: root.mem
              property real secs: (root.now.getSeconds() + root.now.getMilliseconds() / 1000) / 60
              property vector2d pan: root.pan
              property vector2d sysOrigin: root.sysOrigin
              property real sysScale: root.sysScale
              property vector2d sysCam: root.sysCamNow
              property vector4d planet0: root.planets[0]
              property vector4d planet1: root.planets[1]
              property vector4d planet2: root.planets[2]
              property vector4d planet3: root.planets[3]
              property vector4d planet4: root.planets[4]
              property vector4d planet5: root.planets[5]
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
              property real tilt: root.viewTilt
              property real yaw: root.viewYaw
              property real chase: root.chaseMix
              property vector3d camPos: root.sceneCam
              property vector3d camFwd: root.camFwd
              property vector3d camRight: root.camRight
              property vector3d camUp: root.camUp
              property real focal: root.focal
              property vector4d body0: root.sceneBodies[0]
              property vector4d body1: root.sceneBodies[1]
              property vector4d body2: root.sceneBodies[2]
              property vector4d body3: root.sceneBodies[3]
              property vector4d body4: root.sceneBodies[4]
              property vector4d body5: root.sceneBodies[5]
              property real pinned: root.explore === "system" && !root.chasing && root.follow > 0 ? root.follow : 0
              property real sunRadius: root.sunRadiusAu
              property real earthTheta: root.earthTheta
              property vector3d earthPole: Qt.vector3d(0, Math.cos(root.obliquity), -Math.sin(root.obliquity))
              property vector3d home: root.homeDir
              property vector4d moon2d: root.moon2d
              property real moonOrbit: root.moonOrbit
              property real galactic: root.galMix
              property real sunR: root.sunR
              property vector2d sysBound: root.sysBound
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
              property real navMix: root.navMix
              property real gxRealSky: root.gxRealSky
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
              property vector3d orthoC: root.orthoC
              property vector3d orthoRight: root.orthoRight
              property vector3d orthoDown: root.orthoDown
              property vector3d orthoView: root.orthoView
              property real planeY: root.scenePlaneY
              property real orthoBack: root.sceneBack
              property vector3d moonFace: root.moonFace
              property var earthDay: earthDayTex
              property var earthNight: earthNightTex
              property var moonTex: moonMapTex
              property vector4d auA: Qt.vector4d(0.387, 0.723, 1.0, 1.524)
              property vector2d auB: Qt.vector2d(5.203, 9.537)
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
                      value: (root.chasing ? (root.vectorLocked ? "LOCKED ON SUN VECTOR  " : "CHASE  ") : "")
                        + (root.follow > 0 ? "PINNED " + root.followName.toUpperCase() + (root.chasing ? " → " + root.chaseLookNow.toUpperCase() : "") + "  "
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

              // what each key does in the current mode, one per row
              Column {
                x: statsColumn.x
                y: statsColumn.y + statsColumn.height + readout.rowSize * 1.2
                spacing: Math.round(readout.unit * 0.003)
                opacity: 0.7

                Repeater {
                  model: root.controlHints
                  Row {
                    required property var modelData
                    Text {
                      width: readout.rowSize * 8.5
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
        opacity: root.sysHover * 0.8
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
        visible: wanted
        opacity: Math.min(1, (root.sys - 0.5) * 2) * 0.85

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
            color: Qt.alpha("#ffd27a", 0.8)
            font.pixelSize: Math.round(panel.height * 0.02)
          }
          Text {
            readonly property real reach: panel.height * 0.06
            x: root.galHeading.x * reach + (root.galHeading.x >= 0 ? 18 : -width - 18)
            y: root.galHeading.y * reach - height / 2
            text: "249 KM/S  ·  CYGNUS"
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
              color: Qt.alpha(Color.foreground, 0.55)
              font.family: Style.resolvedFontFamily
              font.pixelSize: Math.round(panel.height * 0.0075)
              font.letterSpacing: 2
            }
          }
        }

        // caption, bottom centre, in the HUD's voice
        Column {
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
        visible: root.liveBackground && root.skyMix > 0.01
        opacity: root.skyMix
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
        visible: root.liveBackground && root.galaxyMix > 0.01
        opacity: root.galaxyMix

        Repeater {
          model: root.hotspots.length + 1
          Item {
            id: mark
            required property int index
            readonly property bool isSun: index === root.hotspots.length
            readonly property var pt: root.gxScreen[index] || ({ x: 0, y: 0, front: false, show: false })
            readonly property bool chosen: isSun ? root.gxSel === -1 : root.gxSel === index
            readonly property color tint: isSun ? "#fff4e0" : root.hotspots[index].color
            visible: pt.front
            x: (pt.x / root.aspect + 0.5) * gxOverlay.width
            y: (pt.y + 0.5) * gxOverlay.height
            Rectangle {
              readonly property real d: mark.chosen ? 9 : 5
              x: -d / 2; y: -d / 2; width: d; height: d; radius: d / 2
              color: mark.tint
              opacity: mark.chosen ? 0.9 : 0.6
            }
            Text {
              visible: mark.pt.show
              x: 10
              y: -height / 2
              text: (mark.isSun ? "SUN  ·  YOU ARE HERE" : root.hotspots[mark.index].name.toUpperCase())
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
          readonly property var h: root.gxSel >= 0 ? root.hotspots[root.gxSel] : null
          visible: root.gxSel !== -2
          Text {
            text: parent.h ? parent.h.name.toUpperCase() : "THE SUN  ·  YOU ARE HERE"
            color: Color.accent
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.011)
            font.letterSpacing: 4
          }
          Text {
            text: parent.h ? parent.h.label.toUpperCase()
                           : "26,600 LY FROM THE GALACTIC CENTRE  ·  ONE ORBIT EVERY ~203 MILLION YEARS AT 249 KM/S"
            color: Qt.alpha(Color.foreground, 0.6)
            font.family: Style.resolvedFontFamily
            font.pixelSize: Math.round(panel.height * 0.0075)
            font.letterSpacing: 2
          }
          Text {
            visible: !!parent.h
            text: parent.h && parent.h.kind === "blackhole" && root.gxDist < 2e-6
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
            text: parent.h ? (parent.h.kind === "blackhole"
                               ? parent.h.blurb + "  Visible light never gets out to us through the dust; you see the crowded star cluster around it. Its shadow was imaged in radio by the Event Horizon Telescope in 2022."
                               : parent.h.blurb) + (parent.h.dpc * 3.26156 >= 10 ? "  The light you see left it " + root.lightYears(parent.h.dpc).replace(" ly", " years") + " ago." : "")
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
          readonly property var pl: root.planets[index]
          readonly property vector2d at: Qt.vector2d(pl.x, pl.y).minus(root.sysCamNow).times(root.sysScale).plus(root.sysOrigin)
          visible: root.liveBackground && root.sys > 0.5 && root.chaseMix < 0.02 && root.galMix < 0.5 && root.planetLabelShown(index, panel.width, panel.height)
          opacity: (root.sys - 0.5) * 1.4 * (1 - root.chaseMix)
          x: (at.x / root.aspect + 0.5) * panel.width + pl.w * root.sysScale * panel.height + 10
          y: (at.y + 0.5) * panel.height - height / 2
          text: modelData.name.toUpperCase()
          color: root.follow === index + 1 ? root.hudHighlight : Color.foreground
          font.family: Style.resolvedFontFamily
          font.pixelSize: Math.round(panel.height * 0.0085)
          font.letterSpacing: 2
        }
      }

      Item {
        focus: root.explore !== "universe"
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            if (root.galactic) { root.galactic = false; root.galBack = false }
            else if (root.chasing) root.chasing = false
            else root.explore = "universe"
            event.accepted = true
            return
          }
          const k = event.text.toLowerCase()
          if (k === "h") { root.setHud(!root.hudOn); event.accepted = true; return }
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
            if (k === "b") { root.gxFlyTo(root.gxIndex("Sagittarius A")); event.accepted = true; return }
            if (k === "[" || k === "]") {
              root.gxRateIndex = Math.max(0, Math.min(root.gxRates.length - 1, root.gxRateIndex + (k === "]" ? 1 : -1)))
              event.accepted = true
              return
            }
            if (k === "n") { root.gxMyr = 0; root.gxRateIndex = 0; event.accepted = true; return }
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
            if (k === "l" && root.explore === "system") { root.guides = !root.guides; event.accepted = true; return }
            if (root.galactic && (k === "-" || k === "=" || k === "+")) {
              root.galSlowIndex = Math.max(0, Math.min(root.galSlows.length - 1, root.galSlowIndex + (k === "-" ? 1 : -1)))
              event.accepted = true
              return
            }
            if (k === "m") { root.focusBody(7); event.accepted = true; return }
            if (k === "e" && root.chasing) {
              root.chaseLook = root.chaseLookNow === "earth" ? "sun" : "earth"
              event.accepted = true
              return
            }
            if (k.length === 1 && "0123456".includes(k)) {
              root.focusBody(Number(k))
              event.accepted = true
              return
            }
            if (k === "o") { root.autoOrbit = !root.autoOrbit; event.accepted = true; return }
            if (k === "x" && !root.chasing) { root.enterGalaxy(); event.accepted = true; return }
            if (k === "v") { root.toggleChase(); event.accepted = true; return }
            if (k === "x" && root.chasing) {
              // locked on the planet-sun line, or the angled over-the-shoulder view
              const aligned = Math.abs(root.chaseYawTarget) < 0.01 && Math.abs(root.chasePitchTarget) < 0.01
              root.chaseYawTarget = aligned ? 0.35 : 0
              root.chasePitchTarget = aligned ? 0.18 : 0
              event.accepted = true
              return
            }
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
        property bool dragged: false
        onPressed: function(mouse) {
          pressAt = Qt.point(mouse.x, mouse.y)
          lastAt = pressAt
          dragged = false
        }
        onPositionChanged: function(mouse) {
          if (root.explore === "sky" && pressed) {
            root.skyDragging = true
            // drag the sky: it follows the pointer
            const degPerPx = root.skyVfov / height
            root.skyLTarget += (mouse.x - lastAt.x) * degPerPx
            root.skyBTarget = Math.max(-89, Math.min(89, root.skyBTarget + (mouse.y - lastAt.y) * degPerPx))
            root.skyL = root.skyLTarget
            root.skyB = root.skyBTarget
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.explore === "galaxy" && pressed) {
            if (Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            root.gxYawTarget += (mouse.x - lastAt.x) * 0.005
            root.gxPitchTarget = Math.max(-1.45, Math.min(1.45, root.gxPitchTarget + (mouse.y - lastAt.y) * 0.004))
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.galactic && pressed && (mouse.buttons & Qt.RightButton)) {
            root.galYawTarget += (mouse.x - lastAt.x) * 0.005
            root.galPitchTarget = Math.max(-1.4, Math.min(1.4, root.galPitchTarget + (mouse.y - lastAt.y) * 0.004))
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.chasing && pressed && (mouse.buttons & Qt.RightButton)) {
            root.chaseYawTarget += (mouse.x - lastAt.x) * 0.005
            root.chasePitchTarget = Math.max(-1.2, Math.min(1.2, root.chasePitchTarget + (mouse.y - lastAt.y) * 0.004))
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.explore === "system" && pressed && ((mouse.buttons & Qt.RightButton) || (root.follow > 0 && !root.chasing && (mouse.buttons & Qt.LeftButton)))) {
            // orbit: right-drag anywhere, or left-drag while a body is pinned
            // (it stays centred and pinned; panning would cast the view adrift)
            if (Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            root.viewYawTarget += (mouse.x - lastAt.x) * 0.004
            root.viewTiltTarget = Math.max(root.follow > 0 ? 0.04 : 0.12, Math.min(0.98, root.viewTiltTarget - (mouse.y - lastAt.y) * 0.002))
            root.autoOrbit = false
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (!root.chasing && root.explore === "system" && pressed && (mouse.buttons & Qt.LeftButton)) {
            if (Math.hypot(mouse.x - pressAt.x, mouse.y - pressAt.y) > 4) dragged = true
            if (dragged) {
              const d = root.toP(mouse.x, mouse.y, width, height).minus(root.toP(lastAt.x, lastAt.y, width, height))
              root.follow = -1
              root.sysCamTarget = root.sysCamTarget.minus(d.times(1 / root.sysZoom))
              root.sysCam = root.sysCam.minus(d.times(1 / root.sysZoom))
            }
            lastAt = Qt.point(mouse.x, mouse.y)
          } else if (root.explore === "universe") {
            root.viewTarget = Qt.vector2d(mouse.x / width - 0.5, mouse.y / height - 0.5)
            root.hoverSystem = root.overSystem(root.toP(mouse.x, mouse.y, width, height))
          }
        }
        onReleased: root.skyDragging = false
        onExited: {
          root.viewTarget = Qt.vector2d(0, 0)
          root.hoverSystem = false
        }
        onClicked: function(mouse) {
          if (dragged || mouse.button !== Qt.LeftButton) return
          const pt = root.toP(mouse.x, mouse.y, width, height)
          if (root.explore === "galaxy") {
            // fly to the nearest marked place under the pointer
            let best = -2
            let bestD = 28
            for (let i = 0; i < root.gxScreen.length; i++) {
              const g = root.gxScreen[i]
              if (!g.front) continue
              const d = Math.hypot((g.x / root.aspect + 0.5) * width - mouse.x, (g.y + 0.5) * height - mouse.y)
              if (d < bestD) { bestD = d; best = i === root.hotspots.length ? -1 : i }
            }
            if (best !== -2) root.gxFlyTo(best)
          } else if (root.explore === "universe" && root.overSystem(pt)) root.enterSystem()
          else if (root.explore === "system" && !root.chasing) {
            const b = root.pickBody(pt)
            if (b >= 0) root.focusBody(b)
          }
        }
        onWheel: function(wheel) {
          const pt = root.toP(wheel.x, wheel.y, width, height)
          const steps = wheel.angleDelta.y / 120
          if (root.explore === "sky") root.skyVfovTarget = Math.max(8, Math.min(130, root.skyVfovTarget * Math.pow(1.12, -steps)))
          else if (root.explore === "galaxy") root.gxDistGoal = Math.max(root.gxMinDist(), Math.min(2500, root.gxDistGoal * Math.pow(1.2, -steps)))
          else if (root.galactic) root.galDistTarget = Math.max(root.galBack ? 0.03 : 0.25, Math.min(8, root.galDistTarget * Math.pow(1.15, -steps)))
          else if (root.chasing) root.chaseDistTarget = Math.max(2.2, Math.min(3000, root.chaseDistTarget * Math.pow(1.15, -steps)))
          else if (root.explore === "system") root.zoomAt(pt, steps)
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
