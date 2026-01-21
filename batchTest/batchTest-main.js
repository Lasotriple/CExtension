/* 初始化 */
async function init() {
    try {
        /* 等待 domain 初始化 */
        if (!CEXT.getDomain()) {
            showFeedback('等待 Domain 初始化...', 'info');
            return;
        }

        /* 判斷 API 類型 */
        const apiType = getApiType();

        /* 如果是 kms 或 genai，直接顯示 UI，不需要 getTenantApi */
        if (apiType === 'kms' || apiType === 'genai') {
            /* 隱藏渠道選擇器 */
            const channelSelectContainer = channelSelectEl.parentElement;
            if (channelSelectContainer) {
                channelSelectContainer.style.display = 'none';
            }

            /* 啟用表格編輯 */
            const tableBodyEl = document.getElementById('batch-table-body');
            if (tableBodyEl) {
                const cells = tableBodyEl.querySelectorAll('td[contenteditable]');
                cells.forEach(cell => {
                    cell.contentEditable = 'true';
                });
            }

            /* 隱藏 loading 並顯示內容區域（漂浮進入動畫） */
            hideLoadingAndShowContent();

            /* 測試 getAOAI 並啟用比對答案按鈕 */
            testAOAIAndEnableButton();
            return;
        }
        const groovyScript = getTenantApi();

        /* 呼叫 groovyCaller */
        const result = await groovyCaller(groovyScript);

        /* 檢查結果是否有效 */

        if (!result) {
            throw new Error('Groovy 呼叫返回空值');
        }

        /* 從統一格式 {apikeys: [...]} 中取得陣列 */
        let resultArray = [];
        if (result && typeof result === 'object') {
            /* 從統一格式中取得 apikeys */
            resultArray = result.apikeys || [];
            /* 確保是陣列 */
            if (!Array.isArray(resultArray)) {
                resultArray = [];
            }
        } else {
            throw new Error(`結果格式錯誤，期望物件但收到: ${typeof result}`);
        }

        /* 處理結果成 channellist（類似 Python 的列表推導式） */
        channelList = resultArray
            .filter(item => item && item.enableApikey)
            .map(item => `${item.name || '未知'} (${item.apikey || 'default'})`);

        /* 更新下拉選單 */
        channelSelectEl.innerHTML = '<option value="">請選擇</option>';
        channelList.forEach((channel, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = channel;
            channelSelectEl.appendChild(option);
        });

        /* 啟用渠道選擇器（textarea 和送出按鈕仍保持禁用，等待選擇渠道） */
        channelSelectEl.disabled = false;

        /* 隱藏 loading 並顯示內容區域（漂浮進入動畫） */
        hideLoadingAndShowContent();

        /* 3秒後隱藏成功訊息 */
        hideFeedbackTimeoutId = setTimeout(() => {
            hideFeedback();
        }, 3000);

        /* 測試 getAOAI 並啟用比對答案按鈕 */
        testAOAIAndEnableButton();

        /* 載入歷史紀錄和即時批次列表 */
        if (typeof refreshPendingBatchSnapshots === 'function') {
            refreshPendingBatchSnapshots();
        }
        if (typeof refreshDownloadHistory === 'function') {
            refreshDownloadHistory();
        }

    } catch (error) {
        /* 錯誤時也要隱藏 loading */
        hideLoadingAndShowContent();
        showFeedback(`錯誤: ${error.message}`, 'error');
    }
}

