export type BookFormat = 'pdf' | 'epub';

export type PaperTheme =
  | 'ivory'
  | 'parchment'
  | 'washi'
  | 'night-amber'
  | 'oled-dark'
  | 'custom';

export type SmartZoomMode = 'fit-page' | 'fit-width' | 'auto-crop' | 'manual';

export type SpreadMode = 1 | 2;

export type ScreenOrientation = 0 | 90 | 180 | 270;

export type EpubFontFamily = 'serif' | 'sans' | 'mono';

export interface ReadingLocation {
  /** 1-based page number for PDF, or 0-based global page index for EPUB */
  pageIndex: number;
  /** Total pages (PDF total pages or current EPUB paginated total) */
  totalPages: number;
  /** Current chapter index for EPUB */
  chapterIndex: number;
  /** Scroll offset ratio (0..1) inside zoomed PDF or chapter */
  scrollRatio: number;
  /** 0..100 percentage */
  percent: number;
  updatedAt: number;
}

export interface BookItem {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  folderId: string;
  fileName: string;
  fileSize: number;
  coverDataUrl?: string;
  customCoverDataUrl?: string;
  pageCount?: number;
  addedAt: number;
  lastOpenedAt?: number;
  lastLocation: ReadingLocation;
  isSample?: boolean;
  nativePath?: string;
}

export interface FolderItem {
  id: string;
  name: string;
  createdAt: number;
}

export interface ReaderSettings {
  spreadMode: SpreadMode;
  orientation: ScreenOrientation;
  paperTheme: PaperTheme;
  customPaperDataUrl?: string;
  smartZoomMode: SmartZoomMode;
  manualZoom: number; // 1.0 to 2.5
  fontSize: number; // px for EPUB (14 to 26)
  lineHeight: number; // 1.35 to 2.0
  fontFamily: EpubFontFamily;
  blueLightFilter: number; // 0 to 45 (%)
  pageFlipAnimation: boolean;
  remapDpadOnRotate: boolean;
  x55FrameMode: boolean; // Preview exact 1280x720 X55 viewport vs full screen
  activeFolderId: string; // 'all' or specific folderId
  lastBookId?: string;
  autoResumeLastBook: boolean;
}

export type X55Button =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'L1'
  | 'R1'
  | 'L2'
  | 'R2'
  | 'SELECT'
  | 'START';

export const DEFAULT_SETTINGS: ReaderSettings = {
  spreadMode: 1,
  orientation: 0,
  paperTheme: 'ivory',
  smartZoomMode: 'auto-crop',
  manualZoom: 1.35,
  fontSize: 18,
  lineHeight: 1.65,
  fontFamily: 'serif',
  blueLightFilter: 8,
  pageFlipAnimation: true,
  remapDpadOnRotate: true,
  x55FrameMode: true,
  activeFolderId: 'all',
  autoResumeLastBook: false,
};
