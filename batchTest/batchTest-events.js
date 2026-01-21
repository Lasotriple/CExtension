/* 處理初始化 */
function handleInit(domain, receivedParentUrl) {
    if (!domain) return;

    /* 使用 CEXT 統一管理 context */
    CEXT.setDomain(domain);
    parentUrl = receivedParentUrl || window.location.href; // 儲存父視窗 URL

    /* 根據來源設定標題 */
    const url = parentUrl || window.location.href;
    const headerTitle = document.querySelector('header strong');

    /* 異步取得 tenant name 並更新標題 */
    (async () => {
        let titlePrefix = '';
        if (url.includes('wise/wiseadm')) {
            titlePrefix = 'Admin Portal BatchTest';
        } else if (url.includes('webchat/default2')) {
            titlePrefix = 'KMS BatchTest';
        } else {
            titlePrefix = 'GenAI BatchTest';
        }

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
            }
        } catch (error) {
            console.warn('無法取得 tenant name:', error);
        }

        /* 更新標題 */
        const tenantName = CEXT.getTenantName();
        if (headerTitle) {
            if (tenantName) {
                headerTitle.textContent = `${titlePrefix} - ${tenantName}`;
                document.title = `${titlePrefix} - ${tenantName}`;
            } else {
                headerTitle.textContent = titlePrefix;
                document.title = titlePrefix;
            }
        }
    })();

    init();
}

/* 監聽來自父視窗的訊息 */
window.addEventListener('message', (e) => {
    const { type, domain: receivedDomain, parentUrl: receivedParentUrl, source } = e.data || {};

    /* 處理來自主頁的初始化訊息 */
    if (type === 'init' && receivedDomain) {
        handleInit(receivedDomain, receivedParentUrl);
    }

    /* 處理來自主頁的初始化回應 */
    if (source === 'CEXT_MAIN' && type === 'init-response' && receivedDomain) {
        handleInit(receivedDomain, receivedParentUrl);
    }
});

