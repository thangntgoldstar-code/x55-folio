import JSZip from 'jszip';
import { Download, Gamepad2, HardDrive, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useX55Input } from '../hooks/useX55Input';
import type { X55Button } from '../types/reader';
import { ButtonHintBar, type ButtonHintItem } from './ButtonHintBar';

interface PortMasterModalProps {
  onClose: () => void;
}

const LAUNCHER_SCRIPT = `#!/bin/bash
# X55 Folio — Trình đọc sách EPUB/PDF cho ROCKNIX & PortMaster (Powkiddy X55)

XDG_DATA_HOME=\${XDG_DATA_HOME:-$HOME/.local/share}
if [ -d "/opt/system/Tools/PortMaster/" ]; then
  controlfolder="/opt/system/Tools/PortMaster"
elif [ -d "/opt/tools/PortMaster/" ]; then
  controlfolder="/opt/tools/PortMaster"
else
  controlfolder="/roms/ports/PortMaster"
fi

source "$controlfolder/control.txt"
[ -f "\${controlfolder}/mod_\${CFW_NAME}.txt" ] && source "\${controlfolder}/mod_\${CFW_NAME}.txt"
get_controls

GAMEDIR="/$directory/ports/x55-folio"
cd "$GAMEDIR" || exit 1

export X55_PORT_DIR="$GAMEDIR"
export SDL_GAMECONTROLLERCONFIG="$sdl_controllerconfig"

# Thư mục chép sách .pdf / .epub qua Wi-Fi
if [ -d "/storage/roms/books" ]; then
  export X55_BOOKS_DIR="/storage/roms/books"
elif [ -d "/$directory/books" ]; then
  export X55_BOOKS_DIR="/$directory/books"
else
  mkdir -p "/$directory/books" 2>/dev/null || mkdir -p "$GAMEDIR/books"
  export X55_BOOKS_DIR="$([ -d "/$directory/books" ] && echo "/$directory/books" || echo "$GAMEDIR/books")"
fi

> "$GAMEDIR/log.txt"
exec > >(tee -a "$GAMEDIR/log.txt") 2>&1

$ESUDO chmod 666 /dev/uinput 2>/dev/null || true

EXTRA_FLAGS="--no-sandbox --disable-dev-shm-usage --enable-gamepad-extensions --ignore-gpu-blocklist"
if [ -n "$WAYLAND_DISPLAY" ]; then
  EXTRA_FLAGS="$EXTRA_FLAGS --enable-features=UseOzonePlatform --ozone-platform=wayland"
else
  EXTRA_FLAGS="$EXTRA_FLAGS --ozone-platform-hint=auto"
fi

chmod +x "$GAMEDIR/x55-folio" 2>/dev/null || true
if [ -n "$GPTOKEYB" ]; then
  $GPTOKEYB "x55-folio" &
fi

"$GAMEDIR/x55-folio" $EXTRA_FLAGS

if [ -n "$GPTOKEYB" ]; then
  $ESUDO kill -9 $(pidof gptokeyb) 2>/dev/null || true
fi

pm_finish
`;

const PORT_JSON = `{
  "version": 3,
  "name": "x55-folio.zip",
  "items": ["X55 Folio.sh", "x55-folio/"],
  "attr": {
    "title": "X55 Folio Reader",
    "porter": "X55 Community",
    "desc": "Offline EPUB & PDF Reader with 3D Page Flip, Smart PDF Crop/Zoom, Night Mode, and X55 Physical Controls.",
    "inst": "Copy your .pdf and .epub files into /roms/books/ (grouped by subfolders) via ROCKNIX Wi-Fi.",
    "genres": ["utility"],
    "rtr": true,
    "arch": ["aarch64"]
  }
}`;

