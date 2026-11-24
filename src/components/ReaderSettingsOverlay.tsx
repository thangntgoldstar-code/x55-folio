import {
  BookOpen,
  Columns2,
  Eye,
  FileImage,
  Moon,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
  ZoomIn,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useX55Input } from '../hooks/useX55Input';
import type {
  BookFormat,
  EpubFontFamily,
  PaperTheme,
  ReaderSettings,
  ScreenOrientation,
  SmartZoomMode,
  X55Button,
} from '../types/reader';
import { ButtonHintBar, type ButtonHintItem } from './ButtonHintBar';

interface ReaderSettingsOverlayProps {
  bookFormat: BookFormat;
  bookTitle: string;
  currentPageDisplay: string;
  totalPages: number;
  currentPageNum: number;
  settings: ReaderSettings;
  chapters?: Array<{ title: string }>;
  currentChapterIndex?: number;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onJumpToPage?: (pageNum: number) => void;
  onJumpToChapter?: (chapterIdx: number) => void;
  onBackToShelf: () => void;
  onClose: () => void;
}

const PAPER_THEMES: Array<{ id: PaperTheme; label: string; swatch: string; dark?: boolean }> = [
  { id: 'ivory', label: 'Giấy Ngà', swatch: '#f7f2e7' },
  { id: 'parchment', label: 'Giấy Da Cổ', swatch: '#eadcc4' },
  { id: 'washi', label: 'Giấy Washi', swatch: '#efece3' },
  { id: 'night-amber', label: 'Đêm Dịu Mắt', swatch: '#1b1815', dark: true },
  { id: 'oled-dark', label: 'Đêm OLED', swatch: '#080809', dark: true },
];

const ZOOM_MODES: Array<{ id: SmartZoomMode; label: string; desc: string }> = [
  { id: 'auto-crop', label: 'Cắt lề thông minh', desc: 'Tự bỏ viền trắng, phóng to vùng chữ' },
  { id: 'fit-page', label: 'Vừa trọn trang', desc: 'Hiển thị đầy đủ cả trang trên màn hình' },
  { id: 'fit-width', label: 'Vừa chiều ngang', desc: 'Rộng hết màn hình, cuộn D-Pad lên/xuống' },
  { id: 'manual', label: 'Phóng to thủ công', desc: 'Tùy chỉnh 100%–250% & kéo bằng Analog' },
];

type SettingRowId =
  | 'spread'
  | 'orientation'
  | 'remap-dpad'
  | 'pdf-zoom-mode'
  | 'pdf-manual-zoom'
  | 'pdf-jump-page'
  | 'epub-font-size'
  | 'epub-font-family'
  | 'epub-jump-chapter'
  | 'paper-theme'
  | 'custom-paper'
  | 'blue-light'
  | 'page-flip'
  | 'back-to-shelf';

