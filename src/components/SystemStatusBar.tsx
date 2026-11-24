import { Battery, BatteryCharging, Gamepad2, Monitor, Power, Terminal } from 'lucide-react';
import type { SystemStatus } from '../hooks/useSystemStatus';

interface SystemStatusBarProps {
  status: SystemStatus;
  title?: string;
  x55FrameMode: boolean;
  isNativeHandheld?: boolean;
  onToggleX55Frame: () => void;
  onOpenPortMaster: () => void;
  onQuitApp?: () => void;
  compact?: boolean;
}

export function SystemStatusBar({
  status,
  title = 'X55 Folio',
  x55FrameMode,
  isNativeHandheld = false,
  onToggleX55Frame,
  onOpenPortMaster,
  onQuitApp,
  compact = false,
}: SystemStatusBarProps) {
  return (
    <header
      className={`flex items-center justify-between gap-4 px-4 ${
        compact ? 'h-8' : 'h-10'
      } border-b border-stone-800/80 bg-[#171411]/95 text-stone-200 shrink-0 select-none`}
    >
      {/* Zone 1: Wordmark */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-semibold tracking-tight text-amber-100 whitespace-nowrap shrink-0">
          {title}
        </span>
      </div>

      {/* Zone 2: Minimal handheld environment controls */}
      <div className="flex items-center gap-3 shrink-0">
        {!isNativeHandheld && (
          <button
            type="button"
            onClick={onToggleX55Frame}
            title="Chuyển đổi khung hình chuẩn Powkiddy X55 (1280×720) hoặc toàn màn hình"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              x55FrameMode
                ? 'bg-amber-600/25 text-amber-200 border border-amber-500/40'
                : 'text-stone-400 hover:text-stone-100 hover:bg-stone-800/70'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>{x55FrameMode ? 'Máy X55 Ảo' : 'Bật Máy X55 Ảo'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenPortMaster}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-stone-300 hover:text-amber-100 hover:bg-stone-800/70 transition-colors whitespace-nowrap shrink-0"
        >
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          <span>PortMaster</span>
        </button>

        {isNativeHandheld && onQuitApp && (
          <button
            type="button"
            onClick={onQuitApp}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-rose-300 hover:text-rose-200 hover:bg-rose-950/50 transition-colors whitespace-nowrap shrink-0"
            title="Thoát về màn hình Ports của ROCKNIX"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Thoát</span>
          </button>
        )}
      </div>

      {/* Zone 3: Hardware Clock & Battery */}
      <div className="flex items-center gap-3.5 text-xs font-mono-hud text-stone-300 shrink-0">
        {status.gamepadConnected && (
          <span
            className="flex items-center gap-1 text-amber-300"
            title={status.gamepadName || 'Tay cầm X55 đã kết nối'}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tay cầm</span>
          </span>
        )}

        <span className="flex items-center gap-1 text-stone-300">
          {status.isCharging ? (
            <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Battery className="w-3.5 h-3.5 text-stone-400" />
          )}
          <span>
            {status.batteryLevel !== null ? `${status.batteryLevel}%` : 'Pin hệ thống'}
          </span>
        </span>

        <span className="text-stone-100 font-medium">
          {status.timeString}
        </span>
      </div>
    </header>
  );
}
