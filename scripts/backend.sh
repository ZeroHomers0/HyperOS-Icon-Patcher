#!/system/bin/sh

MODDIR=${0%/*}
MODDIR=${MODDIR%/*}
# 测试环境可通过 HIP_DATA_DIR / HIP_CACHE_ROOT / HIP_BUSYBOX 注入隔离目录；
# Android 正式运行时不设置这些变量，仍使用固定模块路径。
DATA=${HIP_DATA_DIR:-/data/adb/hyper_icon_patcher_data}
TRANSFER="$DATA/transfer"
CUSTOM_STAGE="$DATA/custom-icons-stage"
PATCH_GROUPS="$DATA/patch-groups"
THEME_LABEL_CACHE="$DATA/theme-label-cache"
BB=${HIP_BUSYBOX:-/data/adb/ksu/bin/busybox}
MAX_GROUPS=50
MAX_ICONS_PER_GROUP=500
MAX_GROUP_NAME_BYTES=120
MAX_PACKAGE_BYTES=255
MAX_ICON_BYTES=51200
MAX_UPLOAD_BASE64_BYTES=70000
MAX_DATA_KB=262144
FREE_SPACE_RESERVE_KB=8192

[ -x "$BB" ] || BB=busybox

mkdir -p "$TRANSFER" "$CUSTOM_STAGE" "$PATCH_GROUPS" "$THEME_LABEL_CACHE" || {
  echo "ERROR:无法初始化模块数据目录"
  exit 3
}

# ---------- 输入边界与路径约束 ----------

valid_group_id() {
  GROUP_ID_BYTES=$(printf '%s' "$1" | "$BB" wc -c | "$BB" tr -d ' ')
  [ -n "$GROUP_ID_BYTES" ] && [ "$GROUP_ID_BYTES" -le 64 ] || return 1
  case "$1" in
    ''|*[!a-zA-Z0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

valid_group_name() {
  [ -n "$1" ] || return 1
  NAME_BYTES=$(printf '%s' "$1" | "$BB" wc -c | "$BB" tr -d ' ')
  [ -n "$NAME_BYTES" ] && [ "$NAME_BYTES" -le "$MAX_GROUP_NAME_BYTES" ] || return 1
  printf '%s' "$1" | "$BB" grep -q '[[:cntrl:]]' && return 1
  case "$1" in
    ' '*|*' ') return 1 ;;
    *) return 0 ;;
  esac
}

group_name_exists() {
  WANTED_NAME=$1
  EXCLUDED_ID=$2
  MATCHED_NAME_FILE=$("$BB" grep -Fxl -- "$WANTED_NAME" "$PATCH_GROUPS"/*/name.txt 2>/dev/null | "$BB" head -n 1)
  [ -n "$MATCHED_NAME_FILE" ] || return 1
  MATCHED_GROUP_DIR=${MATCHED_NAME_FILE%/name.txt}
  MATCHED_GROUP_ID=${MATCHED_GROUP_DIR##*/}
  [ -n "$EXCLUDED_ID" ] && [ "$MATCHED_GROUP_ID" = "$EXCLUDED_ID" ] && return 1
  return 0
}

group_dir() {
  valid_group_id "$1" || return 1
  printf '%s/%s' "$PATCH_GROUPS" "$1"
}

group_icons_dir() {
  GROUP_DIR=$(group_dir "$1") || return 1
  [ -d "$GROUP_DIR/icons" ] || return 1
  printf '%s/icons' "$GROUP_DIR"
}

find_cache_root() {
  if [ -n "$HIP_CACHE_ROOT" ] && [ -d "$HIP_CACHE_ROOT" ]; then
    printf '%s' "$HIP_CACHE_ROOT"
    return 0
  fi
  for ROOT in \
    /storage/emulated/0/Android/data/com.android.thememanager/files/MIUI/theme/.data/content/icons \
    /sdcard/Android/data/com.android.thememanager/files/MIUI/theme/.data/content/icons
  do
    [ -d "$ROOT" ] && {
      printf '%s' "$ROOT"
      return 0
    }
  done
  return 1
}

valid_package() {
  PACKAGE_BYTES=$(printf '%s' "$1" | "$BB" wc -c | "$BB" tr -d ' ')
  [ -n "$PACKAGE_BYTES" ] && [ "$PACKAGE_BYTES" -le "$MAX_PACKAGE_BYTES" ] || return 1
  case "$1" in
    ''|[.-]*|*[!a-zA-Z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

directory_kb() {
  [ -d "$1" ] || {
    echo 0
    return
  }
  "$BB" du -sk "$1" 2>/dev/null | "$BB" awk 'NR == 1 {print $1 + 0}'
}

ensure_free_bytes() {
  SPACE_PATH=$1
  REQUIRED_BYTES=$2
  SPACE_LABEL=$3
  FREE_KB=$("$BB" df -Pk "$SPACE_PATH" 2>/dev/null | "$BB" awk 'END {print $4 + 0}')
  REQUIRED_KB=$(((REQUIRED_BYTES + 1023) / 1024 + FREE_SPACE_RESERVE_KB))
  [ -n "$FREE_KB" ] && [ "$FREE_KB" -ge "$REQUIRED_KB" ] || {
    echo "ERROR:${SPACE_LABEL}空间不足，至少还需要 $((REQUIRED_KB / 1024 + 1))MB 可用空间"
    return 1
  }
}

ensure_data_budget() {
  ADDITIONAL_KB=${1:-0}
  USED_KB=$(directory_kb "$DATA")
  PROJECTED_KB=$((USED_KB + ADDITIONAL_KB))
  [ "$PROJECTED_KB" -le "$MAX_DATA_KB" ] || {
    echo "ERROR:模块持久数据将超过 256MB 上限，请删除不再使用的修补组或图标"
    return 1
  }
}

lock_pid_is_active() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  "$BB" grep -aq 'backend.sh' "/proc/$1/cmdline" 2>/dev/null
}

acquire_operation_lock() {
  OPERATION_LOCK="$DATA/operation.lock"
  if ! mkdir "$OPERATION_LOCK" 2>/dev/null; then
    LOCK_PID=$("$BB" cat "$OPERATION_LOCK/pid" 2>/dev/null)
    if ! lock_pid_is_active "$LOCK_PID"; then
      rm -rf "$OPERATION_LOCK"
      mkdir "$OPERATION_LOCK" 2>/dev/null || {
        echo "ERROR:另一个修补操作正在执行，请稍候"
        return 1
      }
    else
      echo "ERROR:另一个修补操作正在执行，请等待完成"
      return 1
    fi
  fi
  printf '%s\n' "$$" > "$OPERATION_LOCK/pid"
  trap 'rm -rf "$OPERATION_LOCK"' EXIT HUP INT TERM
}

# ---------- 主题发现与手机端索引 ----------

valid_zip() {
  ZIP_FILE=$1
  [ -s "$ZIP_FILE" ] || return 1
  ZIP_SIZE=$("$BB" stat -c '%s' "$ZIP_FILE" 2>/dev/null)
  [ -n "$ZIP_SIZE" ] && [ "$ZIP_SIZE" -le 83886080 ] || return 1
  ZIP_MAGIC=$("$BB" od -An -tx1 -N4 "$ZIP_FILE" 2>/dev/null | "$BB" tr -d ' \n')
  case "$ZIP_MAGIC" in
    504b0304|504b0506|504b0708) ;;
    *) return 1 ;;
  esac
  "$BB" unzip -l "$ZIP_FILE" >/dev/null 2>&1
}

