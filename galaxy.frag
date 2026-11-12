#version 440

// The Milky Way as a volume, for the galaxy view: rendered at a third of the
// screen size into a float layer that universe.frag upscales and puts stars
// behind. Units are kiloparsecs in the Galactocentric frame of Reid et al.
// 2019: X toward Galactic longitude 90, Y from the Galactic Centre to the Sun
// (which sits at Y = 8.15, Z = +0.021), Z toward the North Galactic Pole.
//
// The disk is a face-on map (young stars, HII regions, dust lanes) built from
// the measured spiral arms, stretched into 3D with measured scale heights:
// old stars 300 pc (thick disk 900 pc), young stars ~90 pc, dust 134 pc. The
// boxy bulge and the long bar are analytic (Wegg et al. 2013, 2015), at 27
// degrees to the Sun-Centre line with the near end at positive longitude.
// Andromeda and Triangulum reuse the same disk at their real distances,
// sizes and tilts; the Magellanic Clouds are soft clumpy glows.
//
// Output: rgb = light reaching the camera, a = how much of what is behind
// (the stars) still shows through the dust.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 resolution;
    float shown;      // 0: the view is closed, draw nothing
    vec3 camPos;      // kpc
    vec3 camFwd;
    vec3 camRight;
    vec3 camUp;
    float aspect;
    vec4 m31Pos;      // centre (kpc), size relative to the Milky Way
    vec3 m31Major;
    vec3 m31Normal;
    vec4 m33Pos;
    vec3 m33Major;
    vec3 m33Normal;
    vec4 lmc;         // centre (kpc), radius (1 sigma)
    vec4 smc;
    float exposure;
    float spin;       // time-lapse: the disk turned this far (radians, with Galactic rotation)
};

layout(binding = 1) uniform sampler2D youngTex;
layout(binding = 2) uniform sampler2D dustTex;

const float EXT = 16.0;          // the maps cover +-16 kpc
const float RMAX = 17.0;
const float HMAX = 1.8;
const float DUSTK = 3.2;         // extinction per kpc at full map dust
const vec2 BAR = vec2(0.45399, 0.89101); // sin, cos of 27 degrees: the bar's long axis

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                   mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                   mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// light and dust at a point of a galaxy, in its own frame (kpc, disk in xy)
void sampleDisk(vec3 p, float lod, out vec3 emit, out float dust) {
    float R = length(p.xy);
    float az = abs(p.z);
    vec2 uv = vec2(0.5 + p.x / (2.0 * EXT), 0.5 - p.y / (2.0 * EXT));
    vec3 y = textureLod(youngTex, uv, lod).rgb;
    float d = textureLod(dustTex, uv, lod).r;
    y *= y;
    d *= d;
    float edge = 1.0 - smoothstep(13.5, 17.0, R);
    float old = exp(-R / 2.6) * (exp(-az / 0.30) + 0.12 * exp(-az / 0.90)) * edge;
    float u = dot(p.xy, BAR);
    float v = dot(p.xy, vec2(BAR.y, -BAR.x));
    float bulge = exp(-sqrt((u / 0.70) * (u / 0.70) + (v / 0.44) * (v / 0.44) + (p.z / 0.18) * (p.z / 0.18)));
    float bar = exp(-pow(abs(u) / 4.0, 4.0)) * exp(-(v / 0.9) * (v / 0.9)) * exp(-az / 0.18);
    emit = vec3(1.0, 0.80, 0.58) * (old * 0.55 + bulge * 1.0 + bar * 0.35)
         + y * (1.1 * exp(-az / 0.09)) * edge;
    dust = d * exp(-az / 0.134) * DUSTK;
}

