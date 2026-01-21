function compileRegex(s) {
    if (typeof s !== 'string') return null;
    if (s.startsWith('/') && s.endsWith('/')) {
        const body = s.slice(1, -1);
        return new RegExp(body);
    }
    return null;
}

async function loadCleanLogRules() {
    try {
        const response = await fetch('./clean_log_rules.json');
        cleanLogRules = await response.json();
    } catch (e) {
        cleanLogRules = { delete: [], coating: {}, lineReplacer: [] };
    }

    // 嚴格使用檔案內容，不做自動補
    if (!Array.isArray(cleanLogRules.delete)) cleanLogRules.delete = [];
    if (typeof cleanLogRules.coating !== 'object' || cleanLogRules.coating === null) {
        cleanLogRules.coating = {};
    }
    if (!Array.isArray(cleanLogRules.lineReplacer)) {
        cleanLogRules.lineReplacer = [];
    }
}

function processDeleteRule(line) {
    if (!cleanLogRules || !cleanLogRules.delete || cleanLogRules.delete.length === 0) {
        return { shouldDelete: false };
    }

    for (const rule of cleanLogRules.delete) {
        try {
            if (rule.startsWith('/') && rule.endsWith('/')) {
                const pattern = rule.replace(/^\/|\/$/g, '').replace(/\\/g, '\\');
                const regex = new RegExp(pattern);
                if (regex.test(line)) {
                    return { shouldDelete: true, matchedRule: rule };
                }
            } else {
                if (line.includes(rule)) {
                    return { shouldDelete: true, matchedRule: rule };
                }
            }
        } catch (e) {
        }
    }

    return { shouldDelete: false };
}

function processCoatingBlocks(cleanedLines) {
    const results = [];
    const rules = (cleanLogRules && cleanLogRules.coating) ? cleanLogRules.coating : {};
    const ruleList = [];

    // 預先編譯
    for (const key of Object.keys(rules)) {
        const r = rules[key] || {};
        const startRe = compileRegex(r.startLines);
        const endRe = (r.endLines === null || r.endLines === undefined) ? null : compileRegex(r.endLines);
        if (!startRe) continue;

        const isNegEnd =
            endRe !== null &&
            typeof r.endLines === 'string' &&
            r.endLines.startsWith('/^(') &&
            r.endLines.startsWith('/^(?!'); // 明確偵測 ^(?! ... )

        // joinLineBreak: 如果是字符串，使用該字符串作為連接符；如果是 null，則不組合（等同於 false）
        const joinLineBreak = (typeof r.joinLineBreak === 'string') ? r.joinLineBreak : (r.joinLineBreak === true ? '\n' : null);
        const emitMarkers = (r.emitMarkers !== false);

        ruleList.push({ key, startRe, endRe, isNegEnd, joinLineBreak, emitMarkers });
    }

    let i = 0;
    while (i < cleanedLines.length) {
        const line = cleanedLines[i];

        // 嘗試匹配任一 coating 起始
        let matchedRule = null;
        for (const rule of ruleList) {
            if (rule.startRe.test(line)) {
                matchedRule = rule;
                break;
            }
        }

        if (!matchedRule) {
            // 一般行
            results.push({ type: 'line', line });
            i += 1;
            continue;
        }

        // 命中某個區塊，開始向下收集
        const blockLines = [];
        blockLines.push(line); // 起始行必收
        let j = i + 1;

        // 如果 endLines 是 null，只取 startLines 那一行
        if (matchedRule.endRe === null) {
            results.push({ type: 'block', key: matchedRule.key, lines: blockLines, joinLineBreak: matchedRule.joinLineBreak, emitMarkers: matchedRule.emitMarkers });
            i = j;
        } else if (matchedRule.isNegEnd) {
            // endLines 為 ^(?!...)：當遇到「匹配 endLines」的行 => 在前一行結束，該行不吃
            while (j < cleanedLines.length) {
                const probe = cleanedLines[j];
                if (matchedRule.endRe.test(probe)) {
                    // 這行不屬於區塊，停止於 j-1
                    break;
                }
                // 檢查這行是否是其他規則的開始行（避免被包含在當前區塊內）
                let isOtherRuleStart = false;
                for (const otherRule of ruleList) {
                    if (otherRule.key !== matchedRule.key && otherRule.startRe.test(probe)) {
                        isOtherRuleStart = true;
                        break;
                    }
                }
                if (isOtherRuleStart) {
                    // 這行是其他規則的開始，應該停止當前區塊
                    break;
                }
                blockLines.push(probe);
                j += 1;
            }
            // 包成區塊（不包含 j 那行）
            results.push({ type: 'block', key: matchedRule.key, lines: blockLines, joinLineBreak: matchedRule.joinLineBreak, emitMarkers: matchedRule.emitMarkers });
            // 後續從 j 繼續（不吃掉 j）
            i = j;
        } else {
            // 一般 endLines：當遇到匹配 endLines 的行，該行也包含在區塊內
            while (j < cleanedLines.length) {
                const probe = cleanedLines[j];
                blockLines.push(probe);
                if (matchedRule.endRe.test(probe)) {
                    j += 1; // 吃掉 end 行
                    break;
                }
                j += 1;
            }
            results.push({ type: 'block', key: matchedRule.key, lines: blockLines, joinLineBreak: matchedRule.joinLineBreak, emitMarkers: matchedRule.emitMarkers });
            i = j;
        }
    }

    return results;
}