list_apps() {
  pm list packages -3 2>/dev/null |
    "$BB" sed 's/^package://' |
    "$BB" sort -u
}

scan_cache() {
  ROOT=$(find_cache_root) || {
    echo "ERROR:未找到主题商店 icons 缓存目录"
    exit 2
  }
  META_ROOT=${ROOT%/content/icons}/meta
  find "$ROOT" -maxdepth 1 -type f -name '*.mrc' 2>/dev/null |
    while IFS= read -r FILE; do
      SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
      MTIME=$("$BB" stat -c '%Y' "$FILE" 2>/dev/null)
      BASE=${FILE##*/}
      case "$BASE" in
        ''|*[!a-zA-Z0-9._-]*|*.mrc.mrc) continue ;;
      esac
      ID=${BASE%.mrc}
      LABEL_CACHE_FILE="$THEME_LABEL_CACHE/$BASE.meta"
      LABEL_CACHE_KEY="${SIZE:-0}:${MTIME:-0}"
      if [ -f "$LABEL_CACHE_FILE" ]; then
        CACHED_KEY=$("$BB" sed -n '1p' "$LABEL_CACHE_FILE" 2>/dev/null)
        if [ "$CACHED_KEY" = "$LABEL_CACHE_KEY" ]; then
          LABEL64=$("$BB" sed -n '2p' "$LABEL_CACHE_FILE" 2>/dev/null)
          printf '%s\t%s\t%s\t%s\n' "$BASE" "${SIZE:-0}" "${MTIME:-0}" "$LABEL64"
          continue
        fi
      fi
      LABEL=
      if [ -d "$META_ROOT" ]; then
        META_FILE=
        for CANDIDATE in \
          "$META_ROOT/icons/$ID.mrm" \
          "$META_ROOT/icons/$ID.xml" \
          "$META_ROOT/$ID.mrm" \
          "$META_ROOT/$ID.xml"
        do
          [ -f "$CANDIDATE" ] && {
            META_FILE=$CANDIDATE
            break
          }
        done
        [ -n "$META_FILE" ] || META_FILE=$(find "$META_ROOT" -type f \( -name "$ID.mrm" -o -name "$ID.xml" -o -name "$ID" \) 2>/dev/null | "$BB" head -n 1)
        if [ -n "$META_FILE" ]; then
          LABEL=$("$BB" sed -n '/"titles"[[:space:]]*:/,/^[[:space:]]*}/p' "$META_FILE" 2>/dev/null |
            "$BB" grep -am1 '"zh_CN"[[:space:]]*:' |
            "$BB" sed 's/^[^:]*:[[:space:]]*"//; s/",*[[:space:]]*$//')
          [ -n "$LABEL" ] || LABEL=$("$BB" sed -n '/"titles"[[:space:]]*:/,/^[[:space:]]*}/p' "$META_FILE" 2>/dev/null |
            "$BB" grep -am1 '"fallback"[[:space:]]*:' |
            "$BB" sed 's/^[^:]*:[[:space:]]*"//; s/",*[[:space:]]*$//')
          [ -n "$LABEL" ] || LABEL=$("$BB" unzip -p "$META_FILE" '*description.xml' 2>/dev/null |
            "$BB" grep -aom1 '<title[^>]*>[^<]*</title>\|<name[^>]*>[^<]*</name>' |
            "$BB" sed 's/<[^>]*>//g')
          [ -n "$LABEL" ] || LABEL=$("$BB" grep -aom1 '<title[^>]*>[^<]*</title>\|<name[^>]*>[^<]*</name>' "$META_FILE" 2>/dev/null |
            "$BB" sed 's/<[^>]*>//g')
        fi
      fi
      [ -n "$LABEL" ] || LABEL=$("$BB" unzip -p "$FILE" '*description.xml' 2>/dev/null |
        "$BB" grep -aom1 '<title[^>]*>[^<]*</title>\|<name[^>]*>[^<]*</name>' |
        "$BB" sed 's/<[^>]*>//g')
      LABEL=$(printf '%s' "$LABEL" | "$BB" head -c 256)
      LABEL64=$(printf '%s' "$LABEL" | "$BB" base64 | "$BB" tr -d '\n')
      LABEL_CACHE_NEXT="$LABEL_CACHE_FILE.next"
      printf '%s\n%s\n' "$LABEL_CACHE_KEY" "$LABEL64" > "$LABEL_CACHE_NEXT" &&
        mv -f "$LABEL_CACHE_NEXT" "$LABEL_CACHE_FILE"
      printf '%s\t%s\t%s\t%s\n' "$BASE" "${SIZE:-0}" "${MTIME:-0}" "$LABEL64"
    done |
    "$BB" sort -t '	' -k3,3nr
}