/* 測試 getAOAI 並啟用比對答案按鈕 */
async function testAOAIAndEnableButton() {
    try {
        if (typeof getAOAI === 'undefined' || typeof groovyCaller === 'undefined') {
            // 設置 API 禁用標記
            if (compareAnswerBtn) {
                compareAnswerBtn.setAttribute('data-api-disabled', 'true');
                if (typeof checkFormValidity === 'function') {
                    checkFormValidity();
                }
            }
            return;
        }
        if (typeof compareAnswerBtn === 'undefined' || !compareAnswerBtn) {
            return;
        }
        if (!CEXT.getDomain()) {
            // 設置 API 禁用標記
            compareAnswerBtn.setAttribute('data-api-disabled', 'true');
            if (typeof checkFormValidity === 'function') {
                checkFormValidity();
            }
            return;
        }
        const testScript = getAOAI("gpt-4o", "你好", {});
        const result = await groovyCaller(testScript);

        // 檢查是否為錯誤對象
        if (result && typeof result === 'object' && result._classname && result.message) {
            console.warn('getAOAI 測試失敗:', result.message);
            // 設置 API 禁用標記
            compareAnswerBtn.setAttribute('data-api-disabled', 'true');
            if (typeof checkFormValidity === 'function') {
                checkFormValidity();
            }
            return;
        }

        if (result && (typeof result === 'string' || typeof result === 'object')) {
            // 移除 API 禁用標記
            compareAnswerBtn.removeAttribute('data-api-disabled');
            // 觸發表單驗證以更新按鈕狀態（會考慮渠道選擇）
            if (typeof checkFormValidity === 'function') {
                checkFormValidity();
            } else {
                // 如果 checkFormValidity 不存在，直接啟用（KMS 模式）
                compareAnswerBtn.disabled = false;
            }
            /* removed debug log */

            // 解析 JSON 並取得 answer 字串內容
            let answerText = '';
            try {
                if (typeof result === 'string') {
                    const parsed = JSON.parse(result);
                    answerText = parsed.answer || result;
                } else if (result.answer) {
                    answerText = result.answer;
                } else {
                    answerText = result;
                }
            } catch (e) {
                answerText = result;
            }
            /* removed debug log */
        }
    } catch (error) {
        console.warn('getAOAI 測試失敗:', error);
        // 設置 API 禁用標記
        if (compareAnswerBtn) {
            compareAnswerBtn.setAttribute('data-api-disabled', 'true');
            if (typeof checkFormValidity === 'function') {
                checkFormValidity();
            }
        }
    }
}

/* 隱藏 loading 畫面並顯示內容區域（帶動畫） */
function hideLoadingAndShowContent() {
    const loadingScreen = document.getElementById('batch-loading-screen');
    if (loadingScreen) {
        /* 隱藏 loading 畫面 */
        loadingScreen.classList.add('hidden');

        /* 顯示內容區域 */
        contentEl.style.display = 'flex';

        /* 觸發漂浮進入動畫 */
        setTimeout(() => {
            contentEl.classList.add('visible');
        }, 100);
    }
}

/* 記錄上一次的訊息類型和內容，避免不必要的更新 */
let lastFeedbackType = null;
let lastFeedbackMessage = null;
/* 顯示反饋訊息 */
function showFeedback(message, type = 'info', preserveDetails = false) {
    if (!feedbackAreaEl || !feedbackTextEl) return;

    if (hideFeedbackTimeoutId) {
        clearTimeout(hideFeedbackTimeoutId);
        hideFeedbackTimeoutId = null;
    }

    /* 如果訊息和類型都相同，且元素已顯示，則跳過更新，避免閃爍 */
    if (lastFeedbackType === type && lastFeedbackMessage === message &&
        feedbackAreaEl.style.display !== 'none') {
        return;
    }

    if (typeof formFeedbackWrapperEl !== 'undefined' && formFeedbackWrapperEl) {
        formFeedbackWrapperEl.classList.add('with-feedback');
    }

    /* 只在元素隱藏時才設置 display，避免不必要的重排 */
    if (feedbackAreaEl.style.display === 'none' || feedbackAreaEl.style.display === '') {
        feedbackAreaEl.style.display = 'flex';
    }

    /* 更新文字內容 */
    if (feedbackTextEl.textContent !== message) {
        feedbackTextEl.textContent = message;
    }

    /* 檢查當前類型，只在類型改變時才更新樣式，避免閃爍 */
    const typeClass = `feedback-${type}`;
    if (!feedbackAreaEl.classList.contains(typeClass)) {
        /* 取得當前已有的類型類 */
        const currentTypeClasses = ['feedback-info', 'feedback-success', 'feedback-error'].filter(cls =>
            feedbackAreaEl.classList.contains(cls)
        );

        /* 如果有現有的類型類，才移除它們 */
        if (currentTypeClasses.length > 0) {
            feedbackAreaEl.classList.remove(...currentTypeClasses);
        }

        /* 添加新類型類 */
        feedbackAreaEl.classList.add(typeClass);
    }

    /* 清空詳細訊息（只在非處理中時，且不保留詳情時） */
    if (type !== 'info' && !preserveDetails && feedbackDetailsEl) {
        feedbackDetailsEl.innerHTML = '';
    }

    /* 記錄當前的類型和訊息 */
    lastFeedbackType = type;
    lastFeedbackMessage = message;
}