function processLineReplacerRule(line) {
    if (
        !cleanLogRules ||
        !cleanLogRules.lineReplacer ||
        !Array.isArray(cleanLogRules.lineReplacer)
    ) {
        return { processed: false, content: line };
    }

    let processedLine = line;

    for (const rule of cleanLogRules.lineReplacer) {
        try {
            if (!rule.pattern) continue;

            let pattern = rule.pattern;
            if (pattern.startsWith("/") && pattern.endsWith("/"))
                pattern = pattern.slice(1, -1);

            if (pattern.startsWith("(?s)"))
                pattern = pattern.substring(4).replace(/\./g, "[\\s\\S]");

            const regex = new RegExp(pattern);
            const match = processedLine.match(regex);
            if (!match) continue;

            const groups = match.slice(1);

            if (rule.script) {
                // 解析路徑字串，例如 "logsBeauty.otherQuestions" -> window.logsBeauty.otherQuestions
                const fn = rule.script.split('.').reduce((obj, key) => obj && obj[key], window);
                if (typeof fn === "function") {
                    processedLine = fn(processedLine, groups);
                    return { processed: true, content: processedLine, originalContent: line };
                }
                continue;
            }

            if (rule.replacement) {
                processedLine = processedLine.replace(regex, rule.replacement);
                return { processed: true, content: processedLine, originalContent: line };
            }
        } catch (e) { }
    }

    return { processed: false, content: line };
}

