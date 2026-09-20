/**
 * Studies the user opened before, and a way back into them in one click.
 *
 * A folder handle from the File System Access API survives a reload — the
 * browser keeps it, and asks the user once to confirm access again. That is
 * the difference between «найдите ту папку заново» and «открыть». Nothing is
 * copied: the handle is a permission to read the same folder, and the images
 * are read from disk exactly as they were the first time.
 *
 * The API is Chromium-only. Where it is missing the list still works as a
 * record of what was opened — it just cannot reopen without a folder picker.
 */

const DB_NAME = 'cbct-recent';
const DB_VERSION = 1;
const STORE = 'folders';
const MAX_ENTRIES = 12;

export interface RecentStudy {
  /** Key: the folder's name plus when it was first seen. */
  id: string;
  folderName: string;
  patientName: string;
  description: string;
  sliceCount: number;
  openedAt: number;
  /** Present only where the browser supports directory handles. */
  handle?: FileSystemDirectoryHandle;
}

export function canReopenFolders(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = action(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export async function listRecent(): Promise<RecentStudy[]> {
  const all = await run<RecentStudy[]>('readonly', (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.openedAt - a.openedAt);
}

export async function rememberStudy(entry: Omit<RecentStudy, 'openedAt'>): Promise<void> {
  await run('readwrite', (store) => store.put({ ...entry, openedAt: Date.now() }));

  // Keep the list short enough to read at a glance.
  const all = await listRecent();
  for (const stale of all.slice(MAX_ENTRIES)) {
    await run('readwrite', (store) => store.delete(stale.id));
  }
}

export async function forgetStudy(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

/**
 * Asks for the folder again and returns its files.
 *
 * The browser may or may not still hold permission; `requestPermission` is
 * what turns a remembered handle back into readable files, and it must be
 * called from a user gesture.
 */
export async function filesFromHandle(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const permission = await (handle as any).queryPermission?.({ mode: 'read' });
  if (permission !== 'granted') {
    const granted = await (handle as any).requestPermission?.({ mode: 'read' });
    if (granted !== 'granted') {
      throw new Error('Доступ к папке не подтверждён');
    }
  }

  const files: File[] = [];
  await walk(handle, files, 0);
  return files;
}

/** Depth-limited: a scanner export nests a couple of levels, never dozens. */
async function walk(handle: FileSystemDirectoryHandle, into: File[], depth: number): Promise<void> {
  if (depth > 4) return;
  for await (const entry of (handle as any).values()) {
    if (entry.kind === 'file') {
      try {
        into.push(await entry.getFile());
      } catch {
        // A file that vanished between listing and reading.
      }
    } else if (entry.kind === 'directory') {
      await walk(entry, into, depth + 1);
    }
  }
}

/** Opens the picker and returns both the handle and the files inside it. */
export async function pickFolder(): Promise<{ handle: FileSystemDirectoryHandle; files: File[] }> {
  const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: 'read',
    id: 'cbct-studies',
  });
  return { handle, files: await filesFromHandle(handle) };
}

/** «вчера», «3 сентября» — enough to recognise the study. */
export function whenOpened(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'вчера';

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
