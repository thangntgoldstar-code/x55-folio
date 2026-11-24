import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  Battery,
  BatteryCharging,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Monitor,
  Moon,
  RotateCw,
  SlidersHorizontal,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { SystemStatus } from '../hooks/useSystemStatus';
import { useX55Input } from '../hooks/useX55Input';
import { parseEpubBuffer, type ParsedEpub } from '../services/epubEngine';
import { loadPdfDocument, renderPdfPageToCanvas } from '../services/pdfEngine';
import type {
  BookItem,
  PaperTheme,
  ReaderSettings,
  ReadingLocation,
  ScreenOrientation,
  SmartZoomMode,
  X55Button,
} from '../types/reader';
import { ButtonHintBar, type ButtonHintItem } from './ButtonHintBar';
import { ReaderSettingsOverlay } from './ReaderSettingsOverlay';

interface BookReaderViewProps {
  book: BookItem;
  buffer: ArrayBuffer;
  settings: ReaderSettings;
  status: SystemStatus;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onSaveLocation: (bookId: string, location: ReadingLocation, pageCount?: number) => void;
  onCloseBook: () => void;
}

const PAPER_CLASS_MAP: Record<PaperTheme, string> = {
  ivory: 'paper-texture-ivory',
  parchment: 'paper-texture-parchment',
  washi: 'paper-texture-washi',
  'night-amber': 'paper-texture-night-amber',
  'oled-dark': 'paper-texture-oled-dark',
  custom: 'bg-[#f4efe4] text-[#221d17]',
};

const ZOOM_LABELS: Record<SmartZoomMode, string> = {
  'auto-crop': 'Cắt lề',
  'fit-page': 'Vừa trang',
  'fit-width': 'Vừa ngang',
  manual: 'Thủ công',
};

