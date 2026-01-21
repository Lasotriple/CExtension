/* 匯出與打包函數 */

if (typeof CEXTExportUtils === 'undefined') {
    throw new Error('CEXTExportUtils 未載入');
}

/**
 * 解析 AOAI 評分結果
 * 格式：[85%]：[符合預期]：[AI 回答了用戶疑問，但未提及臨時選位費用的細節]
 * @param {string} resultStr - AOAI 評分結果字串
 * @returns {{original: string, score: string, interval: string, reason: string}} - 解析後的結果
 */
function parseAOAIScoringResult(resultStr) {
    return CEXTExportUtils.parseAOAIScoringResult(resultStr);
}

/**
 * 從 entry 物件中提取所有需要的欄位（對應 analyzeResult.py 的 extract_fields）
 * @param {Object} entry - 測試結果 entry 物件
 * @returns {Object} - 提取後的欄位物件
 */
/**
 * 清理字串值，確保適合 Excel 使用
 * @param {any} value - 要清理的值
 * @returns {string} - 清理後的字串
 */
function sanitizeValueForExcel(value) {
    return CEXTExportUtils.sanitizeValueForExcel(value);
}

// ===== TopN 解析相關 =====
function normalizeTextBasic(value) {
    return CEXTExportUtils.normalizeTextBasic
        ? CEXTExportUtils.normalizeTextBasic(value)
        : '';
}

function normalizeForCompare(value) {
    return CEXTExportUtils.normalizeForCompare
        ? CEXTExportUtils.normalizeForCompare(value)
        : normalizeTextBasic(value).replace(/[？?]+$/, '').toLowerCase();
}

function isSameQuestion(a, b) {
    return CEXTExportUtils.isSameQuestion
        ? CEXTExportUtils.isSameQuestion(a, b)
        : normalizeForCompare(a) === normalizeForCompare(b);
}

function extractTopNFromLogContent(logContent, testQuestion) {
    return CEXTExportUtils.extractTopNFromLogContent
        ? CEXTExportUtils.extractTopNFromLogContent(logContent, testQuestion)
        : '';
}

function buildLogContentMap(logs = []) {
    return CEXTExportUtils.buildLogContentMap
        ? CEXTExportUtils.buildLogContentMap(logs)
        : new Map();
}

function enrichEntriesWithTopN(entries = [], logs = []) {
    return CEXTExportUtils.enrichEntriesWithTopN
        ? CEXTExportUtils.enrichEntriesWithTopN(entries, logs)
        : entries;
}

function extractFieldsFromEntry(entry) {
    return CEXTExportUtils.extractFieldsFromEntry(entry);
}

/**
 * 生成 Excel 檔案（對應 analyzeResult.py 的輸出格式）
 * @param {Array} entries - 測試結果 entries 陣列
 * @returns {Promise<Blob>} - Excel 檔案的 Blob
 */
async function generateExcelFromEntries(entries, options = {}) {
    return CEXTExportUtils.generateExcelFromEntries(entries, options);
}

/**
 * 下載 Excel 檔案
 * @param {Array} entries - 測試結果 entries 陣列
 * @param {string} fileName - 檔案名稱（不含副檔名）
 * @param {Array} logs - logs 陣列（可選，用於 TopNId 處理）
 */