/* 隱藏反饋訊息 */
function hideFeedback() {
    if (feedbackAreaEl) {
        feedbackAreaEl.style.display = 'none';
    }
    if (typeof formFeedbackWrapperEl !== 'undefined' && formFeedbackWrapperEl) {
        formFeedbackWrapperEl.classList.remove('with-feedback');
    }
    hideFeedbackTimeoutId = null;
    /* 重置記錄，確保下次顯示時正常更新 */
    lastFeedbackType = null;
    lastFeedbackMessage = null;
}

function formatPendingTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function parseIsoDate(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function formatDurationLabel(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        return '';
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveHistoryTimes(batch) {
    if (!batch) {
        return { firstIso: null, lastIso: null };
    }
    const firstIso = batch.firstSentAt || batch.createdAt || null;
    const lastIso = batch.lastValidReceivedAt || batch.lastResponseAt || batch.updatedAt || batch.createdAt || null;
    return { firstIso, lastIso };
}

function computeHistoryDuration(batch) {
    if (!batch) {
        return null;
    }
    if (Number.isFinite(batch.durationMs)) {
        return batch.durationMs;
    }
    const { firstIso, lastIso } = resolveHistoryTimes(batch);
    const firstDate = parseIsoDate(firstIso);
    const lastDate = parseIsoDate(lastIso);
    if (firstDate && lastDate) {
        return Math.max(0, lastDate.getTime() - firstDate.getTime());
    }
    return null;
}

function composeHistoryTitle(batch) {
    const tenantName = batch?.tenantName || '未知租戶';
    const completedCount = Number.isFinite(batch?.completedCount) ? batch.completedCount : 0;
    const totalQuestions = Number.isFinite(batch?.totalQuestions) ? batch.totalQuestions : 0;
    return `${tenantName} - 測試句數(${completedCount}/${totalQuestions})`;
}

function composeHistorySubtitle(batch) {
    const { firstIso, lastIso } = resolveHistoryTimes(batch || {});
    const firstLabel = formatPendingTime(firstIso);
    const lastLabel = formatPendingTime(lastIso);
    let rangeText = '';
    if (firstLabel && lastLabel) {
        rangeText = `${firstLabel} - ${lastLabel}`;
    } else if (firstLabel) {
        rangeText = firstLabel;
    } else if (lastLabel) {
        rangeText = lastLabel;
    }
    const durationLabel = formatDurationLabel(computeHistoryDuration(batch || null));
    const statusText = getHistoryStatusText(batch);

    const parts = [];
    if (rangeText) {
        parts.push(rangeText);
    }
    if (durationLabel) {
        parts.push(`(耗時 ${durationLabel})`);
    }
    parts.push(statusText);

    return parts.filter(Boolean).join(' ');
}

function getHistoryStatusText(batch) {
    const completedCount = Number.isFinite(batch?.completedCount) ? batch.completedCount : 0;
    const totalQuestions = Number.isFinite(batch?.totalQuestions) ? batch.totalQuestions : 0;
    // 直接比較兩個數字是否對得上，不依賴 status 欄位
    if (totalQuestions > 0 && completedCount === totalQuestions) {
        return '測試完成';
    }
    return '測試中斷';
}

async function refreshPendingBatchSnapshots() {
    if (!instantListEl || !instantEmptyEl) return;
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.listBatches !== 'function') {
        instantListEl.innerHTML = '';
        instantListEl.style.display = 'none';
        instantEmptyEl.style.display = 'block';
        instantEmptyEl.textContent = '目前沒有執行中的測試';
        return;
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        const batchesRaw = await CEXTBatchStorage.listBatches({ includeDownloaded: false });
        const batches = Array.isArray(batchesRaw)
            ? batchesRaw.filter(batch => batch && batch.status === 'in_progress')
            : [];
        if (batches.length === 0) {
            instantListEl.innerHTML = '';
            instantListEl.style.display = 'none';
            instantEmptyEl.style.display = 'block';
            instantEmptyEl.textContent = '目前沒有執行中的測試';
            return;
        }

        instantEmptyEl.style.display = 'none';
        instantListEl.style.display = 'block';

        // 獲取現有的 wrapper 元素，按 batchId 索引
        const existingWrappers = {};
        Array.from(instantListEl.children).forEach(wrapper => {
            const batchId = wrapper.dataset.batchId;
            if (batchId) {
                existingWrappers[batchId] = wrapper;
            }
        });

        // 獲取所有現有的 batchId
        const existingBatchIds = new Set(Object.keys(existingWrappers));
        const currentBatchIds = new Set(batches.map(b => b.batchId));

        // 移除不再存在的批次
        existingBatchIds.forEach(batchId => {
            if (!currentBatchIds.has(batchId) && existingWrappers[batchId]) {
                existingWrappers[batchId].remove();
            }
        });

        // 更新或創建批次項目
        batches.forEach((batch) => {
            let wrapper = existingWrappers[batch.batchId];
            let item;

            if (wrapper) {
                // 如果 wrapper 已存在，只更新內容（保持動畫連續）
                item = wrapper.querySelector('.batch-history-item-current');
                if (!item) {
                    item = document.createElement('div');
                    item.className = 'batch-history-item batch-history-item-current';
                    wrapper.appendChild(item);
                }
            } else {
                // 如果 wrapper 不存在，創建新的（包含動畫層）
                wrapper = document.createElement('div');
                wrapper.className = 'batch-history-item-wrapper-testing';
                wrapper.dataset.batchId = batch.batchId;

                item = document.createElement('div');
                item.className = 'batch-history-item batch-history-item-current';
                wrapper.appendChild(item);

                instantListEl.appendChild(wrapper);
            }

            // 更新內容（只更新文本，不重新創建元素）
            let metaLine = item.querySelector('.batch-history-meta');
            if (!metaLine) {
                metaLine = document.createElement('div');
                metaLine.className = 'batch-history-meta';
                if (item.firstChild) {
                    item.insertBefore(metaLine, item.firstChild);
                } else {
                    item.appendChild(metaLine);
                }
            }

            // 取得當前環境的租戶名稱（去除前後空格並正規化）
            let currentTenantName = '';
            if (typeof CEXT !== 'undefined' && typeof CEXT.getTenantName === 'function') {
                const tenant = CEXT.getTenantName();
                currentTenantName = (tenant != null ? String(tenant) : '').trim();
            } else if (window.tenantName) {
                currentTenantName = String(window.tenantName).trim();
            }
            const batchTenantName = (batch?.tenantName != null ? String(batch.tenantName) : '').trim();

            // 設置標題文字
            const titleText = `${batchTenantName || '未知租戶'} · ${batch.completedCount || 0}/${batch.totalQuestions || 0}`;
            
            metaLine.textContent = titleText;

            let subLine = item.querySelector('.batch-history-meta-sub');
            if (!subLine) {
                subLine = document.createElement('div');
                subLine.className = 'batch-history-meta-sub';
                if (metaLine.nextSibling) {
                    item.insertBefore(subLine, metaLine.nextSibling);
                } else {
                    item.appendChild(subLine);
                }
            }
            subLine.textContent = `進行中 · 更新 ${formatPendingTime(batch.updatedAt || batch.createdAt)}`;

            let actions = item.querySelector('.batch-history-actions');
            if (!actions) {
                actions = document.createElement('div');
                actions.className = 'batch-history-actions';
                item.appendChild(actions);
            }

            let downloadBtn = actions.querySelector('button[data-action="instant-download"]');
            if (!downloadBtn) {
                downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.dataset.action = 'instant-download';
                downloadBtn.dataset.variant = 'instant';
                downloadBtn.classList.add('batch-instant-download-btn');
                actions.appendChild(downloadBtn);
            }
            downloadBtn.dataset.batchId = batch.batchId;
            downloadBtn.textContent = '即時下載';
        });
    } catch (error) {
        console.warn('讀取即時批次失敗:', error);
        instantListEl.innerHTML = '';
        instantListEl.style.display = 'none';
        instantEmptyEl.style.display = 'block';
        instantEmptyEl.textContent = '讀取即時批次失敗';
    }
}

window.refreshPendingBatchSnapshots = refreshPendingBatchSnapshots;

async function downloadPendingBatch(batchId, buttonEl, downloadAsZip = false) {
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.getBatchSnapshot !== 'function') {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = buttonEl.dataset.originalText || '即時下載';
        }
        return;
    }
    const originalText = buttonEl ? (buttonEl.dataset.originalText || buttonEl.textContent || '即時下載') : '即時下載';
    if (buttonEl) {
        buttonEl.dataset.originalText = originalText;
        buttonEl.disabled = true;
        buttonEl.textContent = '下載中...';
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        const snapshot = await CEXTBatchStorage.getBatchSnapshot(batchId);
        if (!snapshot) {
            return;
        }
        const entries = snapshot.entries || [];
        const logs = snapshot.logs || [];
        const completed = snapshot.meta && (snapshot.meta.status === 'completed' || snapshot.meta.status === 'finished') && !snapshot.meta.unresolvedCount;
        // 使用批次資料中保存的 tenantName 和 domain，而不是當前環境的
        const tenantName = snapshot.meta?.tenantName || (typeof getTenantNameForFiles === 'function' ? getTenantNameForFiles() : 'batch_test');
        const domain = snapshot.meta?.domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);

        // 檢查是否有資料可供下載
        if (!Array.isArray(entries) || entries.length === 0) {
            alert('此批次沒有測試結果資料可供下載');
            return;
        }

        if (downloadAsZip) {
            // Shift + 下載：下載 ZIP 包
            if (completed && typeof downloadBatchZip === 'function') {
                await downloadBatchZip(entries, logs, tenantName, batchId, domain);
            } else {
                await downloadEntriesAsZip(entries, logs, tenantName, batchId, domain);
            }
        } else {
            // 一般下載：只下載 Excel
            const enrichedEntries = typeof enrichEntriesWithTopN === 'function'
                ? enrichEntriesWithTopN(entries, logs)
                : entries;
            const timestamp = typeof getCurrentDateTimeStr === 'function'
                ? getCurrentDateTimeStr()
                : new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const fileName = `${tenantName}_批次測試_${timestamp}`;
            await downloadExcel(entries, fileName, logs, batchId, tenantName, domain);
        }

        if (completed && typeof CEXTBatchStorage.markBatchDownloaded === 'function') {
            await CEXTBatchStorage.markBatchDownloaded(batchId);
        }
    } catch (error) {
        console.warn('下載暫存批次失敗:', error);
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = buttonEl.dataset.originalText || originalText;
        }
        refreshPendingBatchSnapshots();
        refreshDownloadHistory();
    }
}

