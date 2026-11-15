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
//
// The Local Group around it: Andromeda and Triangulum are thin disks unfolded
// from their own photos (tools/deproject_galaxy.py) at their real distances
// and tilts, Andromeda with a round bulge and its two close ellipticals M32
// and NGC 205; the Large Magellanic Cloud is a barred, lopsided disk and the
// Small one an irregular body stretched along our line of sight, both marched
// as volumes; the other dwarfs of McConnachie 2012 (textures/dwarfs.png, from
// lib/dwarfs.js) are faint ellipsoidal glows. Every galaxy's light follows
// from its absolute magnitude (lum()), so the group keeps its real contrasts.
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
    vec4 m31Pos;      // centre (kpc), scale (1: its own map is in true kpc)
    vec3 m31Major;
    vec3 m31Minor;    // in-plane axes signed like the photo (tools/deproject_galaxy.py)
    vec3 m31Normal;
    float m31Fade;    // 1 drawn here, 0 where its photo card has taken over (Earth's view)
    vec4 m33Pos;
    vec3 m33Major;
    vec3 m33Minor;
    vec3 m33Normal;
    float m33Fade;
    vec4 m32;         // M32: centre (kpc), half-light radius (kpc)
    vec4 m32Shape;    // ellipticity, position angle (radians, north through east), M_V
    vec4 n205;        // NGC 205 (M110), the same
    vec4 n205Shape;
    vec4 lmc;         // centre (kpc), radius (1 sigma)
    vec4 smc;
    vec3 lmcMajor;    // the LMC disk's frame (lib/localgroup.js lmcModel)
    vec3 lmcMinor;
    vec3 lmcNormal;
    vec4 lmcBar;      // bar direction in the plane (xy), half-length (kpc)
    vec4 lmcOff;      // the disk's centre from the bar's (xy, kpc), the heavy side's direction (zw)
    float exposure;
    float spin;       // time-lapse: the disk turned this far (radians, with Galactic rotation)
    vec2 cloudFade;   // LMC, SMC: 1 drawn here, 0 when their real photo has taken over
    float dwarfCount; // columns used in dwarfTex
};

layout(binding = 1) uniform sampler2D youngTex;
layout(binding = 2) uniform sampler2D dustTex;
// Andromeda and Triangulum face-on, unfolded from their real photos
// (tools/deproject_galaxy.py): +-24 kpc and +-9 kpc
layout(binding = 3) uniform sampler2D m31Tex;
layout(binding = 4) uniform sampler2D m33Tex;
// the dwarf galaxies, one column each (tools/gen_dwarfs.py; nearest-sampled):
// rows 0-2 X, Y, Z as three bytes of (v + 1600) / 3200 (0.2 pc steps: the
// smallest dwarfs are 20 pc across); row 3 half-light radius (kpc / 4, two
// bytes) and a type byte (0 not drawn, 1 spheroidal, 2 irregular); row 4
// (M_V + 20) / 20, ellipticity, position angle / 360
layout(binding = 5) uniform sampler2D dwarfTex;
const float DWARF_ROWS = 5.0;

const float EXT = 16.0;          // the maps cover +-16 kpc
const float RMAX = 17.0;
const float HMAX = 1.8;
const float DUSTK = 3.2;         // extinction per kpc at full map dust
const vec2 BAR = vec2(0.45399, 0.89101); // sin, cos of 27 degrees: the bar's long axis
const vec3 SUN = vec3(0.0, 8.15, 0.0208);
const vec3 NCP = vec3(0.74698, 0.48383, 0.45599); // the celestial north pole in this frame
// the unit of light is Andromeda: its drawn total (map and bulge) sums to L31
// for M_V = -21.2 (lib/localgroup.js has the same two numbers)
const float L31 = 219.0;

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

// the light of a galaxy of absolute magnitude mv, in Andromeda's units
float lum(float mv) {
    return L31 * exp2(-1.3287712 * (mv + 21.2)); // 10^(-0.4 dm)
}

// toward a galaxy from the Sun, and north and east on the sky there
// (tools/deproject_galaxy.py's gal())
void skyBasis(vec3 pos, out vec3 s, out vec3 n, out vec3 e) {
    s = normalize(pos - SUN);
    n = normalize(NCP - s * dot(NCP, s));
    e = cross(n, s);
}

