#!/usr/bin/env bash
# ==============================================================================
# CVAT 錯誤日誌一鍵收集並建立 GitHub Issue 腳本 (Mac/Linux)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TMP_LOG="/tmp/cvat_error_report.txt"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
REPO="benimut/cvat"
ISSUE_TITLE="[Bug Report] Mac 測試錯誤日誌 ($TIMESTAMP)"

echo "[INFO] 正在收集 CVAT 最新錯誤日誌..."

# 抓取最近 400 行日誌，涵蓋伺服器、背景工作者、OPA 與資料庫
docker compose logs --tail=400 cvat_server cvat_worker_import cvat_opa cvat_db > "$TMP_LOG" 2>&1

echo "[INFO] 日誌收集完成。"

# 準備 Markdown 格式的 Issue 內容
ISSUE_BODY=$(cat <<EOF
### 錯誤發生時間
$TIMESTAMP

### 系統環境
- 作業系統: $(uname -s) ($(uname -m))
- 當前分支: $(git rev-parse --abbrev-ref HEAD)
- 最新 Commit: $(git rev-parse --short HEAD)

### 錯誤日誌 (Docker Logs 節錄)
\`\`\`text
$(tail -n 250 "$TMP_LOG")
\`\`\`
EOF
)

# 判斷是否具備 gh (GitHub CLI)
if command -v gh &> /dev/null && gh auth status &> /dev/null; then
    echo "[INFO] 偵測到 GitHub CLI (gh)，正在自動為您發起 GitHub Issue..."
    ISSUE_URL=$(gh issue create --repo "$REPO" --title "$ISSUE_TITLE" --body "$ISSUE_BODY")
    echo "============================================================"
    echo " 成功建立 GitHub Issue！"
    echo " 網址: $ISSUE_URL"
    echo "============================================================"
else
    echo "[INFO] 未偵測到 gh 登入狀態，正為您準備網頁端一鍵發送..."

    # 如果在 macOS，自動將日誌複製至剪貼簿並打開瀏覽器
    if [ "$(uname -s)" = "Darwin" ]; then
        echo "$ISSUE_BODY" | pbcopy
        echo "[INFO] 錯誤日誌已自動複製到 Mac 剪貼簿！"
        echo "[INFO] 正在為您打開 GitHub 建立 Issue 頁面..."
        open "https://github.com/${REPO}/issues/new?title=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$ISSUE_TITLE'))")"
        echo "============================================================"
        echo " 瀏覽器已打開！請直接在 Issue 內容區按 Cmd+V 貼上並點擊送出即可！"
        echo " (提示: 若希望全自動不開瀏覽器，可執行: brew install gh && gh auth login)"
        echo "============================================================"
    else
        echo "請至以下網址手動建立 Issue:"
        echo "https://github.com/${REPO}/issues/new"
    fi
fi

# 清理本機臨時檔案
rm -f "$TMP_LOG"
