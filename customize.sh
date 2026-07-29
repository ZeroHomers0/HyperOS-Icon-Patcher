#!/system/bin/sh

ui_print "- 安装 HyperOS 图标补全器"
ui_print "- WebUI 中的所有修改均会先备份"

LEGACY_DATA=/data/adb/hyper_icon_patcher
DATA=/data/adb/hyper_icon_patcher_data

mkdir -p "$DATA"
if [ ! -f "$DATA/.legacy-migrated" ] && [ -d "$LEGACY_DATA" ]; then
  cp -Rp "$LEGACY_DATA/." "$DATA/" || abort "! 无法迁移旧版自定义图标数据"
  touch "$DATA/.legacy-migrated"
  ui_print "- 已保留并迁移旧版自定义图标"
fi

mkdir -p "$DATA/icons"
mkdir -p "$DATA/backups"
mkdir -p "$DATA/cache-backups"
mkdir -p "$DATA/patched-cache"
mkdir -p "$DATA/cache-state"
mkdir -p "$DATA/base-cache"
mkdir -p "$DATA/custom-icons"
mkdir -p "$DATA/custom-icons-stage"
mkdir -p "$DATA/custom-icons-trash"
mkdir -p "$DATA/transfer"

set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/scripts/backend.sh" 0 0 0755
set_perm "$MODPATH/bin/hipzip-arm64" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
rm -f "$MODPATH/action.sh"

# v0.5 起移除后台覆盖保护。
rm -f "$LEGACY_DATA/monitor.enabled"
rm -f "$LEGACY_DATA/pinned-icons.zip"
rm -f "$LEGACY_DATA/monitor.log"
