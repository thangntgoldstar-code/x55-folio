import { useEffect, useState } from 'react';

export interface SystemStatus {
  timeString: string;
  dateString: string;
  batteryLevel: number | null; // 0..100 or null if unavailable in browser
  isCharging: boolean;
  gamepadConnected: boolean;
  gamepadName: string | null;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

export function useSystemStatus(): SystemStatus {
  const [now, setNow] = useState(() => new Date());
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let batteryRef: BatteryManagerLike | null = null;
    let mounted = true;

    const updateBattery = () => {
      if (!batteryRef || !mounted) return;
      setBatteryLevel(Math.round(batteryRef.level * 100));
      setIsCharging(batteryRef.charging);
    };

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };

    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((bat) => {
          if (!mounted) return;
          batteryRef = bat;
          updateBattery();
          bat.addEventListener('levelchange', updateBattery);
          bat.addEventListener('chargingchange', updateBattery);
        })
        .catch(() => {
          // Battery API unavailable in restricted environment
        });
    }

    let nativeBatTimer: number | null = null;
    if (window.x55Native?.getBattery) {
      const pollNativeBattery = async () => {
        try {
          const info = await window.x55Native?.getBattery();
          if (mounted && info && info.level !== null) {
            setBatteryLevel(info.level);
            setIsCharging(info.charging);
          }
        } catch {
          // Ignore sysfs read errors
        }
      };
      pollNativeBattery();
      nativeBatTimer = window.setInterval(pollNativeBattery, 15000);
    }

    return () => {
      mounted = false;
      if (nativeBatTimer) window.clearInterval(nativeBatTimer);
      if (batteryRef) {
        batteryRef.removeEventListener('levelchange', updateBattery);
        batteryRef.removeEventListener('chargingchange', updateBattery);
      }
    };
  }, []);

  useEffect(() => {
    const checkGamepads = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const active = pads ? Array.from(pads).find((p) => p && p.connected) : null;
      setGamepadName(active ? active.id : null);
    };

    checkGamepads();
    window.addEventListener('gamepadconnected', checkGamepads);
    window.addEventListener('gamepaddisconnected', checkGamepads);
    return () => {
      window.removeEventListener('gamepadconnected', checkGamepads);
      window.removeEventListener('gamepaddisconnected', checkGamepads);
    };
  }, []);

  const timeString = now.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const dateString = now.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });

  return {
    timeString,
    dateString,
    batteryLevel,
    isCharging,
    gamepadConnected: Boolean(gamepadName),
    gamepadName,
  };
}
