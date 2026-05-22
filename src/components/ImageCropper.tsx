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

type HandlePos = 'tl' | 'tr' | 'bl' | 'br';

const MIN_CROP = 40;

const ImageCropper: React.FC<ImageCropperProps> = ({ src, onCrop, onCancel, aspectRatio }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [displayRect, setDisplayRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [dragging, setDragging] = useState<'move' | HandlePos | null>(null);
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

  useEffect(() => {
    if (!imgLoaded || !naturalSize.w) return;
    const dr = calcDisplayRect();
    if (!dr) return;
    setDisplayRect(dr);
    const inset = Math.min(dr.w, dr.h) * 0.05;
    let cw = dr.w - inset * 2;
    let ch = dr.h - inset * 2;
    if (aspectRatio) {
      if (cw / ch > aspectRatio) {
        cw = ch * aspectRatio;
      } else {
        ch = cw / aspectRatio;
      }
    }
    setCrop({
      x: dr.x + (dr.w - cw) / 2,
      y: dr.y + (dr.h - ch) / 2,
      w: cw,
      h: ch,
    });
  }, [imgLoaded, naturalSize, calcDisplayRect, aspectRatio]);

  useEffect(() => {
    const onResize = () => {
      if (!imgLoaded || !naturalSize.w) return;
      const dr = calcDisplayRect();
      if (!dr) return;
      const oldDr = displayRect;
      if (oldDr.w === 0) return;
      const scaleX = dr.w / oldDr.w;
      const scaleY = dr.h / oldDr.h;
      setDisplayRect(dr);
      setCrop(prev => ({
        x: dr.x + (prev.x - oldDr.x) * scaleX,
        y: dr.y + (prev.y - oldDr.y) * scaleY,
        w: prev.w * scaleX,
        h: prev.h * scaleY,
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [imgLoaded, naturalSize, displayRect, calcDisplayRect]);

  const clampCrop = useCallback((c: CropRect): CropRect => {
    let { x, y, w, h } = c;
    w = Math.max(MIN_CROP, Math.min(w, displayRect.w));
    h = Math.max(MIN_CROP, Math.min(h, displayRect.h));
    x = Math.max(displayRect.x, Math.min(x, displayRect.x + displayRect.w - w));
    y = Math.max(displayRect.y, Math.min(y, displayRect.y + displayRect.h - h));
    return { x, y, w, h };
  }, [displayRect]);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: 'move' | HandlePos) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(mode);
    dragStart.current = { mx: e.clientX, my: e.clientY, crop: { ...crop } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [crop]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    const s = dragStart.current.crop;

    if (dragging === 'move') {
      setCrop(clampCrop({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }));
      return;
    }

    let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
    if (dragging === 'tl') { nx = s.x + dx; ny = s.y + dy; nw = s.w - dx; nh = s.h - dy; }
    else if (dragging === 'tr') { ny = s.y + dy; nw = s.w + dx; nh = s.h - dy; }
    else if (dragging === 'bl') { nx = s.x + dx; nw = s.w - dx; nh = s.h + dy; }
    else if (dragging === 'br') { nw = s.w + dx; nh = s.h + dy; }

    if (aspectRatio) {
      if (dragging === 'tl' || dragging === 'bl') {
        nh = nw / aspectRatio;
        if (dragging === 'tl') ny = s.y + s.h - nh;
      } else {
        nh = nw / aspectRatio;
        if (dragging === 'tr') ny = s.y + s.h - nh;
      }
    }

    if (nw < MIN_CROP) { nw = MIN_CROP; nx = dragging === 'tl' || dragging === 'bl' ? s.x + s.w - MIN_CROP : s.x; }
    if (nh < MIN_CROP) { nh = MIN_CROP; ny = dragging === 'tl' || dragging === 'tr' ? s.y + s.h - MIN_CROP : s.y; }

    setCrop(clampCrop({ x: nx, y: ny, w: nw, h: nh }));
  }, [dragging, clampCrop, aspectRatio]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    dragStart.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const up = () => { setDragging(null); dragStart.current = null; };
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

  const handleCornerStyle = (pos: HandlePos): React.CSSProperties => {
    const size = 20;
    const offset = -4;
    const base: React.CSSProperties = {
      position: 'absolute', width: size, height: size, zIndex: 20,
    };
    if (pos === 'tl') return { ...base, top: offset, left: offset, cursor: 'nwse-resize' };
    if (pos === 'tr') return { ...base, top: offset, right: offset, cursor: 'nesw-resize' };
    if (pos === 'bl') return { ...base, bottom: offset, left: offset, cursor: 'nesw-resize' };
    return { ...base, bottom: offset, right: offset, cursor: 'nwse-resize' };
  };

  const renderCornerHandle = (pos: HandlePos) => {
    const borderW = '3px solid #FF6B00';
    const borderStyles: Record<HandlePos, React.CSSProperties> = {
      tl: { borderTop: borderW, borderLeft: borderW, borderRadius: '4px 0 0 0' },
      tr: { borderTop: borderW, borderRight: borderW, borderRadius: '0 4px 0 0' },
      bl: { borderBottom: borderW, borderLeft: borderW, borderRadius: '0 0 0 4px' },
      br: { borderBottom: borderW, borderRight: borderW, borderRadius: '0 0 4px 0' },
    };
    return (
      <div
        key={pos}
        style={{ ...handleCornerStyle(pos), ...borderStyles[pos] }}
        onPointerDown={e => handlePointerDown(e, pos)}
      />
    );
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
                border: '2px solid #FF6B00',
                boxSizing: 'border-box',
                cursor: dragging === 'move' ? 'grabbing' : 'grab',
              }}
              onPointerDown={e => handlePointerDown(e, 'move')}
            >
              {(['tl', 'tr', 'bl', 'br'] as HandlePos[]).map(renderCornerHandle)}
            </div>
          </>
        )}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingBottom: 32, paddingTop: 12, gap: 16,
      }}>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
          크기, 위치를 자유롭게 변경하여<br />표시 영역을 조절할 수 있습니다
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
              setCrop({
                x: displayRect.x,
                y: displayRect.y,
                w: displayRect.w,
                h: displayRect.h,
              });
            }}
          >
            <Crop size={20} />
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '10px 32px', borderRadius: 8,
              background: '#FF6B00', color: '#fff',
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