export function PortMasterModal({ onClose }: PortMasterModalProps) {
  const [downloaded, setDownloaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleDownloadBundle = useCallback(async () => {
    const zip = new JSZip();
    zip.file('X55 Folio.sh', LAUNCHER_SCRIPT);
    zip.file('x55-folio/port.json', PORT_JSON);
    zip.file(
      'HUONG_DAN_CAI_DAT_X55.txt',
      [
        'HUONG DAN DONG GOI & CAI DAT X55 FOLIO LEN POWKIDDY X55 (ROCKNIX):',
        '',
        'CACH DE NHAT (KHONG CAN CAI PHAN MEM LAP TRINH TREN MAY TINH):',
        '1. Tai toan bo ma nguon du an tu AI Studio (nut Download Project / Export ZIP).',
        '2. Day len 1 kho luu tru GitHub ca nhan (trong du an da co san file:',
        '   .github/workflows/build-x55-portmaster.yml + electron/ + portmaster/).',
        '3. Tren GitHub -> Tab Actions -> Chon "Build X55 PortMaster ZIP (ARM64)" -> Bam "Run workflow".',
        '4. Cho ~2 phut de GitHub tu dong tai nhan Electron ARM64 + ghep giao dien dist/ thanh 1 file duy nhat:',
        '   "X55_Folio_PortMaster_ARM64.zip".',
        '5. Tai file ZIP do ve, giai nen va chep qua Wi-Fi vao thu muc /roms/ports/ tren X55.',
        '6. Chep sach .pdf / .epub vao /roms/books/ (co the chia thu muc con theo the loai).',
        '7. Tren X55: Start -> Update Games Lists -> Muc Ports -> Chay X55 Folio!',
        '   (Khi chay tren may X55 that, khung may ao tu dong bien mat thanh toan man hinh 1280x720.)',
      ].join('\n')
    );

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'X55_Folio_PortMaster_Launcher.zip';
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }, []);

  const handleButton = useCallback(
    (btn: X55Button) => {
      switch (btn) {
        case 'UP':
          scrollRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
          break;
        case 'DOWN':
          scrollRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
          break;
        case 'A':
          handleDownloadBundle();
          break;
        case 'B':
        case 'START':
        case 'SELECT':
          onClose();
          break;
      }
    },
    [handleDownloadBundle, onClose]
  );

  const { activeBtn } = useX55Input({
    enabled: true,
    orientation: 0,
    remapDpadOnRotate: false,
    onButton: handleButton,
  });

  const hints: ButtonHintItem[] = [
    { button: 'UP', label: 'Cuộn lên', onClick: () => handleButton('UP') },
    { button: 'DOWN', label: 'Cuộn xuống', onClick: () => handleButton('DOWN') },
    { button: 'A', label: 'Tải gói Script', onClick: handleDownloadBundle },
    { button: 'B', label: 'Đóng', onClick: onClose },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2.5 sm:p-4">
      <div className="w-full max-w-2xl max-h-[94%] flex flex-col rounded-xl bg-[#191512] border border-stone-700/80 text-stone-100 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-[#14110e] shrink-0">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm sm:text-base font-semibold text-amber-100">
              Cài đặt PortMaster & Phím cứng Powkiddy X55 (ROCKNIX)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 thin-scroll">
          {/* Controller Mapping Reference */}
          <div className="rounded-xl bg-stone-900/70 border border-stone-800 p-3.5">
            <h3 className="text-xs font-semibold text-amber-300 mb-2.5">
              Sơ đồ phím vật lý chuẩn X55 (X trên · Y trái · A phải · B dưới)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">D-Pad Trái / Phải</span>
                <span className="font-mono-hud text-stone-100">Chọn sách / Lật trang</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">D-Pad Lên / Xuống</span>
                <span className="font-mono-hud text-stone-100">Chọn hàng / Tua ±5%</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">Phím A (Phải)</span>
                <span className="font-mono-hud text-emerald-300">Mở sách / Trang sau</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">Phím B (Dưới)</span>
                <span className="font-mono-hud text-rose-300">Quay lại / Đóng</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">Phím X (Trên)</span>
                <span className="font-mono-hud text-sky-300">Zoom thông minh PDF</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">Phím Y (Trái)</span>
                <span className="font-mono-hud text-amber-300">Đọc Ban Đêm / Đổi bìa</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">L1 / R1</span>
                <span className="font-mono-hud text-stone-100">Lật trang / Đổi thư mục</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">L2 / R2</span>
                <span className="font-mono-hud text-stone-100">1-2 Trang / Xoay dọc-ngang</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">SELECT</span>
                <span className="font-mono-hud text-stone-100">Thư mục / Ẩn-hiện thanh</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-800/70">
                <span className="text-stone-300">START</span>
                <span className="font-mono-hud text-stone-100">Cài đặt / Nhập sách</span>
              </div>
            </div>
          </div>

          {/* ROCKNIX PortMaster Script Export */}
          <div className="rounded-xl bg-stone-900/70 border border-stone-800 p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold text-stone-100 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  <span>Đóng gói tự động 1-Click cho X55 (/roms/ports/ &amp; /roms/books/)</span>
                </h3>
                <p className="text-xs text-stone-400 mt-1">
                  Mã nguồn dự án đã tích hợp sẵn <code className="text-amber-300">electron/</code>,{' '}
                  <code className="text-amber-300">portmaster/</code> và GitHub Actions tự đóng gói ra{' '}
                  <code className="text-stone-200">X55_Folio_PortMaster_ARM64.zip</code>. Bản cài lên X55 tự ẩn khung máy ảo và đọc thẳng sách chép qua Wi-Fi trong{' '}
                  <code className="text-amber-300">/roms/books/</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadBundle}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Script (A)</span>
              </button>
            </div>

            {downloaded && (
              <div className="text-xs text-emerald-400">
                Đã tải xong X55_Folio_PortMaster_Launcher.zip!
              </div>
            )}
          </div>
        </div>

        <ButtonHintBar hints={hints} activeBtn={activeBtn} />
      </div>
    </div>
  );
}
