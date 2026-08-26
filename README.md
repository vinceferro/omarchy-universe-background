# Universe Background — an Omarchy shell plugin

![animated universe background](preview.gif)


A GPU-rendered animated universe wallpaper for [Omarchy](https://omarchy.org):
drifting neon nebula, starfields clustered into agglomerates with a milky-way
band, distant shimmering galaxies, slow energy ribbons and the occasional
shooting star — all procedural GLSL, animated by a time uniform at your
display's **native refresh rate** (120 Hz stays 120 Hz), at full native
resolution, with no video decoding and no loop seam.

![preview](preview.png)

## How it works

- Any background whose filename ends in **`-live.webp`** is rendered by the
  shader instead of being shown as a static image (the file itself serves as
  the static fallback and picker preview).
- Regular images (jpg/png/webp/gif) render exactly as before; animated GIFs
  and WebPs also animate.
- Based on Omarchy's stock `background` plugin, so double-click launcher,
  theme transitions and the reveal animation behave normally.

## Install

Whole setup (this plugin + the matching theme + hook):

```bash
curl -sL https://gist.githubusercontent.com/vinceferro/14ca89b1f493986cff81a81721ac8670/raw/install.sh | bash
```


```bash
omarchy plugin add https://github.com/vinceferro/omarchy-universe-background.git --enable
omarchy restart shell
```

Then set any `-live.webp` background (double-click the wallpaper to open the
picker). Pairs beautifully with the
[ai-engineer theme](https://github.com/vinceferro/omarchy-ai-engineer-theme),
which ships one.

## Tuning

`universe.frag` is the readable GLSL source. Tweak star density, nebula
colors, ribbon speed, the shooting-star period, etc., then recompile:

```bash
qsb --glsl 100es,120 --hlsl 50 --msl 12 -o universe.qsb universe.frag
omarchy restart shell
```

(If your edits don't appear, clear Qt's shader cache: `rm -rf ~/.cache/quickshell`.)

## Notes

- ~6–10% CPU for the whole shell on an M-series laptop; rendering is on the GPU.
- The fragment shader reads `qt_TexCoord0` (the default vertex shader's output
  name) — renaming it causes name-mismatch linkage bugs on some drivers.

## License

MIT
