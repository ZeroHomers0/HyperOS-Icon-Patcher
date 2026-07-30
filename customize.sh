#!/system/bin/sh

ui_print "- 安装 HyperOS 图标补全器"
ui_print "- WebUI 写入异常时会自动回滚"

DATA=/data/adb/hyper_icon_patcher_data

mkdir -p "$DATA"

mkdir -p "$DATA/custom-icons-stage"
mkdir -p "$DATA/patch-groups"
mkdir -p "$DATA/theme-label-cache"
mkdir -p "$DATA/transfer"

# 覆盖安装时保留修补组，仅移除旧状态、可重建缓存与临时文件。
rm -rf "$DATA/cache-state" "$DATA/patched-cache" "$DATA/base-cache" "$DATA/custom-icons-trash" "$DATA/cache-backups" "$DATA/theme-label-cache"
rm -rf "$DATA/theme-icons" "$DATA/custom-icons"
rm -rf "$DATA/custom-icons-stage" "$DATA/transfer"
mkdir -p "$DATA/custom-icons-stage" "$DATA/transfer" "$DATA/theme-label-cache"
rmdir "$DATA/icons" "$DATA/backups" 2>/dev/null


set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/scripts/backend.sh" 0 0 0755
set_perm "$MODPATH/bin/hipzip-arm64" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
rm -f "$MODPATH/action.sh"
