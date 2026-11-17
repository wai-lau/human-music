# lockfiles:
# Node 22 for the investigator service (research/investigator): its store uses node:sqlite,
# which needs Node 22.13 or newer; the sandbox's /usr/bin/node is 18. The npm package
# "node" (pinned) installs the official Linux build from the npm registry.
set -euo pipefail
npm install --no-save --no-audit --no-fund --prefix "$MATES_RUNTIME/node22" node@22.13.1
"$MATES_RUNTIME/node22/node_modules/.bin/node" -e "import('node:sqlite').then(() => console.log('node', process.version, 'with node:sqlite'))"
echo "PATH=$MATES_RUNTIME/node22/node_modules/.bin" > "$MATES_RUNTIME/env"