async function downloadExcel(entries, fileName, logs = [], batchId = null, tenantName = null, domain = null) {
    try {
        const finalDomain = domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);
        const blob = await generateExcelFromEntries(entries, { logs, batchId, tenantName, domain: finalDomain });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${fileName}.xlsx`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('生成 Excel 檔案失敗:', error);
        throw error;
    }
}

// 動態生成 CSV 表頭（根據開關狀態或數據中是否有對應欄位）
function getCsvHeaders(entries = []) {
    /* removed debug logs */

    const headers = [
        '序號',
        '測試問句',
        'TopN',
        '回應json',
        'answer',
        'tailLog',
        '測試時間',
        '回應時間'
    ];

    // 檢查開關狀態（優先從 DOM 元素讀取，因為最可靠）
    let compareIndexEnabled = false;
    let compareAnswerEnabled = false;

    // 直接從 DOM 讀取按鈕狀態（最可靠的方式）
    try {
        const indexBtn = document.getElementById('batch-btn-compare-index');
        if (indexBtn) {
            const hasActive = indexBtn.classList.contains('active');
            const hasEnabled = indexBtn.dataset.enabled === 'true';
            compareIndexEnabled = hasActive || hasEnabled;
            /* removed debug logs */
        } else {
            console.warn('[getCsvHeaders] 找不到比對編號按鈕');
        }
    } catch (e) {
        console.warn('無法讀取比對編號按鈕狀態:', e);
    }

    try {
        const answerBtn = document.getElementById('batch-btn-compare-answer');
        if (answerBtn) {
            const hasActive = answerBtn.classList.contains('active');
            const hasEnabled = answerBtn.dataset.enabled === 'true';
            compareAnswerEnabled = hasActive || hasEnabled;
            /* removed debug logs */
        } else {
            console.warn('[getCsvHeaders] 找不到比對答案按鈕');
        }
    } catch (e) {
        console.warn('無法讀取比對答案按鈕狀態:', e);
    }

    // 如果 DOM 元素不可用，嘗試從全局變數讀取（備用方案）
    if (!compareIndexEnabled && typeof window !== 'undefined' && typeof window.compareIndexEnabled === 'boolean') {
        compareIndexEnabled = window.compareIndexEnabled;
    }

    if (!compareAnswerEnabled && typeof window !== 'undefined' && typeof window.compareAnswerEnabled === 'boolean') {
        compareAnswerEnabled = window.compareAnswerEnabled;
    }

    // 如果開關未開啟，檢查數據中是否有對應欄位（用於歷史批次，僅當開關和 DOM 都未開啟時）
    // 注意：這個檢查只在開關狀態為 false 時才執行，確保開關狀態優先
    if (!compareIndexEnabled && entries.length > 0) {
        const hasExpectedIndex = entries.some(entry =>
            entry.hasOwnProperty('expectedIndex') && entry.expectedIndex !== undefined && entry.expectedIndex !== ''
        );
        // 只有在確實有數據時才啟用（用於歷史批次）
        if (hasExpectedIndex) {
            compareIndexEnabled = true;
        }
    }

    if (!compareAnswerEnabled && entries.length > 0) {
        const hasExpectedAnswer = entries.some(entry =>
            entry.hasOwnProperty('expectedAnswer') && entry.expectedAnswer !== undefined && entry.expectedAnswer !== ''
        );
        // 只有在確實有數據時才啟用（用於歷史批次）
        if (hasExpectedAnswer) {
            compareAnswerEnabled = true;
        }
    }

    // 根據開關狀態或數據內容添加欄位
    if (compareIndexEnabled) {
        headers.push('預期編號');
    }
    if (compareAnswerEnabled) {
        headers.push('預期答案');
        // 只有在有預期答案時才添加 AOAI 評分相關欄位
        headers.push('AOAI評分');
        headers.push('AOAI評分prompt');
    }

    /* removed debug logs */

    return headers;
}

function sanitizeFileComponent(value, fallback = 'batch_test') {
    const str = (value ?? '').toString().trim();
    if (str.length === 0) {
        return fallback;
    }
    return str.replace(/[\\/:*?"<>|]/g, '_');
}

function getTenantNameForFiles() {
    if (typeof CEXT !== 'undefined' && typeof CEXT.getTenantName === 'function') {
        const tenant = CEXT.getTenantName();
        if (tenant) {
            return sanitizeFileComponent(tenant);
        }
    }
    if (window.tenantName) {
        return sanitizeFileComponent(window.tenantName);
    }
    return 'batch_test';
}

function getCurrentDateTimeStr() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${month}${day}_${hours}${minutes}${seconds}`;
}

