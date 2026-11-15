#version 440

// Sagittarius A* up close: every pixel's light ray is traced backward through
// the curved spacetime of a spinning (Kerr) black hole, at a third of the
// resolution, only while the camera is near the hole.
//
// Units: Schwarzschild radii (Rs = 2GM/c^2 = 0.085 AU for 4.3 million Suns),
// centred on the hole, so the mass is M = 0.5 and the spin a = (a/M) M is in
// Rs too. Sgr A*'s spin is not measured; a/M = 0.94 (Background.qml) is the
// EHT 2022 Paper V best-bet model (a MAD flow at 30 degrees inclination),
// with Daly et al. 2024 near 0.9 and Fragione & Loeb 2020 arguing for < 0.1
// from the S stars' orbits: one uniform, `spin`, changes it; 0 gives the
// Schwarzschild picture this replaced.
//
// The geometry is written in Kerr-Schild Cartesian coordinates (Kerr &
// Schild 1965; Visser 2007), g = eta + f l l with
//   f = 2 M r^3 / (r^4 + a^2 z^2)
//   l = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z/r)
// and r the Boyer-Lindquist radius, the root of r^4 - (rho^2 - a^2) r^2 -
// a^2 z^2 = 0, with the spin axis along z (the world's `spinAxis`). It is one
// Cartesian chart that the camera and the gas already live in, regular at
// both horizons r+- = M +- sqrt(M^2 - a^2), and it extends through the disk
// r = 0 (x^2 + y^2 < a^2 on the plane z = 0; its rim is the ring singularity)
// to negative r, the other asymptotically flat universe of the maximally
// extended solution, by the same formulas with r signed. The point does not
// say which side of the disk a ray is on, so each ray carries `sheet` (+1 or
// -1), flipped when it crosses the plane inside the ring. Light rays are the
// Hamiltonian flow of H = 1/2 g^mn p_m p_n, which needs no Christoffel
// symbols: with l.p = E + l_i k_i (p_t = -E is conserved),
//   dx^i/dL = k_i - f (l.p) l_i
//   dk_i/dL = 1/2 (l.p)^2 df/dx^i + f (l.p) (dl_j/dx^i) k_j
// stepped with RK4 (lib/kerr.js has the same march in double precision, and
// tests/test_kerr.js checks it against the exact Schwarzschild integral at
// a = 0 and the conserved quantities at a/M = 0.94). The shadow, the photon
// ring, the D-shaped flattening of the shadow at high spin seen from the side,
// and the twist frame dragging gives the lensed sky all come out of this
// tracing; nothing is painted.
//
// The observer. A screen direction becomes a photon through the camera's
// orthonormal frame: because l is null, e_a = delta_a - (f/2) l_a l is a
// tetrad everywhere, and the camera's frame is a local boost of it to its
// 4-velocity u (hovering: u = (1/sqrt(1-f), 0, 0, 0); falling down the axis:
// u^t = (E^2 (1 + f) + f^2) / (E + f w), spatial speed w = sqrt(E^2 - 1 + f)
// along the axis, f = 2Mr/(r^2+a^2) there, regular at both horizons). The
// photon seen in look direction v is k = u - v^i E_i (observed frequency 1);
// E = -k_t is its energy at infinity, so the sky's frequency ratio seen over
// emitted is 1/E (universe.frag applies it). At a = 0 this reproduces the old
// e = E - n_r w, b = r n_t / e, s = w - n_r E of the radial infaller exactly.
// Between the horizons a ray with E <= 0 is light that would have to come
// out of the hole: dark.
//
// The gas: Sgr A* is fed by a faint, hot, geometrically thick flow (it emits
// mostly in radio and infrared). It is drawn as a thick turbulent torus on
// prograde circular orbits of the Kerr metric (Bardeen, Press & Teukolsky
// 1972), Omega = sqrt(M) / (r^1.5 + a sqrt(M)), with its inner edge at the
// innermost stable orbit (3 Rs at a = 0, 1.01 Rs at a/M = 0.94). A sample of
// gas turning with the plane's Omega(r) about the axis has 4-velocity
// u = N (d_t + Omega (x d_y - y d_x)), N from g(u, u) = -1, and sees our ray
// with frequency -k.u = N (E - Omega L_z): Doppler, transverse Doppler, the
// gravitational shift and frame dragging in one line (L_z = x k_y - y k_x is
// conserved). Its light is weighted g^3.5 (I_nu / nu^3 is invariant, spectral
// index 0.5); the flow's far side lensed over the shadow and the photon ring
// are not painted either.
//
// Output (RGBA16F), read by universe.frag at full resolution:
//   a sky ray     rg = where it left, as a "bend vector" (alpha cos psi,
//                 alpha sin psi) about the look direction in the basis
//                 (toward the hole, perpendicular to it); b = the gas's light
//                 along the way (intensity); a = its intensity-weighted mean
//                 shift g (> 0), for the tint (where both sides of the torus
//                 lie on one ray the hue is the mean, not the mix)
//   a dark ray    rgb = the glow of the gas falling in ahead (below), a = -1
//   other universe (math mode: the ray ran to r -> -infinity)  rg = the bend
//                 vector, b = -1, a = 1
//   no trace      0 (the ray never came within R_OUT: universe.frag uses the
//                 weak-field series)
// Beyond R_OUT the direction still turns, but less than the Newtonian estimate
// says: the coordinate direction at R is already tilted toward the asymptote.
// The remaining turn toward the hole is, to first order in M (s = b/R),
//   delta = (M/b) (2 - (2 - s^2 - s^4) / sqrt(1 - s^2))  ~  3 M b^3 / (4 R^4)
//
// What lies below (infallGlow): the dark directions, the shadow from outside
// and the cap toward the centre once inside, are not quite black. Gas that
// fell in ahead of us is there, and its light reaches us: outside, climbing
// to us from below; inside, where everything falls, light sent by gas when
// it was still above where we are now, caught because we fall faster than
// that light does. The model gas is a steady spherical inflow from rest far
// out (energy per unit mass 1, dr/dtau = -1/sqrt(r)), optically thin, with
// emissivity r^-3 (density squared, for a constant mass flux through
// 4 pi r^2) inside the torus's inner edge, where the drawn flow ends. It is
// kept as the Schwarzschild cartoon it was (the ray's E and sqrt(K) stand in
// for e and L), a hint of light rather than a model, and is off on the far
// sheet. Its light comes out already shifted (a = -1 tells universe.frag
// so), faint. `flash` (> 1 in the last seconds before the inner horizon)
// shifts it blue and bright: a labelled cartoon of the inner horizon's
// instability, where infalling light is blueshifted without bound (Penrose
// 1968; Poisson & Israel 1990).

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 resolution;
    float shown;      // 0: not near the hole, draw nothing
    vec3 camPos;      // camera, in Schwarzschild radii from the hole (world frame)
    vec3 camFwd;
    vec3 camRight;
    vec3 camUp;
    float aspect;
    vec3 spinAxis;    // the hole's spin axis = the flow's rotation axis (world frame, unit)
    float flowTime;   // seconds of gas motion (in Rs/c units: 1 Rs/c = 42 s)
    float fallE;      // 0: the camera hovers; else it falls down the axis, with this energy per unit mass
    float spin;       // a, in Rs (a/M = 2 a)
    float camSheet;   // +1: our side of the disk; -1: the camera is on the r < 0 sheet (math mode)
    float flash;      // 1; > 1 in the last seconds before the inner horizon (the glow's blueshift)
};