cache_path() {
  NAME=$1
  case "$NAME" in
    ''|*[!a-zA-Z0-9._-]*|*.mrc.mrc) return 1 ;;
  esac
  case "$NAME" in *.mrc) ;; *) return 1 ;; esac
  ROOT=$(find_cache_root) || return 1
  printf '%s/%s' "$ROOT" "$NAME"
}

inspect_cache() {
  FILE=$(cache_path "$1") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  ARCH=$("$BB" uname -m 2>/dev/null)
  case "$ARCH" in
    aarch64|arm64) HELPER="$MODDIR/bin/hipzip-arm64" ;;
    *) echo "ERROR:当前设备不是 Android ARM64，无法加载主题"; exit 3 ;;
  esac
  [ -x "$HELPER" ] || {
    echo "ERROR:手机端主题索引工具不可执行"
    exit 3
  }
  "$HELPER" -source "$FILE" -inspect || {
    echo "ERROR:手机端主题索引失败"
    exit 3
  }
}

fast_merge() {
  NAME=$1
  PREFIX=$2
  GROUP_ID=$3
  MERGE_MODE=$4
  FILE=$(cache_path "$NAME") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  ICON_DIR=$(group_icons_dir "$GROUP_ID") || {
    echo "ERROR:请选择有效的修补组"
    exit 2
  }
  case "$MERGE_MODE" in
    missing) MERGE_FLAG="-missing-only" ;;
    replace) MERGE_FLAG= ;;
    *) echo "ERROR:修补模式无效"; exit 2 ;;
  esac
  COUNT=$(find "$ICON_DIR" -maxdepth 1 -type f -name '*.png' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$COUNT" -gt 0 ] || {
    echo "ERROR:没有已保存的自定义图标配置"
    exit 2
  }
  [ "$COUNT" -le "$MAX_ICONS_PER_GROUP" ] || {
    echo "ERROR:修补组图标数量超过 $MAX_ICONS_PER_GROUP 个上限"
    exit 2
  }
  ARCH=$("$BB" uname -m 2>/dev/null)
  case "$ARCH" in
    aarch64|arm64) HELPER="$MODDIR/bin/hipzip-arm64" ;;
    *) echo "ERROR:当前设备架构不支持本地快速合并"; exit 3 ;;
  esac
  [ -x "$HELPER" ] || {
    echo "ERROR:本地合并工具不可执行"
    exit 3
  }
  SOURCE_SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
  ICON_KB=$(directory_kb "$ICON_DIR")
  [ -n "$SOURCE_SIZE" ] || {
    echo "ERROR:无法读取主题大小"
    exit 3
  }
  # 手机端输出位于 /data；预留源文件大小、图标增量及固定安全余量。
  ensure_free_bytes "$DATA" $((SOURCE_SIZE + ICON_KB * 1024 + 2097152)) "模块数据目录" || exit 3

  NEXT="$TRANSFER/active-next.bin"
  rm -f "$TRANSFER/active.bin" "$NEXT"
  OUTPUT=$("$HELPER" \
    -source "$FILE" \
    -output "$NEXT" \
    -icons "$ICON_DIR" \
    -prefix "$PREFIX" \
    $MERGE_FLAG 2>&1)
  STATUS=$?
  if [ "$STATUS" -ne 0 ]; then
    rm -f "$NEXT"
    echo "ERROR:本地合并失败：${OUTPUT:-未知错误}"
    exit 3
  fi
  case "$OUTPUT" in
    OK:*:0:*)
      rm -f "$NEXT" "$TRANSFER/active.bin"
      echo "$OUTPUT"
      return 0
      ;;
  esac
  valid_zip "$NEXT" || {
    rm -f "$NEXT"
    echo "ERROR:本地合并结果校验失败"
    exit 3
  }
  mv -f "$NEXT" "$TRANSFER/active.bin" || {
    rm -f "$NEXT"
    echo "ERROR:无法切换本地合并结果"
    exit 3
  }
  echo "${OUTPUT:-OK}"
}

# ---------- 单事务主题写入 ----------

