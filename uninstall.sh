#!/system/bin/sh

# 仅在用户明确卸载模块时执行；普通覆盖安装/升级不会调用本脚本。
for ROOT in \
  /storage/emulated/0/Android/data/com.android.thememanager/files/MIUI/theme/.data/content/icons \
  /sdcard/Android/data/com.android.thememanager/files/MIUI/theme/.data/content/icons
do
  [ -d "$ROOT" ] || continue
  find "$ROOT" -maxdepth 1 -type f \( -name '*.hip-new' -o -name '*.hip-restore' \) -delete 2>/dev/null
done
rm -rf /data/adb/hyper_icon_patcher_data
rm -rf /data/adb/hyper_icon_patcher
