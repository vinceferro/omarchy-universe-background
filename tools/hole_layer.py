#!/usr/bin/env python3
"""hole_layer.py: runs hole.frag itself on the GPU, off screen, and reports on the layer it writes.

No window and no display: an EGL device context, a float texture, one draw, read back. It is the
tracer exactly as the shell runs it (same GLSL, the GPU's 32-bit floats), which the JS port in
lib/kerr.js (double precision) cannot stand in for: the stray texels inside the shadow only show here.

  tools/hole_layer.py hole.frag [W H] [key=value ...] [out=layer.npy]

  W H        the layer's size (default 1707 720: a third of 5120x2160)
  camPos= camFwd= camRight= camUp=   the camera, Rs and unit vectors (default: parked on the pole at
             6.07 Rs looking at the hole, where the fall starts)
  fallE=     0 hovering; the falling observer's energy otherwise (0.9134 from rest at 6 Rs, 1.5 mathematics mode)
  spin= camSheet= flowTime= flash= aspect= spinAxis=   the other uniforms
  format=16f|32f   the layer's format (the shell's is 16f)
  flipfc=1   gl_FragCoord.y running the other way (the first-step jitter's pattern differs by backend)
  out=       also save the layer, [H][W][4] float32, row 0 at the top

The report: the shadow's size, the texels of each kind (hole.frag's header), the lone texels inside the
dark that the march let escape (each one is a 3x3 px dot on screen), NaN/Inf, the gas's light and
its texel-to-texel grain. Needs numpy.
"""
import ctypes as C, sys, struct, numpy as np
EGL = C.CDLL("libEGL.so.1"); GL = C.CDLL("libOpenGL.so.0")
vp = C.c_void_p
def egl_display():
    EGL.eglGetProcAddress.restype = vp; EGL.eglGetProcAddress.argtypes = [C.c_char_p]
    q = EGL.eglGetProcAddress(b"eglQueryDevicesEXT"); g = EGL.eglGetProcAddress(b"eglGetPlatformDisplayEXT")
    q = C.CFUNCTYPE(C.c_uint, C.c_int, C.POINTER(vp), C.POINTER(C.c_int))(q)
    g = C.CFUNCTYPE(vp, C.c_uint, vp, C.POINTER(C.c_int))(g)
    devs = (vp * 16)(); n = C.c_int(0); q(16, devs, C.byref(n))
    for i in range(n.value):
        d = g(0x313F, devs[i], None)
        if d and EGL.eglInitialize(vp(d), None, None): yield vp(d)
def make_context():
    for dpy in egl_display():
        EGL.eglBindAPI(0x30A2)
        cfg = vp(); n = C.c_int(0)
        attrs = (C.c_int * 5)(0x3033, 0x0001, 0x3040, 0x0008, 0x3038)
        if not EGL.eglChooseConfig(dpy, attrs, C.byref(cfg), 1, C.byref(n)) or n.value < 1: continue
        ca = (C.c_int * 7)(0x3098, 4, 0x30FB, 5, 0x30FD, 1, 0x3038)
        EGL.eglCreateContext.restype = vp; EGL.eglCreateContext.argtypes = [vp, vp, vp, C.POINTER(C.c_int)]
        ctx = EGL.eglCreateContext(dpy, cfg, None, ca)
        if not ctx: continue
        EGL.eglMakeCurrent.argtypes = [vp, vp, vp, vp]
        if EGL.eglMakeCurrent(dpy, None, None, ctx):
            GL.glGetString.restype = C.c_char_p
            return GL.glGetString(0x1F01).decode()
    raise SystemExit("no EGL device context")
def shader(kind, src):
    s = GL.glCreateShader(kind); b = src.encode()
    GL.glShaderSource(s, 1, C.byref(C.c_char_p(b)), None); GL.glCompileShader(s)
    ok = C.c_int(0); GL.glGetShaderiv(s, 0x8B81, C.byref(ok))
    if not ok.value:
        log = C.create_string_buffer(8192); GL.glGetShaderInfoLog(s, 8192, None, log); raise SystemExit(log.value.decode())
    return s