patch_cache() {
  PC_NAME=$1
  TARGET_FILE=$(cache_path "$PC_NAME") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  PC_ROOT=$(find_cache_root) || {
    echo "ERROR:未找到主题商店 icons 缓存目录"
    exit 2
  }
  case "$TARGET_FILE" in
    "$PC_ROOT"/*.mrc) ;;
    *) echo "ERROR:拒绝写入主题商店目录之外的路径：$TARGET_FILE"; exit 3 ;;
  esac
  [ -f "$TARGET_FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  [ -s "$TRANSFER/active.bin" ] || {
    echo "ERROR:请先在上方生成修改结果"
    exit 2
  }
  valid_zip "$TRANSFER/active.bin" || {
    rm -f "$TRANSFER/active.bin"
    echo "ERROR:生成结果不是完整有效的图标组件"
    exit 2
  }
  ACTIVE_SIZE=$("$BB" stat -c '%s' "$TRANSFER/active.bin" 2>/dev/null)
  TARGET_SIZE=$("$BB" stat -c '%s' "$TARGET_FILE" 2>/dev/null)
  [ -n "$ACTIVE_SIZE" ] && [ -n "$TARGET_SIZE" ] || {
    rm -f "$TRANSFER/active.bin"
    echo "ERROR:无法读取修补文件大小"
    exit 3
  }
  # 写入期间 /data 保存一份回滚文件，主题分区保存一份 .hip-new。
  ensure_free_bytes "$DATA" "$TARGET_SIZE" "模块数据目录" || {
    rm -f "$TRANSFER/active.bin"
    exit 3
  }
  ensure_free_bytes "$PC_ROOT" "$ACTIVE_SIZE" "主题存储目录" || {
    rm -f "$TRANSFER/active.bin"
    exit 3
  }
  PC_BEFORE_HASH=$("$BB" sha256sum "$TARGET_FILE" 2>/dev/null | "$BB" awk '{print $1}')
  PC_BEFORE_MTIME=$("$BB" stat -c '%Y' "$TARGET_FILE" 2>/dev/null)

  PC_BACKUP="$TRANSFER/${PC_NAME}.rollback"
  rm -f "$PC_BACKUP"
  cp -p "$TARGET_FILE" "$PC_BACKUP" || {
    rm -f "$TRANSFER/active.bin"
    echo "ERROR:无法创建写入回滚文件"
    exit 3
  }

  PC_OWNER=$("$BB" stat -c '%u:%g' "$TARGET_FILE")
  PC_MODE=$("$BB" stat -c '%a' "$TARGET_FILE")
  PC_CONTEXT=$("$BB" ls -Zd "$TARGET_FILE" 2>/dev/null | "$BB" awk '{print $1}')
  rm -f "$TARGET_FILE.hip-new"
  cp "$TRANSFER/active.bin" "$TARGET_FILE.hip-new" || {
    rm -f "$PC_BACKUP" "$TARGET_FILE.hip-new" "$TRANSFER/active.bin"
    echo "ERROR:无法创建待写入文件"
    exit 3
  }
  chown "$PC_OWNER" "$TARGET_FILE.hip-new" 2>/dev/null
  chmod "$PC_MODE" "$TARGET_FILE.hip-new" 2>/dev/null
  [ -n "$PC_CONTEXT" ] && chcon "$PC_CONTEXT" "$TARGET_FILE.hip-new" 2>/dev/null
  mv -f "$TARGET_FILE.hip-new" "$TARGET_FILE" || {
    rm -f "$TARGET_FILE.hip-new"
    if cp -p "$PC_BACKUP" "$TARGET_FILE"; then
      rm -f "$PC_BACKUP" "$TRANSFER/active.bin"
      echo "ERROR:写入失败，已自动回滚"
    else
      echo "ERROR:写入失败且自动回滚失败，请勿应用该主题并重新下载"
    fi
    exit 3
  }
  PC_SOURCE_HASH=$("$BB" sha256sum "$TRANSFER/active.bin" | "$BB" awk '{print $1}')
  PC_WRITTEN_HASH=$("$BB" sha256sum "$TARGET_FILE" | "$BB" awk '{print $1}')
  if [ -z "$PC_SOURCE_HASH" ] || [ "$PC_SOURCE_HASH" != "$PC_WRITTEN_HASH" ]; then
    if cp -p "$PC_BACKUP" "$TARGET_FILE"; then
      rm -f "$PC_BACKUP" "$TRANSFER/active.bin"
      echo "ERROR:写入后校验失败，已自动回滚"
    else
      echo "ERROR:写入后校验失败且自动回滚失败，请勿应用该主题并重新下载"
    fi
    exit 3
  fi

  rm -f "$PC_BACKUP"
  rm -f "$TRANSFER/active.bin" "$TRANSFER/active.b64" "$TRANSFER/source.b64"
  sync
  PC_WRITTEN_MTIME=$("$BB" stat -c '%Y' "$TARGET_FILE" 2>/dev/null)
  echo "OK:target=$TARGET_FILE|before=$PC_BEFORE_HASH@$PC_BEFORE_MTIME|after=$PC_WRITTEN_HASH@$PC_WRITTEN_MTIME"
}

fast_patch() {
  acquire_operation_lock || exit 2
  # 命令替换子 Shell 不得继承父事务的清锁 trap，否则会在生成后提前释放互斥锁。
  MERGE_OUTPUT=$(trap - EXIT HUP INT TERM; fast_merge "$1" "$2" "$3" "$4")
  MERGE_STATUS=$?
  if [ "$MERGE_STATUS" -ne 0 ]; then
    printf '%s\n' "$MERGE_OUTPUT"
    exit "$MERGE_STATUS"
  fi
  printf '%s\n' "$MERGE_OUTPUT"
  case "$MERGE_OUTPUT" in
    OK:*:0:*) return 0 ;;
  esac
  PATCH_OUTPUT=$(trap - EXIT HUP INT TERM; patch_cache "$1")
  PATCH_STATUS=$?
  printf '%s\n' "$PATCH_OUTPUT"
  [ "$PATCH_STATUS" -eq 0 ] || exit "$PATCH_STATUS"
}

open_theme_manager() {
  COMPONENT=$(/system/bin/cmd package resolve-activity --brief \
    -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER \
    com.android.thememanager 2>/dev/null | "$BB" tail -n 1)
  if [ -n "$COMPONENT" ] && [ "$COMPONENT" != "No activity found" ]; then
    /system/bin/am start --user 0 -n "$COMPONENT" >/dev/null 2>&1 && {
      echo "OK:$COMPONENT"
      return 0
    }
  fi
  for COMPONENT in \
    com.android.thememanager/com.android.thememanager.ThemeResourceTabActivity \
    com.android.thememanager/com.android.thememanager.ThemeResourceProxyTabActivity
  do
    /system/bin/am start --user 0 -n "$COMPONENT" >/dev/null 2>&1 && {
      echo "OK:$COMPONENT"
      return 0
    }
  done
  /system/bin/am start --user 0 \
    -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER \
    -p com.android.thememanager >/dev/null 2>&1 && {
      echo "OK:package"
      return 0
    }
  /system/bin/monkey --user 0 -p com.android.thememanager -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 && {
    echo "OK:monkey"
    return 0
  }
  "$BB" su 2000 -c '/system/bin/monkey --user 0 -p com.android.thememanager -c android.intent.category.LAUNCHER 1' >/dev/null 2>&1 && {
    echo "OK:shell-monkey"
    return 0
  }
  echo "ERROR:系统拒绝启动主题商店，请手动打开"
  exit 3
}

# ---------- 修补组持久数据 ----------

group_create() {
  valid_group_name "$1" || {
    echo "ERROR:修补组名称不能为空、最多 120 字节（约 40 个中文），且首尾不能是空格"
    exit 2
  }
  group_name_exists "$1" "" && {
    echo "ERROR:已存在同名修补组"
    exit 2
  }
  GROUP_COUNT=$(find "$PATCH_GROUPS" -mindepth 1 -maxdepth 1 -type d -name '*' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$GROUP_COUNT" -lt "$MAX_GROUPS" ] || {
    echo "ERROR:修补组最多创建 $MAX_GROUPS 个，请先删除不再使用的修补组"
    exit 2
  }
  ensure_data_budget 1 || exit 3
  GROUP_ID=$("$BB" cat /proc/sys/kernel/random/uuid 2>/dev/null)
  [ -n "$GROUP_ID" ] || GROUP_ID="$(date +%s)-$$"
  valid_group_id "$GROUP_ID" || {
    echo "ERROR:无法生成修补组标识"
    exit 3
  }
  GROUP_DIR="$PATCH_GROUPS/$GROUP_ID"
  mkdir -p "$GROUP_DIR/icons" || {
    echo "ERROR:无法创建修补组"
    exit 3
  }
  printf '%s' "$1" > "$GROUP_DIR/name.txt" || {
    rm -rf "$GROUP_DIR"
    echo "ERROR:无法保存修补组名称"
    exit 3
  }
  echo "OK:$GROUP_ID"
}

group_list() {
  find "$PATCH_GROUPS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null |
    while IFS= read -r GROUP_DIR; do
      GROUP_ID=${GROUP_DIR##*/}
      valid_group_id "$GROUP_ID" || continue
      [ -f "$GROUP_DIR/name.txt" ] || continue
      NAME64=$("$BB" base64 "$GROUP_DIR/name.txt" | "$BB" tr -d '\n')
      COUNT=$(find "$GROUP_DIR/icons" -maxdepth 1 -type f -name '*.png' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
      MTIME=$("$BB" stat -c '%Y' "$GROUP_DIR" 2>/dev/null)
      printf '%s\t%s\t%s\t%s\n' "$GROUP_ID" "$NAME64" "${COUNT:-0}" "${MTIME:-0}"
    done |
    "$BB" sort -t '	' -k4,4nr
}

