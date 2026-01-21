/* 內部狀態 */
/* domain 和 tenantName 由 cext.context.js 統一管理 */
let parentUrl = null;       // 從父視窗接收的 URL
let channelList = [];       // 渠道列表
let hideFeedbackTimeoutId = null;  // 儲存 hideFeedback 的 setTimeout ID

/* UI 元素 */
const contentEl = document.getElementById('batch-main-content');
const channelSelectEl = document.getElementById('batch-select-channel');
const concurrencyInputEl = document.getElementById('batch-input-concurrency');
const retryCountInputEl = document.getElementById('batch-input-retry-count');
const retryAnswerByInputEl = document.getElementById('batch-input-retry-answerby');
const aoaiRetryCountInputEl = document.getElementById('batch-input-aoai-retry-count');
const aoaiRetryFormItemEl = document.getElementById('batch-form-item-aoai-retry');
const contentTextareaEl = document.getElementById('batch-textarea-content');
const submitBtn = document.getElementById('batch-btn-submit');
const feedbackAreaEl = document.getElementById('batch-feedback-area');
const feedbackTextEl = document.getElementById('batch-feedback-text');
const feedbackDetailsEl = document.getElementById('batch-feedback-details');
const progressBarEl = document.getElementById('batch-progress-bar');
const formFeedbackWrapperEl = document.querySelector('.batch-form-feedback-wrapper');
const instantListEl = document.getElementById('batch-instant-list');
const instantEmptyEl = document.getElementById('batch-instant-empty-state');
const historyListEl = document.getElementById('batch-history-list');
const historyEmptyEl = document.getElementById('batch-history-empty-state');
const contentLayoutEl = document.querySelector('.batch-main-layout');
const compareIndexBtn = document.getElementById('batch-btn-compare-index');
const compareAnswerBtn = document.getElementById('batch-btn-compare-answer');
const tableContainer = document.getElementById('batch-table-container');
const contentTable = document.getElementById('batch-content-table');
const tableHeader = document.getElementById('batch-table-header');
const tableBody = document.getElementById('batch-table-body');