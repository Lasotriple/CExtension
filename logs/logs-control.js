/* 控制函數 */
async function startTail() {
    /* 清理之前的狀態 */
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }

    /* 清理日誌內容 */
    clearLogs();

    try {
        const s1 = await groovyCaller(getLogsSize());
        lastSize = s1.newSize || 0;
        currentLogPath = s1.catalinaPath;
        errorCount = 0;
    } catch (e) {
        appendWithStorage(`\n[${new Date().toLocaleString()}] 初始化失敗：${e?.message || e}\n`);
        return;
    }

    setMeta(`檔案：${currentLogPath}｜初始大小：${lastSize} bytes｜每 ${INTERVAL_MS}ms`);

    running = true;
    controlBtn.textContent = "暫停";

    /* 使用 setTimeout 遞迴調用，避免瀏覽器節流 */
    scheduleNextCheck();
}

function scheduleNextCheck() {
    if (!running) return;

    /* 使用多種方式確保不被節流 */
    const scheduleWithFallback = () => {
        timeoutId = setTimeout(async () => {
            if (!running) return;

            try {
                const s = await groovyCaller(getLogsSize());
                const newSize = s.newSize || 0;
                const newPath = s.catalinaPath;

                /* 檢查是否切換了文件 */
                if (currentLogPath !== newPath) {
                    appendWithStorage(`\n[${new Date().toLocaleString()}] 切換到新文件：${newPath}\n`);
                    currentLogPath = newPath;
                    lastSize = 0;
                }

                if (newSize < lastSize) {
                    appendWithStorage(`\n[${new Date().toLocaleString()}] 檔案縮小（rotate/truncate），重置 lastSize。\n`);
                    lastSize = 0;
                }

                const diff = newSize - lastSize;
                setMeta(`檔案：${currentLogPath}｜大小：${newSize}｜增量：${diff}｜錯誤：${errorCount}`);

                if (diff > 0) {
                    const tail = await groovyCaller(getLogsTail(lastSize, diff));
                    if (tail?.content) appendWithStorage(tail.content);
                }

                lastSize = newSize;
                errorCount = 0;
            } catch (e) {
                errorCount++;

                /* 根據錯誤類型提供不同的訊息 */
                let errorMsg = e?.message || e;
                if (e.name === 'TypeError' && e.message.includes('fetch')) {
                    errorMsg = '網路連線錯誤，請檢查 API 是否可達';
                } else if (e.name === 'SyntaxError') {
                    errorMsg = 'API 回應格式錯誤，請檢查伺服器狀態';
                } else if (errorMsg.includes('API URL 尚未初始化')) {
                    errorMsg = 'API URL 初始化失敗，請重新開啟視窗';
                }

                appendWithStorage(`\n[${new Date().toLocaleString()}] 讀取失敗：${errorMsg} (錯誤 ${errorCount}/${MAX_ERRORS})\n`);

                /* 如果錯誤次數過多，暫停並提示 */
                if (errorCount >= MAX_ERRORS) {
                    appendWithStorage(`\n[${new Date().toLocaleString()}] 錯誤次數過多，自動暫停。請檢查連線後手動繼續。\n`);
                    pauseTail();
                    return;
                }
            }

            /* 遞迴調用下一次檢查 */
            scheduleNextCheck();
        }, INTERVAL_MS);
    };

    /* 主要調度 */
    scheduleWithFallback();

    /* 備用機制：使用 requestAnimationFrame 作為備用 */
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
            /* 確保在下一幀也有檢查 */
            setTimeout(() => {
                if (running && !timeoutId) {
                    scheduleNextCheck();
                }
            }, INTERVAL_MS);
        });
    }
}

function pauseTail() {
    running = false;
    controlBtn.textContent = "繼續";
}

function resumeTail() {
    running = true;
    controlBtn.textContent = "暫停";
    /* 重新開始，不延續之前的狀態 */
    startTail();
}

function stopAndCleanup() {
    running = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
}
