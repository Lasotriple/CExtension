#!/bin/bash

set -e

echo "🔍 定位 git repository..."

# -------------------------------------------------
# 從此 script 所在目錄開始
# -------------------------------------------------
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# -------------------------------------------------
# 一路往上找 .git（最多找 5 層，避免無限迴圈）
# -------------------------------------------------
FOUND=0
for i in {1..5}; do
  if [ -d ".git" ]; then
    FOUND=1
    break
  fi
  cd ..
done

if [ "$FOUND" -ne 1 ]; then
  echo "[ERROR] 找不到 git repository (.git)"
  echo "請確認 updateForMac.command 放在專案內"
  read
  exit 1
fi

echo "✅ Git repo located at:"
pwd

# -------------------------------------------------
# 檢查 manifest.json（確保是 extension root）
# -------------------------------------------------
if [ ! -f "manifest.json" ]; then
  echo "[ERROR] 找不到 manifest.json"
  echo "目前目錄不是 Chrome extension 根目錄"
  read
  exit 1
fi

# -------------------------------------------------
# 更新程式碼
# -------------------------------------------------
echo "⬇️ 更新程式碼..."
git fetch
git reset --hard origin/main

# -------------------------------------------------
# 關閉 Chrome
# -------------------------------------------------
echo "🛑 關閉 Chrome..."
pkill -f "Google Chrome" || true
sleep 1

# -------------------------------------------------
# 啟動 Chrome 並重新載入 extension
# -------------------------------------------------
echo "🚀 啟動 Chrome 並載入 extension..."
open -a "Google Chrome" --args \
  --load-extension="$(pwd)"

echo "✅ 更新完成"
read