async function discardPendingBatch(batchId) {
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.removeBatch !== 'function') {
        return;
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        await CEXTBatchStorage.removeBatch(batchId);
    } catch (error) {
        console.warn('刪除暫存批次失敗:', error);
    } finally {
        refreshPendingBatchSnapshots();
        refreshDownloadHistory();
    }
}

if (instantListEl) {
    instantListEl.addEventListener('click', (event) => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;
        const batchId = target.dataset.batchId;
        if (!batchId) return;
        if (target.dataset.action === 'instant-download') {
            // 檢測 Shift 鍵：Shift + 點擊 = 下載 ZIP，一般點擊 = 下載 Excel
            const downloadAsZip = event.shiftKey;
            downloadPendingBatch(batchId, target, downloadAsZip);
        } else if (target.dataset.action === 'instant-discard') {
            discardPendingBatch(batchId);
        }
    });
}

async function refreshDownloadHistory() {
    if (!historyListEl || !historyEmptyEl) return;
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.listHistory !== 'function') {
        historyListEl.innerHTML = '';
        historyEmptyEl.style.display = 'block';
        historyEmptyEl.textContent = '暫無可用的測試紀錄';
        return;
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        const historyRaw = await CEXTBatchStorage.listHistory();
        const history = Array.isArray(historyRaw)
            ? historyRaw.filter(batch => batch && batch.status !== 'in_progress')
            : [];
        if (history.length === 0) {
            historyListEl.innerHTML = '';
            historyEmptyEl.style.display = 'block';
            historyEmptyEl.textContent = '尚無測試紀錄';
            return;
        }
        historyEmptyEl.style.display = 'none';
        const fragment = document.createDocumentFragment();
        history.forEach((batch) => {
            const item = document.createElement('div');
            item.className = 'batch-history-item batch-history-item-history';
            item.dataset.batchId = batch.batchId;

            const infoWrapper = document.createElement('div');
            infoWrapper.className = 'batch-history-info';

            const titleLine = document.createElement('div');
            titleLine.className = 'batch-history-meta';

            // 取得當前環境的租戶名稱（去除前後空格並正規化）
            let currentTenantName = '';
            if (typeof CEXT !== 'undefined' && typeof CEXT.getTenantName === 'function') {
                const tenant = CEXT.getTenantName();
                currentTenantName = (tenant != null ? String(tenant) : '').trim();
            } else if (window.tenantName) {
                currentTenantName = String(window.tenantName).trim();
            }
            const batchTenantName = (batch?.tenantName != null ? String(batch.tenantName) : '').trim();

            // 設置標題文字
            const titleText = composeHistoryTitle(batch);

            titleLine.textContent = titleText;

            infoWrapper.appendChild(titleLine);

            const subtitleLine = document.createElement('div');
            subtitleLine.className = 'batch-history-meta-sub';
            subtitleLine.textContent = composeHistorySubtitle(batch);
            infoWrapper.appendChild(subtitleLine);

            item.appendChild(infoWrapper);

            const actions = document.createElement('div');
            actions.className = 'batch-history-button-container';

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.dataset.action = 'history-download';
            downloadBtn.dataset.batchId = batch.batchId;
            const isCurrentBatch = batch.status === 'in_progress';
            if (isCurrentBatch) {
                item.classList.add('batch-history-item-current');
            }
            downloadBtn.dataset.variant = isCurrentBatch ? 'instant' : 'default';
            downloadBtn.textContent = isCurrentBatch ? '即時下載' : '下載';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.dataset.action = 'history-remove';
            removeBtn.dataset.batchId = batch.batchId;
            removeBtn.dataset.style = 'secondary';
            removeBtn.textContent = '刪除';

            actions.appendChild(downloadBtn);
            actions.appendChild(removeBtn);
            item.appendChild(actions);
            fragment.appendChild(item);
        });

        historyListEl.innerHTML = '';
        historyListEl.appendChild(fragment);
    } catch (error) {
        console.warn('讀取歷史批次失敗:', error);
        historyListEl.innerHTML = '';
        if (historyEmptyEl) {
            historyEmptyEl.style.display = 'block';
            historyEmptyEl.textContent = '載入歷史紀錄失敗';
        }
    }
}