// light and dust at a point of a galaxy, in its own frame (kpc, disk in xy)
void sampleDisk(vec3 p, float lod, int which, out vec3 emit, out float dust) {
    if (which == 1) {
        // Andromeda: its real disk (the photo's own dust lanes are in it), a
        // thin layer, and a round 3D bulge in place of the one the unfolding smeared
        float Rm = length(p.xy);
        vec3 c = textureLod(m31Tex, vec2(0.5 + p.x / 48.0, 0.5 - p.y / 48.0), lod).rgb;
        c *= c;
        // the ring of star formation at R ~ 10 kpc (Gordon et al. 2006, ApJ
        // 638, L87: near-circular, offset from the nucleus, split near M32):
        // its light is in the photo; here its young stars get a blue cast
        // and the layer a little more height (the same light, spread taller,
        // so face-on it stays the photo and edge-on the ring stands out)
        float rr = (Rm - 10.0) / 1.3;   // (pow() of a negative base is undefined in GLSL)
        float ring = exp(-rr * rr);
        float h = 0.35 + 0.12 * ring;
        c *= mix(vec3(1.0), vec3(0.82, 0.93, 1.22), 0.45 * ring);
        float bulge = exp(-length(vec3(p.xy, p.z * 1.6)) / 0.8);
        emit = c * 1.4 * (0.35 / h) * exp(-abs(p.z) / h) * (1.0 - smoothstep(22.0, 24.0, Rm)) + vec3(1.0, 0.82, 0.60) * bulge * 1.6;
        dust = 0.0;
        return;
    }
    if (which == 2) {
        // Triangulum: its own unfolded photo (+-9 kpc; it fades past ~8 kpc,
        // where the photo ends) as a thin layer. It has no bulge, only a
        // nuclear cluster far too small to show, so the centre stays as the
        // photo has it. 2.0 and 0.30 kpc give M_V = -18.8 against
        // Andromeda's -21.2 (McConnachie 2012)
        float Rm = length(p.xy);
        vec3 c = textureLod(m33Tex, vec2(0.5 + p.x / 18.0, 0.5 - p.y / 18.0), lod).rgb;
        c *= c;
        emit = c * 2.0 * exp(-abs(p.z) / 0.30) * (1.0 - smoothstep(8.0, 9.0, Rm));
        dust = 0.0;
        return;
    }
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

// each disk's reach: radius, half-height, and the kpc one texel of its map covers
float diskRadius(int which) { return which == 1 ? 24.5 : which == 2 ? 9.0 : RMAX; }
float diskHeight(int which) { return which == 2 ? 1.0 : HMAX; }
float diskTexel(int which) { return (which == 1 ? 48.0 : which == 2 ? 18.0 : 2.0 * EXT) / 2048.0; }

// ray through one galaxy, front to back; returns light and transmittance
vec4 marchDisk(vec3 ro, vec3 rd, float jitter, float pxAngle, float scale, int which) {
    float rmax = diskRadius(which);
    float hmax = diskHeight(which);
    float t0 = 0.0;
    float t1 = 1e9;
    if (abs(rd.z) > 1e-6) {
        float ta = (-hmax - ro.z) / rd.z;
        float tb = (hmax - ro.z) / rd.z;
        t0 = max(t0, min(ta, tb));
        t1 = min(t1, max(ta, tb));
    } else if (abs(ro.z) > hmax) {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }
    float a = dot(rd.xy, rd.xy);
    float b = dot(ro.xy, rd.xy);
    float c = dot(ro.xy, ro.xy) - rmax * rmax;
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
    float texel = diskTexel(which);
    for (int i = 0; i < N; i++) {
        float s0 = (float(i) + jitter) / float(N);
        float s1 = (float(i) + 1.0 + jitter) / float(N);
        float ta = t0 + len * s0 * s0;
        float dt = len * (s1 * s1 - s0 * s0);
        vec3 p = ro + rd * ta;
        // texture detail no finer than a pixel at this distance
        float lod = log2(max(ta * pxAngle / texel, 1.0));
        vec3 e;
        float d;
        sampleDisk(p, lod, which, e, d);
        float tau = d * dt * scale; // dt is in the galaxy's own units
        float tr = exp(-tau);
        // light emitted inside a step is dimmed by that step's own dust too
        L += T * e * dt * scale * (tau > 1e-4 ? (1.0 - tr) / tau : 1.0);
        T *= tr;
        if (T < 0.01) break;
    }
    return vec4(L, T);
}

vec4 otherGalaxy(vec3 ro, vec3 rd, vec4 pos, vec3 major, vec3 minor, vec3 normal, float jitter, float pxAngle, int which) {
    vec3 o = (ro - pos.xyz) / pos.w;
    vec3 lo = vec3(dot(o, major), dot(o, minor), dot(o, normal));
    vec3 ld = vec3(dot(rd, major), dot(rd, minor), dot(rd, normal));
    // cheap reject: the ray misses its bounding sphere
    float tb = -dot(lo, ld);
    float rb = diskRadius(which);
    if (dot(lo, lo) - tb * tb > rb * rb * 1.2) return vec4(0.0, 0.0, 0.0, 1.0);
    return marchDisk(lo, ld, jitter, pxAngle, pos.w, which);
}

// An elliptical or spheroidal galaxy as a Gaussian ellipsoid, the ray's
// integral in closed form: 0.6 of its light L in a core of width sig and 0.4
// in a halo 2.5 times wider (the wings of a Sersic profile), the mix's
// half-light radius rh = 1.58 sig. Flattened by the ellipticity along the
// sky's minor axis (the depth, which no one sees, by the square root of
// that). Unresolved, it is blurred to about a pixel so its light stays
// instead of falling between the samples.
vec3 ellGlow(vec3 ro, vec3 rd, vec3 c, float rh, float ell, float pa, float L, float pxKpc) {
    vec3 s, n, e;
    skyBasis(c, s, n, e);
    vec3 a = cos(pa) * n + sin(pa) * e;      // the major axis on the sky
    vec3 b = cross(s, a);
    float q = max(1.0 - ell, 0.2);
    float qz = sqrt(q);
    vec3 o = ro - c;
    // into the frame where it is round
    vec3 op = vec3(dot(o, a), dot(o, b) / q, dot(o, s) / qz);
    vec3 dp = vec3(dot(rd, a), dot(rd, b) / q, dot(rd, s) / qz);
    float dl2 = dot(dp, dp);
    float tc = -dot(op, dp) / dl2;
    if (tc < 0.0) return vec3(0.0);
    vec3 cl = op + dp * tc;
    float d2 = dot(cl, cl);
    float sig = rh / 1.58;
    float s1 = sig * sig + pxKpc * pxKpc;    // a pixel's blur, in quadrature
    float s2 = 6.25 * sig * sig + pxKpc * pxKpc;
    // integral of exp(-|op + t dp|^2 / 2 sig^2) dt = sqrt(2 pi) sig / |dp| exp(-d2 / 2 sig^2),
    // with the total L = j0 (2 pi)^1.5 sig^3 q qz: line = L exp(..) / (2 pi sig^2 q qz |dp|)
    float k = L / (6.2831853 * q * qz * sqrt(dl2));
    return vec3(k * (0.6 / s1 * exp(-d2 / (2.0 * s1)) + 0.4 / s2 * exp(-d2 / (2.0 * s2))));
}

// The Large Magellanic Cloud at a point of its disk frame (kpc; x along the
// line of nodes, z the disk normal, the origin at the bar's centre, which is
// the hotspot): an exponential disk of scale length 1.4 kpc (van der Marel
// 2001, AJ 122, 1827) and height ~0.3 kpc, centred ~0.8 kpc off the bar (at
// the H I kinematic centre, to the north-west), made lopsided toward 30
// Doradus (its star-forming side, to the east); a bar ~3 kpc long
// across the centre; and the clumps of its star clouds. Scaled so the whole
// sums to M_V = -18.1 (lib/localgroup.js lmcModel has the geometry).
vec3 lmcEmit(vec3 q) {
    vec2 dc = q.xy - lmcOff.xy;
    float R = length(dc);
    float heavy = 1.0 + 0.35 * dot(dc, lmcOff.zw) / max(R, 0.4);
    float disk = exp(-R / 1.4) * exp(-abs(q.z) / 0.30) * heavy;
    float u = dot(q.xy, lmcBar.xy);
    float v = dot(q.xy, vec2(-lmcBar.y, lmcBar.x));
    float bar = exp(-pow(abs(u) / lmcBar.z, 4.0)) * exp(-(v * v) / 0.2025) * exp(-abs(q.z) / 0.25);
    float clump = 0.7 + 0.6 * noise3(q * 2.2) * noise3(q * 4.5 + 3.1);
    return (vec3(0.90, 0.90, 1.0) * disk + vec3(1.0, 0.90, 0.78) * bar * 0.9) * clump * (lum(-18.1) / 7.17);
}

// The Small Magellanic Cloud at a point of its frame (x along its body's
// major axis on the sky, NE-SW; y across it; z along our line of sight, away
// from us): an irregular body about 1 kpc wide (1 sigma) and much deeper
// than wide. Red clump stars give a line-of-sight depth of 4.9 +- 1.2 kpc in
// its bar and 4.2 +- 1.5 kpc in its disk (Subramanian & Subramaniam 2009,
// A&A 496, 399), its star clusters a +-1 sigma depth of 6-12 kpc (Crowl et
// al. 2001, AJ 122, 220): drawn with sigma 2.3 kpc along the line of sight,
// the north-eastern side nearer us as both find. The Wing reaches toward the
// LMC. Scaled to M_V = -16.8.
vec3 smcEmit(vec3 q, vec3 toLmc) {
    vec3 r = vec3(q.x / 1.0, q.y / 0.65, (q.z + 0.6 * q.x) / 2.3);
    float body = exp(-0.5 * dot(r, r));
    vec3 w = q - toLmc * 1.8;
    float wing = 0.25 * exp(-dot(w, w) / 1.28);
    float clump = 0.7 + 0.6 * noise3(q * 2.6) * noise3(q * 5.0 + 1.7);
    return vec3(0.90, 0.91, 1.0) * (body + wing) * clump * (lum(-16.8) / 22.0);
}

// a Magellanic Cloud: marched through its bounding sphere, optically thin.
// The light tapers to nothing over the sphere's outer 2 kpc, where the LMC's
// disk is still ~1 % of its centre: cut flat, that would be a grey step on
// the black of the OLED
vec3 marchCloud(vec3 ro, vec3 rd, float jitter, int which) {
    vec3 c = which == 0 ? lmc.xyz : smc.xyz;
    float rb = which == 0 ? 7.0 : 7.5;
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float disc = b * b - dot(oc, oc) + rb * rb;
    if (disc < 0.0) return vec3(0.0);
    float sq = sqrt(disc);
    float t0 = max(0.0, -b - sq);
    float t1 = -b + sq;
    if (t1 <= t0) return vec3(0.0);
    vec3 A, B, C;
    vec3 toLmc = vec3(0.0);
    if (which == 0) { A = lmcMajor; B = lmcMinor; C = lmcNormal; }
    else {
        vec3 s, n, e;
        skyBasis(c, s, n, e);
        A = 0.70711 * (n + e);  // the body's major axis, position angle 45
        B = cross(s, A);
        C = s;
        vec3 d = normalize(lmc.xyz - c);
        toLmc = vec3(dot(d, A), dot(d, B), dot(d, C));
    }
    const int N = 24;
    float dt = (t1 - t0) / float(N);
    vec3 L = vec3(0.0);
    for (int i = 0; i < N; i++) {
        vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt) - c;
        vec3 q = vec3(dot(p, A), dot(p, B), dot(p, C));
        float edge = smoothstep(rb, rb - 2.0, length(p));
        L += (which == 0 ? lmcEmit(q) : smcEmit(q, toLmc)) * (dt * edge);
    }
    return L;
}

