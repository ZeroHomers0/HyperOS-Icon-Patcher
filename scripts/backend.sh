#!/system/bin/sh

MODDIR=${0%/*}
MODDIR=${MODDIR%/*}
DATA=/data/adb/hyper_icon_patcher_data
TRANSFER="$DATA/transfer"
CACHE_BACKUPS="$DATA/cache-backups"
PATCHED_CACHE="$DATA/patched-cache"
CACHE_STATE="$DATA/cache-state"
BASE_CACHE="$DATA/base-cache"
CUSTOM_ICONS="$DATA/custom-icons"
CUSTOM_STAGE="$DATA/custom-icons-stage"
CUSTOM_TRASH="$DATA/custom-icons-trash"
BB=/data/adb/ksu/bin/busybox

[ -x "$BB" ] || BB=busybox

mkdir -p "$TRANSFER" "$CACHE_BACKUPS" "$PATCHED_CACHE" "$CACHE_STATE" "$BASE_CACHE" "$CUSTOM_ICONS" "$CUSTOM_STAGE" "$CUSTOM_TRASH" || {
  echo "ERROR:无法初始化模块数据目录"
  exit 3
}

find_cache_root() {
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

json_escape() {
  printf '%s' "$1" | "$BB" sed 's/\\/\\\\/g; s/"/\\"/g'
}

valid_package() {
  case "$1" in
    ''|*[!a-zA-Z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

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

prune_component_backups() {
  NAME=$1
  KEEP=5
  INDEX=0
  "$BB" ls -1t "$CACHE_BACKUPS/${NAME}-"*.bak 2>/dev/null |
    while IFS= read -r BACKUP; do
      INDEX=$((INDEX + 1))
      [ "$INDEX" -le "$KEEP" ] || rm -f "$BACKUP"
    done
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
      ID=${BASE%.mrc}
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
      LABEL64=$(printf '%s' "$LABEL" | "$BB" base64 | "$BB" tr -d '\n')
      STATUS=new
      if [ -s "$PATCHED_CACHE/$BASE" ] && [ -s "$CACHE_STATE/$BASE.sha256" ]; then
        EXPECTED=$("$BB" cat "$CACHE_STATE/$BASE.sha256")
        ACTUAL=$("$BB" sha256sum "$FILE" 2>/dev/null | "$BB" awk '{print $1}')
        [ "$EXPECTED" = "$ACTUAL" ] && STATUS=patched || STATUS=changed
      fi
      printf '%s\t%s\t%s\t%s\t%s\n' "$BASE" "${SIZE:-0}" "${MTIME:-0}" "$STATUS" "$LABEL64"
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

stream_cache() {
  FILE=$(cache_path "$1") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  "$BB" base64 "$FILE" | "$BB" tr -d '\n'
}

prepare_cache() {
  FILE=$(cache_path "$1") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  valid_zip "$FILE" || {
    echo "ERROR:主题商店组件损坏或超过 80MB"
    exit 2
  }
  ensure_clean_base "$1" "$FILE" || {
    echo "ERROR:无法保存组件基础副本"
    exit 3
  }
  "$BB" base64 "$FILE" | "$BB" tr -d '\n' > "$TRANSFER/source.b64"
  "$BB" wc -c < "$TRANSFER/source.b64" | "$BB" tr -d ' '
}

ensure_clean_base() {
  ECB_NAME=$1
  ECB_FILE=$2
  ECB_BASE="$BASE_CACHE/$ECB_NAME"
  ECB_CURRENT_HASH=$("$BB" sha256sum "$ECB_FILE" 2>/dev/null | "$BB" awk '{print $1}')
  ECB_WRITTEN_HASH=
  [ -s "$CACHE_STATE/$ECB_NAME.sha256" ] && ECB_WRITTEN_HASH=$("$BB" cat "$CACHE_STATE/$ECB_NAME.sha256")
  if [ -n "$ECB_WRITTEN_HASH" ] && [ "$ECB_CURRENT_HASH" = "$ECB_WRITTEN_HASH" ]; then
    valid_zip "$ECB_BASE" && return 0
    ECB_OLDEST=$("$BB" ls -1tr "$CACHE_BACKUPS/${ECB_NAME}-"*.bak 2>/dev/null | "$BB" head -n 1)
    [ -n "$ECB_OLDEST" ] && valid_zip "$ECB_OLDEST" && cp -p "$ECB_OLDEST" "$ECB_BASE" && return 0
    return 1
  fi
  # 当前文件不是本模块最后写入的版本，视为商店原版或更新后的新基础。
  cp -p "$ECB_FILE" "$ECB_BASE"
}

fast_build() {
  NAME=$1
  PREFIX=$2
  FILE=$(cache_path "$NAME") || {
    echo "FALLBACK:缓存文件名无效"
    return 0
  }
  case "$PREFIX" in
    ''|/*|*..*|*\\*) echo "FALLBACK:图标目录不安全"; return 0 ;;
  esac
  case "$PREFIX" in
    *res/drawable*/ ) ;;
    *) echo "FALLBACK:无法识别图标目录"; return 0 ;;
  esac
  [ -f "$FILE" ] || {
    echo "FALLBACK:缓存文件不存在"
    return 0
  }

  ARCH=$("$BB" uname -m 2>/dev/null)
  case "$ARCH" in
    aarch64|arm64) HELPER="$MODDIR/bin/hipzip-arm64" ;;
    *) echo "FALLBACK:当前设备架构暂不支持本地快速生成"; return 0 ;;
  esac
  [ -x "$HELPER" ] || {
    echo "FALLBACK:本地生成工具不可执行"
    return 0
  }

  NEXT="$TRANSFER/active-next.bin"
  rm -f "$NEXT"
  OUTPUT=$("$HELPER" \
    -source "$FILE" \
    -output "$NEXT" \
    -icons "$CUSTOM_STAGE" \
    -prefix "$PREFIX" 2>&1)
  STATUS=$?
  if [ "$STATUS" -ne 0 ]; then
    rm -f "$NEXT"
    echo "FALLBACK:本地生成失败：${OUTPUT:-未知错误}"
    return 0
  fi
  valid_zip "$NEXT" || {
    rm -f "$NEXT"
    echo "FALLBACK:本地生成结果校验失败"
    return 0
  }
  mv -f "$NEXT" "$TRANSFER/active.bin" || {
    rm -f "$NEXT"
    echo "FALLBACK:无法切换本地生成结果"
    return 0
  }
  echo "${OUTPUT:-OK}"
}

