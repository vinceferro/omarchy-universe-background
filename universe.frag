#version 440

// Full-resolution pass: upscales the soft sky from nebula.frag and draws the
// sharp parts on top: realistic stars, a small solar system, the occasional
// shooting star or satellite, and the HUD. Space stays true black for the
// OLED. The pointer shifts every layer by its depth (parallax), and in
// navigation mode the camera flies forward through the star layers.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    vec2 resolution;
    vec4 accent;     // theme accent (Color.accent)
    float hudLevel;  // HUD brightness, 0 hides it
    vec2 view;       // eased pointer offset from the screen centre, -0.5..0.5
    vec2 hudCenter;  // HUD centre in p coordinates (drift and pointer applied)
    float flight;    // distance travelled forward, in star-layer depths
    float cpu;       // gauges, 0..1
    float gpu;
    float mem;
    float secs;      // position within the current minute, 0..1
    vec2 pan;        // sideways travel in navigation mode
    float exposure;  // 1 behind windows, brighter on an empty workspace
    float boot;      // HUD draw-in at startup, 0..1
    vec4 orbit0;     // per planet: semi-major axis, eccentricity, argument of
    vec4 orbit1;     //   perihelion (radians), unused
    vec4 orbit2;
    vec4 orbit3;
    vec4 orbit4;
    vec4 orbit5;
    vec4 spinA;      // rotation phase of planets 0-3 (radians)
    vec2 spinB;      // rotation phase of planets 4-5
    float sysHover;  // pointer over the solar system in the universe view, 0..1
    // The one solar-system camera (lib/camera.js): a pinhole camera whose eye
    // sits relative to the scene reference point (the focus). The overview is
    // this camera at a 2.4-degree field of view (focal 24: it looks
    // orthographic); the chase view is the same camera at 53 degrees, reached
    // by a dolly zoom (fov changes, view height fixed), so every frame in
    // between is a real camera too.
    vec3 camPos;     // the eye, relative to the scene reference point
    vec3 camFwd;
    vec3 camRight;
    vec3 camUp;
    float focal;     // focal length, screen heights (0.5 / tan(fov / 2))
    vec2 principal;  // principal point: where the focus sits on screen (p units; the corner view)
    vec4 body0;      // per body: centre relative to the scene reference point, radius
                     // (display units: the overview's squeezed scale, or true scale)
    vec4 body1;
    vec4 body2;
    vec4 body3;
    vec4 body4;
    vec4 body5;
    float pinned;    // pinned planet 1-6 in the system view, else 0
    float earthTheta; // Earth's rotation (Greenwich sidereal angle), radians
    vec3 earthPole;  // Earth's north pole direction (axial tilt)
    vec3 home;       // direction of our spot on Earth, from its centre
    float moonOrbit; // Earth-Moon distance in the overview (true scale when zoomed in)
    vec4 moonBody;   // the Moon, like body0..5
    vec4 sunBody;    // the Sun, like body0..5
    float planeY;    // the ecliptic (y = 0), relative to the reference
    vec3 moonFace;   // direction from the Moon to Earth (it keeps one face to us)
    float galactic;  // 0..1: galactic view on, the flat overview fades out
    vec4 sysBound;   // screen box (p units: centre, half sizes) holding every body, orbit and glow; z = 0: none
    float guides;    // 0..1: orbit rings and the Sun vector (off by default: space has no lines)
    float galaxyMix; // 0..1: the Milky Way view (galaxy.frag volume + stars + the chosen hotspot)
    vec3 gxCam;      // its camera, kpc (Galactocentric, Z north)
    vec3 gxFwd;
    vec3 gxRight;
    vec3 gxUp;
    vec4 gxFocus;    // chosen hotspot: centre (kpc), diameter (kpc); w = 0 for none
    vec4 gxFocusCol; // its colour; a = kind (0 nebula, 1 cluster, 2 globular, 3 remnant, 4 star, 5 black hole, 6 dwarf galaxy)
    float gxStars;   // how much of the Milky Way's own stars surround the camera (0 far outside it)
    float gxRealSky; // 0..1: near the Sun, the real sky replaces the model
    vec4 gxPhoto;    // chosen place's photo: tile, width (kpc; 0 = none), north's screen angle, cos of view vs Earth's
    float skyMix;    // 0..1: Sky mode (look around the real sky from Earth)
    vec3 skyFwd;
    vec3 skyRight;
    vec3 skyUp;
    float skyFocal;
    float skyStaticMix; // 0..1: exactly on a named view: its native 5K render
    float photoHiReady; // 1 once the chosen place's close-up photo has loaded
    vec4 galFlow;    // galactic view: interstellar dust drift (xy offset), direction it streams (zw)
    float gxFallE;   // > 0: the camera is falling into Sgr A* with this energy per unit mass (hole.frag)
    float gxFallFade; // 0..1: the fall's fade to black (and back, beside the Sun)
    vec3 gxSpinAxis; // Sgr A*'s spin axis (world frame, unit): the gas's rotation axis, the fall's line
    float gxSpin;    // its spin a, in Schwarzschild radii (a/M = 2a; 0: Schwarzschild)
    float gxCamSheet; // +1; -1 once the falling camera is through the disk, on the r < 0 sheet (math mode)
    vec2 holeRes;    // the hole tracer's layer size, px
};

// NASA maps, equirectangular: Blue Marble (day), Black Marble (night lights),
// LRO colour map of the Moon (near side at the centre)
layout(binding = 2) uniform sampler2D earthDay;
layout(binding = 3) uniform sampler2D earthNight;
layout(binding = 4) uniform sampler2D moonTex;
layout(binding = 5) uniform sampler2D galaxyTex; // galaxy.frag: rgb light, a = transmittance
layout(binding = 6) uniform sampler2D holeTex;   // hole.frag: the ray's bend vector, the gas's light and shift (see holeKind)
// the real sky (NASA SVS Deep Star Maps 2020, galactic): Sky mode, and the
// galaxy view near the Sun
layout(binding = 8) uniform sampler2D skyFull;
layout(binding = 9) uniform sampler2D skyStatic;  // Sky mode: the 5K render of the named view
layout(binding = 10) uniform sampler2D photoAtlas; // real photos of the places, 4 x 4 tiles
layout(binding = 11) uniform sampler2D photoHi;    // the chosen place's own 2048 px photo

// rgb: soft sky, a: star density (see nebula.frag), rendered OVERSCAN times
// larger than the screen
layout(binding = 1) uniform sampler2D nebulaTex;
const float OVERSCAN = 1.05;

const float TAU = 6.2831853;
// The clock wraps at 600 s, so periodic motion uses whole multiples of one
// cycle per 600 s and never jumps at the wrap.
const float W = TAU / 600.0;

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * clamp(p - 1.0, 0.0, 1.0);
}

// Theme tint: replace a built-in colour's hue with the accent's hue (plus an
// offset), keeping its brightness. Greyish accents leave colours untouched.
vec3 themed(vec3 c, float hueOffset) {
    vec3 a = rgb2hsv(accent.rgb);
    float w = smoothstep(0.15, 0.35, a.y);
    vec3 o = rgb2hsv(c);
    vec3 t = hsv2rgb(vec3(fract(a.x + hueOffset), max(o.y, a.y * 0.9), o.z));
    return mix(c, t, w);
}

// ssin() wrapper: GPU range reduction loses precision for large arguments, so
// reduce the argument modulo 2*pi first (mathematically identical).
float ssin(float x) {
    return sin(mod(x, 6.2831853));
}

// hashes without sine (Dave Hoskins): no visible lattice patterns
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// star colour by temperature: mostly white and yellow-white, some blue, orange, red
vec3 starColor(float h) {
    return h < 0.12 ? vec3(0.70, 0.80, 1.00)
         : h < 0.45 ? vec3(0.95, 0.97, 1.00)
         : h < 0.75 ? vec3(1.00, 0.94, 0.84)
         : h < 0.92 ? vec3(1.00, 0.82, 0.62)
         :            vec3(1.00, 0.66, 0.50);
}

// One star layer in cell coordinates g (cellPx pixels per cell). Each cell
// holds at most one star, kept away from the cell edge, so the four cells
// around the nearest corner are enough. Brightness follows a steep power law:
// many faint stars, few bright ones. Space has no air, so barely any twinkle.
vec3 starLayer(vec2 g, float cellPx, float density, float t, float sizeK, float clusF) {
    vec3 col = vec3(0.0);
    vec2 base = floor(g - 0.5);
    for (int j = 0; j <= 1; j++) {
        for (int i = 0; i <= 1; i++) {
            vec2 id = base + vec2(float(i), float(j));
            if (hash12(id) < density * clusF) {
                vec2 sp = 0.2 + 0.6 * hash22(id + 31.7);
                float d = length(g - id - sp) * cellPx;
                float b = 0.10 + 1.6 * pow(hash12(id + 5.5), 9.0);
                float sigma = (0.55 + 0.9 * b) * sizeK;
                float tw = 1.0 + 0.08 * ssin(t * (0.6 + hash12(id + 13.1)) + hash12(id + 7.3) * TAU);
                float core = exp(-d * d / (2.0 * sigma * sigma));
                float halo = exp(-d / (3.5 * sigma)) * 0.06;
                col += starColor(hash12(id + 99.1)) * b * tw * (core + halo);
            }
        }
    }
    return col;
}

