import {
  Check,
  Folder,
  FolderInput,
  FolderPlus,
  ImagePlus,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useX55Input } from '../hooks/useX55Input';
import { parseEpubBuffer } from '../services/epubEngine';
import { extractPdfCover } from '../services/pdfEngine';
import type { BookItem, FolderItem, X55Button } from '../types/reader';
import { ButtonHintBar, type ButtonHintItem } from './ButtonHintBar';

interface FolderManagerModalProps {
  initialTab: 'folders' | 'import' | 'edit-book';
  folders: FolderItem[];
  books: BookItem[];
  activeFolderId: string;
  selectedBook?: BookItem;
  onClose: () => void;
  onSelectActiveFolder: (folderId: string) => void;
  onCreateFolder: (name: string) => Promise<FolderItem>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onImportBooks: (
    items: Array<{
      book: BookItem;
      buffer: ArrayBuffer;
    }>
  ) => Promise<void>;
  onUpdateBook: (book: BookItem) => Promise<void>;
  onDeleteBook: (bookId: string) => Promise<void>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function stripExt(name: string): string {
  return name.replace(/\.(pdf|epub)$/i, '');
}

const TABS: Array<'folders' | 'import' | 'edit-book'> = ['folders', 'import', 'edit-book'];

export function FolderManagerModal({
  initialTab,
  folders,
  books,
  activeFolderId,
  selectedBook,
  onClose,
  onSelectActiveFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onImportBooks,
  onUpdateBook,
  onDeleteBook,
}: FolderManagerModalProps) {
  const [tab, setTab] = useState<'folders' | 'import' | 'edit-book'>(initialTab);
  const [focusIdx, setFocusIdx] = useState(0);

  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [importTargetFolderId, setImportTargetFolderId] = useState<string>(
    activeFolderId !== 'all' ? activeFolderId : folders[0]?.id || 'default'
  );
  const [importProgress, setImportProgress] = useState<string | null>(null);

  // Edit Book state
  const [editBookId, setEditBookId] = useState<string>(selectedBook?.id || books[0]?.id || '');
  const currentEditBook = books.find((b) => b.id === editBookId) || selectedBook;
  const [bookTitle, setBookTitle] = useState(currentEditBook?.title || '');
  const [bookAuthor, setBookAuthor] = useState(currentEditBook?.author || '');
  const [bookFolderId, setBookFolderId] = useState(
    currentEditBook?.folderId || folders[0]?.id || ''
  );
  const [bookCustomCover, setBookCustomCover] = useState<string | undefined>(
    currentEditBook?.customCoverDataUrl
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const authorInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  // Ordered focusable item keys per tab for 100% X55 physical button navigation
  const focusKeys = useMemo<string[]>(() => {
    if (tab === 'folders') {
      return ['create-folder', 'folder:all', ...folders.map((f) => `folder:${f.id}`)];
    }
    if (tab === 'import') {
      return ['import-target', 'import-files', 'import-dir'];
    }
    if (!currentEditBook) return [];
    return [
      'edit-select-book',
      'edit-cover',
      'edit-title',
      'edit-author',
      'edit-folder',
      'edit-save',
      'edit-delete',
    ];
  }, [tab, folders, currentEditBook]);

  const clampedFocusIdx = Math.min(focusIdx, Math.max(0, focusKeys.length - 1));
  const focusedKey = focusKeys[clampedFocusIdx] || '';

  useEffect(() => {
    setFocusIdx(0);
  }, [tab]);

  useEffect(() => {
    const el = rowRefs.current[focusedKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedKey]);

  const syncEditBookSelection = useCallback(
    (bookId: string) => {
      setEditBookId(bookId);
      const found = books.find((b) => b.id === bookId);
      if (found) {
        setBookTitle(found.title);
        setBookAuthor(found.author);
        setBookFolderId(found.folderId);
        setBookCustomCover(found.customCoverDataUrl);
      }
    },
    [books]
  );

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim() || `Thư mục ${folders.length + 1}`;
    const created = await onCreateFolder(trimmed);
    setNewFolderName('');
    setImportTargetFolderId(created.id);
  };

  const processImportedFiles = async (fileList: FileList | File[], folderNameOverride?: string) => {
    const validFiles = Array.from(fileList).filter((f) => /\.(pdf|epub)$/i.test(f.name));
    if (validFiles.length === 0) {
      setImportProgress('Không tìm thấy tệp .pdf hoặc .epub nào.');
      return;
    }

    let targetFolderId = importTargetFolderId;
    if (folderNameOverride) {
      const existing = folders.find(
        (f) => f.name.toLowerCase() === folderNameOverride.toLowerCase()
      );
      if (existing) {
        targetFolderId = existing.id;
      } else {
        const created = await onCreateFolder(folderNameOverride);
        targetFolderId = created.id;
      }
    }

    const imported: Array<{ book: BookItem; buffer: ArrayBuffer }> = [];

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setImportProgress(`Đang xử lý (${i + 1}/${validFiles.length}): ${file.name}...`);
      const buffer = await file.arrayBuffer();
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const now = Date.now();

      let title = stripExt(file.name);
      let author = 'Chưa rõ tác giả';
      let coverDataUrl: string | undefined;
      let pageCount: number | undefined;

      try {
        if (isPdf) {
          const pdfInfo = await extractPdfCover(buffer);
          if (pdfInfo.title) title = pdfInfo.title;
          if (pdfInfo.author) author = pdfInfo.author;
          coverDataUrl = pdfInfo.coverDataUrl;
          pageCount = pdfInfo.pageCount;
        } else {
          const epubInfo = await parseEpubBuffer(buffer);
          epubInfo.assetUrls.forEach((u) => URL.revokeObjectURL(u));
          if (epubInfo.title) title = epubInfo.title;
          if (epubInfo.author) author = epubInfo.author;
          coverDataUrl = epubInfo.coverDataUrl;
          pageCount = epubInfo.chapters.length;
        }
      } catch {
        // Keep filename fallback
      }

      imported.push({
        book: {
          id: `book-${now}-${Math.random().toString(36).slice(2, 7)}`,
          title,
          author,
          format: isPdf ? 'pdf' : 'epub',
          folderId: targetFolderId,
          fileName: file.name,
          fileSize: file.size,
          coverDataUrl,
          pageCount,
          addedAt: now,
          lastLocation: {
            pageIndex: isPdf ? 1 : 0,
            totalPages: pageCount || 1,
            chapterIndex: 0,
            scrollRatio: 0,
            percent: 0,
            updatedAt: now,
          },
        },
        buffer,
      });
    }

    await onImportBooks(imported);
    onSelectActiveFolder(targetFolderId);
    setImportProgress(`Đã thêm thành công ${imported.length} cuốn sách offline!`);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processImportedFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDirChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const firstPath = files[0].webkitRelativePath || '';
    const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'Thư mục nhập';
    await processImportedFiles(files, folderName);
    e.target.value = '';
  };

  const handleCoverUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setBookCustomCover(dataUrl);
    e.target.value = '';
  };

