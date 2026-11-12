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
};

const float R_OUT = 60.0;   // beyond this, bending is left to the weak-field formula
const float R_IN = 1.0;     // the horizon

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

void main() {
    if (shown < 0.5) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0);
    vec3 v = normalize(camFwd + camRight * p.x - camUp * p.y);
    vec3 v0 = v;
    vec3 x = camPos;

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
        if (r < R_IN) { fell = true; break; }
        if (r > R_OUT + 1.0 && dot(x, v) > 0.0) break;
        // smaller steps near the hole, where paths curve hardest
        float dt = clamp(0.11 * (r - 0.9), 0.025, 3.0) * (i == 0 ? jitter + 0.5 : 1.0);
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
    float bend = acos(clamp(dot(normalize(v), v0), -1.0, 1.0));
    fragColor = vec4(L, fell ? -1.0 : bend);
}