// Three star layers at depths d (0 far .. 1 near). Nearer layers have bigger
// stars and move more with the pointer. Flying forward moves every layer
// nearer; a layer fades out as it passes the camera and comes back far away
// as a new field.
vec3 starfield(vec2 p, float t, float clusF) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 3; i++) {
        float k = flight + 0.15 + 0.33 * float(i);
        float d = fract(k);
        float cycle = mod(floor(k), 64.0);
        float scale = 60.0 * pow(0.25, d);
        float fade = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.86, 1.0, d));
        vec2 q = p + (view * 0.09 + pan) * (0.15 + d) + vec2(0.004, 0.0012) * (0.4 + d) * t;
        vec2 g = q * scale + cycle * vec2(17.31, 41.73);
        col += fade * starLayer(g, resolution.y / scale, mix(0.55, 0.75, d), t, mix(0.8, 1.3, d), clusF);
    }
    return col;
}

// A few bright foreground stars with soft four-point diffraction spikes.
vec3 brightStars(vec2 p, float t) {
    float scale = 4.0;
    vec2 g = (p + (view * 0.09 + pan) * 1.2) * scale;
    vec2 id = floor(g);
    if (hash12(id + 61.3) > 0.30) return vec3(0.0);
    vec2 rel = (g - id - (0.3 + 0.4 * hash22(id + 4.4))) * resolution.y / scale; // pixels
    float b = 0.5 + 0.6 * hash12(id + 8.8);
    float d = length(rel);
    float core = exp(-d * d / 4.5);
    float halo = exp(-d / 9.0) * 0.12;
    vec2 a = abs(rel);
    float len = 45.0 + 50.0 * b;
    float spikes = (exp(-a.x * 1.1) * exp(-a.y / len) + exp(-a.y * 1.1) * exp(-a.x / len)) * 0.35;
    float tw = 1.0 + 0.05 * ssin(t * 0.7 + hash12(id) * TAU);
    return starColor(hash12(id + 99.1)) * b * tw * (core + halo + spikes * smoothstep(120.0, 0.0, d));
}

// ---- solar system -----------------------------------------------------------

// 2D simplex noise (Gustavson / Ashima, MIT) for planet surfaces
vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm4(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) {
        v += a * snoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}

// fbm whose octaves fade out once they get finer than a pixel. fp is the
// pixel size in noise units at p's own frequency, so far-away surfaces
// settle to their average colour instead of shimmering.
float fbmL(vec2 p, float fp) {
    float v = 0.0;
    float a = 0.5;
    float f = 1.0;
    for (int k = 0; k < 7; k++) {
        float w = 1.0 - smoothstep(0.25, 0.6, fp * f);
        if (w <= 0.0) break;
        v += a * w * snoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
        f *= 2.03;
    }
    return v;
}

// weight of a pattern of frequency f (cycles per unit) at pixel size fp
float lod(float f, float fp) {
    return 1.0 - smoothstep(0.25, 0.6, f * fp);
}

// The solar system: Background.qml runs the orbits (Kepler ellipses with real
// eccentricities and period ratios) and the camera; in the universe view the
// system sits small in the left third (the camera's principal point), in the
// system view it fills the screen.

// mip level for a map W texels around at a pixel size of fp radians
float mapLod(float fp, float W) {
    return log2(max(fp * W / 6.2831853, 1.0));
}

vec2 equirect(float lon, float lat) {
    return vec2(fract(lon / 6.2831853 + 0.5), 0.5 - lat / 3.14159265);
}

// Earth at world normal N: the real map turned by the sidereal angle about
// the tilted axis, so day, night and the continents line up with now; city
// lights from the night map go out where it is day.
vec3 earthSurface(vec3 N, float fp, out float glow) {
    vec3 xe = vec3(1.0, 0.0, 0.0);
    vec3 ye = cross(earthPole, xe);
    float lat = asin(clamp(dot(N, earthPole), -1.0, 1.0));
    float lon = atan(dot(N, ye), dot(N, xe)) - earthTheta;
    vec2 uv = equirect(lon, lat);
    float l = mapLod(fp, 3840.0);
    vec3 day = textureLod(earthDay, uv, l).rgb;
    vec3 lights = textureLod(earthNight, uv, l).rgb;
    float cloud = smoothstep(0.15, 0.65, fbmL(vec2(lon, lat) * 2.6 + vec2(11.0, 3.0), fp * 2.6)) * 0.40;
    glow = smoothstep(0.22, 0.70, dot(lights, vec3(0.2126, 0.7152, 0.0722))) * (1.0 - cloud) * 0.6;
    return mix(day * 1.05, vec3(0.95), cloud);
}

// the Moon at world normal N, near side toward Earth
vec3 moonSurface(vec3 N, float fp) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 xm = normalize(moonFace - up * dot(moonFace, up));
    vec3 ym = cross(up, xm);
    float lat = asin(clamp(N.y, -1.0, 1.0));
    float lon = atan(dot(N, ym), dot(N, xm));
    return textureLod(moonTex, equirect(lon, lat), mapLod(fp, 2048.0)).rgb * 0.9;
}

// our spot on Earth: a dot with a slow ring growing out of it every 3 s
float homeMarker(vec3 N, float fp, float t) {
    float ang = acos(clamp(dot(N, home), -1.0, 1.0));
    float vis = 1.0 - smoothstep(0.01, 0.03, fp);
    float dotm = 1.0 - smoothstep(0.010, 0.010 + 1.5 * fp, ang);
    float ph = fract(t / 3.0);
    float r = 0.012 + 0.05 * ph;
    float ringm = (1.0 - smoothstep(0.0, 1.5 * fp + 0.002, abs(ang - r))) * (1.0 - ph);
    return (dotm + 0.7 * ringm) * vis;
}

float spinOf(int i) {
    return i == 0 ? spinA.x : i == 1 ? spinA.y : i == 2 ? spinA.z : i == 3 ? spinA.w : i == 4 ? spinB.x : spinB.y;
}

// Surface colour of planet i at sphere normal n (z toward the viewer). fp is
// the pixel size in radians of surface, so detail appears as you zoom in:
// craters, cloud wisps, fine bands. `glow` returns night-side light (Earth's
// cities), shown only where the sun does not reach.
vec3 planetSurface(int i, vec3 n, float fp, out float glow) {
    glow = 0.0;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.x, n.z) + spinOf(i);
    vec2 g = vec2(lon, lat);

    if (i == 0) { // Mercury: grey, cratered
        float c = 0.80 + 0.22 * fbmL(g * 3.0 + 4.0, fp * 3.0);
        c -= 0.18 * smoothstep(0.35, 0.65, snoise(g * 9.0)) * lod(9.0, fp);
        c -= 0.10 * smoothstep(0.45, 0.70, snoise(g * 31.0 + 5.0)) * lod(31.0, fp);
        return vec3(0.55, 0.53, 0.50) * c;
    }
    if (i == 1) { // Venus: pale, softly banded clouds
        float c = 0.90 + 0.10 * fbmL(vec2(lon * 1.5, lat * 5.0 + 0.6 * fbmL(g * 2.0, fp * 2.0)), fp * 5.0);
        return vec3(0.92, 0.84, 0.66) * c;
    }
    if (i == 2) return earthSurface(n, fp, glow);
    if (i == 6) return moonSurface(n, fp);
    if (i == 3) { // Mars: rust with darker plains, canyons and a polar cap
        float c = 0.82 + 0.25 * fbmL(g * 2.2 + 5.0, fp * 2.2);
        vec3 col = mix(vec3(0.42, 0.20, 0.12), vec3(0.78, 0.38, 0.20), smoothstep(-0.2, 0.3, fbmL(g * 1.4 + 2.0, fp * 1.4)));
        col *= c - 0.15 * smoothstep(0.55, 0.80, snoise(vec2(lon * 6.0, lat * 22.0))) * lod(22.0, fp);
        return mix(col, vec3(0.92, 0.90, 0.88), smoothstep(1.22, 1.30, -lat));
    }
    if (i == 4) { // Jupiter: turbulent bands and the great red spot
        float bands = lod(13.0 / 6.283, fp);
        float b = sin(lat * 13.0 + 1.6 * fbmL(vec2(lon * 2.0, lat * 9.0), fp * 9.0)) * bands;
        b += 0.25 * sin(lat * 47.0 + 2.0 * fbmL(vec2(lon * 4.0, lat * 30.0), fp * 30.0)) * lod(47.0 / 6.283, fp);
        vec3 col = mix(vec3(0.66, 0.48, 0.34), vec3(0.92, 0.85, 0.72), 0.5 + 0.5 * clamp(b, -1.0, 1.0));
        vec2 spot = vec2(mod(lon - 1.0 + 3.14159, 6.28318) - 3.14159, lat - 0.38);
        float d = length(spot * vec2(1.0, 2.3));
        float swirl = 0.08 * sin(d * 60.0 - atan(spot.y, spot.x) * 2.0) * lod(60.0 / 6.283, fp);
        return mix(col, vec3(0.74, 0.34, 0.24) * (1.0 + swirl), 1.0 - smoothstep(0.16, 0.24, d));
    }
    // Saturn: soft pale-gold bands
    float b = sin(lat * 9.0 + 0.8 * fbmL(vec2(lon * 1.5, lat * 6.0), fp * 6.0)) * lod(9.0 / 6.283, fp);
    b += 0.2 * sin(lat * 38.0) * lod(38.0 / 6.283, fp);
    return mix(vec3(0.80, 0.70, 0.50), vec3(0.92, 0.85, 0.64), 0.5 + 0.5 * clamp(b, -1.0, 1.0));
}

