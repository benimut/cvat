#!/usr/bin/env bash
# ==============================================================================
# CVAT 錯誤日誌一鍵收集與 Git 推送回報腳本 (Mac/Linux)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="error.log"

echo "[INFO] 正在收集 CVAT 服務與 Worker 的最新錯誤日誌..."

# 抓取最近 300 行日誌，涵蓋伺服器與背景解碼/匯入工作者
docker compose logs --tail=300 cvat_server cvat_worker_import cvat_worker_export > "$LOG_FILE" 2>&1

echo "[INFO] 日誌收集完成，大小: $(wc -c < "$LOG_FILE") 位元組"
echo "[INFO] 正在透過 Git 提交並推送到 GitHub..."

git add "$LOG_FILE"
git commit -m "report(mac): 自動上報測試錯誤日誌 $(date '+%Y-%m-%d %H:%M:%S')" || {
    echo "[WARNING] 沒有新的錯誤內容變更。"
    exit 0
}

# 取得當前分支名稱並推送至 origin
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$CURRENT_BRANCH"

echo "============================================================"
echo " 成功！錯誤日誌已推送到 GitHub (${CURRENT_BRANCH})！"
echo " 請回到對話框告知 AI 助手「已 push 日誌」，AI 會自動讀取並除錯。"
echo "============================================================"
