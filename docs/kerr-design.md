# Sagittarius A* spinning: the Kerr design

Technical plan for turning the Schwarzschild ray tracer (`hole.frag`,
`universe.frag`, `lib/fall.js`, the black-hole parts of `Background.qml`)
into a Kerr one, with a fall down the spin axis and a clearly labelled
"what the mathematics says" continuation through the ring into the
negative-r universe. Written to be implemented next; the "Design page"
section at the end is the block for the project's design page.

Conventions throughout: geometric units G = c = 1, lengths in Schwarzschild
radii Rs = 2GM/c^2 (so the mass is M = 0.5 Rs, as today's `1/r` terms assume),
signature (- + + +), the spin parameter chi = a/M, a = chi M = chi/2 Rs.
Sgr A*: 4.15e6 Msun, Rs/c = 40.88 s (GRAVITY 2019), as in `lib/fall.js`.

## 1. The spin

Default `chi = 0.94`. Sources, and why this value:

- EHT Collaboration 2022, Sgr A* Paper V (ApJL 930 L16): the "best-bet"
  model that passes the most constraints is a MAD flow with a* = 0.94 at
  inclination 30 degrees; a* = 0.5 MAD models also pass. The spin is not
  measured by the image alone; the preference comes from the model library.
- Daly et al. 2024 (MNRAS 527, 428): a* ~ 0.9 from the outflow method.
- Against: Fragione & Loeb 2020 (ApJL 901 L32) argue a* < 0.1 from the
  orbital planes of the S stars (no Lense-Thirring scrambling). Also
  disputed; the EHT Paper V inclination and spin are what the image
  modelling favours and what the plugin already uses for the axis.

So the comment in the shader says: chosen because it is the EHT 2022
best-bet value, uncertain by a lot, and a single uniform `spin` (a in Rs)
changes it. a = 0 must reproduce today's picture (regression test, §8).

Numbers for chi = 0.94 (M = 0.5 Rs), all from closed forms in `lib/kerr.js`:

| quantity | formula | value (Rs) |
|---|---|---|
| outer horizon r+ | M + sqrt(M^2 - a^2) | 0.6706 |
| inner (Cauchy) horizon r- | M - sqrt(M^2 - a^2) | 0.3294 |
| prograde equatorial photon orbit | 2M (1 + cos(2/3 arccos(-a/M))) | 0.7126 |
| retrograde equatorial photon orbit | 2M (1 + cos(2/3 arccos(+a/M))) | 1.9732 |
| polar photon orbit (axis rays) | root of r^3 - 3Mr^2 + a^2 r + Ma^2 = 0 (Teo 2003) | 1.2535 |
| prograde ISCO (Bardeen, Press & Teukolsky 1972) | M (3 + Z2 - sqrt((3-Z1)(3+Z1+2Z2))) | 1.0118 |
| retrograde ISCO | M (3 + Z2 + sqrt(...)) | 4.4154 |
| ergosurface on the equator | 2M | 1.0 |

with Z1 = 1 + (1-chi^2)^(1/3) ((1+chi)^(1/3) + (1-chi)^(1/3)),
Z2 = sqrt(3 chi^2 + Z1^2). For a = 0 these give 1, 1.5, 1.5, 3 Rs: the
Schwarzschild numbers in the code today (ISCO 3 Rs, photon sphere 1.5 Rs).

## 2. Coordinates: Kerr-Schild Cartesian

The whole tracer moves to Kerr-Schild (KS) coordinates (t, x, y, z):

    g_mn = eta_mn + f l_m l_n          g^mn = eta^mn - f l^m l^n
    f    = 2 M r^3 / (r^4 + a^2 z^2)
    l_m  = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z/r)

l is null for both eta and g, l^m = eta^mn l_n = (-1, l_i). The Boyer-
Lindquist radius r is a function of position, defined by
r^4 - (rho^2 - a^2) r^2 - a^2 z^2 = 0 with rho^2 = x^2 + y^2 + z^2:

    r^2 = ((rho^2 - a^2) + S) / 2             if rho^2 >= a^2
    r^2 = 2 a^2 z^2 / (S - (rho^2 - a^2))     otherwise (no cancellation)
    S   = sqrt((rho^2 - a^2)^2 + 4 a^2 z^2)

Why KS: the metric is regular at both horizons (nothing special happens
to the integrator at r+ or r-), it is written in one Cartesian chart that
the camera and the gas already live in, the asymptotic sky direction is
just the ray's Cartesian direction far out, and it extends through the
disk r = 0 (x^2 + y^2 < a^2, z = 0) to r < 0 by the same formulas with a
signed r. The ring singularity is r = 0, z = 0, x^2 + y^2 = a^2, where
f ~ 1/sqrt(distance) blows up.

