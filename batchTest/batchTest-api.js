/* API 呼叫函數 */

/* 判斷使用哪種 API 方式 */
function getApiType() {
    const url = parentUrl || window.location.href;

    if (url.includes('webchat/default2')) {
        return 'kms';
    } else if (url.includes('semanticsearch/engine')) {
        return 'genai';
    } else if (url.includes('wise/wiseadm')) {
        return 'adminportal';
    }

    /* 預設使用 adminportal */
    return 'adminportal';
}

/* WebChat API 呼叫 */
async function chatsAjax(question) {
    const domain = CEXT.getDomain();
    const url = `${domain}/wise/chats-ajax.jsp`;
    const params = new URLSearchParams({
        id: crypto.randomUUID(),
        q: question,
        testMode: 'false',
        userType: 'unknown',
        html: 'true',
        ch: 'semantic',
        et: 'message'
    });

    try {
        const response = await fetch(`${url}?${params.toString()}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });

        if (response.status === 200) {
            const result = await response.text();

            return {
                responseText: result
            };
        }
        throw new Error(`WebChat API 返回狀態碼: ${response.status}`);
    } catch (error) {
        throw error;
    }
}

/* WiseAdmin API 呼叫 */
async function qaAsk(question, channelName, apikey) {
    const contextId = crypto.randomUUID();
    const domain = CEXT.getDomain();
    const url = `${domain}/wise/1/qa/ask`;
    const params = new URLSearchParams({
        id: contextId,
        apikey: apikey,
        ch: channelName,
        q: question
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*'
            },
            body: params.toString()
        });

        if (response.status === 200) {
            const result = await response.text();

            return {
                responseText: result
            };
        }
        throw new Error(`WiseAdmin API 返回狀態碼: ${response.status}`);
    } catch (error) {
        throw error;
    }
}

/* GenAI API 呼叫 */
async function genaiAsk(question) {
    const domain = CEXT.getDomain();
    const url = `${domain}/wise/wiseadm/s/semanticsearch/engine/ask`;
    const params = new URLSearchParams({
        action: 'ask',
        q: question,
        testMode: 'false',
        html: 'true',
        ch: 'semantic',
        searchScope: '{}',
        et: 'message'
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*'
            },
            body: params.toString()
        });

        if (response.status === 200) {
            const result = await response.text();
            
            /* 嘗試解析 JSON 回應 */
            let toolCallContent = null;
            let references = [];
            
            try {
                toolCallContent = extractGenAIToolCallContent(result);
                if (toolCallContent) {
                    references = parseGenAIReferences(toolCallContent);
                } else {
                    /* 如果無法從 JSON 中提取，嘗試直接從原始結果中解析參考文件 */
                    references = parseGenAIReferences(result);
                }
            } catch (parseError) {
                /* 如果解析失敗，可能是 HTML 或其他格式，嘗試直接從原始結果中解析參考文件 */
                console.warn('解析 GenAI JSON 回應失敗，嘗試從原始結果解析參考文件:', parseError);
                try {
                    references = parseGenAIReferences(result);
                } catch (refParseError) {
                    console.warn('從原始結果解析參考文件也失敗:', refParseError);
                }
            }

            return {
                responseText: result,
                toolCallContent: toolCallContent,
                references: references
            };
        }
        throw new Error(`GenAI API 返回狀態碼: ${response.status}`);
    } catch (error) {
        throw error;
    }
}

/* 解析 GenAI 回應中的參考文件（只返回 ID） */
function parseGenAIReferences(content) {
    if (!content || typeof content !== 'string') {
        return [];
    }

    /* 匹配格式：T36-UploadedFile-26490-Chunk-20: */
    const referencePattern = /(T\d+-UploadedFile-\d+-Chunk-\d+):/g;
    const references = [];
    const seen = new Set();

    let match;
    while ((match = referencePattern.exec(content)) !== null) {
        const refId = match[1];
        if (!seen.has(refId)) {
            seen.add(refId);
            references.push(refId);
        }
    }

    return references;
}

/* 解析 GenAI 回應中的參考文件及其內容 */
function parseGenAIReferencesWithContent(content) {
    if (!content || typeof content !== 'string') {
        console.warn('parseGenAIReferencesWithContent: 內容為空或不是字串');
        return [];
    }

    console.log(`parseGenAIReferencesWithContent: 開始解析，內容長度: ${content.length}`);
    console.log(`parseGenAIReferencesWithContent: 內容前500字元:`, content.substring(0, 500));

    /* 匹配格式：T36-UploadedFile-26490-Chunk-20:<換行>```<換行>內容<換行>``` */
    /* 改為同時容忍 CRLF / 多餘空白，避免只切到第一段 */
    const referencePattern = /(T\d+-UploadedFile-\d+-Chunk-\d+):\s*\r?\n\s*```\r?\n([\s\S]*?)```(?=\r?\nT\d+-UploadedFile-|$)/g;
    const references = [];
    const seen = new Set();

    let match;
    let matchCount = 0;
    
    while ((match = referencePattern.exec(content)) !== null) {
        matchCount++;
        const refId = match[1];
        const refContent = match[2] || '';
        
        console.log(`parseGenAIReferencesWithContent: 找到匹配 ${matchCount}, ID: ${refId}, 內容長度: ${refContent.length}`);
        
        if (!seen.has(refId)) {
            seen.add(refId);
            references.push({
                id: refId,
                content: refContent.trim()
            });
        } else {
            console.warn(`parseGenAIReferencesWithContent: 重複的 ID: ${refId}`);
        }
    }

    console.log(`parseGenAIReferencesWithContent: 總共找到 ${matchCount} 個匹配，去重後 ${references.length} 個參考文件`);
    
    if (matchCount === 0) {
        /* 如果沒有匹配，嘗試更寬鬆的模式 */
        console.warn('parseGenAIReferencesWithContent: 使用標準正則無匹配，嘗試查找所有 TXX-UploadedFile 模式');
        const allRefIds = content.match(/T\d+-UploadedFile-\d+-Chunk-\d+/g);
        if (allRefIds) {
            console.log(`parseGenAIReferencesWithContent: 找到 ${allRefIds.length} 個可能的參考文件 ID:`, allRefIds);
        }
    }

    return references;
}

/* 從 log 內容中提取所有 Body JSON */
function extractAllBodiesFromLog(logContent) {
    if (!logContent || typeof logContent !== 'string') {
        return [];
    }

    const bodies = [];
    let searchIndex = 0;

    /* 查找所有 Body: {...} 格式的 JSON */
    while (true) {
        const bodyMatch = logContent.indexOf('Body:', searchIndex);
        if (bodyMatch === -1) {
            break;
        }

        /* 找到 Body: 後的第一個 { */
        const braceStart = logContent.indexOf('{', bodyMatch);
        if (braceStart === -1) {
            searchIndex = bodyMatch + 5;
            continue;
        }

        /* 使用更可靠的 JSON 提取方法：考慮字符串中的轉義字符 */
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        let endIndex = braceStart;
        
        for (let i = braceStart; i < logContent.length; i++) {
            const char = logContent[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            
            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        endIndex = i + 1;
                        break;
                    }
                }
            }
        }
        
        if (braceCount === 0) {
            const jsonStr = logContent.substring(braceStart, endIndex);
            try {
                const jsonObj = JSON.parse(jsonStr.trim());
                /* 檢查是否包含必要的欄位（model, messages） */
                if (jsonObj.model && jsonObj.messages) {
                    bodies.push(jsonObj);
                    console.log('成功提取 Body JSON:', {
                        model: jsonObj.model,
                        messagesCount: jsonObj.messages?.length || 0
                    });
                }
            } catch (error) {
                /* 解析失敗，跳過這個 Body */
                console.warn('解析 Body JSON 失敗:', error);
                console.warn('JSON 字串前500字元:', jsonStr.substring(0, 500));
            }
        } else {
            console.warn('無法找到完整的 JSON（括號不平衡）');
        }

        searchIndex = endIndex > bodyMatch ? endIndex : bodyMatch + 5;
    }

    console.log(`extractAllBodiesFromLog: 總共找到 ${bodies.length} 個有效的 Body JSON`);
    return bodies;
}

/* 從 log 內容中提取 Body JSON（只返回第一個，向後兼容） */
function extractBodyFromLog(logContent) {
    const bodies = extractAllBodiesFromLog(logContent);
    return bodies.length > 0 ? bodies[0] : null;
}

/* 根據問題內容匹配對應的 Body JSON */
function findBodyByQuestion(bodies, question) {
    if (!bodies || !Array.isArray(bodies) || bodies.length === 0 || !question) {
        console.warn('findBodyByQuestion: 參數無效', { bodiesCount: bodies?.length, question });
        return null;
    }

    /* 更寬鬆的標準化：去除結尾標點與常見分隔符，避免問句差異 */
    const normalize = (text = '') => {
        return text
            .trim()
            .toLowerCase()
            .replace(/[？?]+$/g, '')
            .replace(/[，,。．、\s]+/g, '');
    };
    const normalizedQuestion = normalize(question);
    console.log(`findBodyByQuestion: 查找問題 "${question}" (標準化: "${normalizedQuestion}")，共有 ${bodies.length} 個 Body JSON`);

    /* 遍歷所有 Body JSON，找到包含對應問題的那一個 */
    /* 優先匹配最後一個user message（通常是當前問題），避免匹配到對話歷史中的舊問題 */
    for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
        const body = bodies[bodyIndex];
        if (!body.messages || !Array.isArray(body.messages)) {
            console.warn(`findBodyByQuestion: Body ${bodyIndex} 沒有 messages 陣列`);
            continue;
        }

        /* 先從後往前找最後一個user message（通常是當前問題） */
        let foundMatch = false;
        for (let msgIndex = body.messages.length - 1; msgIndex >= 0; msgIndex--) {
            const message = body.messages[msgIndex];
            if (message.role === 'user' && message.content) {
                const normalizedContent = normalize(message.content);
                console.log(`findBodyByQuestion: Body ${bodyIndex}, Message ${msgIndex} (從後往前), 內容: "${message.content.substring(0, 50)}..." (標準化: "${normalizedContent.substring(0, 50)}...")`);
                
                /* 先嘗試完全匹配 */
                if (normalizedContent === normalizedQuestion) {
                    console.log(`findBodyByQuestion: 完全匹配成功！Body ${bodyIndex} (最後一個user message)`);
                    return body;
                }
                
                /* 如果完全匹配失敗，嘗試部分匹配（問題是內容的子字串，或內容是問題的子字串） */
                if (normalizedContent.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedContent)) {
                    console.log(`findBodyByQuestion: 部分匹配成功！Body ${bodyIndex} (最後一個user message)`);
                    return body;
                }
                
                /* 找到第一個user message後就停止（避免匹配到對話歷史中的舊問題） */
                foundMatch = true;
                break;
            }
        }
        
        /* 如果從後往前沒找到，再從前往後找（向後兼容） */
        if (!foundMatch) {
            for (let msgIndex = 0; msgIndex < body.messages.length; msgIndex++) {
                const message = body.messages[msgIndex];
                if (message.role === 'user' && message.content) {
                    const normalizedContent = normalize(message.content);
                    console.log(`findBodyByQuestion: Body ${bodyIndex}, Message ${msgIndex}, 內容: "${message.content.substring(0, 50)}..." (標準化: "${normalizedContent.substring(0, 50)}...")`);
                    
                    /* 先嘗試完全匹配 */
                    if (normalizedContent === normalizedQuestion) {
                        console.log(`findBodyByQuestion: 完全匹配成功！Body ${bodyIndex}`);
                        return body;
                    }
                    
                    /* 如果完全匹配失敗，嘗試部分匹配 */
                    if (normalizedContent.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedContent)) {
                        console.log(`findBodyByQuestion: 部分匹配成功！Body ${bodyIndex}`);
                        return body;
                    }
                }
            }
        }
    }

    console.warn(`findBodyByQuestion: 無法找到匹配的 Body JSON，問題: "${question}"`);
    return null;
}

/* 從 JSON 中找到對應問題的 tool call content */
function findToolCallContentByQuestion(jsonData, question) {
    if (!jsonData || !question) {
        return null;
    }

    try {
        /* 查找 messages 陣列 */
        if (!jsonData.messages || !Array.isArray(jsonData.messages)) {
            return null;
        }

        /* 找到對應問題的 user message，然後找緊接著的 tool message */
        let foundUserMessageIndex = -1;
        for (let i = 0; i < jsonData.messages.length; i++) {
            const message = jsonData.messages[i];
            if (message.role === 'user' && message.content) {
                /* 比對問題（忽略大小寫和空白） */
                const normalizedQuestion = question.trim().toLowerCase();
                const normalizedContent = message.content.trim().toLowerCase();
                
                if (normalizedContent === normalizedQuestion) {
                    foundUserMessageIndex = i;
                    break;
                }
            }
        }

        if (foundUserMessageIndex === -1) {
            return null;
        }

        /* 找到該問題之後的第一個 tool call content */
        for (let i = foundUserMessageIndex + 1; i < jsonData.messages.length; i++) {
            const message = jsonData.messages[i];
            if (message.role === 'tool' && message.content) {
                return message.content;
            }
        }

        return null;
    } catch (error) {
        console.warn('查找 tool call content 失敗:', error);
        return null;
    }
}

/* 從 GenAI JSON 回應中提取 tool call content */
function extractGenAIToolCallContent(jsonResponse) {
    try {
        let data;
        if (typeof jsonResponse === 'string') {
            data = JSON.parse(jsonResponse);
        } else {
            data = jsonResponse;
        }

        /* 查找 messages 陣列中的 tool role 項目 */
        if (data.messages && Array.isArray(data.messages)) {
            for (const message of data.messages) {
                if (message.role === 'tool' && message.content) {
                    return message.content;
                }
            }
        }

        return null;
    } catch (error) {
        console.warn('解析 GenAI JSON 回應失敗:', error);
        return null;
    }
}

/* 從 logs 中提取每個問題對應的 Body JSON 並添加到結果條目 */
function extractGenAIBodyJSONFromLogs(resultEntries, batchLogs, options = {}) {
    const { forceReextract = false } = options;
    
    if (!resultEntries || !Array.isArray(resultEntries) || !batchLogs || !Array.isArray(batchLogs)) {
        console.warn('extractGenAIBodyJSONFromLogs: 參數無效', {
            resultEntries: !!resultEntries,
            batchLogs: !!batchLogs
        });
        return;
    }

    /* 建立 log 內容映射表 */
    const logMap = new Map();
    batchLogs.forEach(log => {
        if (log && log.fileName && log.content) {
            logMap.set(log.fileName, log.content);
            logMap.set(`logs/${log.fileName}`, log.content);
        }
    });

    console.log(`extractGenAIBodyJSONFromLogs: logMap 大小 ${logMap.size}, 處理 ${resultEntries.length} 個條目`);

    /* 按 log 文件分組條目，以便正確計算相對索引 */
    const logGroups = new Map();
    resultEntries.forEach((entry, index) => {
        if (!entry || !entry.tailLog) {
            return;
        }
        const tailLogPath = entry.tailLog.replace(/^[./\\]+/, '');
        const normalizedLogPath = tailLogPath.replace(/^logs\//, '');
        
        if (!logGroups.has(normalizedLogPath)) {
            logGroups.set(normalizedLogPath, []);
        }
        logGroups.get(normalizedLogPath).push({ entry, originalIndex: index });
    });

    console.log(`extractGenAIBodyJSONFromLogs: 找到 ${logGroups.size} 個不同的 log 文件`);

    /* 處理每個 log 文件組 */
    logGroups.forEach((entries, logPath) => {
        /* 先正規化換行，避免 CRLF 造成解析誤判 */
        const rawLogContent = logMap.get(logPath) || logMap.get(`logs/${logPath}`) || '';
        const logContent = rawLogContent.replace(/\r\n/g, '\n');
        
        if (!logContent) {
            console.warn(`extractGenAIBodyJSONFromLogs: log 文件 ${logPath} 找不到內容`);
            entries.forEach(({ entry }) => {
                entry.GenAI請求JSON = '';
            });
            return;
        }

        /* 從 log 內容中提取所有 Body JSON */
        const allBodies = extractAllBodiesFromLog(logContent);
        console.log(`extractGenAIBodyJSONFromLogs: log 文件 ${logPath} 找到 ${allBodies.length} 個 Body JSON，對應 ${entries.length} 個條目`);
        
        /* 調試：列出每個條目的問題和tailLog */
        entries.forEach(({ entry, originalIndex }) => {
            console.log(`extractGenAIBodyJSONFromLogs: [調試] 條目 ${originalIndex}, tailLog=${entry.tailLog}, question="${entry.question}"`);
        });
        
        /* 調試：列出每個Body中的user問題 */
        allBodies.forEach((body, idx) => {
            const userQuestions = (body.messages || [])
                .filter(msg => msg.role === 'user' && msg.content)
                .map(msg => msg.content);
            console.log(`extractGenAIBodyJSONFromLogs: [調試] Body ${idx} 包含的user問題:`, userQuestions);
        });
        
        if (allBodies.length === 0) {
            console.warn(`extractGenAIBodyJSONFromLogs: log 文件 ${logPath} 無法提取任何 Body JSON`);
            entries.forEach(({ entry }) => {
                entry.GenAI請求JSON = '';
            });
            return;
        }

        /* 處理該 log 文件組中的每個條目 */
        entries.forEach(({ entry, originalIndex }, relativeIndex) => {
            /* 若已經有 GenAI請求JSON，避免覆蓋舊值 */
            if (entry.GenAI請求JSON && String(entry.GenAI請求JSON).trim() !== '') {
                console.log(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 已有 GenAI請求JSON，跳過覆寫`);
                return;
            }

            if (!entry.question) {
                console.warn(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 缺少問題`);
                entry.GenAI請求JSON = '';
                return;
            }

            console.log(`extractGenAIBodyJSONFromLogs: 處理條目 ${originalIndex} (log: ${logPath}, 相對索引: ${relativeIndex}), 問題: ${entry.question}`);

            /* 根據問題內容匹配對應的 Body JSON，沒比對到就留空，不 fallback */
            const bodyJson = findBodyByQuestion(allBodies, entry.question);
            
            if (!bodyJson) {
                console.warn(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 無法匹配問題 "${entry.question}"，留空`);
                entry.GenAI請求JSON = '';
                return;
            }

            console.log(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 成功匹配 Body JSON`, {
                hasModel: !!bodyJson.model,
                hasMessages: !!bodyJson.messages,
                messagesCount: bodyJson.messages?.length || 0
            });

            /* 將整個 Body JSON 存儲為字串到結果條目 */
            try {
                entry.GenAI請求JSON = JSON.stringify(bodyJson, null, 2);
                console.log(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 成功存儲 GenAI請求JSON`);
            } catch (error) {
                console.warn(`extractGenAIBodyJSONFromLogs: 條目 ${originalIndex} 序列化 Body JSON 失敗:`, error);
                entry.GenAI請求JSON = '';
            }
        });
    });
}