def main():
    frag = sys.argv[1]
    size = [int(a) for a in sys.argv[2:] if "=" not in a]
    W, H = size if len(size) == 2 else (1707, 720)
    kv = dict(a.split("=", 1) for a in sys.argv[2:] if "=" in a)
    vec = lambda k, d: [float(x) for x in kv[k].split(",")] if k in kv else d
    flip = kv.get("flipfc", "0") == "1"
    renderer = make_context()
    vs = "#version 440\nlayout(location = 0) out vec2 qt_TexCoord0;\nvoid main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); qt_TexCoord0 = vec2(p.x, %s); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }" % ("p.y" if not flip else "1.0 - p.y")
    prog = GL.glCreateProgram()
    GL.glAttachShader(prog, shader(0x8B31, vs)); GL.glAttachShader(prog, shader(0x8B30, open(frag).read())); GL.glLinkProgram(prog)
    ok = C.c_int(0); GL.glGetProgramiv(prog, 0x8B82, C.byref(ok))
    if not ok.value: raise SystemExit("link failed")
    GL.glUseProgram(prog)
    # std140: mat4 0, qt_Opacity 64, resolution 72, shown 80, camPos 96, camFwd 112, camRight 128, camUp 144, aspect 156,
    #         spinAxis 160, flowTime 172, fallE 176, spin 180, camSheet 184, flash 188
    buf = bytearray(192)
    def put(off, *v): struct.pack_into("<%df" % len(v), buf, off, *v)
    put(0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); put(64, 1.0); put(72, W, H); put(80, 1.0)
    put(96, *vec("camPos", [0, 5.265, -3.025])); put(112, *vec("camFwd", [0, -0.86603, 0.5])); put(128, *vec("camRight", [-1, 0, 0])); put(144, *vec("camUp", [0, 0.5, 0.86603]))
    put(156, float(kv.get("aspect", 5120 / 2160))); put(160, *vec("spinAxis", [0, -0.8660, 0.5])); put(172, float(kv.get("flowTime", 14)))
    put(176, float(kv.get("fallE", 1.5))); put(180, float(kv.get("spin", 0.47))); put(184, float(kv.get("camSheet", 1))); put(188, float(kv.get("flash", 1)))
    ubo = C.c_uint(0); GL.glGenBuffers(1, C.byref(ubo)); GL.glBindBuffer(0x8A11, ubo)
    GL.glBufferData(0x8A11, C.c_ssize_t(192), (C.c_char * 192).from_buffer(buf), 0x88E4); GL.glBindBufferBase(0x8A11, 0, ubo)
    tex = C.c_uint(0); GL.glGenTextures(1, C.byref(tex)); GL.glBindTexture(0x0DE1, tex)
    fmt = 0x881A if kv.get("format", "16f") == "16f" else 0x8814   # RGBA16F as the layer, or RGBA32F
    GL.glTexStorage2D(0x0DE1, 1, fmt, W, H)
    fbo = C.c_uint(0); GL.glGenFramebuffers(1, C.byref(fbo)); GL.glBindFramebuffer(0x8D40, fbo)
    GL.glFramebufferTexture2D(0x8D40, 0x8CE0, 0x0DE1, tex, 0)
    if GL.glCheckFramebufferStatus(0x8D40) != 0x8CD5: raise SystemExit("fbo incomplete")
    vao = C.c_uint(0); GL.glGenVertexArrays(1, C.byref(vao)); GL.glBindVertexArray(vao)
    GL.glViewport(0, 0, W, H); GL.glDrawArrays(0x0004, 0, 3); GL.glFinish()
    px = np.zeros((H, W, 4), np.float32)
    GL.glReadPixels(0, 0, W, H, 0x1908, 0x1406, px.ctypes.data_as(vp))
    # row r of the read-back has gl_FragCoord.y = r + 0.5 and qt_TexCoord0.y = (r + 0.5) / H (flipfc: 1 - that)
    if flip: px = px[::-1]
    if "out" in kv: np.save(kv["out"], px)
    print("%s, %dx%d %s%s" % (renderer, W, H, kv.get("format", "16f"), ", gl_FragCoord.y flipped" if flip else ""))
    report(px)