The two sheets. The Cartesian point does not say which sheet (sign of r)
we are on, so `sheet` (+1 or -1) is state carried with every ray and with
the camera. r = sheet * sqrt(r^2). Crossing the plane z = 0 inside the
disk (x^2 + y^2 < a^2 at the crossing) flips the sheet; crossing it
outside the ring does not. With that rule every metric function is
continuous through the disk: on the disk z/r -> sign(z) sign(r)
sqrt(1 - (x^2+y^2)/a^2) stays put when z and r flip together, and f
changes sign smoothly (f = 2Mr/(r^2 + a^2) on the axis). `cos theta = z/r`
is computed as sign(z) sign(r) sqrt((S - (rho^2 - a^2)) / (2 a^2)) when
r^2 < 1e-4 to avoid 0/0.

Derivatives (needed by the Hamiltonian, §3), with D = r^4 + a^2 z^2:

    dr/dx = r^3 x / D      dr/dy = r^3 y / D      dr/dz = r z (r^2 + a^2) / D

(from differentiating the defining quartic and simplifying with it). From
these, df and dl_i by the chain rule; the shader writes them out once in a
function `ksMetric(x, sheet) -> (r, f, l, grad f, grad l)`.

Repulsion for r < 0: f < 0 there, so the "Newtonian" potential -f/2 is
positive and the negative-r universe is asymptotically flat with
mass -M as seen from there. That is what pushes the camera away in §6.

## 3. The integrator

Hamiltonian form, no Christoffel symbols. For a photon with covariant
momentum p_m, H = 1/2 g^mn p_m p_n = 1/2 eta^mn p_m p_n - 1/2 f (l.p)^2
where l.p = l^m p_m = -p_t + l_i p_i. Equations:

    dx^i/dL = dH/dp_i = p_i - f (l.p) l_i
    dp_i/dL = -dH/dx^i = 1/2 (l.p)^2 df/dx^i + f (l.p) (dl_j/dx^i) p_j

p_t = -E is constant (the metric is stationary) and is never integrated.
Also conserved, used as drift monitors in the tests: L_z = x p_y - y p_x
(axisymmetry) and Carter's Q. Rays are traced backward: the state starts
at the camera with the photon's momentum reversed in the spatial part
(see §4), exactly as today.

Stepper: classical RK4 on the 6D state (x, p_i), 4 metric evaluations per
step. Step size in affine parameter from a step length in space,
ds / |dx/dL|, with

    ds = clamp(0.12 (|r| - 0.3), 0.02, 3.0)      (today: clamp(0.11 (r - 0.9), 0.025, 3))

so the step shrinks smoothly toward the horizons and the ring but never
below 0.02 Rs. Through the disk: if the step would cross z = 0, it is cut
at the crossing (linear fraction), the sheet rule of §2 is applied to the
remainder, and RK4 stage points on the far side of the plane use the
flipped sheet when their cylindrical radius is inside the ring (the rule
`sheetAt(z, rc, sheet0, sign z0)` is applied at every stage, so no stage
sees the wrong sheet). The ring: a ray that comes within 0.005 Rs of it,
(rc - a)^2 + z^2 < 2.5e-5, is declared lost (dark); f is also capped at
f_max = 200 so a near miss cannot produce a NaN.

Termination:

- escaped: |x| > R_OUT = 60 and moving outward (dot(x, dx/dL) > 0); the
  remaining weak-field bend to infinity is added analytically,
  delta = (2M/b)(1 - sqrt(1 - b^2/R^2)) toward the hole, b the current
  impact parameter (at most 1.4e-4 b radians: tiny, but free);
- escaped to the other universe: r < -R_OUT (math mode only; from r > 0
  rays cannot reach r < 0 without crossing r- first, which no backward
  ray from outside does);
- lost: 180 steps spent (today 200; the RK4 step is ~4x the work of the
  Verlet step but adaptive steps are longer far out, see §9), or the ring
  hit, or |r| stuck within 1e-3 of r+ or r- for 40 steps (a backward ray
  running to the chart's edge, KS time -> -infinity: light from the other
  exterior of the extended solution, which the realistic picture replaces
  with the collapsed star, i.e. darkness/infall glow);
- horizon rules as today: a hovering camera's ray that gets inside r+ is
  lost (it can never come back out, and everything that was inside stays
  dark); for a falling camera between the horizons a ray with E <= 0 is
  dark (§4), one with E > 0 came from outside.

Classification of sky versus dark without the march (the crisp edge at
full resolution in `universe.frag`, replacing `b / B_CRIT - 1`): with the
constants E, L_z, Q of the backward ray from the local tetrad, the radial
potential of the Kerr geodesic equation is

    R(r) = (E (r^2 + a^2) - a L_z)^2 - Delta (Q + (L_z - a E)^2)
    Delta = r^2 - 2 M r + a^2

R has no r^3 term, so d/dr [R / r^4] = 0 is the quadratic
2 c2 r^2 + 3 c1 r + 4 c0 = 0 with R = E^2 r^4 + c2 r^2 + c1 r + c0. The
minimum of R/(E^2 r^4) over an interval is therefore at an endpoint or at
one of two closed-form roots: 30 flops. A ray climbing (backward) escapes
iff that minimum over [r_cam, inf) is > 0 (no turning point above); a ray
diving escapes iff the minimum over [r+, r_cam] is < 0 (it turns before
the horizon). The signed value `xs` (positive on the sky side, zero on the
critical curve, smooth) takes the place of today's `x = B/B_CRIT - 1` and
`xs` in both `blackHole()` and `blackHoleFall()`, including the
`exp(-xs/0.006)` photon-ring rim and the nudge that reads the tracer only
from the sky's side. At a = 0 this reduces exactly to the b > or < B_CRIT
rule (test). The D-shaped shadow at high spin is this curve, computed, not
painted.