// ray through one galaxy, front to back; returns light and transmittance
vec4 marchDisk(vec3 ro, vec3 rd, float jitter, float pxAngle, float scale) {
    float t0 = 0.0;
    float t1 = 1e9;
    if (abs(rd.z) > 1e-6) {
        float ta = (-HMAX - ro.z) / rd.z;
        float tb = (HMAX - ro.z) / rd.z;
        t0 = max(t0, min(ta, tb));
        t1 = min(t1, max(ta, tb));
    } else if (abs(ro.z) > HMAX) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }
    float a = dot(rd.xy, rd.xy);
    float b = dot(ro.xy, rd.xy);
    float c = dot(ro.xy, ro.xy) - RMAX * RMAX;
    float disc = b * b - a * c;
    if (a < 1e-9 || disc < 0.0) {
        if (a < 1e-9 && c < 0.0) { /* straight up or down inside the disk */ }
        else return vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        float sq = sqrt(disc);
        t0 = max(t0, (-b - sq) / a);
        t1 = min(t1, (-b + sq) / a);
    }
    if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);

    // steps bunch up near the camera, where detail is largest on screen
    const int N = 64;
    float len = t1 - t0;
    vec3 L = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < N; i++) {
        float s0 = (float(i) + jitter) / float(N);
        float s1 = (float(i) + 1.0 + jitter) / float(N);
        float ta = t0 + len * s0 * s0;
        float dt = len * (s1 * s1 - s0 * s0);
        vec3 p = ro + rd * ta;
        // texture detail no finer than a pixel at this distance
        float texel = 2.0 * EXT / 2048.0;
        float lod = log2(max(ta * pxAngle / texel, 1.0));
        vec3 e;
        float d;
        sampleDisk(p, lod, e, d);
        float tau = d * dt * scale; // dt is in the galaxy's own units
        float tr = exp(-tau);
        // light emitted inside a step is dimmed by that step's own dust too
        L += T * e * dt * scale * (tau > 1e-4 ? (1.0 - tr) / tau : 1.0);
        T *= tr;
        if (T < 0.01) break;
    }
    return vec4(L, T);
}

vec4 otherGalaxy(vec3 ro, vec3 rd, vec4 pos, vec3 major, vec3 normal, float jitter, float pxAngle) {
    vec3 minor = cross(normal, major);
    vec3 o = (ro - pos.xyz) / pos.w;
    vec3 lo = vec3(dot(o, major), dot(o, minor), dot(o, normal));
    vec3 ld = vec3(dot(rd, major), dot(rd, minor), dot(rd, normal));
    // cheap reject: the ray misses its bounding sphere
    float tb = -dot(lo, ld);
    if (dot(lo, lo) - tb * tb > RMAX * RMAX * 1.2) return vec4(0.0, 0.0, 0.0, 1.0);
    return marchDisk(lo, ld, jitter, pxAngle, pos.w);
}

// a dwarf galaxy: a clumpy glow, integrated along the ray in closed form
vec3 cloud(vec3 ro, vec3 rd, vec4 c, vec3 tint) {
    vec3 oc = c.xyz - ro;
    float tc = dot(oc, rd);
    vec3 closest = ro + rd * max(tc, 0.0) - c.xyz;
    float d2 = dot(closest, closest);
    float s = c.w;
    float clump = 0.6 + 0.8 * noise3(closest / s * 1.6) * noise3(closest / s * 3.3 + 3.1);
    return tint * exp(-d2 / (2.0 * s * s)) * s * 0.06 * clump * smoothstep(-s, s, tc);
}

void main() {
    if (shown < 0.5) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0);
    vec3 rd = normalize(camFwd + camRight * p.x - camUp * p.y);
    float pxAngle = 1.0 / resolution.y;
    // per-pixel offset of the march (interleaved gradient noise): no banding
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    // into the disk's own frame: undo the time-lapse turn
    float cs = cos(spin);
    float sn = sin(spin);
    mat2 unspin = mat2(cs, sn, -sn, cs); // (x, y) -> (x c - y s, y c + x s)
    vec3 mro = vec3(unspin * camPos.xy, camPos.z);
    vec3 mrd = vec3(unspin * rd.xy, rd.z);
    vec4 mw = marchDisk(mro, mrd, jitter, pxAngle, 1.0);
    vec3 col = mw.rgb;
    float T = mw.a;

    // the Magellanic Clouds sit outside the disk: in front of or behind it
    vec3 clouds = cloud(camPos, rd, lmc, vec3(0.92, 0.90, 1.0)) + cloud(camPos, rd, smc, vec3(0.90, 0.90, 1.0));
    bool cloudsFront = length(camPos - lmc.xyz) < length(camPos);
    col = cloudsFront ? clouds + col : col + T * clouds;

    // Andromeda and Triangulum, far beyond: behind the Milky Way unless we
    // have flown out to them
    vec4 a31 = otherGalaxy(camPos, rd, m31Pos, m31Major, m31Normal, jitter, pxAngle);
    vec4 a33 = otherGalaxy(camPos, rd, m33Pos, m33Major, m33Normal, jitter, pxAngle);
    bool m33First = length(camPos - m33Pos.xyz) < length(camPos - m31Pos.xyz);
    vec3 far = m33First ? a33.rgb + a33.a * a31.rgb : a31.rgb + a31.a * a33.rgb;
    float farT = a31.a * a33.a;
    if (length(camPos - m31Pos.xyz) < length(camPos) * 0.5) {
        col = far + farT * col;
    } else {
        col = col + T * far;
    }
    T *= farT;

    col *= exposure;
    col = 1.0 - exp(-col); // soft shoulder: the bulge never clips
    fragColor = vec4(col, T);
}