def report(t):
    H, W = t.shape[:2]
    a, b = t[..., 3], t[..., 2]
    kind = np.where(a < 0, 1, np.where(b < 0, 2, np.where(a == 0, 3, 0)))   # universe.frag's holeKind
    print("texels: sky %d, dark %d, other universe %d, no trace %d; NaN %d, Inf %d" % ((kind == 0).sum(), (kind == 1).sum(), (kind == 2).sum(), (kind == 3).sum(), np.isnan(t).any(2).sum(), np.isinf(t).any(2).sum()))
    dark = kind == 1
    # texels the march let out inside the shadow: not dark, with at least 7 of the 8 around them dark
    n8 = sum(np.roll(np.roll(dark, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
    lone = ~dark & (n8 >= 7); lone[0] = lone[-1] = False; lone[:, 0] = lone[:, -1] = False
    st = np.nonzero(lone)
    # the shadow's circle, when it is whole and in frame: for the texels' place on its radius
    r0 = int(dark.sum(1).argmax()); xs = np.nonzero(dark[r0])[0]; circ = None
    if len(xs) > 8 and xs.min() > 0 and xs.max() < W - 1:
        ys = np.nonzero(dark[:, int(np.median(xs))])[0]
        if ys.min() > 0 and ys.max() < H - 1: circ = ((xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, (xs.max() - xs.min() + 1) / 2)
    print("shadow: " + ("centre (%.1f, %.1f), radius %.1f texels" % circ if circ else "not a whole circle in frame") + "; lone texels the march let out inside the dark: %d" % len(st[0]))
    for y, x in list(zip(*st))[:12]:
        print("   texel (%d, %d)%s, kind %d, rgba %s" % (x, y, " at %.3f of the radius" % (np.hypot(x - circ[0], y - circ[1]) / circ[2]) if circ else "", kind[y, x], np.array2string(t[y, x], precision=3)))
    if len(st[0]) > 12: print("   ...")
    sky = kind == 0
    if sky.any():
        lit = sky & (b > 0.02)
        nb = (np.roll(b, 1, 0) + np.roll(b, -1, 0) + np.roll(b, 1, 1) + np.roll(b, -1, 1)) / 4
        m = lit & np.roll(lit, 1, 0) & np.roll(lit, -1, 0) & np.roll(lit, 1, 1) & np.roll(lit, -1, 1)
        m[0] = m[-1] = False; m[:, 0] = m[:, -1] = False
        g = ((b - nb) / np.maximum(nb, 1e-6))[m]
        print("gas light (b): mean %.2f, max %.1f, at 1 or more (white with a blue-white tint) on %.1f%% of the sky texels; mean shift %.2f" % (b[sky].mean(), b[sky].max(), 100 * (b[sky] >= 1).mean(), a[sky].mean()))
        if g.size: print("gas grain, a texel against its four neighbours: rms %.1f%%, 95th percentile %.1f%%" % (100 * np.sqrt((g ** 2).mean()), 100 * np.percentile(np.abs(g), 95)))
        print("bend angle: median %.2f rad, max %.2f (RGBA16F keeps 11 bits: steps of 1/1024 rad, 2 px at 2160, from 1 rad up)" % (np.median(np.hypot(t[..., 0], t[..., 1])[sky]), np.hypot(t[..., 0], t[..., 1])[sky].max()))
main()
