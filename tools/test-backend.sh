#!/bin/sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNTIME="$ROOT/.tools/backend-test-runtime"
case "$RUNTIME" in
  "$ROOT"/.tools/backend-test-runtime) ;;
  *) echo "unsafe test runtime path" >&2; exit 1 ;;
esac
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME/data" "$RUNTIME/cache"
trap 'case "$RUNTIME" in "$ROOT"/.tools/backend-test-runtime) rm -rf "$RUNTIME";; esac' EXIT HUP INT TERM

export HIP_DATA_DIR="$RUNTIME/data"
export HIP_CACHE_ROOT="$RUNTIME/cache"
export HIP_BUSYBOX="$ROOT/tools/test-busybox-shim.sh"
BACKEND="$ROOT/scripts/backend.sh"

run() {
  sh "$BACKEND" "$@"
}

expect_fail() {
  if "$@" >"$RUNTIME/unexpected.out" 2>&1; then
    echo "expected failure: $*" >&2
    exit 1
  fi
}

GROUP_ID=$(run group_create "日常图标" | sed 's/^OK://')
[ -n "$GROUP_ID" ]
expect_fail run group_create "日常图标"
LONG_NAME=$(awk 'BEGIN {for (i = 0; i < 121; i++) printf "a"}')
expect_fail run group_create "$LONG_NAME"
expect_fail run group_create " leading"
expect_fail run group_create "trailing "

# Theme scanning should cache labels by size+mtime and maintenance should remove stale entries.
# scan_cache only needs a file here; archive validity is covered by Go tests.
printf '<title>test theme</title>' > "$HIP_CACHE_ROOT/test-theme.mrc"
[ -n "$(run scan_cache)" ]
[ -f "$HIP_DATA_DIR/theme-label-cache/test-theme.mrc.meta" ]
[ -n "$(run scan_cache)" ]
rm -f "$HIP_CACHE_ROOT/test-theme.mrc"
run maintenance >/dev/null
[ ! -e "$HIP_DATA_DIR/theme-label-cache/test-theme.mrc.meta" ]

PNG64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwW7WQAAAABJRU5ErkJggg=='
run recipe_begin >/dev/null
run recipe_upload_begin com.example.one
run recipe_upload_chunk com.example.one "$PNG64"
run recipe_upload_commit com.example.one >/dev/null
run recipe_finish "$GROUP_ID" >/dev/null
[ "$(run recipe_list "$GROUP_ID")" = "com.example.one" ]
[ -n "$(run recipe_preview "$GROUP_ID" com.example.one)" ]

# Invalid batch input must fail before changing the group.
expect_fail run recipe_delete_batch "$GROUP_ID" 'com.example.one,,bad'
[ "$(run recipe_list "$GROUP_ID")" = "com.example.one" ]
run recipe_delete_batch "$GROUP_ID" com.example.one >/dev/null
[ -z "$(run recipe_list "$GROUP_ID")" ]

run group_rename "$GROUP_ID" "主力图标" >/dev/null
CLONE_ID=$(run group_clone "$GROUP_ID" "主力图标副本" | sed 's/^OK://')
[ -n "$CLONE_ID" ]
run group_delete "$CLONE_ID" >/dev/null

# Simulate interrupted atomic switches and abandoned transfer files.
mkdir -p "$HIP_DATA_DIR/patch-groups/$GROUP_ID/icons-next"
mv "$HIP_DATA_DIR/patch-groups/$GROUP_ID/icons" "$HIP_DATA_DIR/patch-groups/$GROUP_ID/icons-previous"
printf 'orphan' > "$HIP_DATA_DIR/transfer/active.bin"
MAINTENANCE=$(run maintenance)
case "$MAINTENANCE" in OK:cleaned=*recovered=*) ;; *) echo "unexpected maintenance result" >&2; exit 1 ;; esac
[ -d "$HIP_DATA_DIR/patch-groups/$GROUP_ID/icons" ]
[ ! -e "$HIP_DATA_DIR/patch-groups/$GROUP_ID/icons-next" ]
[ ! -e "$HIP_DATA_DIR/transfer/active.bin" ]

# The configured group-count cap must reject the 51st persistent group.
INDEX=1
while [ "$INDEX" -lt 50 ]; do
  mkdir -p "$HIP_DATA_DIR/patch-groups/boundary-$INDEX/icons"
  printf '边界组%s' "$INDEX" > "$HIP_DATA_DIR/patch-groups/boundary-$INDEX/name.txt"
  INDEX=$((INDEX + 1))
done
expect_fail run group_create "超限组"

echo "Backend functional and boundary tests passed"
