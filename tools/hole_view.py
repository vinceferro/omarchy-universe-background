#!/usr/bin/env python3
"""hole_view.py: the hole's picture as the screen shows it, drawn off screen: hole.frag into its
layer, then universe.frag over it, both exactly as the shell runs them, saved as a PNG.

No window and no display (an EGL device context, as hole_layer.py). Only the galaxy view's hole is
set up: every other texture is black, the galaxy render behind the hole is one flat dim colour with
the model's stars over it, and the HUD is off. It is for looking at what a camera near the hole
sees (the fall's frames, the edge, the upscale from the layer) and for measuring how much of the
picture is blown out, without the shell.

  tools/hole_view.py out.png [W H] [key=value ...]      (run from the repository: it reads ./hole.frag and ./universe.frag)

  W H        the screen (default 2560 1080)
  scale=     the layer's size over the screen's (default 0.5; the shell: lib/quality.js holeChoose)
  format=16f|32f   the layer's format (default 32f, as on NVIDIA)
  over=      the layer's margin (default 1.04)
  camPos= camFwd= camRight= camUp=   the camera, Rs and unit vectors (default: on the pole at 6.07 Rs, looking at the hole)
  fallE=     0 hovering (default); the falling observer's energy otherwise
  camSheet=  -1 on the far sheet
  exp=       the picture's exposure (gxHoleExp, default 1)
  close=     the inner horizon's light, 0..1 (gxFallClose)
  tPos= tFwd= tRight= tUp=   the camera the layer is drawn from, when it is not the screen's (a tracer running behind)
  flowTime= spin= flash=     hole.frag's other uniforms
  sky=       the flat galaxy render behind the hole (default 0.02)
  crop=x,y,w,h   save only this part (screen pixels)
  frag=dir   read the two shaders from another directory

Prints the picture's mean luminance and the share of it at or near white. Needs numpy, Pillow and
Qt's qsb (for universe.frag's uniform layout).
"""
import ctypes as C, sys, struct, json, subprocess, tempfile, os, numpy as np
EGL = C.CDLL("libEGL.so.1"); GL = C.CDLL("libOpenGL.so.0")
vp = C.c_void_p
def make_context():
    EGL.eglGetProcAddress.restype = vp; EGL.eglGetProcAddress.argtypes = [C.c_char_p]
    q = C.CFUNCTYPE(C.c_uint, C.c_int, C.POINTER(vp), C.POINTER(C.c_int))(EGL.eglGetProcAddress(b"eglQueryDevicesEXT"))
    g = C.CFUNCTYPE(vp, C.c_uint, vp, C.POINTER(C.c_int))(EGL.eglGetProcAddress(b"eglGetPlatformDisplayEXT"))
    devs = (vp * 16)(); n = C.c_int(0); q(16, devs, C.byref(n))
    for i in range(n.value):
        d = g(0x313F, devs[i], None)
        if not d or not EGL.eglInitialize(vp(d), None, None): continue
        dpy = vp(d); EGL.eglBindAPI(0x30A2)
        cfg = vp(); m = C.c_int(0)
        if not EGL.eglChooseConfig(dpy, (C.c_int * 5)(0x3033, 0x0001, 0x3040, 0x0008, 0x3038), C.byref(cfg), 1, C.byref(m)) or m.value < 1: continue
        EGL.eglCreateContext.restype = vp; EGL.eglCreateContext.argtypes = [vp, vp, vp, C.POINTER(C.c_int)]
        ctx = EGL.eglCreateContext(dpy, cfg, None, (C.c_int * 7)(0x3098, 4, 0x30FB, 5, 0x30FD, 1, 0x3038))
        if not ctx: continue
        EGL.eglMakeCurrent.argtypes = [vp, vp, vp, vp]
        if EGL.eglMakeCurrent(dpy, None, None, ctx): return
    raise SystemExit("no EGL device context")
def shader(kind, src):
    s = GL.glCreateShader(kind); b = src.encode()
    GL.glShaderSource(s, 1, C.byref(C.c_char_p(b)), None); GL.glCompileShader(s)
    ok = C.c_int(0); GL.glGetShaderiv(s, 0x8B81, C.byref(ok))
    if not ok.value:
        log = C.create_string_buffer(8192); GL.glGetShaderInfoLog(s, 8192, None, log); raise SystemExit(log.value.decode())
    return s
