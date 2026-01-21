(function (global) {
    const DB_NAME = 'batchTestResults';
    const DB_VERSION = 2;
    const STORE_BATCHES = 'batches';
    const STORE_ENTRIES = 'entries';
    const STORE_LOGS = 'logs';
    const STORE_ID_TO_QUESTION_MAP = 'idToQuestionMap';
    const INDEX_BY_BATCH = 'byBatch';
    const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    const supportsIndexedDB = !!(global.indexedDB);
    let dbPromise = null;
    let initPromise = null;

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = global.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion || 0;

                if (!db.objectStoreNames.contains(STORE_BATCHES)) {
                    db.createObjectStore(STORE_BATCHES, { keyPath: 'batchId' });
                }
                if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
                    const entriesStore = db.createObjectStore(STORE_ENTRIES, { keyPath: 'entryKey' });
                    entriesStore.createIndex(INDEX_BY_BATCH, 'batchId', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_LOGS)) {
                    const logsStore = db.createObjectStore(STORE_LOGS, { keyPath: 'logKey' });
                    logsStore.createIndex(INDEX_BY_BATCH, 'batchId', { unique: false });
                }
                // 添加 idToQuestionMap store（版本 2）
                if (oldVersion < 2 && !db.objectStoreNames.contains(STORE_ID_TO_QUESTION_MAP)) {
                    db.createObjectStore(STORE_ID_TO_QUESTION_MAP, { keyPath: 'batchId' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function getDatabase() {
        if (!supportsIndexedDB) {
            throw new Error('IndexedDB not supported');
        }
        if (!dbPromise) {
            dbPromise = openDatabase();
        }
        return dbPromise;
    }

    function normalizeMeta(existingMeta, incomingMeta) {
        const now = new Date().toISOString();
        const meta = Object.assign({}, existingMeta || {});
        if (!meta.createdAt) {
            meta.createdAt = incomingMeta?.createdAt || now;
        }
        meta.batchId = incomingMeta?.batchId || meta.batchId;
        meta.tenantName = incomingMeta?.tenantName ?? meta.tenantName ?? '';
        meta.domain = incomingMeta?.domain ?? meta.domain ?? '';
        meta.totalQuestions = incomingMeta?.totalQuestions ?? meta.totalQuestions ?? 0;
        meta.completedCount = incomingMeta?.completedCount ?? meta.completedCount ?? 0;
        // 保護已完成或已完成的狀態：如果現有狀態是 completed 或 finished，且新狀態未明確提供，則保留原狀態
        const existingStatus = meta.status;
        const incomingStatus = incomingMeta?.status;
        const isCompletedStatus = existingStatus === 'completed' || existingStatus === 'finished';
        if (isCompletedStatus && (incomingStatus === undefined || incomingStatus === null || incomingStatus === '')) {
            meta.status = existingStatus;
        } else {
            meta.status = incomingStatus ?? existingStatus ?? 'in_progress';
        }
        meta.unresolvedCount = incomingMeta?.unresolvedCount ?? meta.unresolvedCount ?? 0;
        meta.downloaded = incomingMeta?.downloaded ?? meta.downloaded ?? false;
        meta.lastError = incomingMeta?.lastError ?? null;
        meta.partial = incomingMeta?.partial ?? meta.partial ?? false;
        meta.firstSentAt = incomingMeta?.firstSentAt ?? meta.firstSentAt ?? null;
        meta.lastResponseAt = incomingMeta?.lastResponseAt ?? meta.lastResponseAt ?? null;
        meta.lastValidReceivedAt = incomingMeta?.lastValidReceivedAt ?? meta.lastValidReceivedAt ?? null;
        const incomingDuration = incomingMeta?.durationMs;
        if (Number.isFinite(incomingDuration)) {
            meta.durationMs = incomingDuration;
        } else if (!Number.isFinite(meta.durationMs)) {
            meta.durationMs = null;
        }
        meta.updatedAt = now;
        return meta;
    }

    function transact(db, storeNames, mode, executor) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeNames, mode);
            let resolved = false;
            const stores = {};
            if (Array.isArray(storeNames)) {
                storeNames.forEach(name => {
                    stores[name] = tx.objectStore(name);
                });
            } else {
                stores[storeNames] = tx.objectStore(storeNames);
            }

            try {
                executor(stores, tx);
            } catch (error) {
                reject(error);
                return;
            }

            tx.oncomplete = () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            };
            tx.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    reject(tx.error);
                }
            };
            tx.onabort = () => {
                if (!resolved) {
                    resolved = true;
                    reject(tx.error || new Error('Transaction aborted'));
                }
            };
        });
    }

    function clearStoreByBatch(db, storeName, batchId) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const index = store.index(INDEX_BY_BATCH);
            const request = index.openKeyCursor(IDBKeyRange.only(batchId));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        });
    }

    async function getBatchMeta(db, batchId) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const store = tx.objectStore(STORE_BATCHES);
            const request = store.get(batchId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function putBatchMeta(db, meta) {
        return transact(db, STORE_BATCHES, 'readwrite', (stores) => {
            stores[STORE_BATCHES].put(meta);
        });
    }

    async function putEntries(db, batchId, entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return;
        }
        await transact(db, STORE_ENTRIES, 'readwrite', (stores) => {
            const store = stores[STORE_ENTRIES];
            entries.forEach((entry, idx) => {
                const entryId = entry?.id ?? entry?.index ?? (idx + 1);
                const entryKey = `${batchId}::${entryId}`;
                store.put({
                    entryKey,
                    batchId,
                    index: entryId,
                    order: idx, // 保存原始順序
                    data: entry
                });
            });
        });
    }

    async function putLogs(db, batchId, logs) {
        if (!Array.isArray(logs) || logs.length === 0) {
            return;
        }
        await transact(db, STORE_LOGS, 'readwrite', (stores) => {
            const store = stores[STORE_LOGS];
            logs.forEach((logEntry, idx) => {
                const fileName = logEntry?.fileName || `batch_${idx + 1}.txt`;
                const logKey = `${batchId}::${fileName}`;
                store.put({
                    logKey,
                    batchId,
                    fileName,
                    content: logEntry?.content || '',
                    rangeStart: logEntry?.rangeStart || null,
                    rangeEnd: logEntry?.rangeEnd || null,
                    attemptLabel: logEntry?.attemptLabel || null
                });
            });
        });
    }

    async function pruneBatches({ maxAgeMs = HISTORY_MAX_AGE_MS } = {}) {
        const now = Date.now();
        const batches = await listBatches({ includeDownloaded: true });
        const removeIds = [];

        batches.forEach((batch) => {
            const updatedAt = new Date(batch.updatedAt || batch.createdAt || 0).getTime();
            if (!Number.isFinite(updatedAt) || (now - updatedAt) > maxAgeMs) {
                removeIds.push(batch.batchId);
            }
        });

        if (removeIds.length === 0) {
            return false;
        }

        const db = await getDatabase();
        for (const batchId of removeIds) {
            await clearStoreByBatch(db, STORE_ENTRIES, batchId);
            await clearStoreByBatch(db, STORE_LOGS, batchId);
            await transact(db, STORE_ID_TO_QUESTION_MAP, 'readwrite', (stores) => {
                stores[STORE_ID_TO_QUESTION_MAP].delete(batchId);
            });
            await transact(db, STORE_BATCHES, 'readwrite', (stores) => {
                stores[STORE_BATCHES].delete(batchId);
            });
        }
        return true;
    }

    async function saveBatchSnapshot(batchId, { meta = {}, entries, logs } = {}) {
        if (!supportsIndexedDB || !batchId) {
            return false;
        }
        const db = await getDatabase();
        const existingMeta = await getBatchMeta(db, batchId);
        const normalizedMeta = normalizeMeta(existingMeta, Object.assign({}, meta, { batchId }));

        await putBatchMeta(db, normalizedMeta);

        if (entries !== undefined) {
            await clearStoreByBatch(db, STORE_ENTRIES, batchId);
            if (Array.isArray(entries) && entries.length > 0) {
                await putEntries(db, batchId, entries);
            }
        }

        if (logs !== undefined) {
            await clearStoreByBatch(db, STORE_LOGS, batchId);
            if (Array.isArray(logs) && logs.length > 0) {
                await putLogs(db, batchId, logs);
            }
        }

        await pruneBatches();
        return true;
    }

    async function listBatches({ includeDownloaded = false } = {}) {
        if (!supportsIndexedDB) {
            return [];
        }
        const db = await getDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_BATCHES, 'readonly');
            const store = tx.objectStore(STORE_BATCHES);
            const request = store.getAll();
            request.onsuccess = () => {
                const result = request.result || [];
                const filtered = includeDownloaded
                    ? result
                    : result.filter(item => !item.downloaded);
                filtered.sort((a, b) => {
                    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
                    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
                    return bTime - aTime;
                });
                resolve(filtered);
            };
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getBatchSnapshot(batchId) {
        if (!supportsIndexedDB || !batchId) {
            return null;
        }
        const db = await getDatabase();
        const meta = await getBatchMeta(db, batchId);
        if (!meta) {
            return null;
        }

        const entries = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_ENTRIES, 'readonly');
            const store = tx.objectStore(STORE_ENTRIES);
            const index = store.index(INDEX_BY_BATCH);
            const request = index.getAll(IDBKeyRange.only(batchId));
            request.onsuccess = () => {
                const rows = request.result || [];
                // 按照保存時的原始順序排序，如果沒有 order 則按 index 排序（向後兼容）
                rows.sort((a, b) => {
                    const aOrder = a.order !== undefined ? a.order : (a.index ?? 0);
                    const bOrder = b.order !== undefined ? b.order : (b.index ?? 0);
                    return aOrder - bOrder;
                });
                resolve(rows.map(item => item.data));
            };
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });

        const logs = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_LOGS, 'readonly');
            const store = tx.objectStore(STORE_LOGS);
            const index = store.index(INDEX_BY_BATCH);
            const request = index.getAll(IDBKeyRange.only(batchId));
            request.onsuccess = () => {
                const rows = request.result || [];
                resolve(rows.map(item => ({
                    fileName: item.fileName,
                    content: item.content,
                    rangeStart: item.rangeStart,
                    rangeEnd: item.rangeEnd,
                    attemptLabel: item.attemptLabel
                })));
            };
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });

        return {
            meta,
            entries,
            logs
        };
    }

    async function removeBatch(batchId) {
        if (!supportsIndexedDB || !batchId) {
            return false;
        }
        const db = await getDatabase();
        await clearStoreByBatch(db, STORE_ENTRIES, batchId);
        await clearStoreByBatch(db, STORE_LOGS, batchId);
        await transact(db, STORE_ID_TO_QUESTION_MAP, 'readwrite', (stores) => {
            stores[STORE_ID_TO_QUESTION_MAP].delete(batchId);
        });
        await transact(db, STORE_BATCHES, 'readwrite', (stores) => {
            stores[STORE_BATCHES].delete(batchId);
        });
        return true;
    }

    async function markBatchStatus(batchId, updates = {}) {
        if (!supportsIndexedDB || !batchId) return false;
        const db = await getDatabase();
        const existing = await getBatchMeta(db, batchId);
        if (!existing) return false;
        const mergedMeta = normalizeMeta(existing, Object.assign({}, existing, updates, { batchId }));
        await putBatchMeta(db, mergedMeta);
        return true;
    }

    async function markBatchDownloaded(batchId) {
        return markBatchStatus(batchId, { downloaded: true });
    }

    async function listHistory({ maxAgeMs = HISTORY_MAX_AGE_MS } = {}) {
        const now = Date.now();
        const batches = await listBatches({ includeDownloaded: true });
        const filtered = batches.filter(batch => {
            if (!batch) return false;
            const updatedAt = new Date(batch.updatedAt || batch.createdAt || 0).getTime();
            if (!Number.isFinite(updatedAt) || (now - updatedAt) > maxAgeMs) return false;
            // 歷史紀錄應該包含所有非 in_progress 的批次（completed, finished, error, stopped 等）
            // 不應該用 completedCount 來判斷，因為即使 completedCount 為 0，只要 status 不是 in_progress，就應該顯示
            if (batch.status === 'in_progress') return false;
            return true;
        });
        filtered.sort((a, b) => {
            const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return bTime - aTime;
        });
        return filtered;
    }

    async function clearAll() {
        if (!supportsIndexedDB) return false;
        const db = await getDatabase();
        await transact(db, [STORE_ENTRIES, STORE_LOGS, STORE_BATCHES, STORE_ID_TO_QUESTION_MAP], 'readwrite', (stores) => {
            stores[STORE_ENTRIES].clear();
            stores[STORE_LOGS].clear();
            stores[STORE_BATCHES].clear();
            stores[STORE_ID_TO_QUESTION_MAP].clear();
        });
        return true;
    }

    function isSupported() {
        return supportsIndexedDB;
    }

    function init() {
        if (!supportsIndexedDB) {
            console.warn('[CEXTBatchStorage] IndexedDB is not supported in this environment.');
            return Promise.resolve(false);
        }
        if (!initPromise) {
            initPromise = getDatabase()
                .then(() => true)
                .catch((error) => {
                    console.warn('[CEXTBatchStorage] 初始化失敗:', error);
                    return false;
                });
        }
        return initPromise;
    }

    async function saveIdToQuestionMap(batchId, idToQuestionMap, tenantName = null, domain = null) {
        if (!supportsIndexedDB || !batchId) {
            return false;
        }
        const db = await getDatabase();
        return transact(db, STORE_ID_TO_QUESTION_MAP, 'readwrite', (stores) => {
            // 存儲到 batchId（向後兼容）
            stores[STORE_ID_TO_QUESTION_MAP].put({
                batchId,
                idToQuestionMap,
                updatedAt: new Date().toISOString()
            });
            // 同時存儲到全局 key（使用 tenantName + domain，如果都有的話）
            if (tenantName && domain) {
                const globalKey = `global_${tenantName}_${domain}`;
                stores[STORE_ID_TO_QUESTION_MAP].put({
                    batchId: globalKey,
                    idToQuestionMap,
                    updatedAt: new Date().toISOString()
                });
            } else if (tenantName) {
                // 如果只有 tenantName，也存一份（向後兼容）
                const globalKey = `global_${tenantName}`;
                stores[STORE_ID_TO_QUESTION_MAP].put({
                    batchId: globalKey,
                    idToQuestionMap,
                    updatedAt: new Date().toISOString()
                });
            }
        });
    }

    async function getIdToQuestionMap(batchId, tenantName = null, domain = null) {
        if (!supportsIndexedDB) {
            return null;
        }
        const db = await getDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_ID_TO_QUESTION_MAP, 'readonly');
            const store = tx.objectStore(STORE_ID_TO_QUESTION_MAP);

            // 先嘗試用 batchId 讀取
            if (batchId) {
                const request = store.get(batchId);
                request.onsuccess = () => {
                    const result = request.result;
                    if (result && result.idToQuestionMap) {
                        resolve(result.idToQuestionMap);
                        return;
                    }
                    // 如果 batchId 沒有，且提供了 tenantName 和 domain，嘗試讀取全局映射表
                    if (tenantName && domain) {
                        const globalKey = `global_${tenantName}_${domain}`;
                        const globalRequest = store.get(globalKey);
                        globalRequest.onsuccess = () => {
                            const globalResult = globalRequest.result;
                            if (globalResult && globalResult.idToQuestionMap) {
                                resolve(globalResult.idToQuestionMap);
                                return;
                            }
                            // 如果 tenantName + domain 沒有，嘗試只用 tenantName（向後兼容）
                            if (tenantName) {
                                const fallbackKey = `global_${tenantName}`;
                                const fallbackRequest = store.get(fallbackKey);
                                fallbackRequest.onsuccess = () => {
                                    const fallbackResult = fallbackRequest.result;
                                    resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                                };
                                fallbackRequest.onerror = () => resolve(null);
                            } else {
                                resolve(null);
                            }
                        };
                        globalRequest.onerror = () => {
                            // 如果 tenantName + domain 讀取失敗，嘗試只用 tenantName（向後兼容）
                            if (tenantName) {
                                const fallbackKey = `global_${tenantName}`;
                                const fallbackRequest = store.get(fallbackKey);
                                fallbackRequest.onsuccess = () => {
                                    const fallbackResult = fallbackRequest.result;
                                    resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                                };
                                fallbackRequest.onerror = () => resolve(null);
                            } else {
                                resolve(null);
                            }
                        };
                    } else if (tenantName) {
                        // 如果只有 tenantName，嘗試讀取舊格式的全局映射表（向後兼容）
                        const globalKey = `global_${tenantName}`;
                        const globalRequest = store.get(globalKey);
                        globalRequest.onsuccess = () => {
                            const globalResult = globalRequest.result;
                            resolve(globalResult ? globalResult.idToQuestionMap : null);
                        };
                        globalRequest.onerror = () => resolve(null);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => {
                    // 如果 batchId 讀取失敗，嘗試全局映射表
                    if (tenantName && domain) {
                        const globalKey = `global_${tenantName}_${domain}`;
                        const globalRequest = store.get(globalKey);
                        globalRequest.onsuccess = () => {
                            const globalResult = globalRequest.result;
                            if (globalResult && globalResult.idToQuestionMap) {
                                resolve(globalResult.idToQuestionMap);
                                return;
                            }
                            // 如果 tenantName + domain 沒有，嘗試只用 tenantName（向後兼容）
                            if (tenantName) {
                                const fallbackKey = `global_${tenantName}`;
                                const fallbackRequest = store.get(fallbackKey);
                                fallbackRequest.onsuccess = () => {
                                    const fallbackResult = fallbackRequest.result;
                                    resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                                };
                                fallbackRequest.onerror = () => resolve(null);
                            } else {
                                resolve(null);
                            }
                        };
                        globalRequest.onerror = () => {
                            if (tenantName) {
                                const fallbackKey = `global_${tenantName}`;
                                const fallbackRequest = store.get(fallbackKey);
                                fallbackRequest.onsuccess = () => {
                                    const fallbackResult = fallbackRequest.result;
                                    resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                                };
                                fallbackRequest.onerror = () => resolve(null);
                            } else {
                                resolve(null);
                            }
                        };
                    } else if (tenantName) {
                        const globalKey = `global_${tenantName}`;
                        const globalRequest = store.get(globalKey);
                        globalRequest.onsuccess = () => {
                            const globalResult = globalRequest.result;
                            resolve(globalResult ? globalResult.idToQuestionMap : null);
                        };
                        globalRequest.onerror = () => resolve(null);
                    } else {
                        resolve(null);
                    }
                };
            } else if (tenantName && domain) {
                // 如果沒有 batchId，但有 tenantName 和 domain，直接讀取全局映射表
                const globalKey = `global_${tenantName}_${domain}`;
                const globalRequest = store.get(globalKey);
                globalRequest.onsuccess = () => {
                    const globalResult = globalRequest.result;
                    if (globalResult && globalResult.idToQuestionMap) {
                        resolve(globalResult.idToQuestionMap);
                        return;
                    }
                    // 如果 tenantName + domain 沒有，嘗試只用 tenantName（向後兼容）
                    if (tenantName) {
                        const fallbackKey = `global_${tenantName}`;
                        const fallbackRequest = store.get(fallbackKey);
                        fallbackRequest.onsuccess = () => {
                            const fallbackResult = fallbackRequest.result;
                            resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                        };
                        fallbackRequest.onerror = () => resolve(null);
                    } else {
                        resolve(null);
                    }
                };
                globalRequest.onerror = () => {
                    if (tenantName) {
                        const fallbackKey = `global_${tenantName}`;
                        const fallbackRequest = store.get(fallbackKey);
                        fallbackRequest.onsuccess = () => {
                            const fallbackResult = fallbackRequest.result;
                            resolve(fallbackResult ? fallbackResult.idToQuestionMap : null);
                        };
                        fallbackRequest.onerror = () => resolve(null);
                    } else {
                        resolve(null);
                    }
                };
            } else if (tenantName) {
                // 如果只有 tenantName，嘗試讀取舊格式的全局映射表（向後兼容）
                const globalKey = `global_${tenantName}`;
                const globalRequest = store.get(globalKey);
                globalRequest.onsuccess = () => {
                    const globalResult = globalRequest.result;
                    resolve(globalResult ? globalResult.idToQuestionMap : null);
                };
                globalRequest.onerror = () => resolve(null);
            } else {
                resolve(null);
            }
            tx.onerror = () => reject(tx.error);
        });
    }

    async function listIdToQuestionMaps() {
        if (!supportsIndexedDB) {
            return [];
        }
        const db = await getDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_ID_TO_QUESTION_MAP, 'readonly');
            const store = tx.objectStore(STORE_ID_TO_QUESTION_MAP);
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                const maps = results.map(item => ({
                    key: item.batchId,
                    updatedAt: item.updatedAt,
                    mapSize: item.idToQuestionMap ? Object.keys(item.idToQuestionMap).length : 0,
                    isGlobal: item.batchId && item.batchId.startsWith('global_')
                }));
                resolve(maps);
            };
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
        });
    }

    const api = {
        init,
        isSupported,
        saveBatchSnapshot,
        listBatches,
        listHistory,
        getBatchSnapshot,
        removeBatch,
        markBatchStatus,
        markBatchDownloaded,
        pruneBatches,
        clearAll,
        saveIdToQuestionMap,
        getIdToQuestionMap,
        listIdToQuestionMaps
    };

    global.CEXTBatchStorage = api;
})(typeof self !== 'undefined' ? self : this);