group_rename() {
  GROUP_DIR=$(group_dir "$1") || {
    echo "ERROR:修补组标识无效"
    exit 2
  }
  [ -d "$GROUP_DIR/icons" ] || {
    echo "ERROR:修补组不存在"
    exit 2
  }
  valid_group_name "$2" || {
    echo "ERROR:修补组名称不能为空、最多 120 字节（约 40 个中文），且首尾不能是空格"
    exit 2
  }
  group_name_exists "$2" "$1" && {
    echo "ERROR:已存在同名修补组"
    exit 2
  }
  NAME_NEXT="$GROUP_DIR/name.txt.next"
  rm -f "$NAME_NEXT"
  printf '%s' "$2" > "$NAME_NEXT" && mv -f "$NAME_NEXT" "$GROUP_DIR/name.txt" || {
    rm -f "$NAME_NEXT"
    echo "ERROR:无法重命名修补组"
    exit 3
  }
  touch "$GROUP_DIR"
  echo "OK"
}

group_clone() {
  SOURCE=$(group_dir "$1") || {
    echo "ERROR:修补组标识无效"
    exit 2
  }
  [ -d "$SOURCE/icons" ] || {
    echo "ERROR:修补组不存在"
    exit 2
  }
  valid_group_name "$2" || {
    echo "ERROR:新修补组名称无效或过长"
    exit 2
  }
  SOURCE_KB=$(directory_kb "$SOURCE/icons")
  ensure_data_budget "$SOURCE_KB" || exit 3
  ensure_free_bytes "$DATA" $((SOURCE_KB * 1024 + 1048576)) "模块数据目录" || exit 3
  RESULT=$(group_create "$2") || exit $?
  GROUP_ID=${RESULT#OK:}
  TARGET="$PATCH_GROUPS/$GROUP_ID/icons"
  find "$SOURCE/icons" -maxdepth 1 -type f -name '*.png' -exec cp -p '{}' "$TARGET/" ';' || {
    rm -rf "$PATCH_GROUPS/$GROUP_ID"
    echo "ERROR:复制修补组图标失败"
    exit 3
  }
  echo "OK:$GROUP_ID"
}

group_delete() {
  GROUP_DIR=$(group_dir "$1") || {
    echo "ERROR:修补组标识无效"
    exit 2
  }
  [ -d "$GROUP_DIR/icons" ] || {
    echo "ERROR:修补组不存在"
    exit 2
  }
  rm -rf "$GROUP_DIR" || {
    echo "ERROR:无法删除修补组"
    exit 3
  }
  echo "OK"
}

recipe_begin() {
  find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' -delete 2>/dev/null
  find "$TRANSFER" -maxdepth 1 -type f -name 'recipe-*.b64' -delete 2>/dev/null
  echo "OK"
}

recipe_upload_begin() {
  valid_package "$1" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  STAGED_COUNT=$(find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
  [ -f "$CUSTOM_STAGE/$1.png" ] || [ "$STAGED_COUNT" -lt "$MAX_ICONS_PER_GROUP" ] || {
    echo "ERROR:单次最多处理 $MAX_ICONS_PER_GROUP 个图标"
    exit 2
  }
  ensure_free_bytes "$DATA" 1048576 "模块数据目录" || exit 3
  ensure_data_budget 1 || exit 3
  : > "$TRANSFER/recipe-$1.b64" || {
    echo "ERROR:无法创建图标上传暂存"
    exit 3
  }
}

recipe_upload_chunk() {
  valid_package "$1" || exit 2
  CHUNK=$2
  case "$CHUNK" in
    ''|*[!A-Za-z0-9+/=]*) echo "ERROR:图标数据无效"; exit 2 ;;
  esac
  [ "${#CHUNK}" -le "$MAX_UPLOAD_BASE64_BYTES" ] || {
    rm -f "$TRANSFER/recipe-$1.b64"
    echo "ERROR:单个图标上传分块过大"
    exit 2
  }
  printf '%s' "$CHUNK" >> "$TRANSFER/recipe-$1.b64" || {
    rm -f "$TRANSFER/recipe-$1.b64"
    echo "ERROR:写入图标上传暂存失败"
    exit 3
  }
  UPLOAD_SIZE=$("$BB" stat -c '%s' "$TRANSFER/recipe-$1.b64" 2>/dev/null)
  [ -n "$UPLOAD_SIZE" ] && [ "$UPLOAD_SIZE" -le "$MAX_UPLOAD_BASE64_BYTES" ] || {
    rm -f "$TRANSFER/recipe-$1.b64"
    echo "ERROR:图标上传数据超过限制"
    exit 2
  }
}

recipe_upload_commit() {
  valid_package "$1" || exit 2
  UPLOAD_FILE="$TRANSFER/recipe-$1.b64"
  STAGE_NEXT="$CUSTOM_STAGE/$1.png.next"
  [ -s "$UPLOAD_FILE" ] || {
    echo "ERROR:图标上传数据为空"
    exit 2
  }
  rm -f "$STAGE_NEXT"
  "$BB" base64 -d "$UPLOAD_FILE" > "$STAGE_NEXT" || {
    rm -f "$UPLOAD_FILE" "$STAGE_NEXT"
    echo "ERROR:图标解码失败"
    exit 2
  }
  SIZE=$("$BB" stat -c '%s' "$STAGE_NEXT")
  [ -n "$SIZE" ] && [ "$SIZE" -gt 0 ] && [ "$SIZE" -le "$MAX_ICON_BYTES" ] || {
    rm -f "$UPLOAD_FILE" "$STAGE_NEXT"
    echo "ERROR:图标超过 50KB"
    exit 2
  }
  MAGIC=$("$BB" od -An -tx1 -N8 "$STAGE_NEXT" 2>/dev/null | "$BB" tr -d ' \n')
  [ "$MAGIC" = "89504e470d0a1a0a" ] || {
    rm -f "$UPLOAD_FILE" "$STAGE_NEXT"
    echo "ERROR:上传内容不是有效的 PNG 图片"
    exit 2
  }
  mv -f "$STAGE_NEXT" "$CUSTOM_STAGE/$1.png" || {
    rm -f "$UPLOAD_FILE" "$STAGE_NEXT"
    echo "ERROR:无法保存上传图标"
    exit 3
  }
  rm -f "$UPLOAD_FILE"
  echo "$SIZE"
}

recipe_finish() {
  GROUP_DIR=$(group_dir "$1") || {
    echo "ERROR:请选择有效的修补组"
    exit 2
  }
  [ -d "$GROUP_DIR" ] || {
    echo "ERROR:修补组不存在"
    exit 2
  }
  ICON_DIR="$GROUP_DIR/icons"
  NEXT="$ICON_DIR-next"
  PREVIOUS="$ICON_DIR-previous"
  # 如果上次原子切换在两个 rename 之间中断，优先恢复最后一份完整目录。
  if [ ! -d "$ICON_DIR" ] && [ -d "$PREVIOUS" ]; then
    mv "$PREVIOUS" "$ICON_DIR" || {
      echo "ERROR:检测到上次保存中断，但原配置恢复失败"
      exit 3
    }
  fi
  STAGED_COUNT=$(find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$STAGED_COUNT" -gt 0 ] || {
    echo "ERROR:没有待保存的 PNG 图标"
    exit 2
  }
  CURRENT_COUNT=$(find "$GROUP_DIR/icons" -maxdepth 1 -type f -name '*.png' 2>/dev/null | "$BB" wc -l | "$BB" tr -d ' ')
  NEW_COUNT=$(find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' 2>/dev/null |
    while IFS= read -r STAGED_FILE; do
      STAGED_BASE=${STAGED_FILE##*/}
      [ -f "$GROUP_DIR/icons/$STAGED_BASE" ] || echo "$STAGED_BASE"
    done | "$BB" wc -l | "$BB" tr -d ' ')
  [ $((CURRENT_COUNT + NEW_COUNT)) -le "$MAX_ICONS_PER_GROUP" ] || {
    echo "ERROR:每个修补组最多保存 $MAX_ICONS_PER_GROUP 个图标"
    exit 2
  }
  STAGED_KB=$(directory_kb "$CUSTOM_STAGE")
  ensure_data_budget 0 || exit 3
  ensure_free_bytes "$DATA" $((STAGED_KB * 1024 + 1048576)) "模块数据目录" || exit 3
  mkdir -p "$ICON_DIR" || {
    echo "ERROR:无法创建当前主题的图标配置目录"
    exit 3
  }
  rm -rf "$NEXT"
  [ -d "$ICON_DIR" ] && rm -rf "$PREVIOUS"
  mkdir -p "$NEXT" || {
    echo "ERROR:无法创建图标配置临时目录"
    exit 3
  }
  if [ -d "$ICON_DIR" ]; then
    # 同一文件系统内用硬链接复用未变化图标；覆盖项会先 unlink，绝不会修改旧 inode。
    find "$ICON_DIR" -maxdepth 1 -type f -name '*.png' -exec "$BB" ln '{}' "$NEXT/" ';' || {
      rm -rf "$NEXT"
      echo "ERROR:无法复用已有图标配置，原配置未变更"
      exit 3
    }
  fi
  for STAGED_FILE in "$CUSTOM_STAGE"/*.png; do
    [ -f "$STAGED_FILE" ] || continue
    STAGED_BASE=${STAGED_FILE##*/}
    rm -f "$NEXT/$STAGED_BASE"
    cp -p "$STAGED_FILE" "$NEXT/$STAGED_BASE" || {
      rm -rf "$NEXT"
      echo "ERROR:保存图标配置失败，原配置未变更"
      exit 3
    }
  done
  COUNT=$(find "$NEXT" -maxdepth 1 -type f -name '*.png' | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$COUNT" -gt 0 ] || {
    rm -rf "$NEXT"
    echo "ERROR:没有可保存的图标配置"
    exit 2
  }
  mv "$ICON_DIR" "$PREVIOUS" || {
    rm -rf "$NEXT"
    echo "ERROR:无法切换图标配置"
    exit 3
  }
  mv "$NEXT" "$ICON_DIR" || {
    mv "$PREVIOUS" "$ICON_DIR"
    echo "ERROR:保存图标配置失败，已恢复原配置"
    exit 3
  }
  rm -rf "$PREVIOUS"
  # 每个修补组以应用包名作为唯一键，重复添加直接覆盖。
  find "$TRANSFER" -maxdepth 1 -type f -name 'recipe-*.b64' -delete 2>/dev/null
  touch "$GROUP_DIR"
  echo "OK:$COUNT"
}

recipe_list() {
  ICON_DIR=$(group_icons_dir "$1") || exit 0
  find "$ICON_DIR" -maxdepth 1 -type f -name '*.png' 2>/dev/null |
    "$BB" sed 's#.*/##; s/\.png$//' |
    "$BB" sort
}

recipe_list_detail() {
  ICON_DIR=$(group_icons_dir "$1") || exit 0
  find "$ICON_DIR" -maxdepth 1 -type f -name '*.png' 2>/dev/null |
    while IFS= read -r FILE; do
      BASE=${FILE##*/}
      PACKAGE=${BASE%.png}
      SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
      MTIME=$("$BB" stat -c '%Y' "$FILE" 2>/dev/null)
      printf '%s\t%s\t%s\n' "$PACKAGE" "${SIZE:-0}" "${MTIME:-0}"
    done |
    "$BB" sort
}

recipe_delete_batch() {
  GROUP_DIR=$(group_dir "$1") || {
    echo "ERROR:修补组标识无效"
    exit 2
  }
  [ -d "$GROUP_DIR" ] || {
    echo "ERROR:修补组不存在"
    exit 2
  }
  ICON_DIR="$GROUP_DIR/icons"
  PREVIOUS="$GROUP_DIR/icons-previous"
  if [ ! -d "$ICON_DIR" ] && [ -d "$PREVIOUS" ]; then
    mv "$PREVIOUS" "$ICON_DIR" || {
      echo "ERROR:检测到上次删除中断，但原配置恢复失败"
      exit 3
    }
  fi
  [ -d "$ICON_DIR" ] || {
    echo "ERROR:修补组图标目录不存在"
    exit 2
  }
  case "$2" in
    ''|,*|*,|*,,*|*[!a-zA-Z0-9._,-]*)
      echo "ERROR:批量删除列表无效"
      exit 2
      ;;
  esac
  [ -n "$2" ] || {
    echo "ERROR:没有选择要删除的图标"
    exit 2
  }
  DELETE_COUNT=0
  OLD_IFS=$IFS
  IFS=,
  for PACKAGE in $2; do
    valid_package "$PACKAGE" || {
      IFS=$OLD_IFS
      echo "ERROR:批量删除包含无效应用包名"
      exit 2
    }
    [ -f "$ICON_DIR/$PACKAGE.png" ] || {
      IFS=$OLD_IFS
      echo "ERROR:未找到自定义图标：$PACKAGE"
      exit 2
    }
    DELETE_COUNT=$((DELETE_COUNT + 1))
  done
  IFS=$OLD_IFS
  [ "$DELETE_COUNT" -gt 0 ] || {
    echo "ERROR:没有选择要删除的图标"
    exit 2
  }
  ensure_free_bytes "$DATA" 1048576 "模块数据目录" || exit 3

  NEXT="$GROUP_DIR/icons-next"
  rm -rf "$NEXT"
  mkdir -p "$NEXT" || {
    echo "ERROR:无法创建批量删除临时目录"
    exit 3
  }
  # 删除只改变目录项，硬链接可避免为原子切换复制整组 PNG 数据。
  find "$ICON_DIR" -maxdepth 1 -type f -name '*.png' -exec "$BB" ln '{}' "$NEXT/" ';' || {
    rm -rf "$NEXT"
    echo "ERROR:无法准备批量删除结果，原配置未变更"
    exit 3
  }
  IFS=,
  for PACKAGE in $2; do
    rm -f "$NEXT/$PACKAGE.png" || {
      IFS=$OLD_IFS
      rm -rf "$NEXT"
      echo "ERROR:批量删除失败，原配置未变更"
      exit 3
    }
  done
  IFS=$OLD_IFS
  rm -rf "$PREVIOUS"
  mv "$ICON_DIR" "$PREVIOUS" || {
    rm -rf "$NEXT"
    echo "ERROR:无法切换批量删除结果"
    exit 3
  }
  mv "$NEXT" "$ICON_DIR" || {
    mv "$PREVIOUS" "$ICON_DIR"
    echo "ERROR:批量删除失败，已恢复原配置"
    exit 3
  }
  rm -rf "$PREVIOUS"
  touch "$GROUP_DIR"
  echo "OK:$DELETE_COUNT"
}

recipe_preview() {
  ICON_DIR=$(group_icons_dir "$1") || {
    echo "ERROR:请选择有效的修补组"
    exit 2
  }
  valid_package "$2" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  FILE="$ICON_DIR/$2.png"
  [ -f "$FILE" ] || {
    echo "ERROR:未找到保存的自定义图标"
    exit 2
  }
  PREVIEW_SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
  PREVIEW_MAGIC=$("$BB" od -An -tx1 -N8 "$FILE" 2>/dev/null | "$BB" tr -d ' \n')
  [ -n "$PREVIEW_SIZE" ] && [ "$PREVIEW_SIZE" -gt 0 ] && [ "$PREVIEW_SIZE" -le "$MAX_ICON_BYTES" ] &&
    [ "$PREVIEW_MAGIC" = "89504e470d0a1a0a" ] || {
      echo "ERROR:保存的图标无效或超过 50KB"
      exit 2
    }
  "$BB" base64 "$FILE" | "$BB" tr -d '\n'
}

# ---------- 启动恢复、暂存清理与系统操作 ----------

clear_transfer() {
  rm -f "$TRANSFER/source.b64" "$TRANSFER/active.b64" "$TRANSFER/active.bin" "$TRANSFER/active-next.bin"
  find "$TRANSFER" -maxdepth 1 -type f -name 'recipe-*.b64' -delete 2>/dev/null
  echo "OK"
}

clear_recipe_stage() {
  find "$CUSTOM_STAGE" -maxdepth 1 -type f \( -name '*.png' -o -name '*.png.next' \) -delete 2>/dev/null
  find "$TRANSFER" -maxdepth 1 -type f -name 'recipe-*.b64' -delete 2>/dev/null
  echo "OK"
}

maintenance() {
  CLEANED=0
  RECOVERED=0

  if [ -d "$DATA/operation.lock" ]; then
    MAINTENANCE_LOCK_PID=$("$BB" cat "$DATA/operation.lock/pid" 2>/dev/null)
    if ! lock_pid_is_active "$MAINTENANCE_LOCK_PID"; then
      rm -rf "$DATA/operation.lock"
      CLEANED=$((CLEANED + 1))
    else
      DATA_KB=$(directory_kb "$DATA")
      echo "OK:cleaned=0|recovered=0|data_kb=${DATA_KB:-0}|busy=1"
      return 0
    fi
  fi

  # WebUI 启动时没有写操作在途，可安全清理上次异常退出留下的传输暂存。
  for TEMP_FILE in "$TRANSFER"/active.bin "$TRANSFER"/active-next.bin "$TRANSFER"/active.b64 "$TRANSFER"/source.b64 "$TRANSFER"/recipe-*.b64; do
    [ -e "$TEMP_FILE" ] || continue
    rm -f "$TEMP_FILE" && CLEANED=$((CLEANED + 1))
  done
  for TEMP_FILE in "$CUSTOM_STAGE"/*.png "$CUSTOM_STAGE"/*.png.next; do
    [ -e "$TEMP_FILE" ] || continue
    rm -f "$TEMP_FILE" && CLEANED=$((CLEANED + 1))
  done

  # 修补组目录使用 icons -> icons-previous -> icons-next 原子切换；按保守策略恢复旧完整版本。
  for GROUP_DIR in "$PATCH_GROUPS"/*; do
    [ -d "$GROUP_DIR" ] || continue
    if [ ! -f "$GROUP_DIR/name.txt" ] && [ -f "$GROUP_DIR/name.txt.next" ]; then
      mv "$GROUP_DIR/name.txt.next" "$GROUP_DIR/name.txt" && RECOVERED=$((RECOVERED + 1))
    else
      [ ! -e "$GROUP_DIR/name.txt.next" ] || {
        rm -f "$GROUP_DIR/name.txt.next"
        CLEANED=$((CLEANED + 1))
      }
    fi
    if [ ! -d "$GROUP_DIR/icons" ] && [ -d "$GROUP_DIR/icons-previous" ]; then
      mv "$GROUP_DIR/icons-previous" "$GROUP_DIR/icons" && RECOVERED=$((RECOVERED + 1))
    fi
    if [ -d "$GROUP_DIR/icons" ]; then
      [ ! -d "$GROUP_DIR/icons-next" ] || {
        rm -rf "$GROUP_DIR/icons-next"
        CLEANED=$((CLEANED + 1))
      }
      [ ! -d "$GROUP_DIR/icons-previous" ] || {
        rm -rf "$GROUP_DIR/icons-previous"
        CLEANED=$((CLEANED + 1))
      }
    fi
  done

  CACHE_ROOT=$(find_cache_root 2>/dev/null)
  if [ -n "$CACHE_ROOT" ]; then
    find "$CACHE_ROOT" -maxdepth 1 -type f \( -name '*.hip-new' -o -name '*.hip-restore' \) -delete 2>/dev/null
    for LABEL_META in "$THEME_LABEL_CACHE"/*.meta "$THEME_LABEL_CACHE"/*.meta.next; do
      [ -f "$LABEL_META" ] || continue
      LABEL_META_BASE=${LABEL_META##*/}
      case "$LABEL_META_BASE" in
        *.next)
          rm -f "$LABEL_META"
          CLEANED=$((CLEANED + 1))
          continue
          ;;
      esac
      LABEL_THEME_NAME=${LABEL_META_BASE%.next}
      LABEL_THEME_NAME=${LABEL_THEME_NAME%.meta}
      [ -f "$CACHE_ROOT/$LABEL_THEME_NAME" ] || {
        rm -f "$LABEL_META"
        CLEANED=$((CLEANED + 1))
      }
    done
    for ROLLBACK in "$TRANSFER"/*.rollback; do
      [ -f "$ROLLBACK" ] || continue
      ROLLBACK_BASE=${ROLLBACK##*/}
      ROLLBACK_NAME=${ROLLBACK_BASE%.rollback}
      TARGET=$(cache_path "$ROLLBACK_NAME" 2>/dev/null)
      if [ -n "$TARGET" ] && ! valid_zip "$TARGET" && valid_zip "$ROLLBACK"; then
        cp -p "$ROLLBACK" "$TARGET" && RECOVERED=$((RECOVERED + 1))
      fi
      rm -f "$ROLLBACK" && CLEANED=$((CLEANED + 1))
    done
  fi

  DATA_KB=$(directory_kb "$DATA")
  echo "OK:cleaned=$CLEANED|recovered=$RECOVERED|data_kb=${DATA_KB:-0}"
}