VS = "#version 440\nlayout(location = 0) out vec2 qt_TexCoord0;\nvoid main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); qt_TexCoord0 = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }"
def program(frag):
    p = GL.glCreateProgram()
    GL.glAttachShader(p, shader(0x8B31, VS)); GL.glAttachShader(p, shader(0x8B30, frag)); GL.glLinkProgram(p)
    ok = C.c_int(0); GL.glGetProgramiv(p, 0x8B82, C.byref(ok))
    if not ok.value: raise SystemExit("link failed")
    return p
def layout(path):
    """a shader's uniform block as qsb lays it out: its size and {name: (offset, type)}"""
    with tempfile.TemporaryDirectory() as d:
        q = os.path.join(d, "s.qsb")
        subprocess.run(["/usr/lib/qt6/bin/qsb", "--glsl", "330", "-o", q, path], check=True, capture_output=True)
        o = subprocess.run(["/usr/lib/qt6/bin/qsb", "--dump", q], check=True, capture_output=True, text=True).stdout
    j, _ = json.JSONDecoder().raw_decode(o[o.index("Reflection info: ") + 17:])
    ub = j["uniformBlocks"][0]
    return ub["size"], {m["name"]: (m["offset"], m["type"]) for m in ub["members"]}, {s["name"]: s["binding"] for s in j.get("combinedImageSamplers", [])}
