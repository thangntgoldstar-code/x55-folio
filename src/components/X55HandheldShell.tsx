import { Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  emitVirtualX55Analog,
  emitVirtualX55Button,
  subscribeX55ButtonFeedback,
} from '../hooks/useX55Input';
import type { X55Button } from '../types/reader';

interface X55HandheldShellProps {
  children: ReactNode;
  onExitShell: () => void;
}

const REPEATABLE = new Set<X55Button>(['UP', 'DOWN', 'LEFT', 'RIGHT', 'L1', 'R1']);

function useHoldableVirtualButton(pressedBtn: X55Button | null) {
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const [localPressed, setLocalPressed] = useState<X55Button | null>(null);

  const stopHold = () => {
    if (holdTimeoutRef.current) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setLocalPressed(null);
  };

  useEffect(() => {
    return () => stopHold();
  }, []);

  const startPress = (btn: X55Button) => {
    stopHold();
    setLocalPressed(btn);
    emitVirtualX55Button(btn);

    if (REPEATABLE.has(btn)) {
      holdTimeoutRef.current = window.setTimeout(() => {
        holdIntervalRef.current = window.setInterval(() => {
          emitVirtualX55Button(btn);
        }, 125);
      }, 280);
    }
  };

  const isPressed = (btn: X55Button) => localPressed === btn || pressedBtn === btn;

  return { startPress, stopHold, isPressed };
}

interface AnalogThumbstickProps {
  label: string;
  onMove: (dx: number, dy: number) => void;
}

function AnalogThumbstick({ label, onMove }: AnalogThumbstickProps) {
  const wellRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const vectorRef = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (draggingRef.current) {
        const { dx, dy } = vectorRef.current;
        if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
          onMove(dx, dy);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [onMove]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = wellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.32;

    let rx = clientX - cx;
    let ry = clientY - cy;
    const dist = Math.hypot(rx, ry);
    if (dist > maxR && dist > 0) {
      rx = (rx / dist) * maxR;
      ry = (ry / dist) * maxR;
    }

    setOffset({ x: rx, y: ry });
    vectorRef.current = {
      dx: maxR > 0 ? rx / maxR : 0,
      dy: maxR > 0 ? ry / maxR : 0,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
    setOffset({ x: 0, y: 0 });
    vectorRef.current = { dx: 0, dy: 0 };
  };

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        ref={wellRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title={`${label} — Kéo để điều hướng hoặc cuộn trang PDF`}
        className="relative w-12 h-12 rounded-full bg-[#111214] border border-stone-700/80 shadow-[inset_0_4px_10px_rgba(0,0,0,0.85)] flex items-center justify-center touch-none cursor-grab active:cursor-grabbing"
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            transition: draggingRef.current ? 'none' : 'transform 160ms cubic-bezier(0.16,1,0.3,1)',
          }}
          className="w-8 h-8 rounded-full bg-gradient-to-b from-stone-600 via-stone-700 to-stone-800 border border-stone-500/50 shadow-[0_4px_10px_rgba(0,0,0,0.7)] flex items-center justify-center"
        >
          <div className="w-4 h-4 rounded-full border border-stone-500/40 bg-stone-800/70" />
        </div>
      </div>
      <span className="text-[9px] font-mono-hud text-stone-500 tracking-tight">{label}</span>
    </div>
  );
}

