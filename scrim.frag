#version 440
// scrim.frag — the one legibility rule: a soft dark backing behind a block of
// text, only as strong as the picture under it is bright.
//
// The item is the text block grown by `feather` on every side. The black is
// a soft shape, not a plate: the block with its corners rounded (a pill
// behind a line or two), full in the middle, already easing a little inside
// the block's edge and gone at the item's: no edge and no corner to see.
// How black: `strength` times how bright the scene is under it, read from
// the screen's own picture at low resolution (Background.qml's sceneLuma,
// about 96 texels across, so one tap is already a wide average): mostly the
// spot under this pixel, so the backing leans toward the light, steadied by
// the mean over the whole block. Over a dark scene it is nothing at all;
// over the fall's closing light or the bright gas it is nearly opaque. It is
// black, so it can only ever lower what an OLED shows, and it carries the
// text's opacity: it comes and goes with the words.
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 under;      // where the item lies on the screen: x, y, w, h in 0..1
    vec2 size;       // the item, px
    float feather;   // the margin, px
    float strength;  // the black over a white scene, 0..1
};
layout(binding = 1) uniform sampler2D scene;

const float LUM_LO = 0.10;   // darker than this needs no backing
const float LUM_HI = 0.50;   // this bright gets all of it

float lumAt(vec2 q) { return dot(texture(scene, clamp(q, vec2(0.0), vec2(1.0))).rgb, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    // signed distance from the block's edge, its corners rounded
    vec2 half_ = max(0.5 * size - vec2(feather), vec2(0.5));
    float r = min(min(half_.x, half_.y), feather);
    vec2 q = abs(qt_TexCoord0 * size - 0.5 * size) - (half_ - vec2(r));
    float dist = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
    float shape = 1.0 - smoothstep(-0.35 * feather, feather, dist);
    float mean = 0.0;
    for (int j = 0; j < 3; j++)
        for (int i = 0; i < 5; i++)
            mean += lumAt(under.xy + under.zw * (vec2(float(i), float(j)) + 0.5) / vec2(5.0, 3.0));
    mean /= 15.0;
    float lum = mix(mean, lumAt(under.xy + under.zw * qt_TexCoord0), 0.65);
    float k = strength * smoothstep(LUM_LO, LUM_HI, lum) * shape;
    fragColor = vec4(0.0, 0.0, 0.0, k) * qt_Opacity;
}