/* 從 logs 中解析 GenAI 參考文件並添加到結果條目 */
function parseGenAIReferencesFromLogs(resultEntries, batchLogs, options = {}) {
    const { forceReextract = false } = options;
    
    console.log('parseGenAIReferencesFromLogs: 開始解析參考文件');
    
    if (!resultEntries || !Array.isArray(resultEntries) || !batchLogs || !Array.isArray(batchLogs)) {
        console.warn('parseGenAIReferencesFromLogs: 參數無效');
        return;
    }

    /* 建立 log 內容映射表 */
    const logMap = new Map();
    batchLogs.forEach(log => {
        if (log && log.fileName && log.content) {
            logMap.set(log.fileName, log.content);
            logMap.set(`logs/${log.fileName}`, log.content);
        }
    });

    console.log(`parseGenAIReferencesFromLogs: logMap 大小 ${logMap.size}, 處理 ${resultEntries.length} 個條目`);

    /* 按 log 文件分組條目，以便正確計算相對索引 */
    const logGroups = new Map();
    resultEntries.forEach((entry, index) => {
        if (!entry || !entry.tailLog) {
            return;
        }
        const tailLogPath = entry.tailLog.replace(/^[./\\]+/, '');
        const normalizedLogPath = tailLogPath.replace(/^logs\//, '');
        
        if (!logGroups.has(normalizedLogPath)) {
            logGroups.set(normalizedLogPath, []);
        }
        logGroups.get(normalizedLogPath).push({ entry, originalIndex: index });
    });

    console.log(`parseGenAIReferencesFromLogs: 找到 ${logGroups.size} 個不同的 log 文件`);

    /* 處理每個 log 文件組 */
    logGroups.forEach((entries, logPath) => {
        /* 正規化換行，避免 CRLF 影響解析 */
        const rawLogContent = logMap.get(logPath) || logMap.get(`logs/${logPath}`) || '';
        const logContent = rawLogContent.replace(/\r\n/g, '\n');
        
        if (!logContent) {
            console.warn(`parseGenAIReferencesFromLogs: log 文件 ${logPath} 找不到內容`);
            return;
        }

        /* 從 log 內容中提取所有 Body JSON */
        const allBodies = extractAllBodiesFromLog(logContent);
        console.log(`parseGenAIReferencesFromLogs: log 文件 ${logPath} 找到 ${allBodies.length} 個 Body JSON，對應 ${entries.length} 個條目`);
        
        if (allBodies.length === 0) {
            console.warn(`parseGenAIReferencesFromLogs: log 文件 ${logPath} 無法提取任何 Body JSON`);
            return;
        }

        /* 處理該 log 文件組中的每個條目 */
        entries.forEach(({ entry, originalIndex }, relativeIndex) => {
            /* 已有參考文件欄位且不強制重新提取，則不覆蓋，避免重複寫入 */
            const hasRefAlready = Object.keys(entry || {}).some(k => /^參考文件\d+$/.test(k));
            if (!forceReextract && hasRefAlready) {
                console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 已有參考文件欄位，跳過覆寫`);
                return;
            }
            
            /* 如果強制重新提取，先清除現有的參考文件欄位 */
            if (forceReextract && hasRefAlready) {
                Object.keys(entry).forEach(key => {
                    if (/^參考文件\d+$/.test(key)) {
                        delete entry[key];
                    }
                });
                console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 強制重新提取，已清除現有參考文件欄位`);
            }

            if (!entry.question) {
                console.warn(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 缺少問題`);
                return;
            }

            console.log(`parseGenAIReferencesFromLogs: 處理條目 ${originalIndex} (log: ${logPath}, 相對索引: ${relativeIndex}), 問題: ${entry.question}`);

            /* 根據問題內容匹配對應的 Body JSON，沒比對到就跳過，不 fallback */
            const bodyJson = findBodyByQuestion(allBodies, entry.question);
            
            if (!bodyJson) {
                console.warn(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 無法匹配問題 "${entry.question}"，跳過`);
                return;
            }

            console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 成功匹配 Body JSON`);

            /* 找到對應問題的 tool call content */
            const toolCallContent = findToolCallContentByQuestion(bodyJson, entry.question);
            if (!toolCallContent) {
                console.warn(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 無法找到 tool call content`);
                return;
            }

            console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 找到 tool call content，長度: ${toolCallContent.length}`);
            console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} tool call content 前200字元:`, toolCallContent.substring(0, 200));

            /* 解析參考文件及其內容 */
            const references = parseGenAIReferencesWithContent(toolCallContent);
            console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 解析出 ${references.length} 個參考文件`);
            
            if (references && references.length > 0) {
                /* 將參考文件內容添加到結果條目 */
                if (!hasRefAlready) {
                    references.forEach((ref, idx) => {
                        const fieldName = `參考文件${idx + 1}`;
                        entry[fieldName] = ref.content || ref.id;
                        console.log(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 添加 ${fieldName}: ${ref.id}, 內容長度: ${(ref.content || '').length}`);
                    });
                }
            } else {
                console.warn(`parseGenAIReferencesFromLogs: 條目 ${originalIndex} 無法解析出參考文件`);
            }
        });
    });
    
    console.log('parseGenAIReferencesFromLogs: 完成解析參考文件');
}

