/* logs-logsBeauty.js */

const logsBeauty = {};

/* Rule 1: COMMON_SENSE */
logsBeauty.ohMyGod = function (line, groups) {
    const [id, question, score] = groups;
    return `${id} ${question}, score: ${score}`;
};

/* Rule 2: OpenAI 回傳內容簡化 */
logsBeauty.openaiResponse = function (line, groups) {
    const [, content] = groups;
    return content;
};

/* Rule 3: otherPossibleQuestions JSON beautify */
logsBeauty.otherQuestions = function (line, groups) {
    let rawJson = (groups[1] || '').trim();

    /* 只抓中括號陣列部分：第一個 [ 到最後一個 ] */
    const firstBracket = rawJson.indexOf('[');
    const lastBracket = rawJson.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        return rawJson;  /* 找不到合法 JSON，就原樣回傳 */
    }
    rawJson = rawJson.substring(firstBracket, lastBracket + 1);

    let arr;
    try {
        arr = JSON.parse(rawJson);
    } catch (e) {
        const preview = rawJson.length > 200 ? rawJson.substring(0, 200) + "..." : rawJson;
        return `JSON parse error: ${e.message}\n原始 JSON: ${preview}`;
    }

    if (!Array.isArray(arr) || arr.length === 0) {
        return "Error: JSON 不是陣列或為空";
    }

    /* 嘗試從原始日誌中提取所有 "QA found for kid" 記錄來重建完整的向量列表 */
    let allVectors = [];
    try {
        /* 從全局 rawLogData 中提取，但只搜索最近的日誌（最後 2000 行）以提高效率 */
        let logContext = '';
        if (typeof rawLogData !== 'undefined' && Array.isArray(rawLogData) && rawLogData.length > 0) {
            /* 將所有日誌塊連接起來 */
            const allLogs = rawLogData.join('\n');
            /* 只搜索最後 2000 行（大約最後 100KB 的日誌）以提高效率 */
            const lines = allLogs.split('\n');
            const recentLines = lines.slice(-2000);
            logContext = recentLines.join('\n');
        } else {
            logContext = line;
        }
        
        /* 正則表達式匹配 "QA found for kid: XXX, tenantId: YYY, question: ZZZ, score: SSS" */
        const qaFoundRegex = /QA found for kid:\s*(\d+),\s*tenantId:\s*\d+,\s*question:\s*([^,]+),\s*score:\s*([\d.]+)/g;
        let match;
        const vectorMap = new Map(); // 用於去重，key 為 "kid::question::score"
        
        while ((match = qaFoundRegex.exec(logContext)) !== null) {
            const kid = parseInt(match[1]);
            const question = match[2].trim();
            const score = parseFloat(match[3]);
            
            /* 使用 kid::question::score 作為 key，保留所有不同的分數記錄 */
            const key = `${kid}::${question}::${score}`;
            if (!vectorMap.has(key)) {
                vectorMap.set(key, { kid, question, score });
            }
        }
        
        allVectors = Array.from(vectorMap.values());
    } catch (e) {
        /* 如果提取失敗，使用 JSON 中的資料 */
        console.warn('無法從日誌中提取完整向量列表:', e);
    }

    /* 轉成乾淨結構＋處理 score 為數字 */
    const normalized = arr
        .map(o => ({
            kid: o.kid,
            question: o.question || '',
            score: typeof o.score === 'number' ? o.score : Number(o.score || 0)
        }))
        .filter(o => o.question);  /* 沒有 question 的就忽略 */

    /* 如果成功提取到完整的向量列表，使用它；否則使用 JSON 中的資料 */
    const vectorsForDisplay = allVectors.length > 0 ? allVectors : normalized;

    if (vectorsForDisplay.length === 0) {
        return "Error: 沒有有效的 question 資料";
    }

    /* escape HTML，避免題目裡有 < > & 等字元影響排版 */
    const escapeHtml = (str) => {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /* 共用 row 產生器：id 標準問題 分數 */
    const toRowHtml = (o) => {
        return `
        <tr>
          <td class="other-qs-kid">${escapeHtml(o.kid)}</td>
          <td class="other-qs-question">${escapeHtml(o.question)}</td>
          <td class="other-qs-score">${escapeHtml(o.score)}</td>
        </tr>
      `.trim();
    };

    /* ===== 1. 原始 Top（可含重複）＋排序 ===== */
    /* 使用從日誌中提取的完整向量列表（包含所有重複項目），如果提取失敗則使用 JSON 中的資料 */
    /* 注意：這裡不進行任何去重，保留原始資料中的所有項目 */
    const topSorted = vectorsForDisplay.slice().sort((a, b) => b.score - a.score);
    const topRowsHtml = topSorted.map(toRowHtml).join("");

    /* ===== 2. 去重後列表（同 kid+question 只留分數最高）＋排序 ===== */
    /* 使用 Map 來去重：相同的 kid+question 組合只保留分數最高的那一筆 */
    /* 使用 normalized（來自 JSON，已經是去重後的結果）作為去重列表 */
    const bestMap = new Map();
    normalized.forEach(o => {
        const key = `${o.kid}::${o.question}`;
        const exist = bestMap.get(key);
        if (!exist || o.score > exist.score) {
            bestMap.set(key, o);
        }
    });
    const dedupList = Array.from(bestMap.values()).sort((a, b) => b.score - a.score);
    const dedupRowsHtml = dedupList.map(toRowHtml).join("");

    const html = `
      <div class="other-qs-block">
        <div class="other-qs-title">找到的相似向量</div>
        <table class="other-qs-table">
          <tbody>
            ${topRowsHtml}
          </tbody>
        </table>
  
        <div class="other-qs-title">找到的題目</div>
        <table class="other-qs-table">
          <tbody>
            ${dedupRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    return html.trim();
};

/* Rule 4: QA found 區塊美化 */
logsBeauty.qaFoundBlock = function (line, groups) {
    const qaFoundRegex = /QA found for kid:\s*(\d+),\s*tenantId:\s*(\d+),\s*question:\s*([^,]+),\s*score:\s*([\d.]+)/g;
    const items = [];
    let match;

    while ((match = qaFoundRegex.exec(line)) !== null) {
        items.push({
            kid: match[1],
            tenantId: match[2],
            question: match[3].trim(),
            score: match[4]
        });
    }

    if (items.length === 0) {
        return line;
    }

    const escapeHtml = (str) => {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const rowsHtml = items.map(o => `
        <tr>
          <td class="other-qs-kid">${escapeHtml(o.kid)}</td>
          <td class="other-qs-tenant">${escapeHtml(o.tenantId)}</td>
          <td class="other-qs-question">${escapeHtml(o.question)}</td>
          <td class="other-qs-score">${escapeHtml(o.score)}</td>
        </tr>
    `.trim()).join("");

    const html = `
      <div class="other-qs-block">
        <div class="other-qs-title">QA found 結果</div>
        <table class="other-qs-table">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    return html.trim();
};

// 將 logsBeauty 設為全域變數，供其他腳本使用
if (typeof window !== 'undefined') {
    window.logsBeauty = logsBeauty;
}
