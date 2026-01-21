/* 存儲原始日誌數據 */
let rawLogData = [];

/* 美化開關控制 */
function setupBeautifyToggle() {
    const button = document.getElementById('beautify-toggle');
    if (!button) return;

    /* 初始化按鈕狀態 */
    updateBeautifyButton();

    /* 監聽按鈕點擊 */
    button.addEventListener('click', () => {
        /* 添加載入動畫 */
        addLoadingAnimation(button);

        /* 切換狀態 */
        enableSpecialBlockBeautify = !enableSpecialBlockBeautify;

        /* 更新按鈕外觀 */
        updateBeautifyButton();

        /* 切換現有 DOM 的顯示方式 */
        setTimeout(() => {
            toggleSpecialBlocksDisplay();
            /* 移除載入動畫 */
            removeLoadingAnimation(button);
        }, 100);
    });
}

/* 更新美化按鈕的外觀 */
function updateBeautifyButton() {
    const button = document.getElementById('beautify-toggle');
    if (!button) return;

    if (enableSpecialBlockBeautify) {
        button.textContent = '視覺模式';
        button.style.background = '#3b82f6';
        button.title = '目前為視覺模式，點擊切換為文字模式';
        document.body.classList.add('visual-mode');
    } else {
        button.textContent = '文字模式';
        button.style.background = '#6b7280';
        button.title = '目前為文字模式，點擊切換為視覺模式';
        document.body.classList.remove('visual-mode');
    }
}

/* 添加載入動畫 */
function addLoadingAnimation(button) {
    /* 設置按鈕為相對定位 */
    button.style.position = 'relative';
    button.style.overflow = 'hidden';

    /* 創建旋轉邊框元素 */
    const spinner = document.createElement('div');
    spinner.id = 'beautify-spinner';
    spinner.style.cssText = `
        position: absolute;
        top: -2px;
        left: -2px;
        right: -2px;
        bottom: -2px;
        border: 2px solid transparent;
        border-top: 2px solid #fbbf24;
        border-right: 2px solid #fbbf24;
        border-radius: 6px;
        animation: spin 1s linear infinite;
        pointer-events: none;
        z-index: 1;
    `;

    button.appendChild(spinner);

    /* 添加 CSS 動畫 */
    if (!document.getElementById('beautify-spin-style')) {
        const style = document.createElement('style');
        style.id = 'beautify-spin-style';
        style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
}

/* 移除載入動畫 */
function removeLoadingAnimation(button) {
    const spinner = document.getElementById('beautify-spinner');
    if (spinner) {
        spinner.remove();
    }
    button.style.position = '';
    button.style.overflow = '';
}

/* 切換特殊區塊的顯示方式 */
function toggleSpecialBlocksDisplay() {
    /* 重新渲染所有日誌以確保正確的顯示狀態 */
    rerenderAllLogs();
}

/* 重新渲染所有日誌 */
function rerenderAllLogs() {
    if (rawLogData.length === 0) {
        return;
    }

    /* 保存原始數據 */
    const savedRawLogData = [...rawLogData];

    /* 清空當前顯示（但不清空原始數據） */
    logEl.innerHTML = '';
    lineCounter = 0;
    blockCounter = 0;
    currentBlock = null;
    if (enableSpecialBlockBeautify) {
        specialBlockStack = [];
    }

    /* 恢復原始數據 */
    rawLogData = savedRawLogData;

    /* 重新處理所有原始數據 */
    rawLogData.forEach((logText, index) => {
        append(logText);
    });

    /* 根據模式處理空行顯示 */
    if (enableSpecialBlockBeautify) {
        hideEmptyLines();
    } else {
        showAllLines();
    }
}

/* 隱藏空行 */
function hideEmptyLines() {
    const allLines = document.querySelectorAll('.line');
    allLines.forEach(line => {
        const contentArea = line.querySelector('.line-content');
        if (contentArea) {
            const text = contentArea.textContent.trim();
            if (text === '') {
                line.style.display = 'none';
            } else {
                line.style.display = 'block';
            }
        }
    });
}

/* 顯示所有行（用於文字模式） */
function showAllLines() {
    const allLines = document.querySelectorAll('.line');
    allLines.forEach(line => {
        line.style.display = 'block';
    });
}

/* 修改 append 函數來保存原始數據 */
function appendWithStorage(text) {
    if (!text) return;

    /* 保存原始數據 */
    rawLogData.push(text);

    /* 處理並顯示 */
    append(text);

    /* 在視覺模式下，每次添加新內容後都檢查並隱藏空行 */
    if (enableSpecialBlockBeautify) {
        /* 使用 setTimeout 確保 DOM 已更新 */
        setTimeout(() => {
            hideEmptyLines();
        }, 0);
    }
}

/* 主程式入口 */
(() => {
    /* 初始化 */
    setMeta("等待 API URL 初始化...");

    /* 載入日誌清理規則 */
    loadCleanLogRules();

    /* 設置行選擇功能 */
    setupLineSelection();

    /* 設置美化開關 */
    setupBeautifyToggle();

    /* 設置事件監聽器 */
    setupEventListeners();

    /* 初始化時設置正確的 body class */
    if (enableSpecialBlockBeautify) {
        document.body.classList.add('visual-mode');
    } else {
        document.body.classList.remove('visual-mode');
    }
})();
