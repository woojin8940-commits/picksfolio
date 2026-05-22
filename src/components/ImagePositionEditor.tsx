import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Move } from 'lucide-react';

interface ImagePositionEditorProps {
  src: string;
  position: { x: number; y: number };
  onChange: (pos: { x: number; y: number }) => void;
  aspectRatio?: string;
  className?: string;
  roundedClass?: string;
}

const ImagePositionEditor: React.FC<ImagePositionEditorProps> = ({
  src,
  position,
  onChange,
  aspectRatio = '16/9',
  className = '',
  roundedClass = 'rounded-2xl',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStart.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragStart.current.x) / rect.width) * -100;
    const dy = ((e.clientY - dragStart.current.y) / rect.height) * -100;
    onChange({
      x: clamp(dragStart.current.posX + dx),
      y: clamp(dragStart.current.posY + dy),
    });
  }, [isDragging, onChange]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    dragStart.current = null;
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const up = () => { setIsDragging(false); dragStart.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden select-none ${roundedClass} ${className}`}
      style={{ aspectRatio }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: `${position.x}% ${position.y}%` }}
      />
      <div
        className={`absolute inset-0 flex items-center justify-center transition-colors ${
          isDragging ? 'bg-black/30 cursor-grabbing' : 'bg-black/10 hover:bg-black/20 cursor-grab'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/50 backdrop-blur-sm rounded-full text-white text-[10px] font-bold pointer-events-none">
          <Move size={12} />
          <span>드래그하여 위치 조정</span>
        </div>
      </div>
    </div>
  );
};

export default ImagePositionEditor;
