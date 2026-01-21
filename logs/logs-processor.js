/* 日誌處理函數（套用 delete 與 coating） */
function append(text) {
    if (!text) return;

    const rawLines = String(text).split('\n');

    // 先做 delete 淨化，避免被刪掉的行影響 coating 切塊
    const cleanedLines = [];
    for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i] === "" && i === rawLines.length - 1) break; /* 最後一個空行跳過 */
        const del = processDeleteRule(rawLines[i]);
        if (!del.shouldDelete) cleanedLines.push(rawLines[i]);
    }

    // 先處理 coating（先包裝，產生 __{key}__ 標記）
    const chunks = processCoatingBlocks(cleanedLines);

    // 將 chunks 展開成行列表（包括 coating 產生的 __{key}__ 標記行）
    // 對於 block 類型，根據 joinLineBreak 參數決定是否組合
    const expandedLines = [];
    for (const chunk of chunks) {
        if (chunk.type === 'line') {
            expandedLines.push(chunk.line);
        } else if (chunk.type === 'block') {
            if (chunk.emitMarkers !== false) {
                expandedLines.push(`__${chunk.key}__`);
            }
            if (chunk.joinLineBreak !== null && chunk.joinLineBreak !== false) {
                // 如果 joinLineBreak 是字符串，使用該字符串連接；如果是 true（舊格式兼容），使用 \n
                const separator = typeof chunk.joinLineBreak === 'string' ? chunk.joinLineBreak : '\n';
                const blockContent = chunk.lines.join(separator);
                expandedLines.push(blockContent);
            } else {
                for (const l of chunk.lines) {
                    expandedLines.push(l);
                }
            }
            if (chunk.emitMarkers !== false) {
                expandedLines.push(`__${chunk.key}__`);
            }
        }
    }

    // 應用 lineReplacer 規則進行替換（對所有行，包括 coating 產生的標記行）
    const replacedLines = [];
    for (let i = 0; i < expandedLines.length; i++) {
        const replaceResult = processLineReplacerRule(expandedLines[i]);
        replacedLines.push(replaceResult.content);
    }

    // 處理分隔線，將分隔線和非分隔線分開處理
    const segments = []; // 分段：[{ type: 'separator' | 'lines', content: ... }]
    for (let i = 0; i < replacedLines.length; i++) {
        const line = replacedLines[i];

        /* 檢查是否為雙行分隔線（67個星號 + 換行 + 67個星號） */
        if (isDoubleSeparator(replacedLines, i)) {
            if (segments.length > 0 && segments[segments.length - 1].type === 'lines' && segments[segments.length - 1].content.length === 0) {
                // 如果上一個段是空的 lines，移除它
                segments.pop();
            }
            segments.push({ type: 'separator', separatorType: 'double-separator' });
            i++; // 跳過下一行（已包含在雙行分隔線中）
            continue;
        }

        /* 檢查是否為單行分隔線（67個星號） */
        if (isSingleSeparator(line)) {
            if (segments.length > 0 && segments[segments.length - 1].type === 'lines' && segments[segments.length - 1].content.length === 0) {
                segments.pop();
            }
            segments.push({ type: 'separator', separatorType: 'single-separator' });
            continue;
        }

        /* 處理其他分隔線規則 */
        const separatorResult = processSeparatorRule(line);
        if (separatorResult.isSeparator) {
            if (segments.length > 0 && segments[segments.length - 1].type === 'lines' && segments[segments.length - 1].content.length === 0) {
                segments.pop();
            }
            segments.push({ type: 'separator', separatorType: 'other-separator' });
            continue;
        }

        /* 非分隔線，添加到當前段或創建新段 */
        if (segments.length === 0 || segments[segments.length - 1].type === 'separator') {
            segments.push({ type: 'lines', content: [] });
        }
        segments[segments.length - 1].content.push(line);
    }

    // 處理每個段並渲染
    for (const segment of segments) {
        if (segment.type === 'separator') {
            // 處理分隔線
            currentBlock = createNewBlock(segment.separatorType);
            logEl.appendChild(currentBlock);
            if (enableSpecialBlockBeautify) {
                specialBlockStack = [];
            }
        } else if (segment.type === 'lines') {
            // 渲染所有行（包括 __{key}__ 標記行）
            for (const line of segment.content) {
                renderOneLine(line);
            }
        }
    }

    /* 只有在使用者位於底部時才自動滾動 */
    if (isAtBottom && !userScrolled) {
        window.scrollTo(0, document.body.scrollHeight);
    }
}