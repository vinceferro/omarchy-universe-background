#!/bin/bash
# anatomy.sh [--keep <dir>]: the anatomy layer in Background.qml, run headless.
#
# Like fall.sh: Background.qml's own logic under qmlscene6 on the offscreen
# platform against the stub Quickshell modules (stub/): no shell, no screen,
# no shader drawn. anatomy.qml turns the anatomy on and goes through the
# views; anatomy_check.js then asks what the node suite (tests/test_anatomy.js)
# cannot: that the tick ran without a JavaScript error with the layer on, that
# every view draws its own subject, that a journey fades the lines and the
# arrival brings them back, the idle clock fades them too, the text levels, K, the walk through the story
# band, and that the lines and labels keep to the room the screen's plan
# leaves. About three minutes. Needs qmlscene6 (qt6-declarative) and node.
set -e
H=$(dirname "$(readlink -f "$0")"); WT=${WT:-$(dirname "$(dirname "$H")")}
keep=""
while [ $# -gt 0 ]; do case $1 in --keep) keep=$2; shift;; esac; shift; done
RUN=${keep:-$(mktemp -d)}; mkdir -p "$RUN"; RUN=$(readlink -f "$RUN")
[ -n "$keep" ] || trap 'rm -rf "${RUN:?}"' EXIT
rm -rf "${RUN:?}/stub" "${RUN:?}/run"; cp -r "$H/stub" "$RUN/stub"; mkdir "$RUN/run"
sed -i "s/property string fakeOut: \"\"/property string fakeOut: command.join(' ').indexOf('class\/drm') >= 0 ? '* nvidia\\\\nDP-1 nvidia\\\\n' : ''/" "$RUN/stub/SQ/Io/Process.qml"
sed -e 's/^import Quickshell/import SQ/' -e 's/Commons\.Color\./SColor./g' -e 's/\bColor\./SColor./g' -e '/WlrLayershell\./d' -e '/exclusionMode: ExclusionMode/d' \
    -e '/anchors { top: true; bottom: true; left: true; right: true }/d' "$WT/Background.qml" > "$RUN/run/Bg.qml"
ln -s "$WT/lib" "$RUN/run/lib"; ln -s "$WT/textures" "$RUN/run/textures"; for f in "$WT"/*.qsb; do ln -s "$f" "$RUN/run/"; done
cp "$H/anatomy.qml" "$RUN/run/main.qml"
cd "$RUN/run"
QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software QT_FORCE_STDERR_LOGGING=1 QML_IMPORT_PATH="$RUN/stub" \
  timeout 300 qmlscene6 -I "$RUN/stub" main.qml > "$RUN/log" 2>&1 || true
node "$H/anatomy_check.js" "$RUN/log"
