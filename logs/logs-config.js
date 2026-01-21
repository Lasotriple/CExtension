/* 配置常數 */
const LOG_BASE_PATH = "/SRM/SmartRobot/tomcat10/logs";
const INTERVAL_MS = 1000;
const MAX_ERRORS = 5;

/* 內部狀態 */
let running = false;
let timeoutId = null;
let lastSize = 0;
/* domain 和 tenantName 由 cext.context.js 統一管理 */
let isVisible = true;   // 視窗可見性狀態
let errorCount = 0;      // 錯誤計數
let isAtBottom = true;   // 是否在底部
let userScrolled = false;  // 使用者是否手動滾動
let cleanLogRules = null;   // 日誌清理規則
let lineCounter = 0;      // 行計數器，用於生成 ID
let currentBlock = null;   // 當前區塊容器
let blockCounter = 0;      // 區塊計數器
let currentLogPath = null;   // 當前使用的日誌文件路徑

/* UI 元素 */
const metaEl = document.getElementById('meta');
const logEl = document.getElementById('log');
const controlBtn = document.getElementById('control-btn');