const float M = 0.5;        // the mass, in Rs
const float R_OUT = 60.0;   // beyond this, the remaining bend is the weak-field tail
const int STEPS = 180;
const float B_CRIT = 2.598076211;   // 3 sqrt(3) / 2: Schwarzschild's critical impact parameter (the glow cartoon)

// ---- the Kerr-Schild metric ----
struct KS {
    float r;    // Boyer-Lindquist radius, signed by the sheet
    float f;
    vec3 l;     // l_i
    vec3 dr;    // dr/dx_i
    vec3 df;    // df/dx_i
    mat3 dl;    // dl[i] = (dl_x, dl_y, dl_z)/dx_i
    float A;    // r^2 + a^2
    float D;    // r^4 + a^2 z^2
};

// the root of r^4 - (rho^2 - a^2) r^2 - a^2 z^2 = 0, both branches without cancellation
float ksRadius(vec3 x, float sheet) {
    float d = dot(x, x) - spin * spin;
    float S = sqrt(d * d + 4.0 * spin * spin * x.z * x.z);
    float r2 = d >= 0.0 ? 0.5 * (d + S) : 2.0 * spin * spin * x.z * x.z / (S - d);
    return sheet * sqrt(r2);
}
// the sheet after moving from x0 (on s0) to x1: flipped if the segment crosses the plane inside the ring
float sheetAt(vec3 x0, float s0, vec3 x1) {
    if (x0.z == 0.0 || (x0.z > 0.0) == (x1.z > 0.0)) return s0;
    float t = x0.z / (x0.z - x1.z);
    vec2 c = x0.xy + (x1.xy - x0.xy) * t;
    return dot(c, c) < spin * spin ? -s0 : s0;
}
// r, f, l and their gradients at x: from the quartic,
//   dr/dx = r^3 x / D   dr/dy = r^3 y / D   dr/dz = r z (r^2 + a^2) / D
KS ksMetric(vec3 x, float sheet) {
    KS m;
    float a = spin;
    float r = ksRadius(x, sheet);
    if (abs(r) < 1e-5) r = sheet * 1e-5;       // the disk's centre: the 1/r terms below stay finite times f
    float r2 = r * r, r3 = r2 * r;
    m.A = r2 + a * a;
    m.D = max(r2 * r2 + a * a * x.z * x.z, 1e-12);
    m.f = 2.0 * M * r3 / m.D;
    // z / r, guarded where both vanish near the disk: (z/r)^2 = (r^2 - rho^2 + a^2) / a^2
    float cz = (r2 > 1e-6 || a == 0.0) ? x.z / r
             : sign(x.z) * sign(r) * sqrt(max(0.0, (r2 - dot(x, x) + a * a) / (a * a)));
    m.l = vec3((r * x.x + a * x.y) / m.A, (r * x.y - a * x.x) / m.A, cz);
    m.dr = vec3(r3 * x.x, r3 * x.y, r * x.z * m.A) / m.D;
    // f = 2 M r^3 / D: df = (6 M r^2 dr - f dD) / D, dD = 4 r^3 dr + 2 a^2 z dz
    vec3 dD = 4.0 * r3 * m.dr + vec3(0.0, 0.0, 2.0 * a * a * x.z);
    m.df = (6.0 * M * r2 * m.dr - m.f * dD) / m.D;
    vec3 q = 2.0 * r * m.dr / m.A;              // the derivative of 1/A, relative
    m.r = r;
    // dl[i] = d l / d x_i
    m.dl[0] = vec3((x.x * m.dr.x + r) / m.A - m.l.x * q.x, (x.y * m.dr.x - a) / m.A - m.l.y * q.x, -cz * m.dr.x / r);
    m.dl[1] = vec3((x.x * m.dr.y + a) / m.A - m.l.x * q.y, (x.y * m.dr.y + r) / m.A - m.l.y * q.y, -cz * m.dr.y / r);
    m.dl[2] = vec3((x.x * m.dr.z) / m.A - m.l.x * q.z, (x.y * m.dr.z) / m.A - m.l.y * q.z, (1.0 - cz * m.dr.z) / r);
    return m;
}
// V_m = eta_mn V^n + f l_m (l_n V^n), l_t = 1
vec4 lower(KS m, vec4 V) {
    float lv = V.x + dot(m.l, V.yzw);
    return vec4(-V.x + m.f * lv, V.yzw + m.f * m.l * lv);
}
// the photon's own motion (forward in its affine parameter), covariant k_i, energy E
void motion(KS m, vec3 k, float E, out vec3 dx, out vec3 dk) {
    float lp = E + dot(m.l, k);
    float flp = m.f * lp;
    dx = k - flp * m.l;
    dk = 0.5 * lp * lp * m.df + flp * vec3(dot(m.dl[0], k), dot(m.dl[1], k), dot(m.dl[2], k));
}
// the camera's frame, boosted from the Kerr-Schild tetrad to its 4-velocity
// u, and the photon seen in look direction v: k^m = u^m - v^i E_i^m, lowered
vec4 cameraRay(KS m, vec4 u, vec3 v) {
    float f2 = 0.5 * m.f;
    vec4 e0 = vec4(1.0 + f2, -f2 * m.l);
    vec4 e1 = vec4(f2 * m.l.x, vec3(1.0, 0.0, 0.0) - f2 * m.l.x * m.l);
    vec4 e2 = vec4(f2 * m.l.y, vec3(0.0, 1.0, 0.0) - f2 * m.l.y * m.l);
    vec4 e3 = vec4(f2 * m.l.z, vec3(0.0, 0.0, 1.0) - f2 * m.l.z * m.l);
    vec4 ul = lower(m, u);
    float gamma = -dot(ul, e0);
    vec3 beta = vec3(dot(ul, e1), dot(ul, e2), dot(ul, e3)) / gamma;
    float b2 = dot(beta, beta);
    vec4 be = beta.x * e1 + beta.y * e2 + beta.z * e3;
    float k1 = b2 > 1e-12 ? (gamma - 1.0) / b2 : 0.0;
    vec4 E1 = e1 + (k1 * beta.x) * be + (gamma * beta.x) * e0;
    vec4 E2 = e2 + (k1 * beta.y) * be + (gamma * beta.y) * e0;
    vec4 E3 = e3 + (k1 * beta.z) * be + (gamma * beta.z) * e0;
    return lower(m, u - v.x * E1 - v.y * E2 - v.z * E3);
}