/* 從現有的結果和 logs 中重新提取 GenAI 數據（可手動調用） */
async function reparseGenAIDataFromLogs() {
    console.log('reparseGenAIDataFromLogs: 開始從現有 logs 重新提取數據');
    
    /* 先嘗試從當前快照獲取 */
    let currentResults = window.latestBatchResultsSnapshot || [];
    let currentLogs = window.latestBatchLogsSnapshot || [];
    
    /* 如果快照為空，嘗試從 IndexedDB 讀取最新的批次數據 */
    if ((!currentResults || currentResults.length === 0) || (!currentLogs || currentLogs.length === 0)) {
        console.log('reparseGenAIDataFromLogs: 快照為空，嘗試從 IndexedDB 讀取');
        
        try {
            /* 嘗試調用批次存儲的讀取函數 */
            if (typeof window !== 'undefined' && window.CEXTBatchStorage) {
                const batchStorage = window.CEXTBatchStorage;
                if (typeof batchStorage.getLatestBatch === 'function') {
                    const latestBatch = await batchStorage.getLatestBatch();
                    if (latestBatch && latestBatch.results) {
                        currentResults = latestBatch.results;
                    }
                    if (latestBatch && latestBatch.logs) {
                        currentLogs = latestBatch.logs;
                    }
                }
            }
        } catch (error) {
            console.warn('reparseGenAIDataFromLogs: 從 IndexedDB 讀取失敗:', error);
        }
    }
    
    if (!currentResults || currentResults.length === 0) {
        console.warn('reparseGenAIDataFromLogs: 沒有找到結果數據');
        alert('沒有找到結果數據。請先執行批次測試，或確保 IndexedDB 中有數據。\n\n您也可以在控制台執行：\nreparseGenAIDataFromLogs([results], [logs])');
        return;
    }
    
    if (!currentLogs || currentLogs.length === 0) {
        console.warn('reparseGenAIDataFromLogs: 沒有找到 logs 數據');
        alert('沒有找到 logs 數據。請先執行批次測試，或確保 IndexedDB 中有數據。\n\n您也可以在控制台執行：\nreparseGenAIDataFromLogs([results], [logs])');
        return;
    }
    
    console.log(`reparseGenAIDataFromLogs: 找到 ${currentResults.length} 個結果，${currentLogs.length} 個 logs`);
    
    /* 先提取 Body JSON */
    if (typeof extractGenAIBodyJSONFromLogs === 'function') {
        extractGenAIBodyJSONFromLogs(currentResults, currentLogs);
    }
    
    /* 然後解析參考文件 */
    if (typeof parseGenAIReferencesFromLogs === 'function') {
        parseGenAIReferencesFromLogs(currentResults, currentLogs);
    }
    
    /* 更新表格顯示 */
    if (typeof updateResultsTable === 'function') {
        updateResultsTable();
    } else if (typeof refreshResultsTable === 'function') {
        refreshResultsTable();
    } else {
        console.warn('reparseGenAIDataFromLogs: 無法找到更新表格的函數');
    }
    
    /* 保存更新後的結果 */
    if (typeof window !== 'undefined' && window.CEXTBatchStorage) {
        const batchStorage = window.CEXTBatchStorage;
        if (typeof batchStorage.saveBatch === 'function') {
            try {
                await batchStorage.saveBatch({
                    results: currentResults,
                    logs: currentLogs
                });
                console.log('reparseGenAIDataFromLogs: 已保存更新後的結果');
            } catch (error) {
                console.warn('reparseGenAIDataFromLogs: 保存失敗:', error);
            }
        }
    }
    
    console.log('reparseGenAIDataFromLogs: 完成重新提取數據');
    alert('已從 logs 重新提取 GenAI 數據，請檢查表格');
}