refresh_launcher() {
  am force-stop com.miui.home 2>/dev/null
  am force-stop com.mi.android.globallauncher 2>/dev/null
  echo "OK"
}

case "$1" in
  list_apps) list_apps ;;
  scan_cache) scan_cache ;;
  inspect_cache) inspect_cache "$2" ;;
  fast_patch) fast_patch "$2" "$3" "$4" "$5" ;;
  open_theme_manager) open_theme_manager ;;
  group_create) group_create "$2" ;;
  group_list) group_list ;;
  group_rename) group_rename "$2" "$3" ;;
  group_clone) group_clone "$2" "$3" ;;
  group_delete) group_delete "$2" ;;
  recipe_begin) recipe_begin ;;
  recipe_upload_begin) recipe_upload_begin "$2" ;;
  recipe_upload_chunk) recipe_upload_chunk "$2" "$3" ;;
  recipe_upload_commit) recipe_upload_commit "$2" ;;
  recipe_finish) recipe_finish "$2" ;;
  recipe_list) recipe_list "$2" ;;
  recipe_list_detail) recipe_list_detail "$2" ;;
  recipe_delete_batch) recipe_delete_batch "$2" "$3" ;;
  recipe_preview) recipe_preview "$2" "$3" ;;
  clear_transfer) clear_transfer ;;
  clear_recipe_stage) clear_recipe_stage ;;
  maintenance) maintenance ;;
  refresh) refresh_launcher ;;
  *) echo "ERROR:未知操作"; exit 2 ;;
esac