fast_merge() {
  NAME=$1
  FILE=$(cache_path "$NAME") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:缓存文件不存在"
    exit 2
  }
  COUNT=$(find "$CUSTOM_ICONS" -maxdepth 1 -type f -name '*.png' | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$COUNT" -gt 0 ] || {
    echo "ERROR:没有已保存的自定义图标配置"
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

  NEXT="$TRANSFER/active-next.bin"
  rm -f "$NEXT"
  OUTPUT=$("$HELPER" \
    -source "$FILE" \
    -output "$NEXT" \
    -icons "$CUSTOM_ICONS" \
    -missing-only 2>&1)
  STATUS=$?
  if [ "$STATUS" -ne 0 ]; then
    rm -f "$NEXT"
    echo "ERROR:本地合并失败：${OUTPUT:-未知错误}"
    exit 3
  fi
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
    echo "ERROR:生成结果不是完整有效的图标组件"
    exit 2
  }
  PC_ORIGINAL_TARGET=$TARGET_FILE
  ensure_clean_base "$PC_NAME" "$TARGET_FILE" || {
    echo "ERROR:无法保存恢复所需的原始组件，已取消写入"
    exit 3
  }
  TARGET_FILE=$(cache_path "$PC_NAME") || {
    echo "ERROR:保存基础副本后无法重新定位主题商店组件"
    exit 3
  }
  [ "$TARGET_FILE" = "$PC_ORIGINAL_TARGET" ] || {
    echo "ERROR:写入目标在准备过程中发生变化，已取消：$TARGET_FILE"
    exit 3
  }
  PC_BEFORE_HASH=$("$BB" sha256sum "$TARGET_FILE" 2>/dev/null | "$BB" awk '{print $1}')
  PC_BEFORE_MTIME=$("$BB" stat -c '%Y' "$TARGET_FILE" 2>/dev/null)

  PC_TS=$(date +%Y%m%d-%H%M%S)
  PC_BACKUP="$CACHE_BACKUPS/${PC_NAME}-$PC_TS.bak"
  cp -p "$TARGET_FILE" "$PC_BACKUP" || {
    echo "ERROR:无法备份主题商店组件"
    exit 3
  }

  PC_OWNER=$("$BB" stat -c '%u:%g' "$TARGET_FILE")
  PC_MODE=$("$BB" stat -c '%a' "$TARGET_FILE")
  PC_CONTEXT=$("$BB" ls -Zd "$TARGET_FILE" 2>/dev/null | "$BB" awk '{print $1}')
  rm -f "$TARGET_FILE.hip-new"
  cp "$TRANSFER/active.bin" "$TARGET_FILE.hip-new" || {
    echo "ERROR:无法创建待写入文件"
    exit 3
  }
  chown "$PC_OWNER" "$TARGET_FILE.hip-new" 2>/dev/null
  chmod "$PC_MODE" "$TARGET_FILE.hip-new" 2>/dev/null
  [ -n "$PC_CONTEXT" ] && chcon "$PC_CONTEXT" "$TARGET_FILE.hip-new" 2>/dev/null
  mv -f "$TARGET_FILE.hip-new" "$TARGET_FILE" || {
    cp -p "$PC_BACKUP" "$TARGET_FILE"
    echo "ERROR:写入失败，已恢复备份"
    exit 3
  }
  PC_SOURCE_HASH=$("$BB" sha256sum "$TRANSFER/active.bin" | "$BB" awk '{print $1}')
  PC_WRITTEN_HASH=$("$BB" sha256sum "$TARGET_FILE" | "$BB" awk '{print $1}')
  if [ -z "$PC_SOURCE_HASH" ] || [ "$PC_SOURCE_HASH" != "$PC_WRITTEN_HASH" ]; then
    cp -p "$PC_BACKUP" "$TARGET_FILE"
    echo "ERROR:写入后校验失败，已恢复备份"
    exit 3
  fi

  cp -p "$TARGET_FILE" "$PATCHED_CACHE/$PC_NAME" || {
    echo "ERROR:组件已写入，但无法保存更新合并副本"
    exit 3
  }
  printf '%s\n' "$PC_WRITTEN_HASH" > "$CACHE_STATE/$PC_NAME.sha256"
  prune_component_backups "$PC_NAME"
  sync
  PC_WRITTEN_MTIME=$("$BB" stat -c '%Y' "$TARGET_FILE" 2>/dev/null)
  echo "OK:$PC_BACKUP|target=$TARGET_FILE|before=$PC_BEFORE_HASH@$PC_BEFORE_MTIME|after=$PC_WRITTEN_HASH@$PC_WRITTEN_MTIME"
}