vec4 orbitAt(int i) {
    return i == 0 ? orbit0 : i == 1 ? orbit1 : i == 2 ? orbit2 : i == 3 ? orbit3 : i == 4 ? orbit4 : orbit5;
}

const vec3 SUN_COL = vec3(1.0, 0.94, 0.82);

// sun disc seen at mu (cos of the angle from the disc centre): hot, gently
// limb-darkened, with faint slow granulation (fp: pixel size in sun radii)
vec3 sunSurface(vec2 d, float mu, float fp, float t) {
    float gran = 1.0 + 0.025 * snoise(d * 9.0 + vec2(W * 3.0 * t, 0.0)) * lod(9.0, fp)
                     + 0.015 * snoise(d * 37.0 - vec2(0.0, W * 5.0 * t)) * lod(37.0, fp);
    return SUN_COL * (0.72 + 0.28 * mu) * gran;
}

// ---- chase view -------------------------------------------------------------

vec4 bodyAt(int i) {
    return i == 0 ? body0 : i == 1 ? body1 : i == 2 ? body2 : i == 3 ? body3 : i == 4 ? body4 : i == 5 ? body5 : moonBody;
}

// Saturn-style ring brightness at ring radius re (in planet radii)
float ringPattern(float re, float fp) {
    return smoothstep(1.32, 1.40, re) * (1.0 - smoothstep(2.20, 2.30, re))
         * (1.0 - 0.85 * smoothstep(1.80, 1.83, re) * (1.0 - smoothstep(1.90, 1.93, re)))
         * (0.80 + 0.20 * sin(re * 40.0) * lod(40.0 / 6.283, fp)
                 + 0.10 * sin(re * 170.0) * lod(170.0 / 6.283, fp)
                 + 0.06 * sin(re * 530.0) * lod(530.0 / 6.283, fp));
}

// The solar system: one ray-traced scene seen through one pinhole camera (the
// overview at a 2.4-degree field, the chase view at 53, a dolly zoom between
// them; what you click is where it is drawn, because picks, labels and this
// share one projection). Everything is a real sphere lit by the Sun, and
// detail follows each pixel's footprint on the surface (`fp`): maps, bands,
// craters and ring structure appear as you come closer and settle to their
// averages from afar, down to a point of light. Positions come in relative to
// a reference point near what is being looked at (computed in double
// precision), so close-ups stay steady at true scale.

// Saturn's north pole (IAU: RA 40.589, Dec 83.537), this frame: the rings sit
// on its equator, tilted 26.7 degrees to its orbit
const vec3 SATURN_POLE = vec3(0.08548, 0.88252, -0.46244);

vec4 systemScene(vec2 p, float t, vec3 orbitTint) {
    // in the universe view the system is small: skip pixels far from it
    if (sysBound.z > 0.0 && (abs(p.x - sysBound.x) > sysBound.z || abs(p.y - sysBound.y) > sysBound.w))
        return vec4(0.0);
    vec2 pp = p - principal;
    vec3 ro = camPos;
    vec3 rd = normalize(camFwd * focal + camRight * pp.x - camUp * pp.y);
    // a pixel's size at distance t along the ray is pa * t
    float pa = 1.0 / (resolution.y * focal);
    vec3 col = vec3(0.0);
    float cov = 0.0;
    float nearest = 1e20;

    // the Sun: a glow sized by its own radius, then the disc
    vec3 S = sunBody.xyz;
    float SR = sunBody.w;
    float ts = dot(S - ro, rd);
    if (ts > 0.0) {
        float ds = length(S - ro - rd * ts);
        float fpS = pa * ts;
        col += SUN_COL * (exp(-max(ds - SR, 0.0) / (SR * 1.5)) * 0.25 + exp(-ds / (SR * 10.0)) * 0.03 + exp(-ds / (SR * 60.0)) * 0.012);
        float edge = 1.0 - smoothstep(SR - fpS, SR + fpS, ds);
        if (edge > 0.0) {
            vec3 hp = ro + rd * ts - S;
            float mu = sqrt(max(0.0, 1.0 - ds * ds / (SR * SR)));
            col = mix(col, sunSurface(vec2(dot(hp, camRight), -dot(hp, camUp)) / SR, mu, fpS / SR, t), edge);
            cov = edge;
            nearest = ts;
        }
    }

    // guide lines (L): the orbits on the ecliptic, the Moon's around Earth
    if (guides > 0.0 && abs(rd.y) > 1e-6) {
        float tP = (planeY - ro.y) / rd.y;
        if (tP > 0.0 && tP < nearest) {
            vec3 H = ro + rd * tP - S;
            vec2 he = vec2(H.x, -H.z); // ecliptic x, y
            float w = 0.7 * pa * tP / max(abs(rd.y), 0.12);
            for (int i = 0; i < 6; i++) {
                vec4 ob = orbitAt(i);
                vec2 pf = vec2(he.x * cos(-ob.z) - he.y * sin(-ob.z), he.x * sin(-ob.z) + he.y * cos(-ob.z)) + vec2(ob.x * ob.y, 0.0);
                float bAxis = ob.x * sqrt(1.0 - ob.y * ob.y);
                float od = abs(length(vec2(pf.x / ob.x, pf.y / bAxis)) - 1.0) * ob.x;
                col += guides * orbitTint * (0.04 + 0.10 * sysHover) * (1.0 - smoothstep(w, w * 2.5, od));
            }
            float dm = abs(length((ro + rd * tP - body2.xyz).xz) - moonOrbit);
            col += guides * orbitTint * 0.06 * (1.0 - smoothstep(w, w * 2.5, dm));
        }
    }

    for (int i = 0; i < 7; i++) {
        vec4 B = bodyAt(i);
        float R = B.w;
        vec3 oc = B.xyz - ro;
        float tc = dot(oc, rd);
        if (tc <= 0.0) continue;
        float dp = length(oc - rd * tc);
        float fpc = pa * tc;
        vec3 sunDir = normalize(S - B.xyz);

        // backlit atmosphere: a thin glow just outside the limb
        if (i == 1 || i == 2 || i == 3) {
            float halo = (1.0 - smoothstep(R, R * 1.06 + fpc, dp)) * smoothstep(R * 0.97, R, dp);
            float fwd = pow(max(dot(rd, sunDir), 0.0), 6.0);
            vec3 air = i == 2 ? vec3(0.35, 0.60, 1.0) : i == 1 ? vec3(0.95, 0.85, 0.6) : vec3(0.9, 0.6, 0.45);
            if (tc - R < nearest) col += air * halo * (0.06 + 1.2 * fwd);
        }

        // Saturn's rings: on its equator; the globe shadows them, they shadow
        // the globe, and from the unlit side only light seeping through shows
        float tRing = 1e20;
        float ringA = 0.0;
        vec3 ringCol = vec3(0.0);
        if (i == 5) {
            float dn = dot(rd, SATURN_POLE);
            if (abs(dn) > 1e-6) {
                float tr = dot(B.xyz - ro, SATURN_POLE) / dn;
                if (tr > 0.0 && tr < nearest) {
                    vec3 hp = ro + rd * tr - B.xyz;
                    float re = length(hp) / R;
                    // a pixel spans more ring radius the more edge-on we look
                    ringA = clamp(ringPattern(re, pa * tr / (R * max(abs(dn), 0.02))), 0.0, 1.0) * 0.9;
                    if (ringA > 0.0) {
                        float inShadow = length(cross(sunDir, hp)) < R && dot(hp, sunDir) < 0.0 ? 1.0 : 0.0;
                        float sunSide = dot(SATURN_POLE, sunDir);
                        float litFace = sign(sunSide) == sign(-dn) ? 1.0 : 0.3; // seen from the dark face: dim
                        float light = mix(1.0, 0.06, inShadow) * litFace * (0.35 + 0.65 * min(1.0, abs(sunSide) * 4.0));
                        ringCol = vec3(0.80, 0.71, 0.55) * 0.85 * light;
                        tRing = tr;
                    }
                }
            }
        }

        // the globe
        float tHit = 1e20;
        vec3 globe = vec3(0.0);
        float globeA = 0.0;
        if (dp < R + fpc) {
            float h = sqrt(max(R * R - dp * dp, 0.0));
            float th = tc - h;
            if (th < nearest) {
                vec3 X = ro + rd * th - B.xyz;
                vec3 N = normalize(X);
                float lit = smoothstep(-0.08, 0.30, dot(N, sunDir));
                if (i == 5) {
                    // the rings' shadow across the globe
                    float k = -dot(X, SATURN_POLE) / dot(sunDir, SATURN_POLE);
                    if (k > 0.0) lit *= 1.0 - 0.85 * clamp(ringPattern(length(X + sunDir * k) / R, fpc / (R * max(abs(dot(sunDir, SATURN_POLE)), 0.02))), 0.0, 1.0);
                }
                float fp = fpc / (R * max(dot(N, -rd), 0.2));
                float glow;
                vec3 Ns = N;
                if (i == 5) {
                    // Saturn's bands run around its own pole, like its rings
                    vec3 ex = normalize(cross(vec3(0.0, 0.0, 1.0), SATURN_POLE));
                    vec3 ez = cross(ex, SATURN_POLE);
                    Ns = vec3(dot(N, ex), dot(N, SATURN_POLE), dot(N, ez));
                }
                vec3 surf = planetSurface(i, Ns, fp, glow);
                vec3 night = vec3(1.0, 0.72, 0.40) * glow * (1.0 - smoothstep(0.0, 0.25, lit));
                if (i == 2) night += accent.rgb * homeMarker(N, fp, t);
                globe = surf * (0.012 + 0.988 * lit) + night;
                globeA = 1.0 - smoothstep(R - fpc, R + fpc, dp);
                tHit = th;
            }
        }

        // composite back to front: rings behind the globe, the globe, rings in front
        if (ringA > 0.0 && tRing > tHit) { col = mix(col, ringCol, ringA); cov = max(cov, ringA); }
        if (globeA > 0.0) { col = mix(col, globe, globeA); cov = max(cov, globeA); nearest = min(nearest, tHit); }
        if (ringA > 0.0 && tRing <= tHit) { col = mix(col, ringCol, ringA); cov = max(cov, ringA); }

        // a body smaller than a pixel still shows, as a point of its colour
        if (R < fpc && dp < fpc * 4.0 && tc < nearest) {
            float g;
            vec3 avg = planetSurface(i, normalize(sunDir + vec3(0.0, 0.3, 0.0)), 1e3, g);
            col += avg * exp(-dp * dp / (fpc * fpc * 1.4)) * 0.8;
            cov = max(cov, 0.5 * exp(-dp * dp / (fpc * fpc)));
        }
    }

    // the pinned body's line to the Sun (a guide line), hidden behind bodies
    if (pinned > 0.5 && guides > 0.0) {
        vec3 Bp = bodyAt(int(pinned) - 1).xyz;
        vec3 v = S - Bp;
        vec3 w0 = ro - Bp;
        float b = dot(rd, v);
        float cc = dot(v, v);
        float d = dot(rd, w0);
        float e = dot(v, w0);
        float den = cc - b * b;
        float sg = clamp(den > 1e-12 ? (e - b * d) / den : 0.0, 0.0, 1.0);
        float tr = dot(Bp + v * sg - ro, rd);
        if (tr > 0.0 && tr < nearest) {
            float dist = length(ro + rd * tr - (Bp + v * sg));
            float wpx = pa * tr;
            float dash = step(0.5, fract(sg * sqrt(cc) / (40.0 * wpx + 1e-9) - W * 30.0 * t));
            col += guides * orbitTint * 0.35 * (1.0 - smoothstep(0.7 * wpx, 1.8 * wpx, dist)) * dash
                 * smoothstep(0.0, 0.05, sg) * (1.0 - smoothstep(0.9, 1.0, sg));
        }
    }
    return vec4(col, cov);
}