## 4. Observers and tetrads

Every camera needs an orthonormal frame to turn a screen direction into a
photon 4-momentum. The KS metric gives one for free: because l is null,

    e_a^m = delta_a^m - (f/2) l_a l^m         satisfies g(e_a, e_b) = eta_ab

(e_0 is the 4-velocity of an observer falling in with velocity -f/2 l_i,
the "KS frame"). The physical camera is then a local Lorentz boost of
that frame: U^a = eta^ab g(e_b, u) are the camera's 4-velocity components
in it, gamma = U^0, beta^i = U^i / gamma, and the boosted spatial legs are

    E_i = e_i + (gamma - 1) (beta_i / beta^2) beta^j e_j + gamma beta_i e_0

E_0 = u. A screen direction n (the Euclidean `camFwd + camRight p.x -
camUp p.y`, unit) is read as components in {E_i}: the photon the camera
sees has k^m = u^m + n^i E_i^m (observed frequency 1), lowered with g to
k_m; the backward ray starts with p_i = -k_i... keeping p_t = k_t = -E, so
E = -k_t is the ray's energy at infinity per unit observed frequency and
the sky's frequency ratio seen/emitted is g = 1/E, as today (`1/e`). Far
out the KS frame is the Cartesian frame, so the mapping is the obvious
one; near the hole it is one consistent choice (the same formula in
`hole.frag`, `universe.frag` and `lib/kerr.js`). For the hovering camera
this is the properly aberrated static view, which today's code
approximated by treating the Euclidean direction as the coordinate
direction; the shadow seen from 20 Rs will change by a few percent of its
size, which is correct.

The hovering camera: u = (1/sqrt(1 - f), 0, 0, 0) (static; exists wherever
f < 1, i.e. outside the ergosurface; the camera never parks closer than
6 Rs, and the ergosurface is inside 1 Rs). Frame dragging is not in the
camera (a static observer does not co-rotate) but is in every ray.

The axis-falling camera: on the axis x = y = 0, z = r (same sign on both
sheets), l_i = (0, 0, 1), f = 2 M r / (r^2 + a^2). With energy E_f
(conserved, -u_t) and w = dr/dtau = -sqrt(E_f^2 - 1 + f) (Carter's
equations with L_z = 0 and Q = a^2 (1 - E_f^2), the axis values),

    u^z = -w                                    (w >= 0, falling)
    u^t = (E_f^2 (1 + f) + f^2) / (E_f + f w)   (regular at both horizons)

The second line is (E_f - f w)/(1 - f) with the 0/0 at f = 1 rationalised
away. a = 0 gives the Schwarzschild infaller in ingoing Eddington-
Finkelstein Cartesian coordinates, and the tetrad above reproduces the
`e = E - n_r w`, `b = r n_t / e`, `s = w - n_r E` formulas in `hole.frag`
and `blackHoleFall()` (test). Look-around is untouched: QML still rotates
`camFwd/camUp` by yaw and pitch, the frame comes from the position and
E_f, so the observer does not change when the view turns.

Between the horizons (r- < r < r+) the sky is the set of directions with
E > 0; E <= 0 light would have had to come from the region the collapsed
star occupies, and is drawn as the infall glow, as today's e <= 0 case.
Inside r- the classification is by the trace itself (§3).

## 5. The fall

Trajectory, on the axis, from rest at r0 (lib/kerr.js `axisFall`):

    (dr/dtau)^2 = E_f^2 - 1 + 2 M r / (r^2 + a^2),    E_f^2 = 1 - 2 M r0 / (r0^2 + a^2)

a = 0 gives E_f^2 = 1 - 1/r0 and the cycloid of `fall.js`; chi = 0.94
from 6 Rs gives E_f = 0.91343 (Schwarzschild: 0.91287). No closed form in
general, so r(tau) is integrated once per fall (RK4 in tau, 4096 samples,
monotone where it should be) and tabulated; `rAt(tl, tau)` and
`tauAtR(tl, r)` interpolate the table. Checked against a 2e5-point
quadrature of dtau = dr / sqrt(...) in the tests.

What the mathematics says about this observer, and the one decision that
changes the request: an observer from rest at r0 cannot reach r < 0. The
right side above is E_f^2 - U(r) with U = 1 - 2Mr/(r^2+a^2); for r < 0 the
potential term is negative while E_f^2 - 1 < 0, so the motion is
forbidden. The fall turns around at the other root of U(r) = U(r0),

    r_turn = a^2 / r0 = 0.0368 Rs       (inside r-, in region III)

