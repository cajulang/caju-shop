#!/bin/sh
# Builds the store: the CSS (caju style), the program (wasm) and the server.
#   tools/build.sh      CAJU=path/to/caju  CAJU_UI=path/to/caju-ui
# Without CAJU_UI, the caju-ui command is built (once) from the ui package that caju.lock pins,
# into .ui/ (run `caju pkg install` first; CAJU_PKG is the package cache, default ~/.caju/pkg).
set -e
cd "$(dirname "$0")/.."
CAJU=${CAJU:-caju}
if [ -z "$CAJU_UI" ]; then
  UI_VERSION=$(sed -n '/name = "github.com\/cajulang\/ui"/{n;s/version = "\(.*\)"/\1/p;}' caju.lock)
  UI_SRC=${CAJU_PKG:-$HOME/.caju/pkg}/github.com/cajulang/ui@$UI_VERSION
  CAJU_UI=$PWD/.ui/caju-ui-$UI_VERSION
  if [ ! -x "$CAJU_UI" ]; then
    mkdir -p .ui
    (cd "$UI_SRC" && "$CAJU" build -o "$CAJU_UI" cmd/caju-ui.caju)
  fi
fi
"$CAJU_UI" gen
"$CAJU" run shop_css.caju
"$CAJU_UI" build --ssr server.cajux