export function ReaderSettingsOverlay({
  bookFormat,
  bookTitle,
  currentPageDisplay,
  totalPages,
  currentPageNum,
  settings,
  chapters,
  currentChapterIndex = 0,
  onUpdateSettings,
  onJumpToPage,
  onJumpToChapter,
  onBackToShelf,
  onClose,
}: ReaderSettingsOverlayProps) {
  const customPaperInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const focusableRows = useMemo<SettingRowId[]>(() => {
    const rows: SettingRowId[] = ['spread', 'orientation', 'remap-dpad'];
    if (bookFormat === 'pdf') {
      rows.push('pdf-zoom-mode');
      if (settings.smartZoomMode === 'manual') rows.push('pdf-manual-zoom');
      if (onJumpToPage && totalPages > 1) rows.push('pdf-jump-page');
    } else {
      rows.push('epub-font-size', 'epub-font-family');
      if (chapters && chapters.length > 1 && onJumpToChapter) {
        rows.push('epub-jump-chapter');
      }
    }
    rows.push('paper-theme', 'custom-paper', 'blue-light', 'page-flip', 'back-to-shelf');
    return rows;
  }, [
    bookFormat,
    settings.smartZoomMode,
    totalPages,
    onJumpToPage,
    chapters,
    onJumpToChapter,
  ]);

  const [focusIdx, setFocusIdx] = useState(0);
  const clampedFocusIdx = Math.min(focusIdx, Math.max(0, focusableRows.length - 1));
  const focusedId = focusableRows[clampedFocusIdx];

  useEffect(() => {
    const el = rowRefs.current[focusedId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedId]);

  const handlePaperUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      onUpdateSettings({
        customPaperDataUrl: String(reader.result),
        paperTheme: 'custom',
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const orientations: ScreenOrientation[] = [0, 90, 180, 270];
  const fontFamilies: EpubFontFamily[] = ['serif', 'sans', 'mono'];

  const adjustFocused = useCallback(
    (dir: 1 | -1) => {
      switch (focusedId) {
        case 'spread':
          onUpdateSettings({ spreadMode: settings.spreadMode === 1 ? 2 : 1 });
          break;
        case 'orientation': {
          const idx = orientations.indexOf(settings.orientation);
          onUpdateSettings({
            orientation: orientations[(idx + dir + orientations.length) % orientations.length],
          });
          break;
        }
        case 'remap-dpad':
          onUpdateSettings({ remapDpadOnRotate: !settings.remapDpadOnRotate });
          break;
        case 'pdf-zoom-mode': {
          const idx = ZOOM_MODES.findIndex((m) => m.id === settings.smartZoomMode);
          const nextIdx = (idx + dir + ZOOM_MODES.length) % ZOOM_MODES.length;
          onUpdateSettings({ smartZoomMode: ZOOM_MODES[nextIdx].id });
          break;
        }
        case 'pdf-manual-zoom':
          onUpdateSettings({
            manualZoom: Math.max(1.0, Math.min(2.5, +(settings.manualZoom + dir * 0.1).toFixed(2))),
          });
          break;
        case 'pdf-jump-page':
          if (onJumpToPage) {
            onJumpToPage(Math.max(1, Math.min(totalPages, currentPageNum + dir)));
          }
          break;
        case 'epub-font-size':
          onUpdateSettings({
            fontSize: Math.max(14, Math.min(26, settings.fontSize + dir)),
          });
          break;
        case 'epub-font-family': {
          const idx = fontFamilies.indexOf(settings.fontFamily);
          onUpdateSettings({
            fontFamily: fontFamilies[(idx + dir + fontFamilies.length) % fontFamilies.length],
          });
          break;
        }
        case 'epub-jump-chapter':
          if (onJumpToChapter && chapters) {
            const next = Math.max(0, Math.min(chapters.length - 1, currentChapterIndex + dir));
            onJumpToChapter(next);
          }
          break;
        case 'paper-theme': {
          const idx = Math.max(
            0,
            PAPER_THEMES.findIndex((t) => t.id === settings.paperTheme)
          );
          const next = (idx + dir + PAPER_THEMES.length) % PAPER_THEMES.length;
          onUpdateSettings({ paperTheme: PAPER_THEMES[next].id });
          break;
        }
        case 'custom-paper':
          if (settings.customPaperDataUrl) {
            onUpdateSettings({
              paperTheme: settings.paperTheme === 'custom' ? 'ivory' : 'custom',
            });
          }
          break;
        case 'blue-light':
          onUpdateSettings({
            blueLightFilter: Math.max(0, Math.min(45, settings.blueLightFilter + dir * 5)),
          });
          break;
        case 'page-flip':
          onUpdateSettings({ pageFlipAnimation: !settings.pageFlipAnimation });
          break;
      }
    },
    [
      focusedId,
      settings,
      totalPages,
      currentPageNum,
      chapters,
      currentChapterIndex,
      onUpdateSettings,
      onJumpToPage,
      onJumpToChapter,
    ]
  );

  const activateFocused = useCallback(() => {
    if (focusedId === 'custom-paper') {
      customPaperInputRef.current?.click();
    } else if (focusedId === 'back-to-shelf') {
      onBackToShelf();
    } else {
      adjustFocused(1);
    }
  }, [focusedId, onBackToShelf, adjustFocused]);

  const handleButton = useCallback(
    (btn: X55Button) => {
      switch (btn) {
        case 'UP':
          setFocusIdx((i) => (i - 1 + focusableRows.length) % focusableRows.length);
          break;
        case 'DOWN':
          setFocusIdx((i) => (i + 1) % focusableRows.length);
          break;
        case 'LEFT':
        case 'L1':
          adjustFocused(-1);
          break;
        case 'RIGHT':
        case 'R1':
          adjustFocused(1);
          break;
        case 'A':
          activateFocused();
          break;
        case 'B':
        case 'START':
          onClose();
          break;
      }
    },
    [focusableRows.length, adjustFocused, activateFocused, onClose]
  );

  const { activeBtn } = useX55Input({
    enabled: true,
    orientation: 0,
    remapDpadOnRotate: false,
    onButton: handleButton,
  });

  const ringClass = (id: SettingRowId) =>
    focusedId === id
      ? 'ring-2 ring-amber-400 bg-stone-800/90 border-amber-500/60'
      : 'border-stone-800 bg-stone-900/70';

  const hints: ButtonHintItem[] = [
    { button: 'UP', label: 'Lên', onClick: () => handleButton('UP') },
    { button: 'DOWN', label: 'Xuống', onClick: () => handleButton('DOWN') },
    { button: 'LEFT', label: 'Giảm / Trước', onClick: () => handleButton('LEFT') },
    { button: 'RIGHT', label: 'Tăng / Sau', onClick: () => handleButton('RIGHT') },
    { button: 'A', label: 'Chọn / Đổi', onClick: () => handleButton('A') },
    { button: 'B', label: 'Đóng cài đặt', onClick: onClose },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2.5 sm:p-4">
      <div className="w-full max-w-2xl max-h-[94%] flex flex-col rounded-xl bg-[#191512] border border-stone-700/80 text-stone-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-[#14110e] shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] text-amber-400 font-medium flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Cài đặt đọc sách · {currentPageDisplay}</span>
            </div>
            <h2 className="text-sm font-semibold text-stone-100 truncate">{bookTitle}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigable Settings List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 thin-scroll">
          {/* 1. Spread Mode */}
          <div
            ref={(el) => {
              rowRefs.current['spread'] = el;
            }}
            onClick={() => setFocusIdx(focusableRows.indexOf('spread'))}
            className={`p-3 rounded-xl border transition-all ${ringClass('spread')}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-stone-200">
                <Columns2 className="w-4 h-4 text-amber-400" />
                <span>Số trang hiển thị (16:9)</span>
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ spreadMode: 1 })}
                  className={`py-1 px-2.5 rounded text-xs font-medium ${
                    settings.spreadMode === 1
                      ? 'bg-amber-600 text-stone-950 font-semibold'
                      : 'bg-stone-800 text-stone-300'
                  }`}
                >
                  1 Trang
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ spreadMode: 2 })}
                  className={`py-1 px-2.5 rounded text-xs font-medium ${
                    settings.spreadMode === 2
                      ? 'bg-amber-600 text-stone-950 font-semibold'
                      : 'bg-stone-800 text-stone-300'
                  }`}
                >
                  2 Trang
                </button>
              </div>
            </div>
          </div>

          {/* 2. Screen Orientation */}
          <div
            ref={(el) => {
              rowRefs.current['orientation'] = el;
            }}
            onClick={() => setFocusIdx(focusableRows.indexOf('orientation'))}
            className={`p-3 rounded-xl border transition-all ${ringClass('orientation')}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-stone-200">
                <RotateCw className="w-4 h-4 text-amber-400" />
                <span>Xoay màn hình dọc / ngang</span>
              </span>
              <div className="flex gap-1.5">
                {orientations.map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => onUpdateSettings({ orientation: deg })}
                    className={`py-1 px-2.5 rounded text-xs font-mono-hud ${
                      settings.orientation === deg
                        ? 'bg-amber-600 text-stone-950 font-semibold'
                        : 'bg-stone-800 text-stone-300'
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Remap D-Pad on Rotate */}
          <div
            ref={(el) => {
              rowRefs.current['remap-dpad'] = el;
            }}
            onClick={() => {
              setFocusIdx(focusableRows.indexOf('remap-dpad'));
              onUpdateSettings({ remapDpadOnRotate: !settings.remapDpadOnRotate });
            }}
            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${ringClass(
              'remap-dpad'
            )}`}
          >
            <span className="text-xs font-medium text-stone-200">
              Tự đảo hướng D-Pad khi xoay màn hình
            </span>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                settings.remapDpadOnRotate
                  ? 'bg-amber-600 text-stone-950'
                  : 'bg-stone-800 text-stone-400'
              }`}
            >
              {settings.remapDpadOnRotate ? 'Bật' : 'Tắt'}
            </span>
          </div>

          {/* PDF Specific Controls */}
          {bookFormat === 'pdf' && (
            <>
              <div
                ref={(el) => {
                  rowRefs.current['pdf-zoom-mode'] = el;
                }}
                onClick={() => setFocusIdx(focusableRows.indexOf('pdf-zoom-mode'))}
                className={`p-3 rounded-xl border space-y-2 transition-all ${ringClass(
                  'pdf-zoom-mode'
                )}`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-stone-200">
                  <ZoomIn className="w-4 h-4 text-amber-400" />
                  <span>Thu phóng thông minh cho PDF</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {ZOOM_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onUpdateSettings({ smartZoomMode: m.id })}
                      className={`text-left p-2 rounded-lg border text-xs ${
                        settings.smartZoomMode === m.id
                          ? 'bg-amber-600/25 border-amber-500 text-amber-100 font-semibold'
                          : 'bg-stone-800/70 border-stone-700/60 text-stone-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {settings.smartZoomMode === 'manual' && (
                <div
                  ref={(el) => {
                    rowRefs.current['pdf-manual-zoom'] = el;
                  }}
                  onClick={() => setFocusIdx(focusableRows.indexOf('pdf-manual-zoom'))}
                  className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${ringClass(
                    'pdf-manual-zoom'
                  )}`}
                >
                  <span className="text-xs font-medium text-stone-200 whitespace-nowrap">
                    Mức phóng to PDF:
                  </span>
                  <input
                    type="range"
                    min={1.0}
                    max={2.5}
                    step={0.05}
                    value={settings.manualZoom}
                    onChange={(e) => onUpdateSettings({ manualZoom: parseFloat(e.target.value) })}
                    className="flex-1 accent-amber-500"
                  />
                  <span className="text-xs font-mono-hud text-amber-300 w-12 text-right">
                    {Math.round(settings.manualZoom * 100)}%
                  </span>
                </div>
              )}

              {onJumpToPage && totalPages > 1 && (
                <div
                  ref={(el) => {
                    rowRefs.current['pdf-jump-page'] = el;
                  }}
                  onClick={() => setFocusIdx(focusableRows.indexOf('pdf-jump-page'))}
                  className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${ringClass(
                    'pdf-jump-page'
                  )}`}
                >
                  <span className="text-xs font-medium text-stone-200 whitespace-nowrap">
                    Nhảy đến trang:
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={totalPages}
                    value={currentPageNum}
                    onChange={(e) => onJumpToPage(parseInt(e.target.value, 10))}
                    className="flex-1 accent-amber-500"
                  />
                  <span className="text-xs font-mono-hud text-amber-300 w-16 text-right">
                    {currentPageNum} / {totalPages}
                  </span>
                </div>
              )}
            </>
          )}

          {/* EPUB Specific Controls */}
          {bookFormat === 'epub' && (
            <>
              <div
                ref={(el) => {
                  rowRefs.current['epub-font-size'] = el;
                }}
                onClick={() => setFocusIdx(focusableRows.indexOf('epub-font-size'))}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${ringClass(
                  'epub-font-size'
                )}`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-stone-200">
                  <BookOpen className="w-4 h-4 text-amber-400" />
                  <span>Cỡ chữ EPUB</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })
                    }
                    className="w-7 h-7 rounded bg-stone-800 text-xs font-bold"
                  >
                    A-
                  </button>
                  <span className="text-xs font-mono-hud text-amber-300 w-10 text-center">
                    {settings.fontSize}px
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ fontSize: Math.min(26, settings.fontSize + 1) })
                    }
                    className="w-7 h-7 rounded bg-stone-800 text-xs font-bold"
                  >
                    A+
                  </button>
                </div>
              </div>

              <div
                ref={(el) => {
                  rowRefs.current['epub-font-family'] = el;
                }}
                onClick={() => setFocusIdx(focusableRows.indexOf('epub-font-family'))}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${ringClass(
                  'epub-font-family'
                )}`}
              >
                <span className="text-xs font-medium text-stone-200">Kiểu chữ</span>
                <div className="flex gap-1.5">
                  {fontFamilies.map((fam) => (
                    <button
                      key={fam}
                      type="button"
                      onClick={() => onUpdateSettings({ fontFamily: fam })}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${
                        settings.fontFamily === fam
                          ? 'bg-amber-600 text-stone-950 font-semibold'
                          : 'bg-stone-800 text-stone-300'
                      }`}
                    >
                      {fam === 'serif' ? 'Có chân' : fam === 'sans' ? 'Không chân' : 'Mono'}
                    </button>
                  ))}
                </div>
              </div>

              {chapters && chapters.length > 1 && onJumpToChapter && (
                <div
                  ref={(el) => {
                    rowRefs.current['epub-jump-chapter'] = el;
                  }}
                  onClick={() => setFocusIdx(focusableRows.indexOf('epub-jump-chapter'))}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${ringClass(
                    'epub-jump-chapter'
                  )}`}
                >
                  <span className="text-xs font-medium text-stone-200 shrink-0">
                    Chương ({currentChapterIndex + 1}/{chapters.length}):
                  </span>
                  <span className="text-xs text-amber-200 truncate">
                    {chapters[currentChapterIndex]?.title}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Paper Background Theme */}
          <div
            ref={(el) => {
              rowRefs.current['paper-theme'] = el;
            }}
            onClick={() => setFocusIdx(focusableRows.indexOf('paper-theme'))}
            className={`p-3 rounded-xl border space-y-2 transition-all ${ringClass('paper-theme')}`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-200">
              <Sun className="w-4 h-4 text-amber-400" />
              <span>Nền giấy & Chế độ ban đêm</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {PAPER_THEMES.map((theme) => {
                const active = settings.paperTheme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => onUpdateSettings({ paperTheme: theme.id })}
                    className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-left ${
                      active
                        ? 'border-amber-500 bg-amber-600/20 text-amber-100'
                        : 'border-stone-700/70 bg-stone-800/60 text-stone-300'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-stone-500/50 shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: theme.swatch }}
                    >
                      {theme.dark && <Moon className="w-2.5 h-2.5 text-amber-300" />}
                    </span>
                    <span className="text-[11px] font-medium truncate">{theme.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Paper Upload */}
          <div
            ref={(el) => {
              rowRefs.current['custom-paper'] = el;
            }}
            onClick={() => {
              setFocusIdx(focusableRows.indexOf('custom-paper'));
              customPaperInputRef.current?.click();
            }}
            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${ringClass(
              'custom-paper'
            )}`}
          >
            <span className="flex items-center gap-2 text-xs font-medium text-stone-200">
              <FileImage className="w-4 h-4 text-amber-400" />
              <span>Tải ảnh nền trang giấy riêng (EPUB)</span>
            </span>
            <span className="text-xs text-amber-300">
              {settings.paperTheme === 'custom'
                ? 'Đang dùng ảnh riêng'
                : settings.customPaperDataUrl
                ? 'Đã có ảnh · Nhấn ◀▶ chọn'
                : 'Nhấn A để chọn ảnh'}
            </span>
            <input
              ref={customPaperInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePaperUpload}
            />
          </div>

          {/* Blue Light Filter */}
          <div
            ref={(el) => {
              rowRefs.current['blue-light'] = el;
            }}
            onClick={() => setFocusIdx(focusableRows.indexOf('blue-light'))}
            className={`p-3 rounded-xl border flex items-center gap-3 transition-all ${ringClass(
              'blue-light'
            )}`}
          >
            <Eye className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs text-stone-200 whitespace-nowrap">Lọc ánh sáng xanh:</span>
            <input
              type="range"
              min={0}
              max={45}
              step={5}
              value={settings.blueLightFilter}
              onChange={(e) =>
                onUpdateSettings({ blueLightFilter: parseInt(e.target.value, 10) })
              }
              className="flex-1 accent-amber-500"
            />
            <span className="text-xs font-mono-hud text-amber-300 w-9 text-right">
              {settings.blueLightFilter}%
            </span>
          </div>

          {/* 3D Page Flip Toggle */}
          <div
            ref={(el) => {
              rowRefs.current['page-flip'] = el;
            }}
            onClick={() => {
              setFocusIdx(focusableRows.indexOf('page-flip'));
              onUpdateSettings({ pageFlipAnimation: !settings.pageFlipAnimation });
            }}
            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${ringClass(
              'page-flip'
            )}`}
          >
            <span className="flex items-center gap-2 text-xs font-medium text-stone-200">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Hiệu ứng lật trang sách 3D</span>
            </span>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                settings.pageFlipAnimation
                  ? 'bg-amber-600 text-stone-950'
                  : 'bg-stone-800 text-stone-400'
              }`}
            >
              {settings.pageFlipAnimation ? 'Bật' : 'Tắt'}
            </span>
          </div>

          {/* Back to Bookshelf Action */}
          <button
            ref={(el) => {
              rowRefs.current['back-to-shelf'] = el;
            }}
            type="button"
            onClick={onBackToShelf}
            className={`w-full p-3 rounded-xl border text-center text-xs font-semibold transition-all ${
              focusedId === 'back-to-shelf'
                ? 'ring-2 ring-amber-400 bg-amber-600 text-stone-950 border-amber-400'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border-stone-700'
            }`}
          >
            Quay về Giá Sách (Nhấn A hoặc B ngoài menu)
          </button>
        </div>

        <ButtonHintBar hints={hints} activeBtn={activeBtn} />
      </div>
    </div>
  );
}
