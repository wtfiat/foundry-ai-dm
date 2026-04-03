import { MODULE_ID } from "../constants.ts";
import { type IndexedSourceRecord, type RetrievalIndexMeta } from "./types.ts";

const DATABASE_NAME = `${MODULE_ID}-retrieval`;
const DATABASE_VERSION = 1;
const SOURCE_STORE = "sources";
const META_STORE = "meta";

interface StoredSourceRecord extends IndexedSourceRecord {
  key: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error(`Unable to open IndexedDB database ${DATABASE_NAME}.`));
    };

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SOURCE_STORE)) {
        database.createObjectStore(SOURCE_STORE, { keyPath: "key" });
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    };

    transaction.oncomplete = () => {
      resolve();
    };
  });
}

function sourceKey(worldId: string, sourceId: string): string {
  return `${worldId}::${sourceId}`;
}

function metaKey(worldId: string): string {
  return worldId;
}

export async function getStoredSources(worldId: string): Promise<IndexedSourceRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SOURCE_STORE, "readonly");
    const store = transaction.objectStore(SOURCE_STORE);
    const allRecords = (await requestToPromise(store.getAll())) as StoredSourceRecord[];
    await transactionToPromise(transaction);

    return allRecords
      .filter((record) => record.worldId === worldId)
      .map(({ key: _key, ...record }) => record);
  } finally {
    database.close();
  }
}

export async function getStoredMeta(worldId: string): Promise<RetrievalIndexMeta | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, "readonly");
    const store = transaction.objectStore(META_STORE);
    const result = (await requestToPromise(store.get(metaKey(worldId)))) as RetrievalIndexMeta | undefined;
    await transactionToPromise(transaction);
    return result ?? null;
  } finally {
    database.close();
  }
}

export async function saveIndexState(input: {
  worldId: string;
  records: IndexedSourceRecord[];
  deletedSourceIds: string[];
  meta: RetrievalIndexMeta;
}): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SOURCE_STORE, META_STORE], "readwrite");
    const sourceStore = transaction.objectStore(SOURCE_STORE);
    const metaStore = transaction.objectStore(META_STORE);

    for (const sourceId of input.deletedSourceIds) {
      sourceStore.delete(sourceKey(input.worldId, sourceId));
    }

    for (const record of input.records) {
      const storedRecord: StoredSourceRecord = {
        key: sourceKey(input.worldId, record.sourceId),
        ...record,
      };
      sourceStore.put(storedRecord);
    }

    metaStore.put(input.meta);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