  const handleSaveBookEdit = useCallback(async () => {
    if (!currentEditBook) return;
    await onUpdateBook({
      ...currentEditBook,
      title: bookTitle.trim() || currentEditBook.title,
      author: bookAuthor.trim() || 'Khuyết danh',
      folderId: bookFolderId,
      customCoverDataUrl: bookCustomCover,
    });
    setSavedNotice('Đã lưu thông tin & ảnh bìa sách.');
    window.setTimeout(() => setSavedNotice(null), 2200);
  }, [currentEditBook, bookTitle, bookAuthor, bookFolderId, bookCustomCover, onUpdateBook]);

  const handlePhysicalButton = useCallback(
    (btn: X55Button) => {
      switch (btn) {
        case 'L1': {
          const idx = TABS.indexOf(tab);
          setTab(TABS[(idx - 1 + TABS.length) % TABS.length]);
          break;
        }
        case 'R1': {
          const idx = TABS.indexOf(tab);
          setTab(TABS[(idx + 1) % TABS.length]);
          break;
        }
        case 'UP':
          if (focusKeys.length > 0) {
            setFocusIdx((i) => (i - 1 + focusKeys.length) % focusKeys.length);
          }
          break;
        case 'DOWN':
          if (focusKeys.length > 0) {
            setFocusIdx((i) => (i + 1) % focusKeys.length);
          }
          break;
        case 'LEFT':
        case 'RIGHT': {
          const dir = btn === 'RIGHT' ? 1 : -1;
          if (focusedKey === 'import-target' && folders.length > 0) {
            const idx = Math.max(0, folders.findIndex((f) => f.id === importTargetFolderId));
            setImportTargetFolderId(folders[(idx + dir + folders.length) % folders.length].id);
          } else if (focusedKey === 'edit-select-book' && books.length > 0) {
            const idx = Math.max(0, books.findIndex((b) => b.id === currentEditBook?.id));
            syncEditBookSelection(books[(idx + dir + books.length) % books.length].id);
          } else if (focusedKey === 'edit-folder' && folders.length > 0) {
            const idx = Math.max(0, folders.findIndex((f) => f.id === bookFolderId));
            setBookFolderId(folders[(idx + dir + folders.length) % folders.length].id);
          }
          break;
        }
        case 'A':
          if (focusedKey === 'create-folder') {
            if (newFolderName.trim()) {
              handleCreateFolder();
            } else {
              newFolderInputRef.current?.focus();
            }
          } else if (focusedKey === 'folder:all') {
            onSelectActiveFolder('all');
            onClose();
          } else if (focusedKey.startsWith('folder:')) {
            const fid = focusedKey.slice('folder:'.length);
            onSelectActiveFolder(fid);
            onClose();
          } else if (focusedKey === 'import-files') {
            fileInputRef.current?.click();
          } else if (focusedKey === 'import-dir') {
            dirInputRef.current?.click();
          } else if (focusedKey === 'edit-cover') {
            coverInputRef.current?.click();
          } else if (focusedKey === 'edit-title') {
            titleInputRef.current?.focus();
          } else if (focusedKey === 'edit-author') {
            authorInputRef.current?.focus();
          } else if (focusedKey === 'edit-save') {
            handleSaveBookEdit();
          } else if (focusedKey === 'edit-delete' && currentEditBook) {
            onDeleteBook(currentEditBook.id).then(() => onClose());
          }
          break;
        case 'X':
          if (focusedKey.startsWith('folder:') && focusedKey !== 'folder:all') {
            const fid = focusedKey.slice('folder:'.length);
            const target = folders.find((f) => f.id === fid);
            if (target) {
              setEditingFolderId(fid);
              setEditingFolderName(target.name);
            }
          } else if (focusedKey === 'edit-cover') {
            setBookCustomCover(undefined);
          }
          break;
        case 'Y':
          if (focusedKey.startsWith('folder:') && focusedKey !== 'folder:all' && folders.length > 1) {
            const fid = focusedKey.slice('folder:'.length);
            onDeleteFolder(fid);
          }
          break;
        case 'B':
        case 'START':
        case 'SELECT':
          onClose();
          break;
      }
    },
    [
      tab,
      focusKeys,
      focusedKey,
      folders,
      books,
      importTargetFolderId,
      currentEditBook,
      bookFolderId,
      newFolderName,
      syncEditBookSelection,
      onSelectActiveFolder,
      onClose,
      handleSaveBookEdit,
      onDeleteBook,
      onDeleteFolder,
    ]
  );

