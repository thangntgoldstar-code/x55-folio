import {
  BookOpen,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  LayoutGrid,
  Play,
  Plus,
  Rows3,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { BookItem, FolderItem, X55Button } from '../types/reader';
import { ButtonHintBar, type ButtonHintItem } from './ButtonHintBar';

interface BookshelfViewProps {
  books: BookItem[];
  folders: FolderItem[];
  activeFolderId: string;
  selectedIndex: number;
  lastBook?: BookItem;
  activeBtn: X55Button | null;
  viewMode: 'shelf' | 'grid';
  onToggleViewMode: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectBookIndex: (index: number) => void;
  onOpenBook: (book: BookItem) => void;
  onOpenManager: (tab?: 'folders' | 'import' | 'edit-book') => void;
  onCycleFolder: (dir: 1 | -1) => void;
}

export function BookshelfView({
  books,
  folders,
  activeFolderId,
  selectedIndex,
  lastBook,
  activeBtn,
  viewMode,
  onToggleViewMode,
  onSelectFolder,
  onSelectBookIndex,
  onOpenBook,
  onOpenManager,
  onCycleFolder,
}: BookshelfViewProps) {
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shelfContainerRef = useRef<HTMLDivElement | null>(null);

  const selectedBook = books[selectedIndex];

  // Smooth gliding focus scroll when navigating shelf with physical D-Pad
  useEffect(() => {
    const el = cardRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [selectedIndex, activeFolderId, viewMode]);

  const hints: ButtonHintItem[] = [
    { button: 'DPAD', label: 'Lướt chọn sách' },
    {
      button: 'A',
      label: 'Mở sách',
      keyHint: 'Enter',
      onClick: () => selectedBook && onOpenBook(selectedBook),
    },
    {
      button: 'L1',
      label: 'Thư mục trước',
      keyHint: 'Q',
      onClick: () => onCycleFolder(-1),
    },
    {
      button: 'R1',
      label: 'Thư mục sau',
      keyHint: 'E',
      onClick: () => onCycleFolder(1),
    },
    {
      button: 'L2',
      label: viewMode === 'shelf' ? 'Dạng lưới' : 'Dạng kệ',
      keyHint: '1',
      onClick: onToggleViewMode,
    },
    {
      button: 'Y',
      label: 'Đổi ảnh bìa / Sửa',
      keyHint: 'V',
      onClick: () => selectedBook && onOpenManager('edit-book'),
    },
    {
      button: 'SELECT',
      label: 'Thư mục',
      keyHint: 'Tab',
      onClick: () => onOpenManager('folders'),
    },
    {
      button: 'START',
      label: 'Thêm sách',
      keyHint: 'M',
      onClick: () => onOpenManager('import'),
    },
  ];

  const activeFolderName =
    activeFolderId === 'all'
      ? 'Tất cả sách'
      : folders.find((f) => f.id === activeFolderId)?.name || 'Thư mục';

  const renderBookCard = (book: BookItem, idx: number, compact = false) => {
    const isSelected = idx === selectedIndex;
    const coverSrc = book.customCoverDataUrl || book.coverDataUrl;
    const pct = Math.round(book.lastLocation.percent || 0);

    return (
      <button
        key={book.id}
        ref={(el) => {
          cardRefs.current[idx] = el;
        }}
        type="button"
        onClick={() => {
          if (isSelected) {
            onOpenBook(book);
          } else {
            onSelectBookIndex(idx);
          }
        }}
        onDoubleClick={() => onOpenBook(book)}
        className={`group relative flex flex-col items-start text-left origin-bottom transition-all duration-200 ease-out focus:outline-none ${
          compact ? 'w-full' : 'snap-center shrink-0 w-[128px] sm:w-[144px]'
        } ${
          isSelected
            ? 'scale-[1.06] -translate-y-1.5 z-10'
            : 'opacity-85 hover:opacity-100 hover:-translate-y-0.5'
        }`}
      >
        {/* Physical Book Cover Frame with Spine Illusion */}
        <div
          className={`relative w-full aspect-[3/4] rounded-r-md rounded-l-xs overflow-hidden transition-shadow duration-200 ${
            isSelected
              ? 'ring-2 ring-amber-400 shadow-[0_14px_28px_rgba(0,0,0,0.78)]'
              : 'ring-1 ring-stone-700/70 shadow-[0_8px_18px_rgba(0,0,0,0.55)]'
          }`}
        >
          {/* Book Spine Crease Highlight */}
          <div
            className="absolute inset-y-0 left-0 w-2.5 z-10 pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(255,255,255,0.12) 45%, rgba(0,0,0,0.18) 85%, transparent 100%)',
            }}
          />

          {coverSrc ? (
            <img
              src={coverSrc}
              alt={book.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover bg-stone-900"
            />
          ) : (
            <div
              className={`w-full h-full flex flex-col justify-between p-3 ${
                book.format === 'pdf'
                  ? 'bg-gradient-to-br from-[#2b303a] via-[#1f232b] to-[#15181e]'
                  : 'bg-gradient-to-br from-[#342a22] via-[#261f19] to-[#191410]'
              }`}
            >
              <span className="text-[10px] font-mono-hud uppercase tracking-wider text-amber-300/80 pl-1.5">
                {book.format}
              </span>
              <div className="pl-1.5">
                <div className="font-serif-book text-xs font-semibold text-stone-100 line-clamp-3 leading-snug">
                  {book.title}
                </div>
                <div className="text-[10px] text-stone-400 mt-1 truncate">{book.author}</div>
              </div>
            </div>
          )}

          {/* Subtle Reading Progress Bar on Bottom Edge of Cover */}
          {pct > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60 z-20">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
              />
            </div>
          )}
        </div>

        {/* Book Title & Author Below Cover */}
        <div className="w-full mt-2 px-0.5">
          <div
            className={`text-xs font-semibold leading-snug line-clamp-2 ${
              isSelected ? 'text-amber-100' : 'text-stone-200'
            }`}
          >
            {book.title}
          </div>
          <div className="text-[11px] text-stone-400 truncate mt-0.5">{book.author}</div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono-hud text-stone-500 mt-0.5">
            <span className={isSelected ? 'text-amber-400' : 'text-stone-400'}>
              {book.format.toUpperCase()}
            </span>
            <span aria-hidden="true">·</span>
            <span>{pct > 0 ? `${pct}%` : 'Mới'}</span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gradient-to-b from-[#1a1612] via-[#15120f] to-[#100d0b] text-stone-100">
      {/* Folder Shelf Selector & Resume Spotlight */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-stone-800/70 bg-[#181410]/85 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto thin-scroll pr-2">
          <button
            type="button"
            onClick={() => onSelectFolder('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeFolderId === 'all'
                ? 'bg-amber-600 text-stone-950 font-semibold shadow-sm'
                : 'bg-stone-800/70 text-stone-300 hover:bg-stone-800 hover:text-stone-100'
            }`}
          >
            Tất cả sách
          </button>

          {folders.map((folder) => {
            const isActive = activeFolderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-amber-600 text-stone-950 font-semibold shadow-sm'
                    : 'bg-stone-800/70 text-stone-300 hover:bg-stone-800 hover:text-stone-100'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 opacity-80" />
                <span>{folder.name}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onOpenManager('folders')}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-amber-300/90 hover:text-amber-200 hover:bg-stone-800/80 transition-colors whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Thư mục</span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastBook && (
            <button
              type="button"
              onClick={() => onOpenBook(lastBook)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800/90 hover:bg-stone-700 border border-stone-700/80 text-xs text-stone-200 transition-colors whitespace-nowrap shrink-0"
              title={`Đọc tiếp: ${lastBook.title}`}
            >
              <Play className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span className="max-w-[140px] truncate">{lastBook.title}</span>
              <span className="font-mono-hud text-amber-300">
                {Math.round(lastBook.lastLocation.percent)}%
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleViewMode}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-800/80 hover:bg-stone-700 text-stone-200 text-xs transition-colors whitespace-nowrap shrink-0"
            title="Chuyển dạng kệ ngang / dạng lưới (Phím L2)"
          >
            {viewMode === 'shelf' ? (
              <LayoutGrid className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <Rows3 className="w-3.5 h-3.5 text-amber-300" />
            )}
            <span className="hidden sm:inline">{viewMode === 'shelf' ? 'Kệ ngang' : 'Lưới sách'}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenManager('import')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm sách</span>
          </button>
        </div>
      </div>

      {/* Main Bookshelf Area */}
      <div className="flex-1 min-h-0 flex flex-col justify-between px-4 py-2.5 overflow-hidden">
        {/* Focused Book Editorial Summary Strip */}
        <div className="flex items-end justify-between gap-4 pb-2 border-b border-stone-800/50 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <span>{activeFolderName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-hud">
                {books.length > 0
                  ? `Cuốn ${selectedIndex + 1} / ${books.length}`
                  : '0 cuốn sách'}
              </span>
            </div>
            {selectedBook ? (
              <h1 className="text-base sm:text-lg font-semibold text-stone-50 truncate mt-0.5">
                {selectedBook.title}
              </h1>
            ) : (
              <h1 className="text-base font-semibold text-stone-300 mt-0.5">
                Thư mục chưa có sách
              </h1>
            )}
          </div>

          {selectedBook && (
            <div className="flex items-center gap-2.5 shrink-0 text-xs text-stone-300">
              <div className="hidden sm:flex items-center gap-2 text-stone-400">
                <span className="uppercase font-mono-hud text-amber-300">
                  {selectedBook.format}
                </span>
                <span aria-hidden="true">·</span>
                <span className="max-w-[140px] truncate">{selectedBook.author}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-hud">
                  {selectedBook.lastLocation.percent > 0
                    ? `${Math.round(selectedBook.lastLocation.percent)}%`
                    : 'Chưa đọc'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onOpenManager('edit-book')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-800/80 hover:bg-stone-700 text-stone-200 transition-colors whitespace-nowrap"
              >
                <ImagePlus className="w-3.5 h-3.5 text-amber-300" />
                <span>Đổi bìa</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenBook(selectedBook)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold transition-colors whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{selectedBook.lastLocation.percent > 0 ? 'Đọc tiếp' : 'Mở sách'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Bookshelf Rack (Gliding Row or Multi-Row Bookcase Grid) */}
        {books.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
            <div className="w-12 h-12 rounded-2xl bg-stone-800/80 border border-stone-700/70 flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-sm font-medium text-stone-200">
              Chưa có tệp EPUB hoặc PDF nào trong thư mục này
            </p>
            <p className="text-xs text-stone-400 mt-1 max-w-md">
              Nhấn nút Thêm sách hoặc phím START để chọn tệp tin hay cả một thư mục sách offline.
            </p>
            <button
              type="button"
              onClick={() => onOpenManager('import')}
              className="mt-3 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold transition-colors"
            >
              Nhập sách EPUB / PDF từ máy
            </button>
          </div>
        ) : viewMode === 'shelf' ? (
          <div className="flex-1 flex flex-col justify-center min-h-0">
            {/* Generous pt-8 pb-2 headroom ensures scaled-up cover + ring NEVER clips at top */}
            <div
              ref={shelfContainerRef}
              className="flex items-end gap-4 sm:gap-5 overflow-x-auto px-5 pt-8 pb-2 thin-scroll snap-x snap-mandatory"
            >
              {books.map((book, idx) => renderBookCard(book, idx, false))}
            </div>

            {/* Tactile Wooden Shelf Plank Under Books */}
            <div className="mx-2 h-2.5 rounded-sm bg-gradient-to-b from-[#3d2b1f] via-[#2c1e15] to-[#1a110c] border-t border-amber-200/10 shadow-[0_8px_20px_rgba(0,0,0,0.65)] shrink-0" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-7 pb-4 thin-scroll">
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-x-4 gap-y-6">
              {books.map((book, idx) => renderBookCard(book, idx, true))}
            </div>
          </div>
        )}
      </div>

      {/* Physical Button Legend */}
      <ButtonHintBar hints={hints} activeBtn={activeBtn} />
    </div>
  );
}