// ---- surprises ------------------------------------------------------------

// A shooting star now and then: one chance every 40 s, random place and angle,
// slow and soft.
vec3 shootingStar(vec2 p, float t) {
    float period = 40.0;
    float n = floor(t / period);
    if (hash12(vec2(n, 1.3)) > 0.40) return vec3(0.0);
    float dur = 1.4 + 0.8 * hash12(vec2(n, 2.9));
    float lt = mod(t, period) - 3.0 * hash12(vec2(n, 8.1));
    if (lt < 0.0 || lt > dur) return vec3(0.0);
    float u = lt / dur;
    float ar = resolution.x / resolution.y;
    vec2 a = vec2((hash12(vec2(n, 4.2)) - 0.5) * ar, -0.45 + 0.4 * hash12(vec2(n, 5.6)));
    float ang = 0.35 + 0.9 * hash12(vec2(n, 6.6)); // heading down and sideways
    vec2 dir = vec2(cos(ang) * (hash12(vec2(n, 7.7)) < 0.5 ? -1.0 : 1.0), sin(ang));
    vec2 pos = a + dir * 0.55 * u;
    vec2 rel = p - pos;
    float along = dot(rel, -dir);
    float across = abs(dot(rel, vec2(-dir.y, dir.x)));
    float fade = ssin(3.14159 * u);
    float trail = smoothstep(0.16, 0.0, along) * step(0.0, along);
    float body = smoothstep(0.0022, 0.0, across + max(along, 0.0) * 0.012);
    float head = exp(-dot(rel, rel) / (2.0 * 0.0012 * 0.0012));
    return (vec3(0.75, 0.88, 1.0) * body * trail * 0.45 + vec3(0.9) * head * 0.55) * fade;
}

// A satellite crossing: a dim dot gliding over the sky for 50 s, with one
// short glint. One chance every 150 s.
vec3 satellite(vec2 p, float t) {
    float period = 150.0;
    float n = floor(t / period);
    if (hash12(vec2(n, 11.1)) > 0.6) return vec3(0.0);
    float lt = mod(t, period) - 20.0 * hash12(vec2(n, 12.2));
    float dur = 50.0;
    if (lt < 0.0 || lt > dur) return vec3(0.0);
    float u = lt / dur;
    float ar = resolution.x / resolution.y;
    vec2 a = vec2(-0.55 * ar, (hash12(vec2(n, 13.3)) - 0.5) * 0.8);
    vec2 b = vec2(0.55 * ar, (hash12(vec2(n, 14.4)) - 0.5) * 0.8);
    if (hash12(vec2(n, 15.5)) < 0.5) { vec2 tmp = a; a = b; b = tmp; }
    vec2 pos = mix(a, b, u);
    vec2 rel = (p - pos) * resolution.y;
    float glint = exp(-pow((u - hash12(vec2(n, 16.6)) * 0.6 - 0.2) * 40.0, 2.0));
    float fadeIn = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.92, 1.0, u));
    return vec3(0.95, 0.97, 1.0) * exp(-dot(rel, rel) / 2.0) * (0.30 + 0.5 * glint) * fadeIn;
}

// ---- HUD ------------------------------------------------------------------

// thin circle of radius R and half-width w
float ring(float r, float R, float w, float px) {
    return 1.0 - smoothstep(w, w + 1.5 * px, abs(r - R));
}

// `count` arc segments around the circle, each covering `duty` of its slot
float arcs(float a, float rot, float count, float duty, float R, float px) {
    float s = fract((a + rot) / TAU * count);
    float e = 1.5 * px * count / (TAU * R);
    return smoothstep(0.0, e, s) * (1.0 - smoothstep(duty - e, duty, s));
}

// radial tick marks starting at R; every sixth one is longer
float ticks(float r, float a, float rot, float count, float R, float len, float wid, float px) {
    float k = (a + rot) / TAU * count;
    float s = fract(k) - 0.5;
    float L = mod(floor(k), 6.0) < 0.5 ? len * 1.9 : len;
    float d = abs(s) * TAU * r / count;
    float across = 1.0 - smoothstep(wid, wid + 1.5 * px, d);
    float along = smoothstep(R - px, R, r) * (1.0 - smoothstep(R + L, R + L + px, r));
    return across * along;
}

// ring of round dots
float dots(float r, float a, float rot, float count, float R, float size, float px) {
    float s = fract((a + rot) / TAU * count) - 0.5;
    vec2 d = vec2(s * TAU * R / count, r - R);
    return 1.0 - smoothstep(size, size + 1.5 * px, length(d));
}

// gauge arc: 270 degrees from 7:30 clockwise to 4:30, filled to `frac`; the
// unfilled part is a faint track. ang01 is 0 at twelve o'clock, clockwise.
float gauge(float ang01, float frac, float R, float px) {
    float g = fract(ang01 - 0.625);
    float e = 1.5 * px / (TAU * R);
    float track = 1.0 - smoothstep(0.75 - e, 0.75, g);
    float fill = 1.0 - smoothstep(0.75 * frac - e, 0.75 * frac, g);
    return max(track * 0.18, fill);
}

