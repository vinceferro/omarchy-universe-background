#version 440

// Sagittarius A* up close: every pixel's light ray is traced backward through
// the curved spacetime of a Schwarzschild black hole, at half resolution,
// only while the camera is near the hole.
//
// Units: Schwarzschild radii (Rs = 2GM/c^2 = 0.085 AU for 4.3 million Suns),
// centred on the hole. A light ray's path obeys u'' + u = 3/2 u^2 (u = 1/r);
// written for a 3D position x it is the "Newtonian" acceleration
// a = -3/2 h^2 x / r^5 with h = |x cross v| conserved, which bends rays
// exactly as the Schwarzschild metric does (photon sphere at 1.5 Rs, shadow
// edge at 2.6 Rs). Rays that cross the horizon are lost: the shadow.
//
// The gas: Sgr A* is fed by a faint, hot, geometrically thick flow (it emits
// mostly in radio and infrared). It is drawn as a thick turbulent torus
// orbiting at the local circular speed, so its light is Doppler-boosted on the
// approaching side and dimmed and reddened deep in the gravity well (g^3.5).
// The flow's far side, lensed over the top of the shadow, and the photon ring
// are not painted: they come out of the ray tracing.
//
// Output: rgb = light from the gas along the ray (optically thin: it does not
// hide what is behind), a = how far the ray was bent in total (radians), or
// -1 if it fell in. universe.frag lenses the sky with that angle at full
// resolution, so the stars stay sharp.
//
// The fall (fallE > 0): the camera is no longer standing still but falling
// freely, from rest at 6 Rs, with energy per unit mass E = sqrt(1 - 1/r0)
// (lib/fall.js). What such an observer sees in a given direction is a
// different light ray from what a hovering one sees: aberration, and below
// the horizon no observer can hover at all. So the look direction is first
// turned into the ray's constants of motion in the falling observer's own
// frame (the radially infalling tetrad of the Schwarzschild metric):
//   e = E - n_r sqrt(E^2 - f)       the ray's energy at infinity (f = 1 - 1/r)
//   b = r n_t / e                   its impact parameter (Rs)
//   s = sqrt(E^2 - f) - n_r E       sign: traced backward, does it climb (> 0)?
// with n the direction the light travels (opposite to the look direction),
// n_r its outward radial part and n_t its transverse part. e <= 0 is light
// that would have to come out of the hole: dark. Below 1.5 Rs any ray
// heading inward is lost, and so is one with b > B_CRIT. Where a ray left
// is not left to the step-limited march (from deep inside, rays crawl out
// too slowly for 200 steps): it is the exact integral of the shape
// equation, phi = ∫ du / sqrt(1/b^2 - u^2 + u^3) along the ray, as an angle
// from the outward radial in the ray's own plane (a). universe.frag reads
// the sky there and applies the frequency shift 1/e: blue toward the
// horizon line, red behind. The march then only collects the gas's light.
//
// What lies below (infallGlow): the dark directions, the shadow from outside
// and the cap toward the centre once inside, are not quite black. Gas that
// fell in ahead of us is there, and its light reaches us: outside, climbing
// to us from below; inside, where everything falls, light sent by gas when
// it was still above where we are now, caught because we fall faster than
// that light does. The model gas is a steady spherical inflow from rest far
// out (energy per unit mass 1, dr/dtau = -1/sqrt(r)), optically thin, with
// emissivity r^-3 (density squared, for a constant mass flux through
// 4 pi r^2) inside the torus's inner edge, where the drawn flow ends. Its
// light comes out already shifted (a = -1 tells universe.frag so), faint.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 resolution;
    float shown;      // 0: not near the hole, draw nothing
    vec3 camPos;      // camera, in Schwarzschild radii from the hole
    vec3 camFwd;
    vec3 camRight;
    vec3 camUp;
    float aspect;
    vec3 spinAxis;    // the flow's rotation axis (world frame)
    float flowTime;   // seconds of gas motion (in Rs/c units: 1 Rs/c = 42 s)
    float fallE;      // 0: the camera hovers; else it falls, with this energy per unit mass
};

const float R_OUT = 60.0;   // beyond this, bending is left to the weak-field formula
const float R_IN = 1.0;     // the horizon
const float B_CRIT = 2.598076211;   // 3 sqrt(3) / 2: the impact parameter of the photon sphere

