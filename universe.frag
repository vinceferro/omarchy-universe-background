#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    vec2 resolution;
};

// ssin() wrapper: GPU range reduction loses precision for large arguments, so
// reduce the argument modulo 2*pi first (mathematically identical).
float ssin(float x) {
    return sin(mod(x, 6.2831853));
}

float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n + 17.17));
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int k = 0; k < 5; k++) {
        v += a * vnoise(p);
        p = rot * p * 2.03 + vec2(3.7, 9.1);
        a *= 0.55;
    }
    return v;
}

// clustered starfield; 3x3 neighbourhood so halos never clip at cell borders
vec3 starLayer(vec2 p, float scale, float density, float t, float glow, vec2 vel, float clusF) {
    vec3 col = vec3(0.0);
    vec2 g = (p + vel * t) * scale;
    vec2 baseId = floor(g);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = baseId + vec2(float(i), float(j));
            float h = hash21(id);
            if (h < density * clusF) {
                vec2 f = g - id;
                vec2 sp = 0.5 + 0.4 * hash22(id + 31.7);
                float d = length(f - sp);
                float phase = hash21(id + 7.3) * 6.2831;
                float speed = 0.8 + 1.6 * hash21(id + 13.1);
                float tw = 0.5 + 0.5 * ssin(t * speed + phase);
                tw = pow(tw, 3.0);
                float size = (1.1 + 3.0 * hash21(id + 5.5)) * scale / resolution.y;
                float halo = smoothstep(size * (1.0 + 2.5 * tw), 0.0, d);
                float core = smoothstep(size, 0.0, d);
                float tint = hash21(id + 99.1);
                vec3 sc = tint < 0.6 ? vec3(0.92, 0.94, 1.0)
                        : (tint < 0.8 ? vec3(0.6, 0.83, 1.0)
                        : (tint < 0.93 ? vec3(1.0, 0.86, 0.7) : vec3(1.0, 0.67, 0.9)));
                col += sc * (halo * (0.16 + 0.42 * tw) * glow + core * (0.55 + 1.00 * tw));
            }
        }
    }
    return col;
}

// distant galaxies: slowly shimmering fuzzy ovals with bright cores
vec3 galaxies(vec2 p, float t) {
    vec3 col = vec3(0.0);
    vec2 g = p * 2.2;
    vec2 id = floor(g);
    float h = hash21(id + 43.7);
    if (h < 0.22) {
        vec2 pos = id + 0.5 + 0.15 * (hash22(id + 9.1) - 0.5);
        vec2 rel = g - pos;
        float ang = hash21(id + 3.3) * 3.14159;
        float ca = cos(ang);
        float sa = ssin(ang);
        vec2 r = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
        float ell = length(r * vec2(1.0, 2.4));
        float disc = exp(-ell * ell * 14.0);
        float core = exp(-ell * ell * 90.0);
        float shimmer = 0.75 + 0.25 * vnoise(vec2(ell * 7.0, hash21(id + 1.1) * 10.0));
        float twk = 0.9 + 0.1 * ssin(t * 0.2 + hash21(id) * 6.2831);
        vec3 tint = mix(vec3(0.80, 0.85, 1.0), vec3(1.0, 0.85, 0.72), hash21(id + 77.7));
        col += tint * (disc * 0.22 * shimmer + core * 0.45) * twk;
    }
    return col;
}

// gentle flowing energy ribbon
vec3 ribbon(vec2 p, float t, float yBase, float amp, float speed, vec3 cA, vec3 cB) {
    float yc = yBase + amp * ssin(p.x * 2.0 + t * 0.15 * speed)
                    + amp * 0.55 * ssin(p.x * 3.7 - t * 0.10 * speed);
    float d = abs(p.y - yc);
    float band = exp(-d * 26.0);
    float pulses = vnoise(vec2(p.x * 3.5 - t * 0.5 * speed, p.y * 9.0 + yBase * 7.0));
    pulses = 0.30 + 0.85 * pulses * pulses;
    vec3 tint = mix(cA, cB, 0.5 + 0.5 * ssin(p.x * 1.4 + t * 0.05));
    float spark = smoothstep(0.86, 1.0, vnoise(vec2(p.x * 14.0 - t * 1.1 * speed, yBase * 13.0 + p.y * 30.0)));
    return tint * band * pulses * 0.80 + tint * band * spark * 1.3;
}

