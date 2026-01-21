/* 結果解析函數 */

/* 從 originalLogs 解析參考文件 */
function parseReferenceFiles(originalLogs) {
    const referenceFiles = {};

    if (!originalLogs || typeof originalLogs !== 'string') {
        return referenceFiles;
    }

    /* 正則表達式：匹配 "T6-File-426-Chunk-0: ```XXXXXXX```" 格式 */
    /* 匹配格式：文件段落: ```文件內容``` */
    const regex = /(\S+):\s*```([^`]+)```/g;
    let match;

    /* 用 Set 來追蹤已見過的文件段落，避免重複 */
    const seenSegments = new Set();
    const uniqueFiles = [];

    while ((match = regex.exec(originalLogs)) !== null) {
        const fileSegment = match[1].trim();      // 文件段落，如 T6-File-426-Chunk-0
        const fileContent = match[2].trim();     // 文件內容，如 XXXXXXX

        /* 如果文件段落已經出現過，跳過 */
        if (!seenSegments.has(fileSegment)) {
            seenSegments.add(fileSegment);
            uniqueFiles.push({
                segment: fileSegment,
                content: fileContent
            });
        }
    }

    /* 格式化為「文件段落: XXX\n文件內容: OOO」格式 */
    let index = 1;
    for (const file of uniqueFiles) {
        referenceFiles[`參考文件${index}`] = `文件段落: ${file.segment}\n文件內容: ${file.content}`;
        index++;
    }

    return referenceFiles;
}

/* 解析 API 回應的 result */
function parseResult(rawResult, id, question, originalLogs = '', topN = []) {
    try {
        /* 嘗試解析 JSON（如果 result 是字串） */
        let result;
        if (typeof rawResult === 'string') {
            try {
                result = JSON.parse(rawResult);
            } catch (e) {
                /* 如果解析失敗，可能是 HTML 或其他格式 */
                /* 解析 originalLogs 中的參考文件 */
                const referenceFiles = parseReferenceFiles(originalLogs || '');

                return {
                    id: id,
                    question: question,
                    answer: rawResult,
                    __AnswerBy__: 'NoAnswer',
                    originalQuestionTime: '',
                    datetime: '',
                    originalLogs: originalLogs || '',
                    topN: Array.isArray(topN) ? topN.join('\n') : '',
                    referenceFiles: referenceFiles,
                    solrAnswer: '',
                    enhancedFuzzyList: '',
                    answerFiles: {}
                };
            }
        } else {
            result = rawResult;
        }

        /* 提取 __AnswerBy__ */
        const answerBy = result.__AnswerBy__ || result.answerBy || '';
        const finalAnswerBy = answerBy ? answerBy : 'NoAnswer';

        /* 提取 originalQuestionTime */
        const originalQuestionTime = result.originalQuestionTime || '';

        /* 提取 datetime */
        const datetime = result.datetime || '';

        /* 解析 answer */
        let answer = '';

        /* 優先從 rm.messages 解析 */
        if (result.rm && Array.isArray(result.rm.messages)) {
            const messageParts = [];

            for (const msg of result.rm.messages) {
                if (msg.type === 'text' && msg.text) {
                    messageParts.push(msg.text);
                } else if (msg.type === 'html' && msg.html) {
                    messageParts.push(msg.html);
                } else if (msg.type === 'text' && msg.content) {
                    /* 有些格式可能是 content 而不是 text */
                    messageParts.push(msg.content);
                }
            }

            if (messageParts.length > 0) {
                answer = messageParts.join('\n');
            }
        }

        /* 如果從 messages 取不到，就用 output */
        if (!answer && result.output) {
            answer = result.output;
        }

        /* 如果都沒有，嘗試用 result.answer 或其他可能的欄位 */
        if (!answer) {
            answer = result.answer || result.text || result.content || '';
        }

        /* 如果還是沒有，至少顯示原始結果的一部分 */
        if (!answer && typeof rawResult === 'string') {
            answer = rawResult.substring(0, 500);
        }

        /* 移除 <script>...</script> 標籤 */
        if (answer && typeof answer === 'string') {
            answer = answer.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        }

        /* 格式化 topN 為字串 */
        const topNString = Array.isArray(topN) ? topN.join('\n') : '';

        /* 根據 __AnswerBy__ 解析對應的結構 */
        let solrAnswer = '';
        let enhancedFuzzyList = '';
        let answerFiles = {};

        /* 優先處理 DirectAnswerRule 或 FuzzyAnswerRule */
        if (finalAnswerBy === 'DirectAnswerRule' || finalAnswerBy === 'FuzzyAnswerRule' || finalAnswerBy === 'QADialogRule') {
            /* 解析 result.kid（確定是 int） */
            if (result.kid !== undefined && result.kid !== null) {
                /* kid 是整數，直接轉換為字串 */
                solrAnswer = String(result.kid);
            }
        } else if (finalAnswerBy === 'EnhancedFuzzyAnswerRule') {
            /* 解析 _EnhancedFuzzyAnswerRule_QA_REF_MAP */
            const refMap = result._EnhancedFuzzyAnswerRule_QA_REF_MAP;
            if (refMap && typeof refMap === 'object') {
                const values = Object.values(refMap).filter(v => v && typeof v === 'string');
                enhancedFuzzyList = values.join('\n');
            }
        } else if (finalAnswerBy === 'SemanticSearchRule') {
            /* 解析 _SemanticSearchRule_QA_REF_MAP */
            const refMap = result._SemanticSearchRule_QA_REF_MAP;
            if (refMap && typeof refMap === 'object') {
                /* 按照 key 排序（數字順序） */
                const sortedKeys = Object.keys(refMap).map(k => parseInt(k)).sort((a, b) => a - b);
                let index = 1;

                for (const key of sortedKeys) {
                    const item = refMap[key];
                    if (item && typeof item === 'object') {
                        const fileName = item.uploadedFileName || '';
                        const id = item.id || '';
                        const text = item.text || '';

                        answerFiles[`回答文件${index}`] = `文件檔名: ${fileName} (${id})\n文件內容: ${text}`;
                        index++;
                    }
                }
            }
        }

        /* 解析 originalLogs 中的參考文件 */
        const referenceFiles = parseReferenceFiles(originalLogs || '');

        return {
            id: id,
            question: question,
            answer: answer,
            __AnswerBy__: finalAnswerBy,
            originalQuestionTime: originalQuestionTime,
            datetime: datetime,
            originalLogs: originalLogs || '',
            topN: topNString,
            referenceFiles: referenceFiles,
            solrAnswer: solrAnswer,
            enhancedFuzzyList: enhancedFuzzyList,
            answerFiles: answerFiles
        };

    } catch (error) {
        const topNString = Array.isArray(topN) ? topN.join('\n') : '';
        const referenceFiles = parseReferenceFiles(originalLogs || '');

        return {
            id: id,
            question: question,
            answer: `解析錯誤: ${error.message}`,
            __AnswerBy__: 'NoAnswer',
            originalQuestionTime: '',
            datetime: '',
            originalLogs: originalLogs || '',
            topN: topNString,
            referenceFiles: referenceFiles,
            solrAnswer: '',
            enhancedFuzzyList: '',
            answerFiles: {}
        };
    }
}

