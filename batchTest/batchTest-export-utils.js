(function (global) {
    const COLUMN_ORDER = [
        { key: '序號', header: '序號' },
        { key: '測試問句', header: '測試問句' },
        { key: '預期編號', header: '預期編號' },
        { key: '預期答案', header: '預期答案' },
        { key: 'answer', header: '回答' },
        { key: 'answerBy', header: '回答來源' },
        { key: '回答標準問', header: '回答標準問' },
        { key: 'answerId', header: '回答Id' },        
        { key: 'TopN', header: 'TopN' },
        { key: 'TopNId', header: 'TopNId' },
        { key: '推薦', header: '推薦' },
        { key: '推薦Id', header: '推薦Id' },
        { key: 'TopN精準度', header: 'TopN精準度' },
        { key: '推薦精準度', header: '推薦精準度' },
        { key: '精準度', header: '精準度' },
        { key: 'AOAI 自動判斷分數', header: 'AOAI 自動判斷分數' },
        { key: 'AOAI 自動判斷區間', header: 'AOAI 自動判斷區間' },
        { key: 'AOAI 自動判斷原因', header: 'AOAI 自動判斷原因' },
        { key: 'AOAI評分結果', header: 'AOAI評分結果' },
        { key: 'AOAI評分prompt', header: 'AOAI評分prompt' }
    ];

    const REQUIRED_KEYS = new Set(['序號', '測試問句']);

    const WIDTH_RULES_BASE = {
        '序號': 10,
        '預期編號': 12,
        '回答Id': 12,
        "TopNId": 12,
        "推薦Id": 12,
        '回答來源': 30,
        '測試時間': 25,
        '回應時間': 25,
        'TopN精準度': 15,
        '推薦精準度': 15,
        '精準度': 15
    };
    const WIDTH_RULES = Object.fromEntries(
        Object.entries(WIDTH_RULES_BASE).map(([key, value]) => [key, value + 0.62])
    );

    const DEFAULT_WIDTH = 20.62;
    const DEFAULT_HEIGHT = 32;

    const BLUE_HEADERS         = new Set(['測試問句', '預期編號', '預期答案']);
    const GREEN_HEADERS        = new Set(['回答', '回答Id', '回答標準問', '回答來源', 'TopN', 'TopNId', '推薦', '推薦Id']);
    const ORANGE_HEADERS       = new Set(['AOAI 自動判斷分數', 'AOAI 自動判斷區間', 'AOAI 自動判斷原因', 'AOAI評分結果', 'AOAI評分prompt']);
    const YELLOW_HEADERS       = new Set(['TopN精準度', '推薦精準度', '精準度']);
    const LIGHT_ORANGE_HEADERS = new Set();                                                                                             // 動態添加文件欄位
    const CENTER_TOP_HEADERS   = new Set(['序號', '預期編號', '回答Id', 'TopNId', '推薦Id', '回答來源', '測試時間', '回應時間', 'TopN精準度', '推薦精準度', '精準度']);

    const FILL_BLUE         = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCEEFF' } };
    const FILL_GREEN        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } };
    const FILL_ORANGE       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0CC' } };
    const FILL_YELLOW       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } };
    const FILL_LIGHT_ORANGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E6' } };

    function sanitizeValueForExcel(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value !== 'string') {
            if (typeof value === 'object') {
                try {
                    value = JSON.stringify(value);
                } catch (e) {
                    value = String(value);
                }
            } else {
                value = String(value);
            }
        }
        let cleaned = value.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
        cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '');
        cleaned = cleaned.replace(/[\uFFFE\uFFFF]/g, '');
        cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
        if (cleaned.length > 32767) {
            cleaned = cleaned.substring(0, 32764) + '...';
        }
        return cleaned;
    }

    function normalizeTextBasic(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\r/g, '').replace(/\n/g, '').trim();
    }

    function normalizeForCompare(value) {
        return normalizeTextBasic(value).replace(/[？?]+$/, '').toLowerCase();
    }

    function isSameQuestion(a, b) {
        return normalizeForCompare(a) === normalizeForCompare(b);
    }

    function parseAOAIScoringResult(resultStr) {
        if (!resultStr || typeof resultStr !== 'string') {
            return { original: resultStr || '', score: '', interval: '', reason: '' };
        }
        const original = resultStr.trim();
        if (!original.startsWith('[') || !original.endsWith(']')) {
            return { original, score: '', interval: '', reason: '' };
        }
        let content = original.slice(1, -1).trim();
        let parts;
        if (content.includes(']：[')) {
            parts = content.split(']：[');
        } else if (content.includes(']:[')) {
            parts = content.split(']:[');
        } else {
            return { original, score: '', interval: '', reason: '' };
        }
        if (parts.length !== 3) {
            return { original, score: '', interval: '', reason: '' };
        }
        const score = parts[0].trim().replace(/^\[+/, '').replace(/\]+$/, '').trim();
        const interval = parts[1].trim().replace(/^\[+/, '').replace(/\]+$/, '').trim();
        const reason = parts[2].trim().replace(/^\[+/, '').replace(/\]+$/, '').trim();
        return { original, score, interval, reason };
    }

    function extractTopNFromLogContent(logContent, testQuestion) {
        if (!logContent || !testQuestion) return '';

        // 先嘗試找「問句轉換完成」記錄
        const matches = Array.from(logContent.matchAll(/問句轉換完成:\s*\((.+?)\s*>>>>> \s*(.+?)\)/gs));
        let searchQuery = '';
        let foundConverted = false;

        // 優先使用轉換後問句
        if (matches.length > 0) {
            for (const [, originalQ, newQ] of matches) {
                if (isSameQuestion(originalQ, testQuestion)) {
                    searchQuery = normalizeTextBasic(newQ);
                    foundConverted = true;
                    break;
                }
            }
        }

        // 如果沒找到轉換記錄，使用原問句
        if (!foundConverted) {
            searchQuery = normalizeTextBasic(testQuestion);
        }

        if (!searchQuery) return '';

        // 用 searchQuery 去找 ChatMessage(role=user, content={searchQuery})
        const anchor = `ChatMessage(role=user, content=${searchQuery}`;
        let pos = logContent.indexOf(anchor);

        // 如果找不到，嘗試去掉尾巴的 ? / ？
        if (pos === -1) {
            const trimmed = searchQuery.replace(/[？?]+$/, '');
            if (trimmed !== searchQuery) {
                pos = logContent.indexOf(`ChatMessage(role=user, content=${trimmed}`);
            }
        }

        if (pos === -1) return '';

        // 往上找到最近一個「常見問答」
        const faqStart = logContent.lastIndexOf('常見問答', pos);
        if (faqStart === -1) return '';

        // 解析 window 裡的 Q1: XXX 等行
        const windowText = logContent.slice(faqStart, pos);
        const parts = [];
        const qPattern = /^Q(\d+):\s*(.+)$/gm;
        let match;
        while ((match = qPattern.exec(windowText)) !== null) {
            parts.push(`Q${match[1]}:${match[2].trim()}`);
        }

        return parts.join('\n');
    }

    function buildLogContentMap(logs = []) {
        const map = new Map();
        (logs || []).forEach(log => {
            if (!log) return;
            const name = log.fileName || '';
            const content = log.content || '';
            if (!name || !content) return;
            map.set(name, content);
            map.set(`logs/${name}`, content);
        });
        return map;
    }

    // 從 TopN 字串中提取所有問題
    // 處理兩種格式：
    // 1. Q1:問題1\nQ2:問題2... (從 logs 解析的格式，需要去除前綴)
    // 2. 問題1\n問題2... (從 AOAI_TOP_N 來的格式，直接用 \n 分割)
    function extractQuestionsFromTopN(topNStr) {
        if (!topNStr || typeof topNStr !== 'string') return [];
        const questions = [];
        
        // 先嘗試匹配 Q數字:問題內容 格式（從 logs 解析的格式）
        const qPattern = /^Q\d+:\s*(.+)$/gm;
        let match;
        let hasQPrefix = false;
        while ((match = qPattern.exec(topNStr)) !== null) {
            hasQPrefix = true;
            const question = match[1].trim();
            if (question) {
                questions.push(question);
            }
        }
        
        // 如果沒有匹配到 Q數字: 格式，則按行分割（AOAI_TOP_N 格式或已經處理過的格式）
        if (!hasQPrefix) {
            const lines = topNStr.split('\n');
            for (const line of lines) {
                const question = line.trim();
                if (question) {
                    questions.push(question);
                }
            }
        }
        
        return questions;
    }

    // 處理 TopNId 比對
    async function enrichEntriesWithTopNId(entries = []) {
        if (!Array.isArray(entries) || entries.length === 0) return entries;

        // 收集所有 TopN 問題並去重
        const allQuestionsSet = new Set();
        entries.forEach(entry => {
            const topN = entry.TopN ?? entry.topN ?? '';
            if (topN) {
                const questions = extractQuestionsFromTopN(topN);
                questions.forEach(q => allQuestionsSet.add(q));
            }
        });

        const uniqueQuestions = Array.from(allQuestionsSet);
        if (uniqueQuestions.length === 0) {
            // 沒有 TopN 問題，直接返回
            return entries.map(entry => {
                const cloned = Object.assign({}, entry);
                cloned.TopNId = '';
                return cloned;
            });
        }

        // 呼叫 getIdByQuestion 取得問題到 kid 的映射
        let questionToKidMap = new Map();
        try {
            if (typeof getIdByQuestion === 'function' && typeof groovyCaller === 'function') {
                // 批量查詢所有問題，一次取得所有映射
                const batchScript = getIdByQuestion(uniqueQuestions);
                const batchResult = await groovyCaller(batchScript);

                if (batchResult && batchResult.questionToKidMap) {
                    // 直接使用批量查詢返回的映射
                    Object.entries(batchResult.questionToKidMap).forEach(([question, kid]) => {
                        if (kid !== null && kid !== undefined) {
                            questionToKidMap.set(question, kid);
                        }
                    });
                } else if (batchResult && batchResult.kidList) {
                    // 向後兼容：如果返回的是 kidList（舊格式），則無法建立映射
                    console.warn('[TopNId] 批量查詢返回舊格式 kidList，無法建立問題映射');
                }
            } else {
                console.warn('[TopNId] getIdByQuestion 或 groovyCaller 未定義');
            }
        } catch (error) {
            console.warn('[TopNId] 取得 TopNId 失敗:', error);
        }

        // 為每個 entry 生成 TopNId
        return entries.map(entry => {
            const cloned = Object.assign({}, entry);
            const topN = cloned.TopN ?? cloned.topN ?? '';
            if (topN) {
                const questions = extractQuestionsFromTopN(topN);
                const kidList = questions
                    .map(q => questionToKidMap.get(q))
                    .filter(kid => kid !== undefined && kid !== null);
                cloned.TopNId = kidList.length > 0 ? kidList.join('\n') : '';
            } else {
                cloned.TopNId = '';
            }
            return cloned;
        });
    }

    function enrichEntriesWithTopN(entries = [], logs = []) {
        const logMap = buildLogContentMap(logs);
        return (entries || []).map(entry => {
            const cloned = Object.assign({}, entry);
            if (cloned.TopN !== undefined || cloned.topN !== undefined) {
                return cloned;
            }

            // 首先檢查 responseText 中是否有 AOAI_TOP_N
            if (cloned.responseText) {
                try {
                    const parsed = JSON.parse(cloned.responseText);
                    if (parsed.AOAI_TOP_N && typeof parsed.AOAI_TOP_N === 'string') {
                        // AOAI_TOP_N 格式：直接用 \n 分隔的問題列表
                        // 例如："momoBOOK終止訂閱說明\nmomoBOOK說明\n..."
                        // 直接存入 TopN（已經是正確格式）
                        cloned.TopN = parsed.AOAI_TOP_N;
                        return cloned;
                    }
                } catch (e) {
                    /* ignore */
                }
            }

            // 如果沒有 AOAI_TOP_N，則從 tailLog 解析
            const tailLogPath = (cloned.tailLog || '').replace(/^[./\\]+/, '');
            const logContent =
                logMap.get(tailLogPath) ||
                logMap.get(tailLogPath.replace(/^logs\//, '')) ||
                logMap.get(cloned.tailLog || '') ||
                '';
            
            // 從 logs 解析 TopN（格式：Q1:問題1\nQ2:問題2...）
            const topNFromLog = extractTopNFromLogContent(logContent, cloned.question || '');
            
            // 去除 Q1:, Q2: 等前綴，轉換為純問題列表（用 \n 分隔）
            if (topNFromLog) {
                const questions = extractQuestionsFromTopN(topNFromLog);
                cloned.TopN = questions.join('\n');
            } else {
                cloned.TopN = '';
            }
            
            return cloned;
        });
    }

    // 合併處理 TopNId、推薦Id 和回答標準問：收集所有問題，呼叫一次 getIdByQuestion
    async function enrichEntriesWithTopNIdAndRecommendId(entries = [], options = {}) {
        if (!Array.isArray(entries) || entries.length === 0) return entries;

        const batchId = options.batchId || null;

        // 收集所有 TopN 問題、推薦問題和回答標準問並去重
        const allQuestionsSet = new Set();
        const entryTopNQuestions = new Map(); // 記錄每個 entry 的 TopN 問題
        const entryRecommendQuestions = new Map(); // 記錄每個 entry 的推薦問題
        const entryAnswerStandardQuestions = new Map(); // 記錄每個 entry 的回答標準問
        const answerIdsToQuery = new Set(); // 收集需要查詢的回答 ID

        entries.forEach((entry, index) => {
            // 收集 TopN 問題
            const topN = entry.TopN ?? entry.topN ?? '';
            if (topN) {
                const questions = extractQuestionsFromTopN(topN);
                entryTopNQuestions.set(index, questions);
                questions.forEach(q => allQuestionsSet.add(q));
            }

            // 收集推薦問題
            if (entry.responseText) {
                try {
                    const parsed = JSON.parse(entry.responseText);
                    const messages = parsed?.rm?.messages;
                    if (Array.isArray(messages) && messages.length > 0) {
                        // 找到最靠後面的有 recommend key 且帶有 actions 的項目
                        for (let i = messages.length - 1; i >= 0; i--) {
                            const msg = messages[i];
                            if (msg && msg.template && msg.template.hasOwnProperty('recommend') && Array.isArray(msg.template.actions)) {
                                const recommendLabels = [];
                                for (const action of msg.template.actions) {
                                    if (action.label) {
                                        recommendLabels.push(action.label);
                                        allQuestionsSet.add(action.label);
                                    }
                                }
                                if (recommendLabels.length > 0) {
                                    entryRecommendQuestions.set(index, recommendLabels);
                                }
                                break;
                            }
                        }
                    }

                    // 處理回答標準問和回答Id
                    const answerId = parsed.kid;
                    if (answerId !== null && answerId !== undefined && String(answerId).trim() !== '') {
                        // 如果有回答 ID，收集起來用 getQuestionById 查詢標準問
                        answerIdsToQuery.add(String(answerId));
                    } else {
                        // 如果沒有回答 ID，從 _EnhancedFuzzyAnswerRule_QA_REF_MAP 提取標準問，用 getIdByQuestion 對回 ID
                        const refMap = parsed._EnhancedFuzzyAnswerRule_QA_REF_MAP;
                        if (refMap && typeof refMap === 'object') {
                            const standardQuestions = Object.values(refMap)
                                .filter(v => v && typeof v === 'string' && v.trim() !== '');
                            if (standardQuestions.length > 0) {
                                entryAnswerStandardQuestions.set(index, standardQuestions);
                                standardQuestions.forEach(q => allQuestionsSet.add(q));
                            }
                        }
                    }
                } catch (e) {
                    /* ignore */
                }
            }
        });

        const uniqueQuestions = Array.from(allQuestionsSet);
        const uniqueAnswerIds = Array.from(answerIdsToQuery);

        // 先嘗試從 IndexedDB 讀取 idToQuestionMap
        let idToQuestionMapFromStorage = null;
        let questionToKidMap = new Map();
        let kidToQuestionMap = new Map();
        const tenantName = options.tenantName || null;
        const domain = options.domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);

        if (batchId && typeof CEXTBatchStorage !== 'undefined' && typeof CEXTBatchStorage.getIdToQuestionMap === 'function') {
            try {
                idToQuestionMapFromStorage = await CEXTBatchStorage.getIdToQuestionMap(batchId, tenantName, domain);
                if (idToQuestionMapFromStorage && typeof idToQuestionMapFromStorage === 'object') {
                    // 從 idToQuestionMap 建立 kidToQuestionMap（ID 到問題的映射）
                    Object.entries(idToQuestionMapFromStorage).forEach(([id, question]) => {
                        if (id !== null && id !== undefined && question !== null && question !== undefined) {
                            const idStr = String(id);
                            kidToQuestionMap.set(idStr, question);
                            // 同時建立反向映射（問題到 ID 的映射）
                            questionToKidMap.set(question, idStr);
                        }
                    });
                }
            } catch (error) {
                console.warn('[TopNId/推薦Id/回答標準問] 從 IndexedDB 讀取映射失敗:', error);
            }
        }

        // 如果從 IndexedDB 沒有取得完整的映射，才呼叫 API
        // 檢查是否還有未映射的問題
        const unmappedQuestions = uniqueQuestions.filter(q => !questionToKidMap.has(q));
        if (unmappedQuestions.length > 0) {
            try {
                if (typeof getIdByQuestion === 'function' && typeof groovyCaller === 'function') {
                    // 批量查詢未映射的問題，一次取得所有映射
                    const batchScript = getIdByQuestion(unmappedQuestions);
                    const batchResult = await groovyCaller(batchScript);

                    if (batchResult && batchResult.questionToKidMap) {
                        // 直接使用批量查詢返回的映射
                        Object.entries(batchResult.questionToKidMap).forEach(([question, kid]) => {
                            if (kid !== null && kid !== undefined) {
                                const kidStr = String(kid);
                                questionToKidMap.set(question, kidStr);
                                // 同時更新 kidToQuestionMap（如果有的話）
                                if (idToQuestionMapFromStorage && idToQuestionMapFromStorage[kidStr]) {
                                    kidToQuestionMap.set(kidStr, idToQuestionMapFromStorage[kidStr]);
                                }
                            }
                        });
                    } else if (batchResult && batchResult.kidList) {
                        // 向後兼容：如果返回的是 kidList（舊格式），則無法建立映射
                        console.warn('[TopNId/推薦Id/回答標準問] 批量查詢返回舊格式 kidList，無法建立問題映射');
                    }
                } else {
                    console.warn('[TopNId/推薦Id/回答標準問] getIdByQuestion 或 groovyCaller 未定義');
                }
            } catch (error) {
                console.warn('[TopNId/推薦Id/回答標準問] 取得問題映射失敗:', error);
            }
        }

        // 檢查是否還有未映射的回答 ID
        const unmappedAnswerIds = uniqueAnswerIds.filter(id => !kidToQuestionMap.has(String(id)));
        if (unmappedAnswerIds.length > 0) {
            try {
                if (typeof getQuestionById === 'function' && typeof groovyCaller === 'function') {
                    // 批量查詢未映射的回答 ID，一次取得所有映射
                    const batchScript = getQuestionById(unmappedAnswerIds);
                    const batchResult = await groovyCaller(batchScript);

                    if (batchResult && batchResult.idToQuestionMap) {
                        // 直接使用批量查詢返回的映射
                        Object.entries(batchResult.idToQuestionMap).forEach(([id, question]) => {
                            if (question !== null && question !== undefined) {
                                const idStr = String(id);
                                kidToQuestionMap.set(idStr, question);
                                // 同時更新 questionToKidMap
                                questionToKidMap.set(question, idStr);
                            }
                        });
                    }
                } else {
                    console.warn('[回答標準問] getQuestionById 或 groovyCaller 未定義');
                }
            } catch (error) {
                console.warn('[回答標準問] 取得標準問映射失敗:', error);
            }
        }

        // 為每個 entry 生成 TopNId、推薦Id 和回答標準問
        return entries.map((entry, index) => {
            const cloned = Object.assign({}, entry);

            // 生成 TopNId
            const topNQuestions = entryTopNQuestions.get(index) || [];
            if (topNQuestions.length > 0) {
                const kidList = topNQuestions
                    .map(q => questionToKidMap.get(q))
                    .filter(kid => kid !== undefined && kid !== null);
                cloned.TopNId = kidList.length > 0 ? kidList.join('\n') : '';
            } else {
                cloned.TopNId = '';
            }

            // 生成推薦Id
            const recommendLabels = entryRecommendQuestions.get(index) || [];
            if (recommendLabels.length > 0) {
                const kidList = recommendLabels
                    .map(q => questionToKidMap.get(q))
                    .filter(kid => kid !== undefined && kid !== null);
                cloned.推薦Id = kidList.length > 0 ? kidList.join('\n') : '';
            } else {
                cloned.推薦Id = '';
            }

            // 處理回答標準問和回答Id
            if (cloned.responseText) {
                try {
                    const parsed = JSON.parse(cloned.responseText);
                    const answerId = parsed.kid;

                    if (answerId !== null && answerId !== undefined && String(answerId).trim() !== '') {
                        // 如果有回答 ID，用 getQuestionById 對回標準問，存到 "回答標準問"
                        const question = kidToQuestionMap.get(String(answerId));
                        if (question) {
                            cloned.回答標準問 = question;
                        } else {
                            cloned.回答標準問 = '';
                        }
                        // 回答Id 保持原值（從 parsed.kid）
                        cloned.answerId = String(answerId);
                    } else {
                        // 如果沒有回答 ID，從 _EnhancedFuzzyAnswerRule_QA_REF_MAP 提取標準問
                        // 用 getIdByQuestion 對回 ID，存到 "回答Id"
                        const standardQuestions = entryAnswerStandardQuestions.get(index) || [];
                        if (standardQuestions.length > 0) {
                            // 用 questionToKidMap 對回 ID
                            const kidList = standardQuestions
                                .map(q => questionToKidMap.get(q))
                                .filter(kid => kid !== undefined && kid !== null);
                            cloned.answerId = kidList.length > 0 ? kidList.join('\n') : '';
                            // 回答標準問就是這些標準問
                            cloned.回答標準問 = standardQuestions.join('\n');
                        } else {
                            cloned.answerId = '';
                            cloned.回答標準問 = '';
                        }
                    }
                } catch (e) {
                    cloned.answerId = '';
                    cloned.回答標準問 = '';
                }
            } else {
                cloned.answerId = '';
                cloned.回答標準問 = '';
            }

            return cloned;
        });
    }

    function extractFieldsFromEntry(entry) {
        const expectedIndex = entry.expectedIndex;
        const topNId = entry.TopNId ?? entry.topNId ?? '';
        const recommendId = entry.推薦Id ?? '';

        const result = {
            序號: sanitizeValueForExcel(entry.id),
            測試問句: sanitizeValueForExcel(entry.question),
            TopN: sanitizeValueForExcel(entry.TopN ?? entry.topN),
            TopNId: sanitizeValueForExcel(topNId),
            預期編號: sanitizeValueForExcel(expectedIndex),
            預期答案: sanitizeValueForExcel(entry.expectedAnswer),
            output: '',
            answer: '',
            answerId: '',
            回答標準問: sanitizeValueForExcel(entry.回答標準問 ?? ''),
            answerBy: '',
            推薦: '',
            推薦Id: sanitizeValueForExcel(recommendId),
            測試時間: sanitizeValueForExcel(entry.testTime),
            回應時間: sanitizeValueForExcel(entry.responseTime)
        };
        let parsed = {};
        if (entry.responseText) {
            try {
                parsed = JSON.parse(entry.responseText);
            } catch (e) {
                /* ignore */
            }
        }
        result.output = sanitizeValueForExcel(parsed.output);
        const messages = parsed?.rm?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
            const parts = [];
            for (const message of messages) {
                if (message.html) {
                    parts.push(sanitizeValueForExcel(message.html));
                }
                if (message.text) {
                    parts.push(sanitizeValueForExcel(message.text));
                }
            }
            result.answer = parts.join(' ');

            // 處理推薦項目：找到最靠後面的有 recommend key 且帶有 actions 的項目
            let recommendMessage = null;
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg && msg.template && msg.template.hasOwnProperty('recommend') && Array.isArray(msg.template.actions)) {
                    recommendMessage = msg;
                    break;
                }
            }

            // 提取推薦項目的 label（標準問句）
            if (recommendMessage && recommendMessage.template && Array.isArray(recommendMessage.template.actions)) {
                const labels = [];

                for (const action of recommendMessage.template.actions) {
                    if (action.label) {
                        labels.push(action.label);
                    }
                }

                result.推薦 = labels.length > 0 ? labels.join('\n') : '';
                // 推薦Id 會在 enrichEntriesWithTopNIdAndRecommendId 中處理
            } else {
                result.推薦 = '';
            }
        } else {
            result.推薦 = '';
            result.推薦Id = '';
        }
        // answerId 已經在 enrichEntriesWithTopNIdAndRecommendId 中處理過了
        result.answerId = sanitizeValueForExcel(entry.answerId ?? parsed.kid ?? '');

        // 檢查是否有預期編號（不為 null、undefined 或空字串）
        const hasExpectedIndex = expectedIndex !== null &&
            expectedIndex !== undefined &&
            String(expectedIndex).trim() !== '';

        // 計算 TopN精準度：TopNId 是否包含預期編號
        // 如果沒有預期編號，則不計算（設為空字串）
        // 如果有預期編號，則計算並確保為數字類型（0 或 1）
        if (!hasExpectedIndex) {
            result.TopN精準度 = '';
        } else {
            const topNIdStr = topNId ? String(topNId) : '';
            if (topNIdStr.trim() === '') {
                result.TopN精準度 = 0;
            } else {
                // 將 TopNId 分割成陣列，然後檢查是否包含預期編號
                const topNIdList = topNIdStr.split('\n')
                    .map(id => String(id).trim())
                    .filter(id => id !== '');
                const expectedIndexStr = String(expectedIndex).trim();
                result.TopN精準度 = topNIdList.includes(expectedIndexStr) ? 1 : 0;
            }
        }

        // 計算精準度：回答Id 是否包含預期編號
        // 如果沒有預期編號，則不計算（設為空字串）
        // 如果有預期編號，則計算並確保為數字類型（0 或 1）
        if (!hasExpectedIndex) {
            result.精準度 = '';
        } else {
            const answerIdStr = result.answerId || '';
            result.精準度 = answerIdStr.toString().includes(String(expectedIndex)) ? 1 : 0;
        }

        // 計算推薦精準度：
        // 1. 如果精準度是1（回答Id包含預期編號），則推薦精準度也是1
        // 2. 否則，檢查推薦Id是否包含預期編號
        // 如果沒有預期編號，則不計算（設為空字串）
        // 如果有預期編號，則計算並確保為數字類型（0 或 1）
        if (!hasExpectedIndex) {
            result.推薦精準度 = '';
        } else {
            // 如果精準度是1，則推薦精準度也是1
            if (result.精準度 === 1) {
                result.推薦精準度 = 1;
            } else {
                // 否則檢查推薦Id是否包含預期編號
                const recommendIdStr = recommendId ? String(recommendId) : '';
                result.推薦精準度 = recommendIdStr.includes(String(expectedIndex)) ? 1 : 0;
            }
        }
        result.answerBy = sanitizeValueForExcel(parsed.__AnswerBy__);

        // 處理 _SemanticSearchRule_QA_REF_MAP：只要有這個欄位就解析
        if (parsed._SemanticSearchRule_QA_REF_MAP) {
            const refMap = parsed._SemanticSearchRule_QA_REF_MAP;
            if (refMap && typeof refMap === 'object') {
                // 按照 key 排序（數字順序）
                const sortedKeys = Object.keys(refMap)
                    .map(k => parseInt(k))
                    .filter(k => !isNaN(k))
                    .sort((a, b) => a - b);

                sortedKeys.forEach((key, index) => {
                    const item = refMap[String(key)];
                    if (item && typeof item === 'object') {
                        const uploadedFileName = item.uploadedFileName || '';
                        const id = item.id || '';
                        const text = item.text || '';
                        const docNum = index + 1;
                        const docKey = `文件${docNum}`;
                        result[docKey] = `文件名稱: ${uploadedFileName} (${id})\n文件內容: ${text}`;
                    }
                });
            }
        }

        const aoaiScore = entry.aoaiScore ?? '';
        const aoaiScorePrompt = entry.aoaiScorePrompt ?? '';
        if (aoaiScore) {
            const parsedAOAI = parseAOAIScoringResult(aoaiScore);
            result['AOAI評分結果'] = sanitizeValueForExcel(parsedAOAI.original);
            result['AOAI 自動判斷分數'] = sanitizeValueForExcel(parsedAOAI.score);
            result['AOAI 自動判斷區間'] = sanitizeValueForExcel(parsedAOAI.interval);
            result['AOAI 自動判斷原因'] = sanitizeValueForExcel(parsedAOAI.reason);
            result['AOAI評分prompt'] = sanitizeValueForExcel(aoaiScorePrompt);
        } else {
            result['AOAI評分結果'] = '';
            result['AOAI 自動判斷分數'] = '';
            result['AOAI 自動判斷區間'] = '';
            result['AOAI 自動判斷原因'] = '';
            result['AOAI評分prompt'] = '';
        }

        /* 添加 GenAI 參考文件欄位（參考文件1、參考文件2等） */
        Object.keys(entry).forEach(key => {
            if (/^參考文件\d+$/.test(key)) {
                result[key] = sanitizeValueForExcel(entry[key]);
            }
        });

        return result;
    }

    function computeActiveColumns(fieldsList, columnOrder = COLUMN_ORDER, requiredKeys = REQUIRED_KEYS) {
        const baseColumns = columnOrder.filter(col => {
            if (requiredKeys.has(col.key)) return true;
            return fieldsList.some(fields => {
                const value = fields[col.key];
                return value !== undefined && value !== null && String(value).trim() !== '';
            });
        });

        // 收集所有動態文件欄位（文件1、文件2...）
        const docColumns = new Map();
        fieldsList.forEach(fields => {
            Object.keys(fields).forEach(key => {
                if (/^文件\d+$/.test(key)) {
                    if (!docColumns.has(key)) {
                        docColumns.set(key, { key, header: key });
                        // 添加到淺橘色標頭集合
                        LIGHT_ORANGE_HEADERS.add(key);
                    }
                }
            });
        });

        // 收集所有動態參考文件欄位（參考文件1、參考文件2...）
        const refDocColumns = new Map();
        fieldsList.forEach(fields => {
            Object.keys(fields).forEach(key => {
                if (/^參考文件\d+$/.test(key)) {
                    if (!refDocColumns.has(key)) {
                        refDocColumns.set(key, { key, header: key });
                        // 添加到淺橘色標頭集合
                        LIGHT_ORANGE_HEADERS.add(key);
                    }
                }
            });
        });

        // 將文件欄位按數字順序排序
        const sortedDocColumns = Array.from(docColumns.values())
            .sort((a, b) => {
                const numA = parseInt(a.key.replace('文件', ''));
                const numB = parseInt(b.key.replace('文件', ''));
                return numA - numB;
            });

        // 將參考文件欄位按數字順序排序
        const sortedRefDocColumns = Array.from(refDocColumns.values())
            .sort((a, b) => {
                const numA = parseInt(a.key.replace('參考文件', ''));
                const numB = parseInt(b.key.replace('參考文件', ''));
                return numA - numB;
            });

        // 檢查是否有 Output、測試時間和回應時間，並添加到最後
        const hiddenColumns = [];

        // 檢查 Output（如果存在數據）
        if (fieldsList.some(fields => fields['output'] !== undefined && fields['output'] !== null && String(fields['output']).trim() !== '')) {
            hiddenColumns.push({ key: 'output', header: 'Output' });
        }

        // 檢查測試時間
        if (fieldsList.some(fields => fields['測試時間'] !== undefined && fields['測試時間'] !== null && String(fields['測試時間']).trim() !== '')) {
            hiddenColumns.push({ key: '測試時間', header: '測試時間' });
        }

        // 檢查回應時間
        if (fieldsList.some(fields => fields['回應時間'] !== undefined && fields['回應時間'] !== null && String(fields['回應時間']).trim() !== '')) {
            hiddenColumns.push({ key: '回應時間', header: '回應時間' });
        }

        // 順序：基礎欄位 -> 文件欄位 -> 參考文件欄位 -> 隱藏欄位（Output、測試時間、回應時間）
        const resultColumns = [...baseColumns, ...sortedDocColumns];
        
        // 添加參考文件欄位
        resultColumns.push(...sortedRefDocColumns);
        
        // 添加隱藏欄位
        resultColumns.push(...hiddenColumns);
        
        return resultColumns;
    }

    function applyHeaderStyles(worksheet, headers) {
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
        headerRow.height = DEFAULT_HEIGHT;
        headerRow.eachCell((cell, colNumber) => {
            const headerText = headers[colNumber - 1];
            // 標頭套用顏色，不套用灰底
            if (BLUE_HEADERS.has(headerText)) {
                cell.fill = FILL_BLUE;
            } else if (GREEN_HEADERS.has(headerText)) {
                cell.fill = FILL_GREEN;
            } else if (ORANGE_HEADERS.has(headerText)) {
                cell.fill = FILL_ORANGE;
            } else if (YELLOW_HEADERS.has(headerText)) {
                cell.fill = FILL_YELLOW;
            } else if (LIGHT_ORANGE_HEADERS.has(headerText)) {
                cell.fill = FILL_LIGHT_ORANGE;
            }
            // 文件欄位和參考文件欄位欄寬設為 20，其他欄位使用預設規則
            const width = (/^文件\d+$/.test(headerText) || /^參考文件\d+$/.test(headerText)) ? 20 : (WIDTH_RULES[headerText] ?? DEFAULT_WIDTH);
            const column = worksheet.getColumn(colNumber);
            column.width = width;

            // 隱藏 Output、測試時間、回應時間欄位（使用者可以手動顯示）
            if (headerText === 'Output' || headerText === '測試時間' || headerText === '回應時間') {
                column.hidden = true;
            }
        });
    }

    function applyCellStyle(cell, headerText) {
        // 資料行不套用底色，只設定對齊
        if (CENTER_TOP_HEADERS.has(headerText)) {
            cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
        } else {
            cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        }
    }

    /* 下載前嘗試用 logs 重新灌入 GenAI 參考文件，讓歷史紀錄可直接匯出 */
    function ensureGenAIDetails(entries = [], logs = []) {
        if (!Array.isArray(entries) || entries.length === 0) return entries;
        const cloned = entries.map(e => Object.assign({}, e));
        if (!Array.isArray(logs) || logs.length === 0) return cloned;

        /* 下載時強制重新解析，確保使用最新的解析邏輯 */
        const forceReextract = true;

        try {
            // 不再解析 GenAI 請求 JSON，只解析參考文件
            if (typeof parseGenAIReferencesFromLogs === 'function') {
                parseGenAIReferencesFromLogs(cloned, logs, { forceReextract });
            }
        } catch (error) {
            console.warn('[ensureGenAIDetails] 重新解析 GenAI 資料失敗:', error);
        }
        return cloned;
    }

    async function generateExcelFromEntries(entries, options = {}) {
        if (typeof ExcelJS === 'undefined') {
            throw new Error('ExcelJS 尚未載入，無法生成 Excel 檔案');
        }
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('沒有可供匯出的資料');
        }

        /* 先確保用 logs 灌入 GenAI 欄位（歷史批次也可用） */
        const entriesWithGenAI = ensureGenAIDetails(entries, options.logs || []);

        // 先 enrich TopN，然後合併處理 TopNId 和推薦Id（一次呼叫 getIdByQuestion）
        const entriesWithTopN = enrichEntriesWithTopN(entriesWithGenAI, options.logs || []);
        const domain = options.domain || (typeof CEXT !== 'undefined' && typeof CEXT.getDomain === 'function' ? CEXT.getDomain() : null);
        const entriesWithTopNIdAndRecommendId = await enrichEntriesWithTopNIdAndRecommendId(entriesWithTopN, { batchId: options.batchId, tenantName: options.tenantName, domain });

        const columnOrder = options.columnOrder || COLUMN_ORDER;
        const fieldsList = entriesWithTopNIdAndRecommendId.map(entry => extractFieldsFromEntry(entry));
        const activeColumns = computeActiveColumns(fieldsList, columnOrder, REQUIRED_KEYS);
        const headers = activeColumns.map(col => col.header);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('測試結果');
        worksheet.addRow(headers);
        applyHeaderStyles(worksheet, headers);

        entriesWithTopNIdAndRecommendId.forEach((entry, rowIdx) => {
            const fields = fieldsList[rowIdx];
            const row = worksheet.addRow([]);
            activeColumns.forEach((col, index) => {
                const value = fields[col.key];
                const cell = row.getCell(index + 1);

                // TopN精準度、推薦精準度和精準度保持為數字類型（如果是數字）或空字串
                if (col.key === 'TopN精準度' || col.key === '推薦精準度' || col.key === '精準度') {
                    if (value === null || value === undefined || value === '') {
                        cell.value = '';
                    } else if (typeof value === 'number') {
                        cell.value = value;
                    } else {
                        // 如果已經是字串，嘗試轉換為數字
                        const numValue = Number(value);
                        cell.value = isNaN(numValue) ? '' : numValue;
                    }
                } else {
                    cell.value = value === null || value === undefined ? '' : sanitizeValueForExcel(value);
                }
                applyCellStyle(cell, col.header);
            });
            row.height = DEFAULT_HEIGHT;
        });
        worksheet.eachRow((row) => {
            if (!row.height) {
                row.height = DEFAULT_HEIGHT;
            }
        });
        const buffer = await workbook.xlsx.writeBuffer({
            useStyles: true,
            useSharedStrings: false
        });
        return new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    }

    try {
        global.CEXTExportUtils = {
            getColumnOrder: () => COLUMN_ORDER.slice(),
            sanitizeValueForExcel,
            parseAOAIScoringResult,
            normalizeTextBasic,
            normalizeForCompare,
            isSameQuestion,
            extractTopNFromLogContent,
            buildLogContentMap,
            enrichEntriesWithTopN,
            enrichEntriesWithTopNId,
            enrichEntriesWithTopNIdAndRecommendId,
            extractQuestionsFromTopN,
            extractFieldsFromEntry,
            generateExcelFromEntries
        };
        // 確認已正確導出
        if (typeof global.CEXTExportUtils === 'undefined') {
            console.error('[batchTest-export-utils] CEXTExportUtils 導出失敗');
        }
    } catch (error) {
        console.error('[batchTest-export-utils] 初始化錯誤:', error);
        throw error;
    }
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);