// Arc-reactor style HUD whose rings are live gauges: CPU (heavy ring), GPU
// (highlight ring), memory (dots) and the seconds of the minute (inner ring).
// The centre drifts slowly (set in Background.qml) and the rest is dim and
// moving, so no line sits on the same OLED pixels for long.
vec3 hud(vec2 p, float t, vec3 cA, vec3 cB) {
    float px = 1.0 / resolution.y;
    vec2 q = p - hudCenter;
    float r = length(q);
    if (r > 0.25) return vec3(0.0);
    float a = atan(-q.y, q.x);            // screen y points down
    float ang01 = fract(-a / TAU + 0.25); // 0 at twelve o'clock, clockwise

    // draw-in when the shell starts: the rings appear clockwise
    float reveal = boot >= 1.0 ? 1.0 : 1.0 - smoothstep(boot - 0.02, boot, ang01);
    float edge = boot >= 1.0 ? 0.0
               : exp(-abs(ang01 - boot) * 80.0) * (1.0 - smoothstep(0.05, 0.22, r)) * smoothstep(0.02, 0.05, r);

    float m = 0.0;  // accent colour
    float hm = 0.0; // highlight colour

    // seconds: a short arc gliding once round the inner ring each minute
    float lag = fract(secs - ang01);
    m += ring(r, 0.085, 0.0012, px) * max(0.15, exp(-lag * 18.0) * smoothstep(0.0, 0.004, 1.0 - lag));

    // rotating tick ring (decoration)
    m += 0.6 * ticks(r, a, -W * 4.0 * t, 72.0, 0.110, 0.007, 0.0007, px);

    // CPU on the heavy ring, GPU just outside it in the highlight colour
    m += ring(r, 0.150, 0.0028, px) * gauge(ang01, cpu, 0.150, px);
    hm += ring(r, 0.172, 0.0018, px) * gauge(ang01, gpu, 0.172, px);

    // memory: the dots light up along the same 270-degree span
    m += 0.9 * dots(r, a, 0.0, 120.0, 0.198, 0.0013, px) * gauge(ang01, mem, 0.198, px);

    // outer 270-degree bracket, slowly turning
    m += 0.5 * ring(r, 0.232, 0.0007, px) * arcs(a, W * 3.0 * t, 1.0, 0.75, 0.232, px);

    return ((cA * m + cB * hm) * reveal + cA * edge * 0.6) * hudLevel;
}


// ---- the Milky Way view ----------------------------------------------------

// galactic view: interstellar dust at rest in the Galaxy streams past the
// moving Sun; faint specks, two depths, slightly drawn out along the flow
vec3 spaceDust(vec2 p) {
    vec3 col = vec3(0.0);
    vec2 dir = galFlow.zw;
    for (int l = 0; l < 2; l++) {
        float k = l == 0 ? 55.0 : 24.0;
        vec2 g = (p + galFlow.xy * (l == 0 ? 1.0 : 2.2)) * k;
        vec2 id = floor(g);
        if (hash12(id + float(l) * 17.0) > 0.22) continue;
        vec2 d = fract(g) - 0.3 - 0.4 * hash22(id + float(l) * 5.0);
        float along = dot(d, dir);
        vec2 perp = d - dir * along;
        float px = k / resolution.y;
        float a = exp(-dot(perp, perp) / (px * px * 0.8)) * exp(-along * along / (px * px * 6.0));
        col += vec3(0.75, 0.72, 0.68) * a * (l == 0 ? 0.10 : 0.16);
    }
    return col;
}

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

// stars fixed on the sky (directions), one per cell of a 3D grid laid over the
// unit sphere; k cells per radian, prob of a star in a cell
vec3 skyStars(vec3 d, float k, float prob, float gain, float spread) {
    // one cell per pixel: the star sits in the middle third of its cell, at
    // least ~1.5 px from any edge, so it is never cut off (one hash cell
    // instead of eight: this runs for every pixel at full resolution)
    vec3 id = floor(d * k);
    if (hash13(id) > prob) return vec3(0.0);
    vec3 sp = normalize(id + 0.35 + 0.3 * vec3(hash13(id + 1.3), hash13(id + 2.7), hash13(id + 5.1)));
    float a = length(cross(d, sp)) * resolution.y; // angle in pixels
    float m = pow(hash13(id + 9.1), 5.0);
    return starColor(hash13(id + 4.4)) * gain * (0.15 + m * 2.5) * exp(-a * a / spread);
}

// the chosen hotspot up close, drawn on a card facing the camera
vec3 hotspotDrawn(vec3 rd, float t) {
    if (gxFocus.w <= 0.0) return vec3(0.0);
    vec3 oc = gxFocus.xyz - gxCam;
    float dist = length(oc);
    float tc = dot(oc, rd);
    if (tc <= 0.0) return vec3(0.0);
    float r = gxFocus.w * 0.5;
    vec3 off = rd * (dist * dist / tc) - oc;          // on the plane through it, facing us
    vec2 q = vec2(dot(off, gxRight), -dot(off, gxUp)) / r;
    float rr = length(q);
    float pxR = dist / (resolution.y * r);           // one pixel, in object radii
    float resolved = smoothstep(2.0, 12.0, 1.0 / pxR); // too small: a point of light
    vec3 tint = gxFocusCol.rgb;
    int kind = int(gxFocusCol.a + 0.5);

    float seed = fract(gxFocus.x * 13.1 + gxFocus.y * 7.3) * 50.0;
    vec3 col = vec3(0.0);

    if (kind == 0) {
        // emission nebula: glowing hydrogen, an oxygen-teal heart, dark dust, young stars
        float shape = exp(-rr * rr * 1.4);
        float gas = smoothstep(-0.25, 0.75, fbm4(q * 1.6 + seed) + 0.2);
        float lanes = smoothstep(0.15, 0.6, fbm4(q * 3.1 + seed + 7.0));
        col = tint * shape * gas * 1.3 * (1.0 - 0.75 * lanes);
        col += vec3(0.35, 0.85, 0.80) * exp(-rr * rr * 6.0) * gas * 0.45;
        vec2 g = q * 9.0;
        vec2 id = floor(g);
        float h = hash12(id + seed);
        col += vec3(0.80, 0.88, 1.0) * step(0.86, h) * exp(-pow(length(fract(g) - 0.5 - (hash22(id + seed) - 0.5) * 0.6) / (pxR * 9.0 * 1.2), 2.0)) * shape * 2.0;
    } else if (kind == 1) {
        // open cluster: a few dozen hot young stars and a blue haze of dust
        col = tint * 0.10 * exp(-rr * rr * 1.6) * smoothstep(-0.3, 0.8, fbm4(q * 2.0 + seed) + 0.3);
        vec2 g = q * 5.0;
        vec2 id = floor(g);
        vec2 sp = id + 0.2 + 0.6 * hash22(id + seed);
        float h = hash12(id + seed + 3.0);
        float dpx = length(g - sp) / (5.0 * pxR);
        float m = pow(hash12(id + seed + 8.0), 3.0);
        col += vec3(0.80, 0.88, 1.0) * step(0.55, h) * exp(-rr * rr * 0.8) * (0.4 + 3.0 * m) * exp(-dpx * dpx / (1.0 + 6.0 * m));
    } else if (kind == 2) {
        // globular cluster: hundreds of thousands of old stars, densest in the core
        float king = 1.0 / (1.0 + rr * rr * 30.0) - 0.03;
        col = tint * max(king, 0.0) * 0.6;
        vec2 g = q * 60.0;
        vec2 id = floor(g);
        vec2 sp = id + 0.2 + 0.6 * hash22(id + seed);
        float dpx = length(g - sp) / (60.0 * pxR);
        col += tint * step(hash12(id + seed), max(king, 0.0) * 1.5) * exp(-dpx * dpx) * 1.2;
    } else if (kind == 3) {
        // remnant / planetary nebula: a shell of glowing filaments around a hot core
        float shell = exp(-pow((rr - 0.78) / 0.16, 2.0));
        float fil = smoothstep(0.0, 0.9, fbm4(q * 4.0 + seed) + 0.35);
        vec3 rim = mix(tint, vec3(1.0, 0.42, 0.40), 0.5);
        col = rim * shell * fil * 1.6 + tint * 0.45 * smoothstep(0.85, 0.2, rr) * (0.6 + 0.4 * fil);
        col += vec3(0.70, 0.80, 1.0) * exp(-rr * rr / (pxR * pxR * 4.0 + 0.0004)) * 2.0;
    } else if (kind == 4) {
        // a single star: unresolved even from close by, so a bright point
        float dpx = rr / pxR;
        col = tint * (exp(-dpx * dpx / 2.0) * 3.0 + exp(-dpx / 12.0) * 0.25);
        return col;
    } else if (kind == 5) {
        // the Galactic Centre: the crowded nuclear star cluster, its hot gas,
        // and at the very middle the black hole, far too small to see
        col = tint * 0.5 / (1.0 + rr * rr * 18.0);
        col += vec3(1.0, 0.45, 0.35) * 0.25 * exp(-rr * rr * 3.0) * smoothstep(-0.3, 0.8, fbm4(q * 2.5 + seed) + 0.2);
        vec2 g = q * 40.0;
        vec2 id = floor(g);
        vec2 sp = id + 0.2 + 0.6 * hash22(id + seed);
        float dpx = length(g - sp) / (40.0 * pxR);
        col += vec3(1.0, 0.85, 0.7) * step(hash12(id + seed), 0.25 / (1.0 + rr * rr * 8.0)) * exp(-dpx * dpx) * 1.5;
        col *= smoothstep(0.08, 0.6, dist / r); // inside the cluster: its stars are all around us instead
    } else {
        // dwarf galaxy: a faint stretched swarm of old stars
        float e = length(q * vec2(0.5, 1.4));
        col = tint * 0.12 * exp(-e * e * 2.0) * (0.7 + 0.6 * fbm4(q * 2.0 + seed));
    }
    // far away it all shrinks into one point of its colour
    float dpx = rr / pxR;
    vec3 point = tint * exp(-dpx * dpx / 2.0) * 1.5;
    return mix(point, col, resolved);
}