window.refreshDownloadHistory = refreshDownloadHistory;

// 調試函數：查看所有映射表
async function listAllIdToQuestionMaps() {
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.listIdToQuestionMaps !== 'function') {
        console.error('CEXTBatchStorage.listIdToQuestionMaps 不可用');
        return;
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        const maps = await CEXTBatchStorage.listIdToQuestionMaps();
        console.group('📋 IndexedDB 中的映射表列表');
        if (maps.length === 0) {
            console.log('目前沒有任何映射表');
        } else {
            console.table(maps);
            console.log(`\n總共 ${maps.length} 個映射表：`);
            maps.forEach((map, index) => {
                const type = map.isGlobal ? '🌐 全局映射表' : '📦 批次映射表';
                console.log(`${index + 1}. ${type}: ${map.key}`);
                console.log(`   - 更新時間: ${map.updatedAt || '未知'}`);
                console.log(`   - 映射數量: ${map.mapSize} 筆`);
            });
        }
        console.groupEnd();
        return maps;
    } catch (error) {
        console.error('讀取映射表列表失敗:', error);
        return [];
    }
}

// 將函數暴露到 window，方便在控制台調用
window.listAllIdToQuestionMaps = listAllIdToQuestionMaps;

async function downloadHistoryBatch(batchId, buttonEl, downloadAsZip = false) {
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.getBatchSnapshot !== 'function') {
        return;
    }
    const originalText = buttonEl ? (buttonEl.dataset.originalText || buttonEl.textContent || '下載') : '下載';
    if (buttonEl) {
        buttonEl.dataset.originalText = originalText;
        buttonEl.disabled = true;
        buttonEl.textContent = '下載中...';
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        const snapshot = await CEXTBatchStorage.getBatchSnapshot(batchId);
        if (!snapshot) {
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.textContent = originalText;
            }
            return;
        }
        const entries = snapshot.entries || [];
        const logs = snapshot.logs || [];
        const completed = snapshot.meta && (snapshot.meta.status === 'completed' || snapshot.meta.status === 'finished') && !snapshot.meta.unresolvedCount;
        // 使用批次資料中保存的 tenantName 和 domain，而不是當前環境的
        const tenantName = snapshot.meta?.tenantName || (typeof getTenantNameForFiles === 'function' ? getTenantNameForFiles() : 'batch_test');
        const domain = snapshot.meta?.domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);

        // 檢查是否有資料可供下載
        if (!Array.isArray(entries) || entries.length === 0) {
            alert('此批次沒有測試結果資料可供下載');
            return;
        }

        if (downloadAsZip) {
            // Shift + 下載：下載 ZIP 包
            if (completed && typeof downloadBatchZip === 'function') {
                await downloadBatchZip(entries, logs, tenantName, batchId, domain);
            } else {
                await downloadEntriesAsZip(entries, logs, tenantName, batchId, domain);
            }
        } else {
            // 一般下載：只下載 Excel
            // 注意：downloadExcel 內部會處理 TopN 和 TopNId，所以這裡不需要先 enrich
            const timestamp = typeof getCurrentDateTimeStr === 'function'
                ? getCurrentDateTimeStr()
                : new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const fileName = `${tenantName}_批次測試_${timestamp}`;
            // 傳遞 logs、batchId、tenantName 和 domain 給 downloadExcel，讓它內部處理 TopNId
            await downloadExcel(entries, fileName, logs, batchId, tenantName, domain);
        }

        if (typeof CEXTBatchStorage.markBatchDownloaded === 'function') {
            await CEXTBatchStorage.markBatchDownloaded(batchId);
        }
    } catch (error) {
        console.warn('下載歷史批次失敗:', error);
        alert('下載失敗：' + (error.message || '未知錯誤'));
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = originalText;
        }
        refreshDownloadHistory();
    }
}