vec3 shootingStar(vec2 p, float t) {
    float period = 9.0;
    float dur = 1.2;
    float lt = mod(t, period);
    if (lt > dur) return vec3(0.0);
    float u = lt / dur;
    vec2 a = vec2(1.35, 0.82);
    vec2 b = vec2(0.30, 0.25);
    vec2 pos = mix(a, b, u);
    vec2 dir = normalize(b - a);
    vec2 rel = p - pos;
    float along = dot(rel, -dir);
    float across = abs(dot(rel, vec2(-dir.y, dir.x)));
    float fade = ssin(3.14159 * u);
    float trail = smoothstep(0.20, 0.0, along) * step(0.0, along);
    float body = smoothstep(0.0035, 0.0, across + max(along, 0.0) * 0.18);
    float head = smoothstep(0.005, 0.0, length(rel));
    return (vec3(0.72, 0.88, 1.0) * body * trail + vec3(1.0) * head) * fade;
}

vec3 nebula(vec2 p, float t) {
    vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t * 0.012)),
                  fbm(p * 1.4 + vec2(5.2, -t * 0.010)));
    float n = fbm(p * 1.8 + q * 1.7 + vec2(t * 0.010, -t * 0.007));
    float m = fbm(p * 1.1 - q * 1.3 + vec2(-t * 0.008, t * 0.006));
    vec3 col = vec3(0.0);
    col += vec3(0.00, 0.55, 0.90) * smoothstep(0.46, 0.92, n) * 0.55;
    col += vec3(0.42, 0.18, 0.95) * smoothstep(0.44, 0.92, m) * 0.50;
    col += vec3(0.95, 0.15, 0.62) * smoothstep(0.54, 0.96, n * m * 2.2) * 0.30;
    return col;
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
    float t = time;

    // galaxy-cluster density field + milky-way band
    float clus = fbm(p * 1.1 + 17.0);
    vec2 bd = normalize(vec2(0.85, 0.45));
    float bdist = dot(p + vec2(0.12, 0.05), vec2(-bd.y, bd.x));
    float bandGlow = exp(-bdist * bdist * 6.0);
    float clusF = clamp(smoothstep(0.30, 0.78, clus) * 0.85 + bandGlow * 0.6, 0.0, 1.0);

    vec3 col = vec3(0.030, 0.050, 0.115);
    col += nebula(p, t);
    col += galaxies(p, t);
    col += vec3(0.30, 0.34, 0.50) * bandGlow * (0.05 + 0.10 * fbm(p * 3.0 + 5.0));

    col += ribbon(p, t, -0.16, 0.10, 1.0, vec3(0.0, 0.75, 1.0), vec3(0.55, 0.25, 1.0));
    col += ribbon(p, t, 0.24, 0.07, 1.35, vec3(0.95, 0.15, 0.62), vec3(0.35, 0.4, 1.0)) * 0.7;

    // slow parallax starfields clustered into agglomerates
    col += starLayer(p, 14.0, 0.62, t, 1.0, vec2(0.008, 0.0025), clusF);
    col += starLayer(p, 26.0, 0.55, t * 1.1, 0.8, vec2(0.017, 0.005), clusF);
    col += starLayer(p, 44.0, 0.50, t * 1.2, 0.6, vec2(0.030, 0.009), clusF);

    col += shootingStar(p, t);

    float vig = 1.0 - 0.25 * dot(uv - 0.5, uv - 0.5) * 2.2;
    col *= clamp(vig, 0.0, 1.0);

    col += (hash21(uv * resolution + fract(t)) - 0.5) / 255.0;

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
