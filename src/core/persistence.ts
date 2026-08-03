/**
 * IndexedDBを使ったローカル永続化。
 * - 譜面JSON（自動保存、クラッシュ復旧用）
 * - 音声ファイルのバイナリ（毎回ファイル選択させないため）
 */
import { Chart } from './chart';

const DB_NAME = 'mukumukuworld';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_AUDIO = 'audio';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SavedProject {
  id: string;
  chart: Chart;
  updatedAt: number;
}

export async function saveProject(id: string, chart: Chart): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put({ id, chart, updatedAt: Date.now() } as SavedProject);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProject(id: string): Promise<SavedProject | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<SavedProject[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAudio(id: string, data: ArrayBuffer, fileName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readwrite');
    tx.objectStore(STORE_AUDIO).put({ id, data, fileName });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAudio(id: string): Promise<{ data: ArrayBuffer; fileName: string } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