// The fall's exit angle: the midpoint rule on stretches of the ray's path
// chosen so that the integrand stays smooth (u = 1/r, c = 1/b^2; checked
// against a fine reference in tests/test_fall.js).
// from infinity in to u = umax (<= 1) with no turning point on the way
float sweepOut(float umax, float c) {
    float h = umax / 48.0, acc = 0.0;
    for (int i = 0; i < 48; i++) {
        float u = (float(i) + 0.5) * h;
        acc += inversesqrt(max(c - u * u * (1.0 - u), 1e-12));
    }
    return acc * h;
}
// on from the horizon (u = 1) down to r < 1: with u = 1/x^2 the integrand
// is 2 / sqrt(1 - x^2 + c x^6), x from sqrt(r) to 1
float sweepIn(float r, float c) {
    float x0 = sqrt(r), h = (1.0 - x0) / 24.0, acc = 0.0;
    for (int i = 0; i < 24; i++) {
        float x = x0 + (float(i) + 0.5) * h, x2 = x * x;
        acc += inversesqrt(max(1.0 - x2 + c * x2 * x2 * x2, 1e-12));
    }
    return 2.0 * acc * h;
}
// b > B_CRIT outside the photon sphere: the ray turns at ua, the smallest
// root of u^3 - u^2 + c; the whole sweep is 2 ∫_0^ua, minus (climbing) or
// plus (diving) ∫_u^ua. With u = ua (1 - t^2) the square-root end is
// smooth: ∫ du / sqrt(P) = 2 sqrt(ua) ∫ dt / sqrt(Q), Q = P / (ua - u)
float sweepTurn(float u, float c, bool diving) {
    float ua = 1.0 / 3.0 + 2.0 / 3.0 * cos(acos(clamp(1.0 - 13.5 * c, -1.0, 1.0)) / 3.0 - 2.0943951);
    float tu = sqrt(max(1.0 - u / ua, 0.0));
    float h1 = 1.0 / 32.0, h2 = tu / 32.0, a1 = 0.0, a2 = 0.0;
    for (int i = 0; i < 32; i++) {
        float t = (float(i) + 0.5) * h1, q = ua * (1.0 - t * t);
        a1 += inversesqrt(max(-q * q + (1.0 - ua) * q + ua * (1.0 - ua), 1e-12));
        t = (float(i) + 0.5) * h2; q = ua * (1.0 - t * t);
        a2 += inversesqrt(max(-q * q + (1.0 - ua) * q + ua * (1.0 - ua), 1e-12));
    }
    return 2.0 * sqrt(ua) * (a1 * h1 + (diving ? a2 * h2 : -a2 * h2));
}

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

// emissivity of the hot flow at x (Rs), before Doppler and redshift
float flowDensity(vec3 x, vec3 e1, vec3 e2) {
    float r = length(x);
    float h = dot(x, spinAxis);                 // height above the mid-plane
    float rc = length(x - spinAxis * h);        // cylindrical radius
    // thick torus, inner edge near the innermost stable orbit (3 Rs)
    float radial = smoothstep(2.6, 3.6, rc) * pow(max(rc, 1.0), -2.2) * (1.0 - smoothstep(14.0, 30.0, rc));
    float thick = exp(-(h * h) / (0.18 * rc * rc + 0.05));
    if (radial * thick < 2e-4) return 0.0; // no gas here: skip the turbulence
    // turbulence, sheared by the orbit: inner gas laps the outer
    float ang = atan(dot(x, e2), dot(x, e1));
    float omega = 0.7071 / pow(max(rc, 1.5), 1.5); // Kepler, in rad per Rs/c
    float a = ang - omega * flowTime;
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

// The gas falling in ahead of us, seen along one of our light rays. The ray
// is given by its constants of motion per unit of the frequency we measure
// (so that we measure 1): e, its energy at infinity, and L, its angular
// momentum; both come out of the tetrad formulas in main (e = E - n_r w,
// L = r n_t). At radius r the ray's radial speed is
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
    float K = max(sqrt(max(e * e - f * L * L / (r * r), 0.0)), 1e-5);
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
    // faint: the bright rim near the singularity is softly clipped
    float lum = dot(I, vec3(0.2126, 0.7152, 0.0722));
    return I / (1.0 + lum / 0.25);
}

