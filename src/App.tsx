import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookReaderView } from './components/BookReaderView';
import { BookshelfView } from './components/BookshelfView';
import { FolderManagerModal } from './components/FolderManagerModal';
import { PortMasterModal } from './components/PortMasterModal';
import { SystemStatusBar } from './components/SystemStatusBar';
import { X55HandheldShell } from './components/X55HandheldShell';
import { useSystemStatus } from './hooks/useSystemStatus';
import { useX55Input } from './hooks/useX55Input';
import { parseEpubBuffer } from './services/epubEngine';
import { extractPdfCover } from './services/pdfEngine';
import {
  deleteBook,
  deleteFolder,
  getAllBooks,
  getAllFolders,
  getBookFileBuffer,
  loadSettings,
  saveBookMeta,
  saveBookWithFile,
  saveFolder,
  saveSettings,
  seedInitialLibraryIfNeeded,
} from './services/storage';
import type {
  BookItem,
  FolderItem,
  ReaderSettings,
  ReadingLocation,
  X55Button,
} from './types/reader';
import type { NativePersistedState } from './types/x55Native';

function detectNativeHandheld(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.x55Native?.isHandheld) return true;
  const params = new URLSearchParams(window.location.search);
  return params.has('x55') || params.has('kiosk');
}

export default function App() {
  const isNativeHandheld = useMemo(() => detectNativeHandheld(), []);
  const status = useSystemStatus();
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [initializing, setInitializing] = useState(true);
  const nativeStateRef = useRef<NativePersistedState>({ booksMeta: {}, settings: {} });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shelfViewMode, setShelfViewMode] = useState<'shelf' | 'grid'>('shelf');
  const [activeBook, setActiveBook] = useState<{ book: BookItem; buffer: ArrayBuffer } | null>(
    null
  );

  const [managerModal, setManagerModal] = useState<{
    open: boolean;
    tab: 'folders' | 'import' | 'edit-book';
  }>({ open: false, tab: 'folders' });
  const [portMasterOpen, setPortMasterOpen] = useState(false);

  const persistNativeState = useCallback((nextPartial?: Partial<NativePersistedState>) => {
    const bridge = window.x55Native;
    if (!bridge) return;
    if (nextPartial) {
      nativeStateRef.current = {
        ...nativeStateRef.current,
        ...nextPartial,
      };
    }
    bridge.saveState(nativeStateRef.current).catch(() => {});
  }, []);

  const updateSettings = useCallback(
    (partial: Partial<ReaderSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        saveSettings(next);
        if (window.x55Native) {
          persistNativeState({ settings: next as unknown as Record<string, unknown> });
        }
        return next;
      });
    },
    [persistNativeState]
  );

  // Initialize IndexedDB & merge native /roms/books/ library when running on X55
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        await seedInitialLibraryIfNeeded();
        const [loadedFolders, loadedBooks] = await Promise.all([
          getAllFolders(),
          getAllBooks(),
        ]);

        let mergedFolders = [...loadedFolders];
        let mergedBooks = [...loadedBooks];

        if (window.x55Native) {
          try {
            const savedNative = await window.x55Native.loadState();
            nativeStateRef.current = {
              booksMeta: savedNative.booksMeta || {},
              settings: savedNative.settings || {},
            };
            if (savedNative.settings && Object.keys(savedNative.settings).length > 0 && mounted) {
              setSettings((prev) => {
                const restored = { ...prev, ...(savedNative.settings as Partial<ReaderSettings>) };
                saveSettings(restored);
                return restored;
              });
            }

            const scan = await window.x55Native.scanLibrary();
            if (scan.folders.length > 0) {
              const now = Date.now();
              const nativeFolders: FolderItem[] = scan.folders.map((f, idx) => ({
                id: f.id,
                name: f.name,
                createdAt: now + idx,
              }));
              // Show real SD card folders first, keep sample folders after if user wants them
              const nativeIds = new Set(nativeFolders.map((f) => f.id));
              mergedFolders = [
                ...nativeFolders,
                ...loadedFolders.filter((f) => !nativeIds.has(f.id)),
              ];
            }

            if (scan.books.length > 0) {
              const savedMeta = nativeStateRef.current.booksMeta || {};
              const nativeBooks: BookItem[] = scan.books.map((nb) => {
                const meta = savedMeta[nb.id];
                return {
                  id: nb.id,
                  title: meta?.title || nb.title,
                  author: meta?.author || nb.author,
                  format: nb.format,
                  folderId: meta?.folderId || nb.folderId,
                  fileName: nb.fileName,
                  fileSize: nb.fileSize,
                  coverDataUrl: meta?.coverDataUrl,
                  customCoverDataUrl: meta?.customCoverDataUrl,
                  pageCount: meta?.pageCount,
                  addedAt: nb.mtimeMs || Date.now(),
                  lastOpenedAt: meta?.lastOpenedAt,
                  lastLocation: meta?.lastLocation || {
                    pageIndex: nb.format === 'pdf' ? 1 : 0,
                    totalPages: 1,
                    chapterIndex: 0,
                    scrollRatio: 0,
                    percent: 0,
                    updatedAt: 0,
                  },
                  nativePath: nb.filePath,
                };
              });

              nativeBooks.sort(
                (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)
              );
              mergedBooks = [...nativeBooks, ...loadedBooks];
            }
          } catch {
            // Fall back cleanly to IndexedDB library
          }
        }

        if (!mounted) return;
        setFolders(mergedFolders);
        setBooks(mergedBooks);

        // Generate real Page-1 thumbnails or EPUB covers for books missing cover art
        for (const b of mergedBooks) {
          if (!b.coverDataUrl && !b.customCoverDataUrl) {
            const buf =
              b.nativePath && window.x55Native
                ? await window.x55Native.readBookBuffer(b.nativePath)
                : await getBookFileBuffer(b.id);
            if (!buf || !mounted) continue;
            try {
              if (b.format === 'pdf') {
                const { coverDataUrl, pageCount, title, author } = await extractPdfCover(buf);
                if (coverDataUrl && mounted) {
                  const updated: BookItem = {
                    ...b,
                    title: b.nativePath && title ? title : b.title,
                    author: b.nativePath && author ? author : b.author,
                    coverDataUrl,
                    pageCount: b.pageCount || pageCount,
                  };
                  if (b.nativePath && window.x55Native) {
                    const prevMeta = nativeStateRef.current.booksMeta || {};
                    prevMeta[b.id] = {
                      ...prevMeta[b.id],
                      title: updated.title,
                      author: updated.author,
                      coverDataUrl: updated.coverDataUrl,
                      pageCount: updated.pageCount,
                    };
                    persistNativeState({ booksMeta: prevMeta });
                  } else {
                    await saveBookMeta(updated);
                  }
                  setBooks((prev) => prev.map((item) => (item.id === b.id ? updated : item)));
                }
              } else if (b.nativePath) {
                const epubInfo = await parseEpubBuffer(buf);
                epubInfo.assetUrls.forEach((u) => URL.revokeObjectURL(u));
                if (mounted) {
                  const updated: BookItem = {
                    ...b,
                    title: epubInfo.title || b.title,
                    author: epubInfo.author || b.author,
                    coverDataUrl: epubInfo.coverDataUrl,
                    pageCount: epubInfo.chapters.length,
                  };
                  const prevMeta = nativeStateRef.current.booksMeta || {};
                  prevMeta[b.id] = {
                    ...prevMeta[b.id],
                    title: updated.title,
                    author: updated.author,
                    coverDataUrl: updated.coverDataUrl,
                    pageCount: updated.pageCount,
                  };
                  persistNativeState({ booksMeta: prevMeta });
                  setBooks((prev) => prev.map((item) => (item.id === b.id ? updated : item)));
                }
              }
            } catch {
              // Ignore thumbnail extraction failure
            }
          }
        }
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [persistNativeState]);

  const visibleBooks = useMemo(() => {
    if (settings.activeFolderId === 'all') return books;
    return books.filter((b) => b.folderId === settings.activeFolderId);
  }, [books, settings.activeFolderId]);

  // Keep selectedIndex clamped when folder or books change
  useEffect(() => {
    if (visibleBooks.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= visibleBooks.length) {
      setSelectedIndex(visibleBooks.length - 1);
    }
  }, [visibleBooks.length, selectedIndex]);

  // Highlight last read book on shelf if present in active folder
  useEffect(() => {
    if (!initializing && settings.lastBookId && visibleBooks.length > 0) {
      const idx = visibleBooks.findIndex((b) => b.id === settings.lastBookId);
      if (idx >= 0) setSelectedIndex(idx);
    }
  }, [initializing, settings.lastBookId, settings.activeFolderId]);

  const lastReadBook = useMemo(() => {
    if (settings.lastBookId) {
      const found = books.find((b) => b.id === settings.lastBookId);
      if (found) return found;
    }
    return books.find((b) => b.lastOpenedAt);
  }, [books, settings.lastBookId]);

  const handleOpenBook = useCallback(
    async (book: BookItem) => {
      const buffer =
        book.nativePath && window.x55Native
          ? await window.x55Native.readBookBuffer(book.nativePath)
          : await getBookFileBuffer(book.id);
      if (!buffer) return;
      const updatedBook: BookItem = {
        ...book,
        lastOpenedAt: Date.now(),
      };
      if (book.nativePath && window.x55Native) {
        const prevMeta = nativeStateRef.current.booksMeta || {};
        prevMeta[book.id] = {
          ...prevMeta[book.id],
          lastOpenedAt: updatedBook.lastOpenedAt,
        };
        persistNativeState({ booksMeta: prevMeta });
      } else {
        await saveBookMeta(updatedBook);
      }
      setBooks((prev) => prev.map((b) => (b.id === book.id ? updatedBook : b)));
      updateSettings({ lastBookId: book.id });
      setActiveBook({ book: updatedBook, buffer });
    },
    [persistNativeState, updateSettings]
  );

  const handleSaveLocation = useCallback(
    async (bookId: string, location: ReadingLocation, pageCount?: number) => {
      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated: BookItem = {
            ...b,
            pageCount: pageCount || b.pageCount,
            lastOpenedAt: location.updatedAt,
            lastLocation: location,
          };
          if (b.nativePath && window.x55Native) {
            const prevMeta = nativeStateRef.current.booksMeta || {};
            prevMeta[bookId] = {
              ...prevMeta[bookId],
              pageCount: updated.pageCount,
              lastOpenedAt: updated.lastOpenedAt,
              lastLocation: location,
            };
            persistNativeState({ booksMeta: prevMeta });
          } else {
            saveBookMeta(updated).catch(() => {});
          }
          return updated;
        })
      );
    },
    [persistNativeState]
  );

  const handleCycleFolder = useCallback(
    (dir: 1 | -1) => {
      const folderIds = ['all', ...folders.map((f) => f.id)];
      const curIdx = Math.max(0, folderIds.indexOf(settings.activeFolderId));
      const nextIdx = (curIdx + dir + folderIds.length) % folderIds.length;
      updateSettings({ activeFolderId: folderIds[nextIdx] });
      setSelectedIndex(0);
    },
    [folders, settings.activeFolderId, updateSettings]
  );

  // Bookshelf physical controller input (active only when not reading and no modal open)
  const handleShelfButton = useCallback(
    (btn: X55Button) => {
      if (managerModal.open || portMasterOpen) {
        if (btn === 'B') {
          setManagerModal((m) => ({ ...m, open: false }));
          setPortMasterOpen(false);
        }
        return;
      }

      switch (btn) {
        case 'RIGHT':
          if (visibleBooks.length > 0) {
            setSelectedIndex((i) => (i + 1) % visibleBooks.length);
          }
          break;
        case 'LEFT':
          if (visibleBooks.length > 0) {
            setSelectedIndex((i) => (i - 1 + visibleBooks.length) % visibleBooks.length);
          }
          break;
        case 'UP':
          if (visibleBooks.length > 0) {
            const jump = shelfViewMode === 'grid' ? 6 : 4;
            setSelectedIndex((i) => Math.max(0, i - jump));
          }
          break;
        case 'DOWN':
          if (visibleBooks.length > 0) {
            const jump = shelfViewMode === 'grid' ? 6 : 4;
            setSelectedIndex((i) => Math.min(visibleBooks.length - 1, i + jump));
          }
          break;
        case 'L1':
          handleCycleFolder(-1);
          break;
        case 'R1':
          handleCycleFolder(1);
          break;
        case 'L2':
          setShelfViewMode((m) => (m === 'shelf' ? 'grid' : 'shelf'));
          break;
        case 'A':
          if (visibleBooks[selectedIndex]) {
            handleOpenBook(visibleBooks[selectedIndex]);
          }
          break;
        case 'Y':
          if (visibleBooks[selectedIndex]) {
            setManagerModal({ open: true, tab: 'edit-book' });
          }
          break;
        case 'SELECT':
          setManagerModal({ open: true, tab: 'folders' });
          break;
        case 'START':
          setManagerModal({ open: true, tab: 'import' });
          break;
      }
    },
    [
      managerModal.open,
      portMasterOpen,
      visibleBooks,
      selectedIndex,
      shelfViewMode,
      handleCycleFolder,
      handleOpenBook,
    ]
  );

  const { activeBtn } = useX55Input({
    enabled: !activeBook && !managerModal.open && !portMasterOpen,
    orientation: 0,
    remapDpadOnRotate: false,
    onButton: handleShelfButton,
  });

  // Folder & Book CRUD Handlers
  const handleCreateFolder = async (name: string): Promise<FolderItem> => {
    const folder: FolderItem = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: Date.now(),
    };
    await saveFolder(folder);
    setFolders((prev) => [...prev, folder]);
    return folder;
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    const updated = { ...target, name };
    await saveFolder(updated);
    setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
  };

  const handleDeleteFolder = async (folderId: string) => {
    const fallbackFolder = folders.find((f) => f.id !== folderId);
    if (!fallbackFolder) return;

    // Move books out of deleted folder into fallback folder
    const affected = books.filter((b) => b.folderId === folderId);
    for (const b of affected) {
      const moved = { ...b, folderId: fallbackFolder.id };
      await saveBookMeta(moved);
    }

    await deleteFolder(folderId);
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setBooks((prev) =>
      prev.map((b) => (b.folderId === folderId ? { ...b, folderId: fallbackFolder.id } : b))
    );
    if (settings.activeFolderId === folderId) {
      updateSettings({ activeFolderId: 'all' });
    }
  };

  const handleImportBooks = async (
    items: Array<{ book: BookItem; buffer: ArrayBuffer }>
  ) => {
    for (const item of items) {
      await saveBookWithFile(item.book, item.buffer);
    }
    setBooks((prev) => [...items.map((i) => i.book), ...prev]);
    setSelectedIndex(0);
  };

  const handleUpdateBook = async (updated: BookItem) => {
    if (updated.nativePath && window.x55Native) {
      const prevMeta = nativeStateRef.current.booksMeta || {};
      prevMeta[updated.id] = {
        ...prevMeta[updated.id],
        title: updated.title,
        author: updated.author,
        folderId: updated.folderId,
        customCoverDataUrl: updated.customCoverDataUrl,
      };
      persistNativeState({ booksMeta: prevMeta });
    } else {
      await saveBookMeta(updated);
    }
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  const handleDeleteBook = async (bookId: string) => {
    await deleteBook(bookId);
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    if (settings.lastBookId === bookId) {
      updateSettings({ lastBookId: undefined });
    }
  };

  const showSimulatedShell = !isNativeHandheld && settings.x55FrameMode;

  const screenContent = (
    <div className="relative w-full h-full flex flex-col overflow-hidden bg-[#15120f]">
      {/* Top Handheld System Status Bar */}
      {!activeBook && (
        <SystemStatusBar
          status={status}
          title="X55 Folio"
          x55FrameMode={showSimulatedShell}
          isNativeHandheld={isNativeHandheld}
          onToggleX55Frame={() =>
            updateSettings({ x55FrameMode: !settings.x55FrameMode })
          }
          onOpenPortMaster={() => setPortMasterOpen(true)}
          onQuitApp={window.x55Native ? () => window.x55Native?.quitApp() : undefined}
        />
      )}

      {initializing ? (
        <div className="flex-1 flex items-center justify-center text-sm text-stone-300">
          Đang nạp thư viện sách offline...
        </div>
      ) : activeBook ? (
        <BookReaderView
          book={activeBook.book}
          buffer={activeBook.buffer}
          settings={settings}
          status={status}
          onUpdateSettings={updateSettings}
          onSaveLocation={handleSaveLocation}
          onCloseBook={() => setActiveBook(null)}
        />
      ) : (
        <BookshelfView
          books={visibleBooks}
          folders={folders}
          activeFolderId={settings.activeFolderId}
          selectedIndex={selectedIndex}
          lastBook={lastReadBook}
          activeBtn={activeBtn}
          viewMode={shelfViewMode}
          onToggleViewMode={() =>
            setShelfViewMode((m) => (m === 'shelf' ? 'grid' : 'shelf'))
          }
          onSelectFolder={(folderId) => {
            updateSettings({ activeFolderId: folderId });
            setSelectedIndex(0);
          }}
          onSelectBookIndex={setSelectedIndex}
          onOpenBook={handleOpenBook}
          onOpenManager={(tab = 'folders') => setManagerModal({ open: true, tab })}
          onCycleFolder={handleCycleFolder}
        />
      )}

      {/* Folder & Book Library Manager */}
      {managerModal.open && (
        <FolderManagerModal
          initialTab={managerModal.tab}
          folders={folders}
          books={books}
          activeFolderId={settings.activeFolderId}
          selectedBook={visibleBooks[selectedIndex]}
          onClose={() => setManagerModal((m) => ({ ...m, open: false }))}
          onSelectActiveFolder={(folderId) => {
            updateSettings({ activeFolderId: folderId });
            setSelectedIndex(0);
          }}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onImportBooks={handleImportBooks}
          onUpdateBook={handleUpdateBook}
          onDeleteBook={handleDeleteBook}
        />
      )}

      {/* ROCKNIX / PortMaster Export & Controller Guide */}
      {portMasterOpen && <PortMasterModal onClose={() => setPortMasterOpen(false)} />}
    </div>
  );

  return (
    <div className="w-screen h-screen overflow-hidden flex items-center justify-center bg-[#0b0a09]">
      {showSimulatedShell ? (
        <X55HandheldShell
          onExitShell={() => updateSettings({ x55FrameMode: false })}
        >
          {screenContent}
        </X55HandheldShell>
      ) : (
        screenContent
      )}
    </div>
  );
}
