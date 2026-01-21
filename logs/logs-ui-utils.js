/* UI 函數 */
function setMeta(text) {
    metaEl.textContent = text;
}

/* 檢查是否在底部 */
function checkIfAtBottom() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    /* 允許 5px 的誤差 */
    const threshold = 5;
    isAtBottom = (scrollTop + windowHeight >= documentHeight - threshold);

    return isAtBottom;
}

/* 滾動到底部 */
function scrollToBottom() {
    window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
    });
    isAtBottom = true;
    userScrolled = false;
}

/* 創建可展開的日誌行元素 */
function createExpandableLine(content, remaining, fullContent) {
    lineCounter++;
    const lineId = `line-${lineCounter}`;

    const div = document.createElement('div');
    div.className = 'line expandable-line';
    div.id = lineId;

    /* 創建 Grid 佮局容器 */
    const gridContainer = document.createElement('div');
    gridContainer.className = 'line-grid';

    /* 行號 */
    const lineNumber = document.createElement('div');
    lineNumber.className = 'line-number';
    lineNumber.textContent = lineCounter;

    /* 內容區域 */
    const contentArea = document.createElement('div');
    contentArea.className = 'line-content';

    const contentSpan = document.createElement('span');
    contentSpan.textContent = content;

    const expandBtn = document.createElement('span');
    expandBtn.className = 'expand-btn';
    expandBtn.textContent = '[...]';

    const fullSpan = document.createElement('span');
    fullSpan.textContent = remaining;
    fullSpan.style.display = 'none';

    contentArea.appendChild(contentSpan);
    contentArea.appendChild(expandBtn);
    contentArea.appendChild(fullSpan);

    gridContainer.appendChild(lineNumber);
    gridContainer.appendChild(contentArea);
    div.appendChild(gridContainer);

    let isExpanded = false;

    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;

        if (isExpanded) {
            expandBtn.textContent = '[收起]';
            fullSpan.style.display = 'inline';
        } else {
            expandBtn.textContent = '[...]';
            fullSpan.style.display = 'none';
        }
    });

    return div;
}

/* 創建特殊樣式區塊（用於 __{}__ 格式） */
function createSpecialBlock(headerContent, isImportant = false) {
    blockCounter++;
    const blockId = `special-block-${blockCounter}`;

    const blockDiv = document.createElement('div');
    blockDiv.className = isImportant ? 'special-log-block important-block' : 'special-log-block';
    blockDiv.id = blockId;
    blockDiv.setAttribute('data-type', 'special');
    if (isImportant) {
        blockDiv.setAttribute('data-important', 'true');
    }

    /* 創建標題區域 */
    const headerDiv = document.createElement('div');
    headerDiv.className = isImportant ? 'special-block-header important-header' : 'special-block-header';
    headerDiv.textContent = headerContent;

    /* 創建內容區域 */
    const contentDiv = document.createElement('div');
    contentDiv.className = isImportant ? 'special-block-content important-content' : 'special-block-content';

    blockDiv.appendChild(headerDiv);
    blockDiv.appendChild(contentDiv);

    return { block: blockDiv, contentArea: contentDiv };
}

/* 創建新的區塊容器 */
function createNewBlock(reason = 'unknown') {
    blockCounter++;
    const blockId = `block-${blockCounter}`;

    const blockDiv = document.createElement('div');
    blockDiv.className = 'log-block';
    blockDiv.id = blockId;
    blockDiv.setAttribute('data-reason', reason);

    return blockDiv;
}

/* 確保當前區塊存在 */
function ensureCurrentBlock() {
    if (!currentBlock) {
        currentBlock = createNewBlock('ensure-current-block');
        logEl.appendChild(currentBlock);
    }
    return currentBlock;
}

/* 清理日誌內容 */
function clearLogs() {
    logEl.innerHTML = '';
    lineCounter = 0;
    blockCounter = 0;
    currentBlock = null;
    if (enableSpecialBlockBeautify) {
        specialBlockStack = [];
    }
    /* 清理原始數據 */
    if (typeof rawLogData !== 'undefined') {
        rawLogData = [];
    }
}

/* 點擊選擇功能 */
function setupLineSelection() {
    logEl.addEventListener('click', (e) => {
        const line = e.target.closest('.line');
        if (line) {
            /* 移除其他行的選中狀態 */
            document.querySelectorAll('.line.selected').forEach(el => {
                el.classList.remove('selected');
            });

            /* 添加選中狀態 */
            line.classList.add('selected');
        }
    });
}
