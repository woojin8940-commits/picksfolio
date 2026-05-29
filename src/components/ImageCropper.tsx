import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Crop } from 'lucide-react';

interface ImageCropperProps {
  src: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
  aspectRatio?: number;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ImageCropper: React.FC<ImageCropperProps> = ({ src, onCrop, onCancel, aspectRatio }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [displayRect, setDisplayRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; crop: CropRect } | null>(null);

  const calcDisplayRect = useCallback(() => {
    if (!containerRef.current || !naturalSize.w) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const padding = 40;
    const maxW = cw - padding * 2;
    const maxH = ch - padding * 2 - 100;
    const scale = Math.min(maxW / naturalSize.w, maxH / naturalSize.h, 1);
    const dw = naturalSize.w * scale;
    const dh = naturalSize.h * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - 100 - dh) / 2;
    return { x: dx, y: dy, w: dw, h: dh };
  }, [naturalSize]);

  const computeFixedCropSize = useCallback((dr: { w: number; h: number }) => {
    const ratio = aspectRatio || 1;
    let cw: number, ch: number;
    if (dr.w / dr.h > ratio) {
      ch = dr.h;
      cw = ch * ratio;
    } else {
      cw = dr.w;
      ch = cw / ratio;
    }
    return { w: cw, h: ch };
  }, [aspectRatio]);

  useEffect(() => {
    if (!imgLoaded || !naturalSize.w) return;
    const dr = calcDisplayRect();
    if (!dr) return;
    setDisplayRect(dr);
    const { w: cw, h: ch } = computeFixedCropSize(dr);
    setCrop({
      x: dr.x + (dr.w - cw) / 2,
      y: dr.y + (dr.h - ch) / 2,
      w: cw,
      h: ch,
    });
  }, [imgLoaded, naturalSize, calcDisplayRect, computeFixedCropSize]);

  useEffect(() => {
    const onResize = () => {
      if (!imgLoaded || !naturalSize.w) return;
      const dr = calcDisplayRect();
      if (!dr) return;
      const oldDr = displayRect;
      if (oldDr.w === 0) return;
      setDisplayRect(dr);
      const { w: cw, h: ch } = computeFixedCropSize(dr);
      const scaleX = dr.w / oldDr.w;
      const scaleY = dr.h / oldDr.h;
      const newX = dr.x + (crop.x - oldDr.x) * scaleX;
      const newY = dr.y + (crop.y - oldDr.y) * scaleY;
      const clampedX = Math.max(dr.x, Math.min(newX, dr.x + dr.w - cw));
      const clampedY = Math.max(dr.y, Math.min(newY, dr.y + dr.h - ch));
      setCrop({ x: clampedX, y: clampedY, w: cw, h: ch });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [imgLoaded, naturalSize, displayRect, calcDisplayRect, computeFixedCropSize, crop]);

  const clampPosition = useCallback((c: CropRect): CropRect => {
    const x = Math.max(displayRect.x, Math.min(c.x, displayRect.x + displayRect.w - c.w));
    const y = Math.max(displayRect.y, Math.min(c.y, displayRect.y + displayRect.h - c.h));
    return { x, y, w: c.w, h: c.h };
  }, [displayRect]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, crop: { ...crop } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [crop]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    const s = dragStart.current.crop;
    setCrop(clampPosition({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }));
  }, [dragging, clampPosition]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const up = () => { setDragging(false); dragStart.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging]);

  const handleConfirm = useCallback(() => {
    if (!naturalSize.w || !displayRect.w) return;
    const scale = naturalSize.w / displayRect.w;
    const sx = (crop.x - displayRect.x) * scale;
    const sy = (crop.y - displayRect.y) * scale;
    const sw = crop.w * scale;
    const sh = crop.h * scale;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    if (!ctx || !imgRef.current) return;

    ctx.drawImage(imgRef.current, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
      if (blob) onCrop(blob);
    }, 'image/png', 1.0);
  }, [naturalSize, displayRect, crop, onCrop]);

  const handleImgLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    setImgLoaded(true);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
        touchAction: 'none', userSelect: 'none',
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <button
        onClick={onCancel}
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 30,
          background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 8,
        }}
      >
        <X size={28} />
      </button>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <img
          ref={imgRef}
          src={src}
          alt=""
          crossOrigin="anonymous"
          onLoad={handleImgLoad}
          style={{ display: 'none' }}
        />

        {imgLoaded && displayRect.w > 0 && (
          <>
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: displayRect.x, top: displayRect.y,
                width: displayRect.w, height: displayRect.h,
                opacity: 0.35,
                pointerEvents: 'none',
              }}
            />

            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                </mask>
              </defs>
            </svg>

            <div
              style={{
                position: 'absolute',
                left: crop.x, top: crop.y, width: crop.w, height: crop.h,
                overflow: 'hidden', pointerEvents: 'none',
              }}
            >
              <img
                src={src}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: displayRect.x - crop.x,
                  top: displayRect.y - crop.y,
                  width: displayRect.w,
                  height: displayRect.h,
                  pointerEvents: 'none',
                }}
              />
            </div>

            <div
              style={{
                position: 'absolute',
                left: crop.x, top: crop.y, width: crop.w, height: crop.h,
                border: '2px solid #3B82F6',
                boxSizing: 'border-box',
                cursor: dragging ? 'grabbing' : 'grab',
              }}
              onPointerDown={handlePointerDown}
            />
          </>
        )}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingBottom: 32, paddingTop: 12, gap: 16,
      }}>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
          영역을 드래그하여 이동하면서<br />노출될 부분을 선택하세요
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 32px', borderRadius: 8,
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            style={{
              padding: '8px', borderRadius: 8,
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={() => {
              if (!displayRect.w) return;
              const { w: cw, h: ch } = computeFixedCropSize(displayRect);
              setCrop({
                x: displayRect.x + (displayRect.w - cw) / 2,
                y: displayRect.y + (displayRect.h - ch) / 2,
                w: cw,
                h: ch,
              });
            }}
          >
            <Crop size={20} />
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '10px 32px', borderRadius: 8,
              background: '#3B82F6', color: '#fff',
              border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}
          >
            선택
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropper;
