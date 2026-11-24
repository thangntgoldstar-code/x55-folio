import { useEffect, useRef, useState } from 'react';
import type { ScreenOrientation, X55Button } from '../types/reader';

interface UseX55InputOptions {
  enabled?: boolean;
  orientation?: ScreenOrientation;
  remapDpadOnRotate?: boolean;
  onButton: (btn: X55Button) => void;
  onAnalogMove?: (dx: number, dy: number) => void;
}

const VIRTUAL_BTN_EVENT = 'x55:virtual-button';
const VIRTUAL_ANALOG_EVENT = 'x55:virtual-analog';
const BTN_FEEDBACK_EVENT = 'x55:btn-feedback';

export function emitVirtualX55Button(btn: X55Button): void {
  window.dispatchEvent(new CustomEvent<X55Button>(VIRTUAL_BTN_EVENT, { detail: btn }));
}

export function emitVirtualX55Analog(dx: number, dy: number): void {
  window.dispatchEvent(
    new CustomEvent<{ dx: number; dy: number }>(VIRTUAL_ANALOG_EVENT, { detail: { dx, dy } })
  );
}

export function subscribeX55ButtonFeedback(cb: (btn: X55Button) => void): () => void {
  const handler = (e: Event) => {
    const custom = e as CustomEvent<X55Button>;
    if (custom.detail) cb(custom.detail);
  };
  window.addEventListener(BTN_FEEDBACK_EVENT, handler);
  return () => window.removeEventListener(BTN_FEEDBACK_EVENT, handler);
}