// the dwarf galaxies of the table, each dimmed by whatever lies in front of
// it: the Milky Way's dust when it is beyond the Centre, Andromeda's disk
// when it is beyond Andromeda (by centre distances; the glows are thin)
vec3 dwarfs(vec3 ro, vec3 rd, float pxAngle, float T, float farT) {
    vec3 acc = vec3(0.0);
    int n = int(dwarfCount + 0.5);
    float dMW = length(ro);
    float d31 = length(ro - m31Pos.xyz);
    // (textureLod, not texture(): the reads come after a continue, where an
    // implicit derivative would be undefined; the texture has no mipmaps anyway)
    for (int i = 0; i < 128; i++) {
        if (i >= n) break;
        float u = (float(i) + 0.5) / 128.0;
        vec3 hi = floor(textureLod(dwarfTex, vec2(u, 0.5 / DWARF_ROWS), 0.0).rgb * 255.0 + 0.5);
        vec3 mid = floor(textureLod(dwarfTex, vec2(u, 1.5 / DWARF_ROWS), 0.0).rgb * 255.0 + 0.5);
        vec3 lo = floor(textureLod(dwarfTex, vec2(u, 2.5 / DWARF_ROWS), 0.0).rgb * 255.0 + 0.5);
        vec3 c = ((hi * 256.0 + mid) * 256.0 + lo) / 16777215.0 * 3200.0 - 1600.0;
        vec3 oc = c - ro;
        float tc = dot(oc, rd);
        if (tc < 0.0) continue;
        // far from the ray (every glow is under 3 kpc): skip before the rest is read
        float d = length(oc);
        if (dot(oc, oc) - tc * tc > 100.0 + 4.0 * d * d * pxAngle * pxAngle) continue;
        vec3 r2 = floor(textureLod(dwarfTex, vec2(u, 3.5 / DWARF_ROWS), 0.0).rgb * 255.0 + 0.5);
        if (r2.z < 0.5) continue;
        vec3 r3 = textureLod(dwarfTex, vec2(u, 4.5 / DWARF_ROWS), 0.0).rgb;
        float rh = (r2.x * 256.0 + r2.y) / 65535.0 * 4.0;
        float mv = r3.x * 20.0 - 20.0;
        vec3 tint = r2.z > 1.5 ? vec3(0.85, 0.90, 1.0) : vec3(1.0, 0.92, 0.80);
        vec3 g = tint * ellGlow(ro, rd, c, rh, r3.y, r3.z * 6.2831853, lum(mv), d * pxAngle * 0.7);
        acc += g * (d < dMW ? 1.0 : T) * (d < d31 ? 1.0 : farT);
    }
    return acc;
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
    vec4 mw = marchDisk(mro, mrd, jitter, pxAngle, 1.0, 0);
    vec3 col = mw.rgb;
    float T = mw.a;

    // the Magellanic Clouds sit outside the disk: in front of or behind it
    // (not marched at all where their photo card has taken over)
    vec3 clouds = vec3(0.0);
    if (cloudFade.x > 0.001) clouds += marchCloud(camPos, rd, jitter, 0) * cloudFade.x;
    if (cloudFade.y > 0.001) clouds += marchCloud(camPos, rd, jitter, 1) * cloudFade.y;
    bool cloudsFront = length(camPos - lmc.xyz) < length(camPos);
    col = cloudsFront ? clouds + col : col + T * clouds;

    // Andromeda and Triangulum, far beyond: behind the Milky Way unless we
    // have flown out to them
    vec4 a31 = otherGalaxy(camPos, rd, m31Pos, m31Major, m31Minor, m31Normal, jitter, pxAngle, 1);
    // its ellipticals, in front of its disk or behind it (they are in its
    // photo too, so they go with the disk when the card takes over)
    float d32 = length(camPos - m32.xyz);
    float d205 = length(camPos - n205.xyz);
    vec3 e32 = ellGlow(camPos, rd, m32.xyz, m32.w, m32Shape.x, m32Shape.y, lum(m32Shape.z), d32 * pxAngle * 0.7) * vec3(1.0, 0.90, 0.76);
    vec3 e205 = ellGlow(camPos, rd, n205.xyz, n205.w, n205Shape.x, n205Shape.y, lum(n205Shape.z), d205 * pxAngle * 0.7) * vec3(1.0, 0.92, 0.80);
    float d31 = length(camPos - m31Pos.xyz);
    a31.rgb += e32 * (d32 < d31 ? 1.0 : a31.a) + e205 * (d205 < d31 ? 1.0 : a31.a);
    a31.rgb *= m31Fade;
    vec4 a33 = otherGalaxy(camPos, rd, m33Pos, m33Major, m33Minor, m33Normal, jitter, pxAngle, 2);
    a33.rgb *= m33Fade;
    bool m33First = length(camPos - m33Pos.xyz) < d31;
    vec3 far = m33First ? a33.rgb + a33.a * a31.rgb : a31.rgb + a31.a * a33.rgb;
    float farT = a31.a * a33.a;
    if (d31 < length(camPos) * 0.5) {
        col = far + farT * col;
    } else {
        col = col + T * far;
    }
    T *= farT;

    // the dwarfs, each behind whatever it is behind
    col += dwarfs(camPos, rd, pxAngle, mw.a, farT);

    col *= exposure;
    col = 1.0 - exp(-col); // soft shoulder: the bulge never clips
    fragColor = vec4(col, T);
}
