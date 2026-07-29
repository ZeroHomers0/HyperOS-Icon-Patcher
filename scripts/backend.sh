#!/system/bin/sh

MODDIR=${0%/*}
MODDIR=${MODDIR%/*}
DATA=/data/adb/hyper_icon_patcher
TRANSFER="$DATA/transfer"
CACHE_BACKUPS="$DATA/cache-backups"
PATCHED_CACHE="$DATA/patched-cache"
CACHE_STATE="$DATA/cache-state"
CUSTOM_ICONS="$DATA/custom-icons"
CUSTOM_STAGE="$DATA/custom-icons-stage"
BB=/data/adb/ksu/bin/busybox

[ -x "$BB" ] || BB=busybox

mkdir -p "$TRANSFER" "$CACHE_BACKUPS" "$PATCHED_CACHE" "$CACHE_STATE" "$CUSTOM_ICONS" "$CUSTOM_STAGE" || {
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
  FILE=$1
  [ -s "$FILE" ] || return 1
  SIZE=$("$BB" stat -c '%s' "$FILE" 2>/dev/null)
  [ -n "$SIZE" ] && [ "$SIZE" -le 83886080 ] || return 1
  MAGIC=$("$BB" od -An -tx1 -N4 "$FILE" 2>/dev/null | "$BB" tr -d ' \n')
  case "$MAGIC" in
    504b0304|504b0506|504b0708) ;;
    *) return 1 ;;
  esac
  "$BB" unzip -l "$FILE" >/dev/null 2>&1
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
  "$BB" base64 "$FILE" | "$BB" tr -d '\n' > "$TRANSFER/source.b64"
  "$BB" wc -c < "$TRANSFER/source.b64" | "$BB" tr -d ' '
}

patch_cache() {
  FILE=$(cache_path "$1") || {
    echo "ERROR:缓存文件名无效"
    exit 2
  }
  [ -f "$FILE" ] || {
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

  TS=$(date +%Y%m%d-%H%M%S)
  BACKUP="$CACHE_BACKUPS/${1}-$TS.bak"
  cp -p "$FILE" "$BACKUP" || {
    echo "ERROR:无法备份主题商店组件"
    exit 3
  }

  OWNER=$("$BB" stat -c '%u:%g' "$FILE")
  MODE=$("$BB" stat -c '%a' "$FILE")
  CONTEXT=$("$BB" ls -Zd "$FILE" 2>/dev/null | "$BB" awk '{print $1}')
  rm -f "$FILE.hip-new"
  cp "$TRANSFER/active.bin" "$FILE.hip-new" || {
    echo "ERROR:无法创建待写入文件"
    exit 3
  }
  chown "$OWNER" "$FILE.hip-new" 2>/dev/null
  chmod "$MODE" "$FILE.hip-new" 2>/dev/null
  [ -n "$CONTEXT" ] && chcon "$CONTEXT" "$FILE.hip-new" 2>/dev/null
  mv -f "$FILE.hip-new" "$FILE" || {
    cp -p "$BACKUP" "$FILE"
    echo "ERROR:写入失败，已恢复备份"
    exit 3
  }
  SOURCE_HASH=$("$BB" sha256sum "$TRANSFER/active.bin" | "$BB" awk '{print $1}')
  WRITTEN_HASH=$("$BB" sha256sum "$FILE" | "$BB" awk '{print $1}')
  if [ -z "$SOURCE_HASH" ] || [ "$SOURCE_HASH" != "$WRITTEN_HASH" ]; then
    cp -p "$BACKUP" "$FILE"
    echo "ERROR:写入后校验失败，已恢复备份"
    exit 3
  fi

  cp -p "$FILE" "$PATCHED_CACHE/$1" || {
    echo "ERROR:组件已写入，但无法保存更新合并副本"
    exit 3
  }
  printf '%s\n' "$WRITTEN_HASH" > "$CACHE_STATE/$1.sha256"
  prune_component_backups "$1"
  sync
  echo "OK:$BACKUP"
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
      echo "ERROR:检测到上次保存中断，但原配方恢复失败"
      exit 3
    }
  fi
  rm -rf "$NEXT"
  [ -d "$CUSTOM_ICONS" ] && rm -rf "$PREVIOUS"
  mkdir -p "$NEXT" || {
    echo "ERROR:无法创建图标配方临时目录"
    exit 3
  }
  find "$CUSTOM_STAGE" -maxdepth 1 -type f -name '*.png' -exec cp -p '{}' "$NEXT/" ';' || {
    rm -rf "$NEXT"
    echo "ERROR:保存图标配方失败，原配方未变更"
    exit 3
  }
  COUNT=$(find "$NEXT" -maxdepth 1 -type f -name '*.png' | "$BB" wc -l | "$BB" tr -d ' ')
  [ "$COUNT" -gt 0 ] || {
    rm -rf "$NEXT"
    echo "ERROR:没有可保存的图标配方"
    exit 2
  }
  mv "$CUSTOM_ICONS" "$PREVIOUS" || {
    rm -rf "$NEXT"
    echo "ERROR:无法切换图标配方"
    exit 3
  }
  mv "$NEXT" "$CUSTOM_ICONS" || {
    mv "$PREVIOUS" "$CUSTOM_ICONS"
    echo "ERROR:保存图标配方失败，已恢复原配方"
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
  prepare_recipe) prepare_recipe "$2" ;;
  read_chunk) read_chunk "$2" "$3" ;;
  upload_begin) upload_begin "$2" ;;
  upload_chunk) upload_chunk "$2" "$3" ;;
  upload_commit) upload_commit "$2" ;;
  refresh) refresh_launcher ;;
  *) echo "ERROR:未知操作"; exit 2 ;;
esac
