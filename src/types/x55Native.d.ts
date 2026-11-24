export interface NativeBookEntry {
  id: string;
  title: string;
  author: string;
  format: 'pdf' | 'epub';
  folderId: string;
  folderName: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mtimeMs: number;
}

export interface NativeScanResult {
  booksRoot: string;
  folders: Array<{ id: string; name: string }>;
  books: NativeBookEntry[];
}

export interface NativePersistedState {
  booksMeta?: Record<
    string,
    {
      title?: string;
      author?: string;
      folderId?: string;
      coverDataUrl?: string;
      customCoverDataUrl?: string;
      pageCount?: number;
      lastOpenedAt?: number;
      lastLocation?: {
        pageIndex: number;
        totalPages: number;
        chapterIndex: number;
        scrollRatio: number;
        percent: number;
        updatedAt: number;
      };
    }
  >;
  settings?: Record<string, unknown>;
}

export interface NativeBatteryInfo {
  level: number | null;
  charging: boolean;
}

export interface X55NativeBridge {
  isHandheld: boolean;
  platform: string;
  scanLibrary: () => Promise<NativeScanResult>;
  readBookBuffer: (filePath: string) => Promise<ArrayBuffer | null>;
  loadState: () => Promise<NativePersistedState>;
  saveState: (state: NativePersistedState) => Promise<void>;
  getBattery: () => Promise<NativeBatteryInfo>;
  quitApp: () => Promise<void>;
}

declare global {
  interface Window {
    x55Native?: X55NativeBridge;
  }
}

export {};
