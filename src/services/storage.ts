import type { BookItem, FolderItem, ReaderSettings } from '../types/reader';
import { DEFAULT_SETTINGS } from '../types/reader';
import { buildSampleEpub, buildSamplePdf } from './sampleBooks';

const DB_NAME = 'x55_folio_offline_db';
const DB_VERSION = 1;
const SETTINGS_KEY = 'x55_folio_settings_v1';

interface MetaRecord {
  key: string;
  value: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('bookFiles')) {
        db.createObjectStore('bookFiles', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function putIntoStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Handle storage quota safely
  }
}

export async function getAllFolders(): Promise<FolderItem[]> {
  const folders = await getAllFromStore<FolderItem>('folders');
  return folders.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveFolder(folder: FolderItem): Promise<void> {
  await putIntoStore('folders', folder);
}

export async function deleteFolder(folderId: string): Promise<void> {
  await deleteFromStore('folders', folderId);
}

export async function getAllBooks(): Promise<BookItem[]> {
  const books = await getAllFromStore<BookItem>('books');
  return books.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));
}

export async function saveBookMeta(book: BookItem): Promise<void> {
  await putIntoStore('books', book);
}

export async function saveBookWithFile(book: BookItem, buffer: ArrayBuffer): Promise<void> {
  await putIntoStore('books', book);
  await putIntoStore('bookFiles', { id: book.id, buffer });
}