function renderOneLine(lineText) {
    /* 檢查是否為特殊區塊標題 (__{}__ 格式) */
    const specialBlockResult = processSpecialBlockRule(lineText);
    if (specialBlockResult.isSpecialBlock) {
        const headerContent = specialBlockResult.headerContent;
        const isImportant = specialBlockResult.isImportant || false;

        if (enableSpecialBlockBeautify) {
            /* 美化模式：處理特殊區塊邏輯 */
            const existingIndex = specialBlockStack.findIndex(item => item.header === headerContent && !item.closed);

            if (existingIndex === -1) {
                /* 決定要添加到哪個父區塊：如果堆疊中有活躍的區塊，就添加到該區塊；否則添加到主區塊 */
                const activeSpecialBlock = specialBlockStack.slice().reverse().find(item => !item.closed);
                const parentBlock = activeSpecialBlock ? activeSpecialBlock.contentArea : ensureCurrentBlock();

                /* 創建特殊區塊並添加到父區塊內部 */
                const specialBlock = createSpecialBlock(headerContent, isImportant);
                parentBlock.appendChild(specialBlock.block);

                /* 推入堆疊 */
                specialBlockStack.push({
                    header: headerContent,
                    contentArea: specialBlock.contentArea,
                    closed: false
                });
            } else {
                specialBlockStack[existingIndex].closed = true;
                /* 從堆疊中移除已關閉的項目，確保後續內容不會添加到已關閉的區塊 */
                specialBlockStack.splice(existingIndex, 1);
            }
        }

        /* 無論美化模式如何，都要創建原始標題行（用於切換顯示） */
        lineCounter++;
        const lineId = `line-${lineCounter}`;
        const div = document.createElement('div');
        div.className = 'line original-header-line';
        div.id = lineId;
        div.setAttribute('data-header', headerContent);

        /* 創建 Grid 佈局容器 */
        const gridContainer = document.createElement('div');
        gridContainer.className = 'line-grid';

        /* 行號 */
        const lineNumber = document.createElement('div');
        lineNumber.className = 'line-number';
        lineNumber.textContent = lineCounter;

        /* 內容區域 */
        const contentArea = document.createElement('div');
        contentArea.className = 'line-content';
        // 檢測是否包含 HTML 標籤，如果有則使用 innerHTML，否則使用 textContent
        // 檢查是否包含常見的 HTML 標籤（包括換行符的情況）
        if (/<[a-z][a-z0-9]*[\s\S]*>/i.test(lineText) || /<\/[a-z][a-z0-9]*>/i.test(lineText)) {
            contentArea.innerHTML = lineText;
        } else {
            contentArea.textContent = lineText;
        }

        gridContainer.appendChild(lineNumber);
        gridContainer.appendChild(contentArea);
        div.appendChild(gridContainer);

        /* 添加到主區塊 */
        const mainBlock = ensureCurrentBlock();
        mainBlock.appendChild(div);

        /* 根據美化模式設置顯示狀態 */
        if (enableSpecialBlockBeautify) {
            div.style.display = 'none';
        } else {
            div.style.display = 'block';
        }

        return;
    }

    /* 普通行 */
    lineCounter++;
    const lineId = `line-${lineCounter}`;
    const div = document.createElement('div');
    div.className = 'line';
    div.id = lineId;

    /* 創建 Grid 佈局容器 */
    const gridContainer = document.createElement('div');
    gridContainer.className = 'line-grid';

    /* 行號 */
    const lineNumber = document.createElement('div');
    lineNumber.className = 'line-number';
    lineNumber.textContent = lineCounter;

    /* 內容區域 */
    const contentArea = document.createElement('div');
    contentArea.className = 'line-content';
    // 檢測是否包含 HTML 標籤，如果有則使用 innerHTML，否則使用 textContent
    if (/<[a-z][\s\S]*>/i.test(lineText)) {
        contentArea.innerHTML = lineText;
    } else {
        contentArea.textContent = lineText;
    }

    gridContainer.appendChild(lineNumber);
    gridContainer.appendChild(contentArea);
    div.appendChild(gridContainer);

    /* 決定要添加到哪個區塊：只有在美化模式下才添加到特殊區塊 */
    const activeSpecialBlock = specialBlockStack.slice().reverse().find(item => !item.closed);
    const targetBlock = (activeSpecialBlock && enableSpecialBlockBeautify) ? activeSpecialBlock.contentArea : ensureCurrentBlock();

    targetBlock.appendChild(div);
}

function isDoubleSeparator(lines, currentIndex) {
    if (currentIndex + 1 >= lines.length) return false;

    const currentLine = lines[currentIndex].trim();
    const nextLine = lines[currentIndex + 1].trim();

    // 檢查是否為67個星號
    const starPattern = /^\*{67}$/;

    return starPattern.test(currentLine) && starPattern.test(nextLine);
}

function isSingleSeparator(line) {
    const trimmedLine = line.trim();
    const starPattern = /^\*{67}$/;
    return starPattern.test(trimmedLine);
}

function processSeparatorRule(line) {
    // 檢查是否為分隔線（多個星號或等號，但排除67個星號）
    const trimmedLine = line.trim();

    // 先檢查是否為67個星號，如果是則不處理（由專門的函數處理）
    const star67Pattern = /^\*{67}$/;
    if (star67Pattern.test(trimmedLine)) {
        return { isSeparator: false };
    }

    // 檢查其他分隔線（多個星號或等號）
    const separatorPattern = /^[*=]{10,}$/;
    if (separatorPattern.test(trimmedLine)) {
        return { isSeparator: true, content: trimmedLine };
    }

    return { isSeparator: false };
}

function processSpecialBlockRule(line) {
    // 檢測 __{}__ 格式
    const specialBlockPattern = /^__(.*?)__$/;
    const match = line.match(specialBlockPattern);

    if (match) {
        let headerContent = match[1]; // 提取 {} 中的內容
        let isImportant = false;

        // 檢查是否包含 [IMPORTANT] 標記
        if (headerContent.includes('[IMPORTANT]')) {
            isImportant = true;
            // 移除 [IMPORTANT] 字樣（包括前後空白）
            headerContent = headerContent.replace(/\[IMPORTANT\]/g, '').trim();
            // 清理多餘的空格
            headerContent = headerContent.replace(/\s+/g, ' ');
        }

        return {
            isSpecialBlock: true,
            headerContent: headerContent,
            isImportant: isImportant,
            fullContent: line
        };
    }

    return { isSpecialBlock: false };
}

// 特殊區塊美化開關（保留變量定義，供其他文件使用）
var enableSpecialBlockBeautify = true;
var specialBlockStack = [];