function formatCsvValue(value) {
    if (value === null || value === undefined) {
        return '""';
    }
    const str = String(value).replace(/\r/g, '').replace(/\n/g, ' ');
    return `"${str.replace(/"/g, '""')}"`;
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

function buildCsvLineFromData(item, headers) {
    // 解析 responseText 提取 answer
    const extractedAnswer = extractAnswerFromResponse(item.responseText ?? '');

    const rowValues = [
        item.id ?? '',
        item.question ?? '',
        item.TopN ?? item.topN ?? '',
        item.responseText ?? '',
        extractedAnswer, // 解析後的 answer 或 output
        item.tailLog ?? '',
        item.testTime ?? '',
        item.responseTime ?? ''
    ];

    // 根據表頭決定是否添加欄位
    if (headers.includes('預期編號')) {
        rowValues.push(item.expectedIndex ?? '');
    }
    if (headers.includes('預期答案')) {
        const expectedAnswer = item.expectedAnswer ?? '';
        rowValues.push(expectedAnswer);
        // 只有在有預期答案時才添加 AOAI 評分相關欄位
        if (headers.includes('AOAI評分')) {
            rowValues.push(item.aoaiScore ?? '');
        }
        if (headers.includes('AOAI評分prompt')) {
            rowValues.push(item.aoaiScorePrompt ?? '');
        }
        /* removed debug logs */
    }

    return rowValues.map(formatCsvValue).join(',');
}

function getCsvHeaderLine(entries) {
    return getCsvHeaders(entries).join(',');
}

function sortEntries(entries) {
    return entries
        .slice()
        .sort((a, b) => {
            const idA = Number(a?.id ?? 0);
            const idB = Number(b?.id ?? 0);
            return idA - idB;
        });
}

function createCsvContent(entries) {
    /* removed debug logs */

    // 保持原始順序，不進行排序
    const headers = getCsvHeaders(entries);
    const dataLines = entries.map(entry => buildCsvLineFromData(entry, headers));

    /* removed debug logs */

    return [getCsvHeaderLine(entries), ...dataLines].join('\n');
}

async function appendFileContentToZip(zip, relativePath, targetName) {
    try {
        const response = await fetch(relativePath, { cache: 'no-cache' });
        if (response.ok) {
            const content = await response.text();
            if (content && content.length > 0) {
                zip.file(targetName, content);
            }
        } else {
            console.warn(`載入 ${relativePath} 失敗，HTTP 狀態碼: ${response.status}`);
        }
    } catch (error) {
        console.warn(`載入 ${relativePath} 失敗:`, error);
    }
}

// 已移除 appendScriptsToZip，不再需要 Python 腳本

async function downloadEntriesAsZip(entries, logs = [], tenantName = null, batchId = null, domain = null) {
    /* removed debug logs */
    if (!Array.isArray(entries) || entries.length === 0) {
        console.warn('[downloadEntriesAsZip] entries 為空或不是陣列');
        return;
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 尚未載入，無法生成 ZIP 檔案');
    }

    const enrichedEntries = enrichEntriesWithTopN(entries, logs);

    // 如果沒有提供 tenantName，則使用當前環境的租戶名稱
    const finalTenantName = tenantName || getTenantNameForFiles();
    const timestamp = getCurrentDateTimeStr();
    const baseName = `${finalTenantName}_partial_${timestamp}`;
    const csvFileName = `${baseName}.csv`;
    const excelFileName = `${baseName}.xlsx`;
    const zipFileName = `${baseName}.zip`;

    const zip = new JSZip();
    // 創建 logs 資料夾（即使 logs 為空，也創建以保持一致性）
    const logsFolder = zip.folder('logs');
    /* removed debug logs */

    // 添加 CSV 檔案
    const csvContent = '\uFEFF' + createCsvContent(enrichedEntries);
    zip.file(csvFileName, csvContent);

    // 添加 Excel 檔案
    try {
        if (typeof ExcelJS !== 'undefined' && ExcelJS !== null) {
            const finalDomain = domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);
            const excelBlob = await generateExcelFromEntries(enrichedEntries, { logs, batchId, tenantName, domain: finalDomain });
            const excelBuffer = await excelBlob.arrayBuffer();
            zip.file(excelFileName, excelBuffer);
            console.log('Excel 檔案已添加到 ZIP:', excelFileName);
        } else {
            console.warn('ExcelJS 未載入，跳過 Excel 檔案生成');
        }
    } catch (error) {
        console.error('生成 Excel 檔案失敗:', error);
        console.warn('ZIP 將僅包含 CSV 檔案');
    }

    // 添加 logs
    if (Array.isArray(logs) && logs.length > 0) {
        logs.forEach((logEntry, index) => {
            const fileName = logEntry?.fileName || `batch_${index + 1}.txt`;
            const content = logEntry?.content || '';
            if (content) {
                logsFolder.file(fileName, content);
            }
        });
        console.log(`已添加 ${logs.length} 個 log 檔案到 ZIP`);
    } else {
        console.log('沒有 log 檔案需要添加');
    }

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', zipFileName);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function downloadBatchZip(entries, batchLogs, tenantName = null, batchId = null, domain = null) {
    /* removed debug logs */
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('沒有可供下載的資料');
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 尚未載入，無法生成 ZIP 檔案');
    }

    const enrichedEntries = enrichEntriesWithTopN(entries, batchLogs);

    // 如果沒有提供 tenantName，則使用當前環境的租戶名稱
    const finalTenantName = tenantName || getTenantNameForFiles();
    const timestamp = getCurrentDateTimeStr();
    const baseName = `${finalTenantName}_批次測試_${timestamp}`;
    const csvFileName = `${baseName}.csv`;
    const excelFileName = `${baseName}.xlsx`;
    const zipFileName = `${baseName}.zip`;

    const zip = new JSZip();
    const logsFolder = zip.folder('logs');

    /* removed debug logs */
    // 添加 CSV 檔案
    const csvContent = '\uFEFF' + createCsvContent(enrichedEntries);
    zip.file(csvFileName, csvContent);

    // 添加 Excel 檔案
    try {
        if (typeof ExcelJS !== 'undefined') {
            const finalDomain = domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);
            const excelBlob = await generateExcelFromEntries(enrichedEntries, { logs: batchLogs, batchId, tenantName, domain: finalDomain });
            const excelBuffer = await excelBlob.arrayBuffer();
            zip.file(excelFileName, excelBuffer);
        }
    } catch (error) {
        console.warn('生成 Excel 檔案失敗，僅包含 CSV:', error);
    }

    if (Array.isArray(batchLogs) && batchLogs.length > 0) {
        batchLogs.forEach((logEntry, index) => {
            const fileName = logEntry?.fileName || `batch_${index + 1}.txt`;
            const content = logEntry?.content || '';
            logsFolder.file(fileName, content);
        });
    }

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', zipFileName);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