// ---- the gas ----
float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                   mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                   mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// the gas's angular velocity at Boyer-Lindquist radius r (prograde, BPT 1972), rad per Rs/c
float gasOmega(float r, float isco) {
    return sqrt(M) / (pow(max(r, isco), 1.5) + spin * sqrt(M));
}
// emissivity of the hot flow at x (Kerr-Schild coordinates, the spin axis
// along z; r its Boyer-Lindquist radius), before Doppler and redshift
float flowDensity(vec3 x, float r, float isco) {
    float h = x.z;                              // height above the mid-plane
    float rc = length(x.xy);                    // cylindrical radius
    // thick torus, inner edge at the innermost stable orbit
    float radial = smoothstep(isco - 0.1, isco + 0.9, r) * pow(max(rc, 1.0), -2.2) * (1.0 - smoothstep(14.0, 30.0, rc));
    float thick = exp(-(h * h) / (0.18 * rc * rc + 0.05));
    if (radial * thick < 2e-4) return 0.0; // no gas here: skip the turbulence
    // turbulence, sheared by the orbit: inner gas laps the outer
    float ang = atan(x.y, x.x);
    float a = ang - gasOmega(r, isco) * flowTime;
    vec3 q = vec3(cos(a) * rc, sin(a) * rc, h * 1.6);
    float turb = 0.45 + 1.1 * noise3(q * 0.9) * (0.6 + 0.8 * noise3(q * 2.3 + 7.0));
    return radial * thick * turb;
}