reapply_cache() {
  FILE=$(cache_path "$1") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  SAVED="$PATCHED_CACHE/$1"
  [ -s "$SAVED" ] || {
    echo "ERROR:没有保存的自定义版本"
    exit 2
  }
  [ -f "$FILE" ] || {
    echo "ERROR:主题商店组件不存在"
    exit 2
  }
  valid_zip "$SAVED" || {
    echo "ERROR:保存的自定义组件已损坏"
    exit 3
  }

  TS=$(date +%Y%m%d-%H%M%S)
  BACKUP="$CACHE_BACKUPS/${1}-store-update-$TS.bak"
  cp -p "$FILE" "$BACKUP" || exit 3
  OWNER=$("$BB" stat -c '%u:%g' "$FILE")
  MODE=$("$BB" stat -c '%a' "$FILE")
  CONTEXT=$("$BB" ls -Zd "$FILE" 2>/dev/null | "$BB" awk '{print $1}')
  cp "$SAVED" "$FILE.hip-new" || exit 3
  chown "$OWNER" "$FILE.hip-new" 2>/dev/null
  chmod "$MODE" "$FILE.hip-new" 2>/dev/null
  [ -n "$CONTEXT" ] && chcon "$CONTEXT" "$FILE.hip-new" 2>/dev/null
  mv -f "$FILE.hip-new" "$FILE" || exit 3
  "$BB" sha256sum "$FILE" | "$BB" awk '{print $1}' > "$CACHE_STATE/$1.sha256"
  sync
  echo "OK:$BACKUP"
}