void main() {
    if (shown < 0.5) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0);
    vec3 v = normalize(camFwd + camRight * p.x - camUp * p.y);
    vec3 v0 = v;
    vec3 x = camPos;
    // the falling camera: the ray this look direction really belongs to
    float fallPhi = -1.0;   // its exit angle (-1: no sky this way)
    if (fallE > 0.0) {
        float r = length(x);
        vec3 xh = x / r;
        float f = 1.0 - 1.0 / r;
        float vr = dot(v, xh);
        vec3 vt = v - xh * vr;
        float nt = length(vt);
        vec3 th = nt > 1e-4 ? vt / nt : normalize(cross(xh, abs(xh.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
        nt = max(nt, 1e-3);
        float w = sqrt(max(fallE * fallE - f, 0.0));   // the observer's speed, dr/dtau
        float n1 = -vr;                                 // the light's outward component
        float e = fallE - n1 * w;
        float s = w - n1 * fallE;
        float c = e * e / (r * r * nt * nt);            // 1/b^2
        // where the ray left, exactly (e <= 0 is light that would have to
        // come out of the hole); a lost ray never climbs past 1.5 Rs, so it
        // sees none of the flow: only the gas falling in ahead of us
        if (e > 0.0) {
            if (r * nt < B_CRIT * e) { if (s > 0.0) fallPhi = sweepOut(min(1.0 / r, 1.0), c) + (r < 1.0 ? sweepIn(r, c) : 0.0); }
            else if (r >= 1.5) fallPhi = sweepTurn(1.0 / r, c, s < 0.0);
        }
        if (fallPhi < 0.0) { fragColor = vec4(infallGlow(r, fallE, w, e, s, r * nt, v0), -1.0); return; }
        // the march for the gas starts along that ray: transverse speed 1,
        // radial speed from (dr/dphi)^2 = r^2 (r^2/b^2 - f), the whole scaled
        // to unit speed far out so the steps below keep their meaning
        v = (xh * (sign(s) * sqrt(max(r * r * c - f, 0.0))) + th) * (nt / e);
    }

    // start where the ray enters the region of strong bending
    float b = dot(x, v);
    float c = dot(x, x) - R_OUT * R_OUT;
    if (c > 0.0) {
        float disc = b * b - c;
        if (b > 0.0 || disc < 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
        x += v * (-b - sqrt(disc));
    }

    vec3 e1 = normalize(cross(spinAxis, abs(spinAxis.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
    vec3 e2 = cross(spinAxis, e1);
    vec3 h3 = cross(x, v);
    float h2 = dot(h3, h3);
    vec3 L = vec3(0.0);
    bool fell = false;
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    for (int i = 0; i < 200; i++) {
        float r = length(x);
        if (fallE > 0.0 ? (r < 1.5 && dot(x, v) < 0.0) : (r < R_IN)) { fell = true; break; }
        if (r > R_OUT + 1.0 && dot(x, v) > 0.0) break;
        // smaller steps near the hole, where paths curve hardest; the fall's
        // rays can be fast near the centre, so there the steps go by distance
        float dt = clamp(0.11 * (r - 0.9), 0.025, 3.0);
        if (fallE > 0.0) dt = (r < 1.5 ? 0.05 * r : dt) / max(length(v), 1.0);
        dt *= (i == 0 ? jitter + 0.5 : 1.0);
        // velocity Verlet on a = -3/2 h^2 x / r^5
        float r2 = r * r;
        vec3 a0 = -1.5 * h2 * x / (r2 * r2 * r);
        vec3 vh = v + a0 * dt * 0.5;
        x += vh * dt;
        float r1 = length(x);
        float r12 = r1 * r1;
        v = vh - 1.5 * h2 * x / (r12 * r12 * r1) * dt * 0.5;

        float j = flowDensity(x, e1, e2);
        if (j > 1e-4) {
            // Doppler and gravitational shift: the gas orbits at the local
            // circular speed; light climbing out of the well loses energy
            float hgt = dot(x, spinAxis);
            vec3 cyl = x - spinAxis * hgt;
            float rc = max(length(cyl), 1.6);
            vec3 orbit = normalize(cross(spinAxis, cyl));
            float beta = min(0.75, sqrt(0.5 / (rc - 1.0)));
            float gamma = inversesqrt(1.0 - beta * beta);
            vec3 toCam = -normalize(v);
            float g = sqrt(max(1.0 - 1.0 / r1, 0.02)) / (gamma * (1.0 - beta * dot(orbit, toCam)));
            float boost = pow(g, 3.5);
            // hotter-looking where boosted, deep red where redshifted
            vec3 tint = mix(vec3(1.0, 0.36, 0.10), vec3(1.0, 0.80, 0.55), smoothstep(0.5, 1.2, g));
            tint = mix(tint, vec3(0.92, 0.94, 1.0), smoothstep(1.2, 1.9, g));
            float dl = dt * length(v);
            L += tint * j * boost * dl * 1.6;
        }
    }
    if (fallE > 0.0) { fragColor = vec4(L, fallPhi); return; }
    if (fell) {
        // the shadow, seen hovering: lit only by the gas falling in ahead; a
        // hovering observer at r0 has E = sqrt(f), w = 0, and a ray with unit
        // frequency here has e = sqrt(f), L = r0 sin(a) (the march's h)
        float r0 = length(camPos);
        float e0 = sqrt(max(1.0 - 1.0 / max(r0, 1.0001), 1e-6));
        fragColor = vec4(L + infallGlow(r0, e0, 0.0, e0, -1.0, sqrt(h2), v0), -1.0);
        return;
    }
    float bend = acos(clamp(dot(normalize(v), v0), -1.0, 1.0));
    fragColor = vec4(L, bend);
}
