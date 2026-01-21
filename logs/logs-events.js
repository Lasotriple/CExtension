/* 事件監聽 */
function setupEventListeners() {
    /* 控制按鈕事件 */
    controlBtn.addEventListener('click', () => {
        if (!CEXT.getDomain()) {
            appendWithStorage(`\n[${new Date().toLocaleString()}] 錯誤：Domain 尚未初始化\n`);
            return;
        }

        if (!running && !timeoutId) {
            startTail();
            return;
        }
        if (running) {
            pauseTail();
        } else {
            resumeTail();
        }
    });

    /* 處理初始化 */
    function handleInit(domain) {
        if (!domain) return;
        
        /* 使用 CEXT 統一管理 context */
        CEXT.setDomain(domain);

        /* 更新標題並取得 tenant name */
        const headerTitle = document.querySelector('header strong');
        (async () => {
            /* 嘗試取得 tenant name */
            try {
                const domain = CEXT.getDomain();
                if (domain) {
                    const tenantScript = getTenantName();
                    const tenantResult = await groovyCaller(tenantScript);
                    let tenantName = '';
                    if (tenantResult && typeof tenantResult === 'object' && tenantResult.tenantName) {
                        tenantName = tenantResult.tenantName;
                    } else if (tenantResult && typeof tenantResult === 'string') {
                        tenantName = tenantResult;
                    }
                    /* 使用 CEXT 統一管理 */
                    if (tenantName) {
                        CEXT.setTenantName(tenantName);
                    }

                    /* 更新標題 */
                    if (headerTitle) {
                        headerTitle.textContent = `Logs Viewer - ${tenantName}`;
                        document.title = `Logs Viewer - ${tenantName}`;
                    }
                }
            } catch (error) {
                console.warn('無法取得 tenant name:', error);
            }

            /* 更新 meta 訊息 */
            const tenantName = CEXT.getTenantName();
            if (tenantName) {
                setMeta(`Domain 已初始化 (${tenantName})，點擊「開始」按鈕開始讀取日誌`);
            } else {
                setMeta("Domain 已初始化，點擊「開始」按鈕開始讀取日誌");
            }

            /* 隱藏 loading 畫面 */
            hideLoadingScreen();
        })();
    }

    /* 監聽來自父視窗的訊息 */
    window.addEventListener('message', (e) => {
        const { type, domain: receivedDomain, source } = e.data || {};
        
        /* 處理來自主頁的初始化訊息 */
        if (type === 'init' && receivedDomain) {
            handleInit(receivedDomain);
        }
        
        /* 處理來自主頁的初始化回應 */
        if (source === 'CEXT_MAIN' && type === 'init-response' && receivedDomain) {
            handleInit(receivedDomain);
        }
    });

    /* 主動請求初始化（當頁面載入時如果沒有 domain） */
    function requestInitFromParent() {
        if (CEXT.getDomain()) {
            /* 已經有 domain，不需要請求 */
            hideLoadingScreen();
            return;
        }

        /* 嘗試從 opener 獲取 */
        if (window.opener && !window.opener.closed) {
            try {
                /* 向主頁請求初始化 */
                window.opener.postMessage({
                    source: 'CEXT_LOGS',
                    type: 'request-init'
                }, '*');
            } catch (error) {
                console.warn('無法向主頁請求初始化:', error);
            }
        }

        /* 使用 BroadcastChannel 作為備用方案 */
        try {
            const channel = new BroadcastChannel('cext_init_channel');
            channel.postMessage({
                source: 'CEXT_LOGS',
                type: 'request-init'
            });
            
            /* 監聽回應 */
            channel.addEventListener('message', (e) => {
                const { source, type, domain } = e.data || {};
                if (source === 'CEXT_MAIN' && type === 'init-response' && domain) {
                    handleInit(domain);
                    channel.close();
                }
            });
            
            /* 5 秒後關閉 channel（避免記憶體洩漏） */
            setTimeout(() => {
                channel.close();
            }, 5000);
        } catch (error) {
            console.warn('BroadcastChannel 不可用:', error);
        }
    }

    /* 頁面載入完成後，如果沒有 domain，主動請求 */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(requestInitFromParent, 100);
        });
    } else {
        setTimeout(requestInitFromParent, 100);
    }

    /* 視窗可見性檢測 - 確保在背景時也能正常運行 */
    document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
        if (isVisible && running) {
            /* 視窗重新可見時，立即執行一次檢查 */
            if (timeoutId) {
                clearTimeout(timeoutId);
                scheduleNextCheck();
            }
        }
    });

    /* 視窗焦點檢測 - 額外的抗節流機制 */
    window.addEventListener('focus', () => {
        if (running && !timeoutId) {
            scheduleNextCheck();
        }
    });

    /* 滾動事件監聽 */
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        userScrolled = true;
        checkIfAtBottom();

        /* 清除之前的計時器 */
        clearTimeout(scrollTimeout);

        /* 如果使用者滾動到底部，重置 userScrolled 狀態 */
        scrollTimeout = setTimeout(() => {
            if (isAtBottom) {
                userScrolled = false;
            }
        }, 150);
    });

    /* 鍵盤快捷鍵支援 */
    document.addEventListener('keydown', (e) => {
        /* Ctrl/Cmd + Enter: 開始/暫停 */
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            controlBtn.click();
        }
        /* Space: 開始/暫停（當焦點不在輸入框時） */
        else if (e.key === ' ' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            e.preventDefault();
            controlBtn.click();
        }
    });

    window.addEventListener("beforeunload", stopAndCleanup);
}

/* 隱藏 loading 畫面 */
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
    }
}