restore_cache() {
  NAME=$1
  FILE=$(cache_path "$NAME") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  LATEST=$("$BB" ls -1t "$CACHE_BACKUPS/${NAME}-"*.bak 2>/dev/null | "$BB" head -n 1)
  [ -n "$LATEST" ] || {
    echo "ERROR:没有这个组件的备份"
    exit 2
  }
  valid_zip "$LATEST" || {
    echo "ERROR:最近备份已经损坏，已取消恢复"
    exit 3
  }
  cp -p "$LATEST" "$FILE.hip-restore" || {
    echo "ERROR:无法创建恢复临时文件"
    exit 3
  }
  mv -f "$FILE.hip-restore" "$FILE" || {
    rm -f "$FILE.hip-restore"
    echo "ERROR:无法恢复主题商店组件"
    exit 3
  }
  sync
  echo "OK:$LATEST"
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

recipe_begin() {
  find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' -delete 2>/dev/null
  echo "OK"
}

recipe_upload_begin() {
  valid_package "$1" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  : > "$TRANSFER/recipe-$1.b64"
}

recipe_upload_chunk() {
  valid_package "$1" || exit 2
  CHUNK=$2
  case "$CHUNK" in
    *[!A-Za-z0-9+/=]*) echo "ERROR:图标数据无效"; exit 2 ;;
  esac
  printf '%s' "$CHUNK" >> "$TRANSFER/recipe-$1.b64"
}

recipe_upload_commit() {
  valid_package "$1" || exit 2
  "$BB" base64 -d "$TRANSFER/recipe-$1.b64" > "$CUSTOM_STAGE/$1.png" || {
    echo "ERROR:图标解码失败"
    exit 2
  }
  SIZE=$("$BB" stat -c '%s' "$CUSTOM_STAGE/$1.png")
  [ "$SIZE" -le 51200 ] || {
    rm -f "$CUSTOM_STAGE/$1.png"
    echo "ERROR:图标超过 50KB"
    exit 2
  }
  MAGIC=$("$BB" od -An -tx1 -N8 "$CUSTOM_STAGE/$1.png" 2>/dev/null | "$BB" tr -d ' \n')
  [ "$MAGIC" = "89504e470d0a1a0a" ] || {
    rm -f "$CUSTOM_STAGE/$1.png"
    echo "ERROR:上传内容不是有效的 PNG 图片"
    exit 2
  }
  echo "$SIZE"
}

recipe_finish() {
  NEXT="$DATA/custom-icons-next"
  PREVIOUS="$DATA/custom-icons-previous"
  if [ ! -d "$CUSTOM_ICONS" ] && [ -d "$PREVIOUS" ]; then
    mv "$PREVIOUS" "$CUSTOM_ICONS" || {
      echo "ERROR:检测到上次保存中断，但原配置恢复失败"
      exit 3
    }
  fi
  rm -rf "$NEXT"
  [ -d "$CUSTOM_ICONS" ] && rm -rf "$PREVIOUS"
  mkdir -p "$NEXT" || {
    echo "ERROR:无法创建图标配置临时目录"
    exit 3
  }
  if [ -d "$CUSTOM_ICONS" ]; then
    find "$CUSTOM_ICONS" -maxdepth 1 -type f -name '*.png' -exec cp -p '{}' "$NEXT/" ';' || {
      rm -rf "$NEXT"
      echo "ERROR:无法保留已有图标配置，原配置未变更"
      exit 3
    }
  fi
  find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' -exec cp -p '{}' "$NEXT/" ';' || {
    rm -rf "$NEXT"
    echo "ERROR:保存图标配置失败，原配置未变更"
    exit 3
  }
  COUNT=$(find "$NEXT" -maxdepth 1 -type f -name '*.png' | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$COUNT" -gt 0 ] || {
    rm -rf "$NEXT"
    echo "ERROR:没有可保存的图标配置"
    exit 2
  }
  mv "$CUSTOM_ICONS" "$PREVIOUS" || {
    rm -rf "$NEXT"
    echo "ERROR:无法切换图标配置"
    exit 3
  }
  mv "$NEXT" "$CUSTOM_ICONS" || {
    mv "$PREVIOUS" "$CUSTOM_ICONS"
    echo "ERROR:保存图标配置失败，已恢复原配置"
    exit 3
  }
  rm -rf "$PREVIOUS"
  echo "OK:$COUNT"
}

recipe_list() {
  find "$CUSTOM_ICONS" -maxdepth 1 -type f -name '*.png' 2>/dev/null |
    "$BB" sed 's#.*/##; s/\.png$//' |
    "$BB" sort
}