async function removeHistoryBatch(batchId) {
    if (typeof CEXTBatchStorage === 'undefined' || typeof CEXTBatchStorage.removeBatch !== 'function') {
        return;
    }
    try {
        if (typeof CEXTBatchStorage.init === 'function') {
            await CEXTBatchStorage.init();
        }
        await CEXTBatchStorage.removeBatch(batchId);
    } catch (error) {
        console.warn('刪除歷史批次失敗:', error);
    } finally {
        refreshDownloadHistory();
    }
}

if (historyListEl) {
    historyListEl.addEventListener('click', (event) => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;
        const batchId = target.dataset.batchId;
        if (!batchId) return;
        if (target.dataset.action === 'history-download') {
            // 檢測 Shift 鍵：Shift + 點擊 = 下載 ZIP，一般點擊 = 下載 Excel
            const downloadAsZip = event.shiftKey;
            downloadHistoryBatch(batchId, target, downloadAsZip);
        } else if (target.dataset.action === 'history-remove') {
            removeHistoryBatch(batchId);
        }
    });
}

/* 更新進度條 */
function updateProgress(current, total) {
    if (!progressBarEl) return;
    const percentage = (current / total) * 100;
    progressBarEl.style.width = `${percentage}%`;
}

/* 新增詳細反饋項目 */
function addFeedbackDetail(text, status = 'processing') {
    if (!feedbackDetailsEl) return;

    const detail = document.createElement('div');
    detail.className = `batch-feedback-detail batch-feedback-detail-${status}`;
    detail.textContent = text;
    feedbackDetailsEl.appendChild(detail);
}

/* 更新詳細反饋項目狀態 */
function updateFeedbackDetail(index, status, errorMessage = '') {
    if (!feedbackDetailsEl) return;

    const details = feedbackDetailsEl.querySelectorAll('.batch-feedback-detail');
    if (details[index]) {
        details[index].className = `batch-feedback-detail batch-feedback-detail-${status}`;
        if (status === 'error' && errorMessage) {
            const originalText = details[index].textContent.split(' - ')[0];
            details[index].textContent = `${originalText} - 錯誤: ${errorMessage}`;
        }
    }
}