and the observer is then thrown back out through another branch of r-
into a white-hole region and a new exterior universe with r > 0: that is
the honest continuation of a from-rest fall. To pass through the disk to
r < 0 the maths requires (dr/dtau)^2 > 0 at the hardest point r = -a,
2M|r|/(r^2+a^2) <= M/a there, so

    E_f >= sqrt(1 + M/a) = 1.4366 for chi = 0.94  (a plunge from infinity at 0.72 c)

Decision: the mathematics mode starts the plunge with E_f = 1.5 instead of
letting go from rest (an impossible shove down the axis at 0.75 c; stated
plainly in the status and caption text and the README), because the user
asked for the ring and the negative-r universe, and this is the only way
the solution gets there. The from-rest continuation (bounce at a^2/r0,
out into a new positive-r universe) is documented as the alternative and
could be a second mode later. In realistic mode nothing changes: from rest
at 6 Rs, and the story ends at r-.

Timeline (`fall.js`, generalised): the knots become the polar photon orbit
(1.2535 Rs; a = 0: 1.5) at S_PHOTON = 20 s and r+ at S_HORIZON = 24 s, the
C1 monotone Hermite map as today; from r+ on, real time. Durations for
chi = 0.94 from rest at 6 Rs: 945 s outside (shown in 24 s), 14.9 s from
r+ to r- (real time). For the E_f = 1.5 plunge: 172 s outside, 9.2 s
between the horizons, 10.0 s from r- to the disk, then 444 s to r = -10 Rs
(slow at the ring: dr/dtau = 0.43 at r = -a, 1.12 far out). In math mode
the negative-r stretch is compressed again (another Hermite stretch,
slope 1 at the disk, ending ~20 s later at r = -12 Rs where the fade
starts), so the whole thing lasts about a minute.

Phases (`fallPhase`, also what `status()` prints; hyphenated so scripts
can split on spaces):

| phase | when | realistic | math |
|---|---|---|---|
| `falling` | from letting go to r+ | yes | yes |
| `outer-horizon` | r < r+ (nothing visible marks it; the status does) | yes | yes |
| `inner-horizon` | r within 1 Rs/c of r-, then crossing | the end: flash, fade | crossed |
| `ring` | r- > r > -a (through the disk at r = 0; the axis never touches the ring) | - | yes |
| `other-universe` | r < -a, receding | - | yes, then fade |
| `out` / `in` | the existing fade and return | yes | yes |

`status()` returns `<view> <phase or -> <signed r in Rs> <real|math>`:
the first three fields as today, one appended.

Realistic ending at r-. In the eternal Kerr solution an observer falling
in at finite advanced time crosses the branch of r- that ingoing KS
coordinates cover, and sees our own sky with a finite shift (the trace
gives it). What makes a real hole different is that the inner horizon is
unstable: infalling and backscattered radiation is blueshifted without
bound there (Penrose 1968; Poisson & Israel 1990, mass inflation; Ori
1991: the singularity is null and weak, so the solution continues formally
but not physically). This is drawn honestly as a cartoon, labelled as
one: over the last second of proper time before r- the dark cap below us
(the infall glow, which is the light from what fell in ahead) brightens
with a shift g_flash = (0.5 s / (tau_CH - tau))^0.5 applied through
`shifted()` (blue-white, g^3 in intensity), clipped by the existing soft
clip, and the fade to black starts 1 s before r- so the screen is black
at the crossing. The HUD and caption say: "inner horizon: here the Kerr
solution stops being trustworthy".

Mathematics mode toggle: the `K` key in the galaxy view (free; `M` is the
Moon in the solar system view) and IPC `mathMode(on: bool)`. Off by
default, not persisted. Toggling during a fall takes effect at the next
fall (the energies differ). The HUD shows "MATHEMATICS MODE: THE EXTENDED
KERR SOLUTION, NOT OBSERVED PHYSICS" while on.

Getting onto the axis. Letting go must happen on the axis, at the pole on
our side (sign(dot(cam, spinAxis))). `gxB()`'s "down to 6 Rs" leg also
steers yaw/pitch so the park point is that pole; if the camera was
dragged off it, letting go first glides along the 6 Rs sphere to the pole
(slerp, 2 s, phase stays `-` until arrival, hints say "to the axis").
Free flight across the horizon (the existing trigger) starts the fall at
the pole at the same radius, a jump, since no off-axis trajectory is
modelled; it is a rare path and the README says so.

Camera state handed to the shaders: `camPos` (KS Cartesian, Rs; on the
negative sheet it is at negative z along the axis), `camSheet` (+1/-1),
`fallE` (E_f; 0 when hovering), `spin` (a, Rs). `gxCamRs` in QML becomes
the signed axis coordinate times the axis direction, so the existing
plumbing (holeClock copying at 40 Hz, the per-frame copy while the look
turns) is unchanged apart from the two new uniforms.

## 6. Mathematics mode: what is rendered beyond r-

Inside r- (region III, which contains both sheets) backward rays from the
camera do one of:

- run to r -> -infinity: the other universe's sky. A new procedural sky
  `otherSky(d)` in `universe.frag`: sparse (a tenth of `gxSky`'s star
  density), no Milky Way band, cold violet-white and amber stars only, a
  faint large-scale gradient, no galaxy texture. Clearly not our sky, and
  the caption says it is the solution's, not anyone's observation;
- pass through the disk to r > 0 and climb back across r- and r+
  (regular in KS, these are our universe's rays reversed): our sky,
  lensed through the throat inside the ring, with the shift 1/E
  (finite, since the observer is at finite advanced time);
- fall toward r+ from inside and stall (KS time -> -infinity): dark, the
  chart's edge (light that in the extended solution comes from a universe
  we do not model);
- hit the ring: dark.

So from the far side the ring is seen as the boundary between the other
sky outside and our own sky inside, framed by a thin dark and strongly
lensed rim where rays wind near the singularity. Nothing is painted. The
gas torus lives on the r > 0 sheet only (its `flowDensity` is multiplied
by `sheet > 0`), so from r < 0 it is visible only through the throat.

The negative-r stretch ends by the existing fade/return after the
compressed ~20 s; the camera is receding at 1.12 Rs per Rs/c of proper
time by then (repulsion: the acceleration -d(-f/2)/dr is away from the
ring for r < -a).

## 7. The gas in Kerr

Prograde circular orbits in the equatorial plane (Bardeen, Press &
Teukolsky 1972), in Boyer-Lindquist:

    Omega = sqrt(M) / (r^(3/2) + a sqrt(M))
    u^t   = (r^(3/2) + a sqrt(M)) / (r^(3/4) sqrt(r^(3/2) - 3 M r^(1/2) + 2 a sqrt(M)))