// starlight seen with a frequency shift g (seen over emitted): as in
// universe.frag, the same formula, so the gas and the sky agree
vec3 shifted(vec3 c, float g) {
    float k = clamp(g, 0.05, 6.0);
    vec3 tint = k > 1.0 ? mix(vec3(1.0), vec3(0.55, 0.78, 1.45), clamp((k - 1.0) * 1.6, 0.0, 1.0))
                        : mix(vec3(1.35, 0.62, 0.40), vec3(1.0), clamp(k * 1.6 - 0.4, 0.0, 1.0));
    return c * tint * min(k * k * k, 10.0);
}

// The gas falling in ahead of us, seen along one of our light rays (the
// Schwarzschild cartoon; r is |r|). The ray is given by its constants of
// motion per unit of the frequency we measure (so that we measure 1): e, its
// energy at infinity, and L, its angular momentum. At radius r the ray's
// radial speed is
//   K = |dr/dlambda| = sqrt(e^2 - f L^2 / r^2)                 f = 1 - 1/r
// and gas falling there with energy 1 and speed w_g = 1/sqrt(r), 4-velocity
// (1/f, -w_g) in t and r, measures the ray's frequency
//   omega_e = -k.u = (e + sig K w_g) / f
// with sig the sign of dr/dlambda along the light: +1 climbing to us from gas
// ahead, outside the horizon; -1 inside, where everything falls, and on the
// downhill part of a ray that turned. The gas at our own radius with our own
// energy would measure 1: a check in tests/test_fall.js. We receive its light
// with the ratio g = 1 / omega_e, and since I_nu / nu^3 is invariant and the
// gas is optically thin, the intensity is ∫ g^3 j dl_e = ∫ j g^3 / K dr
// (dl_e = omega_e dlambda in the gas's frame, dlambda = dr / K). Both ends can
// be steep (the gas is densest where we are; K vanishes at a turning point),
// so each stretch is sampled a dozen times in a variable that flattens its
// ends, and shifted() colours each sample as it does the sky; checked
// against a fine quadrature in tests/test_fall.js.
const float GLOW = 0.05;            // the inflow's emissivity at 1 Rs
vec3 glowSample(float r, float e, float L, float sig) {
    float f = 1.0 - 1.0 / r;
    float K2 = e * e - f * L * L / (r * r);
    if (K2 <= 0.0) return vec3(0.0);            // the ray never reaches this radius
    float K = sqrt(K2);
    // g = 1 / omega_e = f / (e + sig K / sqrt(r)); downhill (sig < 0) the
    // denominator cancels toward the horizon, so it is multiplied out:
    // f / (e - K / sqrt(r)) = (e + K / sqrt(r)) / (e^2 + L^2 / r^3)
    float kr = K * inversesqrt(r);
    float g = sig > 0.0 ? f / (e + kr) : (e + kr) / (e * e + L * L / (r * r * r));
    float j = GLOW / (r * r * r) * (1.0 - smoothstep(3.0, 5.0, r));
    return shifted(vec3(1.0, 0.70, 0.40), g) * (j / K);
}
// a stretch of the ray from ra to rb, with r = ra + (rb - ra) (3 t^2 - 2 t^3):
// both ends flattened, for a turning point (K ~ sqrt of the distance to it)
// at either end, or one grazed where we stand
vec3 glowLegS(float ra, float rb, float e, float L, float sig) {
    if (abs(rb - ra) < 1e-6) return vec3(0.0);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
        float t = (float(i) + 0.5) / 12.0;
        acc += glowSample(ra + (rb - ra) * t * t * (3.0 - 2.0 * t), e, L, sig) * 6.0 * t * (1.0 - t);
    }
    return acc * abs(rb - ra) / 12.0;
}
// inside: the dive down to us at r0, from rm, in q = r^-3.5, which makes the
// gas's r^-4.5 rise toward us (r^-3, and g^3 / K ~ r^-3/2) flat
vec3 glowLegQ(float r0, float rm, float e, float L) {
    float qm = pow(rm, -3.5), h = (pow(r0, -3.5) - qm) / 8.0;
    if (h < 1e-7) return vec3(0.0);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float q = qm + (float(i) + 0.5) * h;
        float r = pow(q, -2.0 / 7.0);
        acc += glowSample(r, e, L, -1.0) * (2.0 / 7.0) * r * r * r * r * sqrt(r);   // dr = 2/7 q^(-9/7) dq
    }
    return acc * h;
}
// where a ray with 1/b^2 = c, below the photon sphere, turns: the largest
// root of u^3 - u^2 + c (u = 1/r), between 2/3 and 1
float turnBelow(float c) {
    return 1.0 / (1.0 / 3.0 + 2.0 / 3.0 * cos(acos(clamp(1.0 - 13.5 * c, -1.0, 1.0)) / 3.0));
}
// the glow along a dark ray from the observer at r0 (energy E, speed w,
// hovering: E = sqrt(f), w = 0): e, s and L as in main, dir the look
// direction (world), for a hint of clumpiness that is not traced
vec3 infallGlow(float r0, float E, float w, float e, float s, float L, vec3 dir) {
    vec3 I;
    if (r0 < 1.0) {
        // the dive from the horizon to us: dense at our end for the rays
        // looking down, a broad hump higher up (near 2/3 Rs) for the rays
        // along the cap's edge, so the stretch is split
        float rm = min(1.0, 2.5 * r0);
        I = glowLegQ(r0, rm, e, L) + glowLegS(rm, 1.0, e, L, -1.0);
        if (e > 0.0) {                                    // from outside: it turned just above the horizon
            float rt = turnBelow(e * e / (L * L));
            I += glowLegS(rt, 1.0, e, L, 1.0) + glowLegS(rt, 1.0, e, L, -1.0);
        }
    } else if (s < 0.0) {
        I = glowLegS(min(r0, 5.0), 1.0, e, L, 1.0);       // the shadow: light climbing from the gas ahead
    } else {                                              // below 1.5 Rs, light that turned above us
        float rt = turnBelow(e * e / (L * L));
        I = glowLegS(rt, 1.0, e, L, 1.0) + glowLegS(rt, r0, e, L, -1.0);
    }
    I *= 0.7 + 0.6 * noise3(dir * 3.0);   // fixed on the sky: the gas ahead falls much as we do
    I = shifted(I, flash);                // the inner horizon's flash (1 otherwise)
    // faint: the bright rim near the singularity is softly clipped
    float lum = dot(I, vec3(0.2126, 0.7152, 0.0722));
    return I / (1.0 + lum / 0.25);
}