export function X55HandheldShell({ children, onExitShell }: X55HandheldShellProps) {
  const [externalActiveBtn, setExternalActiveBtn] = useState<X55Button | null>(null);
  const screenSlotRef = useRef<HTMLDivElement | null>(null);
  const [screenDim, setScreenDim] = useState({ width: 896, height: 504 });

  useEffect(() => {
    let timer: number | null = null;
    const unsub = subscribeX55ButtonFeedback((btn) => {
      setExternalActiveBtn(btn);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setExternalActiveBtn(null), 160);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Enforce strict mathematical 16:9 screen dimensions inside the available console bezel
  useEffect(() => {
    const el = screenSlotRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const availW = Math.max(320, rect.width - 12);
      const availH = Math.max(180, rect.height - 12);
      let w = availW;
      let h = (w * 9) / 16;
      if (h > availH) {
        h = availH;
        w = (h * 16) / 9;
      }
      setScreenDim({
        width: Math.floor(w),
        height: Math.floor(h),
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { startPress, stopHold, isPressed } = useHoldableVirtualButton(externalActiveBtn);

  const shoulderClass = (btn: X55Button) =>
    `px-4 py-1.5 rounded-t-xl rounded-b-sm text-[11px] font-mono-hud font-semibold border transition-all select-none cursor-pointer ${
      isPressed(btn)
        ? 'bg-amber-500 text-stone-950 border-amber-300 translate-y-[2px] shadow-inner'
        : 'bg-gradient-to-b from-stone-700 to-stone-800 text-stone-200 border-stone-600/80 hover:from-stone-600 hover:to-stone-700 shadow-[0_3px_8px_rgba(0,0,0,0.5)]'
    }`;

  const faceBtnClass = (btn: X55Button, accent: string) =>
    `w-8 h-8 rounded-full font-mono-hud text-xs font-bold border flex items-center justify-center transition-all select-none cursor-pointer ${
      isPressed(btn)
        ? `${accent} scale-95 ring-2 ring-amber-300 shadow-inner`
        : 'bg-gradient-to-b from-stone-700 to-stone-800 text-stone-100 border-stone-600 hover:from-stone-600 shadow-[0_3px_8px_rgba(0,0,0,0.6)]'
    }`;

  const systemPillClass = (btn: X55Button) =>
    `px-2.5 py-1 rounded-full text-[9px] font-mono-hud font-semibold tracking-wider border transition-all select-none cursor-pointer ${
      isPressed(btn)
        ? 'bg-amber-500 text-stone-950 border-amber-300 translate-y-[1px]'
        : 'bg-stone-800 text-stone-300 border-stone-600/80 hover:bg-stone-700 shadow-xs'
    }`;

  const dpadCellClass = (btn: X55Button) =>
    `flex items-center justify-center text-[10px] font-bold transition-colors select-none cursor-pointer ${
      isPressed(btn)
        ? 'bg-amber-500 text-stone-950'
        : 'bg-stone-700 hover:bg-stone-600 text-stone-200'
    }`;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-2 sm:p-4 bg-[#0b0a09] overflow-hidden">
      {/* Top Shoulder Triggers + Shell Header */}
      <div className="w-full max-w-[1360px] flex items-end justify-between px-4 sm:px-10 mb-[-2px] z-10 shrink-0">
        {/* Left Shoulders: L2 outer, L1 inner */}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onPointerDown={() => startPress('L2')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={shoulderClass('L2')}
            title="L2 — Đổi 1 Trang / 2 Trang hoặc Dạng Lưới (Phím 1)"
          >
            L2
          </button>
          <button
            type="button"
            onPointerDown={() => startPress('L1')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={shoulderClass('L1')}
            title="L1 — Trang trước / Thư mục trước (Phím Q)"
          >
            L1
          </button>
        </div>

        {/* Center Top Bezel Info & Fullscreen Exit */}
        <div className="flex items-center gap-3 pb-1.5">
          <span className="hidden sm:inline text-[10px] font-mono-hud tracking-widest text-stone-400">
            POWKIDDY X55 · 5.5&quot; 16:9 (1280×720)
          </span>
          <button
            type="button"
            onClick={onExitShell}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-stone-800/90 hover:bg-stone-700 border border-stone-700 text-[11px] font-medium text-amber-200 transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Mở toàn màn hình</span>
          </button>
        </div>

        {/* Right Shoulders: R1 inner, R2 outer */}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onPointerDown={() => startPress('R1')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={shoulderClass('R1')}
            title="R1 — Trang sau / Thư mục sau (Phím E)"
          >
            R1
          </button>
          <button
            type="button"
            onPointerDown={() => startPress('R2')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={shoulderClass('R2')}
            title="R2 — Xoay màn hình dọc/ngang (Phím 2)"
          >
            R2
          </button>
        </div>
      </div>

      {/* Main Handheld Console Body (16:9 IPS Screen flanked by ergonomic grips) */}
      <div className="w-full max-w-[1360px] flex-1 min-h-0 flex flex-col lg:flex-row items-stretch justify-between rounded-[30px] sm:rounded-[44px] bg-gradient-to-b from-[#2a2827] via-[#211f1e] to-[#171514] border-2 border-stone-700/80 shadow-[0_32px_90px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.12)] p-2.5 sm:p-3.5 gap-2.5 sm:gap-3 overflow-hidden">
        {/* LEFT GRIP: L-Stick top, D-Pad middle, SELECT bottom */}
        <div className="hidden lg:flex w-[126px] xl:w-[142px] shrink-0 flex-col items-center justify-between py-4 px-1.5 rounded-l-[30px] bg-[#1b1918]/75 border border-stone-800/70">
          <AnalogThumbstick
            label="L-STICK"
            onMove={(dx, dy) => emitVirtualX55Analog(dx, dy)}
          />

          {/* Tactile Cross D-Pad */}
          <div className="flex flex-col items-center gap-1">
            <div className="grid grid-cols-3 grid-rows-3 w-[84px] h-[84px]">
              <div />
              <button
                type="button"
                aria-label="D-Pad Lên"
                onPointerDown={() => startPress('UP')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={`${dpadCellClass('UP')} rounded-t-md border-t border-x border-stone-600`}
              >
                ▲
              </button>
              <div />

              <button
                type="button"
                aria-label="D-Pad Trái"
                onPointerDown={() => startPress('LEFT')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={`${dpadCellClass('LEFT')} rounded-l-md border-l border-y border-stone-600`}
              >
                ◀
              </button>
              <div className="bg-stone-700 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-stone-800/80 shadow-inner" />
              </div>
              <button
                type="button"
                aria-label="D-Pad Phải"
                onPointerDown={() => startPress('RIGHT')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={`${dpadCellClass('RIGHT')} rounded-r-md border-r border-y border-stone-600`}
              >
                ▶
              </button>

              <div />
              <button
                type="button"
                aria-label="D-Pad Xuống"
                onPointerDown={() => startPress('DOWN')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={`${dpadCellClass('DOWN')} rounded-b-md border-b border-x border-stone-600`}
              >
                ▼
              </button>
              <div />
            </div>
            <span className="text-[9px] font-mono-hud text-stone-500">D-PAD</span>
          </div>

          <button
            type="button"
            onPointerDown={() => startPress('SELECT')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={systemPillClass('SELECT')}
            title="SELECT — Chọn thư mục / Cài đặt (Phím Tab)"
          >
            SELECT
          </button>
        </div>

        {/* CENTER: Strictly Locked 16:9 IPS Screen */}
        <div
          ref={screenSlotRef}
          className="flex-1 min-w-0 min-h-0 flex items-center justify-center"
        >
          <div
            style={{ width: `${screenDim.width}px`, height: `${screenDim.height}px` }}
            className="rounded-xl bg-[#070708] p-1.5 border border-stone-800 shadow-[inset_0_2px_12px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden shrink-0"
          >
            <div className="w-full h-full rounded-lg overflow-hidden flex flex-col bg-[#15120f]">
              {children}
            </div>
          </div>
        </div>

        {/* RIGHT GRIP: Real Powkiddy X55 Layout -> X top, Y left, A right, B bottom + R-Stick + START */}
        <div className="hidden lg:flex w-[126px] xl:w-[142px] shrink-0 flex-col items-center justify-between py-4 px-1.5 rounded-r-[30px] bg-[#1b1918]/75 border border-stone-800/70">
          {/* ABXY Diamond Cluster (Powkiddy X55 Nintendo Layout: X top, Y left, A right, B bottom) */}
          <div className="flex flex-col items-center gap-1">
            <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-[102px] h-[102px] items-center justify-items-center">
              <div />
              <button
                type="button"
                onPointerDown={() => startPress('X')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={faceBtnClass('X', 'bg-sky-500 text-stone-950 border-sky-300')}
                title="X (Trên) — Zoom thông minh PDF (Phím C)"
              >
                <span className={isPressed('X') ? 'text-stone-950' : 'text-sky-300'}>X</span>
              </button>
              <div />

              <button
                type="button"
                onPointerDown={() => startPress('Y')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={faceBtnClass('Y', 'bg-amber-500 text-stone-950 border-amber-300')}
                title="Y (Trái) — Ban đêm / Đổi ảnh bìa (Phím V)"
              >
                <span className={isPressed('Y') ? 'text-stone-950' : 'text-amber-300'}>Y</span>
              </button>
              <div />
              <button
                type="button"
                onPointerDown={() => startPress('A')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={faceBtnClass('A', 'bg-emerald-500 text-stone-950 border-emerald-300')}
                title="A (Phải) — Mở sách / Ẩn-hiện HUD (Phím Enter)"
              >
                <span className={isPressed('A') ? 'text-stone-950' : 'text-emerald-300'}>A</span>
              </button>

              <div />
              <button
                type="button"
                onPointerDown={() => startPress('B')}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                className={faceBtnClass('B', 'bg-rose-500 text-white border-rose-300')}
                title="B (Dưới) — Quay lại / Đóng (Phím Esc)"
              >
                <span className={isPressed('B') ? 'text-white' : 'text-rose-300'}>B</span>
              </button>
              <div />
            </div>
            <span className="text-[9px] font-mono-hud text-stone-500">X / Y / A / B</span>
          </div>

          <AnalogThumbstick
            label="R-STICK"
            onMove={(dx, dy) => emitVirtualX55Analog(dx, dy)}
          />

          <button
            type="button"
            onPointerDown={() => startPress('START')}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            className={systemPillClass('START')}
            title="START — Cài đặt / Thêm sách (Phím M)"
          >
            START
          </button>
        </div>

        {/* COMPACT CONTROLS BAR FOR NARROW / TABLET VIEWPORTS (< lg) */}
        <div className="flex lg:hidden items-center justify-between gap-2 px-2 py-1.5 rounded-xl bg-[#181615] border border-stone-800 shrink-0 overflow-x-auto thin-scroll">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onPointerDown={() => startPress('LEFT')}
              onPointerUp={stopHold}
              className={`${dpadCellClass('LEFT')} w-8 h-8 rounded`}
            >
              ◀
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('UP')}
              onPointerUp={stopHold}
              className={`${dpadCellClass('UP')} w-8 h-8 rounded`}
            >
              ▲
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('DOWN')}
              onPointerUp={stopHold}
              className={`${dpadCellClass('DOWN')} w-8 h-8 rounded`}
            >
              ▼
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('RIGHT')}
              onPointerUp={stopHold}
              className={`${dpadCellClass('RIGHT')} w-8 h-8 rounded`}
            >
              ▶
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={() => startPress('SELECT')}
              onPointerUp={stopHold}
              className={systemPillClass('SELECT')}
            >
              SELECT
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('START')}
              onPointerUp={stopHold}
              className={systemPillClass('START')}
            >
              START
            </button>
          </div>

          {/* Real Powkiddy X55 order: X, Y, A, B */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={() => startPress('X')}
              onPointerUp={stopHold}
              className={faceBtnClass('X', 'bg-sky-500 text-stone-950')}
            >
              X
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('Y')}
              onPointerUp={stopHold}
              className={faceBtnClass('Y', 'bg-amber-500 text-stone-950')}
            >
              Y
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('A')}
              onPointerUp={stopHold}
              className={faceBtnClass('A', 'bg-emerald-500 text-stone-950')}
            >
              A
            </button>
            <button
              type="button"
              onPointerDown={() => startPress('B')}
              onPointerUp={stopHold}
              className={faceBtnClass('B', 'bg-rose-500 text-white')}
            >
              B
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
