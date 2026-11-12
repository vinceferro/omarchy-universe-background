#version 440

// Low-resolution pass: the soft parts of the sky. A faint galactic band
// across the ultrawide with gas (theme-tinted reflection and emission), dark
// dust lanes and a few distant galaxies, on true black so OLED pixels stay off
// everywhere else. Rendered at half the screen size into a float layer, about
// ten times a second, and upscaled by universe.frag, which reads the star
// density from alpha. It covers OVERSCAN times the screen so the pointer
// parallax never runs off its edge.

const float OVERSCAN = 1.05;

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;      // updated ~10 times a second; this layer drifts slowly
    vec2 resolution; // full screen size, for the aspect ratio
    vec4 accent;     // theme accent (Color.accent)
    vec4 themeBase;  // theme background (unused: the sky is true black)
    vec2 pan;        // sideways travel in navigation mode
};

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
// offset, so the palette keeps its spread), keeping the built-in brightness.
// Greyish accents (monochrome themes) leave the built-in colours untouched.
vec3 themed(vec3 c, float hueOffset) {
    vec3 a = rgb2hsv(accent.rgb);
    float w = smoothstep(0.15, 0.35, a.y);
    vec3 o = rgb2hsv(c);
    vec3 t = hsv2rgb(vec3(fract(a.x + hueOffset), o.y, o.z));
    return mix(c, t, w);
}

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

// 2D simplex noise (Gustavson / Ashima, MIT): smooth, no grid-aligned blocks.
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
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

// -1..1, six octaves, each rotated so no direction repeats
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int k = 0; k < 6; k++) {
        v += a * snoise(p);
        p = rot * p * 2.02 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}

// a few distant galaxies: small tilted discs with a bright core
vec3 galaxies(vec2 p) {
    vec2 g = p * 1.6;
    vec2 id = floor(g);
    if (hash12(id + 43.7) > 0.12) return vec3(0.0);
    vec2 rel = g - (id + 0.25 + 0.5 * hash22(id + 9.1));
    float ang = hash12(id + 3.3) * 3.14159;
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 r = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
    float ell = length(r * vec2(1.0, 2.0 + 2.0 * hash12(id + 5.1)));
    float size = 0.6 + 0.8 * hash12(id + 2.2);
    float disc = exp(-ell * ell * 220.0 / size);
    float core = exp(-ell * ell * 2400.0 / size);
    vec3 tint = mix(vec3(0.85, 0.88, 1.0), vec3(1.0, 0.88, 0.75), hash12(id + 77.7));
    return tint * (disc * 0.05 + core * 0.16);
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0) * OVERSCAN + pan * 0.05;
    float t = time;

    // the galactic band: a gently curving diagonal across the ultrawide
    vec2 dir = normalize(vec2(1.0, -0.22));
    vec2 nrm = vec2(-dir.y, dir.x);
    float along = dot(p, dir);
    float across = dot(p, nrm) - 0.06 * sin(along * 1.3 + 0.7) + 0.05;
    float band = exp(-across * across * 7.0);

    // slowly evolving, domain-warped gas
    vec2 w = vec2(fbm(p * 0.8 + vec2(0.0, t * 0.004)), fbm(p * 0.8 + vec2(5.2, 1.3) - t * 0.003));
    float gas = fbm(p * 1.5 + w * 0.9);
    float fil = fbm(p * 3.0 + w * 1.7 + 7.0);
    float dust = smoothstep(0.05, 0.55, fbm(p * 2.2 + w * 0.6 + 11.0)) * band;

    vec3 reflection = themed(vec3(0.10, 0.45, 0.90), 0.00);
    vec3 emission = themed(vec3(0.90, 0.20, 0.50), 0.38);
    vec3 violet = themed(vec3(0.45, 0.25, 0.90), 0.20);

    vec3 col = vec3(0.0);
    // barely-there gas, only inside the band: structure, not smoke
    col += reflection * pow(max(gas, 0.0), 2.2) * 0.035 * band;
    col += emission * pow(max(fil, 0.0), 3.0) * 0.06 * band;
    col += violet * pow(max(gas * fil, 0.0), 1.5) * 0.015 * band;
    // unresolved starlight of the band
    col += vec3(0.55, 0.55, 0.65) * band * (0.012 + 0.025 * max(fbm(p * 4.0 + 3.0), 0.0));
    col *= 1.0 - 0.85 * dust;
    col += galaxies(p) * (1.0 - dust);

    // true black floor outside the gas
    col = max(col - 0.003, 0.0);

    float stars = clamp(0.30 + 0.85 * band + 0.20 * fbm(p * 1.3 + 3.0), 0.0, 1.0) * (1.0 - 0.8 * dust);
    fragColor = vec4(col, stars);
}