export function BookReaderView({
  book,
  buffer,
  settings,
  status,
  onUpdateSettings,
  onSaveLocation,
  onCloseBook,
}: BookReaderViewProps) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);
  const [scrubBanner, setScrubBanner] = useState<string | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const scrubTimerRef = useRef<number | null>(null);
  const pendingEpubRatioRef = useRef<number | null>(null);

  // Flip animation state
  const [flipDirection, setFlipDirection] = useState<'next' | 'prev' | null>(null);
  const flipTimerRef = useRef<number | null>(null);

  // Container dimensions (before rotation)
  const stageWrapperRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 600 });

  // PDF state
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const [pdfPage, setPdfPage] = useState<number>(Math.max(1, book.lastLocation.pageIndex || 1));
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(book.pageCount || 1);
  const [pdfPan, setPdfPan] = useState({ x: 0, y: 0 });
  const [autoCropActive, setAutoCropActive] = useState(false);

  // EPUB state
  const [epubData, setEpubData] = useState<ParsedEpub | null>(null);
  const [chapterIndex, setChapterIndex] = useState<number>(book.lastLocation.chapterIndex || 0);
  const [localPage, setLocalPage] = useState<number>(book.lastLocation.pageIndex || 0);
  const [chapterPages, setChapterPages] = useState<number>(1);
  const epubMeasureLeftRef = useRef<HTMLDivElement | null>(null);
  const epubContentLeftRef = useRef<HTMLDivElement | null>(null);

  // Auto-hide top & bottom bars after 3.5s of inactivity, leaving only Clock + Battery
  const scheduleHudAutoHide = useCallback(() => {
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    if (settingsOpen) return;
    hudTimerRef.current = window.setTimeout(() => {
      setHudHidden(true);
    }, 3500);
  }, [settingsOpen]);

  const toggleHudManual = useCallback(() => {
    setHudHidden((prev) => {
      const next = !prev;
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
      if (!next && !settingsOpen) {
        hudTimerRef.current = window.setTimeout(() => {
          setHudHidden(true);
        }, 3500);
      }
      return next;
    });
  }, [settingsOpen]);

  useEffect(() => {
    if (settingsOpen) {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    } else if (!hudHidden) {
      scheduleHudAutoHide();
    }
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [settingsOpen, hudHidden, scheduleHudAutoHide]);

  useEffect(() => {
    return () => {
      if (scrubTimerRef.current) window.clearTimeout(scrubTimerRef.current);
    };
  }, []);

  // Measure outer stage box
  useEffect(() => {
    const el = stageWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 40 && height > 40) {
          setStageSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Logical dimensions after screen orientation rotation
  const isVertical = settings.orientation === 90 || settings.orientation === 270;
  const logicalWidth = isVertical ? stageSize.height : stageSize.width;
  const logicalHeight = isVertical ? stageSize.width : stageSize.height;

  // Load PDF or EPUB document on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    const load = async () => {
      try {
        if (book.format === 'pdf') {
          const { doc, numPages } = await loadPdfDocument(buffer);
          if (cancelled) {
            await doc.cleanup();
            return;
          }
          pdfDocRef.current = doc;
          setPdfTotalPages(numPages);
          const restored = Math.min(numPages, Math.max(1, book.lastLocation.pageIndex || 1));
          setPdfPage(restored);
        } else {
          const parsed = await parseEpubBuffer(buffer);
          if (cancelled) {
            parsed.assetUrls.forEach((u) => URL.revokeObjectURL(u));
            return;
          }
          setEpubData(parsed);
          const chIdx = Math.min(
            parsed.chapters.length - 1,
            Math.max(0, book.lastLocation.chapterIndex || 0)
          );
          setChapterIndex(chIdx);
          setLocalPage(Math.max(0, book.lastLocation.pageIndex || 0));
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Không thể mở tệp sách này.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (pdfDocRef.current) {
        pdfDocRef.current.cleanup().catch(() => {});
        pdfDocRef.current = null;
      }
    };
  }, [book.id, book.format, buffer]);

  // Cleanup EPUB blob URLs on unmount
  useEffect(() => {
    return () => {
      epubData?.assetUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [epubData]);

  // Trigger 3D Page Flip visual feedback
  const triggerFlip = useCallback(
    (dir: 'next' | 'prev') => {
      if (!settings.pageFlipAnimation) return;
      setFlipDirection(null);
      requestAnimationFrame(() => {
        setFlipDirection(dir);
      });
      if (flipTimerRef.current) window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = window.setTimeout(() => setFlipDirection(null), 470);
    },
    [settings.pageFlipAnimation]
  );

  // Render PDF Canvas(es) whenever page, spread, rotation, or zoom changes
  useEffect(() => {
    if (book.format !== 'pdf' || loading || !pdfDocRef.current) return;
    let cancelled = false;

    const renderPages = async () => {
      const doc = pdfDocRef.current;
      if (!doc) return;

      const spread = settings.spreadMode;
      const availW = spread === 2 ? Math.floor((logicalWidth - 28) / 2) : logicalWidth - 16;
      const availH = logicalHeight - 16;

      if (leftCanvasRef.current && pdfPage >= 1 && pdfPage <= doc.numPages) {
        const res = await renderPdfPageToCanvas({
          doc,
          pageNumber: pdfPage,
          targetCanvas: leftCanvasRef.current,
          containerWidth: Math.max(120, availW),
          containerHeight: Math.max(120, availH),
          zoomMode: settings.smartZoomMode,
          manualZoom: settings.manualZoom,
        });
        if (!cancelled) {
          setAutoCropActive(res.autoCropped);
        }
      }

      if (spread === 2 && rightCanvasRef.current && pdfPage + 1 <= doc.numPages) {
        await renderPdfPageToCanvas({
          doc,
          pageNumber: pdfPage + 1,
          targetCanvas: rightCanvasRef.current,
          containerWidth: Math.max(120, availW),
          containerHeight: Math.max(120, availH),
          zoomMode: settings.smartZoomMode,
          manualZoom: settings.manualZoom,
        });
      }

      if (!cancelled && pdfScrollRef.current) {
        pdfScrollRef.current.scrollTop = 0;
        setPdfPan({ x: 0, y: 0 });
      }
    };

    renderPages().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    book.format,
    loading,
    pdfPage,
    settings.spreadMode,
    settings.smartZoomMode,
    settings.manualZoom,
    logicalWidth,
    logicalHeight,
  ]);

  // Recalculate EPUB column pagination when chapter, font, spread, or dimensions change
  const epubPageWidth = useMemo(() => {
    const horizontalPad = settings.spreadMode === 2 ? 28 : 16;
    const raw =
      settings.spreadMode === 2
        ? Math.floor((logicalWidth - horizontalPad) / 2)
        : logicalWidth - horizontalPad;
    return Math.max(220, raw);
  }, [logicalWidth, settings.spreadMode]);

  const epubPageHeight = Math.max(200, logicalHeight - 20);

  useEffect(() => {
    if (book.format !== 'epub' || loading || !epubData) return;
    const el = epubContentLeftRef.current;
    if (!el) return;

    const measure = () => {
      const totalCols = Math.max(1, Math.round(el.scrollWidth / epubPageWidth));
      setChapterPages(totalCols);
      if (pendingEpubRatioRef.current !== null) {
        const target = Math.round(pendingEpubRatioRef.current * Math.max(0, totalCols - 1));
        pendingEpubRatioRef.current = null;
        setLocalPage(Math.min(totalCols - 1, Math.max(0, target)));
      } else {
        setLocalPage((prev) => Math.min(prev, totalCols - 1));
      }
    };

    // Wait a frame for fonts & layout to settle
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [
    book.format,
    loading,
    epubData,
    chapterIndex,
    epubPageWidth,
    epubPageHeight,
    settings.fontSize,
    settings.lineHeight,
    settings.fontFamily,
  ]);

  // Persist reading position immediately whenever page/chapter updates
  useEffect(() => {
    if (loading) return;

    if (book.format === 'pdf') {
      const percent = pdfTotalPages > 0 ? Math.min(100, (pdfPage / pdfTotalPages) * 100) : 0;
      onSaveLocation(
        book.id,
        {
          pageIndex: pdfPage,
          totalPages: pdfTotalPages,
          chapterIndex: 0,
          scrollRatio: 0,
          percent,
          updatedAt: Date.now(),
        },
        pdfTotalPages
      );
    } else if (epubData) {
      const totalChaps = epubData.chapters.length;
      const chapProgress = chapterPages > 0 ? (localPage + 1) / chapterPages : 1;
      const percent =
        totalChaps > 0 ? Math.min(100, ((chapterIndex + chapProgress) / totalChaps) * 100) : 0;
      onSaveLocation(
        book.id,
        {
          pageIndex: localPage,
          totalPages: chapterPages,
          chapterIndex,
          scrollRatio: 0,
          percent,
          updatedAt: Date.now(),
        },
        totalChaps
      );
    }
  }, [book.id, book.format, loading, pdfPage, pdfTotalPages, epubData, chapterIndex, localPage, chapterPages, onSaveLocation]);

  // Page Turn Handlers
  const goNextPage = useCallback(() => {
    const step = settings.spreadMode;
    if (book.format === 'pdf') {
      if (pdfPage + step <= pdfTotalPages) {
        triggerFlip('next');
        setPdfPage((p) => Math.min(pdfTotalPages, p + step));
      } else if (pdfPage < pdfTotalPages) {
        triggerFlip('next');
        setPdfPage(pdfTotalPages);
      }
    } else if (epubData) {
      if (localPage + step < chapterPages) {
        triggerFlip('next');
        setLocalPage((p) => p + step);
      } else if (chapterIndex + 1 < epubData.chapters.length) {
        triggerFlip('next');
        setChapterIndex((c) => c + 1);
        setLocalPage(0);
      }
    }
  }, [book.format, settings.spreadMode, pdfPage, pdfTotalPages, epubData, localPage, chapterPages, chapterIndex, triggerFlip]);

  const goPrevPage = useCallback(() => {
    const step = settings.spreadMode;
    if (book.format === 'pdf') {
      if (pdfPage > 1) {
        triggerFlip('prev');
        setPdfPage((p) => Math.max(1, p - step));
      }
    } else if (epubData) {
      if (localPage - step >= 0) {
        triggerFlip('prev');
        setLocalPage((p) => Math.max(0, p - step));
      } else if (chapterIndex > 0) {
        triggerFlip('prev');
        setChapterIndex((c) => c - 1);
        setLocalPage(0);
      }
    }
  }, [book.format, settings.spreadMode, pdfPage, epubData, localPage, chapterIndex, triggerFlip]);

  const cycleSmartZoom = useCallback(() => {
    const order: SmartZoomMode[] = ['auto-crop', 'fit-page', 'fit-width', 'manual'];
    const idx = order.indexOf(settings.smartZoomMode);
    const next = order[(idx + 1) % order.length];
    onUpdateSettings({ smartZoomMode: next });
  }, [settings.smartZoomMode, onUpdateSettings]);

  const toggleNightMode = useCallback(() => {
    const isNight =
      settings.paperTheme === 'night-amber' || settings.paperTheme === 'oled-dark';
    onUpdateSettings({
      paperTheme: isNight ? 'ivory' : 'night-amber',
    });
  }, [settings.paperTheme, onUpdateSettings]);

  const cycleOrientation = useCallback(() => {
    const order: ScreenOrientation[] = [0, 90, 180, 270];
    const next = order[(order.indexOf(settings.orientation) + 1) % order.length];
    onUpdateSettings({ orientation: next });
  }, [settings.orientation, onUpdateSettings]);

  const toggleSpreadMode = useCallback(() => {
    onUpdateSettings({ spreadMode: settings.spreadMode === 1 ? 2 : 1 });
  }, [settings.spreadMode, onUpdateSettings]);

  const showScrubFeedback = useCallback((label: string) => {
    setScrubBanner(label);
    if (scrubTimerRef.current) window.clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = window.setTimeout(() => setScrubBanner(null), 1300);
  }, []);

  // Fast % progress scrubbing via D-Pad UP (+5%) / DOWN (-5%) for large books
  const scrubProgress = useCallback(
    (deltaPercent: number) => {
      if (book.format === 'pdf') {
        const curPct = pdfTotalPages > 0 ? (pdfPage / pdfTotalPages) * 100 : 0;
        const nextPct = Math.max(0, Math.min(100, curPct + deltaPercent));
        let nextPage = Math.max(1, Math.min(pdfTotalPages, Math.round((nextPct / 100) * pdfTotalPages)));
        if (deltaPercent > 0 && nextPage <= pdfPage) {
          nextPage = Math.min(pdfTotalPages, pdfPage + 1);
        } else if (deltaPercent < 0 && nextPage >= pdfPage) {
          nextPage = Math.max(1, pdfPage - 1);
        }
        setPdfPage(nextPage);
        const finalPct = pdfTotalPages > 0 ? ((nextPage / pdfTotalPages) * 100).toFixed(1) : '0.0';
        showScrubFeedback(`Tua tiến trình: ${finalPct}% · Trang ${nextPage}/${pdfTotalPages}`);
      } else if (epubData) {
        const totalChaps = Math.max(1, epubData.chapters.length);
        const curChapProg = chapterPages > 0 ? (localPage + 1) / chapterPages : 1;
        const curPct = ((chapterIndex + curChapProg) / totalChaps) * 100;
        const nextPct = Math.max(0, Math.min(100, curPct + deltaPercent));

        const targetFrac = (nextPct / 100) * totalChaps;
        const targetCh = Math.min(totalChaps - 1, Math.max(0, Math.floor(targetFrac === totalChaps ? totalChaps - 1 : targetFrac)));
        const withinRatio =
          targetFrac >= totalChaps ? 1 : Math.max(0, Math.min(1, targetFrac - targetCh));

        if (targetCh !== chapterIndex) {
          pendingEpubRatioRef.current = withinRatio;
          setChapterIndex(targetCh);
          showScrubFeedback(`Tua tiến trình: ${nextPct.toFixed(1)}% · Ch.${targetCh + 1}/${totalChaps}`);
        } else {
          let nextLocal = Math.round(withinRatio * Math.max(0, chapterPages - 1));
          if (deltaPercent > 0 && nextLocal <= localPage) {
            if (localPage + 1 < chapterPages) {
              nextLocal = localPage + 1;
            } else if (chapterIndex + 1 < totalChaps) {
              pendingEpubRatioRef.current = 0;
              setChapterIndex(chapterIndex + 1);
              showScrubFeedback(`Tua tiến trình: ${nextPct.toFixed(1)}% · Ch.${chapterIndex + 2}/${totalChaps}`);
              return;
            }
          } else if (deltaPercent < 0 && nextLocal >= localPage) {
            if (localPage > 0) {
              nextLocal = localPage - 1;
            } else if (chapterIndex > 0) {
              pendingEpubRatioRef.current = 1;
              setChapterIndex(chapterIndex - 1);
              showScrubFeedback(`Tua tiến trình: ${nextPct.toFixed(1)}% · Ch.${chapterIndex}/${totalChaps}`);
              return;
            }
          }
          setLocalPage(Math.max(0, Math.min(chapterPages - 1, nextLocal)));
          showScrubFeedback(`Tua tiến trình: ${nextPct.toFixed(1)}% · Ch.${chapterIndex + 1}/${totalChaps}`);
        }
      }
    },
    [book.format, pdfPage, pdfTotalPages, epubData, chapterIndex, localPage, chapterPages, showScrubFeedback]
  );

  // Unified X55 Physical Controller + Keyboard Handling
  const handleReaderButton = useCallback(
    (btn: X55Button) => {
      if (settingsOpen) return;

      // SELECT toggles top/bottom HUD manually; no other key reveals hidden HUD
      if (btn === 'SELECT') {
        toggleHudManual();
        return;
      }

      // If HUD is already visible, reset the 3.5s idle countdown on interaction
      if (!hudHidden) {
        scheduleHudAutoHide();
      }

      switch (btn) {
        case 'RIGHT':
        case 'R1':
        case 'A':
          goNextPage();
          break;
        case 'LEFT':
        case 'L1':
          goPrevPage();
          break;
        case 'UP':
          scrubProgress(5);
          break;
        case 'DOWN':
          scrubProgress(-5);
          break;
        case 'B':
          onCloseBook();
          break;
        case 'X':
          if (book.format === 'pdf') {
            cycleSmartZoom();
          } else {
            toggleSpreadMode();
          }
          break;
        case 'Y':
          toggleNightMode();
          break;
        case 'L2':
          toggleSpreadMode();
          break;
        case 'R2':
          cycleOrientation();
          break;
        case 'START':
          setSettingsOpen(true);
          break;
      }
    },
    [
      settingsOpen,
      hudHidden,
      toggleHudManual,
      scheduleHudAutoHide,
      book.format,
      goNextPage,
      goPrevPage,
      scrubProgress,
      onCloseBook,
      cycleSmartZoom,
      toggleSpreadMode,
      toggleNightMode,
      cycleOrientation,
    ]
  );

  const handleAnalogPan = useCallback(
    (dx: number, dy: number) => {
      if (book.format === 'pdf' && settings.smartZoomMode === 'manual') {
        setPdfPan((prev) => ({
          x: Math.max(-320, Math.min(320, prev.x - dx * 9)),
          y: Math.max(-320, Math.min(320, prev.y - dy * 9)),
        }));
      } else if (book.format === 'pdf' && pdfScrollRef.current) {
        pdfScrollRef.current.scrollTop += dy * 10;
      }
    },
    [book.format, settings.smartZoomMode]
  );

  const { activeBtn } = useX55Input({
    enabled: !settingsOpen,
    orientation: settings.orientation,
    remapDpadOnRotate: settings.remapDpadOnRotate,
    onButton: handleReaderButton,
    onAnalogMove: handleAnalogPan,
  });

  // Compute progress percentage & display labels
  const progressPercent = useMemo(() => {
    if (book.format === 'pdf') {
      return pdfTotalPages > 0 ? Math.min(100, (pdfPage / pdfTotalPages) * 100) : 0;
    }
    if (!epubData) return 0;
    const totalChaps = epubData.chapters.length;
    const chapProg = chapterPages > 0 ? (localPage + 1) / chapterPages : 1;
    return totalChaps > 0 ? Math.min(100, ((chapterIndex + chapProg) / totalChaps) * 100) : 0;
  }, [book.format, pdfPage, pdfTotalPages, epubData, chapterIndex, localPage, chapterPages]);

  const currentPageLabel =
    book.format === 'pdf'
      ? settings.spreadMode === 2 && pdfPage + 1 <= pdfTotalPages
        ? `Trang ${pdfPage}–${pdfPage + 1} / ${pdfTotalPages}`
        : `Trang ${pdfPage} / ${pdfTotalPages}`
      : `Ch.${chapterIndex + 1}/${epubData?.chapters.length || 1} · Tr.${localPage + 1}/${chapterPages}`;

  const isNightTheme =
    settings.paperTheme === 'night-amber' || settings.paperTheme === 'oled-dark';

  // PDF eye-care color transform for night mode or warm paper reading
  const pdfFilterStyle = useMemo((): CSSProperties => {
    if (settings.paperTheme === 'oled-dark') {
      return { filter: 'invert(0.95) hue-rotate(180deg) contrast(1.08)' };
    }
    if (settings.paperTheme === 'night-amber') {
      return { filter: 'invert(0.89) hue-rotate(180deg) sepia(0.24) contrast(1.04) brightness(0.94)' };
    }
    if (settings.paperTheme === 'parchment') {
      return { filter: 'sepia(0.22) brightness(0.97) contrast(1.02)' };
    }
    if (settings.paperTheme === 'ivory') {
      return { filter: 'sepia(0.08) brightness(0.99)' };
    }
    return {};
  }, [settings.paperTheme]);

  // Custom paper image styling for EPUB
  const paperBackgroundStyle = useMemo((): CSSProperties => {
    if (settings.paperTheme === 'custom' && settings.customPaperDataUrl) {
      return {
        backgroundImage: `linear-gradient(rgba(250,246,238,0.68), rgba(250,246,238,0.68)), url(${settings.customPaperDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    return {};
  }, [settings.paperTheme, settings.customPaperDataUrl]);

  const epubFontClass =
    settings.fontFamily === 'serif'
      ? 'font-serif-book'
      : settings.fontFamily === 'mono'
      ? 'font-mono-hud'
      : '';

  const hints: ButtonHintItem[] = [
    { button: 'L1', label: 'Trang trước', keyHint: '◀ / Q', onClick: goPrevPage },
    { button: 'R1', label: 'Trang sau', keyHint: '▶ / E', onClick: goNextPage },
    { button: 'UP', label: 'Tua +5%', onClick: () => scrubProgress(5) },
    { button: 'DOWN', label: 'Tua -5%', onClick: () => scrubProgress(-5) },
    {
      button: 'X',
      label: book.format === 'pdf' ? `Zoom: ${ZOOM_LABELS[settings.smartZoomMode]}` : `${settings.spreadMode} Trang`,
      keyHint: 'C',
      onClick: book.format === 'pdf' ? cycleSmartZoom : toggleSpreadMode,
    },
    {
      button: 'Y',
      label: isNightTheme ? 'Chế độ Ngày' : 'Đọc Ban Đêm',
      keyHint: 'V',
      onClick: toggleNightMode,
    },
    {
      button: 'L2',
      label: `${settings.spreadMode} Trang`,
      keyHint: '1',
      onClick: toggleSpreadMode,
    },
    {
      button: 'R2',
      label: `Xoay ${settings.orientation}°`,
      keyHint: '2',
      onClick: cycleOrientation,
    },
    {
      button: 'SELECT',
      label: 'Ẩn/hiện thanh',
      keyHint: 'Tab',
      onClick: toggleHudManual,
    },
    {
      button: 'START',
      label: 'Cài đặt',
      keyHint: 'M',
      onClick: () => setSettingsOpen(true),
    },
    {
      button: 'B',
      label: 'Giá sách',
      keyHint: 'Esc',
      onClick: onCloseBook,
    },
  ];

  const currentChapter = epubData?.chapters[chapterIndex];

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 relative select-none overflow-hidden ${
        isNightTheme ? 'bg-[#0b0a09]' : 'bg-[#1e1a16]'
      }`}
    >
      {/* Top Reader Mini-Toolbar (in flex flow so book automatically resizes without clipping) */}
      {!hudHidden && (
        <div className="flex items-center justify-between gap-3 px-4 h-9 bg-[#15120f]/95 border-b border-stone-800/80 text-xs text-stone-200 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onCloseBook}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-800 text-stone-300 hover:text-white transition-colors shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Giá sách</span>
            </button>
            <span className="text-stone-600">|</span>
            <span className="font-medium text-amber-100 truncate">{book.title}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {book.format === 'pdf' && (
              <button
                type="button"
                onClick={() => {
                  scheduleHudAutoHide();
                  cycleSmartZoom();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-stone-800/80 hover:bg-stone-700 text-amber-200 transition-colors"
                title="Đổi chế độ thu phóng thông minh (Phím X)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                <span>
                  {ZOOM_LABELS[settings.smartZoomMode]}
                  {settings.smartZoomMode === 'auto-crop' && autoCropActive ? ' · Đã cắt lề' : ''}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                scheduleHudAutoHide();
                toggleSpreadMode();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded bg-stone-800/80 hover:bg-stone-700 text-stone-200 transition-colors"
              title="1 Trang hoặc 2 Trang (Phím L2)"
            >
              <Columns2 className="w-3.5 h-3.5 text-amber-400" />
              <span>{settings.spreadMode} Trang</span>
            </button>

            <button
              type="button"
              onClick={() => {
                scheduleHudAutoHide();
                cycleOrientation();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded bg-stone-800/80 hover:bg-stone-700 text-stone-200 transition-colors font-mono-hud"
              title="Xoay màn hình dọc/ngang (Phím R2)"
            >
              <RotateCw className="w-3.5 h-3.5 text-amber-400" />
              <span>{settings.orientation}°</span>
            </button>

            <button
              type="button"
              onClick={() => {
                scheduleHudAutoHide();
                toggleNightMode();
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                isNightTheme
                  ? 'bg-amber-600/30 text-amber-200 border border-amber-500/40'
                  : 'bg-stone-800/80 hover:bg-stone-700 text-stone-200'
              }`}
              title="Chế độ đọc ban đêm (Phím Y)"
            >
              <Moon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isNightTheme ? 'Ban đêm' : 'Ban ngày'}</span>
            </button>

            {!window.x55Native?.isHandheld &&
              !new URLSearchParams(window.location.search).has('x55') &&
              !new URLSearchParams(window.location.search).has('kiosk') && (
                <button
                  type="button"
                  onClick={() => {
                    scheduleHudAutoHide();
                    onUpdateSettings({ x55FrameMode: !settings.x55FrameMode });
                  }}
                  className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                    settings.x55FrameMode
                      ? 'bg-amber-600/25 text-amber-200 border border-amber-500/40'
                      : 'bg-stone-800/80 hover:bg-stone-700 text-stone-200'
                  }`}
                  title="Bật/tắt giao diện máy X55 giả lập"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{settings.x55FrameMode ? 'Máy X55' : 'Toàn màn'}</span>
                </button>
              )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-stone-800/80 hover:bg-stone-700 text-stone-200 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Cài đặt</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Rotatable Reading Stage (Automatically shrinks when HUD shows, expands when HUD hides) */}
      <div
        ref={stageWrapperRef}
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden"
      >
        {/* Left/Right Click Touch Zones for quick page turning */}
        <button
          type="button"
          onClick={goPrevPage}
          aria-label="Trang trước"
          className="absolute inset-y-0 left-0 w-10 sm:w-14 z-20 flex items-center justify-start pl-1.5 opacity-0 hover:opacity-100 transition-opacity group"
        >
          <span className="p-1.5 rounded-full bg-black/45 text-white/90">
            <ChevronLeft className="w-4 h-4" />
          </span>
        </button>

        <button
          type="button"
          onClick={goNextPage}
          aria-label="Trang sau"
          className="absolute inset-y-0 right-0 w-10 sm:w-14 z-20 flex items-center justify-end pr-1.5 opacity-0 hover:opacity-100 transition-opacity group"
        >
          <span className="p-1.5 rounded-full bg-black/45 text-white/90">
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>

        {/* Rotated Book Viewport */}
        <div
          style={{
            width: `${logicalWidth}px`,
            height: `${logicalHeight}px`,
            transform: settings.orientation !== 0 ? `rotate(${settings.orientation}deg)` : undefined,
            transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="relative flex items-center justify-center shrink-0 overflow-hidden"
        >
          {loading ? (
            <div className="text-sm text-stone-300">Đang mở cuốn sách...</div>
          ) : errorMsg ? (
            <div className="max-w-md text-center p-6 rounded-xl bg-stone-900 border border-stone-700">
              <div className="text-sm font-semibold text-rose-300">Không thể đọc tệp sách</div>
              <p className="text-xs text-stone-400 mt-1.5">{errorMsg}</p>
              <button
                type="button"
                onClick={onCloseBook}
                className="mt-4 px-4 py-2 rounded-lg bg-amber-600 text-stone-950 text-xs font-semibold"
              >
                Quay lại giá sách
              </button>
            </div>
          ) : (
            /* Book Shell Container with Realistic Paper Surface & 3D Flip Layer */
            <div
              style={book.format === 'epub' ? paperBackgroundStyle : undefined}
              className={`relative w-full h-full flex items-center justify-center rounded-sm shadow-[0_14px_38px_rgba(0,0,0,0.55)] overflow-hidden ${
                book.format === 'epub'
                  ? PAPER_CLASS_MAP[settings.paperTheme]
                  : isNightTheme
                  ? 'bg-[#100e0d]'
                  : 'bg-[#ebe4d6]'
              }`}
            >
              {/* PDF Rendering Surface */}
              {book.format === 'pdf' && (
                <div
                  ref={pdfScrollRef}
                  className={`w-full h-full flex items-center justify-center ${
                    settings.smartZoomMode === 'fit-width'
                      ? 'overflow-y-auto items-start pt-2 pb-4 thin-scroll'
                      : 'overflow-hidden'
                  }`}
                >
                  <div
                    style={{
                      transform:
                        settings.smartZoomMode === 'manual'
                          ? `translate(${pdfPan.x}px, ${pdfPan.y}px)`
                          : undefined,
                    }}
                    className={`flex items-center justify-center ${
                      settings.spreadMode === 2 ? 'gap-0' : ''
                    } ${
                      settings.spreadMode === 1 && flipDirection === 'next'
                        ? 'animate-flip-single-next'
                        : settings.spreadMode === 1 && flipDirection === 'prev'
                        ? 'animate-flip-single-prev'
                        : ''
                    }`}
                  >
                    <div className="relative shadow-md">
                      <canvas
                        ref={leftCanvasRef}
                        style={pdfFilterStyle}
                        className="block rounded-l-xs"
                      />
                    </div>

                    {settings.spreadMode === 2 && (
                      <>
                        {/* Realistic Center Book Spine Crease */}
                        <div
                          className="w-3 self-stretch pointer-events-none z-10"
                          style={{
                            background:
                              'linear-gradient(90deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.06) 45%, rgba(0,0,0,0.22) 100%)',
                          }}
                        />
                        <div className="relative shadow-md">
                          {pdfPage + 1 <= pdfTotalPages ? (
                            <canvas
                              ref={rightCanvasRef}
                              style={pdfFilterStyle}
                              className="block rounded-r-xs"
                            />
                          ) : (
                            <div
                              style={{
                                width: leftCanvasRef.current?.style.width || '320px',
                                height: leftCanvasRef.current?.style.height || '440px',
                              }}
                              className="flex items-center justify-center text-xs opacity-40 bg-black/5"
                            >
                              Hết sách
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* EPUB Paginated Book Surface */}
              {book.format === 'epub' && currentChapter && (
                <div
                  className={`w-full h-full flex items-center justify-center relative ${
                    settings.spreadMode === 1 && flipDirection === 'next'
                      ? 'animate-flip-single-next'
                      : settings.spreadMode === 1 && flipDirection === 'prev'
                      ? 'animate-flip-single-prev'
                      : ''
                  }`}
                >
                  {/* Left / Single Page Viewport */}
                  <div
                    ref={epubMeasureLeftRef}
                    style={{ width: `${epubPageWidth}px`, height: `${epubPageHeight}px` }}
                    className="overflow-hidden relative"
                  >
                    <div
                      ref={epubContentLeftRef}
                      style={{
                        columnWidth: `${epubPageWidth}px`,
                        columnGap: '0px',
                        height: `${epubPageHeight}px`,
                        columnFill: 'auto',
                        transform: `translateX(-${localPage * epubPageWidth}px)`,
                        transition: 'transform 180ms ease-out',
                        fontSize: `${settings.fontSize}px`,
                        lineHeight: settings.lineHeight,
                      }}
                      className={`${epubFontClass} [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h1]:leading-snug [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-3 [&_p]:mb-3.5 [&_p]:text-justify [&_img]:max-h-[75%]`}
                    >
                      <div
                        className="px-6 sm:px-9 py-4"
                        dangerouslySetInnerHTML={{ __html: currentChapter.html }}
                      />
                    </div>
                  </div>

                  {/* Right Page in 2-Page Spread Mode */}
                  {settings.spreadMode === 2 && (
                    <>
                      <div
                        className="w-4 self-stretch pointer-events-none z-10"
                        style={{
                          background: isNightTheme
                            ? 'linear-gradient(90deg, rgba(0,0,0,0.45) 0%, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.45) 100%)'
                            : 'linear-gradient(90deg, rgba(60,40,20,0.16) 0%, rgba(255,255,255,0.2) 50%, rgba(60,40,20,0.16) 100%)',
                        }}
                      />

                      <div
                        style={{ width: `${epubPageWidth}px`, height: `${epubPageHeight}px` }}
                        className="overflow-hidden relative"
                      >
                        {localPage + 1 < chapterPages ? (
                          <div
                            style={{
                              columnWidth: `${epubPageWidth}px`,
                              columnGap: '0px',
                              height: `${epubPageHeight}px`,
                              columnFill: 'auto',
                              transform: `translateX(-${(localPage + 1) * epubPageWidth}px)`,
                              transition: 'transform 180ms ease-out',
                              fontSize: `${settings.fontSize}px`,
                              lineHeight: settings.lineHeight,
                            }}
                            className={`${epubFontClass} [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h1]:leading-snug [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-3 [&_p]:mb-3.5 [&_p]:text-justify`}
                          >
                            <div
                              className="px-6 sm:px-9 py-4"
                              dangerouslySetInnerHTML={{ __html: currentChapter.html }}
                            />
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-xs opacity-45">
                            <span>Hết chương {chapterIndex + 1}</span>
                            {chapterIndex + 1 < epubData.chapters.length && (
                              <span className="mt-1">Nhấn R1 để sang chương tiếp</span>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Realistic 3D Turning Page Leaf Overlay (for 2-Page Spread Mode) */}
              {settings.spreadMode === 2 && flipDirection && (
                <div
                  className={`absolute inset-y-0 left-1/2 w-1/2 pointer-events-none z-30 ${
                    flipDirection === 'next'
                      ? 'animate-flip-forward-leaf'
                      : 'animate-flip-backward-leaf'
                  }`}
                  style={{
                    background: isNightTheme
                      ? 'linear-gradient(90deg, rgba(34,29,24,0.92) 0%, rgba(22,19,16,0.85) 85%, rgba(0,0,0,0.4) 100%)'
                      : 'linear-gradient(90deg, rgba(246,240,226,0.96) 0%, rgba(235,224,202,0.88) 85%, rgba(190,170,140,0.45) 100%)',
                    borderLeft: isNightTheme
                      ? '1px solid rgba(255,255,255,0.08)'
                      : '1px solid rgba(120,90,60,0.18)',
                  }}
                />
              )}

              {/* Subtle Paper Edge Stack Vignette */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  boxShadow: isNightTheme
                    ? 'inset 0 0 24px rgba(0,0,0,0.45)'
                    : 'inset 0 0 22px rgba(95,70,40,0.12)',
                }}
              />
            </div>
          )}

          {/* Warm Blue-Light Eye-Care Overlay */}
          {settings.blueLightFilter > 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-40 mix-blend-multiply"
              style={{
                backgroundColor: `rgba(255, 175, 82, ${settings.blueLightFilter / 100})`,
              }}
            />
          )}
        </div>
      </div>

      {/* Minimal Scrubbing Feedback Toast when adjusting % while HUD is hidden */}
      {scrubBanner && hudHidden && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-md bg-black/75 backdrop-blur-xs border border-amber-500/40 text-xs font-mono-hud text-amber-200 shadow-lg">
          {scrubBanner}
        </div>
      )}

      {/* Minimal Always-On Clock & Battery + Slim Progress Line when HUD auto-hides */}
      {hudHidden && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-end">
          <div
            onClick={toggleHudManual}
            title="Nhấn SELECT để hiện lại thanh công cụ"
            className="pointer-events-auto cursor-pointer mr-2.5 mb-1 px-2 py-0.5 rounded bg-black/45 backdrop-blur-xs text-[10px] font-mono-hud text-stone-200 flex items-center gap-2.5"
          >
            <span className="text-amber-300/90">{progressPercent.toFixed(0)}%</span>
            <span className="flex items-center gap-1">
              {status.isCharging ? (
                <BatteryCharging className="w-2.5 h-2.5 text-emerald-400" />
              ) : (
                <Battery className="w-2.5 h-2.5 text-stone-300" />
              )}
              <span>{status.batteryLevel !== null ? `${status.batteryLevel}%` : 'Pin'}</span>
            </span>
            <span>{status.timeString}</span>
          </div>
          <div className="w-full h-[2px] bg-black/25">
            <div
              className="h-full bg-amber-500/85 transition-all duration-200"
              style={{ width: `${Math.max(1, Math.min(100, progressPercent))}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom Progress Bar + Button Hints (in flex flow so book shrinks cleanly without overlap) */}
      {!hudHidden && (
        <div className="shrink-0 z-30">
          <div className="px-4 py-1.5 bg-[#14110e]/95 border-t border-stone-800/80">
            <div className="flex items-center justify-between gap-4 text-[11px] font-mono-hud text-stone-300 mb-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-amber-300 font-semibold whitespace-nowrap">
                  {progressPercent.toFixed(1)}%
                </span>
                <span className="text-stone-500">·</span>
                <span className="truncate text-stone-300">{currentPageLabel}</span>
                {book.format === 'epub' && currentChapter && (
                  <>
                    <span className="hidden sm:inline text-stone-500">·</span>
                    <span className="hidden sm:inline truncate max-w-[260px] text-stone-400">
                      {currentChapter.title}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0 text-stone-300">
                <span className="flex items-center gap-1">
                  {status.isCharging ? (
                    <BatteryCharging className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Battery className="w-3 h-3 text-stone-400" />
                  )}
                  <span>{status.batteryLevel !== null ? `${status.batteryLevel}%` : 'Pin'}</span>
                </span>
                <span className="text-stone-100">{status.timeString}</span>
              </div>
            </div>

            <div className="w-full h-1 rounded-full bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-200"
                style={{ width: `${Math.max(1, Math.min(100, progressPercent))}%` }}
              />
            </div>
          </div>

          <ButtonHintBar hints={hints} activeBtn={activeBtn} />
        </div>
      )}

      {/* Reader Quick Settings Overlay */}
      {settingsOpen && (
        <ReaderSettingsOverlay
          bookFormat={book.format}
          bookTitle={book.title}
          currentPageDisplay={currentPageLabel}
          totalPages={book.format === 'pdf' ? pdfTotalPages : chapterPages}
          currentPageNum={book.format === 'pdf' ? pdfPage : localPage + 1}
          settings={settings}
          chapters={epubData?.chapters}
          currentChapterIndex={chapterIndex}
          onUpdateSettings={onUpdateSettings}
          onJumpToPage={
            book.format === 'pdf'
              ? (pageNum) => setPdfPage(Math.max(1, Math.min(pdfTotalPages, pageNum)))
              : undefined
          }
          onJumpToChapter={
            book.format === 'epub'
              ? (chIdx) => {
                  setChapterIndex(chIdx);
                  setLocalPage(0);
                }
              : undefined
          }
          onBackToShelf={() => {
            setSettingsOpen(false);
            onCloseBook();
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