recipe_list_detail() {
  find "$CUSTOM_ICONS" -maxdepth 1 -type f -name '*.png' 2>/dev/null |
    while IFS= read -r FILE; do
      BASE=${FILE##*/}
      PACKAGE=${BASE%.png}
      SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
      MTIME=$("$BB" stat -c '%Y' "$FILE" 2>/dev/null)
      printf '%s\t%s\t%s\n' "$PACKAGE" "${SIZE:-0}" "${MTIME:-0}"
    done |
    "$BB" sort
}

recipe_delete() {
  valid_package "$1" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  FILE="$CUSTOM_ICONS/$1.png"
  [ -f "$FILE" ] || {
    echo "ERROR:未找到这个自定义图标"
    exit 2
  }
  TS=$(date +%Y%m%d-%H%M%S)
  TRASH="$CUSTOM_TRASH/$1-$TS.png"
  mv "$FILE" "$TRASH" || {
    echo "ERROR:无法将自定义图标移入回收站"
    exit 3
  }
  echo "OK:$TRASH"
}

recipe_undo_delete() {
  valid_package "$1" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  ICON="$CUSTOM_ICONS/$1.png"
  [ ! -e "$ICON" ] || {
    echo "ERROR:自定义图标配置已经存在"
    exit 2
  }
  LATEST=$("$BB" ls -1t "$CUSTOM_TRASH/$1-"*.png 2>/dev/null | "$BB" head -n 1)
  [ -n "$LATEST" ] && [ -f "$LATEST" ] || {
    echo "ERROR:回收站中没有可恢复的配置"
    exit 2
  }
  mv "$LATEST" "$ICON" || {
    echo "ERROR:无法从回收站恢复配置"
    exit 3
  }
  echo "OK:$ICON"
}

recipe_delete_and_build() {
  NAME=$1
  PACKAGE=$2
  PREFIX=$3
  FILE=$(cache_path "$NAME") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  valid_package "$PACKAGE" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  case "$PREFIX" in
    ''|/*|*..*|*\\*) echo "ERROR:图标目录不安全"; exit 2 ;;
    *res/drawable*/ ) ;;
    *) echo "ERROR:无法识别图标目录"; exit 2 ;;
  esac
  ICON="$CUSTOM_ICONS/$PACKAGE.png"
  [ -f "$ICON" ] || {
    echo "ERROR:未找到这个自定义图标"
    exit 2
  }
  ensure_clean_base "$NAME" "$FILE" || {
    echo "ERROR:没有可靠的原始组件可用于恢复，请重新下载主题后再试"
    exit 3
  }
  BASE="$BASE_CACHE/$NAME"
  valid_zip "$BASE" || {
    echo "ERROR:组件基础副本已损坏"
    exit 3
  }

  TS=$(date +%Y%m%d-%H%M%S)
  TRASH="$CUSTOM_TRASH/$PACKAGE-$TS.png"
  mv "$ICON" "$TRASH" || {
    echo "ERROR:无法将自定义图标移入回收站"
    exit 3
  }

  COUNT=$(find "$CUSTOM_ICONS" -maxdepth 1 -type f -name '*.png' | "$BB" wc -l | "$BB" tr -d ' ')
  NEXT="$TRANSFER/active-next.bin"
  rm -f "$NEXT"
  if [ "$COUNT" -gt 0 ]; then
    ARCH=$("$BB" uname -m 2>/dev/null)
    case "$ARCH" in
      aarch64|arm64) HELPER="$MODDIR/bin/hipzip-arm64" ;;
      *) mv "$TRASH" "$ICON"; echo "ERROR:当前设备架构不支持安全恢复"; exit 3 ;;
    esac
    OUTPUT=$("$HELPER" -source "$BASE" -output "$NEXT" -icons "$CUSTOM_ICONS" -prefix "$PREFIX" 2>&1)
    STATUS=$?
    if [ "$STATUS" -ne 0 ]; then
      rm -f "$NEXT"
      mv "$TRASH" "$ICON"
      echo "ERROR:重新生成失败，已恢复配置：${OUTPUT:-未知错误}"
      exit 3
    fi
  else
    cp -p "$BASE" "$NEXT" || {
      mv "$TRASH" "$ICON"
      echo "ERROR:无法生成原始恢复结果，已恢复配置"
      exit 3
    }
  fi
  valid_zip "$NEXT" || {
    rm -f "$NEXT"
    mv "$TRASH" "$ICON"
    echo "ERROR:恢复结果校验失败，已恢复配置"
    exit 3
  }
  mv -f "$NEXT" "$TRANSFER/active.bin" || {
    rm -f "$NEXT"
    mv "$TRASH" "$ICON"
    echo "ERROR:无法切换恢复结果，已恢复配置"
    exit 3
  }
  echo "OK:$COUNT:$TRASH"
}

