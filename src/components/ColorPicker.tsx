import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Pipette } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Color conversion helpers (HEX <-> HSV)                              */
/* ------------------------------------------------------------------ */

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeHex(input: string): string | null {
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex.split('').map(c => c + c).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return '#' + hex.toUpperCase();
  }
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex) || '#000000';
  const h = norm.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function hexToHsv(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(h: number, s: number, v: number) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/* ------------------------------------------------------------------ */
/* Pointer-drag hook for the SV square and hue slider                  */
/* ------------------------------------------------------------------ */

function usePointerArea(onMove: (xRatio: number, yRatio: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const update = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((clientY - rect.top) / rect.height, 0, 1);
    onMove(x, y);
  }, [onMove]);

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const point = 'touches' in e ? e.touches[0] : e;
      if (!point) return;
      e.preventDefault();
      update(point.clientX, point.clientY);
    };
    const handleUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [update]);

  const start = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    draggingRef.current = true;
    const point = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    update(point.clientX, point.clientY);
  }, [update]);

  return { ref, start };
}

/* ------------------------------------------------------------------ */
/* The picker panel                                                    */
/* ------------------------------------------------------------------ */

interface PanelProps {
  value: string;
  onChange: (hex: string) => void;
  position: { top: number; left: number };
  onRequestClose: () => void;
}

const PICKER_WIDTH = 280;

const ColorPickerPanel: React.FC<PanelProps> = ({ value, onChange, position, onRequestClose }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexInput, setHexInput] = useState(() => normalizeHex(value) || '#FFFFFF');
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep internal HSV synced when the external value changes (e.g. preset click)
  useEffect(() => {
    const norm = normalizeHex(value);
    if (norm) {
      setHexInput(norm);
      // Avoid resetting hue/sat when the hex matches what we already produced
      if (hsvToHex(hsv.h, hsv.s, hsv.v) !== norm) {
        setHsv(hexToHsv(norm));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = useCallback((next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexInput(hex);
    onChange(hex);
  }, [onChange]);

  const svArea = usePointerArea((x, y) => {
    commit({ h: hsv.h, s: x, v: 1 - y });
  });

  const hueArea = usePointerArea((x) => {
    commit({ h: x * 360, s: hsv.s, v: hsv.v });
  });

  // Close on outside click / Escape
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onRequestClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onRequestClose]);

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const hueHex = useMemo(() => hsvToHex(hsv.h, 1, 1), [hsv.h]);

  const handleHexSubmit = (raw: string) => {
    const norm = normalizeHex(raw);
    if (norm) {
      setHsv(hexToHsv(norm));
      setHexInput(norm);
      onChange(norm);
    } else {
      // revert to current valid value
      setHexInput(currentHex);
    }
  };

  const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const handleEyeDropper = async () => {
    try {
      // @ts-expect-error EyeDropper is not yet in the standard TS lib
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      if (result?.sRGBHex) handleHexSubmit(result.sRGBHex);
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div
      ref={panelRef}
      style={{ top: position.top, left: position.left, width: PICKER_WIDTH }}
      className="fixed z-[1000] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Saturation / Value square */}
      <div
        ref={svArea.ref}
        onMouseDown={svArea.start}
        onTouchStart={svArea.start}
        className="relative w-full aspect-square rounded-xl cursor-crosshair touch-none overflow-hidden"
        style={{ backgroundColor: hueHex }}
      >
        <div className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }} />
        <div className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }} />
        <div
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: currentHex,
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueArea.ref}
        onMouseDown={hueArea.start}
        onTouchStart={hueArea.start}
        className="relative mt-4 h-4 w-full rounded-full cursor-pointer touch-none"
        style={{
          background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
        }}
      >
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueHex }}
        />
      </div>

      {/* Footer: swatch + hex input + eyedropper */}
      <div className="mt-4 flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded-lg border border-slate-200"
          style={{ backgroundColor: currentHex }}
        />
        <div className="flex flex-1 items-center rounded-xl border border-slate-200 px-3 py-2">
          <span className="mr-1 text-sm font-semibold text-slate-400">#</span>
          <input
            value={hexInput.replace(/^#/, '')}
            onChange={e => setHexInput('#' + e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase())}
            onBlur={e => handleHexSubmit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleHexSubmit((e.target as HTMLInputElement).value); }}
            spellCheck={false}
            maxLength={6}
            className="w-full bg-transparent text-sm font-semibold uppercase tracking-wide text-slate-700 outline-none"
          />
        </div>
        {supportsEyeDropper && (
          <button
            type="button"
            onClick={handleEyeDropper}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="화면에서 색상 추출"
          >
            <Pipette size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Public component: a swatch trigger that opens the panel             */
/* ------------------------------------------------------------------ */

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Classes applied to the trigger swatch button (size, shape, etc.) */
  triggerClassName?: string;
  /** Optional inline styles merged onto the trigger swatch */
  triggerStyle?: React.CSSProperties;
  'aria-label'?: string;
}

const PICKER_HEIGHT_ESTIMATE = 360;

const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  triggerClassName = 'w-10 h-10 rounded-full',
  triggerStyle,
  'aria-label': ariaLabel = '색상 선택',
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const swatchColor = normalizeHex(value) || (value?.startsWith('#') ? value : '#FFFFFF');

  const openPanel = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + margin;
    // Flip above the trigger if there isn't room below
    if (top + PICKER_HEIGHT_ESTIMATE > window.innerHeight && rect.top - PICKER_HEIGHT_ESTIMATE - margin > 0) {
      top = rect.top - PICKER_HEIGHT_ESTIMATE - margin;
    }
    let left = rect.left;
    if (left + PICKER_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - PICKER_WIDTH - margin);
    }
    setPosition({ top, left });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`${triggerClassName} cursor-pointer overflow-hidden border border-slate-200`}
        style={{ backgroundColor: swatchColor, ...triggerStyle }}
        aria-label={ariaLabel}
      />
      {open && createPortal(
        <ColorPickerPanel
          value={swatchColor}
          onChange={onChange}
          position={position}
          onRequestClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  );
};

export default ColorPicker;