// the escape direction's bend vector about the look direction v: alpha the
// angle between them, psi its azimuth in the basis (n1 toward the hole, n2)
vec2 bendEncode(vec3 v, vec3 n1, vec3 n2, vec3 d) {
    float alpha = acos(clamp(dot(d, v), -1.0, 1.0));
    vec2 p = vec2(dot(d, n1), dot(d, n2));
    float pl = length(p);
    return pl < 1e-6 ? vec2(alpha, 0.0) : alpha * p / pl;
}

void main() {
    if (shown < 0.5) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    float a = spin;
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0);
    vec3 vW = normalize(camFwd + camRight * p.x - camUp * p.y);   // the look direction, world
    // a ray from a far camera that never comes near the hole: nothing to trace
    {
        float b = dot(camPos, vW);
        float c = dot(camPos, camPos) - R_OUT * R_OUT;
        if (c > 0.0 && (b > 0.0 || b * b - c < 0.0)) { fragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
    }
    // the hole's own frame: the spin axis along z
    vec3 e1 = normalize(cross(spinAxis, abs(spinAxis.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
    vec3 e2 = cross(spinAxis, e1);
    mat3 K2W = mat3(e1, e2, spinAxis);
    mat3 W2K = transpose(K2W);
    vec3 x = W2K * camPos;
    vec3 v = W2K * vW;
    float sheet = camSheet;
    // the basis universe.frag decodes the bend vector in (world)
    vec3 toHole = -camPos;
    vec3 n1 = toHole - vW * dot(toHole, vW);
    if (dot(n1, n1) < 1e-10) n1 = abs(vW.x) < 0.9 ? vec3(0.0, vW.z, -vW.y) : vec3(vW.z, 0.0, -vW.x);
    n1 = normalize(n1);
    vec3 n2 = cross(vW, n1);

    // the hole's numbers
    float rPlus = M + sqrt(max(M * M - a * a, 0.0)), rMinus = M - sqrt(max(M * M - a * a, 0.0));
    float rPh = 0.98 * 2.0 * M * (1.0 + cos(2.0 / 3.0 * acos(clamp(-a / M, -1.0, 1.0))));   // just inside the prograde photon orbit
    float chi = a / M;
    float Z1 = 1.0 + pow(1.0 - chi * chi, 1.0 / 3.0) * (pow(1.0 + chi, 1.0 / 3.0) + pow(1.0 - chi, 1.0 / 3.0));
    float Z2 = sqrt(3.0 * chi * chi + Z1 * Z1);
    float isco = M * (3.0 + Z2 - sqrt(max(0.0, (3.0 - Z1) * (3.0 + Z1 + 2.0 * Z2))));

    // the camera's ray
    KS m = ksMetric(x, sheet);
    float rCam = m.r;
    vec4 u;
    float w = 0.0;
    if (fallE > 0.0) {
        float fa = 2.0 * M * rCam / (rCam * rCam + a * a);
        w = sqrt(max(fallE * fallE - 1.0 + fa, 0.0));
        vec3 pole = sheet * normalize(x);     // the pole we fell from; the fall goes on in the same direction
        u = vec4((fallE * fallE * (1.0 + fa) + fa * fa) / (fallE + fa * w), -w * pole);
    } else {
        u = vec4(inversesqrt(max(1.0 - m.f, 1e-4)), 0.0, 0.0, 0.0);
    }
    vec4 k4 = cameraRay(m, u, v);
    float E = -k4.x;
    vec3 k = k4.yzw;
    float Lz = x.x * k.y - x.y * k.x;
    bool camInside = fallE > 0.0 && rCam < rPlus;
    // the ray's constants for the glow cartoon: Carter's K (= L^2 at a = 0)
    // from the axis form when falling, from the radial equation when hovering
    vec3 dx0, dk0;
    motion(m, k, E, dx0, dk0);
    float rdot = -dot(m.dr, dx0);               // backward: > 0 climbing
    float Kc;
    if (fallE > 0.0) Kc = m.A * dot(k.xy, k.xy);
    else {
        float Sigma = m.D / (rCam * rCam), Delta = rCam * rCam - 2.0 * M * rCam + a * a;
        float EA = E * m.A - a * Lz;
        Kc = (EA * EA - Sigma * Sigma * rdot * rdot) / Delta;
    }
    float Lg = sqrt(max(Kc, 0.0));
    if (E <= 0.0) {                              // light that would have to come out of the hole
        fragColor = vec4(rCam > rMinus ? infallGlow(rCam, fallE, w, E, sign(rdot), Lg, vW) : vec3(0.0), -1.0);
        return;
    }

    // the march
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    int outcome = 0;                             // 0 lost, 1 our sky, 2 the other universe
    int stall = 0;
    float I = 0.0, Ig = 0.0;                     // the gas's light, and its shift-weighted sum
    vec3 dir = -dx0;
    for (int i = 0; i < STEPS; i++) {
        float r = m.r;
        motion(m, k, E, dx0, dk0);
        dx0 = -dx0; dk0 = -dk0;                  // backward along the light
        if (dot(x, x) > (R_OUT + 1.0) * (R_OUT + 1.0) && dot(x, dx0) > 0.0) { outcome = sheet > 0.0 ? 1 : 2; dir = dx0; break; }
        float rc = length(x.xy);
        if ((rc - a) * (rc - a) + x.z * x.z < 2.5e-5) break;                      // the ring singularity
        // outside r+ and diving below the innermost photon orbit: no way back out
        // (and from a camera outside, nothing below r+ at all)
        float rd = dot(m.dr, dx0);
        if (r > rPlus - 0.01 && r < rPh && rd < 0.0) break;
        if (!camInside && r < rPlus - 0.01) break;
        // stuck at a horizon: the chart's edge (light from a universe we do not model)
        if (abs(r - rPlus) < 0.03 || abs(r - rMinus) < 0.03) { stall++; if (stall > 30) break; } else stall = 0;
        // smaller steps near the horizons and the ring, where paths curve hardest
        float ds = max(0.02, 0.12 * (abs(r) - 0.3)) * (i == 0 ? jitter + 0.5 : 1.0);
        float hh = ds / max(length(dx0), 1e-6);
        // RK4 on (x, k), the sheet rule at every stage
        vec3 dx1, dk1, dx2, dk2, dx3, dk3;
        vec3 x1 = x + 0.5 * hh * dx0, k1 = k + 0.5 * hh * dk0;
        motion(ksMetric(x1, sheetAt(x, sheet, x1)), k1, E, dx1, dk1);
        vec3 x2 = x - 0.5 * hh * dx1, k2 = k - 0.5 * hh * dk1;
        motion(ksMetric(x2, sheetAt(x, sheet, x2)), k2, E, dx2, dk2);
        vec3 x3 = x - hh * dx2, k3 = k - hh * dk2;
        motion(ksMetric(x3, sheetAt(x, sheet, x3)), k3, E, dx3, dk3);
        vec3 xn = x + hh / 6.0 * (dx0 - 2.0 * dx1 - 2.0 * dx2 - dx3);
        k += hh / 6.0 * (dk0 - 2.0 * dk1 - 2.0 * dk2 - dk3);
        sheet = sheetAt(x, sheet, xn);
        x = xn;
        m = ksMetric(x, sheet);
        // the gas (our sheet only)
        if (sheet > 0.0 && m.r > isco - 0.2 && m.r < 32.0) {
            float j = flowDensity(x, m.r, isco);
            if (j > 1e-4) {
                // the sample's 4-velocity N (d_t + Omega d_phi) and the shift it sees
                float Om = gasOmega(m.r, isco);
                float rc2 = dot(x.xy, x.xy);
                float lV = 1.0 - a * Om * rc2 / m.A;
                float gVV = -1.0 + Om * Om * rc2 + m.f * lV * lV;
                if (gVV < -1e-3) {
                    float g = 1.0 / (inversesqrt(-gVV) * (E - Om * Lz));
                    g = clamp(g, 0.02, 8.0);
                    float boost = pow(g, 3.5);
                    float dl = ds * j * boost * 1.6;
                    I += dl;
                    Ig += dl * g;
                }
            }
        }
    }
    if (outcome == 0) {
        // the shadow, or the dark below: lit only by the gas falling in ahead.
        // Hovering, the Schwarzschild cartoon takes e = E (= sqrt(f) at a = 0)
        // and L = e b, b a hair under B_CRIT at most: the grazing ray circles
        // the photon sphere (the log-divergent photon ring), beyond 12 samples.
        // Below the inner horizon (math mode) there is no modelled gas: black.
        vec3 glow = vec3(0.0);
        if (rCam > rMinus) {
            if (fallE > 0.0) glow = infallGlow(rCam, fallE, w, E, sign(rdot), Lg, vW);
            else glow = infallGlow(rCam, E, 0.0, E, -1.0, E * min(Lg / E, B_CRIT * 0.999), vW);
        }
        fragColor = vec4(glow, -1.0);
        return;
    }
    dir = normalize(dir);
    if (outcome == 1) {
        // the weak-field tail: the direction still turns toward the hole beyond R_OUT
        float R = length(x);
        float along = dot(x, dir);
        vec3 perp = x - dir * along;
        float b = length(perp);
        if (b > 1e-6) {
            float s2 = min(b * b / (R * R), 0.81);
            float delta = (M / b) * (2.0 - (2.0 - s2 - s2 * s2) * inversesqrt(1.0 - s2));
            dir = dir * cos(delta) - perp / b * sin(delta);
        }
    }
    vec2 bend = bendEncode(vW, n1, n2, K2W * dir);
    if (outcome == 2) { fragColor = vec4(bend, -1.0, 1.0); return; }
    fragColor = vec4(bend, I, I > 0.0 ? Ig / I : 1.0);
}
