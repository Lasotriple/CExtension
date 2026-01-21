(function () {
    if (typeof CEXTExportUtils === 'undefined') {
        const errorMsg = 'CEXTExportUtils 未載入。請確認：\n' +
            '1. batchTest-export-utils.js 已正確載入\n' +
            '2. 載入順序正確（export-utils 在 download-helper 之前）\n' +
            '3. 清除瀏覽器快取並重新載入擴充功能';
        console.error('[download-helper]', errorMsg);
        throw new Error(errorMsg);
    }
    const {
        parseAOAIScoringResult,
        sanitizeValueForExcel,
        normalizeTextBasic,
        normalizeForCompare,
        isSameQuestion,
        extractTopNFromLogContent,
        buildLogContentMap,
        enrichEntriesWithTopN,
        extractFieldsFromEntry,
        generateExcelFromEntries: generateExcelFromEntriesShared
    } = CEXTExportUtils;
    function sanitizeFileComponent(value, fallback = 'batch_test') {
        const str = (value ?? '').toString().trim();
        if (str.length === 0) {
            return fallback;
        }
        return str.replace(/[\\/:*?"<>|]/g, '_');
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
                console.warn('[download-helper getCsvHeaders] 找不到比對編號按鈕');
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
                console.warn('[download-helper getCsvHeaders] 找不到比對答案按鈕');
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

    function buildCsvLineFromData(item, headers) {
        // 解析 responseText 提取 answer
        const extractedAnswer = extractAnswerFromResponse(item?.responseText ?? '');

        const rowValues = [
            item?.id ?? '',
            item?.question ?? '',
            item?.TopN ?? item?.topN ?? '',
            item?.responseText ?? '',
            extractedAnswer, // 解析後的 answer 或 output
            item?.tailLog ?? '',
            item?.testTime ?? '',
            item?.responseTime ?? ''
        ];

        // 根據表頭決定是否添加欄位
        if (headers.includes('預期編號')) {
            rowValues.push(item?.expectedIndex ?? '');
        }
        if (headers.includes('預期答案')) {
            const expectedAnswer = item?.expectedAnswer ?? '';
            rowValues.push(expectedAnswer);
            // 只有在有預期答案時才添加 AOAI 評分相關欄位
            if (headers.includes('AOAI評分')) {
                rowValues.push(item?.aoaiScore ?? '');
            }
            if (headers.includes('AOAI評分prompt')) {
                rowValues.push(item?.aoaiScorePrompt ?? '');
            }
            /* removed debug logs */
        }

        return rowValues.map(formatCsvValue).join(',');
    }

    function sortEntries(entries) {
        return (entries || [])
            .slice()
            .sort((a, b) => {
                const idA = Number(a?.id ?? 0);
                const idB = Number(b?.id ?? 0);
                return idA - idB;
            });
    }

    function getCsvHeaderLine(entries) {
        return getCsvHeaders(entries).join(',');
    }

    function createCsvContent(entries) {
        /* removed debug logs */

        // 保持原始順序，不進行排序
        const headers = getCsvHeaders(entries);
        const dataLines = entries.map(entry => buildCsvLineFromData(entry, headers));

        /* removed debug logs */

        return [getCsvHeaderLine(entries), ...dataLines].join('\n');
    }

    function parseAOAIScoringResult(resultStr) {
        return CEXTExportUtils.parseAOAIScoringResult(resultStr);
    }

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

    async function generateExcelFromEntries(entries, options = {}) {
        return generateExcelFromEntriesShared(entries, options);
    }

    function triggerDownloadFromBlob(blob, fileName) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function generateExcelOnly({ results, logs, tenantName, partial, batchId }) {
        const hasEntries = Array.isArray(results) && results.length > 0;
        if (!hasEntries) {
            throw new Error('沒有可供下載的結果資料');
        }

        if (typeof ExcelJS === 'undefined') {
            throw new Error('ExcelJS 尚未載入');
        }

        const enrichedResults = enrichEntriesWithTopN(results, logs);
        const sanitizedTenant = sanitizeFileComponent(tenantName || 'batch_test');
        const timestampStr = getCurrentDateTimeStr();
        const baseName = partial
            ? `${sanitizedTenant}_partial_${timestampStr}`
            : `${sanitizedTenant}_批次測試_${timestampStr}`;
        const excelFileName = `${baseName}.xlsx`;

        const domain = typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null;
        const excelBlob = await generateExcelFromEntries(enrichedResults, { logs, batchId, tenantName, domain });
        triggerDownloadFromBlob(excelBlob, excelFileName);
    }

    async function generateZipAndDownload({ results, logs, tenantName, partial, batchId }) {
        const hasEntries = Array.isArray(results) && results.length > 0;
        if (!hasEntries) {
            throw new Error('沒有可供下載的結果資料');
        }

        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 尚未載入');
        }

        const enrichedResults = enrichEntriesWithTopN(results, logs);

        const sanitizedTenant = sanitizeFileComponent(tenantName || 'batch_test');
        const timestampStr = getCurrentDateTimeStr();
        const baseName = partial
            ? `${sanitizedTenant}_partial_${timestampStr}`
            : `${sanitizedTenant}_批次測試_${timestampStr}`;
        const csvFileName = `${baseName}.csv`;
        const excelFileName = `${baseName}.xlsx`;
        const zipFileName = `${baseName}.zip`;

        const zip = new JSZip();

        // 添加 CSV 檔案
        const csvContent = '\uFEFF' + createCsvContent(enrichedResults);
        zip.file(csvFileName, csvContent);

        // 添加 Excel 檔案
        try {
            if (typeof ExcelJS !== 'undefined' && ExcelJS !== null) {
                const domain = typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null;
                const excelBlob = await generateExcelFromEntries(enrichedResults, { logs, batchId, tenantName, domain });
                const excelBuffer = await excelBlob.arrayBuffer();
                zip.file(excelFileName, excelBuffer);
            } else {
                console.warn('ExcelJS 未載入，跳過 Excel 檔案生成');
            }
        } catch (error) {
            console.error('生成 Excel 檔案失敗:', error);
            console.warn('ZIP 將僅包含 CSV 檔案');
        }

        // 添加 logs（創建 logs 資料夾）
        const logsFolder = zip.folder('logs');
        if (Array.isArray(logs) && logs.length > 0) {
            logs.forEach((logEntry, index) => {
                const fileName = logEntry?.fileName || `batch_${index + 1}.txt`;
                const content = logEntry?.content || '';
                if (content) {
                    logsFolder.file(fileName, content);
                }
            });
        }

        // 已移除 appendUtilityScripts，不再需要 Python 腳本

        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        triggerDownloadFromBlob(blob, zipFileName);
    }

    function notifyParent(type, extra = {}) {
        if (window.parent) {
            window.parent.postMessage({
                source: 'CEXT_DOWNLOAD_HELPER',
                type,
                ...extra
            }, '*');
        }
    }

    async function handleDownloadRequest(taskId, payload) {
        try {
            // 根據 downloadAsZip 選項決定下載 Excel 還是 ZIP
            // 預設為 false（只下載 Excel），Shift + 下載時為 true（下載 ZIP）
            const downloadAsZip = payload.downloadAsZip === true;
            if (downloadAsZip) {
                await generateZipAndDownload(payload);
            } else {
                await generateExcelOnly(payload);
            }
            notifyParent('completed', { taskId });
        } catch (error) {
            /* removed error log */
            notifyParent('error', {
                taskId,
                message: error?.message || String(error)
            });
        }
    }

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') {
            return;
        }
        if (data.source !== 'CEXT_PARENT') {
            return;
        }
        if (data.type === 'download-request' && data.payload) {
            handleDownloadRequest(data.taskId || null, data.payload);
        }
    });

    notifyParent('ready');
})();