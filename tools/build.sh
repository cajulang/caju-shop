#!/bin/sh
# Builds the store: the CSS (caju style), the program (wasm) and the server.
#   tools/build.sh      CAJU=path/to/caju  CAJU_UI=path/to/caju-ui
set -e
cd "$(dirname "$0")/.."
CAJU=${CAJU:-caju}
CAJU_UI=${CAJU_UI:-../caju-ui/build/caju-ui}
"$CAJU_UI" gen
"$CAJU" run shop_css.caju
"$CAJU_UI" build --ssr server.cajux