/* 將函數暴露到全局，方便在控制台調用 */
/* 也支持直接傳入 results 和 logs 參數 */
if (typeof window !== 'undefined') {
    window.reparseGenAIDataFromLogs = function(results, logs) {
        if (results && logs) {
            /* 如果提供了參數，直接使用 */
            if (typeof extractGenAIBodyJSONFromLogs === 'function') {
                extractGenAIBodyJSONFromLogs(results, logs);
            }
            if (typeof parseGenAIReferencesFromLogs === 'function') {
                parseGenAIReferencesFromLogs(results, logs);
            }
            console.log('reparseGenAIDataFromLogs: 使用提供的參數完成重新提取');
            return { results, logs };
        } else {
            /* 否則使用異步版本 */
            return reparseGenAIDataFromLogs();
        }
    };
}

/* 從渠道名稱提取 channel name 和 apikey */
function extractChannelInfo(channelText) {
    if (!channelText) return { channelName: '', apikey: '' };

    /* 格式: "channelName (apikey)" */
    const match = channelText.match(/^(.+?)\s*\((.+?)\)$/);
    if (match && match.length >= 3) {
        let channelName = match[1].trim();
        const apikey = match[2].trim();

        /* 如果 channelName 是 "default"，改成 "web" */
        if (channelName.toLowerCase() === 'default') {
            channelName = 'web';
        }

        return { channelName, apikey };
    }

    /* 如果沒有括號，假設整個字串是 channel name */
    let channelName = channelText.trim();

    /* 如果 channelName 是 "default"，改成 "web" */
    if (channelName.toLowerCase() === 'default') {
        channelName = 'web';
    }

    return { channelName, apikey: '' };
}