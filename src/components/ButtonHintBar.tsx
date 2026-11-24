import type { X55Button } from '../types/reader';

export interface ButtonHintItem {
  button: X55Button | 'DPAD';
  label: string;
  keyHint?: string;
  onClick?: () => void;
}

interface ButtonHintBarProps {
  hints: ButtonHintItem[];
  activeBtn?: X55Button | null;
  darkSurface?: boolean;
}

const BUTTON_COLORS: Record<string, string> = {
  A: 'bg-emerald-700/90 text-emerald-50 border-emerald-500/60',
  B: 'bg-rose-700/90 text-rose-50 border-rose-500/60',
  X: 'bg-sky-700/90 text-sky-50 border-sky-500/60',
  Y: 'bg-amber-600/90 text-amber-50 border-amber-400/60',
  L1: 'bg-stone-700 text-stone-100 border-stone-500/70',
  R1: 'bg-stone-700 text-stone-100 border-stone-500/70',
  L2: 'bg-stone-700 text-stone-100 border-stone-500/70',
  R2: 'bg-stone-700 text-stone-100 border-stone-500/70',
  SELECT: 'bg-stone-800 text-stone-200 border-stone-600',
  START: 'bg-stone-800 text-stone-200 border-stone-600',
  DPAD: 'bg-stone-700 text-stone-100 border-stone-500/70',
};

const BUTTON_SHORT_TEXT: Record<string, string> = {
  DPAD: '✚',
  LEFT: '◀',
  RIGHT: '▶',
  UP: '▲',
  DOWN: '▼',
};

export function ButtonHintBar({ hints, activeBtn }: ButtonHintBarProps) {
  return (
    <footer className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#120f0d]/95 border-t border-stone-800/80 text-[11px] text-stone-300 shrink-0 overflow-x-auto thin-scroll">
      <div className="flex items-center gap-3.5 mx-auto">
        {hints.map((hint, idx) => {
          const isPressed = activeBtn && hint.button === activeBtn;
          const badgeStyle =
            BUTTON_COLORS[hint.button] || 'bg-stone-700 text-stone-100 border-stone-500/70';
          const shortCap = BUTTON_SHORT_TEXT[hint.button] || hint.button;

          return (
            <button
              key={`${hint.button}-${idx}`}
              type="button"
              onClick={hint.onClick}
              disabled={!hint.onClick}
              className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-transform duration-100 ${
                hint.onClick ? 'cursor-pointer hover:text-white active:scale-95' : 'cursor-default'
              } ${isPressed ? 'scale-105 text-amber-200' : ''}`}
            >
              <span
                className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded text-[10px] font-mono-hud font-semibold border shadow-xs ${badgeStyle} ${
                  isPressed ? 'ring-2 ring-amber-400' : ''
                }`}
              >
                {shortCap}
              </span>
              <span className="font-medium text-stone-300">{hint.label}</span>
              {hint.keyHint && (
                <span className="hidden xl:inline text-[10px] text-stone-500 font-mono-hud">
                  ({hint.keyHint})
                </span>
              )}
            </button>
          );
        })}
      </div>
    </footer>
  );
}
