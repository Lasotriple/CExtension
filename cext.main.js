/* 只在 top frame、且只啟動一次 */
if (window.top !== window.self) throw new Error("[cext] skip in iframe");
if (window.__CEXT_BOOTED__) throw new Error("[cext] already booted");
window.__CEXT_BOOTED__ = true;

(function () {
    const N = (self.CEXT = self.CEXT || {});
    const STORAGE_KEY = N.STORAGE_KEY;

    const batchSessionState = {
        windowRef: null,
        checkIntervalId: null,
        results: [],
        logs: [],
        tenantName: '',
        totalQuestions: 0,
        lastTimestamp: null,
        isFinalizing: false,
        batchId: null
    };

    const downloadHelperState = {
        iframe: null,
        contentWindow: null,
        ready: false,
        readyCallbacks: [],
        readyTimeoutId: null,
        queue: [],
        activeTask: null
    };

    const BatchStorage = (typeof window !== 'undefined' && window.CEXTBatchStorage) ? window.CEXTBatchStorage : null;
    let batchStorageReadyPromise = null;

    function ensureBatchStorageLoaded() {
        if (!BatchStorage || typeof BatchStorage.init !== 'function') {
            return Promise.resolve(false);
        }
        if (batchStorageReadyPromise) {
            return batchStorageReadyPromise;
        }
        batchStorageReadyPromise = BatchStorage.init()
            .then((result) => {
                if (result === false) {
                    return false;
                }
                return true;
            })
            .catch((error) => {
                console.warn('[cext] 批次儲存初始化失敗:', error);
                return false;
            });
        return batchStorageReadyPromise;
    }

    const pendingUIState = {
        section: null,
        list: null
    };

    function formatTimeLabel(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return '';
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    function formatStatusLabel(status) {
        switch (status) {
            case 'completed':
                return '已完成';
            case 'error':
                return '失敗';
            case 'stopped':
                return '已停止';
            case 'in_progress':
            default:
                return '處理中';
        }
    }

    function setupPendingDownloadsUI(refs) {
        pendingUIState.section = refs.pendingSection || null;
        pendingUIState.list = refs.pendingList || null;
        if (!pendingUIState.list) {
            return;
        }
        pendingUIState.list.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) {
                return;
            }
            const batchId = button.dataset.batchId;
            if (!batchId) {
                return;
            }
            if (button.dataset.action === 'download-pending') {
                event.preventDefault();
                await handlePendingDownload(batchId);
            } else if (button.dataset.action === 'discard-pending') {
                event.preventDefault();
                await handlePendingDiscard(batchId);
            }
        });
    }

    async function refreshPendingBatchesUI() {
        if (!pendingUIState.section || !pendingUIState.list) {
            return;
        }
        const ready = await ensureBatchStorageLoaded();
        if (!ready || !window.CEXTBatchStorage || typeof window.CEXTBatchStorage.listBatches !== 'function') {
            pendingUIState.section.style.display = 'none';
            pendingUIState.list.innerHTML = '';
            return;
        }
        let batches = [];
        try {
            batches = await window.CEXTBatchStorage.listBatches({ includeDownloaded: false });
        } catch (error) {
            console.warn('[cext] 讀取暫存批次失敗:', error);
            pendingUIState.section.style.display = 'none';
            pendingUIState.list.innerHTML = '';
            return;
        }
        if (!Array.isArray(batches) || batches.length === 0) {
            pendingUIState.section.style.display = 'none';
            pendingUIState.list.innerHTML = '';
            return;
        }
        pendingUIState.section.style.display = 'flex';
        const fragment = document.createDocumentFragment();
        batches.forEach((batch) => {
            const item = document.createElement('div');
            item.className = 'cext-pending-item';
            item.dataset.batchId = batch.batchId;

            const title = document.createElement('div');
            title.className = 'cext-pending-meta';
            title.textContent = `${batch.tenantName || '未知租戶'} · ${batch.completedCount || 0}/${batch.totalQuestions || 0}`;
            item.appendChild(title);

            const subtitle = document.createElement('div');
            subtitle.className = 'cext-pending-meta cext-pending-meta-sub';
            subtitle.textContent = `${formatStatusLabel(batch.status)} · 更新 ${formatTimeLabel(batch.updatedAt || batch.createdAt)}`;
            item.appendChild(subtitle);

            const actions = document.createElement('div');
            actions.className = 'cext-pending-actions';

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.dataset.action = 'download-pending';
            downloadBtn.dataset.batchId = batch.batchId;
            downloadBtn.textContent = '下載';

            const discardBtn = document.createElement('button');
            discardBtn.type = 'button';
            discardBtn.dataset.action = 'discard-pending';
            discardBtn.dataset.batchId = batch.batchId;
            discardBtn.dataset.style = 'secondary';
            discardBtn.textContent = '刪除';

            actions.appendChild(downloadBtn);
            actions.appendChild(discardBtn);
            item.appendChild(actions);
            fragment.appendChild(item);
        });
        pendingUIState.list.innerHTML = '';
        pendingUIState.list.appendChild(fragment);
    }

    async function handlePendingDownload(batchId) {
        const ready = await ensureBatchStorageLoaded();
        if (!ready || !window.CEXTBatchStorage || typeof window.CEXTBatchStorage.getBatchSnapshot !== 'function') {
            return;
        }
        let snapshot = null;
        try {
            snapshot = await window.CEXTBatchStorage.getBatchSnapshot(batchId);
        } catch (error) {
            console.warn('[cext] 讀取暫存批次內容失敗:', error);
        }
        if (!snapshot) {
            await refreshPendingBatchesUI();
            return;
        }
        enqueueDownloadTask({
            results: snapshot.entries || [],
            logs: snapshot.logs || [],
            tenantName: snapshot.meta?.tenantName || '',
            partial: snapshot.meta?.status !== 'completed',
            batchId,
            markDownloadedOnComplete: true
        });
        await refreshPendingBatchesUI();
    }

    async function handlePendingDiscard(batchId) {
        const ready = await ensureBatchStorageLoaded();
        if (!ready || !window.CEXTBatchStorage || typeof window.CEXTBatchStorage.removeBatch !== 'function') {
            return;
        }
        try {
            await window.CEXTBatchStorage.removeBatch(batchId);
        } catch (error) {
            console.warn('[cext] 移除暫存批次失敗:', error);
        }
        await refreshPendingBatchesUI();
    }

    async function handleDownloadTaskCompletion(success, detail) {
        const activeTask = downloadHelperState.activeTask;
        downloadHelperState.activeTask = null;
        downloadHelperState.ready = true;

        if (!activeTask) {
            await refreshPendingBatchesUI();
            flushDownloadQueue();
            return;
        }

        if (success && activeTask.meta && activeTask.meta.batchId) {
            try {
                const ready = await ensureBatchStorageLoaded();
                if (ready && window.CEXTBatchStorage) {
                    if (activeTask.meta.purgeOnComplete && typeof window.CEXTBatchStorage.removeBatch === 'function') {
                        await window.CEXTBatchStorage.removeBatch(activeTask.meta.batchId);
                    } else if (activeTask.meta.markDownloadedOnComplete && typeof window.CEXTBatchStorage.markBatchDownloaded === 'function') {
                        await window.CEXTBatchStorage.markBatchDownloaded(activeTask.meta.batchId);
                    }
                }
            } catch (error) {
                console.warn('[cext] 更新批次狀態失敗:', error);
            }
        }

        if (!success) {
            console.error('[cext] 下載暫存資料失敗:', detail?.message || 'unknown error');
        }

        try {
            await refreshPendingBatchesUI();
        } catch (error) {
            console.warn('[cext] 更新暫存批次列表失敗:', error);
        }
        flushDownloadQueue();
    }

    function ensureDownloadHelperFrame() {
        if (downloadHelperState.iframe && document.body.contains(downloadHelperState.iframe)) {
            downloadHelperState.contentWindow = downloadHelperState.iframe.contentWindow;
            return;
        }
        // 檢查 chrome.runtime 是否存在
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
            console.error('[cext] Chrome Extension API 不可用，無法建立 download helper');
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL('batchTest/download-helper.html');
        iframe.style.display = 'none';
        iframe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(iframe);
        downloadHelperState.iframe = iframe;
        downloadHelperState.contentWindow = iframe.contentWindow;
    }

    function ensureDownloadHelperReady() {
        if (downloadHelperState.ready && downloadHelperState.contentWindow) {
            return Promise.resolve();
        }
        ensureDownloadHelperFrame();
        return new Promise((resolve, reject) => {
            downloadHelperState.readyCallbacks.push({ resolve, reject });
            if (downloadHelperState.readyTimeoutId) {
                clearTimeout(downloadHelperState.readyTimeoutId);
            }
            downloadHelperState.readyTimeoutId = setTimeout(() => {
                const callbacks = downloadHelperState.readyCallbacks.splice(0);
                callbacks.forEach(cb => cb.reject(new Error('download helper not ready')));
                downloadHelperState.readyTimeoutId = null;
            }, 5000);
        });
    }

    function flushDownloadQueue() {
        if (!downloadHelperState.ready || !downloadHelperState.contentWindow) {
            return;
        }
        if (downloadHelperState.activeTask) {
            return;
        }
        const task = downloadHelperState.queue.shift();
        if (!task) {
            return;
        }
        downloadHelperState.activeTask = task;
        downloadHelperState.ready = false;
        try {
            downloadHelperState.contentWindow.postMessage({
                source: 'CEXT_PARENT',
                type: 'download-request',
                taskId: task.taskId,
                payload: task.payload
            }, '*');
        } catch (error) {
            console.error('[cext] 傳送下載任務至 helper 失敗:', error);
            downloadHelperState.activeTask = null;
            downloadHelperState.ready = true;
            flushDownloadQueue();
        }
    }

    function enqueueDownloadTask(task) {
        if (!task || !Array.isArray(task.results) || task.results.length === 0) {
            console.warn('[cext] 無下載資料，略過');
            return;
        }

        const payloadSource = {
            results: task.results,
            logs: Array.isArray(task.logs) ? task.logs : [],
            tenantName: task.tenantName || '',
            partial: !!task.partial
        };

        const payload = (() => {
            try {
                if (typeof structuredClone === 'function') {
                    return structuredClone(payloadSource);
                }
            } catch (error) {
                console.warn('[cext] structuredClone 失敗，改用 JSON 複製:', error);
            }
            try {
                return JSON.parse(JSON.stringify(payloadSource));
            } catch (error) {
                console.error('[cext] 複製下載資料失敗:', error);
                return null;
            }
        })();

        if (!payload) {
            return;
        }

        const taskId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `task_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

        downloadHelperState.queue.push({
            taskId,
            payload,
            meta: {
                batchId: task.batchId || null,
                purgeOnComplete: !!task.purgeOnComplete,
                markDownloadedOnComplete: !!task.markDownloadedOnComplete
            }
        });

        ensureDownloadHelperReady()
            .then(() => {
                downloadHelperState.ready = true;
                flushDownloadQueue();
            })
            .catch((error) => {
                console.error('[cext] 準備下載 helper 失敗:', error);
            });
    }

    function updateBatchSession(payload = {}, sourceWindow = null) {
        if (sourceWindow && batchSessionState.windowRef && sourceWindow !== batchSessionState.windowRef) {
            batchSessionState.windowRef = sourceWindow;
        } else if (!batchSessionState.windowRef && sourceWindow) {
            batchSessionState.windowRef = sourceWindow;
        }

        if (Array.isArray(payload.results)) {
            batchSessionState.results = payload.results;
        }
        // 只有在 logs 存在且非空時才更新，避免空陣列覆蓋現有的 logs
        if (Array.isArray(payload.logs) && payload.logs.length > 0) {
            batchSessionState.logs = payload.logs;
        } else if (Array.isArray(payload.logs) && payload.logs.length === 0 && batchSessionState.logs.length === 0) {
            // 如果兩邊都是空陣列，也允許更新（用於初始化）
            batchSessionState.logs = payload.logs;
        }
        if (payload.tenantName) {
            batchSessionState.tenantName = payload.tenantName;
        }
        if (typeof payload.totalQuestions === 'number') {
            batchSessionState.totalQuestions = payload.totalQuestions;
        }
        if (payload.batchId) {
            batchSessionState.batchId = payload.batchId;
        }
        batchSessionState.lastTimestamp = Date.now();
    }

    function startBatchWindowMonitor() {
        if (batchSessionState.checkIntervalId) {
            clearInterval(batchSessionState.checkIntervalId);
        }
        if (!batchSessionState.windowRef) {
            return;
        }
        batchSessionState.checkIntervalId = setInterval(() => {
            try {
                if (!batchSessionState.windowRef || batchSessionState.windowRef.closed) {
                    stopBatchWindowMonitor();
                    finalizeBatchSession({ reason: 'window-closed' }).catch((err) => {
                        console.error('[cext] 批次視窗關閉時下載失敗:', err);
                    });
                }
            } catch (error) {
                console.warn('[cext] 監控批次視窗時發生錯誤:', error);
                stopBatchWindowMonitor();
            }
        }, 1000);
    }

    function stopBatchWindowMonitor() {
        if (batchSessionState.checkIntervalId) {
            clearInterval(batchSessionState.checkIntervalId);
            batchSessionState.checkIntervalId = null;
        }
    }

    function resetBatchSessionState() {
        stopBatchWindowMonitor();
        batchSessionState.windowRef = null;
        batchSessionState.results = [];
        batchSessionState.logs = [];
        batchSessionState.tenantName = '';
        batchSessionState.totalQuestions = 0;
        batchSessionState.lastTimestamp = null;
        batchSessionState.isFinalizing = false;
        batchSessionState.batchId = null;
    }

    async function finalizeBatchSession({ reason } = {}) {
        if (batchSessionState.isFinalizing) {
            return;
        }
        batchSessionState.isFinalizing = true;
        try {
            const hasResults = Array.isArray(batchSessionState.results) && batchSessionState.results.length > 0;
            if (hasResults) {
                const payloadTenant = batchSessionState.tenantName || '';
                const batchIdForTask = batchSessionState.batchId || null;
                enqueueDownloadTask({
                    results: batchSessionState.results,
                    logs: batchSessionState.logs,
                    tenantName: payloadTenant,
                    partial: false,
                    batchId: batchIdForTask,
                    markDownloadedOnComplete: !!batchIdForTask,
                    downloadAsZip: false  // 預設只下載 Excel
                });
            } else {
                console.warn('[cext] 沒有批次結果可供下載，原因:', reason);
            }
        } finally {
            resetBatchSessionState();
        }
    }

    /* 處理來自子頁面的初始化請求 */
    function handleInitRequest(sourceWindow, source) {
        try {
            const domain = window.location.origin;
            if (sourceWindow && !sourceWindow.closed) {
                sourceWindow.postMessage({
                    source: 'CEXT_MAIN',
                    type: 'init-response',
                    domain: domain
                }, '*');
            }
        } catch (error) {
            console.warn('[cext] 回應初始化請求失敗:', error);
        }
    }

    /* 監聽 BroadcastChannel 的初始化請求 */
    let initBroadcastChannel = null;
    try {
        initBroadcastChannel = new BroadcastChannel('cext_init_channel');
        initBroadcastChannel.addEventListener('message', (e) => {
            const { source, type } = e.data || {};
            if ((source === 'CEXT_LOGS' || source === 'CEXT_BATCH') && type === 'request-init') {
                const domain = window.location.origin;
                /* 透過 BroadcastChannel 回應 */
                initBroadcastChannel.postMessage({
                    source: 'CEXT_MAIN',
                    type: 'init-response',
                    domain: domain
                });
            }
        });
    } catch (error) {
        console.warn('[cext] BroadcastChannel 不可用:', error);
    }

    window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        /* 處理來自子頁面的初始化請求 */
        if (data.source === 'CEXT_LOGS' && data.type === 'request-init') {
            handleInitRequest(event.source, 'CEXT_LOGS');
            return;
        }

        if (data.source === 'CEXT_BATCH' && data.type === 'request-init') {
            handleInitRequest(event.source, 'CEXT_BATCH');
            return;
        }

        if (data.source === 'CEXT_DOWNLOAD_HELPER') {
            if (data.type === 'ready') {
                downloadHelperState.contentWindow = event.source || downloadHelperState.iframe?.contentWindow || null;
                downloadHelperState.ready = true;
                if (downloadHelperState.readyTimeoutId) {
                    clearTimeout(downloadHelperState.readyTimeoutId);
                    downloadHelperState.readyTimeoutId = null;
                }
                if (downloadHelperState.readyCallbacks.length > 0) {
                    const callbacks = downloadHelperState.readyCallbacks.splice(0);
                    callbacks.forEach(cb => cb.resolve());
                }
                flushDownloadQueue();
            } else if (data.type === 'completed') {
                await handleDownloadTaskCompletion(true, data);
            } else if (data.type === 'error') {
                if (downloadHelperState.readyTimeoutId) {
                    clearTimeout(downloadHelperState.readyTimeoutId);
                    downloadHelperState.readyTimeoutId = null;
                }
                if (downloadHelperState.readyCallbacks.length > 0) {
                    const callbacks = downloadHelperState.readyCallbacks.splice(0);
                    callbacks.forEach(cb => cb.reject(new Error(data.message || 'download helper error')));
                }
                await handleDownloadTaskCompletion(false, data);
            }
            return;
        }

        if (data.source !== 'CEXT_BATCH') return;

        const { type, payload = {} } = data;
        if (!type) return;

        let shouldRefreshPending = false;

        switch (type) {
            case 'batch-start':
                updateBatchSession(payload, event.source);
                shouldRefreshPending = true;
                break;
            case 'batch-progress':
                updateBatchSession(payload, event.source);
                shouldRefreshPending = true;
                break;
            case 'batch-instant-download':
                updateBatchSession(payload, event.source);
                enqueueDownloadTask({
                    results: batchSessionState.results,
                    logs: batchSessionState.logs,
                    tenantName: batchSessionState.tenantName,
                    partial: true,
                    batchId: batchSessionState.batchId || payload.batchId || null,
                    purgeOnComplete: false
                });
                shouldRefreshPending = true;
                break;
            case 'batch-complete':
                updateBatchSession(payload, event.source);
                finalizeBatchSession({ reason: 'complete' }).catch((err) => {
                    console.error('[cext] 完成批次但下載失敗:', err);
                });
                shouldRefreshPending = true;
                break;
            case 'batch-error':
                updateBatchSession(payload, event.source);
                finalizeBatchSession({ reason: 'error' }).catch((err) => {
                    console.error('[cext] 批次錯誤時下載失敗:', err);
                });
                shouldRefreshPending = true;
                break;
            case 'batch-window-closed':
                updateBatchSession(payload, event.source);
                finalizeBatchSession({ reason: 'window-closed' }).catch((err) => {
                    console.error('[cext] 視窗關閉時下載失敗:', err);
                });
                shouldRefreshPending = true;
                break;
            case 'batch-finished':
                updateBatchSession(payload, event.source);
                shouldRefreshPending = true;
                break;
            default:
                break;
        }

        if (shouldRefreshPending) {
            refreshPendingBatchesUI().catch(() => { });
        }
    });

    /* 這個頁面的 Session 標識 */
    const SESSION_KEY = "cext_session_id";
    let SESSION_ID = sessionStorage.getItem(SESSION_KEY);
    if (!SESSION_ID) {
        SESSION_ID = crypto.randomUUID();
        sessionStorage.setItem(SESSION_KEY, SESSION_ID);
    }

    /* URL 規則 */
    function isWisePage() {
        const href = window.location.href.toLowerCase();
        return href.includes("wise");
    }

    /* 檢查是否為登入頁面 */
    function isLoginPage() {
        const href = window.location.href.toLowerCase();
        const pathname = window.location.pathname.toLowerCase();
        // 嚴格檢查：路徑必須以 /login 結尾，或包含 /s/login 或 /wise/wiseadm/s/login 或 /wise/wiseadm/s/subadmin/.../login
        return pathname.endsWith('/login') ||
            pathname.includes('/s/login') ||
            pathname.includes('/wise/wiseadm/s/login') ||
            /\/wise\/wiseadm\/s\/subadmin\/[^\/]+\/login$/.test(pathname);
    }

    /* 檢查 groovyCaller 是否可用 */
    async function checkGroovyCallerAvailable() {
        try {
            // 確保 groovyCaller 函數存在
            if (typeof groovyCaller === 'undefined') {
                console.log("[cext] groovyCaller 函數未定義");
                return false;
            }

            // 確保 CEXT 和 domain 已初始化
            if (!N.getDomain()) {
                N.setDomain(window.location.origin);
            }

            // 使用 groovyCaller 測試一個簡單的腳本，返回 true
            const testScript = 'return true';
            const result = await groovyCaller(testScript);

            // 檢查結果是否為 true（可能是布林值、字串 "true" 或物件）
            if (result === true || result === 'true' ||
                (typeof result === 'object' && result !== null &&
                    (result.result === true || result.result === 'true'))) {
                return true;
            }
            // 如果結果不是 false 或 null，也認為可用（表示 API 可以正常回應）
            if (result !== false && result !== null && result !== undefined) {
                return true;
            }
            return false;
        } catch (err) {
            console.log("[cext] groovyCaller 檢查失敗:", err.message || err);
            return false;
        }
    }

    /* 初始化 */
    (async () => {
        // 面板在 wise 頁面或 login 頁面都可以顯示
        if (!isWisePage() && !isLoginPage()) {
            console.log("當前 URL 不符合條件，面板不顯示!");
            return;
        }

        /* 檢查是否為登入頁面（提前檢查，避免在登入頁面執行不必要的服務檢查） */
        const isLogin = isLoginPage();

        /* 檢查 Flask 服務狀態（登入頁面不需要，直接跳過以提升載入速度） */
        let flaskAvailable = false;
        if (!isLogin) {
            try {
                console.log("[cext] 開始檢查 Flask 服務...");
                await N.ensureServerAndSyncUUID();
                flaskAvailable = true;
                console.log("[cext] Flask 服務可用!");
                /* 再抓一次清單（只打一次 /getProjectList） */
                await N.bootstrapProjects();
            } catch (err) {
                if (err?.isCorsError) {
                    console.warn("[cext] Flask 服務 CORS 錯誤:", err.message);
                    console.warn("[cext] 解決方案：請在 Flask 服務端添加 CORS 支援");
                } else {
                    console.log("[cext] Flask server 未啟動或無法連接，部分功能將被隱藏!", err.message || err);
                }
            }
        } else {
            console.log("[cext] 登入頁面，跳過 Flask 服務檢查以提升載入速度");
        }

        /* 檢查 groovyCaller 是否可用（登入頁面不需要，直接跳過以提升載入速度） */
        let groovyCallerAvailable = false;
        if (!isLogin) {
            try {
                console.log("[cext] 開始檢查 groovyCaller...");
                groovyCallerAvailable = await checkGroovyCallerAvailable();
                if (groovyCallerAvailable) {
                    console.log("[cext] groovyCaller 可用!");
                } else {
                    console.log("[cext] groovyCaller 不可用，Logs 和 BatchTest 按鈕將被隱藏");
                }
            } catch (err) {
                console.log("[cext] groovyCaller 檢查失敗:", err.message || err);
            }
        } else {
            console.log("[cext] 登入頁面，跳過 groovyCaller 檢查以提升載入速度");
        }

        /* 檢查 autoLogin 是否在登入頁面可用 */
        let autoLoginUrlAvailable = false;
        if (typeof N.checkAutoLoginUrlAvailable === 'function') {
            autoLoginUrlAvailable = await N.checkAutoLoginUrlAvailable(isLogin);
        } else {
            console.warn("[cext] autologin 模組未載入，N.checkAutoLoginUrlAvailable 不存在");
        }

        /* 從源頭判斷按鈕可用性（在載入面板之前） */
        const buttonStates = {
            // Flask 功能按鈕只在 Flask 可用且非登入頁面時顯示
            publish: flaskAvailable && !isLogin,
            toggle: flaskAvailable && !isLogin,
            pass: flaskAvailable && !isLogin,
            deploy: flaskAvailable && !isLogin,
            synchronous: flaskAvailable && !isLogin,
            submit: flaskAvailable && !isLogin,
            // Logs 和 BatchTest 只在 groovyCaller 可用且非登入頁面時顯示
            logs: groovyCallerAvailable && !isLogin,
            batchTest: groovyCallerAvailable && !isLogin,
            // AutoLogin 在所有 login 頁面都顯示（用戶可以手動輸入或透過管理介面新增憑證）
            autoLogin: isLogin && autoLoginUrlAvailable
        };

        /* 檢查是否有任何按鈕可用，如果沒有則不載入面板 */
        const hasAnyVisibleButton = Object.values(buttonStates).some(state => state === true);

        if (!hasAnyVisibleButton) {
            console.log("[cext] 所有按鈕都不可用，不載入面板");
            console.log("[cext] 按鈕狀態:", buttonStates);
            return;
        }

        console.log("[cext] 按鈕狀態:", buttonStates);

        /* 建立面板（根據 Flask 狀態決定要載入的內容） */
        let panel, refs;
        try {
            const r = await N.ensurePanelLoaded(flaskAvailable);
            panel = r.panel;
            refs = r.refs;
        } catch (err) {
            console.error("[cext] 載入面板失敗:", err);
            return;
        }

        /* 初始化 AutoLogin 管理功能 */
        if (typeof N.initAutoLoginManager === 'function') {
            N.initAutoLoginManager(panel);
        }

        /* 設置按鈕顯示狀態 */
        const flaskFeaturesDiv = panel.querySelector("#cext-flask-features");
        const publishBtn = panel.querySelector('button[data-action="publish"]');
        const toggleBtn = panel.querySelector('button[data-action="toggle"]');
        const passBtn = panel.querySelector('button[data-action="pass"]');
        const deployBtn = panel.querySelector('button[data-action="deploy"]');
        const submitBtn = panel.querySelector('#cext-submit');
        const logsBtn = panel.querySelector('button[data-action="logs"]');
        const batchTestBtn = panel.querySelector('button[data-action="batch-test"]');
        const autoLoginBtn = panel.querySelector('button[data-action="auto-login"]');
        const autoLoginFeaturesDiv = panel.querySelector("#cext-auto-login-features");

        // 設置 Flask 功能按鈕顯示
        if (flaskFeaturesDiv) {
            flaskFeaturesDiv.style.display = buttonStates.publish ? '' : 'none';
        }
        if (publishBtn) publishBtn.style.display = buttonStates.publish ? '' : 'none';
        if (toggleBtn) toggleBtn.style.display = buttonStates.toggle ? '' : 'none';
        if (passBtn) passBtn.style.display = buttonStates.pass ? '' : 'none';
        if (deployBtn) deployBtn.style.display = buttonStates.deploy ? '' : 'none';
        if (submitBtn) submitBtn.style.display = buttonStates.submit ? '' : 'none';

        // 設置 Groovy 功能按鈕顯示
        if (logsBtn) logsBtn.style.display = buttonStates.logs ? '' : 'none';
        if (batchTestBtn) batchTestBtn.style.display = buttonStates.batchTest ? '' : 'none';

        // 設置 AutoLogin 功能區塊顯示
        if (autoLoginFeaturesDiv) {
            autoLoginFeaturesDiv.style.display = buttonStates.autoLogin ? '' : 'none';
        }

        /* 解構面板元素 */
        const {
            selectArea,
            select,
            collapseHandle,
            handle,
            edgeHandle,
            pendingSection,
            pendingList
        } = refs;

        setupPendingDownloadsUI(refs);
        ensureBatchStorageLoaded()
            .then(() => refreshPendingBatchesUI())
            .catch((error) => {
                console.warn('[cext] 無法初始化批次儲存:', error);
            });

        /* 轉場 */
        const TRANSITION_MS = 220;
        const setTransition = (on) => {
            panel.style.transition = on
                ? `right ${TRANSITION_MS}ms ease, top ${TRANSITION_MS}ms ease, left ${TRANSITION_MS}ms ease`
                : "none";
        };

        /* 位置/收合 */
        function collapsePanel(toCollapse, state = {}) {
            const isDefaultPos = state.panelX === 0 && state.panelY === 0;

            if (toCollapse) {
                panel.style.left = "auto";
                panel.style.top = "6px";
                panel.style.right = "-220px";
                edgeHandle.style.display = "block";
            } else {
                if (isDefaultPos) {
                    panel.style.left = "auto";
                    panel.style.top = "6px";
                    panel.style.right = "6px";
                } else {
                    panel.style.right = "auto";
                    panel.style.left = state.panelX + "px";
                    panel.style.top = state.panelY + "px";
                }
                edgeHandle.style.display = "none";
            }
        }

        /* 收合/展開：由 storage 觸發真正動畫 */
        async function toggleCollapse() {
            const s = await N.loadState();
            const nextCollapsed = !s.collapsed;
            const nextOp = nextCollapsed ? "collapse" : "expand";
            const nextPanelX = nextCollapsed ? s.panelX : 0;
            const nextPanelY = nextCollapsed ? s.panelY : 0;

            await N.saveState({
                collapsed: nextCollapsed,
                panelX: nextPanelX,
                panelY: nextPanelY,
                lastOp: nextOp,
                lastActor: SESSION_ID,
                lastTs: Date.now(),
                lastAction: s.lastAction ?? null
            });
        }

        /* 處理 publish、toggle、logs、batch-test 和 auto-login，其餘交給 actions 模組 */
        panel.addEventListener("click", async (e) => {
            /* 確保點擊事件只在 panel 內部元素上處理，不影響頁面其他元素 */
            if (!panel.contains(e.target)) {
                return;
            }

            const publishBtn = e.target.closest('button[data-action="publish"]');
            const toggleBtn = e.target.closest('button[data-action="toggle"]');
            const logsBtn = e.target.closest('button[data-action="logs"]');
            const batchTestBtn = e.target.closest('button[data-action="batch-test"]');
            const autoLoginBtn = e.target.closest('button[data-action="auto-login"]');
            const autoLoginToggleBtn = e.target.closest('button[data-action="auto-login-toggle"]');
            // 管理帳號相關按鈕由 autoLogin-manager.js 處理，不在這裡處理
            const manageToggleBtn = e.target.closest('button[data-action="auto-login-manage-toggle"]');
            const manageAddBtn = e.target.closest('button[data-action="auto-login-manage-add"]');
            const manageImportBtn = e.target.closest('button[data-action="auto-login-manage-import-json"]');
            const manageExportBtn = e.target.closest('button[data-action="auto-login-manage-export"]');
            const manageClearBtn = e.target.closest('button[data-action="auto-login-manage-clear"]');
            const manageDeleteBtn = e.target.closest('button[data-action="auto-login-manage-delete"]');

            // 如果是管理帳號相關按鈕，不處理（交給 autoLogin-manager.js 在 capture 階段處理）
            if (manageToggleBtn || manageAddBtn || manageImportBtn || manageExportBtn || manageClearBtn || manageDeleteBtn) {
                return;
            }

            if (toggleBtn) {
                /* 阻止後續委派（避免 N.bindActions 也吃到） */
                e.stopImmediatePropagation();

                const tabArea = panel.querySelector('.cext-tab-area');
                if (tabArea) {
                    const isVisible = tabArea.style.display !== 'none';
                    if (isVisible) {
                        tabArea.style.display = 'none';
                    } else {
                        tabArea.style.display = 'block';
                    }
                }
            } else if (autoLoginToggleBtn) {
                /* 阻止後續委派 */
                e.stopImmediatePropagation();

                const autoLoginArea = panel.querySelector('.cext-auto-login-area');
                if (autoLoginArea) {
                    const isVisible = autoLoginArea.style.display !== 'none';
                    if (isVisible) {
                        autoLoginArea.style.display = 'none';
                    } else {
                        autoLoginArea.style.display = 'block';
                    }
                }
            } else if (publishBtn) {
                /* 阻止後續委派（避免 N.bindActions 也吃到） */
                e.stopImmediatePropagation();

                /* 立即恢復按鈕狀態，不等待回應 */
                publishBtn.disabled = true;
                publishBtn.textContent = "上傳中...";

                /* 非同步發送，不等待回應 */
                N.apiFetch("/publish").then(res => {
                    console.log("[cext] /publish 結果:", res);
                }).catch(err => {
                    console.error(err);
                    /* 不顯示錯誤提示，因為用戶已經繼續操作了 */
                }).finally(() => {
                    publishBtn.disabled = false;
                    publishBtn.textContent = "外掛上傳";
                });
            } else if (logsBtn) {
                /* 阻止後續委派（避免 N.bindActions 也吃到） */
                e.stopImmediatePropagation();

                try {
                    logsBtn.disabled = true;
                    logsBtn.textContent = "開啟中...";

                    /* 獲取 domain */
                    const getDomain = () => {
                        return window.location.origin;
                    };

                    /* 開啟日誌視窗 */
                    // 檢查 chrome.runtime 是否存在
                    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
                        throw new Error('Chrome Extension API 不可用，無法開啟 Logs 視窗');
                    }
                    const url = chrome.runtime.getURL("logs/logs.html");
                    const logWin = window.open(url);

                    /* 等待新視窗載入完成後傳遞 domain */
                    if (logWin) {
                        const checkLoaded = () => {
                            try {
                                logWin.postMessage({
                                    type: 'init',
                                    domain: getDomain()
                                }, "*");
                            } catch (e) {
                                /* 如果視窗還沒載入完成，稍後再試 */
                                setTimeout(checkLoaded, 100);
                            }
                        };
                        setTimeout(checkLoaded, 500);
                    }
                } catch (err) {
                    console.error(err);
                    alert("開啟日誌視窗失敗: " + (err?.message || err));
                } finally {
                    logsBtn.disabled = false;
                    logsBtn.textContent = "即時日誌";
                }
            } else if (batchTestBtn) {
                /* 阻止後續委派（避免 N.bindActions 也吃到） */
                e.stopImmediatePropagation();

                try {
                    batchTestBtn.disabled = true;
                    batchTestBtn.textContent = "開啟中...";

                    /* 獲取 domain */
                    const getDomain = () => {
                        return window.location.origin;
                    };

                    /* 開啟 BatchTest 視窗 */
                    // 檢查 chrome.runtime 是否存在
                    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
                        throw new Error('Chrome Extension API 不可用，無法開啟 BatchTest 視窗');
                    }
                    const url = chrome.runtime.getURL("batchTest/batchTest.html");
                    const batchWin = window.open(url);

                    /* 等待新視窗載入完成後傳遞 domain 和當前 URL */
                    if (batchWin) {
                        resetBatchSessionState();
                        batchSessionState.windowRef = batchWin;
                        batchSessionState.lastTimestamp = Date.now();
                        startBatchWindowMonitor();
                        ensureDownloadHelperReady().catch((err) => {
                            console.warn('[cext] 預備下載 helper 失敗:', err);
                        });

                        const checkLoaded = () => {
                            try {
                                batchWin.postMessage({
                                    type: 'init',
                                    domain: getDomain(),
                                    parentUrl: window.location.href
                                }, "*");
                            } catch (e) {
                                /* 如果視窗還沒載入完成，稍後再試 */
                                setTimeout(checkLoaded, 100);
                            }
                        };
                        setTimeout(checkLoaded, 500);
                    }
                } catch (err) {
                    console.error(err);
                    alert("開啟 BatchTest 視窗失敗: " + (err?.message || err));
                } finally {
                    batchTestBtn.disabled = false;
                    batchTestBtn.textContent = "批次測試";
                }
            } else if (autoLoginBtn) {
                /* 阻止後續委派（避免 N.bindActions 也吃到） */
                e.stopImmediatePropagation();
                /* 調用 autologin 模組處理 */
                if (typeof N.handleAutoLogin === 'function') {
                    await N.handleAutoLogin(autoLoginBtn);
                } else {
                    console.error("[cext] autologin 模組未載入，N.handleAutoLogin 不存在");
                    alert("自動登入功能未載入，請重新載入擴充功能");
                }
            }
        });

        /* 收合控制 */
        collapseHandle.addEventListener("click", toggleCollapse);
        edgeHandle.addEventListener("click", toggleCollapse);

        /* 初始化拖曳功能（已抽到 cext.drag.js） */
        N.initDrag({
            panel,
            handle,
            getSessionId: () => SESSION_ID
        });

        /* 綁定動作（pass/deploy + submit → 抽到 cext.actions.js） */
        N.bindActions({
            panel,
            refs,
            getSessionId: () => SESSION_ID
        });

        /* 狀態套用 */
        function applyState(state) {
            const recent = Date.now() - (state.lastTs || 0) < 1500;
            const isSelf = recent && state.lastActor === SESSION_ID;

            let animate = false;
            let layoutState = state;

            if (isSelf) {
                if (state.lastOp === "collapse") {
                    animate = state.panelX === 0 && state.panelY === 0;
                } else if (state.lastOp === "expand") {
                    animate = true;
                    layoutState = { ...state, panelX: 0, panelY: 0 };
                } else {
                    animate = false;
                }
            } else {
                animate = false;
                if (state.lastOp === "expand" && !state.collapsed && recent) {
                    layoutState = { ...state, panelX: 0, panelY: 0 };
                } else {
                    layoutState = state;
                }
            }

            setTransition(animate);
            collapsePanel(state.collapsed, layoutState);
            if (animate) {
                setTimeout(() => setTransition(false), TRANSITION_MS + 50);
            } else {
                setTransition(false);
            }

            N.restoreActionUI({ panel, refs, action: state.lastAction });
        }

        /* 初始狀態 & 第一次渲染（避免重複 render options） */
        const initState = await N.loadState();
        applyState(initState);

        /* 跨分頁同步 */
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes[STORAGE_KEY]) {
                const next = changes[STORAGE_KEY].newValue;
                applyState(next);

                const prev = changes[STORAGE_KEY].oldValue || {};
                const listChanged =
                    JSON.stringify(prev.projectList || []) !== JSON.stringify(next.projectList || []);
                if (listChanged && selectArea.style.display !== "none") {
                    (async () => {
                        await N.renderProjectOptions({ select });
                    })();
                }
            }
        });
    })();
})();