function rotateDirection(
  btn: X55Button,
  orientation: ScreenOrientation,
  remap: boolean
): X55Button {
  if (!remap || orientation === 0) return btn;
  const dirs: X55Button[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  const idx = dirs.indexOf(btn);
  if (idx === -1) return btn;

  // When screen is rotated clockwise by 90°, physical RIGHT corresponds to logical UP
  const shift = orientation === 90 ? 3 : orientation === 180 ? 2 : 1;
  return dirs[(idx + shift) % 4];
}

export function useX55Input({
  enabled = true,
  orientation = 0,
  remapDpadOnRotate = true,
  onButton,
  onAnalogMove,
}: UseX55InputOptions) {
  const [activeBtn, setActiveBtn] = useState<X55Button | null>(null);
  const onButtonRef = useRef(onButton);
  const onAnalogRef = useRef(onAnalogMove);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onButtonRef.current = onButton;
  }, [onButton]);

  useEffect(() => {
    onAnalogRef.current = onAnalogMove;
  }, [onAnalogMove]);

  const triggerFeedback = (rawBtn: X55Button, logicalBtn: X55Button) => {
    setActiveBtn(logicalBtn);
    window.dispatchEvent(new CustomEvent<X55Button>(BTN_FEEDBACK_EVENT, { detail: rawBtn }));
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => setActiveBtn(null), 160);
  };

  // Virtual X55 Shell listener
  useEffect(() => {
    if (!enabled) return;

    let lastVirtualAnalogNav = 0;

    const handleVirtualBtn = (e: Event) => {
      const custom = e as CustomEvent<X55Button>;
      const rawBtn = custom.detail;
      if (!rawBtn) return;
      const finalBtn = rotateDirection(rawBtn, orientation, remapDpadOnRotate);
      triggerFeedback(rawBtn, finalBtn);
      onButtonRef.current(finalBtn);
    };

    const handleVirtualAnalog = (e: Event) => {
      const custom = e as CustomEvent<{ dx: number; dy: number }>;
      const { dx, dy } = custom.detail || { dx: 0, dy: 0 };
      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;

      const now = performance.now();
      if (onAnalogRef.current) {
        onAnalogRef.current(dx, dy);
      } else if (now - lastVirtualAnalogNav > 210) {
        lastVirtualAnalogNav = now;
        let stickBtn: X55Button | null = null;
        if (Math.abs(dx) > Math.abs(dy)) {
          stickBtn = dx > 0 ? 'RIGHT' : 'LEFT';
        } else {
          stickBtn = dy > 0 ? 'DOWN' : 'UP';
        }
        if (stickBtn) {
          const finalBtn = rotateDirection(stickBtn, orientation, remapDpadOnRotate);
          triggerFeedback(stickBtn, finalBtn);
          onButtonRef.current(finalBtn);
        }
      }
    };

    window.addEventListener(VIRTUAL_BTN_EVENT, handleVirtualBtn);
    window.addEventListener(VIRTUAL_ANALOG_EVENT, handleVirtualAnalog);
    return () => {
      window.removeEventListener(VIRTUAL_BTN_EVENT, handleVirtualBtn);
      window.removeEventListener(VIRTUAL_ANALOG_EVENT, handleVirtualAnalog);
    };
  }, [enabled, orientation, remapDpadOnRotate]);

  // Keyboard listener (mirrors X55 physical layout)
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        if (e.key === 'Escape') {
          target.blur();
        } else {
          return;
        }
      }

      let mapped: X55Button | null = null;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          mapped = 'UP';
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          mapped = 'DOWN';
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          mapped = 'LEFT';
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          mapped = 'RIGHT';
          break;
        case 'Enter':
        case 'z':
        case 'Z':
        case ' ':
          mapped = 'A';
          break;
        case 'Escape':
        case 'Backspace':
        case 'x':
        case 'X':
          mapped = 'B';
          break;
        case 'c':
        case 'C':
        case 'f':
        case 'F':
          mapped = 'X';
          break;
        case 'v':
        case 'V':
        case 'n':
        case 'N':
          mapped = 'Y';
          break;
        case 'q':
        case 'Q':
        case 'PageUp':
          mapped = 'L1';
          break;
        case 'e':
        case 'E':
        case 'PageDown':
          mapped = 'R1';
          break;
        case '1':
        case '[':
          mapped = 'L2';
          break;
        case '2':
        case ']':
          mapped = 'R2';
          break;
        case 'Tab':
          mapped = 'SELECT';
          break;
        case 'm':
        case 'M':
        case 'F1':
          mapped = 'START';
          break;
      }

      if (mapped) {
        e.preventDefault();
        const finalBtn = rotateDirection(mapped, orientation, remapDpadOnRotate);
        triggerFeedback(mapped, finalBtn);
        onButtonRef.current(finalBtn);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, orientation, remapDpadOnRotate]);

  // Gamepad API polling loop (60fps edge-triggered + hold-to-repeat for D-Pad/shoulders)
  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    const prevPressed = new Map<number, number>(); // btnIndex -> lastTriggerTime
    let lastAnalogNav = 0;

    // Standard W3C / ROCKNIX Powkiddy X55 Nintendo-layout mapping
    const buttonIndexMap: Record<number, X55Button> = {
      0: 'B', // South (Bottom)
      1: 'A', // East (Right)
      2: 'Y', // West (Left)
      3: 'X', // North (Top)
      4: 'L1',
      5: 'R1',
      6: 'L2',
      7: 'R2',
      8: 'SELECT',
      9: 'START',
      12: 'UP',
      13: 'DOWN',
      14: 'LEFT',
      15: 'RIGHT',
    };

    const repeatable = new Set<X55Button>(['UP', 'DOWN', 'LEFT', 'RIGHT', 'L1', 'R1']);

    const poll = (now: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null;

      if (pad) {
        pad.buttons.forEach((btnState, idx) => {
          const mapped = buttonIndexMap[idx];
          if (!mapped) return;

          const pressed = btnState.pressed || btnState.value > 0.5;
          const lastTime = prevPressed.get(idx);

          if (pressed) {
            if (lastTime === undefined) {
              prevPressed.set(idx, now);
              const finalBtn = rotateDirection(mapped, orientation, remapDpadOnRotate);
              triggerFeedback(mapped, finalBtn);
              onButtonRef.current(finalBtn);
            } else if (repeatable.has(mapped) && now - lastTime > 260) {
              prevPressed.set(idx, now - 140); // smooth repeat every 120ms after initial 260ms hold
              const finalBtn = rotateDirection(mapped, orientation, remapDpadOnRotate);
              triggerFeedback(mapped, finalBtn);
              onButtonRef.current(finalBtn);
            }
          } else {
            prevPressed.delete(idx);
          }
        });

        // Left analog stick: smooth panning if callback exists, otherwise directional step
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        if (Math.abs(ax) > 0.25 || Math.abs(ay) > 0.25) {
          if (onAnalogRef.current) {
            onAnalogRef.current(ax, ay);
          } else if (now - lastAnalogNav > 210) {
            lastAnalogNav = now;
            let stickBtn: X55Button | null = null;
            if (Math.abs(ax) > Math.abs(ay)) {
              stickBtn = ax > 0 ? 'RIGHT' : 'LEFT';
            } else {
              stickBtn = ay > 0 ? 'DOWN' : 'UP';
            }
            if (stickBtn) {
              const finalBtn = rotateDirection(stickBtn, orientation, remapDpadOnRotate);
              triggerFeedback(stickBtn, finalBtn);
              onButtonRef.current(finalBtn);
            }
          }
        }
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, orientation, remapDpadOnRotate]);

  return { activeBtn };
}
