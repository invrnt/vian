#!/usr/bin/env bash
set -euo pipefail
./dist/vian --help > /dev/null
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
result=$(XDG_DATA_HOME="$fixture/data" ./dist/vian list --json)
test "$result" = '{"ok":true,"data":[]}'
cat > "$fixture/local.ts" <<'TS'
export const value = 'local-import-ok';
TS
cat > "$fixture/vian.tools.ts" <<'TS'
import { value } from './local.ts';
export const tools = { hello: { description: 'fixture', inputSchema: { type: 'object' }, execute: () => value } };
TS
bun build scripts/probe-tool-import.ts --compile --outfile "$fixture/probe-tool-import" > /dev/null
result=$("$fixture/probe-tool-import" "$fixture/vian.tools.ts")
test "$result" = 'local-import-ok'