prepare_recipe() {
  valid_package "$1" || {
    echo "ERROR:应用包名无效"
    exit 2
  }
  FILE="$CUSTOM_ICONS/$1.png"
  [ -f "$FILE" ] || {
    echo "ERROR:未找到保存的自定义图标"
    exit 2
  }
  "$BB" base64 "$FILE" | "$BB" tr -d '\n' > "$TRANSFER/source.b64"
  "$BB" wc -c < "$TRANSFER/source.b64" | "$BB" tr -d ' '
}

read_chunk() {
  OFFSET=$1
  COUNT=$2
  case "$OFFSET:$COUNT" in
    *[!0-9:]*) exit 2 ;;
  esac
  [ -f "$TRANSFER/source.b64" ] || {
    echo "ERROR:读取源尚未准备完成"
    exit 2
  }
  [ "$COUNT" -le 400000 ] || {
    echo "ERROR:单次读取数据过大"
    exit 2
  }
  START=$((OFFSET + 1))
  "$BB" tail -c "+$START" "$TRANSFER/source.b64" | "$BB" head -c "$COUNT"
}

upload_begin() {
  TARGET=$1
  case "$TARGET" in active) ;; *) exit 2 ;; esac
  : > "$TRANSFER/$TARGET.b64"
}

upload_chunk() {
  TARGET=$1
  CHUNK=$2
  case "$TARGET" in active) ;; *) exit 2 ;; esac
  case "$CHUNK" in
    *[!A-Za-z0-9+/=]*) echo "ERROR:上传数据无效"; exit 2 ;;
  esac
  printf '%s' "$CHUNK" >> "$TRANSFER/$TARGET.b64"
}

upload_commit() {
  TARGET=$1
  case "$TARGET" in active) ;; *) exit 2 ;; esac
  "$BB" base64 -d "$TRANSFER/$TARGET.b64" > "$TRANSFER/$TARGET.bin" || {
    echo "ERROR:无法解码上传文件"
    exit 2
  }
  valid_zip "$TRANSFER/$TARGET.bin" || {
    rm -f "$TRANSFER/$TARGET.bin"
    echo "ERROR:上传结果不是完整有效的图标组件"
    exit 2
  }
  "$BB" stat -c '%s' "$TRANSFER/$TARGET.bin"
}

refresh_launcher() {
  am force-stop com.miui.home 2>/dev/null
  am force-stop com.mi.android.globallauncher 2>/dev/null
  echo "OK"
}

case "$1" in
  list_apps) list_apps ;;
  scan_cache) scan_cache ;;
  stream_cache) stream_cache "$2" ;;
  prepare_cache) prepare_cache "$2" ;;
  fast_build) fast_build "$2" "$3" ;;
  fast_merge) fast_merge "$2" ;;
  patch_cache) patch_cache "$2" ;;
  reapply_cache) reapply_cache "$2" ;;
  restore_cache) restore_cache "$2" ;;
  open_theme_manager) open_theme_manager ;;
  recipe_begin) recipe_begin ;;
  recipe_upload_begin) recipe_upload_begin "$2" ;;
  recipe_upload_chunk) recipe_upload_chunk "$2" "$3" ;;
  recipe_upload_commit) recipe_upload_commit "$2" ;;
  recipe_finish) recipe_finish ;;
  recipe_list) recipe_list ;;
  recipe_list_detail) recipe_list_detail ;;
  recipe_delete) recipe_delete "$2" ;;
  recipe_undo_delete) recipe_undo_delete "$2" ;;
  recipe_delete_and_build) recipe_delete_and_build "$2" "$3" "$4" ;;
  prepare_recipe) prepare_recipe "$2" ;;
  read_chunk) read_chunk "$2" "$3" ;;
  upload_begin) upload_begin "$2" ;;
  upload_chunk) upload_chunk "$2" "$3" ;;
  upload_commit) upload_commit "$2" ;;
  refresh) refresh_launcher ;;
  *) echo "ERROR:未知操作"; exit 2 ;;
esac