KS and BL share t and phi up to functions of r only, so on a circular
orbit u^t and u^phi = Omega u^t carry over unchanged, and in KS Cartesian
the orbit is x = sqrt(r^2+a^2) at azimuth phi~ with
u = u^t d_t + u^phi (x d_y - y d_x): the ordinary rotation about the spin
axis. Off the plane (the torus is thick) the gas at BL radius r keeps the
plane's Omega(r) at that r, as the Keplerian code does today. Inside the
ISCO the formula has no timelike solution soon after (the denominator
vanishes at the photon orbit), so r is clamped to r_isco in the velocity
and the torus's inner edge moves there: `smoothstep(r_isco - 0.1,
r_isco + 0.9, rc)` in place of `smoothstep(2.6, 3.6, rc)`, the rest of
`flowDensity` as is (the EHT ring of ~5 M radius is the lensed image of
emission from r ~ 2-6 M, which this reaches).

Frequency shift of a gas sample: one dot product, exact in Kerr,

    g = 1 / (-k_m u_gas^m)

with k_m the ray's covariant momentum at the sample (we carry p_i and p_t
along the march; the camera measures 1 by construction), so Doppler,
transverse Doppler, gravitational shift and frame dragging are all in it.
The emissivity weight stays g^3.5 (I_nu / nu^3 invariant, spectral index
0.5), the shear of the turbulence pattern uses the Kerr Omega, and the
check that a distant on-axis observer sees g = 1/u^t = sqrt(1 - 3M/r +
2a sqrt(M)/r^(3/2)) is a test. The spin axis stays `(0, -0.866, 0.5)`:
30 degrees off the default line of sight (EHT 2022 Paper V), the sense of
rotation as today. At 30 degrees the D-shaped flattening of the shadow is
real but subtle (a few percent of the radius); dragging the camera round
to the equator shows it in full, and the README says so rather than
tilting the hole against the data.

Infall glow (`infallGlow`) stays as the Schwarzschild spherical inflow
model with the camera's E_f and a 1/sqrt(r) gas speed: it is a hint of
light, already stated as a simplification, and the Kerr correction to a
faint glow is not worth 100 lines. Exception: for r < r- in math mode it
is off (no modelled gas there).

## 8. The tracer's output and `universe.frag`

Kerr bends rays out of their initial plane (frame dragging), so a single
bend angle no longer locates where a ray left. The layer stays RGBA16F
(the same 10-bit mantissa quantisation of the sky direction that today's
bend angle has, ~1e-3 rad, which has been fine) with a new layout:

| channel | content |
|---|---|
| R, G | the escape direction, world frame, octahedral-encoded to [-1, 1]^2; (2, 2) = no sky this way (dark or lost); (3, 3) = escaped to the other universe (math mode) |
| B | the collected light's intensity (gas along a sky ray; the infall glow along a dark ray), HDR, unshifted for the gas |
| A | the intensity-weighted mean frequency shift g of that light, for the tint |

The gas colour was `sum tint(g_i) j_i g_i^3.5 dl`; it becomes
`tint(g_mean) * sum j_i g_i^3.5 dl` with g_mean the g^3.5 j-weighted
mean. Along most rays one side of the torus dominates, so the hue is the
same; where the receding and approaching sides overlap on one ray (the
photon ring) the hue is the mean rather than the mix. Accepted, noted in
the README. `universe.frag` applies `shifted()` for the sky's own shift
(1/E from the tetrad, as today) to the gas light and re-tints the glow by
its mean g.

`universe.frag` changes: `blackHole()` and `blackHoleFall()` compute the
tetrad and the constants (E, L_z, Q) of the look direction at full
resolution (shared functions with `hole.frag`, copied as the tetrad
formulas are today), classify with the R/r^4 minimum (§3) for the crisp
edge and the rim, decode the direction from the tracer and read
`gxSceneAlong(d)` or `otherSky(d)`; the B < 55 weak-field series for
far rays stays as it is (the spin correction to the deflection is
O(a M / b^2), below a pixel there). The sky's shift is `1/E`.

## 9. Performance

Today: 200 Verlet steps per ray at a third of the resolution, each ~25
flops plus `flowDensity` (two `noise3`, ~300 flops) where there is gas.
Kerr: RK4 with four `ksMetric` evaluations (~90 flops each with the
gradients) ~400 flops per step, plus the same gas sampling, at most 180
steps with the adaptive length (rays far out take 3 Rs steps, so a
typical escaping ray uses ~80 steps). Estimate: 1.6-2x today's tracer
cost, inside the budget. Mitigations if it is over: (1) a midpoint (RK2)
stepper with the same step rule is accurate enough for the picture
(tested in JS before deciding: error < 0.1 degree in the bend angle for
b > 1.05 b_crit), halving the metric evaluations; (2) sample the gas
every second step beyond 10 Rs; (3) the hole layer at a quarter of the
resolution instead of a third while falling. Nothing changes away from
the hole: `shown < 0.5` still returns at once, and the layer is 4x4 px.

The full-resolution work in `universe.frag` per pixel near the hole adds
the tetrad (one boost, ~60 flops) and the classifier (~30 flops): small
against a texture read.

## 10. Files and testing

New `lib/kerr.js` (pure functions on numbers, `.pragma library`), used by
`fall.js` (`.import "kerr.js" as Kerr`; the test harness strips the
import and prepends the sibling file) and ported line for line into the
shaders:

- constants: `horizons(M, a)`, `photonOrbit(M, a, sign)`, `polarPhotonOrbit`,
  `isco(M, a, sign)`;
- `ksRadius(x, a, sheet)`, `ksMetric(x, a, M, sheet)` (r, f, l, gradients),
  `sheetAt`;
- `ksTetrad`, `boostFrame`, `cameraRay(x, u, n)` -> (p_i, E, L_z, Q);
- `axisInfaller(r, E_f)` -> u^t, u^z; `axisFall(r0 or E_f)` tabulated r(tau);
- `rk4Step`, `traceRay(state, maxSteps)` with the shader's exact step rule,
  returning escaped/lost/other, the direction and the step count;
- `radialMin(E, L, Q, r_lo, r_hi)` (the classifier), `gasVelocity(r)`.

`tests/test_kerr.js lib/kerr.js`:

1. horizons r+- for chi in {0, 0.5, 0.94, 0.998} vs M +- sqrt(M^2 - a^2);
   chi = 1 gives r+ = r- = M.
2. equatorial photon orbits vs the closed forms (Bardeen 1972); checked
   independently as roots of r^3 - 3Mr^2 +- 2a sqrt(M) r^(3/2) = 0; the
   polar orbit vs Teo 2003; a = 0 gives 3M for all.
3. ISCO vs Bardeen, Press & Teukolsky 1972: chi = 0 -> 6M, chi = 1 -> M
   (prograde) and 9M (retrograde), chi = 0.94 -> 2.0236 M.
4. the tetrad: g(E_a, E_b) = eta_ab to 1e-12 at random points outside, in
   the ergoregion, between the horizons, inside r- and on the r < 0 sheet
   for the static (where it exists), KS-frame and axis-falling observers;
   at a = 0 the axis infaller's (E, b, s) equal `hole.frag`'s formulas.
5. the axis fall: dr/dtau from the table vs the closed form, r(tau) and
   tau(r) inverse, proper time r+ -> r- vs a fine quadrature (14.90 s for
   chi = 0.94 from 6 Rs); a = 0 reproduces `fall.js`'s 28.7 s inside and
   15.7 min total; the from-rest fall has (dr/dtau)^2 < 0 for all r < 0
   and turns at a^2/r0; E_f = 1.5 has (dr/dtau)^2 > 0 everywhere and
   sqrt(1 + M/a) is the threshold.
6. conservation along traced rays (double precision, the shader's step
   rule): E exact, |dL_z/L_z| and |dQ/Q| < 1e-5 over a full trace, for
   rays from the 20 Rs and 6 Rs hover cameras and from the falling camera
   at r+ + 0.05, between the horizons, and (math) at r = -2 Rs.
7. a = 0 regression: for the hover camera at 20 Rs and a fan of impact
   parameters from 0.5 to 50 Rs (skipping the 1 % band at b_crit), the KS
   trace's bend angle agrees with today's Verlet march (ported) within
   0.2 degrees and with the exact Schwarzschild integral within 0.1
   degrees; captured/escaped agree on every ray; the falling camera's
   escape direction agrees with `sweepOut/sweepIn/sweepTurn` within 0.1
   degrees (the existing reference in `test_fall.js`).
8. the classifier: on a grid of 2000 rays from several cameras, the sign
   of `radialMin` agrees with the traced outcome except within 1 % of the
   critical curve; at a = 0 it equals sign(b - B_CRIT) with the s rule.
9. the gas: g_mn u u = -1 for the circular orbits from r_isco to 30 Rs;
   Omega -> Kepler as r -> infinity; the face-on shift equals
   sqrt(1 - 3M/r + 2a sqrt(M) r^(-3/2)).
10. math mode: a backward ray from the axis camera at r = -3 Rs aimed
    straight back at the disk centre reaches r > 0, crosses r- and r+
    and escapes to our sky; one aimed 60 degrees off reaches r = -60;
    a ray aimed at the ring is lost.

`tests/test_fall.js` keeps its checks, now for a = 0 (identical numbers)
and chi = 0.94 (new numbers), with the shader's exit-angle functions
replaced by the KS trace port. All existing tests keep passing; `qmllint
Background.qml` (at `/usr/lib/qt6/bin/qmllint`) stays at 28 lines.

Shaders are rebuilt with the README command and the `.qsb` committed.
Visual checks are done by the user at the desk (no screen capture by the
agent): the shadow from 20 Rs, the equatorial view, the fall in both
modes, `status()` through every phase.

## 11. Risks

- The from-rest fall does not reach r < 0 (§5). The design uses a plunge
  with E_f = 1.5 in math mode and says so everywhere. If the user prefers
  the honest from-rest continuation (bounce and a new positive-r
  universe), it is a different second half: the trajectory code handles
  it already, the rendering of the white-hole exit would be new work.
- fp32 near the ring and the horizons: the KS functions are regular at
  the horizons, but the ring's 1/sqrt(distance) and the 0/0 in z/r need
  the guarded forms of §2; tests are in double, so a float32 emulation
  of `ksRadius` near the disk (Math.fround) is included for that function.
- Cost: RK4 may land at 2x or a little over on the 3080 Ti at 5K; the
  three mitigations of §9 are ordered and tested before use.
- The hue approximation (§8) on the photon ring where both sides of the
  torus overlap. If it shows, a second layer pass for the direction only
  is the fallback (doubles the trace cost; not planned).
- The edge classifier assumes no bound photon orbits outside r+ (true in
  Kerr) and the hover camera outside the ergoregion (enforced by the 6 Rs
  park distance). Between the horizons it is replaced by E > 0; inside
  r- by the trace.
- The chart's edge: backward rays stalling at r+ from inside are drawn
  dark after 40 stalled steps; a too-loose stall test would cost steps, a
  too-tight one would darken sky rays that pass near the horizon. Tuned
  on the test grid.
- Letting go off the axis (§5): a glide to the pole changes the feel of
  "B at 6 Rs lets go now"; the free-flight-crossing path jumps. Both are
  stated in the README.
- `status()` gains a fourth field; scripts that split on spaces and read
  the first three keep working, ones that compare the whole string do not.

## 12. Implementation notes (what the code does where it differs from the plan)

Written after the implementation (branch `kerr`); the plan above is left as
it was.

- **The weak-field tail** at R_OUT is not the Newtonian (2M/b)(1 - sqrt(1 -
  b^2/R^2)): the coordinate direction at finite R is already tilted toward
  the asymptote (the coordinate radial speed is sqrt(E^2 - f L^2/r^2), not
  the flat one), and the remaining turn is a tenth of that estimate. To
  first order in M, with s = b/R, it is (M/b)(2 - (2 - s^2 - s^4)/sqrt(1 -
  s^2)) ~ 3 M b^3 / (4 R^4), toward the hole. With it the march agrees with
  the exact Schwarzschild integral to 0.005 degrees from 20 Rs; without it,
  0.15 degrees for the widest traced rays.
- **The step rule** has no upper clamp: ds = max(0.02, 0.12 (|r| - 0.3)).
  Far out the steps grow with r, so a far camera starts its march where it
  stands (33 steps from 3000 Rs to 60 Rs) instead of sliding to the R_OUT
  entry with the flat direction, which was the old tracer's approximation
  (up to 0.5 degrees off the exact deflection for the widest rays).
- **Lost rays are cut early**: outside r+ a backward ray diving below 0.98
  of the prograde photon orbit radius can never come back out, so it stops
  there instead of spiralling to the horizon for 30 stalled steps. E <= 0
  rays are dark without a march.
- **The old hovering camera** read the Euclidean look direction as the
  coordinate direction; the new one is the proper static frame, b = r sin(a)
  / sqrt(1 - 1/r) at a = 0. The shadow seen from 20 Rs is 2.6 % larger than
  before, which is the correct aberration; the a = 0 regression is
  therefore ray-by-ray (bend angle for a given impact parameter against the
  exact integral and the old Verlet march) rather than pixel-by-pixel.
- **The layer's layout**: rg is a "bend vector" (alpha cos psi, alpha sin
  psi) about the look direction in the basis (toward the hole, its
  perpendicular), not an octahedral map: at a = 0 it is the old bend angle
  with psi = 0, so bilinear interpolation of the layer behaves as it did,
  and frame dragging only twists psi smoothly. Dark rays keep their glow
  colour in rgb with a = -1 (no bend vector is needed for them); the other
  universe is b = -1; a = 0 means no trace. universe.frag reads the layer
  through a four-texel gather that falls back to the nearest texel where the
  four are not of one kind, so a sky direction is never blended with a
  sentinel.
- **Between the horizons** the design's rule "E > 0 crosses r+" is exact
  for the axis camera because L_z = 0 there (in general the horizon's
  Killing energy E - Omega_H L_z decides). The design's face-on gas shift
  "sqrt(1 - 3M/r + 2a sqrt(M)/r^1.5)" was wrong; the code and test use 1/u^t
  with Bardeen, Press & Teukolsky's u^t.
- **Carter's constant** is computed in two regular forms: from the radial
  equation (dividing by Delta) for the hovering camera, and as p_theta^2 =
  (r^2 + a^2)(k_x^2 + k_y^2) for the axis camera, which is finite at both
  horizons.
- **The fall table** integrates r'' = M (a^2 - r^2)/(r^2 + a^2)^2 with RK4
  (regular everywhere, through the disk) and interpolates with cubic
  Hermite; a = 0 keeps the cycloid in closed form so `test_fall.js`'s old
  numbers are untouched to the last digit.
- **Letting go off the pole** glides there by steering the orbit camera's
  yaw/pitch targets (the existing easing, ~1.5 s) and lets go within half a
  degree of the pole; the B descent aims at the pole from the start.
- **The inner-horizon flash** is a `flash` uniform of hole.frag, sqrt(2.5 s /
  time left) over the last 2.5 s (it runs through the 2 s fade, so it is
  seen), applied to the glow through `shifted()`. Below r- the glow is off.
- **status()** prints `<view> <phase or -> <r signed> <real|math>`.

## Design page: Sgr A* as a Kerr black hole

**What is modelled.** Sagittarius A* as a Kerr black hole with spin
a/M = 0.94 (the EHT 2022 best-bet model; uncertain), seen by tracing a
light ray backward from every pixel through the exact Kerr geometry in
Kerr-Schild coordinates: the shadow (D-shaped at high spin, when seen from
the side), the photon ring, frame dragging of the lensed sky, and a hot
torus on prograde Kerr circular orbits with its Doppler, gravitational and
frame-dragging shifts computed from the 4-velocities. The fall goes down
the spin axis from rest at 6 Rs through the outer horizon (0.67 Rs; nothing
marks it) to the inner horizon (0.33 Rs), 15 s of proper time inside, in
the frame of the falling observer. A separate, labelled "mathematics" mode
follows the maximally extended solution through the inner horizon and the
disk inside the ring singularity into the negative-r universe, where the
hole repels, and shows that universe's sky and our own sky through the
throat inside the ring.

**Equations.** Metric g = eta + f l l, f = 2Mr^3/(r^4 + a^2 z^2); rays by
the Hamiltonian H = 1/2 g^mn p_m p_n, RK4; observers by a local boost of
the Kerr-Schild tetrad; the axis fall (dr/dtau)^2 = E^2 - 1 + 2Mr/(r^2+a^2);
horizons M +- sqrt(M^2 - a^2); circular orbits and the ISCO from Bardeen,
Press & Teukolsky 1972; the shadow's edge from the minimum of R(r)/r^4,
R the Kerr radial potential.

**Sources.** EHT Collaboration 2022 Papers I and V; Daly et al. 2024;
Fragione & Loeb 2020 (the dissenting low-spin case); Bardeen, Press &
Teukolsky 1972; Teo 2003 (spherical photon orbits); Carter 1968; Penrose
1968, Poisson & Israel 1990, Ori 1991 (the inner horizon's instability);
GRAVITY 2019 (mass and distance).

**Not modelled, honestly.** The gas is a false-colour impression: the real
flow emits in radio and infrared and is invisible to the eye; inside the
ISCO it plunges rather than orbits; the thick torus's velocity off the
plane is the plane's. The glow of infalling gas is the spherical
Schwarzschild model. The realistic fall ends at the inner horizon because
the physics does: a real hole's inner horizon is unstable (mass
inflation), light there is blueshifted without bound and the Kerr
solution beyond it describes nothing observed; the final flash is a
cartoon of that. The mathematics mode is the exact solution, not physics,
and a fall from rest never reaches the negative-r universe at all (it
turns back at a^2/r0); to get there the mode starts with a 0.75 c plunge,
which no observer at rest at 6 Rs could make. The other universe's sky is
invented, because the solution says nothing about what is in it. The
camera hovers only outside the ergoregion, lets go only on the axis, and
the sky direction is quantised to about 1e-3 radians by the 16-bit
intermediate texture.