// the photo where there is one and we see the place from Earth's side; the
// drawn version elsewhere
// bicubic (Catmull-Rom, 9 taps via bilinear) sampling: magnified photos stay
// smooth instead of turning into visible texel squares
vec3 sampleBicubic(sampler2D tex, vec2 uv, vec2 size) {
    vec2 sp = uv * size - 0.5;
    vec2 tc = floor(sp) + 0.5;
    vec2 f = sp - tc + 0.5;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 o12 = w2 / w12;
    vec2 t0 = (tc - 1.0) / size;
    vec2 t3 = (tc + 2.0) / size;
    vec2 t12 = (tc + o12) / size;
    vec3 r = texture(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
           + texture(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
           + texture(tex, t12).rgb * w12.x * w12.y
           + texture(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
           + texture(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
    float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(r / ws, 0.0);
}

vec3 photoSample(vec2 tuv) {
    if (any(lessThan(tuv, vec2(0.0))) || any(greaterThan(tuv, vec2(1.0)))) return vec3(0.0);
    vec3 c;
    if (photoHiReady > 0.5) c = sampleBicubic(photoHi, tuv, vec2(2048.0));
    else {
        vec2 tile = vec2(mod(gxPhoto.x, 4.0), floor(gxPhoto.x / 4.0));
        c = texture(photoAtlas, (tile + tuv) / 4.0).rgb;
    }
    return c * c * 1.15; // gamma-encoded photos, light adds linearly
}

// The place's real photo, always facing us. Glowing gas is see-through, so
// from the far side it looks like the mirror image of Earth's view; between
// the two the views crossfade by angle, so turning around never pops.
vec3 hotspotPhoto(vec3 rd) {
    if (gxPhoto.y <= 0.0 || gxFocus.w <= 0.0) return vec3(0.0);
    vec3 oc = gxFocus.xyz - gxCam;
    float tc = dot(oc, rd);
    if (tc <= 0.0) return vec3(0.0);
    vec3 off = rd * (dot(oc, oc) / tc) - oc;
    vec2 s = vec2(dot(off, gxRight), dot(off, gxUp)) / gxPhoto.y;
    float cn = cos(gxPhoto.z);
    float sn = sin(gxPhoto.z);
    vec2 tuv = vec2(dot(s, vec2(cn, -sn)), -dot(s, vec2(sn, cn))) + 0.5;
    if (int(gxFocusCol.a + 0.5) == 7) {
        // a disk galaxy drawn in 3D from its own photo: the card adds the
        // photo's sharpness only near Earth's line of sight
        return photoSample(tuv) * smoothstep(0.85, 0.97, gxPhoto.w);
    }
    float front = 0.5 + 0.5 * gxPhoto.w;
    vec3 seen = front > 0.001 ? photoSample(tuv) : vec3(0.0);
    vec3 mirrored = front < 0.999 ? photoSample(vec2(1.0 - tuv.x, tuv.y)) : vec3(0.0);
    return mix(mirrored, seen, front);
}

vec3 hotspotLook(vec3 rd, float t) {
    vec3 drawn = hotspotDrawn(rd, t);
    return gxPhoto.y > 0.0 ? hotspotPhoto(rd) : drawn;
}

// ---- Sagittarius A*, up close ------------------------------------------------
// A Kerr black hole of 4.3 million Suns at the origin, spin a/M = gxSpin / M
// about gxSpinAxis (0.94, the EHT 2022 best-bet model; uncertain). hole.frag
// traces every pixel's ray at a third of the resolution and hands over where
// it left (a bend vector), the gas's light and its shift. Here, at full
// resolution, the same camera frame gives each look direction its constants
// of motion (E, L_z, Carter's K) in Kerr-Schild coordinates, and the radial
// potential R(r) = (E (r^2 + a^2) - a L_z)^2 - Delta (Q + (L_z - a E)^2) says
// exactly whether the ray reaches the sky: a backward ray that climbs escapes
// iff R / r^4 > 0 at every critical point above the camera; one that dives
// escapes iff R / r^4 < 0 at some critical point between r+ and the camera.
// R has no r^3 term, so the critical points are the two roots of a
// quadratic: the shadow's edge (D-shaped at high spin, seen from the side)
// is a closed form here, the tracer is read only from the sky's side of it,
// and the photon ring is drawn on it. Rays far from the hole bend by the
// weak-field series (2 Rs/b, Keeton & Petters 2005). Same functions as
// hole.frag; lib/kerr.js has them in JS with the tests.
const float RS_KPC = 4.11e-10;      // Schwarzschild radius, kpc (0.085 AU)
const float HM = 0.5;               // the hole's mass, in Rs

struct KSL { float r; float f; vec3 l; vec3 dr; float A; float D; };
float ksRadius(vec3 x, float a, float sheet) {
    float d = dot(x, x) - a * a;
    float S = sqrt(d * d + 4.0 * a * a * x.z * x.z);
    float r2 = d >= 0.0 ? 0.5 * (d + S) : 2.0 * a * a * x.z * x.z / (S - d);
    return sheet * sqrt(r2);
}
// r, f, l and dr/dx at x (no second derivatives: no march here)
KSL ksLite(vec3 x, float a, float sheet) {
    KSL m;
    float r = ksRadius(x, a, sheet);
    if (abs(r) < 1e-5) r = sheet * 1e-5;
    float r2 = r * r, r3 = r2 * r;
    m.A = r2 + a * a;
    m.D = max(r2 * r2 + a * a * x.z * x.z, 1e-12);
    m.f = 2.0 * HM * r3 / m.D;
    float cz = (r2 > 1e-6 || a == 0.0) ? x.z / r : sign(x.z) * sign(r) * sqrt(max(0.0, (r2 - dot(x, x) + a * a) / (a * a)));
    m.l = vec3((r * x.x + a * x.y) / m.A, (r * x.y - a * x.x) / m.A, cz);
    m.dr = vec3(r3 * x.x, r3 * x.y, r * x.z * m.A) / m.D;
    m.r = r;
    return m;
}
vec4 ksLower(KSL m, vec4 V) {
    float lv = V.x + dot(m.l, V.yzw);
    return vec4(-V.x + m.f * lv, V.yzw + m.f * m.l * lv);
}
// the camera's frame (a boost of the Kerr-Schild tetrad to u) and the photon
// seen in look direction v, as in hole.frag: k_m, with k_t = -E
vec4 ksCameraRay(KSL m, vec4 u, vec3 v) {
    float f2 = 0.5 * m.f;
    vec4 e0 = vec4(1.0 + f2, -f2 * m.l);
    vec4 e1 = vec4(f2 * m.l.x, vec3(1.0, 0.0, 0.0) - f2 * m.l.x * m.l);
    vec4 e2 = vec4(f2 * m.l.y, vec3(0.0, 1.0, 0.0) - f2 * m.l.y * m.l);
    vec4 e3 = vec4(f2 * m.l.z, vec3(0.0, 0.0, 1.0) - f2 * m.l.z * m.l);
    vec4 ul = ksLower(m, u);
    float gamma = -dot(ul, e0);
    vec3 beta = vec3(dot(ul, e1), dot(ul, e2), dot(ul, e3)) / gamma;
    float b2 = dot(beta, beta);
    vec4 be = beta.x * e1 + beta.y * e2 + beta.z * e3;
    float k1 = b2 > 1e-12 ? (gamma - 1.0) / b2 : 0.0;
    vec4 E1 = e1 + (k1 * beta.x) * be + (gamma * beta.x) * e0;
    vec4 E2 = e2 + (k1 * beta.y) * be + (gamma * beta.y) * e0;
    vec4 E3 = e3 + (k1 * beta.z) * be + (gamma * beta.z) * e0;
    return ksLower(m, u - v.x * E1 - v.y * E2 - v.z * E3);
}
// the shadow's edge: signed, positive on the sky's side, (b^2/B_CRIT^2 - 1)/2
// at a = 0 near the edge. P(r) = R(r) / (E^2 r^4) and its critical points,
// the roots of 2 c2 r^2 + 3 c1 r + 4 c0 = 0 with R = E^2 r^4 + c2 r^2 + c1 r + c0
float radialClass(float E, float Lz, float Kc, float a, float rCam, bool climbing, float rPlus) {
    if (E <= 0.0) return -1.0;
    float A0 = E * a * a - a * Lz;
    float c2 = 2.0 * E * A0 - Kc, c1 = 2.0 * HM * Kc, c0 = A0 * A0 - a * a * Kc;
    float qa = 2.0 * c2, qb = 3.0 * c1, qc = 4.0 * c0;
    float lo = climbing ? rCam : rPlus, hi = climbing ? 1e30 : rCam;
    float m = 1e30;
    float disc = qb * qb - 4.0 * qa * qc;
    if (abs(qa) < 1e-9 * (abs(qb) + abs(qc))) {
        if (qb != 0.0) { float r = -qc / qb; if (r > lo && r < hi) m = min(m, ((E * E * r * r * r * r + c2 * r * r + c1 * r + c0) / (E * E * r * r * r * r))); }
    } else if (disc >= 0.0) {
        float sq = sqrt(disc);
        for (int i = 0; i < 2; i++) {
            float r = (-qb + (i == 0 ? sq : -sq)) / (2.0 * qa);
            if (r > lo && r < hi) m = min(m, (E * E * r * r * r * r + c2 * r * r + c1 * r + c0) / (E * E * r * r * r * r));
        }
    }
    if (m > 1e29) m = climbing ? 1.0 : (E * E * rCam * rCam * rCam * rCam + c2 * rCam * rCam + c1 * rCam + c0) / (E * E * rCam * rCam * rCam * rCam);
    return climbing ? 0.5 * m : -0.5 * m;
}
// the basis the bend vector is written in: n1 toward the hole, perpendicular
// to the look direction; n2 = rd x n1
void bendBasis(vec3 toHole, vec3 rd, out vec3 n1, out vec3 n2) {
    n1 = toHole - rd * dot(toHole, rd);
    if (dot(n1, n1) < 1e-10) n1 = abs(rd.x) < 0.9 ? vec3(0.0, rd.z, -rd.y) : vec3(rd.z, 0.0, -rd.x);
    n1 = normalize(n1);
    n2 = cross(rd, n1);
}
vec3 bendDecode(vec3 rd, vec3 n1, vec3 n2, vec2 bv) {
    float alpha = length(bv);
    if (alpha < 1e-6) return rd;
    return rd * cos(alpha) + (n1 * bv.x + n2 * bv.y) / alpha * sin(alpha);
}
// the inverse (hole.frag's bendEncode): alpha the angle from rd to d, psi
// the azimuth of d's part across rd in the basis
vec2 bendEncode(vec3 rd, vec3 n1, vec3 n2, vec3 d) {
    float alpha = acos(clamp(dot(d, rd), -1.0, 1.0));
    vec2 p = vec2(dot(d, n1), dot(d, n2));
    float pl = length(p);
    return pl < 1e-6 ? vec2(alpha, 0.0) : alpha * p / pl;
}
// what kind of ray the tracer wrote: 0 sky, 1 dark, 2 the other universe, 3 none
int holeKind(vec4 t) { return t.a < 0.0 ? 1 : t.b < 0.0 ? 2 : t.a == 0.0 ? 3 : 0; }
// the tracer at uv: bilinear where its four texels are of one kind, the
// nearest texel otherwise, so a sky direction is never blended with a
// sentinel or a glow. Bend vectors are blended as directions where they
// differ by more than BEND_BLEND: the encoding folds at alpha = 180 degrees
// (a ray turned 184 degrees is written as 176 on the other side), so two
// neighbours like (-176, 0) and (+179, 0), 5 degrees apart as directions,
// would average to an undeflected ray and show the sky unbent along a thin
// contour. From the equator at spin that fold lies well outside the shadow
// (a bend of 180 degrees is reached at xs ~ 0.1), in plain view.
const float BEND_BLEND = 0.5;
vec4 holeRead(vec2 uv, vec3 rd, vec3 n1, vec3 n2) {
    vec2 st = uv * holeRes - 0.5;
    vec2 i0 = floor(st), fr = st - i0;
    vec4 t00 = texture(holeTex, (i0 + 0.5) / holeRes);
    vec4 t10 = texture(holeTex, (i0 + vec2(1.5, 0.5)) / holeRes);
    vec4 t01 = texture(holeTex, (i0 + vec2(0.5, 1.5)) / holeRes);
    vec4 t11 = texture(holeTex, (i0 + 1.5) / holeRes);
    vec4 nearest = fr.x < 0.5 ? (fr.y < 0.5 ? t00 : t01) : (fr.y < 0.5 ? t10 : t11);
    int k = holeKind(t00);
    if (holeKind(t10) != k || holeKind(t01) != k || holeKind(t11) != k) return nearest;
    vec4 m = mix(mix(t00, t10, fr.x), mix(t01, t11, fr.x), fr.y);
    if (k == 1 || k == 3) return m;
    float spread = max(max(distance(t00.rg, t10.rg), distance(t00.rg, t01.rg)), distance(t00.rg, t11.rg));
    if (spread < BEND_BLEND) return m;
    vec3 d = mix(mix(bendDecode(rd, n1, n2, t00.rg), bendDecode(rd, n1, n2, t10.rg), fr.x),
                 mix(bendDecode(rd, n1, n2, t01.rg), bendDecode(rd, n1, n2, t11.rg), fr.x), fr.y);
    float dl = length(d);
    if (dl < 0.2) return nearest;                  // directions all over the sphere: no mean to speak of
    m.rg = bendEncode(rd, n1, n2, d / dl);
    return m;
}

// what the sky holds in direction d: our Galaxy's stars, far galaxies
vec3 gxSky(vec3 d) {
    float plane = 0.35 + 2.2 * exp(-abs(d.z) * 5.0);
    vec3 s = (skyStars(d, 420.0, 0.10 * plane, 0.9, 0.5) + skyStars(d, 130.0, 0.12, 1.3, 0.8)) * gxStars;
    return s + skyStars(d, 70.0, 0.025, 0.06, 6.0) * vec3(1.0, 0.92, 0.85);
}
// the other universe's sky (mathematics mode, r < 0): the solution says
// nothing about what is there, so this is plainly invented and plainly not
// ours: a tenth of the stars, no Milky Way, cold violet-white and amber only,
// a faint large-scale gradient, no galaxies
vec3 otherSky(vec3 d) {
    vec3 cold = skyStars(d, 300.0, 0.012, 1.2, 0.6) * vec3(0.75, 0.72, 1.25);
    vec3 warm = skyStars(d, 110.0, 0.02, 1.0, 1.2) * vec3(1.25, 0.78, 0.45);
    return cold + warm + vec3(0.004, 0.002, 0.009) * (0.6 + 0.4 * d.y) + vec3(0.006, 0.003, 0.001) * max(-d.x, 0.0) * 0.5;
}

// the scene seen along direction d, re-sampled from this frame's galaxy render
vec3 gxSceneAlong(vec3 d) {
    float fz = dot(d, gxFwd);
    vec2 pp = vec2(dot(d, gxRight), -dot(d, gxUp)) / max(fz, 1e-4);
    vec2 uv2 = pp / vec2(resolution.x / resolution.y, 1.0) + 0.5;
    // off screen: this frame's average glow; blended in over the last stretch
    // toward the edge, so bent light never shows a seam where the frame ends
    vec4 avg = 0.25 * (texture(galaxyTex, vec2(0.25, 0.25)) + texture(galaxyTex, vec2(0.75, 0.25))
                     + texture(galaxyTex, vec2(0.25, 0.75)) + texture(galaxyTex, vec2(0.75, 0.75)));
    float inside = fz > 0.0 ? smoothstep(0.0, 0.2, min(min(uv2.x, 1.0 - uv2.x), min(uv2.y, 1.0 - uv2.y))) : 0.0;
    vec4 g2 = mix(avg, texture(galaxyTex, clamp(uv2, 0.0, 1.0)), inside);
    return g2.rgb + g2.a * gxSky(d);
}

// starlight seen with a frequency shift g (seen over emitted): g^3 in
// intensity, and the broad spectrum slides toward blue (g > 1) or red
// (g < 1). An approximation on the rendered colour, not a spectrum.
vec3 shifted(vec3 c, float g) {
    float k = clamp(g, 0.05, 6.0);
    vec3 tint = k > 1.0 ? mix(vec3(1.0), vec3(0.55, 0.78, 1.45), clamp((k - 1.0) * 1.6, 0.0, 1.0))
                        : mix(vec3(1.35, 0.62, 0.40), vec3(1.0), clamp(k * 1.6 - 0.4, 0.0, 1.0));
    return c * tint * min(k * k * k, 10.0);
}
// the gas's false colour for its mean shift g: hotter-looking where boosted,
// deep red where redshifted (the g^3.5 weight is already in the intensity)
vec3 gasTint(float g) {
    vec3 tint = mix(vec3(1.0, 0.36, 0.10), vec3(1.0, 0.80, 0.55), smoothstep(0.5, 1.2, g));
    return mix(tint, vec3(0.92, 0.94, 1.0), smoothstep(1.2, 1.9, g));
}

// one pixel of the hole, hovering or falling: the look direction's constants
// in the camera's frame, the edge, the tracer read from the sky's side of it,
// the sky where the ray left (ours, or the other universe's), the gas's light
// and the photon ring on the edge. camPos in Rs, rCam signed (sheet).
vec3 holePixel(vec3 rd, vec2 uv, vec3 camPos, float sheet, bool falling) {
    float a = gxSpin;
    float rPlus = HM + sqrt(max(HM * HM - a * a, 0.0)), rMinus = HM - sqrt(max(HM * HM - a * a, 0.0));
    // the hole's frame: the spin axis along z
    vec3 e1 = normalize(cross(gxSpinAxis, abs(gxSpinAxis.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
    vec3 e2 = cross(gxSpinAxis, e1);
    mat3 W2K = transpose(mat3(e1, e2, gxSpinAxis));
    vec3 x = W2K * camPos, v = W2K * rd;
    KSL m = ksLite(x, a, sheet);
    float rCam = m.r;
    vec4 u;
    if (falling) {
        float fa = 2.0 * HM * rCam / (rCam * rCam + a * a);
        float w = sqrt(max(gxFallE * gxFallE - 1.0 + fa, 0.0));
        u = vec4((gxFallE * gxFallE * (1.0 + fa) + fa * fa) / (gxFallE + fa * w), -w * sheet * normalize(x));
    } else u = vec4(inversesqrt(max(1.0 - m.f, 1e-4)), 0.0, 0.0, 0.0);
    vec4 k4 = ksCameraRay(m, u, v);
    float E = -k4.x;
    vec3 k = k4.yzw;
    float Lz = x.x * k.y - x.y * k.x;
    float lp = E + dot(m.l, k);
    vec3 dx = k - m.f * lp * m.l;                 // the photon's coordinate velocity
    float rdot = -dot(m.dr, dx);                  // backward along the light: > 0 climbing
    float Kc;
    if (falling) Kc = m.A * dot(k.xy, k.xy);
    else {
        float Sigma = m.D / (rCam * rCam), Delta = rCam * rCam - 2.0 * HM * rCam + a * a;
        float EA = E * m.A - a * Lz;
        Kc = (EA * EA - Sigma * Sigma * rdot * rdot) / Delta;
    }
    // the sky's edge, signed: outside r+ by the potential; between the
    // horizons every backward ray climbs, E > 0 crosses r+; inside r- (math)
    // the tracer alone decides
    float xs;
    if (rCam > rPlus) xs = radialClass(E, Lz, Kc, a, rCam, rdot > 0.0, rPlus);
    else if (rCam > rMinus) xs = radialClass(E, Lz, Kc, a, rPlus, true, rPlus);
    else xs = 1.0;
    // on screen, the sky lies away from the hole's position (with the hole
    // behind us the projection flips)
    vec3 toHole = -camPos;
    float fz = dot(normalize(toHole), gxFwd);
    fz = abs(fz) < 1e-6 ? 1e-6 : fz;
    vec2 cuv = vec2(dot(normalize(toHole), gxRight), -dot(normalize(toHole), gxUp)) / fz / vec2(resolution.x / resolution.y, 1.0) + 0.5;
    vec2 outward = normalize(uv - cuv + 1e-9) * sign(fz);
    vec2 texel = 1.0 / holeRes;
    // the tracer runs at a third of the resolution; the edge is known exactly
    // here, so near it the tracer is read only from the same side: a crisp
    // rim at full resolution, no bleeding
    float nudge = (xs <= 0.0 ? -2.0 : 2.0) * (1.0 - smoothstep(0.0, 0.15, abs(xs)));
    vec3 n1, n2;
    bendBasis(toHole, rd, n1, n2);
    vec4 traced = holeRead(uv + outward * texel * nudge, rd, n1, n2);
    int kind = holeKind(traced);
    float g = 1.0 / max(E, 1e-3);                // the sky's shift, seen over emitted
    vec3 col = vec3(0.0);
    if (xs > 0.0 && kind == 2) {
        col = shifted(otherSky(bendDecode(rd, n1, n2, traced.rg)), g);
    } else if (xs > 0.0 && kind != 1) {
        float B = length(toHole - rd * dot(toHole, rd));   // the flat impact parameter, Rs
        vec3 d;
        if (!falling && (kind == 3 || B > 55.0)) {
            // far from the hole: the weak-field series (Keeton & Petters 2005)
            float alpha = 2.0 / B + 0.9817477 / (B * B) + 5.3333 / (B * B * B);
            d = rd * cos(alpha) + n1 * sin(alpha);
        } else if (xs < 0.04 && rCam > rPlus && a < 0.01) {
            // right at the edge of a non-spinning hole: the strong-deflection
            // limit (Bozza 2002), alpha = -log(b/b_c - 1) - 0.4002, sharp at
            // full resolution, along the tracer's azimuth; blended into the
            // trace over the band's outer half, so it ends without a seam.
            // Only at a = 0: with spin, xs is no longer b/b_c - 1 (its scale
            // differs between the approaching and the receding side) and the
            // formula would paint the ring instead of tracing it (from the
            // equator at a/M = 0.94 it is 144 degrees off at the band's edge)
            float alpha = -log(xs) - 0.4002;
            vec2 bv = traced.rg;
            float bl = length(bv);
            vec2 az = bl > 1e-6 ? bv / bl : vec2(1.0, 0.0);
            vec3 dF = rd * cos(alpha) + (n1 * az.x + n2 * az.y) * sin(alpha);
            d = normalize(mix(bendDecode(rd, n1, n2, bv), dF, 1.0 - smoothstep(0.02, 0.04, xs)));
        } else d = bendDecode(rd, n1, n2, traced.rg);
        col = shifted(gxSceneAlong(d), g);
    }
    // the hot gas's light (see-through), tinted by its mean shift; a dark ray
    // carries the infall's glow instead, already shifted sample by sample
    if (kind == 0) col += gasTint(traced.a) * max(traced.b, 0.0);
    else if (kind == 1) col += max(traced.rgb, 0.0);
    // the photon ring: the gas's light, wrapped once more around the hole,
    // squeezed into a thin line on the shadow's edge (drawn at full resolution)
    if (xs > 0.0 && rCam > rMinus) {
        vec4 rimT = holeRead(uv + outward * texel * 3.0, rd, n1, n2);
        vec3 rim = holeKind(rimT) == 0 ? gasTint(rimT.a) * max(rimT.b, 0.0) : vec3(0.0);
        col += (rim * 0.9 + vec3(0.02, 0.012, 0.006)) * exp(-xs / 0.006);
    }
    return col;
}

// returns the lensed colour, or a negative red channel when the hole is too
// far away to matter
vec3 blackHole(vec3 rd, vec2 uv) {
    if (gxFallE > 0.0) return holePixel(rd, uv, gxCam / RS_KPC, gxCamSheet, true);
    vec3 toBH = -gxCam;
    if (length(gxCam) > 2e-4 || dot(toBH, rd) <= 0.0) return vec3(-1.0);
    return holePixel(rd, uv, gxCam / RS_KPC, 1.0, false);
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
    float t = time;

    // the soft sky is far away: it shifts only a little with the pointer
    vec4 sky = texture(nebulaTex, 0.5 + (uv - 0.5) / OVERSCAN + view * 0.010); // pan is applied in nebula.frag
    vec3 col = sky.rgb * exposure;

    col += starfield(p, t, sky.a) * (0.85 + 0.15 * exposure);
    col += brightStars(p, t);
    // the solar system: flat view, chase view, or a cross-fade between them
    vec4 sys = galactic < 1.0 && galaxyMix < 1.0 ? systemScene(p, t, accent.rgb) * (1.0 - galactic) : vec4(0.0);
    col = col * (1.0 - sys.a) + sys.rgb;
    col += shootingStar(p, t);
    col += satellite(p, t);
    if (galactic > 0.0) col += spaceDust(p) * galactic;

    if (galaxyMix > 0.0) {
        // the Milky Way view: the volume (dust hides the stars behind it), our
        // own Galaxy's stars around us, faint far galaxies, the chosen hotspot
        vec3 rd = normalize(gxFwd + gxRight * p.x - gxUp * p.y);
        vec4 g = texture(galaxyTex, uv);
        vec3 gc = g.rgb + g.a * gxSky(rd) + hotspotLook(rd, t) * (0.35 + 0.65 * g.a);
        vec3 hole = blackHole(rd, uv);
        if (hole.r >= 0.0) gc = hole;
        if (gxRealSky > 0.0) {
            // the real sky from here: galactic longitude from the Centre
            // toward rotation, latitude toward the north pole
            float l = atan(rd.x, -rd.y);
            float b = asin(clamp(rd.z, -1.0, 1.0));
            vec3 real = textureLod(skyFull, vec2(0.5 - l / 6.2831853, 0.5 - b / 3.14159265), 0.0).rgb;
            gc = mix(gc, real + hotspotLook(rd, t), gxRealSky);
        }
        col = mix(col, gc, galaxyMix);
    }

    if (skyMix > 0.0) {
        // Sky mode: the real sky around Earth, any direction, any zoom; on a
        // named view its native 5K render takes over, pixel for pixel
        vec3 rd = normalize(skyFwd * skyFocal + skyRight * p.x - skyUp * p.y);
        float l = atan(rd.x, -rd.y);
        float b = asin(clamp(rd.z, -1.0, 1.0));
        float texelsPerPx = (8192.0 / 6.2831853) / (resolution.y * skyFocal);
        vec3 real = textureLod(skyFull, vec2(0.5 - l / 6.2831853, 0.5 - b / 3.14159265), log2(max(texelsPerPx, 1.0))).rgb;
        if (skyStaticMix > 0.0) real = mix(real, texture(skyStatic, uv).rgb, skyStaticMix);
        col = mix(col, real, skyMix);
    }

    // the end of the fall: black, then back beside the Sun (the HUD stays)
    if (gxFallFade > 0.0) col *= 1.0 - gxFallFade;

    if (hudLevel > 0.0)
        col += hud(p, t, accent.rgb, themed(vec3(0.95, 0.15, 0.62), 0.38));

    // static dither against banding in the faint gas, never on black
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += (hash12(uv * resolution) - 0.5) / 255.0 * smoothstep(0.004, 0.02, lum);

    fragColor = vec4(max(col, 0.0), 1.0) * qt_Opacity;
}
