#!/system/bin/sh

ui_print "- 安装 HyperOS 图标补全器"
ui_print "- WebUI 中的所有修改均会先备份"

mkdir -p /data/adb/hyper_icon_patcher/icons
mkdir -p /data/adb/hyper_icon_patcher/backups
mkdir -p /data/adb/hyper_icon_patcher/cache-backups
mkdir -p /data/adb/hyper_icon_patcher/patched-cache
mkdir -p /data/adb/hyper_icon_patcher/cache-state
mkdir -p /data/adb/hyper_icon_patcher/custom-icons
mkdir -p /data/adb/hyper_icon_patcher/custom-icons-stage
mkdir -p /data/adb/hyper_icon_patcher/transfer

set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/scripts/backend.sh" 0 0 0755
rm -f "$MODPATH/action.sh"

# v0.5 起移除后台覆盖保护。
rm -f /data/adb/hyper_icon_patcher/monitor.enabled
rm -f /data/adb/hyper_icon_patcher/pinned-icons.zip
rm -f /data/adb/hyper_icon_patcher/monitor.log
