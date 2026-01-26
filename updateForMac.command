#!/bin/bash

set -e

# =================================================
# 從此檔案所在位置開始，往上找 git repo
# =================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

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
  read
  exit 1
fi

# =================================================
# 確認 extension 根目錄
# =================================================
if [ ! -f "manifest.json" ]; then
  echo "[ERROR] 找不到 manifest.json"
  read
  exit 1
fi

# =================================================
# 更新程式碼（不重寫檔案 inode）
# =================================================
git pull --rebase

# =================================================
# 關閉 Chrome
# =================================================
pkill -f "Google Chrome" || true
sleep 1

# =================================================
# 啟動 Chrome 並重新載入 extension
# =================================================
open -a "Google Chrome" --args \
  --load-extension="$(pwd)"

echo "✅ 更新完成"
read