  const { activeBtn } = useX55Input({
    enabled: true,
    orientation: 0,
    remapDpadOnRotate: false,
    onButton: handlePhysicalButton,
  });

  const ringClass = (key: string) =>
    focusedKey === key ? 'ring-2 ring-amber-400 bg-stone-800/80' : '';

  const hints: ButtonHintItem[] = [
    { button: 'L1', label: 'Tab trước', onClick: () => handlePhysicalButton('L1') },
    { button: 'R1', label: 'Tab sau', onClick: () => handlePhysicalButton('R1') },
    { button: 'UP', label: 'Lên', onClick: () => handlePhysicalButton('UP') },
    { button: 'DOWN', label: 'Xuống', onClick: () => handlePhysicalButton('DOWN') },
    { button: 'A', label: 'Chọn / Thực hiện', onClick: () => handlePhysicalButton('A') },
    ...(tab === 'folders'
      ? [
          { button: 'X' as X55Button, label: 'Đổi tên', onClick: () => handlePhysicalButton('X') },
          { button: 'Y' as X55Button, label: 'Xóa', onClick: () => handlePhysicalButton('Y') },
        ]
      : [
          {
            button: 'LEFT' as X55Button,
            label: 'Đổi mục',
            onClick: () => handlePhysicalButton('LEFT'),
          },
          {
            button: 'RIGHT' as X55Button,
            label: 'Đổi mục',
            onClick: () => handlePhysicalButton('RIGHT'),
          },
        ]),
    { button: 'B', label: 'Đóng', onClick: onClose },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2.5 sm:p-4">
      <div className="w-full max-w-3xl max-h-[94%] flex flex-col rounded-xl bg-[#1a1612] border border-stone-700/80 text-stone-100 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-[#15120e] shrink-0">
          <h2 className="text-sm sm:text-base font-semibold text-amber-100">
            Quản Lý Thư Viện
          </h2>

          <div className="flex items-center gap-1 bg-stone-900 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('folders')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                tab === 'folders'
                  ? 'bg-amber-600 text-stone-950 font-semibold'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              Thư mục
            </button>
            <button
              type="button"
              onClick={() => setTab('import')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                tab === 'import'
                  ? 'bg-amber-600 text-stone-950 font-semibold'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              Thêm EPUB / PDF
            </button>
            <button
              type="button"
              onClick={() => setTab('edit-book')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                tab === 'edit-book'
                  ? 'bg-amber-600 text-stone-950 font-semibold'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              Ảnh bìa & Tệp
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 thin-scroll">
          {tab === 'folders' && (
            <div className="space-y-3.5">
              <div
                ref={(el) => {
                  rowRefs.current['create-folder'] = el;
                }}
                onClick={() => setFocusIdx(0)}
                className={`flex flex-col sm:flex-row gap-2 p-1.5 rounded-xl transition-all ${ringClass(
                  'create-folder'
                )}`}
              >
                <input
                  ref={newFolderInputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="Tên thư mục mới (hoặc nhấn A để tạo nhanh)..."
                  className="flex-1 px-3 py-1.5 rounded-lg bg-stone-900 border border-stone-700 text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Tạo thư mục</span>
                </button>
              </div>

              <div className="divide-y divide-stone-800/80 border border-stone-800 rounded-xl overflow-hidden bg-[#14110e]">
                <div
                  ref={(el) => {
                    rowRefs.current['folder:all'] = el;
                  }}
                  onClick={() => {
                    onSelectActiveFolder('all');
                    onClose();
                  }}
                  className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${ringClass(
                    'folder:all'
                  )}`}
                >
                  <div className="flex items-center gap-3">
                    <Folder className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="text-xs font-medium text-stone-100">Tất cả sách</div>
                      <div className="text-[11px] text-stone-500 font-mono-hud">
                        {books.length} cuốn
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-medium ${
                      activeFolderId === 'all'
                        ? 'bg-amber-600 text-stone-950 font-semibold'
                        : 'bg-stone-800 text-stone-300'
                    }`}
                  >
                    {activeFolderId === 'all' ? 'Đang hiển thị' : 'Hiển thị (A)'}
                  </span>
                </div>

                {folders.map((folder) => {
                  const count = books.filter((b) => b.folderId === folder.id).length;
                  const isEditing = editingFolderId === folder.id;
                  const isActive = activeFolderId === folder.id;
                  const key = `folder:${folder.id}`;

                  return (
                    <div
                      key={folder.id}
                      ref={(el) => {
                        rowRefs.current[key] = el;
                      }}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${ringClass(
                        key
                      )}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                        {isEditing ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={editingFolderName}
                              onChange={(e) => setEditingFolderName(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter' && editingFolderName.trim()) {
                                  await onRenameFolder(folder.id, editingFolderName.trim());
                                  setEditingFolderId(null);
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-stone-900 border border-amber-500 text-xs text-white flex-1"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (editingFolderName.trim()) {
                                  await onRenameFolder(folder.id, editingFolderName.trim());
                                }
                                setEditingFolderId(null);
                              }}
                              className="p-1.5 rounded bg-emerald-700 text-white"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="min-w-0 cursor-pointer flex-1"
                            onClick={() => {
                              onSelectActiveFolder(folder.id);
                              onClose();
                            }}
                          >
                            <div className="text-xs font-medium text-stone-100 truncate">
                              {folder.name}
                            </div>
                            <div className="text-[11px] text-stone-500 font-mono-hud">
                              {count} cuốn
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFolderId(folder.id);
                            setEditingFolderName(folder.name);
                          }}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
                          title="Đổi tên (Phím X)"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {folders.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onDeleteFolder(folder.id)}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-400 hover:bg-stone-800"
                            title="Xóa thư mục (Phím Y)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            onSelectActiveFolder(folder.id);
                            onClose();
                          }}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            isActive
                              ? 'bg-amber-600 text-stone-950 font-semibold'
                              : 'bg-stone-800 text-stone-200 hover:bg-stone-700'
                          }`}
                        >
                          {isActive ? 'Đang hiển thị' : 'Mở (A)'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-4">
              <div
                ref={(el) => {
                  rowRefs.current['import-target'] = el;
                }}
                onClick={() => setFocusIdx(0)}
                className={`p-3 rounded-xl border border-stone-800 bg-stone-900/60 flex items-center justify-between gap-3 ${ringClass(
                  'import-target'
                )}`}
              >
                <span className="text-xs font-medium text-stone-300">
                  Lưu vào thư mục (◀ ▶ để đổi):
                </span>
                <select
                  value={importTargetFolderId}
                  onChange={(e) => setImportTargetFolderId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-stone-900 border border-stone-700 text-xs text-amber-200"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  ref={(el) => {
                    rowRefs.current['import-files'] = el;
                  }}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-stone-600 hover:border-amber-400 bg-stone-900/60 transition-all text-center ${ringClass(
                    'import-files'
                  )}`}
                >
                  <Upload className="w-6 h-6 text-amber-400" />
                  <div>
                    <div className="text-xs font-semibold text-stone-100">
                      Chọn tệp EPUB / PDF lẻ (Nhấn A)
                    </div>
                    <div className="text-[11px] text-stone-400 mt-1">
                      Chọn nhiều tệp cùng lúc, lưu offline 100%
                    </div>
                  </div>
                </button>

                <button
                  ref={(el) => {
                    rowRefs.current['import-dir'] = el;
                  }}
                  type="button"
                  onClick={() => dirInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-stone-600 hover:border-amber-400 bg-stone-900/60 transition-all text-center ${ringClass(
                    'import-dir'
                  )}`}
                >
                  <FolderInput className="w-6 h-6 text-amber-400" />
                  <div>
                    <div className="text-xs font-semibold text-stone-100">
                      Chọn cả thư mục từ thẻ nhớ (Nhấn A)
                    </div>
                    <div className="text-[11px] text-stone-400 mt-1">
                      Tự quét toàn bộ PDF & EPUB trong thư mục
                    </div>
                  </div>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.epub,application/pdf,application/epub+zip"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              <input
                ref={dirInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is standard in Chromium/ROCKNIX browsers
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={handleDirChange}
              />

              {importProgress && (
                <div className="px-4 py-2.5 rounded-lg bg-amber-950/40 border border-amber-700/50 text-xs text-amber-200">
                  {importProgress}
                </div>
              )}
            </div>
          )}

          {tab === 'edit-book' && (
            <div className="space-y-3">
              {books.length === 0 ? (
                <p className="text-sm text-stone-400">Chưa có sách nào trong thư viện.</p>
              ) : (
                <>
                  <div
                    ref={(el) => {
                      rowRefs.current['edit-select-book'] = el;
                    }}
                    onClick={() => setFocusIdx(0)}
                    className={`p-2 rounded-xl border border-stone-800 ${ringClass(
                      'edit-select-book'
                    )}`}
                  >
                    <label className="block text-[11px] text-stone-400 mb-1">
                      Chọn sách (◀ ▶ để đổi nhanh):
                    </label>
                    <select
                      value={currentEditBook?.id || ''}
                      onChange={(e) => syncEditBookSelection(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-stone-900 border border-stone-700 text-xs text-stone-100"
                    >
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          [{b.format.toUpperCase()}] {b.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {currentEditBook && (
                    <div className="grid grid-cols-1 sm:grid-cols-[135px_1fr] gap-4 pt-1">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-[115px] aspect-[3/4] rounded-md overflow-hidden bg-stone-900 border border-stone-700">
                          {bookCustomCover || currentEditBook.coverDataUrl ? (
                            <img
                              src={bookCustomCover || currentEditBook.coverDataUrl}
                              alt={bookTitle}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-stone-500 px-2 text-center">
                              Chưa có bìa
                            </div>
                          )}
                        </div>
                        <button
                          ref={(el) => {
                            rowRefs.current['edit-cover'] = el;
                          }}
                          type="button"
                          onClick={() => coverInputRef.current?.click()}
                          className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs text-stone-200 transition-colors ${ringClass(
                            'edit-cover'
                          )}`}
                        >
                          <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                          <span>Đổi bìa (A)</span>
                        </button>
                        <input
                          ref={coverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleCoverUpload}
                        />
                      </div>

                      <div className="space-y-2.5">
                        <div
                          ref={(el) => {
                            rowRefs.current['edit-title'] = el;
                          }}
                          className={`p-1.5 rounded-lg ${ringClass('edit-title')}`}
                        >
                          <label className="block text-[11px] text-stone-400 mb-0.5">Tên sách</label>
                          <input
                            ref={titleInputRef}
                            type="text"
                            value={bookTitle}
                            onChange={(e) => setBookTitle(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded bg-stone-900 border border-stone-700 text-xs text-white"
                          />
                        </div>

                        <div
                          ref={(el) => {
                            rowRefs.current['edit-author'] = el;
                          }}
                          className={`p-1.5 rounded-lg ${ringClass('edit-author')}`}
                        >
                          <label className="block text-[11px] text-stone-400 mb-0.5">Tác giả</label>
                          <input
                            ref={authorInputRef}
                            type="text"
                            value={bookAuthor}
                            onChange={(e) => setBookAuthor(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded bg-stone-900 border border-stone-700 text-xs text-white"
                          />
                        </div>

                        <div
                          ref={(el) => {
                            rowRefs.current['edit-folder'] = el;
                          }}
                          className={`p-1.5 rounded-lg ${ringClass('edit-folder')}`}
                        >
                          <label className="block text-[11px] text-stone-400 mb-0.5">
                            Thư mục (◀ ▶ để chuyển)
                          </label>
                          <select
                            value={bookFolderId}
                            onChange={(e) => setBookFolderId(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded bg-stone-900 border border-stone-700 text-xs text-white"
                          >
                            {folders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between pt-1 gap-2">
                          <button
                            ref={(el) => {
                              rowRefs.current['edit-delete'] = el;
                            }}
                            type="button"
                            onClick={async () => {
                              await onDeleteBook(currentEditBook.id);
                              onClose();
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-950/40 ${ringClass(
                              'edit-delete'
                            )}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa sách</span>
                          </button>

                          <button
                            ref={(el) => {
                              rowRefs.current['edit-save'] = el;
                            }}
                            type="button"
                            onClick={handleSaveBookEdit}
                            className={`px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold ${
                              focusedKey === 'edit-save' ? 'ring-2 ring-white' : ''
                            }`}
                          >
                            Lưu thay đổi (A)
                          </button>
                        </div>

                        {savedNotice && <div className="text-xs text-emerald-400">{savedNotice}</div>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <ButtonHintBar hints={hints} activeBtn={activeBtn} />
      </div>
    </div>
  );
}
