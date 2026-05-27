import React, { useState, useEffect, useRef } from 'react';
import { X, Pipette } from 'lucide-react';

const PALETTE_COLORS = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#69db7c', '#38d9a9', '#66d9e8', '#74c0fc', '#9775fa', '#da77f2'],
  ['#ff8787', '#ffc078', '#ffe066', '#c0eb75', '#8ce99a', '#63e6be', '#99e9f2', '#a5d8ff', '#b197fc', '#e599f7'],
  ['#fa5252', '#fd7e14', '#fab005', '#82c91e', '#40c057', '#12b886', '#15aabf', '#339af0', '#7950f2', '#be4bdb'],
  ['#e03131', '#e8590c', '#f08c00', '#66a80f', '#2f9e44', '#099268', '#0c8599', '#1971c2', '#6741d9', '#9c36b5'],
];

interface ColorPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentColor: string;
  onColorChange: (color: string) => void;
  title?: string;
}

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isOpen,
  onClose,
  currentColor,
  onColorChange,
  title = '색상',
}) => {
  const [hexInput, setHexInput] = useState(currentColor);
  const modalRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexInput(currentColor);
  }, [currentColor]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleHexSubmit = () => {
    let val = hexInput.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onColorChange(val);
    }
  };

  const isSelected = (c: string) => currentColor.toLowerCase() === c.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        ref={modalRef}
        className="relative bg-white w-full max-w-[340px] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-5">
          {/* Current color */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">사용 중인 색상</p>
            <div className="flex items-center gap-2">
              <div
                className="w-9 h-9 rounded-xl border-2 border-purple-400 shadow-sm"
                style={{ backgroundColor: currentColor }}
              />
            </div>
          </div>

          {/* Basic palette */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">기본 팔레트</p>
            <div className="space-y-1">
              {PALETTE_COLORS.map((row, ri) => (
                <div key={ri} className="grid grid-cols-10 gap-1">
                  {row.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        onColorChange(c);
                        setHexInput(c);
                      }}
                      className={`aspect-square rounded-lg transition-all duration-150 ${
                        isSelected(c)
                          ? 'ring-2 ring-purple-500 ring-offset-1 scale-110'
                          : 'hover:scale-110 hover:shadow-md'
                      }`}
                      style={{
                        backgroundColor: c,
                        border: c === '#ffffff' || c === '#efefef' || c === '#f3f3f3' ? '1px solid #e2e8f0' : 'none',
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer - hex input */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <div
            className="w-8 h-8 rounded-lg border border-slate-200 shrink-0"
            style={{ backgroundColor: currentColor }}
          />
          <div className="flex-1 flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
            <input
              type="text"
              value={hexInput.toUpperCase()}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleHexSubmit()}
              className="flex-1 px-3 py-2 text-sm font-mono text-slate-700 focus:outline-none bg-transparent"
              placeholder="#000000"
              maxLength={7}
            />
          </div>
          <button
            type="button"
            onClick={() => nativeRef.current?.click()}
            className="p-2 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
            title="색상 선택기"
          >
            <Pipette size={18} />
          </button>
          <input
            ref={nativeRef}
            type="color"
            value={currentColor}
            onChange={(e) => {
              onColorChange(e.target.value);
              setHexInput(e.target.value);
            }}
            className="sr-only"
          />
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal;