export async function getBookFileBuffer(bookId: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookFiles', 'readonly');
    const req = tx.objectStore('bookFiles').get(bookId);
    req.onsuccess = () => {
      const rec = req.result as { id: string; buffer: ArrayBuffer } | undefined;
      resolve(rec ? rec.buffer : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBook(bookId: string): Promise<void> {
  await deleteFromStore('books', bookId);
  await deleteFromStore('bookFiles', bookId);
}

const COVER_PALETTES = [
  { bg1: '#233240', bg2: '#141d26', accent: '#d8b068', text: '#f2eadc' },
  { bg1: '#3a241f', bg2: '#221310', accent: '#e09f67', text: '#f7ece1' },
  { bg1: '#21352b', bg2: '#121f18', accent: '#a8c69f', text: '#edf2ec' },
  { bg1: '#342c3c', bg2: '#1c1722', accent: '#d6b692', text: '#f2edf5' },
  { bg1: '#3b3324', bg2: '#1f1a11', accent: '#e3be74', text: '#f6f0e4' },
  { bg1: '#1f3338', bg2: '#111d20', accent: '#8fc1c7', text: '#eaf3f4' },
  { bg1: '#42262e', bg2: '#241318', accent: '#df9a9e', text: '#f7ebed' },
];

function createEditorialCoverDataUrl(
  title: string,
  author: string,
  format: 'epub' | 'pdf',
  index: number
): string {
  const palette = COVER_PALETTES[index % COVER_PALETTES.length];
  const canvas = document.createElement('canvas');
  canvas.width = 270;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const grad = ctx.createLinearGradient(0, 0, 270, 360);
  grad.addColorStop(0, palette.bg1);
  grad.addColorStop(1, palette.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 270, 360);

  // Spine crease shadow
  const spineGrad = ctx.createLinearGradient(0, 0, 16, 0);
  spineGrad.addColorStop(0, 'rgba(0,0,0,0.48)');
  spineGrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  spineGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, 16, 360);

  // Inner editorial frame
  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 22, 224, 316);
  ctx.globalAlpha = 1;

  // Format tag
  ctx.fillStyle = palette.accent;
  ctx.font = '600 12px monospace';
  ctx.fillText(format.toUpperCase(), 38, 48);

  // Subtle geometric motif (varies per book index)
  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1.4;
  const motif = index % 3;
  if (motif === 0) {
    ctx.beginPath();
    ctx.arc(198, 90, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(198, 90, 14, 0, Math.PI * 2);
    ctx.stroke();
  } else if (motif === 1) {
    ctx.strokeRect(172, 62, 46, 46);
    ctx.strokeRect(182, 72, 26, 26);
  } else {
    ctx.beginPath();
    ctx.moveTo(165, 112);
    ctx.lineTo(195, 64);
    ctx.lineTo(225, 112);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Wrapped Title
  ctx.fillStyle = palette.text;
  ctx.font = '600 20px Georgia, serif';
  const words = title.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > 190 && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  let y = 158;
  for (const line of lines.slice(0, 4)) {
    ctx.fillText(line, 38, y);
    y += 28;
  }

  // Divider line
  ctx.fillStyle = palette.accent;
  ctx.fillRect(38, 286, 46, 2);

  // Author
  ctx.fillStyle = palette.text;
  ctx.globalAlpha = 0.78;
  ctx.font = '400 13px sans-serif';
  ctx.fillText(author.slice(0, 26), 38, 312);
  ctx.globalAlpha = 1;

  return canvas.toDataURL('image/jpeg', 0.85);
}

interface SampleCatalogEntry {
  id: string;
  folderId: string;
  format: 'epub' | 'pdf';
  title: string;
  author: string;
  percent: number;
  coverUrl?: string;
}

const EXPANDED_CATALOG: SampleCatalogEntry[] = [
  // Folder 1: Văn học & Tiểu luận (12 cuốn)
  {
    id: 'sample-epub-moon',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Đêm Trăng Trên Đỉnh Mù Sương',
    author: 'Nguyễn Minh Quân',
    percent: 18,
    coverUrl: '/src/assets/images/cover_mountain_moon_1795442765394.jpg',
  },
  {
    id: 'sample-epub-zen',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Nghệ Thuật Tĩnh Lặng & Giấy Washi',
    author: 'Lê Thảo Nguyên',
    percent: 42,
    coverUrl: '/src/assets/images/cover_botanical_ink_1795442765383.jpg',
  },
  {
    id: 'lit-epub-03',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Gió Thổi Qua Thung Lũng Đá',
    author: 'Trần Nhật Khang',
    percent: 65,
  },
  {
    id: 'lit-epub-04',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Những Bức Thư Gửi Mùa Thu',
    author: 'Phạm Hoàng Yến',
    percent: 0,
  },
  {
    id: 'lit-pdf-05',
    folderId: 'folder-literature',
    format: 'pdf',
    title: 'Tuyển Tập Truyện Ngắn Phương Nam',
    author: 'Nhiều Tác Giả',
    percent: 30,
  },
  {
    id: 'lit-epub-06',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Bến Đò Sông Vàm Cỏ',
    author: 'Võ Thành Long',
    percent: 84,
  },
  {
    id: 'lit-epub-07',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Ký Ức Phố Cổ Mưa Phùn',
    author: 'Đỗ Ngọc Diệp',
    percent: 12,
  },
  {
    id: 'lit-pdf-08',
    folderId: 'folder-literature',
    format: 'pdf',
    title: 'Tiểu Luận Về Ánh Sáng & Bóng Tối',
    author: 'Huỳnh Tấn Phát',
    percent: 0,
  },
  {
    id: 'lit-epub-09',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Hành Trình Về Biển Đông',
    author: 'Lý Quốc Bảo',
    percent: 51,
  },
  {
    id: 'lit-epub-10',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Tạp Bút Quán Cà Phê Sáng',
    author: 'Bùi Thanh Tùng',
    percent: 0,
  },
  {
    id: 'lit-pdf-11',
    folderId: 'folder-literature',
    format: 'pdf',
    title: 'Thi Ca Cổ Điển Chọn Lọc',
    author: 'Viện Văn Học',
    percent: 72,
  },
  {
    id: 'lit-epub-12',
    folderId: 'folder-literature',
    format: 'epub',
    title: 'Khúc Hát Đồi Thông Chiều',
    author: 'Ngô Khánh Linh',
    percent: 8,
  },

  // Folder 2: Tài liệu Kỹ thuật X55 (12 cuốn)
  {
    id: 'sample-pdf-x55',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Cẩm Nang Powkiddy X55 & ROCKNIX',
    author: 'Cộng Đồng PortMaster',
    percent: 25,
    coverUrl: '/src/assets/images/cover_retro_tech_1795442765566.jpg',
  },
  {
    id: 'tech-pdf-02',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Kiến Trúc ARM RK3566 & GPU Mali',
    author: 'Rockchip Docs',
    percent: 40,
  },
  {
    id: 'tech-pdf-03',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Hướng Dẫn PortMaster SDL2 & Gamepad',
    author: 'PortMaster Team',
    percent: 60,
  },
  {
    id: 'tech-epub-04',
    folderId: 'folder-tech',
    format: 'epub',
    title: 'Tối Ưu Pin & Tản Nhiệt ROCKNIX',
    author: 'X55 Modders',
    percent: 15,
  },
  {
    id: 'tech-pdf-05',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Hệ Thống Tệp Linux & Thẻ Nhớ MicroSD',
    author: 'Nguyễn Đức Anh',
    percent: 0,
  },
  {
    id: 'tech-pdf-06',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Cấu Hình Shader & Bộ Lọc CRT RetroArch',
    author: 'Retro Handhelds VN',
    percent: 88,
  },
  {
    id: 'tech-epub-07',
    folderId: 'folder-tech',
    format: 'epub',
    title: 'Lập Trình TypeScript Offline Cho Handheld',
    author: 'Trương Hoàng Nam',
    percent: 33,
  },
  {
    id: 'tech-pdf-08',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Sổ Tay Sửa Lỗi Audio & Wi-Fi ROCKNIX',
    author: 'Kỹ Thuật Cầm Tay',
    percent: 0,
  },
  {
    id: 'tech-pdf-09',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Thiết Kế Giao Diện 1280×720 16:9',
    author: 'UI Handheld Lab',
    percent: 55,
  },
  {
    id: 'tech-epub-10',
    folderId: 'folder-tech',
    format: 'epub',
    title: 'Quản Lý Thư Viện ROM & BIOS An Toàn',
    author: 'Lê Minh Triết',
    percent: 0,
  },
  {
    id: 'tech-pdf-11',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Kết Nối HDMI Out & Tay Cầm Bluetooth',
    author: 'Cộng Đồng X55',
    percent: 10,
  },
  {
    id: 'tech-pdf-12',
    folderId: 'folder-tech',
    format: 'pdf',
    title: 'Tham Chiếu Phím Nóng EmulationStation',
    author: 'ROCKNIX Wiki',
    percent: 92,
  },

  // Folder 3: Sổ tay & Sưu tầm (12 cuốn)
  {
    id: 'sample-pdf-zoom',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Kỹ Thuật Tối Ưu PDF Màn Hình Nhỏ',
    author: 'Studio X55 Folio',
    percent: 50,
  },
  {
    id: 'note-epub-02',
    folderId: 'folder-notes',
    format: 'epub',
    title: 'Sổ Tay Du Lịch Tây Bắc Mùa Lúa Chín',
    author: 'Phan Gia Huy',
    percent: 22,
  },
  {
    id: 'note-pdf-03',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Công Thức Pha Chế Cà Phê Thủ Công',
    author: 'Barista Note',
    percent: 75,
  },
  {
    id: 'note-epub-04',
    folderId: 'folder-notes',
    format: 'epub',
    title: '100 Mẹo Nhỏ Cho Đôi Mắt Khỏe Khi Đọc Đêm',
    author: 'Bác Sĩ Nhãn Khoa',
    percent: 0,
  },
  {
    id: 'note-pdf-05',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Bản Đồ Các Cung Đường Trekking Đẹp Nhất',
    author: 'Nhóm Xê Dịch',
    percent: 45,
  },
  {
    id: 'note-epub-06',
    folderId: 'folder-notes',
    format: 'epub',
    title: 'Ghi Chép Lịch Sử Kiến Trúc Đông Dương',
    author: 'KTS Trần Bảo',
    percent: 0,
  },
  {
    id: 'note-pdf-07',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Hướng Dẫn Chụp Ảnh Phim 35mm Cổ Điển',
    author: 'Phòng Tối Sài Gòn',
    percent: 62,
  },
  {
    id: 'note-epub-08',
    folderId: 'folder-notes',
    format: 'epub',
    title: 'Từ Điển Thành Ngữ & Ca Dao Việt Nam',
    author: 'Sưu Tầm Dân Gian',
    percent: 14,
  },
  {
    id: 'note-pdf-09',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Kỹ Năng Ghi Chú Zettelkasten Hiệu Quả',
    author: 'Đặng Phương Thảo',
    percent: 0,
  },
  {
    id: 'note-epub-10',
    folderId: 'folder-notes',
    format: 'epub',
    title: 'Câu Chuyện Về Những Cuốn Sách Giấy Cũ',
    author: 'Tiệm Sách Mùa Hạ',
    percent: 95,
  },
  {
    id: 'note-pdf-11',
    folderId: 'folder-notes',
    format: 'pdf',
    title: 'Lịch Thiên Văn & Quan Sát Bầu Trời Đêm',
    author: 'CLB Thiên Văn',
    percent: 28,
  },
  {
    id: 'note-epub-12',
    folderId: 'folder-notes',
    format: 'epub',
    title: 'Sổ Tay Học Nhanh Tiếng Nhật Giao Tiếp',
    author: 'Minh Anh Sensei',
    percent: 0,
  },
];

export async function seedInitialLibraryIfNeeded(): Promise<void> {
  const db = await openDb();
  const seededV2 = await new Promise<boolean>((resolve) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get('library_seeded_v2');
    req.onsuccess = () => resolve(Boolean((req.result as MetaRecord | undefined)?.value));
    req.onerror = () => resolve(false);
  });

  if (seededV2) return;

  const now = Date.now();
  const existingFolders = await getAllFolders();
  const existingFolderIds = new Set(existingFolders.map((f) => f.id));

  const defaultFolders: FolderItem[] = [
    { id: 'folder-literature', name: 'Văn học & Tiểu luận', createdAt: now - 3000 },
    { id: 'folder-tech', name: 'Tài liệu Kỹ thuật X55', createdAt: now - 2000 },
    { id: 'folder-notes', name: 'Sổ tay & Sưu tầm', createdAt: now - 1000 },
  ];

  for (const f of defaultFolders) {
    if (!existingFolderIds.has(f.id)) {
      await saveFolder(f);
    }
  }

  const existingBooks = await getAllBooks();
  const existingBookIds = new Set(existingBooks.map((b) => b.id));

  for (let i = 0; i < EXPANDED_CATALOG.length; i++) {
    const entry = EXPANDED_CATALOG[i];
    if (existingBookIds.has(entry.id)) continue;

    const coverDataUrl =
      entry.coverUrl || createEditorialCoverDataUrl(entry.title, entry.author, entry.format, i);

    if (entry.format === 'epub') {
      const epubBuffer = await buildSampleEpub({
        title: entry.title,
        author: entry.author,
        chapters: [
          {
            title: `Chương I: Mở đầu — ${entry.title}`,
            paragraphs: [
              `Bạn đang đọc ấn bản EPUB offline "${entry.title}" của tác giả ${entry.author} trên máy Powkiddy X55.`,
              'Giao diện trang giấy được tối ưu độ tương phản cho màn hình 5.5 inch 1280×720, giúp đọc lâu không mỏi mắt ngay cả vào ban đêm.',
              'Hãy thử nhấn nút X (trên) để đổi tùy chọn hoặc nút L2 để mở song song 2 trang như một cuốn sách giấy thực thụ.',
              'Khi nhấn R1 hoặc D-Pad Phải, hiệu ứng lật trang 3D mượt mà sẽ chuyển bạn sang trang tiếp theo và tự động lưu lại vị trí đọc cuối cùng.',
            ],
          },
          {
            title: 'Chương II: Trải nghiệm đọc sách cầm tay',
            paragraphs: [
              'Mỗi thư mục trong thư viện có thể chứa hàng chục đến hàng trăm cuốn sách EPUB và PDF khác nhau, được sắp xếp gọn gàng trên giá sách.',
              'Bạn có thể đổi ảnh nền giấy (Giấy Ngà, Giấy Da Cổ, Giấy Washi, Đêm Dịu Mắt, Đêm OLED hoặc ảnh riêng) ngay trong bảng Cài đặt (nút START).',
              'Nếu muốn cầm máy theo chiều dọc như một cuốn sách bỏ túi, nhấn R2 để xoay màn hình 90° — hệ thống sẽ tự động đảo chiều D-Pad tương ứng.',
            ],
          },
          {
            title: 'Chương III: Ghi chú & Lưu tiến trình tự động',
            paragraphs: [
              'Mọi thay đổi về số trang, chương đang đọc và chế độ hiển thị đều được ghi tức thì vào bộ nhớ cục bộ IndexedDB mà không cần kết nối mạng.',
              'Thanh tiến trình ở cạnh dưới luôn hiển thị chính xác tỷ lệ phần trăm đã đọc, kèm đồng hồ và trạng thái pin hệ thống.',
            ],
          },
        ],
      });

      const pageIdx = entry.percent > 50 ? 1 : 0;
      await saveBookWithFile(
        {
          id: entry.id,
          title: entry.title,
          author: entry.author,
          format: 'epub',
          folderId: entry.folderId,
          fileName: `${entry.id}.epub`,
          fileSize: epubBuffer.byteLength,
          coverDataUrl,
          pageCount: 3,
          addedAt: now - i * 1000,
          lastOpenedAt: entry.percent > 0 ? now - i * 1500 : undefined,
          lastLocation: {
            pageIndex: pageIdx,
            totalPages: 3,
            chapterIndex: entry.percent > 60 ? 1 : 0,
            scrollRatio: 0,
            percent: entry.percent,
            updatedAt: now - i * 1500,
          },
          isSample: true,
        },
        epubBuffer
      );
    } else {
      const totalPages = 4;
      const pageNum = Math.max(1, Math.min(totalPages, Math.round((entry.percent / 100) * totalPages) || 1));
      const pdfBuffer = buildSamplePdf({
        title: entry.title,
        author: entry.author,
        pages: [
          {
            heading: `1. ${entry.title}`,
            lines: [
              `Tac gia: ${entry.author}`,
              'Tai lieu PDF nay duoc toi uu de doc offline tren man hinh Powkiddy X55 (1280x720).',
              '',
              'Thu nghiem cac phim vat ly ngay tren vo may X55 gia lap:',
              '- Phim R1 / D-Pad Phai : Lat sang trang sau voi hieu ung sach 3D',
              '- Phim X (nut tren)    : Doi che do Zoom (Cat le / Vua trang / Vua ngang)',
              '- Phim Y (nut trai)    : Bat/tat che do Doc Ban Dem chong choi mat',
              '- Phim R2              : Xoay man hinh doc/ngang 0 / 90 / 180 / 270 do',
            ],
            accentBox: 'Che do Cat Le Thong Minh (Auto-Crop) tu loai bo vien trang du thua.',
          },
          {
            heading: '2. Toi uu thu phong cho man hinh 5.5 inch',
            lines: [
              'Khi doc PDF nhieu chu hoac hai cot, hay nhan phim X de chuyen sang',
              'che do Vua Chieu Ngang (Fit Width) hoac Phong To Thu Cong.',
              '',
              'Ban co the keo can Analog Trai (L-Stick) de di chuyen vung nhin',
              'hoac dung D-Pad Len/Xuong de cuon doc muot ma tu tren xuong duoi.',
            ],
            accentBox: 'Nhan L2 de bat che do 2 trang song song tren man hinh 16:9!',
          },
          {
            heading: '3. Luu vi tri doc & Quan ly thu muc',
            lines: [
              'Moi trang ban dang doc duoc luu tuc thi vao IndexedDB.',
              'Khi mo lai app, ban co the chon tiep tuc ngay tai vi tri cuoi cung.',
              'Nhan SELECT tai gia sach de chuyen nhanh giua cac thu muc sach.',
            ],
          },
          {
            heading: '4. Thong tin ban in PortMaster ROCKNIX',
            lines: [
              `Ma tai lieu: ${entry.id}`,
              'Trang thai: San sang doc Offline hoan toan khong can Wi-Fi.',
              'Ho tro tat ca file .pdf va .epub tu the nho MicroSD.',
            ],
            accentBox: 'Cam on ban da su dung X55 Folio Reader!',
          },
        ],
      });

      await saveBookWithFile(
        {
          id: entry.id,
          title: entry.title,
          author: entry.author,
          format: 'pdf',
          folderId: entry.folderId,
          fileName: `${entry.id}.pdf`,
          fileSize: pdfBuffer.byteLength,
          coverDataUrl,
          pageCount: totalPages,
          addedAt: now - i * 1000,
          lastOpenedAt: entry.percent > 0 ? now - i * 1500 : undefined,
          lastLocation: {
            pageIndex: pageNum,
            totalPages,
            chapterIndex: 0,
            scrollRatio: 0,
            percent: entry.percent,
            updatedAt: now - i * 1500,
          },
          isSample: true,
        },
        pdfBuffer
      );
    }
  }

  await putIntoStore('meta', { key: 'library_seeded_v2', value: true });
}