def block(lay, values):
    size, members, _ = lay
    buf = bytearray((size + 15) // 16 * 16)
    for k, v in values.items():
        if k not in members: raise SystemExit("no uniform " + k)
        v = [float(x) for x in (v if isinstance(v, (list, tuple)) else [v])]
        struct.pack_into("<%df" % len(v), buf, members[k][0], *v)
    return buf
def ubo(buf):
    u = C.c_uint(0); GL.glGenBuffers(1, C.byref(u)); GL.glBindBuffer(0x8A11, u)
    GL.glBufferData(0x8A11, C.c_ssize_t(len(buf)), (C.c_char * len(buf)).from_buffer(buf), 0x88E4); GL.glBindBufferBase(0x8A11, 0, u)
def texture(unit, w, h, fmt, data=None, linear=True):
    t = C.c_uint(0); GL.glGenTextures(1, C.byref(t)); GL.glActiveTexture(0x84C0 + unit); GL.glBindTexture(0x0DE1, t)
    GL.glTexStorage2D(0x0DE1, 1, fmt, w, h)
    if data is not None: GL.glTexSubImage2D(0x0DE1, 0, 0, 0, w, h, 0x1908, 0x1406, data.ctypes.data_as(vp))
    for pn, v in ((0x2801, 0x2601 if linear else 0x2600), (0x2800, 0x2601 if linear else 0x2600), (0x2802, 0x812F), (0x2803, 0x812F)): GL.glTexParameteri(0x0DE1, pn, v)
    return t
def target(tex):
    f = C.c_uint(0); GL.glGenFramebuffers(1, C.byref(f)); GL.glBindFramebuffer(0x8D40, f)
    GL.glFramebufferTexture2D(0x8D40, 0x8CE0, 0x0DE1, tex, 0)
    if GL.glCheckFramebufferStatus(0x8D40) != 0x8CD5: raise SystemExit("fbo incomplete")
def main():
    out = sys.argv[1]
    size = [int(a) for a in sys.argv[2:] if "=" not in a]
    W, H = size if len(size) == 2 else (2560, 1080)
    kv = dict(a.split("=", 1) for a in sys.argv[2:] if "=" in a)
    vec = lambda k, d: [float(x) for x in kv[k].split(",")] if k in kv else d
    num = lambda k, d: float(kv.get(k, d))
    d = kv.get("frag", ".")
    cam = dict(pos=vec("camPos", [0, 5.25677, -3.035]), fwd=vec("camFwd", [0, -0.8660254, 0.5]), right=vec("camRight", [-1, 0, 0]), up=vec("camUp", [0, 0.5, 0.86603]))
    tr = dict(pos=vec("tPos", cam["pos"]), fwd=vec("tFwd", cam["fwd"]), right=vec("tRight", cam["right"]), up=vec("tUp", cam["up"]))
    scale, over, spin, axis, sheet, fallE = num("scale", 0.5), num("over", 1.04), num("spin", 0.47), [0, -0.8660254, 0.5], num("camSheet", 1), num("fallE", 0)
    LW, LH = int(np.ceil(W * scale)), int(np.ceil(H * scale))
    make_context()
    GL.glBindVertexArray.argtypes = [C.c_uint]
    vao = C.c_uint(0); GL.glGenVertexArrays(1, C.byref(vao)); GL.glBindVertexArray(vao)
    # the layer
    hl = layout(os.path.join(d, "hole.frag"))
    hp = program(open(os.path.join(d, "hole.frag")).read()); GL.glUseProgram(hp)
    ubo(block(hl, dict(qt_Matrix=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], qt_Opacity=1, resolution=[LW, LH], shown=1, camPos=tr["pos"], camFwd=tr["fwd"], camRight=tr["right"],
                           camUp=tr["up"], aspect=W / H, spinAxis=axis, flowTime=num("flowTime", 14), fallE=fallE, spin=spin, camSheet=sheet, flash=num("flash", 1), over=over)))
    layer = texture(6, LW, LH, 0x881A if kv.get("format", "32f") == "16f" else 0x8814)
    target(layer); GL.glViewport(0, 0, LW, LH); GL.glDrawArrays(0x0004, 0, 3)
    # the screen
    ul = layout(os.path.join(d, "universe.frag"))
    up = program(open(os.path.join(d, "universe.frag")).read()); GL.glUseProgram(up)
    RS_KPC = 4.11e-10
    ubo(block(ul, dict(qt_Matrix=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], qt_Opacity=1, time=10, resolution=[W, H], exposure=1, boot=1, galaxyMix=1, gxStars=1,
                           gxCam=[c * RS_KPC for c in cam["pos"]], gxFwd=cam["fwd"], gxRight=cam["right"], gxUp=cam["up"], gxFallE=fallE, gxSpinAxis=axis, gxSpin=spin,
                           gxCamSheet=sheet, holeRes=[LW, LH], holeFwd=tr["fwd"], holeRight=tr["right"], holeUp=tr["up"], holeOver=over, gxHoleExp=num("exp", 1), gxFallClose=num("close", 0))))
    sky = num("sky", 0.02)
    for name, unit in ul[2].items():
        if name == "holeTex": continue
        texture(unit, 1, 1, 0x8814, np.array([sky, sky * 0.85, sky * 0.7, 1] if name == "galaxyTex" else [0, 0, 0, 0], np.float32))
    GL.glActiveTexture(0x84C0 + 6); GL.glBindTexture(0x0DE1, layer)
    screen = texture(15, W, H, 0x8814)
    target(screen); GL.glViewport(0, 0, W, H); GL.glDrawArrays(0x0004, 0, 3); GL.glFinish()
    px = np.zeros((H, W, 4), np.float32)
    GL.glReadPixels(0, 0, W, H, 0x1908, 0x1406, px.ctypes.data_as(vp))
    rgb = px[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    white = (rgb.min(2) >= 0.95).mean(); bright = (lum >= 0.8).mean()
    print("%s: %dx%d, layer %dx%d; mean luminance %.3f, median %.3f; white (all channels >= 0.95) on %.1f%% of the screen, luminance >= 0.8 on %.1f%%, black (< 0.004) on %.1f%%; NaN %d"
          % (out, W, H, LW, LH, lum.mean(), np.median(lum), 100 * white, 100 * bright, 100 * (lum < 0.004).mean(), np.isnan(rgb).any(2).sum()))
    img = (np.clip(np.nan_to_num(rgb), 0, 1) * 255 + 0.5).astype(np.uint8)   # the screen is sRGB values as written: no curve here either
    if "crop" in kv:
        x, y, w, h = [int(v) for v in kv["crop"].split(",")]; img = img[y:y + h, x:x + w]
    from PIL import Image
    Image.fromarray(img).save(out)
main()