/* 主動請求初始化（當頁面載入時如果沒有 domain） */
function requestInitFromParent() {
    if (CEXT.getDomain()) {
        /* 已經有 domain，不需要請求 */
        return;
    }

    /* 嘗試從 opener 獲取 */
    if (window.opener && !window.opener.closed) {
        try {
            /* 向主頁請求初始化 */
            window.opener.postMessage({
                source: 'CEXT_BATCH',
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
            source: 'CEXT_BATCH',
            type: 'request-init'
        });

        /* 監聽回應 */
        channel.addEventListener('message', (e) => {
            const { source, type, domain } = e.data || {};
            if (source === 'CEXT_MAIN' && type === 'init-response' && domain) {
                handleInit(domain, null);
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

const LOG_WRITE_DELAY_MS = 600;

let latestBatchResultsSnapshot = [];
let latestBatchLogsSnapshot = [];
let latestTenantName = '';
let latestTotalQuestions = 0;
let latestUnresolvedCount = 0;
let batchSessionActive = false;
let currentBatchId = null;
let batchCreatedAtIso = '';
let latestBatchStatus = 'idle';

/* 比對開關狀態 */
let compareIndexEnabled = false;
let compareAnswerEnabled = false;

// 將開關狀態暴露到全局，以便其他模組訪問
if (typeof window !== 'undefined') {
    window.compareIndexEnabled = compareIndexEnabled;
    window.compareAnswerEnabled = compareAnswerEnabled;
}

const BatchStorage = typeof window !== 'undefined' ? (window.CEXTBatchStorage || null) : null;
let batchStorageReadyPromise = null;
let storageInitialized = false;

async function resetStalePendingBatchesIfIdle() {
    if (!BatchStorage || typeof BatchStorage.listBatches !== 'function' || typeof BatchStorage.markBatchStatus !== 'function') {
        return;
    }
    const submitBtnMode = submitBtn?.dataset?.mode || 'idle';
    if (submitBtnMode === 'running') {
        return;
    }
    try {
        if (typeof BatchStorage.init === 'function') {
            await BatchStorage.init();
        }
        const batchesRaw = await BatchStorage.listBatches({ includeDownloaded: false });
        const staleBatches = Array.isArray(batchesRaw)
            ? batchesRaw.filter(batch => batch && batch.status === 'in_progress')
            : [];
        if (staleBatches.length === 0) {
            return;
        }
        await Promise.all(staleBatches.map(batch => {
            return BatchStorage.markBatchStatus(batch.batchId, {
                status: 'stopped',
                partial: true
            }).catch(() => { });
        }));
        if (typeof refreshPendingBatchSnapshots === 'function') {
            try {
                refreshPendingBatchSnapshots();
            } catch (error) {
                console.warn('刷新即時批次列表失敗:', error);
            }
        }
        if (typeof refreshDownloadHistory === 'function') {
            try {
                refreshDownloadHistory();
            } catch (error) {
                console.warn('刷新歷史批次列表失敗:', error);
            }
        }
    } catch (error) {
        console.warn('重置停滯中的即時批次失敗:', error);
    }
}

if (BatchStorage && typeof BatchStorage.init === 'function') {
    batchStorageReadyPromise = BatchStorage.init()
        .then((supported) => {
            storageInitialized = Boolean(supported);
            if (typeof BatchStorage.isSupported === 'function') {
                storageInitialized = storageInitialized && BatchStorage.isSupported();
            }
            return storageInitialized;
        })
        .catch((error) => {
            console.warn('初始化批次結果儲存失敗:', error);
            storageInitialized = false;
            return false;
        });
} else {
    batchStorageReadyPromise = Promise.resolve(false);
}

function isBatchStorageReady() {
    return storageInitialized && !!BatchStorage && typeof BatchStorage.saveBatchSnapshot === 'function';
}

function cloneForStorage(data) {
    if (data === undefined || data === null) return data;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(data);
        } catch (error) {
            // fallback
        }
    }
    try {
        return JSON.parse(JSON.stringify(data));
    } catch (error) {
        return data;
    }
}

function computeBatchTiming(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return {
            firstSentAt: null,
            lastResponseAt: null,
            lastValidReceivedAt: null,
            durationMs: null
        };
    }

    let firstSentDate = null;
    let lastResponseDate = null;
    let lastValidResponseDate = null;

    entries.forEach((entry) => {
        if (!entry) {
            return;
        }

        const testTimeIso = typeof entry.testTime === 'string' ? entry.testTime : null;
        if (testTimeIso) {
            const sentDate = new Date(testTimeIso);
            if (!Number.isNaN(sentDate.getTime())) {
                if (!firstSentDate || sentDate < firstSentDate) {
                    firstSentDate = sentDate;
                }
            }
        }

        const responseTimeIso = typeof entry.responseTime === 'string' ? entry.responseTime : null;
        if (responseTimeIso) {
            const responseDate = new Date(responseTimeIso);
            if (!Number.isNaN(responseDate.getTime())) {
                if (!lastResponseDate || responseDate > lastResponseDate) {
                    lastResponseDate = responseDate;
                }
                const isValidResponse = !entry.error;
                if (isValidResponse) {
                    if (!lastValidResponseDate || responseDate > lastValidResponseDate) {
                        lastValidResponseDate = responseDate;
                    }
                }
            }
        }
    });

    const effectiveLastDate = lastValidResponseDate || lastResponseDate;
    let durationMs = null;
    if (firstSentDate && effectiveLastDate) {
        durationMs = Math.max(0, effectiveLastDate.getTime() - firstSentDate.getTime());
    }

    return {
        firstSentAt: firstSentDate ? firstSentDate.toISOString() : null,
        lastResponseAt: lastResponseDate ? lastResponseDate.toISOString() : null,
        lastValidReceivedAt: lastValidResponseDate ? lastValidResponseDate.toISOString() : null,
        durationMs
    };
}

async function persistBatchSnapshot(status, options = {}) {
    if (!currentBatchId || !batchStorageReadyPromise) {
        return;
    }

    const ready = await batchStorageReadyPromise;
    if (!ready || !isBatchStorageReady()) {
        return;
    }

    const domain = CEXT.getDomain();
    const meta = {
        batchId: currentBatchId,
        tenantName: latestTenantName || '',
        domain: domain || '',
        totalQuestions: latestTotalQuestions || 0,
        // 只有在 latestBatchResultsSnapshot 有內容時才更新 completedCount
        // 如果為空，則不設置，讓 normalizeMeta 保留現有的值
        ...(latestBatchResultsSnapshot.length > 0 ? { completedCount: latestBatchResultsSnapshot.length } : {}),
        status: status || 'in_progress',
        unresolvedCount: options.unresolvedCount !== undefined ? options.unresolvedCount : latestUnresolvedCount || 0,
        lastError: options.lastError || null,
        downloaded: options.downloaded ?? false,
        partial: options.partial ?? (status !== 'completed'),
        createdAt: batchCreatedAtIso || undefined
    };

    const timingMeta = computeBatchTiming(latestBatchResultsSnapshot);
    meta.firstSentAt = timingMeta.firstSentAt;
    meta.lastResponseAt = timingMeta.lastResponseAt;
    meta.lastValidReceivedAt = timingMeta.lastValidReceivedAt;
    meta.durationMs = timingMeta.durationMs;

    // 如果 latestBatchResultsSnapshot 是空陣列，不要傳入 entries（避免清空現有資料）
    // 只有在有實際資料時才更新 entries
    const entriesToSave = options.skipEntries
        ? undefined
        : (Array.isArray(latestBatchResultsSnapshot) && latestBatchResultsSnapshot.length > 0
            ? cloneForStorage(latestBatchResultsSnapshot)
            : undefined);

    const logsToSave = options.skipLogs
        ? undefined
        : (Array.isArray(latestBatchLogsSnapshot) && latestBatchLogsSnapshot.length > 0
            ? cloneForStorage(latestBatchLogsSnapshot)
            : undefined);

    const snapshotPayload = {
        meta,
        entries: entriesToSave,
        logs: logsToSave
    };

    try {
        await BatchStorage.saveBatchSnapshot(currentBatchId, snapshotPayload);
        latestBatchStatus = meta.status;
        if (typeof refreshPendingBatchSnapshots === 'function') {
            try {
                refreshPendingBatchSnapshots();
            } catch (error) {
                console.warn('刷新暫存批次列表失敗:', error);
            }
        }
        if (typeof refreshDownloadHistory === 'function') {
            try {
                refreshDownloadHistory();
            } catch (error) {
                console.warn('刷新歷史批次列表失敗:', error);
            }
        }
    } catch (error) {
        console.warn('儲存批次快照失敗:', error);
    }
}

function generateBatchId(tenantName) {
    const base = (tenantName || 'batch_test')
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    const uniqueSegment = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    return `${base || 'batch_test'}_${uniqueSegment}`;
}

async function getLogSnapshot(logPaths) {
    const defaultPath = Array.isArray(logPaths) && logPaths.length > 0 ? logPaths[0] : '';
    if (!Array.isArray(logPaths) || logPaths.length === 0) {
        return { size: 0, path: defaultPath, error: new Error('logPaths 未設定') };
    }
    try {
        const script = getLogsSize(logPaths);
        const result = await groovyCaller(script);
        const sizeValue = Number(result?.newSize ?? 0);
        const size = Number.isFinite(sizeValue) ? sizeValue : 0;
        const path = result?.catalinaPath || defaultPath;
        return { size, path };
    } catch (error) {
        console.warn('取得 log 大小時發生錯誤:', error);
        return { size: 0, path: defaultPath, error };
    }
}

async function fetchLogTailContent(offset, length) {
    try {
        const tailScript = getLogsTail(offset, length);
        const tailResult = await groovyCaller(tailScript);
        const content = tailResult?.content || '';
        return { content, error: null };
    } catch (error) {
        console.warn('取得 log tail 時發生錯誤:', error);
        return { content: '', error };
    }
}

function buildBatchLogFileName(rangeStart, rangeEnd, attemptLabel = '') {
    const rangePart = rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}_${rangeEnd}`;
    return attemptLabel ? `${attemptLabel}_${rangePart}_logs.txt` : `${rangePart}_logs.txt`;
}

function buildLogFileContent(meta, tailContent, tailError) {
    const lines = [
        `問題範圍: ${meta.rangeStart}-${meta.rangeEnd}`,
        `執行階段: ${meta.attemptLabel ? meta.attemptLabel : '初始'}`,
        `使用檔案: ${meta.logPath || '未知'}`,
        `Before Size: ${meta.beforeSize}`,
        `After Size: ${meta.afterSize}`,
        `差值: ${meta.sizeDiff}`,
    ];
    if (meta.beforeError) {
        lines.push(`Before Size 取得失敗: ${meta.beforeError.message || meta.beforeError}`);
    }
    if (meta.afterError) {
        lines.push(`After Size 取得失敗: ${meta.afterError.message || meta.afterError}`);
    }
    lines.push('');
    if (tailError) {
        lines.push(`取得日誌時發生錯誤: ${tailError.message || tailError}`);
    }
    if (tailContent && tailContent.length > 0) {
        lines.push(tailContent);
    } else if (!tailError) {
        lines.push('本批次無新增日誌。');
    }
    return lines.join('\n');
}

function buildRetryAnswerBySets() {
    const additionalValues = (retryAnswerByInputEl?.value || '')
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0)
        .map(v => v.toLowerCase());

    const defaultValues = new Set(['', 'unknown', 'no answer']);
    const additionalSet = new Set(additionalValues);
    const combinedSet = new Set(defaultValues);
    additionalValues.forEach(value => combinedSet.add(value));

    return {
        defaultSet: defaultValues,
        additionalSet,
        combinedSet
    };
}

function determineAnswerByPriority(normalizedAnswerBy, retrySets) {
    if (!normalizedAnswerBy || retrySets.defaultSet.has(normalizedAnswerBy)) {
        return 3;
    }
    if (retrySets.additionalSet.has(normalizedAnswerBy)) {
        return 2;
    }
    return 1;
}

function shouldRetryNormalizedAnswer(normalizedAnswerBy, retrySets) {
    return retrySets.defaultSet.has(normalizedAnswerBy) || retrySets.additionalSet.has(normalizedAnswerBy);
}

// 緩存評分 prompt，避免重複讀取
let cachedScoringPrompt = null;
let scoringPromptLoadPromise = null;

// AOAI 評分隊列系統
const scoringQueue = {
    queue: [],
    processing: false,
    processedCount: 0,
    totalCount: 0
};

/**
 * 將需要評分的 entry 加入隊列
 * @param {Object} entry - 要評分的 entry
 * @param {string} answer - 從 responseText 提取的 answer
 */
function enqueueScoringTask(entry, answer) {
    if (!compareAnswerEnabled || typeof getAOAI === 'undefined' || typeof groovyCaller === 'undefined') {
        return;
    }

    // 檢查是否有預期答案（雙重檢查，確保安全）
    if (!entry.expectedAnswer || entry.expectedAnswer.trim() === '') {
        return;
    }

    scoringQueue.queue.push({ entry, answer });
    scoringQueue.totalCount = Math.max(scoringQueue.totalCount, scoringQueue.queue.length);

    // 不在此處啟動處理，由批次完成時統一觸發並等待完成
}

/**
 * 處理評分隊列（順序執行，不併發）
 * @param {Array} resultEntriesRef - resultEntries 的引用（可選，用於更新）
 */
async function processScoringQueue(resultEntriesRef = null) {
    if (scoringQueue.processing || scoringQueue.queue.length === 0) {
        return;
    }

    scoringQueue.processing = true;

    while (scoringQueue.queue.length > 0) {
        const task = scoringQueue.queue.shift();
        if (!task) continue;

        const { entry, answer } = task;

        try {
            const { score, prompt } = await performAOAIscoring(entry, answer);

            // 更新 entry 的評分結果（entry 是引用，直接更新即可）
            entry.aoaiScore = score;
            entry.aoaiScorePrompt = prompt;

            // 如果提供了 resultEntries 引用，也更新它（雙重保險）
            if (resultEntriesRef) {
                const entryId = entry.id;
                if (entryId && resultEntriesRef[entryId - 1]) {
                    resultEntriesRef[entryId - 1].aoaiScore = score;
                    resultEntriesRef[entryId - 1].aoaiScorePrompt = prompt;
                }
            }

            scoringQueue.processedCount++;

            // 每處理 5 個或完成時更新進度
            if (scoringQueue.processedCount % 5 === 0 || scoringQueue.queue.length === 0) {
                const remaining = scoringQueue.queue.length;
                const total = scoringQueue.totalCount;
                showFeedback(`AOAI 評分進度: ${scoringQueue.processedCount}/${total} (剩餘 ${remaining})`, 'info', true);
            }
        } catch (error) {
            console.warn(`AOAI 評分失敗 (問題 ${entry.id}):`, error);
            entry.aoaiScore = `評分失敗: ${error.message || String(error)}`;

            // 如果提供了 resultEntries 引用，也更新它
            if (resultEntriesRef) {
                const entryId = entry.id;
                if (entryId && resultEntriesRef[entryId - 1]) {
                    resultEntriesRef[entryId - 1].aoaiScore = entry.aoaiScore;
                }
            }
        }
    }

    scoringQueue.processing = false;

    if (scoringQueue.processedCount > 0) {
        showFeedback(`AOAI 評分完成，共評分 ${scoringQueue.processedCount} 個回答`, 'success', true);
        scoringQueue.processedCount = 0;
        scoringQueue.totalCount = 0;
    }
}

/**
 * 讀取評分 prompt（帶緩存）
 * @returns {Promise<string>} - 評分 prompt 內容
 */
async function loadScoringPrompt() {
    if (cachedScoringPrompt) {
        return cachedScoringPrompt;
    }

    if (scoringPromptLoadPromise) {
        return scoringPromptLoadPromise;
    }

    scoringPromptLoadPromise = (async () => {
        try {
            const promptResponse = await fetch('../prompts/answer-scoring-prompt.txt');
            if (promptResponse.ok) {
                cachedScoringPrompt = await promptResponse.text();
                return cachedScoringPrompt;
            } else {
                console.warn('無法讀取 ../prompts/answer-scoring-prompt.txt');
                return '';
            }
        } catch (error) {
            console.warn('讀取 ../prompts/answer-scoring-prompt.txt 失敗:', error);
            return '';
        } finally {
            scoringPromptLoadPromise = null;
        }
    })();

    return scoringPromptLoadPromise;
}

/**
 * 檢查評分結果是否需要重試
 * @param {string} score - 評分結果字串
 * @returns {boolean} - 是否需要重試
 */
function shouldRetryAOAIscoring(score) {
    if (!score || typeof score !== 'string' || score.trim() === '') {
        // 沒有結果，需要重試
        return true;
    }

    // 檢查是否包含 "不符合預期"
    if (score.includes('[不符合預期]') || score.includes('不符合預期')) {
        return true;
    }

    // 檢查分數是否低於 60%
    // 格式可能是：[85%]：[符合預期]：[原因]
    // 或：[50%]：[不符合預期]：[原因]
    const scoreMatch = score.match(/\[(\d+)%\]/);
    if (scoreMatch) {
        const scoreValue = parseInt(scoreMatch[1], 10);
        if (scoreValue < 60) {
            return true;
        }
    }

    return false;
}

/**
 * 執行 AOAI 評分（單個 entry，帶重試邏輯）
 * @param {Object} entry - 要評分的 entry
 * @param {string} answer - 從 responseText 提取的 answer
 * @returns {Promise<{score: string, prompt: string}>} - 評分結果和替換後的 prompt
 */
async function performAOAIscoring(entry, answer) {
    if (!compareAnswerEnabled || typeof getAOAI === 'undefined' || typeof groovyCaller === 'undefined') {
        return { score: '', prompt: '' };
    }

    // 檢查是否有預期答案
    if (!entry.expectedAnswer || entry.expectedAnswer.trim() === '') {
        return { score: '', prompt: '' };
    }

    // 讀取重試次數設定
    const DEFAULT_AOAI_RETRY = 1;
    const rawAoaiRetryCount = aoaiRetryCountInputEl ? parseInt(aoaiRetryCountInputEl.value, 10) : NaN;
    const maxRetryCount = Number.isFinite(rawAoaiRetryCount) && rawAoaiRetryCount >= 0
        ? Math.min(Math.max(rawAoaiRetryCount, 0), 3)
        : DEFAULT_AOAI_RETRY;

    // 總共最多嘗試 3 次（初始 1 次 + 重試最多 2 次）
    const maxAttempts = Math.min(3, 1 + maxRetryCount);

    let finalScore = '';
    let finalPrompt = '';
    let lastError = null;

    // 讀取評分 prompt（只讀取一次）
    const scoringPrompt = await loadScoringPrompt();
    if (!scoringPrompt) {
        return { score: '', prompt: '' };
    }

    // 構建 replaceMap（只構建一次）
    const replaceMap = {
        '使用者問句': entry.question || '',
        '預期答案': entry.expectedAnswer || '',
        'answer': answer
    };

    // 替換 prompt 中的變數（只替換一次）
    finalPrompt = scoringPrompt;
    Object.keys(replaceMap).forEach(key => {
        const value = replaceMap[key];
        finalPrompt = finalPrompt.replaceAll(`$${key}$`, value);
    });

    // 執行評分，最多嘗試 maxAttempts 次
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // 調用 getAOAI（model 寫在這裡）
            const aoaiScript = getAOAI('gpt-4o', scoringPrompt, replaceMap);
            const result = await groovyCaller(aoaiScript);

            // 解析結果
            let aoaiScore = '';
            if (result && typeof result === 'string') {
                try {
                    const parsed = JSON.parse(result);
                    aoaiScore = parsed.answer || result;
                } catch (e) {
                    aoaiScore = result;
                }
            } else if (result && result.answer) {
                aoaiScore = result.answer;
            }

            // 檢查是否需要重試
            const needsRetry = shouldRetryAOAIscoring(aoaiScore);

            if (!needsRetry) {
                // 結果符合要求，返回
                finalScore = aoaiScore;
                return { score: finalScore, prompt: finalPrompt };
            }

            // 需要重試，但已達上限
            if (attempt >= maxAttempts) {
                // 即使需要重試，但已達上限，返回最後一次結果
                finalScore = aoaiScore || '評分失敗：已達重試上限';
                return { score: finalScore, prompt: finalPrompt };
            }

            // 需要重試，且還有機會
            /* removed debug log */
            // 繼續下一次循環

        } catch (error) {
            lastError = error;
            console.warn(`AOAI 評分失敗 (問題 ${entry.id}, 第 ${attempt} 次嘗試):`, error);

            // 已達上限，返回錯誤
            if (attempt >= maxAttempts) {
                finalScore = `評分失敗: ${error.message || String(error)}`;
                return { score: finalScore, prompt: finalPrompt };
            }

            // 還有機會重試，繼續下一次循環
        }
    }

    // 如果所有嘗試都失敗，返回最後的錯誤
    if (lastError) {
        return { score: `評分失敗: ${lastError.message || String(lastError)}`, prompt: finalPrompt };
    }

    // 不應該到達這裡，但以防萬一
    return { score: finalScore || '評分失敗：未知錯誤', prompt: finalPrompt };
}

/**
 * 從回應 JSON 中提取 answer 或 output
 * 優先提取 answer（從 rm.messages 中提取 html/text），如果沒有則取 output
 * @param {string} responseText - JSON 字串格式的回應
 * @returns {string} - 提取的 answer 或 output
 */
function extractAnswerFromResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return '';
    }

    try {
        const parsed = JSON.parse(responseText);

        // 優先提取 answer：從 rm.messages 中提取
        const messages = parsed?.rm?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
            const parts = [];
            for (const message of messages) {
                if (message.html) {
                    parts.push(String(message.html));
                }
                if (message.text) {
                    parts.push(String(message.text));
                }
            }
            if (parts.length > 0) {
                return parts.join(' ');
            }
        }

        // 如果沒有 answer，則取 output
        if (parsed.output !== undefined && parsed.output !== null) {
            return String(parsed.output);
        }

        return '';
    } catch (error) {
        // 如果解析失敗，返回空字串
        return '';
    }
}

function analyzeAnswerBy(responseText, retrySets) {
    const result = {
        needsRetry: true,
        normalizedAnswerBy: '',
        originalAnswerBy: '',
        priority: 3,
        parsedResponse: null,
        rawResponseText: responseText
    };

    if (!responseText || typeof responseText !== 'string') {
        return result;
    }

    try {
        const parsed = JSON.parse(responseText);
        result.parsedResponse = parsed;

        const rawValue = parsed?.__AnswerBy__;
        const original = rawValue == null ? '' : String(rawValue);
        const normalized = original.trim().toLowerCase();

        result.originalAnswerBy = original;
        result.normalizedAnswerBy = normalized;
        result.priority = determineAnswerByPriority(normalized, retrySets);
        result.needsRetry = shouldRetryNormalizedAnswer(normalized, retrySets);

        return result;
    } catch (error) {
        return result;
    }
}

function createAnswerRecord(analysis, responseText) {
    const value = analysis.originalAnswerBy ?? '';
    const normalized = analysis.normalizedAnswerBy ?? '';
    const priority = analysis.priority ?? 3;

    let serializedText = responseText;
    if (analysis.parsedResponse) {
        const mutated = { ...analysis.parsedResponse };
        if (typeof value === 'string') {
            mutated.__AnswerBy__ = value;
        }
        serializedText = JSON.stringify(mutated);
    }

    return {
        value,
        normalized,
        priority,
        responseText: serializedText
    };
}

function selectBetterAnswer(existingBest, candidateRecord) {
    if (!candidateRecord) {
        return existingBest || null;
    }

    if (!existingBest) {
        return candidateRecord;
    }

    const candidatePriority = candidateRecord.priority ?? 3;
    const existingPriority = existingBest.priority ?? 3;

    if (candidatePriority < existingPriority) {
        return candidateRecord;
    }

    return existingBest;
}

function postBatchMessage(type, payload = {}) {
    try {
        if (window.opener && !window.opener.closed) {
            const payloadWithId = Object.assign({
                batchId: currentBatchId || null
            }, payload || {});
            window.opener.postMessage({
                source: 'CEXT_BATCH',
                type,
                payload: payloadWithId
            }, '*');
        }
    } catch (error) {
        console.warn('傳送批次訊息至父視窗失敗:', error);
    }
}

window.addEventListener('beforeunload', () => {
    const runMode = submitBtn?.dataset?.mode || 'idle';
    const isRunActive = runMode === 'running';
    const includeData = isRunActive || (batchSessionActive && latestBatchResultsSnapshot.length > 0);
    const snapshotPayload = {
        tenantName: latestTenantName,
        totalQuestions: latestTotalQuestions,
        timestamp: new Date().toISOString(),
        results: includeData ? latestBatchResultsSnapshot : [],
        logs: includeData ? latestBatchLogsSnapshot : [],
        status: includeData ? (batchSessionActive ? 'closing' : latestBatchStatus || 'idle') : 'idle'
    };
    if (currentBatchId && batchStorageReadyPromise) {
        persistBatchSnapshot('stopped', { partial: true }).catch(() => { });
    }
    postBatchMessage('batch-window-closed', snapshotPayload);
});

/* 從表格讀取數據 */
function getTableData() {
    if (!tableBody || !tableHeader) return [];
    const rows = tableBody.querySelectorAll('tr');
    const headers = Array.from(tableHeader.querySelectorAll('th')).map(th => th.textContent.trim());
    const data = [];

    /* removed debug log */

    rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;

        // 跳過序號欄位（第一個），測試問句是第二個欄位
        // 確保至少有兩個欄位（序號 + 測試問句）
        if (cells.length < 2) return;

        const question = cells[1] ? cells[1].textContent.trim() : '';
        if (!question) return; // 跳過空行

        const rowData = { question };

        // 根據表頭欄位名稱來對應數據（跳過序號和測試問句）
        for (let i = 2; i < cells.length && i < headers.length; i++) {
            const headerName = headers[i];
            const cellValue = cells[i] ? cells[i].textContent.trim() : '';

            if (headerName === '預期編號') {
                rowData.expectedIndex = cellValue;
            } else if (headerName === '預期答案') {
                rowData.expectedAnswer = cellValue;
            }
        }

        /* removed debug log */
        data.push(rowData);
    });

    /* removed debug log */
    return data;
}

/* 檢查表單是否可送出 */
function checkFormValidity() {
    const apiType = getApiType();

    // 檢查表格是否有內容
    const tableData = getTableData();
    const hasContent = tableData.length > 0;

    if (apiType === 'adminportal') {
        /* adminportal: 需要選擇渠道且有內容 */
        const hasChannel = channelSelectEl.value !== '';
        const isValid = hasChannel && hasContent;

        /* 啟用/禁用表格和送出按鈕 */
        if (tableContainer && contentTable) {
            // 根據渠道選擇狀態控制表格的可編輯性和樣式（跳過序號欄位）
            const rows = tableBody ? tableBody.querySelectorAll('tr') : [];
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                cells.forEach((cell, index) => {
                    // 序號欄位（第一個）始終不可編輯
                    if (index === 0) {
                        cell.contentEditable = 'false';
                    } else {
                        cell.contentEditable = hasChannel ? 'true' : 'false';
                    }
                });
            });

            // 添加/移除禁用狀態的 class
            if (hasChannel) {
                contentTable.classList.remove('disabled');
                tableContainer.classList.remove('disabled');
            } else {
                contentTable.classList.add('disabled');
                tableContainer.classList.add('disabled');
            }
        }

        /* 啟用/禁用表單項目群組 */
        const formItemGroup = document.querySelector('.batch-form-item-group');
        if (formItemGroup) {
            if (hasChannel) {
                formItemGroup.classList.remove('disabled');
            } else {
                formItemGroup.classList.add('disabled');
            }
        }

        /* 啟用/禁用按鈕群組 */
        const formButtons = document.querySelector('.batch-form-item.batch-form-buttons');
        if (formButtons) {
            if (hasChannel) {
                formButtons.classList.remove('disabled');
            } else {
                formButtons.classList.add('disabled');
            }
        }

        /* 啟用/禁用比對按鈕 */
        if (compareIndexBtn) {
            compareIndexBtn.disabled = !hasChannel;
        }
        // 比對答案按鈕需要同時滿足渠道選擇和 API 測試成功
        if (compareAnswerBtn) {
            const isAnswerBtnEnabled = hasChannel && !compareAnswerBtn.hasAttribute('data-api-disabled');
            compareAnswerBtn.disabled = !isAnswerBtnEnabled;
        }

        submitBtn.disabled = !isValid;

        return isValid;
    } else {
        /* kms: 只需要有內容 */
        // KMS 模式下，按鈕和表格始終可用（因為不需要選擇渠道）
        if (tableContainer) {
            tableContainer.classList.remove('disabled');
        }
        if (contentTable) {
            contentTable.classList.remove('disabled');
        }
        const formItemGroup = document.querySelector('.batch-form-item-group');
        if (formItemGroup) {
            formItemGroup.classList.remove('disabled');
        }
        const formButtons = document.querySelector('.batch-form-item.batch-form-buttons');
        if (formButtons) {
            formButtons.classList.remove('disabled');
        }
        if (compareIndexBtn) {
            compareIndexBtn.disabled = false;
        }
        // 比對答案按鈕需要 API 測試成功
        if (compareAnswerBtn) {
            const isAnswerBtnEnabled = !compareAnswerBtn.hasAttribute('data-api-disabled');
            compareAnswerBtn.disabled = !isAnswerBtnEnabled;
        }

        submitBtn.disabled = !hasContent;
        return hasContent;
    }
}

/* 提交按鈕事件 */
document.addEventListener('DOMContentLoaded', () => {
    if (typeof CEXTBatchStorage !== 'undefined' && typeof CEXTBatchStorage.init === 'function') {
        CEXTBatchStorage.init()
            .then(() => {
                resetStalePendingBatchesIfIdle();
                if (typeof refreshPendingBatchSnapshots === 'function') {
                    refreshPendingBatchSnapshots();
                }
                if (typeof refreshDownloadHistory === 'function') {
                    refreshDownloadHistory();
                }
            })
            .catch(() => { });
    }

    /* adminportal: 監聽渠道選擇變化 */
    channelSelectEl.addEventListener('change', () => {
        checkFormValidity();
    });

    /* 初始化按鈕狀態與表單 */
    submitBtn.dataset.initialLabel = submitBtn.dataset.initialLabel || submitBtn.textContent || '開始測試';
    submitBtn.dataset.mode = submitBtn.dataset.mode || 'idle';
    checkFormValidity();

    /* 更新表格欄位 */
    function updateTableColumns() {
        if (!tableHeader || !tableBody) return;

        // 先獲取當前表頭，用於識別資料位置
        const oldHeaders = Array.from(tableHeader.querySelectorAll('th')).map(th => th.textContent.trim());

        // 保存現有資料（根據表頭名稱對應）
        const rows = tableBody.querySelectorAll('tr');
        const savedData = [];
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            // 跳過序號欄位（第一個），測試問句是第二個欄位
            const rowData = {
                question: cells[1] ? cells[1].textContent.trim() : '',
                expectedIndex: '',
                expectedAnswer: ''
            };

            // 根據舊表頭找出對應的資料（跳過序號和測試問句）
            for (let i = 2; i < cells.length && i < oldHeaders.length; i++) {
                const headerName = oldHeaders[i];
                if (headerName === '預期編號') {
                    rowData.expectedIndex = cells[i].textContent.trim();
                } else if (headerName === '預期答案') {
                    rowData.expectedAnswer = cells[i].textContent.trim();
                }
            }
            savedData.push(rowData);
        });

        // 清除現有表頭
        tableHeader.innerHTML = '';

        // 根據開關狀態決定欄位（相互獨立）
        const headers = ['序號', '測試問句'];
        if (compareIndexEnabled) {
            headers.push('預期編號');
        }
        if (compareAnswerEnabled) {
            headers.push('預期答案');
        }

        // 更新表頭
        headers.forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            tableHeader.appendChild(th);
        });

        // 根據欄位數量添加 class 以設定寬度（不包括序號）
        if (contentTable) {
            const dataColumnCount = headers.length - 1; // 減去序號欄位
            contentTable.classList.remove('cols-1', 'cols-2', 'cols-3');
            contentTable.classList.add(`cols-${dataColumnCount}`);
        }

        // 更新所有行的欄位數，保留原有資料
        rows.forEach((row, rowIndex) => {
            const currentCells = row.querySelectorAll('td');
            const targetCellCount = headers.length;
            const rowData = savedData[rowIndex] || { question: '', expectedIndex: '', expectedAnswer: '' };

            // 如果欄位數不對，重新建立但保留資料
            if (currentCells.length !== targetCellCount) {
                row.innerHTML = '';

                // 序號欄位（第一個欄位，不可編輯）
                const tdIndex = document.createElement('td');
                tdIndex.textContent = rowIndex + 1;
                tdIndex.style.textAlign = 'center';
                tdIndex.contentEditable = 'false';
                row.appendChild(tdIndex);

                // 測試問句（第二個欄位）
                const tdQuestion = document.createElement('td');
                tdQuestion.contentEditable = 'true';
                tdQuestion.textContent = rowData.question;
                row.appendChild(tdQuestion);

                // 根據表頭順序添加其他欄位（跳過序號和測試問句）
                for (let i = 2; i < targetCellCount; i++) {
                    const td = document.createElement('td');
                    td.contentEditable = 'true';
                    const headerName = headers[i];
                    if (headerName === '預期編號') {
                        td.textContent = rowData.expectedIndex;
                    } else if (headerName === '預期答案') {
                        td.textContent = rowData.expectedAnswer;
                    }
                    row.appendChild(td);
                }
            } else {
                // 欄位數對，更新單元格內容以匹配新順序
                const cells = row.querySelectorAll('td');
                cells.forEach((cell, index) => {
                    if (index === 0) {
                        // 序號欄位，更新序號
                        cell.textContent = rowIndex + 1;
                    } else if (index === 1) {
                        // 測試問句
                        cell.textContent = rowData.question;
                    } else {
                        const headerName = headers[index];
                        if (headerName === '預期編號') {
                            cell.textContent = rowData.expectedIndex;
                        } else if (headerName === '預期答案') {
                            cell.textContent = rowData.expectedAnswer;
                        }
                    }
                });
            }
        });

        // 更新所有行的序號
        updateRowNumbers();

        // 更新後觸發表單驗證
        checkFormValidity();
    }

    /* 更新所有行的序號 */
    function updateRowNumbers() {
        if (!tableBody) return;
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
                cells[0].textContent = index + 1;
            }
        });
    }

    /* 清理空行（除了序號外沒有資料的行），至少保留一行 */
    function cleanupEmptyRows() {
        if (!tableBody) return;
        const rows = Array.from(tableBody.querySelectorAll('tr'));

        // 如果只有一行，不刪除
        if (rows.length <= 1) return;

        // 從後往前遍歷，避免刪除時索引變化
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            const cells = row.querySelectorAll('td');

            // 檢查除了序號欄位（第一個）外是否有內容
            let hasContent = false;
            for (let j = 1; j < cells.length; j++) {
                if (cells[j] && cells[j].textContent.trim()) {
                    hasContent = true;
                    break;
                }
            }

            // 如果沒有內容且不是最後一行，刪除
            if (!hasContent && rows.length > 1) {
                row.remove();
                rows.splice(i, 1);
            }
        }

        // 更新序號
        updateRowNumbers();
    }

    /* 創建新的表格行（帶有序號） */
    function createTableRow() {
        if (!tableHeader || !tableBody) return null;
        const headers = Array.from(tableHeader.querySelectorAll('th')).map(th => th.textContent.trim());
        const row = document.createElement('tr');

        // 序號欄位（第一個欄位，不可編輯）
        const tdIndex = document.createElement('td');
        tdIndex.textContent = tableBody.querySelectorAll('tr').length + 1;
        tdIndex.style.textAlign = 'center';
        tdIndex.contentEditable = 'false';
        row.appendChild(tdIndex);

        // 其他欄位（可編輯）
        for (let i = 1; i < headers.length; i++) {
            const td = document.createElement('td');
            td.contentEditable = 'true';
            row.appendChild(td);
        }

        return row;
    }

    /* 解析 CSV 格式（處理雙引號包圍和轉義） */
    function parseCSVLine(line) {
        const cells = [];
        let currentCell = '';
        let inQuotes = false;
        let i = 0;

        while (i < line.length) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes) {
                    // 檢查是否是轉義的雙引號（""）
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        currentCell += '"';
                        i += 2; // 跳過兩個引號
                        continue;
                    } else {
                        // 結束引號（不添加到內容中）
                        inQuotes = false;
                    }
                } else {
                    // 開始引號（不添加到內容中）
                    inQuotes = true;
                }
            } else if (char === '\t' && !inQuotes) {
                // Tab 分隔符（不在引號內）
                cells.push(currentCell);
                currentCell = '';
            } else {
                // 添加到當前單元格內容（包括換行符）
                currentCell += char;
            }
            i++;
        }

        // 添加最後一個單元格
        cells.push(currentCell);
        return cells;
    }

    /* 處理 Excel 貼上 */
    function handleExcelPaste(event) {
        event.preventDefault();
        const pasteData = (event.clipboardData || window.clipboardData).getData('text');

        // 先按行分割，但要考慮引號內的換行
        const lines = [];
        let currentLine = '';
        let inQuotes = false;

        for (let i = 0; i < pasteData.length; i++) {
            const char = pasteData[i];

            if (char === '"') {
                if (i + 1 < pasteData.length && pasteData[i + 1] === '"') {
                    // 轉義的雙引號
                    currentLine += '""';
                    i++; // 跳過下一個引號
                } else {
                    // 切換引號狀態
                    inQuotes = !inQuotes;
                    currentLine += char;
                }
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                // 不在引號內的換行，結束當前行
                if (currentLine.trim().length > 0 || lines.length === 0) {
                    lines.push(currentLine);
                }
                currentLine = '';
                // 跳過 \r\n 組合
                if (char === '\r' && i + 1 < pasteData.length && pasteData[i + 1] === '\n') {
                    i++;
                }
            } else {
                currentLine += char;
            }
        }

        // 添加最後一行
        if (currentLine.trim().length > 0 || lines.length === 0) {
            lines.push(currentLine);
        }

        if (lines.length === 0) return;

        const columnCount = tableHeader ? tableHeader.querySelectorAll('th').length : 1;
        const currentCell = event.target;
        const currentRow = currentCell.closest('tr');
        const allCells = currentRow.querySelectorAll('td');
        const currentCellIndex = Array.from(allCells).indexOf(currentCell);

        // 如果點擊的是序號欄位，不處理貼上
        if (currentCellIndex === 0) return;

        // 獲取所有現有行（動態更新）
        let allRows = Array.from(tableBody.querySelectorAll('tr'));
        const startRowIndex = allRows.indexOf(currentRow);

        // 處理每一行資料（覆蓋模式，從當前行開始覆蓋）
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            // 使用 CSV 解析函數處理雙引號和轉義
            const lineCells = parseCSVLine(lines[lineIndex]);
            const targetRowIndex = startRowIndex + lineIndex;

            // 如果目標行不存在，創建新行
            let targetRow;
            if (targetRowIndex >= allRows.length) {
                targetRow = createTableRow();
                if (!targetRow) continue;
                tableBody.appendChild(targetRow);
                allRows = Array.from(tableBody.querySelectorAll('tr')); // 重新獲取
            } else {
                targetRow = allRows[targetRowIndex];
            }

            const cells = targetRow.querySelectorAll('td');
            // 所有行都從當前欄位開始，保持對齊
            const startCellIndex = currentCellIndex;

            // 從指定位置開始覆蓋資料
            for (let i = 0; i < lineCells.length; i++) {
                let cellIndex = startCellIndex + i;

                // 如果超出當前行的欄位數，換到下一行
                if (cellIndex >= columnCount) {
                    const nextRowIndex = targetRowIndex + 1;
                    let nextRow;

                    if (nextRowIndex >= allRows.length) {
                        nextRow = createTableRow();
                        if (!nextRow) continue;
                        tableBody.appendChild(nextRow);
                        allRows = Array.from(tableBody.querySelectorAll('tr')); // 重新獲取
                    } else {
                        nextRow = allRows[nextRowIndex];
                    }

                    const nextCells = nextRow.querySelectorAll('td');
                    const nextCellIndex = cellIndex - columnCount;
                    if (nextCells[nextCellIndex]) {
                        // 保留原始內容（包括換行），只去除首尾空白
                        nextCells[nextCellIndex].textContent = lineCells[i].replace(/^\s+|\s+$/g, '');
                    }
                } else {
                    // 直接覆蓋當前行的單元格
                    if (cells[cellIndex]) {
                        // 保留原始內容（包括換行），只去除首尾空白
                        cells[cellIndex].textContent = lineCells[i].replace(/^\s+|\s+$/g, '');
                    }
                }
            }
        }

        // 確保最後有一個空行供下次使用
        allRows = Array.from(tableBody.querySelectorAll('tr'));
        const lastRow = allRows[allRows.length - 1];
        const lastRowCells = lastRow.querySelectorAll('td');
        const hasEmptyRow = Array.from(lastRowCells).every(cell => !cell.textContent.trim());

        if (!hasEmptyRow) {
            const newRow = createTableRow();
            if (newRow) {
                tableBody.appendChild(newRow);
            }
        }

        // 更新所有行的序號
        updateRowNumbers();

        // 觸發表單驗證（貼上後可能新增了內容）
        checkFormValidity();

        // 清理空行
        cleanupEmptyRows();

        // 聚焦到最後一個有內容的單元格
        allRows = Array.from(tableBody.querySelectorAll('tr'));
        const lastProcessedRowIndex = startRowIndex + lines.length - 1;
        if (lastProcessedRowIndex < allRows.length) {
            const lastRow = allRows[lastProcessedRowIndex];
            const lastCells = lastRow.querySelectorAll('td');
            // 使用 CSV 解析函數處理最後一行
            const lastLineCells = parseCSVLine(lines[lines.length - 1]);
            // 計算最後一個有內容的欄位索引（從當前欄位開始）
            const lastFilledIndex = Math.min(currentCellIndex + lastLineCells.length - 1, columnCount - 1);
            if (lastCells[lastFilledIndex]) {
                lastCells[lastFilledIndex].focus();
            }
        }
    }

    /* 處理 Tab 鍵切換欄位 */
    function handleTabKey(event) {
        if (event.key !== 'Tab') return;

        const currentCell = event.target;
        const currentRow = currentCell.closest('tr');
        const cells = currentRow.querySelectorAll('td');
        const currentIndex = Array.from(cells).indexOf(currentCell);
        const columnCount = tableHeader ? tableHeader.querySelectorAll('th').length : 1;

        // 如果當前在序號欄位，不處理 Tab
        if (currentIndex === 0) return;

        if (event.shiftKey) {
            // Shift+Tab: 上一個欄位（跳過序號）
            if (currentIndex > 1) {
                event.preventDefault();
                cells[currentIndex - 1].focus();
            } else if (currentIndex === 1) {
                // 在測試問句欄位，Shift+Tab 不移動（避免移到序號）
                event.preventDefault();
            }
        } else {
            // Tab: 下一個欄位
            event.preventDefault();
            if (currentIndex < cells.length - 1) {
                // 同一行的下一個欄位
                cells[currentIndex + 1].focus();
            } else {
                // 最後一個欄位，創建新行並聚焦到第二個欄位（測試問句）
                const newRow = createTableRow();
                if (newRow) {
                    tableBody.insertBefore(newRow, currentRow.nextSibling);
                    updateRowNumbers();
                    // 聚焦到第二個欄位（測試問句，跳過序號）
                    const newCells = newRow.querySelectorAll('td');
                    if (newCells.length > 1 && newCells[1]) {
                        newCells[1].focus();
                    }
                }
            }
        }
    }

    /* 處理 Enter 鍵創建新行 */
    function handleEnterKey(event) {
        if (event.key !== 'Enter') return;

        const currentCell = event.target;
        const currentRow = currentCell.closest('tr');
        const columnCount = tableHeader ? tableHeader.querySelectorAll('th').length : 1;

        // 如果按 Shift+Enter，在當前單元格內換行
        if (event.shiftKey) {
            return; // 允許默認行為（在單元格內換行）
        }

        // Enter: 創建新行並聚焦到第一個欄位
        event.preventDefault();
        const newRow = createTableRow();
        if (newRow) {
            tableBody.insertBefore(newRow, currentRow.nextSibling);
            updateRowNumbers();
            // 聚焦到第二個欄位（測試問句，跳過序號）
            const cells = newRow.querySelectorAll('td');
            if (cells.length > 1 && cells[1]) {
                cells[1].focus();
            }
        }
    }

    /* 比對編號按鈕開關 */
    if (compareIndexBtn) {
        compareIndexBtn.addEventListener('click', () => {
            compareIndexEnabled = !compareIndexEnabled;
            if (compareIndexEnabled) {
                compareIndexBtn.classList.add('active');
                compareIndexBtn.dataset.enabled = 'true';
            } else {
                compareIndexBtn.classList.remove('active');
                compareIndexBtn.dataset.enabled = 'false';
            }
            // 更新全局變數
            if (typeof window !== 'undefined') {
                window.compareIndexEnabled = compareIndexEnabled;
            }
            /* removed debug log */
            updateTableColumns();
        });
    }

    /* 比對答案按鈕開關 */
    if (compareAnswerBtn) {
        compareAnswerBtn.addEventListener('click', () => {
            if (compareAnswerBtn.disabled) return;
            compareAnswerEnabled = !compareAnswerEnabled;
            if (compareAnswerEnabled) {
                compareAnswerBtn.classList.add('active');
                compareAnswerBtn.dataset.enabled = 'true';
            } else {
                compareAnswerBtn.classList.remove('active');
                compareAnswerBtn.dataset.enabled = 'false';
            }
            // 更新全局變數
            if (typeof window !== 'undefined') {
                window.compareAnswerEnabled = compareAnswerEnabled;
            }
            /* removed debug log */
            updateTableColumns();
            // 顯示/隱藏 AOAI 評分重試輸入框
            if (aoaiRetryFormItemEl) {
                aoaiRetryFormItemEl.style.display = compareAnswerEnabled ? 'block' : 'none';
            }
        });
    }

    /* 初始化表格欄位 */
    updateTableColumns();

    /* 初始化 AOAI 評分重試輸入框的顯示狀態 */
    if (aoaiRetryFormItemEl) {
        aoaiRetryFormItemEl.style.display = compareAnswerEnabled ? 'block' : 'none';
    }

    /* 創建彈出視窗元素 */
    let tooltip = null;
    let tooltipTimeout = null;
    let hideTimeout = null;

    function createTooltip() {
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'batch-cell-tooltip';
            document.body.appendChild(tooltip);

            // 設置 tooltip 的 hover 事件
            tooltip.addEventListener('mouseenter', () => {
                // 取消隱藏計時器
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
            });
            tooltip.addEventListener('mouseleave', () => {
                // 延遲隱藏，給用戶時間移動滑鼠
                scheduleHideTooltip();
            });
        }
        return tooltip;
    }

    function scheduleHideTooltip() {
        // 清除之前的隱藏計時器
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }
        // 延遲 200ms 隱藏，給用戶時間從 cell 移動到 tooltip
        hideTimeout = setTimeout(() => {
            hideTooltip();
            hideTimeout = null;
        }, 200);
    }

    function showTooltip(cell, content) {
        if (!content || !content.trim()) return;

        const tooltipEl = createTooltip();
        tooltipEl.textContent = content;
        tooltipEl.classList.remove('visible');

        // 計算位置 - 顯示在右側
        const rect = cell.getBoundingClientRect();
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;

        // 先顯示以計算尺寸
        tooltipEl.style.visibility = 'hidden';
        tooltipEl.style.display = 'block';
        tooltipEl.classList.add('visible');

        const tooltipRect = tooltipEl.getBoundingClientRect();
        // 顯示在右側，與單元格頂部對齊
        let left = rect.right + scrollX + 8;
        let top = rect.top + scrollY;

        // 確保不超出視窗右側
        if (left + tooltipRect.width > scrollX + window.innerWidth) {
            // 如果右側空間不足，顯示在左側
            left = rect.left + scrollX - tooltipRect.width - 8;
            // 如果左側也不足，則靠右對齊
            if (left < scrollX) {
                left = scrollX + window.innerWidth - tooltipRect.width - 8;
            }
        }
        // 確保不超出視窗上下
        if (top + tooltipRect.height > scrollY + window.innerHeight) {
            top = scrollY + window.innerHeight - tooltipRect.height - 8;
        }
        if (top < scrollY) {
            top = scrollY + 8;
        }

        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
        tooltipEl.style.visibility = 'visible';
    }

    function hideTooltip() {
        if (tooltip) {
            tooltip.classList.remove('visible');
        }
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    }

    /* 為表格單元格添加 hover 事件 */
    function setupCellHover() {
        if (!tableBody) return;

        let currentCell = null;

        // 安全版 closest，避免 target 不是 Element 時出錯
        function closestSafe(target, selector) {
            if (!target || typeof target.closest !== 'function') return null;
            try {
                return target.closest(selector);
            } catch (_) {
                return null;
            }
        }

        // 使用事件委託處理 hover
        tableBody.addEventListener('mouseenter', (event) => {
            const cell = closestSafe(event.target, 'td[contenteditable="true"]');
            if (!cell) {
                // 如果滑鼠移到 tooltip 上，不隱藏
                if (closestSafe(event.target, '.batch-cell-tooltip')) {
                    return;
                }
                // 取消隱藏計時器（如果滑鼠回到 cell）
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
                return;
            }

            // 取消隱藏計時器
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }

            currentCell = cell;
            const content = cell.textContent.trim();
            if (!content) {
                hideTooltip();
                return;
            }

            // 檢查內容是否超出單元格寬度（考慮省略號）
            const cellRect = cell.getBoundingClientRect();
            const isOverflow = cell.scrollWidth > cellRect.width || cell.offsetWidth < cell.scrollWidth;

            if (isOverflow) {
                // 延遲1秒後顯示
                tooltipTimeout = setTimeout(() => {
                    // 再次檢查是否仍在同一個 cell 上
                    if (currentCell === cell) {
                        showTooltip(cell, content);
                    }
                }, 1000);
            } else {
                hideTooltip();
            }
        }, true);

        tableBody.addEventListener('mouseleave', (event) => {
            const cell = closestSafe(event.target, 'td[contenteditable="true"]');
            const relatedTarget = event.relatedTarget;

            // 如果滑鼠移到 tooltip 上，不隱藏
            if (relatedTarget && closestSafe(relatedTarget, '.batch-cell-tooltip')) {
                return;
            }

            if (cell) {
                // 檢查滑鼠是否移到另一個 cell 上
                if (relatedTarget && closestSafe(relatedTarget, 'td[contenteditable="true"]')) {
                    currentCell = null;
                    return;
                }
                // 使用延遲隱藏，給用戶時間移動到 tooltip
                scheduleHideTooltip();
                currentCell = null;
            }
        }, true);

        // 為 tooltip 添加事件處理，確保滑鼠移到 tooltip 上時不消失
        document.addEventListener('mouseenter', (event) => {
            if (closestSafe(event.target, '.batch-cell-tooltip')) {
                // 滑鼠進入 tooltip，取消所有隱藏計時器
                if (tooltipTimeout) {
                    clearTimeout(tooltipTimeout);
                    tooltipTimeout = null;
                }
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
            }
        }, true);

        document.addEventListener('mouseleave', (event) => {
            if (closestSafe(event.target, '.batch-cell-tooltip')) {
                const relatedTarget = event.relatedTarget;
                // 如果滑鼠離開 tooltip 但沒有移到 cell 上，則延遲隱藏
                if (!relatedTarget || !closestSafe(relatedTarget, 'td[contenteditable="true"]')) {
                    scheduleHideTooltip();
                    currentCell = null;
                }
            }
        }, true);

    }

    setupCellHover();

    /* ------- Undo/Redo 與複製行為管控 ------- */
    let tableHistory = [];
    let tableHistoryIndex = -1;
    let historyDebounceId = null;

    function snapshotTable(pushEvenIfSame = false) {
        if (!tableBody) return;
        const html = tableBody.innerHTML;
        // 若目前索引不是最後，截斷後續（分叉）
        if (tableHistoryIndex < tableHistory.length - 1) {
            tableHistory = tableHistory.slice(0, tableHistoryIndex + 1);
        }
        if (!pushEvenIfSame) {
            const last = tableHistory[tableHistory.length - 1];
            if (last === html) return;
        }
        tableHistory.push(html);
        tableHistoryIndex = tableHistory.length - 1;
    }

    function debounceSnapshot() {
        if (historyDebounceId) clearTimeout(historyDebounceId);
        historyDebounceId = setTimeout(() => {
            snapshotTable();
        }, 250);
    }

    function restoreFromHistory(nextIndex) {
        if (!tableBody) return;
        if (nextIndex < 0 || nextIndex >= tableHistory.length) return;
        tableHistoryIndex = nextIndex;
        tableBody.innerHTML = tableHistory[tableHistoryIndex];
        // 邏輯性更新
        updateRowNumbers();
        checkFormValidity();
    }

    function undo() {
        if (tableHistoryIndex > 0) {
            restoreFromHistory(tableHistoryIndex - 1);
        }
    }

    function redo() {
        if (tableHistoryIndex < tableHistory.length - 1) {
            restoreFromHistory(tableHistoryIndex + 1);
        }
    }

    function ensureSingleEmptyRowIfAllCleared() {
        if (!tableBody) return;
        const editableCells = tableBody.querySelectorAll('td[contenteditable="true"]');
        const anyContent = Array.from(editableCells).some(c => c.textContent && c.textContent.trim().length > 0);
        if (!anyContent) {
            // 清空所有列並建立一列新的空列
            tableBody.innerHTML = '';
            const newRow = createTableRow();
            if (newRow) tableBody.appendChild(newRow);
            updateRowNumbers();
        }
    }

    // 首次快照（初始化完成後）
    snapshotTable(true);

    /* 全選所有單元格 */
    function selectAllCells() {
        if (!tableBody) return;
        const cells = tableBody.querySelectorAll('td[contenteditable="true"]');
        cells.forEach(cell => {
            cell.classList.add('cell-selected');
        });
    }

    /* 清除所有選中狀態 */
    function clearSelection() {
        if (!tableBody) return;
        const selectedCells = tableBody.querySelectorAll('td.cell-selected');
        selectedCells.forEach(cell => {
            cell.classList.remove('cell-selected');
        });
    }

    /* 刪除選中的單元格內容 */
    function deleteSelectedCells() {
        if (!tableBody) return;
        const selectedCells = tableBody.querySelectorAll('td.cell-selected');
        if (selectedCells.length > 0) {
            // 先記錄快照以支援 Undo
            snapshotTable();
            selectedCells.forEach(cell => {
                cell.textContent = '';
            });
            clearSelection();
            checkFormValidity();
            ensureSingleEmptyRowIfAllCleared();
            // 刪除後再記錄一次快照（同內容會被過濾）
            snapshotTable();
        }
    }

    // 監聽表格內容變化（使用事件委託，因為動態創建的行）
    if (tableBody) {
        // 監聽 input 事件（輸入時）
        tableBody.addEventListener('input', (event) => {
            // 確保是單元格輸入事件，且不是序號欄位
            if (event.target.tagName === 'TD' && event.target.contentEditable === 'true') {
                const row = event.target.closest('tr');
                const cells = row ? row.querySelectorAll('td') : [];
                const cellIndex = Array.from(cells).indexOf(event.target);
                // 序號欄位是第一個（index 0），跳過
                if (cellIndex !== 0) {
                    checkFormValidity();
                    // 延遲清理空行，避免在輸入過程中刪除
                    setTimeout(() => cleanupEmptyRows(), 500);
                    // 內容輸入變更加入快照（去抖）
                    debounceSnapshot();
                }
            }
        });

        // 監聽 blur 事件（失去焦點時也檢查一次）
        tableBody.addEventListener('blur', (event) => {
            if (event.target.tagName === 'TD' && event.target.contentEditable === 'true') {
                const row = event.target.closest('tr');
                const cells = row ? row.querySelectorAll('td') : [];
                const cellIndex = Array.from(cells).indexOf(event.target);
                if (cellIndex !== 0) {
                    checkFormValidity();
                    // 清理空行
                    setTimeout(() => cleanupEmptyRows(), 100);
                }
            }
        }, true);

        // 監聽貼上事件
        tableBody.addEventListener('paste', (e) => {
            // 貼上前快照
            snapshotTable();
            handleExcelPaste(e);
            // 貼上後快照
            snapshotTable();
        });

        // 進階複製：若使用者選了矩形 cell（僅類別標示，沒有文字反白），組成 TSV 推到剪貼簿
        tableBody.addEventListener('copy', (event) => {
            try {
                const sel = window.getSelection && window.getSelection();
                const hasTextSelection = sel && !sel.isCollapsed && String(sel) !== '';
                const selectedCells = Array.from(tableBody.querySelectorAll('td.cell-selected'));
                if (hasTextSelection || selectedCells.length === 0) {
                    // 有文字反白就交給瀏覽器原生複製
                    return;
                }

                event.preventDefault();

                function getCellPos(td) {
                    const row = td.closest('tr');
                    const rows = Array.from(tableBody.querySelectorAll('tr'));
                    const rowIndex = rows.indexOf(row);
                    const cols = row ? Array.from(row.querySelectorAll('td')) : [];
                    const colIndex = cols.indexOf(td);
                    return { rowIndex, colIndex };
                }

                // 計算矩形邊界
                let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
                const posMap = new Map();
                selectedCells.forEach(td => {
                    const pos = getCellPos(td);
                    posMap.set(td, pos);
                    if (pos.rowIndex >= 0 && pos.colIndex >= 0) {
                        minRow = Math.min(minRow, pos.rowIndex);
                        maxRow = Math.max(maxRow, pos.rowIndex);
                        minCol = Math.min(minCol, pos.colIndex);
                        maxCol = Math.max(maxCol, pos.colIndex);
                    }
                });
                if (!Number.isFinite(minRow) || !Number.isFinite(minCol)) return;

                const rows = Array.from(tableBody.querySelectorAll('tr'));
                const lines = [];
                for (let r = minRow; r <= maxRow; r++) {
                    const row = rows[r];
                    const cells = Array.from(row.querySelectorAll('td'));
                    const line = [];
                    for (let c = minCol; c <= maxCol; c++) {
                        const td = cells[c];
                        if (!td) { line.push(''); continue; }
                        // 只輸出可編輯欄（序號欄通常不可編輯）
                        const isEditable = td.getAttribute('contenteditable') === 'true';
                        line.push(isEditable ? (td.textContent || '').trim() : '');
                    }
                    lines.push(line.join('\t'));
                }
                const tsv = lines.join('\n');

                if (event.clipboardData && event.clipboardData.setData) {
                    event.clipboardData.setData('text/plain', tsv);
                } else if (window.clipboardData) {
                    window.clipboardData.setData('Text', tsv);
                }
            } catch (_) {
                // 忽略複製失敗，退回原生
            }
        });

        // 允許原生 copy/cut，支援從表格複製/剪下內容（不再攔截）

        // 監聽鍵盤事件（Tab、Enter、Ctrl+A、Delete、Backspace）
        tableBody.addEventListener('keydown', (event) => {
            handleTabKey(event);
            handleEnterKey(event);

            // Undo / Redo
            if (event.ctrlKey && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
                event.preventDefault();
                undo();
                return;
            }
            if ((event.ctrlKey && (event.key === 'y' || event.key === 'Y')) || (event.ctrlKey && event.shiftKey && (event.key === 'z' || event.key === 'Z'))) {
                event.preventDefault();
                redo();
                return;
            }

            // Ctrl+A: 全選
            if (event.ctrlKey && event.key === 'a') {
                event.preventDefault();
                selectAllCells();
            }

            // Delete 或 Backspace: 刪除選中的單元格內容
            if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.altKey) {
                const selectedCells = tableBody.querySelectorAll('td.cell-selected');
                if (selectedCells.length > 0) {
                    event.preventDefault();
                    deleteSelectedCells();
                }
            }
        });

        // 支持拖選和點選
        let isSelecting = false;
        let startCell = null;
        let startPos = null; // { rowIndex, colIndex }
        let hasMoved = false;

        tableBody.addEventListener('mousedown', (event) => {
            if (event.target.tagName === 'TD') {
                isSelecting = true;
                hasMoved = false;
                startCell = event.target;
                // 記錄起點位置（row/col）
                const startRow = startCell.closest('tr');
                const rows = Array.from(tableBody.querySelectorAll('tr'));
                const rowIndex = rows.indexOf(startRow);
                const cols = startRow ? Array.from(startRow.querySelectorAll('td')) : [];
                const colIndex = cols.indexOf(startCell);
                startPos = { rowIndex, colIndex };

                // 如果沒有按住 Ctrl 或 Shift，清除之前的選中
                if (!event.ctrlKey && !event.shiftKey) {
                    clearSelection();
                }

                // 如果按住 Ctrl，切換選中狀態
                if (event.ctrlKey) {
                    if (event.target.classList.contains('cell-selected')) {
                        event.target.classList.remove('cell-selected');
                    } else {
                        event.target.classList.add('cell-selected');
                    }
                } else {
                    event.target.classList.add('cell-selected');
                }
            }
        });

        tableBody.addEventListener('mousemove', (event) => {
            if (isSelecting && event.target.tagName === 'TD' && startCell && startPos) {
                hasMoved = true;
                clearSelection();

                const currentCell = event.target;
                const currentRow = currentCell.closest('tr');
                const rows = Array.from(tableBody.querySelectorAll('tr'));
                const endRowIndex = rows.indexOf(currentRow);

                if (endRowIndex === -1 || startPos.rowIndex === -1) return;

                const startRow = rows[startPos.rowIndex];
                const endRow = rows[endRowIndex];
                const startRowCells = startRow ? Array.from(startRow.querySelectorAll('td')) : [];
                const endRowCells = endRow ? Array.from(endRow.querySelectorAll('td')) : [];
                const endColIndex = endRowCells.indexOf(currentCell);

                if (endColIndex === -1 || startPos.colIndex === -1) return;

                const rowStart = Math.min(startPos.rowIndex, endRowIndex);
                const rowEnd = Math.max(startPos.rowIndex, endRowIndex);
                const colStart = Math.min(startPos.colIndex, endColIndex);
                const colEnd = Math.max(startPos.colIndex, endColIndex);

                // 以矩形方式選取，且僅選擇 contenteditable 的儲存格（通常排除序號欄位）
                for (let r = rowStart; r <= rowEnd; r++) {
                    const row = rows[r];
                    const cells = Array.from(row.querySelectorAll('td'));
                    for (let c = colStart; c <= colEnd; c++) {
                        const td = cells[c];
                        if (!td) continue;
                        const isEditable = td.getAttribute('contenteditable') === 'true';
                        if (isEditable) {
                            td.classList.add('cell-selected');
                        }
                    }
                }
            }
        });

        tableBody.addEventListener('mouseup', (event) => {
            if (!hasMoved && event.target.tagName === 'TD' && !event.ctrlKey && !event.shiftKey) {
                // 單擊且沒有拖動，清除其他選中，只選中當前單元格
                clearSelection();
                event.target.classList.add('cell-selected');
            }
            isSelecting = false;
            startCell = null;
            startPos = null;
            hasMoved = false;
        });
    }

    submitBtn.addEventListener('click', async () => {
        if (submitBtn.dataset.mode === 'continue') {
            submitBtn.dataset.mode = 'idle';
            const idleLabel = submitBtn.dataset.initialLabel || '開始測試';
            submitBtn.textContent = idleLabel;

            const formWrapperElReset = document.querySelector('.batch-form-wrapper');
            if (formWrapperElReset) {
                formWrapperElReset.classList.remove('testing');
            }
            if (typeof contentLayoutEl !== 'undefined' && contentLayoutEl) {
                contentLayoutEl.classList.remove('testing');
            }
            if (feedbackDetailsEl) {
                feedbackDetailsEl.innerHTML = '';
            }
            if (progressBarEl) {
                progressBarEl.style.width = '0%';
            }
            if (feedbackTextEl) {
                feedbackTextEl.textContent = '';
            }
            hideFeedback();
            checkFormValidity();
            if (contentTextareaEl && !contentTextareaEl.disabled) {
                contentTextareaEl.focus();
            }
            return;
        }

        const selectedChannel = channelSelectEl.options[channelSelectEl.selectedIndex]?.textContent || '';

        // 從表格或 textarea 讀取內容
        let questions = [];
        let tableData = [];

        if (tableContainer && tableContainer.style.display !== 'none') {
            // 從表格讀取
            tableData = getTableData();
            questions = tableData.map(row => row.question).filter(q => q.trim().length > 0);
        } else {
            // 從 textarea 讀取
            const content = contentTextareaEl.value.trim();
            questions = content.split('\n').filter(q => q.trim().length > 0);
            // 轉換為 tableData 格式以便統一處理
            tableData = questions.map(q => ({ question: q, expectedIndex: '', expectedAnswer: '' }));
        }

        if (questions.length === 0) {
            alert('請輸入至少一個問題');
            return;
        }

        submitBtn.dataset.initialLabel = submitBtn.dataset.initialLabel || submitBtn.textContent;
        submitBtn.dataset.mode = 'running';
        submitBtn.disabled = true;
        submitBtn.textContent = '處理中...';
        let runSucceeded = false;

        /* 調整表單區塊位置與寬度（置於左上角，寬 20%） */
        const formWrapperEl = document.querySelector('.batch-form-wrapper');
        if (formWrapperEl && !formWrapperEl.classList.contains('testing')) {
            formWrapperEl.classList.add('testing');
        }
        if (typeof contentLayoutEl !== 'undefined' && contentLayoutEl && !contentLayoutEl.classList.contains('testing')) {
            contentLayoutEl.classList.add('testing');
        }

        /* 清除之前的 hideFeedback timeout，避免閃爍 */
        if (hideFeedbackTimeoutId) {
            clearTimeout(hideFeedbackTimeoutId);
            hideFeedbackTimeoutId = null;
        }

        /* 開始新一輪測試：清空舊的詳情與重置進度條 */
        if (feedbackDetailsEl) {
            feedbackDetailsEl.innerHTML = '';
        }
        if (progressBarEl) {
            progressBarEl.style.width = '0%';
        }

        /* 顯示反饋區域 */
        showFeedback(`開始處理 ${questions.length} 個問題...`, 'info');
        updateProgress(0, questions.length);

        batchSessionActive = true;
        latestTenantName = CEXT.getTenantName() || window.tenantName || '';
        latestTotalQuestions = questions.length;
        latestBatchResultsSnapshot = [];
        latestBatchLogsSnapshot = [];
        latestUnresolvedCount = 0;
        currentBatchId = generateBatchId(latestTenantName);
        batchCreatedAtIso = new Date().toISOString();

        if (batchStorageReadyPromise) {
            try {
                await persistBatchSnapshot('in_progress', {
                    skipEntries: true,
                    skipLogs: true,
                    unresolvedCount: 0,
                    partial: true
                });
            } catch (error) {
                console.warn('初始化批次儲存快照失敗:', error);
            }
        }

        postBatchMessage('batch-start', {
            tenantName: latestTenantName,
            totalQuestions: latestTotalQuestions,
            timestamp: batchCreatedAtIso,
            batchId: currentBatchId
        });

        try {
            /* 判斷使用哪種 API */
            const apiType = getApiType();

            /* 提取渠道資訊 */
            const { channelName, apikey } = extractChannelInfo(selectedChannel);

            /* 儲存結果與日誌 */
            const resultEntries = new Array(questions.length);
            const batchLogs = [];
            const logPaths = getLogFilePaths();
            const unresolvedIndices = new Set();

            /* 預先建立詳細反饋項目 */
            questions.forEach((question, index) => {
                addFeedbackDetail(`${index + 1}. ${question.substring(0, 50)}${question.length > 50 ? '...' : ''}`, 'processing');
            });

            const DEFAULT_CONCURRENCY = 5;
            const rawConcurrency = concurrencyInputEl ? parseInt(concurrencyInputEl.value, 10) : NaN;
            const normalizedConcurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0
                ? Math.min(Math.max(rawConcurrency, 1), 50)
                : DEFAULT_CONCURRENCY;
            const concurrencyLimit = Math.max(1, Math.min(normalizedConcurrency, questions.length));

            const DEFAULT_RETRY = 1;
            const rawRetryCount = retryCountInputEl ? parseInt(retryCountInputEl.value, 10) : NaN;
            const normalizedRetryCount = Number.isFinite(rawRetryCount) && rawRetryCount >= 0
                ? Math.min(Math.max(rawRetryCount, 0), 5)
                : DEFAULT_RETRY;

            const retryAnswerBySets = buildRetryAnswerBySets();

            // 重置評分隊列
            scoringQueue.queue = [];
            scoringQueue.processing = false;
            scoringQueue.processedCount = 0;
            scoringQueue.totalCount = 0;

            let completedCount = 0;

            async function handleQuestion(index, attemptInfo) {
                const question = questions[index].trim();
                const requestTime = new Date().toISOString();
                const prefix = attemptInfo.isRetry ? `重跑第${attemptInfo.attemptNumber}次 ` : '';

                if (attemptInfo.isRetry) {
                    updateFeedbackDetail(index, 'processing');
                }

                showFeedback(`${prefix}正在處理 ${index + 1}/${questions.length}: ${question.substring(0, 30)}${question.length > 30 ? '...' : ''}`, 'info');

                let needsRetry = false;

                try {
                    let apiResponse;

                    if (apiType === 'kms') {
                        apiResponse = await chatsAjax(question);
                    } else if (apiType === 'genai') {
                        apiResponse = await genaiAsk(question);
                    } else {
                        if (!apikey || !channelName) {
                            throw new Error('請選擇渠道（需要 channel 和 apikey）');
                        }
                        apiResponse = await qaAsk(question, channelName, apikey);
                    }

                    const responseText = apiResponse?.responseText || '';
                    const responseTime = new Date().toISOString();

                    /* 處理 GenAI 的參考文件 */
                    let references = [];
                    if (apiType === 'genai' && apiResponse?.references) {
                        references = apiResponse.references;
                    }

                    const analysis = analyzeAnswerBy(responseText, retryAnswerBySets);

                    needsRetry = attemptInfo.shouldEvaluateRetry
                        ? analysis.needsRetry
                        : false;

                    if (needsRetry) {
                        unresolvedIndices.add(index);
                        const detailMessage = attemptInfo.isFinalAttempt
                            ? '重跑已達上限，仍無 AnswerBy'
                            : '__AnswerBy__ 缺少結果，將重跑';
                        updateFeedbackDetail(index, 'error', detailMessage);
                    } else {
                        unresolvedIndices.delete(index);
                        updateFeedbackDetail(index, 'completed');
                    }

                    // 獲取對應的預期編號和預期答案
                    const tableRow = tableData[index] || {};
                    const expectedIndex = tableRow.expectedIndex || '';
                    const expectedAnswer = tableRow.expectedAnswer || '';

                    const isNewEntry = !resultEntries[index];
                    const existingEntry = resultEntries[index] || {
                        id: index + 1,
                        question,
                        expectedIndex: '',
                        expectedAnswer: '',
                        tailLog: '',
                        testTime: requestTime,
                        bestAnswerBy: null
                    };

                    // 確保預期編號和預期答案被保留
                    // 如果是新條目，直接設置；如果是已存在的條目，只在沒有值時設置
                    if (isNewEntry) {
                        existingEntry.expectedIndex = expectedIndex;
                        existingEntry.expectedAnswer = expectedAnswer;
                    } else {
                        if (expectedIndex && (!existingEntry.expectedIndex || existingEntry.expectedIndex === '')) {
                            existingEntry.expectedIndex = expectedIndex;
                        }
                        if (expectedAnswer && (!existingEntry.expectedAnswer || existingEntry.expectedAnswer === '')) {
                            existingEntry.expectedAnswer = expectedAnswer;
                        }
                    }

                    if (!existingEntry.testTime) {
                        existingEntry.testTime = requestTime;
                    }

                    existingEntry.responseTime = responseTime;
                    existingEntry.batchId = attemptInfo.attemptLabel || 'initial';

                    const candidateRecord = createAnswerRecord(analysis, responseText);
                    existingEntry.bestAnswerBy = selectBetterAnswer(existingEntry.bestAnswerBy, candidateRecord);
                    const chosenRecord = existingEntry.bestAnswerBy || candidateRecord;

                    existingEntry.responseText = chosenRecord?.responseText ?? responseText;
                    existingEntry.matchedAnswerBy = chosenRecord?.value ?? '';
                    existingEntry.answerByPriority = chosenRecord?.priority ?? analysis.priority ?? 3;

                    /* 添加 GenAI 參考文件欄位 */
                    if (references && references.length > 0) {
                        /* 將參考文件陣列轉換為欄位格式（參考文件1、參考文件2等） */
                        references.forEach((ref, idx) => {
                            const fieldName = `參考文件${idx + 1}`;
                            existingEntry[fieldName] = ref;
                        });
                    }

                    // 使用 bestAnswerBy 來判斷是否需要評分（因為 bestAnswerBy 會選擇最適合的答案）
                    // 如果回答成功，或到達重跑上限，都檢查 bestAnswerBy 是否為 "no answer"
                    const shouldCheckScoring = !needsRetry || attemptInfo.isFinalAttempt;

                    if (shouldCheckScoring) {
                        // 檢查 bestAnswerBy 是否為 "no answer" 或排除的 rule
                        const bestAnswerByValue = (existingEntry.bestAnswerBy?.value || existingEntry.bestAnswerBy?.normalized || '').trim().toLowerCase();
                        const defaultSet = retryAnswerBySets.defaultSet;
                        const isNoAnswer = defaultSet.has(bestAnswerByValue);

                        // 只有在 bestAnswerBy 不是 "no answer" 時才加入評分隊列
                        if (!isNoAnswer && existingEntry.bestAnswerBy) {
                            // 使用 bestAnswerBy 的 responseText 來提取 answer
                            const bestResponseText = existingEntry.bestAnswerBy.responseText || existingEntry.responseText || '';
                            const answer = extractAnswerFromResponse(bestResponseText);

                            // 將評分任務加入隊列（會在背景順序處理）
                            enqueueScoringTask(existingEntry, answer);
                        }
                    }

                    resultEntries[index] = existingEntry;
                } catch (error) {
                    unresolvedIndices.add(index);

                    // 獲取對應的預期編號和預期答案
                    const tableRow = tableData[index] || {};
                    const expectedIndex = tableRow.expectedIndex || '';
                    const expectedAnswer = tableRow.expectedAnswer || '';

                    const existingEntry = resultEntries[index] || {
                        id: index + 1,
                        question,
                        expectedIndex,
                        expectedAnswer,
                        tailLog: '',
                        testTime: requestTime,
                        bestAnswerBy: null
                    };

                    // 確保預期編號和預期答案被保留（如果沒有設置過，或當前有值則更新）
                    if (expectedIndex && (!existingEntry.expectedIndex || existingEntry.expectedIndex === '')) {
                        existingEntry.expectedIndex = expectedIndex;
                    }
                    if (expectedAnswer && (!existingEntry.expectedAnswer || existingEntry.expectedAnswer === '')) {
                        existingEntry.expectedAnswer = expectedAnswer;
                    }
                    // 如果 existingEntry 是新創建的，直接設置
                    if (!resultEntries[index]) {
                        existingEntry.expectedIndex = expectedIndex;
                        existingEntry.expectedAnswer = expectedAnswer;
                    }

                    if (!existingEntry.testTime) {
                        existingEntry.testTime = requestTime;
                    }

                    existingEntry.responseTime = new Date().toISOString();
                    existingEntry.batchId = attemptInfo.attemptLabel || 'initial';
                    existingEntry.error = error?.message || String(error);

                    if (!existingEntry.bestAnswerBy) {
                        const fallbackResponseText = existingEntry.responseText || `錯誤: ${error.message || String(error)}`;
                        existingEntry.bestAnswerBy = {
                            value: '',
                            normalized: '',
                            priority: 3,
                            responseText: fallbackResponseText
                        };
                    }

                    existingEntry.responseText = existingEntry.bestAnswerBy?.responseText || existingEntry.responseText;
                    existingEntry.matchedAnswerBy = existingEntry.bestAnswerBy?.value ?? '';
                    existingEntry.answerByPriority = existingEntry.bestAnswerBy?.priority ?? 3;

                    // 在錯誤情況下，如果是最終嘗試且有 bestAnswerBy，也檢查是否需要評分
                    if (attemptInfo.isFinalAttempt && existingEntry.bestAnswerBy) {
                        const bestAnswerByValue = (existingEntry.bestAnswerBy?.value || existingEntry.bestAnswerBy?.normalized || '').trim().toLowerCase();
                        const defaultSet = retryAnswerBySets.defaultSet;
                        const isNoAnswer = defaultSet.has(bestAnswerByValue);

                        // 只有在 bestAnswerBy 不是 "no answer" 時才加入評分隊列
                        if (!isNoAnswer) {
                            const bestResponseText = existingEntry.bestAnswerBy.responseText || existingEntry.responseText || '';
                            const answer = extractAnswerFromResponse(bestResponseText);
                            enqueueScoringTask(existingEntry, answer);
                        }
                    }

                    resultEntries[index] = existingEntry;
                    updateFeedbackDetail(index, 'error', error.message || error);
                    needsRetry = false;
                } finally {
                    if (attemptInfo.updateProgress) {
                        completedCount += 1;
                        updateProgress(completedCount, questions.length);
                    }

                    if (attemptInfo.updateProgress && completedCount < questions.length) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                const shouldRequeue = needsRetry && !attemptInfo.isFinalAttempt;
                return { index, needsRetry: shouldRequeue };
            }

            async function processIndices(indices, attemptInfo) {
                if (!indices || indices.length === 0) {
                    return new Set();
                }

                const sortedIndices = Array.from(indices).sort((a, b) => a - b);
                const nextRetryIndices = new Set();

                for (let start = 0; start < sortedIndices.length; start += concurrencyLimit) {
                    const batchIndices = sortedIndices.slice(start, start + concurrencyLimit);
                    const rangeStart = batchIndices[0] + 1;
                    const rangeEnd = batchIndices[batchIndices.length - 1] + 1;

                    const beforeSnapshot = await getLogSnapshot(logPaths);
                    const beforeSize = beforeSnapshot.size;

                    const results = await Promise.all(
                        batchIndices.map(index => handleQuestion(index, attemptInfo))
                    );

                    await new Promise(resolve => setTimeout(resolve, LOG_WRITE_DELAY_MS));

                    const afterSnapshot = await getLogSnapshot(logPaths);
                    const afterSize = afterSnapshot.size;
                    const sizeDiff = Math.max(afterSize - beforeSize, 0);

                    let tailContent = '';
                    let tailError = null;
                    if (sizeDiff > 0) {
                        const tailResult = await fetchLogTailContent(beforeSize, sizeDiff);
                        tailContent = tailResult.content;
                        tailError = tailResult.error;
                    }

                    const fileName = buildBatchLogFileName(rangeStart, rangeEnd, attemptInfo.attemptLabel);
                    const logFileContent = buildLogFileContent({
                        rangeStart,
                        rangeEnd,
                        beforeSize,
                        afterSize,
                        sizeDiff,
                        beforeError: beforeSnapshot.error,
                        afterError: afterSnapshot.error,
                        attemptLabel: attemptInfo.attemptLabel
                    }, tailContent, tailError);

                    batchLogs.push({
                        fileName,
                        content: logFileContent,
                        rangeStart,
                        rangeEnd,
                        attemptLabel: attemptInfo.attemptLabel
                    });

                    const relativePath = `logs/${fileName}`;
                    batchIndices.forEach(idx => {
                        if (resultEntries[idx]) {
                            resultEntries[idx].tailLog = relativePath;
                        }
                    });

                    latestBatchResultsSnapshot = resultEntries.filter(entry => !!entry);
                    latestBatchLogsSnapshot = batchLogs.slice();
                    latestUnresolvedCount = unresolvedIndices.size;

                    /* 如果是 GenAI 類型，從 logs 中提取 Body JSON 和解析參考文件 */
                    if (apiType === 'genai') {
                        /* 先提取 Body JSON 到結果條目 */
                        if (typeof extractGenAIBodyJSONFromLogs === 'function') {
                            extractGenAIBodyJSONFromLogs(latestBatchResultsSnapshot, latestBatchLogsSnapshot);
                        }
                        /* 然後解析參考文件 */
                        if (typeof parseGenAIReferencesFromLogs === 'function') {
                            parseGenAIReferencesFromLogs(latestBatchResultsSnapshot, latestBatchLogsSnapshot);
                        }
                    }

                    // 批次完成後，處理該批次的評分任務（逐一執行，等待完成後才繼續下一組）
                    if (scoringQueue.queue.length > 0) {
                        // 記錄當前批次的評分任務數量
                        const batchScoringCount = scoringQueue.queue.length;
                        showFeedback(`批次 ${rangeStart}-${rangeEnd} 完成，開始進行 AOAI 評分（${batchScoringCount} 個任務）...`, 'info', true);

                        // 等待該批次的評分任務完成（逐一執行，不併發）
                        // 傳入 resultEntries 引用以便更新
                        await processScoringQueue(resultEntries);

                        showFeedback(`批次 ${rangeStart}-${rangeEnd} 的 AOAI 評分已完成`, 'success', true);
                    }

                    if (batchStorageReadyPromise) {
                        try {
                            await persistBatchSnapshot('in_progress', {
                                unresolvedCount: latestUnresolvedCount,
                                partial: true
                            });
                        } catch (error) {
                            console.warn('更新批次快照失敗:', error);
                        }
                    }

                    postBatchMessage('batch-progress', {
                        tenantName: latestTenantName,
                        totalQuestions: latestTotalQuestions,
                        timestamp: new Date().toISOString(),
                        range: {
                            start: rangeStart,
                            end: rangeEnd,
                            attempt: attemptInfo.attemptLabel || 'initial'
                        },
                        results: latestBatchResultsSnapshot,
                        logs: latestBatchLogsSnapshot
                    });

                    // 在發送消息後清理快照以釋放記憶體，數據已經存儲在 IndexedDB 中
                    latestBatchResultsSnapshot = [];
                    latestBatchLogsSnapshot = [];

                    results.forEach(result => {
                        if (result && result.needsRetry) {
                            nextRetryIndices.add(result.index);
                        }
                    });

                    const attemptPrefix = attemptInfo.isRetry ? `重跑第${attemptInfo.attemptNumber}次 ` : '';
                    showFeedback(`${attemptPrefix}批次 ${rangeStart}-${rangeEnd} 完成，日誌差值 ${sizeDiff} bytes`, 'info', true);

                }

                return nextRetryIndices;
            }

            const initialIndices = questions.map((_, idx) => idx);
            const initialAttemptInfo = {
                attemptLabel: '',
                attemptNumber: 0,
                isRetry: false,
                updateProgress: true,
                shouldEvaluateRetry: true,
                isFinalAttempt: normalizedRetryCount === 0
            };

            let retryIndices = await processIndices(initialIndices, initialAttemptInfo);

            for (let retryAttempt = 1; retryAttempt <= normalizedRetryCount && retryIndices.size > 0; retryAttempt++) {
                showFeedback(`開始重跑第 ${retryAttempt} 次，待處理 ${retryIndices.size} 題`, 'info');
                const attemptInfo = {
                    attemptLabel: `retry${retryAttempt}`,
                    attemptNumber: retryAttempt,
                    isRetry: true,
                    updateProgress: false,
                    shouldEvaluateRetry: true,
                    isFinalAttempt: retryAttempt === normalizedRetryCount
                };
                retryIndices = await processIndices(retryIndices, attemptInfo);
            }

            if (unresolvedIndices.size > 0) {
                showFeedback(`仍有 ${unresolvedIndices.size} 題缺少 AnswerBy，請手動檢查`, 'error', true);
            }

            // 重跑完成後，檢查所有達到上限的 entries，確保 bestAnswerBy 也會被評分
            if (normalizedRetryCount > 0) {
                const retryAnswerBySets = buildRetryAnswerBySets();
                const defaultSet = retryAnswerBySets.defaultSet;

                resultEntries.forEach((entry, index) => {
                    if (!entry || !entry.bestAnswerBy) return;

                    // 檢查是否已經有評分（避免重複）
                    if (entry.aoaiScore !== undefined) return;

                    // 檢查 bestAnswerBy 是否為 "no answer"
                    const bestAnswerByValue = (entry.bestAnswerBy?.value || entry.bestAnswerBy?.normalized || '').trim().toLowerCase();
                    const isNoAnswer = defaultSet.has(bestAnswerByValue);

                    // 只有在 bestAnswerBy 不是 "no answer" 且有預期答案時才加入評分隊列
                    if (!isNoAnswer && entry.expectedAnswer && entry.expectedAnswer.trim() !== '') {
                        const bestResponseText = entry.bestAnswerBy.responseText || entry.responseText || '';
                        const answer = extractAnswerFromResponse(bestResponseText);
                        enqueueScoringTask(entry, answer);
                    }
                });
            }

            latestBatchResultsSnapshot = resultEntries.filter(entry => !!entry);
            latestBatchLogsSnapshot = batchLogs.slice();
            latestUnresolvedCount = unresolvedIndices.size;

            if (batchStorageReadyPromise) {
                try {
                    await persistBatchSnapshot('in_progress', {
                        unresolvedCount: latestUnresolvedCount
                    });
                } catch (error) {
                    console.warn('更新最終批次快照失敗:', error);
                }
            }

            postBatchMessage('batch-progress', {
                tenantName: latestTenantName,
                totalQuestions: latestTotalQuestions,
                timestamp: new Date().toISOString(),
                status: 'pre-final',
                results: latestBatchResultsSnapshot,
                logs: latestBatchLogsSnapshot
            });

            // 在發送消息後清理快照以釋放記憶體，數據已經存儲在 IndexedDB 中
            latestBatchResultsSnapshot = [];
            latestBatchLogsSnapshot = [];

            showFeedback(`處理完成，共 ${resultEntries.length} 個結果，正在整理資料...`, 'info');
            updateProgress(questions.length, questions.length);

            // 處理最後一批評分任務（如果還有剩餘）
            if (scoringQueue.queue.length > 0) {
                showFeedback(`處理最後一批 AOAI 評分（剩餘 ${scoringQueue.queue.length} 個任務）...`, 'info', true);
                // 傳入 resultEntries 引用以便更新
                await processScoringQueue(resultEntries);
                showFeedback('所有 AOAI 評分已完成', 'success', true);
            }

            // 更新最終快照（包含所有 AOAI 評分結果和 logs）
            latestBatchResultsSnapshot = resultEntries.filter(entry => !!entry);
            // 確保 logs 也被更新到最終快照
            latestBatchLogsSnapshot = batchLogs.slice();

            if (batchStorageReadyPromise) {
                try {
                    await persistBatchSnapshot('completed', {
                        unresolvedCount: latestUnresolvedCount,
                        partial: false,
                        downloaded: false
                    });

                    // 測試完成後，執行 getIdQuestionMap 並存到 IndexedDB
                    if (currentBatchId && typeof getIdQuestionMap === 'function' && typeof groovyCaller === 'function') {
                        try {
                            showFeedback('正在取得問題映射表...', 'info');
                            const getIdQuestionMapScript = getIdQuestionMap();
                            const idToQuestionMapResult = await groovyCaller(getIdQuestionMapScript);

                            if (idToQuestionMapResult && idToQuestionMapResult.idToQuestionMap &&
                                typeof CEXTBatchStorage !== 'undefined' &&
                                typeof CEXTBatchStorage.saveIdToQuestionMap === 'function') {
                                const domain = CEXT.getDomain();
                                await CEXTBatchStorage.saveIdToQuestionMap(currentBatchId, idToQuestionMapResult.idToQuestionMap, latestTenantName, domain);
                                showFeedback('問題映射表已儲存', 'success', true);
                            } else {
                                console.warn('getIdQuestionMap 返回格式不正確或 CEXTBatchStorage 不可用');
                            }
                        } catch (error) {
                            console.warn('取得或儲存問題映射表失敗:', error);
                            // 不影響主流程，只記錄警告
                        }
                    }
                } catch (error) {
                    console.warn('標記批次完成儲存失敗:', error);
                }
            }

            showFeedback(`已通知主頁下載 ZIP...`, 'info');
            postBatchMessage('batch-complete', {
                tenantName: latestTenantName,
                totalQuestions: latestTotalQuestions,
                timestamp: new Date().toISOString(),
                unresolvedCount: unresolvedIndices.size,
                results: latestBatchResultsSnapshot,
                logs: latestBatchLogsSnapshot
            });

            // 在發送消息後清理快照以釋放記憶體，數據已經存儲在 IndexedDB 中
            latestBatchResultsSnapshot = [];
            latestBatchLogsSnapshot = [];

            showFeedback(`完成！請確認 ZIP 下載結果，共 ${questions.length} 個測試問句`, 'success', true);
            runSucceeded = true;

        } catch (error) {
            showFeedback(`錯誤: ${error.message || error}`, 'error');
            alert('處理失敗: ' + (error.message || error));
            latestUnresolvedCount = unresolvedIndices.size;
            if (batchStorageReadyPromise) {
                try {
                    await persistBatchSnapshot('error', {
                        lastError: error?.message || String(error),
                        partial: true,
                        unresolvedCount: latestUnresolvedCount
                    });
                } catch (persistError) {
                    console.warn('儲存錯誤批次快照失敗:', persistError);
                }
            }
            postBatchMessage('batch-error', {
                tenantName: latestTenantName,
                totalQuestions: latestTotalQuestions,
                timestamp: new Date().toISOString(),
                message: error?.message || String(error),
                results: latestBatchResultsSnapshot,
                logs: latestBatchLogsSnapshot
            });

            // 在發送消息後清理快照以釋放記憶體，數據已經存儲在 IndexedDB 中
            latestBatchResultsSnapshot = [];
            latestBatchLogsSnapshot = [];
        } finally {
            batchSessionActive = false;
            submitBtn.disabled = false;
            const idleLabel = submitBtn.dataset.initialLabel || '開始測試';

            if (runSucceeded) {
                submitBtn.dataset.mode = 'continue';
                submitBtn.textContent = '繼續測試';
            } else {
                submitBtn.dataset.mode = 'idle';
                submitBtn.textContent = idleLabel;

                const formWrapperElReset = document.querySelector('.batch-form-wrapper');
                if (formWrapperElReset) {
                    formWrapperElReset.classList.remove('testing');
                }
                if (typeof contentLayoutEl !== 'undefined' && contentLayoutEl) {
                    contentLayoutEl.classList.remove('testing');
                }

                hideFeedback();
                if (feedbackDetailsEl) {
                    feedbackDetailsEl.innerHTML = '';
                }
                if (progressBarEl) {
                    progressBarEl.style.width = '0%';
                }
                if (feedbackTextEl) {
                    feedbackTextEl.textContent = '';
                }
            }

            if (batchStorageReadyPromise && currentBatchId &&
                latestBatchStatus !== 'completed' && latestBatchStatus !== 'error') {
                try {
                    await persistBatchSnapshot('stopped', {
                        unresolvedCount: latestUnresolvedCount,
                        partial: true
                    });
                } catch (error) {
                    console.warn('更新批次停止狀態失敗:', error);
                }
            }
            postBatchMessage('batch-finished', {
                tenantName: latestTenantName,
                totalQuestions: latestTotalQuestions,
                timestamp: new Date().toISOString(),
                results: latestBatchResultsSnapshot,
                logs: latestBatchLogsSnapshot
            });

            // 在發送消息後清理快照以釋放記憶體，數據已經存儲在 IndexedDB 中
            latestBatchResultsSnapshot = [];
            latestBatchLogsSnapshot = [];

            if (typeof refreshPendingBatchSnapshots === 'function') {
                try {
                    refreshPendingBatchSnapshots();
                } catch (error) {
                    console.warn('刷新暫存批次列表失敗:', error);
                }
            }
            if (typeof refreshDownloadHistory === 'function') {
                try {
                    refreshDownloadHistory();
                } catch (error) {
                    console.warn('刷新歷史批次列表失敗:', error);
                }
            }

            if (runSucceeded && submitBtn.dataset.mode === 'continue') {
                submitBtn.focus();
            } else {
                checkFormValidity();
                if (contentTextareaEl && !contentTextareaEl.disabled) {
                    contentTextareaEl.focus();
                }
            }
        }
    });

    if (contentTextareaEl && !contentTextareaEl.disabled) {
        contentTextareaEl.focus();
    }
});