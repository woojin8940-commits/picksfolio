// 얼굴형 조정 (face-shape reshaping) — real geometric warping, not a color filter.
//
// Beauty-cam platforms (yycam 등) don't just brighten skin; they physically
// reshape the face: slimming the cheeks, sculpting a V-line jaw, enlarging the
// eyes and slimming the nose. That needs two things this module provides,
// both entirely on-device with no SDK / token / API key:
//
//   1. ensureFaceLandmarker() — lazily loads Google MediaPipe's FaceLandmarker
//      (468-point face mesh) from a public CDN. Detection runs locally in WASM.
//   2. warpFaceShape() — applies a liquify-style mesh warp to the live canvas,
//      using the detected landmarks to drive local displacement fields.
//
// The detector returns landmarks synchronously per video frame, so it slots
// directly into the existing canvas draw loop.

// Per-control 강도, 0-100. All are 0 = no geometric change.
export interface FaceShapeSettings {
  face: number;    // 광대 슬림    — narrow the cheek/cheekbone silhouette (cheeks in)
  jaw: number;     // 턱 슬림      — sculpt the lower jaw toward a slim V-line chin
  eye: number;     // 눈 크게      — enlarge both eyes
  nose: number;    // 코 슬림      — slim the width of the nose
  midface: number; // 중안부 줄이기 — shorten the eye→nose distance (lift the nose region up)
}

export const FACE_SHAPE_OFF: FaceShapeSettings = { face: 0, jaw: 0, eye: 0, nose: 0, midface: 0 };

export function hasFaceShape(s: FaceShapeSettings): boolean {
  return s.face > 0 || s.jaw > 0 || s.eye > 0 || s.nose > 0 || s.midface > 0;
}

// ----------------------------------------------------------------------------
// MediaPipe FaceLandmarker loading (CDN, lazy, single shared instance).
// ----------------------------------------------------------------------------

// Pinned version so the WASM runtime and the JS bundle always match.
const MP_VERSION = '0.10.18';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// A normalized landmark from MediaPipe (x, y in 0..1 of the input image).
export interface NormPoint { x: number; y: number; z?: number }

interface FaceLandmarkerLike {
  detectForVideo: (input: CanvasImageSource, timestampMs: number) => { faceLandmarks?: NormPoint[][] };
}

let landmarker: FaceLandmarkerLike | null = null;
let landmarkerPromise: Promise<FaceLandmarkerLike | null> | null = null;

// Resolves to the shared FaceLandmarker, or null if loading failed (e.g. the
// device/browser can't reach the CDN). Callers should treat null as "shape
// adjustment unavailable" and fall back to the unwarped frame.
export function ensureFaceLandmarker(): Promise<FaceLandmarkerLike | null> {
  if (landmarker) return Promise.resolve(landmarker);
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        // Runtime CDN import — kept dynamic so the bundler doesn't try to
        // resolve it at build time.
        const vision: any = await import(/* @vite-ignore */ MP_BUNDLE);
        const { FaceLandmarker, FilesetResolver } = vision;
        const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
        const created = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
        landmarker = created as FaceLandmarkerLike;
        return landmarker;
      } catch (err) {
        console.warn('[faceReshape] FaceLandmarker load failed; shape adjustment disabled', err);
        landmarker = null;
        return null;
      }
    })();
  }
  return landmarkerPromise;
}

export function getFaceLandmarker(): FaceLandmarkerLike | null {
  return landmarker;
}

// Detect a single face on the given image source. Returns its landmarks (in
// pixel coordinates of width×height) or null when no face is found. The
// timestamp must strictly increase between calls (VIDEO running mode).
export function detectFaceLandmarks(
  src: CanvasImageSource,
  timestampMs: number,
  width: number,
  height: number,
): { x: number; y: number }[] | null {
  if (!landmarker) return null;
  let result: { faceLandmarks?: NormPoint[][] };
  try {
    result = landmarker.detectForVideo(src, timestampMs);
  } catch {
    return null;
  }
  const lm = result?.faceLandmarks?.[0];
  if (!lm || lm.length < 468) return null;
  const out = new Array<{ x: number; y: number }>(lm.length);
  for (let i = 0; i < lm.length; i++) {
    out[i] = { x: lm[i].x * width, y: lm[i].y * height };
  }
  return out;
}

// ----------------------------------------------------------------------------
// Liquify-style mesh warp.
// ----------------------------------------------------------------------------

// MediaPipe FaceMesh canonical landmark indices we drive the warp from.
const IDX = {
  noseTip: 1,
  chin: 152,
  foreheadTop: 10,
  // cheekbone (광대) silhouette only — the widest zygomatic point (234/454)
  // plus the contour point just above it (127/356). The lower points toward
  // the jaw angle (132/361) are intentionally excluded so cheekbone slim
  // moves only the cheekbone, not the jaw.
  cheekL: [127, 234],
  cheekR: [356, 454],
  // lower jaw silhouette toward the chin
  jawL: [58, 172, 136, 150],
  jawR: [288, 397, 365, 379],
  // eye ring points used to find each eye's center + size
  eyeL: [33, 133, 159, 145],
  eyeR: [263, 362, 386, 374],
  // outer nose-side points
  noseL: 129,
  noseR: 358,
  // 중안부 (mid-face) anchors — the nose region only (tip, alar wings, alar
  // base). Lifting these straight up shortens the eye→nose distance. The radius
  // stays tight enough that the eyes (well above) and the mouth (below) are left
  // untouched — only the middle third of the face compresses.
  midface: [1, 129, 358, 98, 327],
};

type Pt = { x: number; y: number };

// Two kinds of displacement primitives, both expressed as additive offsets so
// many can be summed at a single point:
//   translation — moves content at `c` by (tx,ty) within radius r (face/jaw/nose)
//   bulge       — magnifies content around `c` within radius r (eyes)
interface TransOp { cx: number; cy: number; r2: number; tx: number; ty: number }
interface BulgeOp { cx: number; cy: number; r: number; k: number }

function buildOps(lm: Pt[], s: FaceShapeSettings) {
  const trans: TransOp[] = [];
  const bulges: BulgeOp[] = [];

  const P = (i: number) => lm[i];
  const avg = (idxs: number[]): Pt => {
    let x = 0, y = 0;
    for (const i of idxs) { x += lm[i].x; y += lm[i].y; }
    return { x: x / idxs.length, y: y / idxs.length };
  };
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const nose = P(IDX.noseTip);
  const chin = P(IDX.chin);
  const top = P(IDX.foreheadTop);
  const faceH = Math.max(1, dist(top, chin));
  const cx = nose.x; // vertical mid-line of the face

  // 광대 슬림 — push the cheekbone silhouette horizontally toward the mid-line.
  // Only the cheekbone-level contour points are driven (see IDX.cheekL/cheekR),
  // so the cheekbone narrows on its own: the radius is held tight around the
  // cheekbone so the warp neither reaches the mid-line (eyes / nose / mouth stay
  // put) nor drifts down into the jaw, and it never spills into the background.
  // The radius is small enough that it does not extend inward to the eyes — the
  // peak displacement still sits on the silhouette point, so slimming is just as
  // strong while the eyes are left untouched.
  if (s.face > 0) {
    const amt = s.face / 100;
    const r = faceH * 0.12;
    const push = faceH * 0.006 * amt;
    for (const i of [...IDX.cheekL, ...IDX.cheekR]) {
      const p = P(i);
      const dir = Math.sign(cx - p.x) || 1;
      trans.push({ cx: p.x, cy: p.y, r2: r * r, tx: dir * push, ty: 0 });
    }
  }

  // 턱 슬림 — pull the lower jaw inward and slightly up, plus lift the chin.
  // The coefficients give a clear V-line refinement, and the radius is held
  // close to the jawline so only the jaw moves — the mouth (its corners sit
  // above the jaw points), nose and eyes stay put, and the surrounding
  // background is left untouched. The chin-lift radius is likewise tightened so
  // it does not reach up to the mouth.
  if (s.jaw > 0) {
    const amt = s.jaw / 100;
    const r = faceH * 0.13;
    const pushX = faceH * 0.0048 * amt;
    const lift = faceH * 0.0024 * amt;
    for (const i of [...IDX.jawL, ...IDX.jawR]) {
      const p = P(i);
      const dir = Math.sign(cx - p.x) || 1;
      trans.push({ cx: p.x, cy: p.y, r2: r * r, tx: dir * pushX, ty: -lift });
    }
    trans.push({ cx: chin.x, cy: chin.y, r2: (faceH * 0.12) * (faceH * 0.12), tx: 0, ty: -faceH * 0.0032 * amt });
  }

  // 눈 크게 — bulge (magnify) around each eye centre. The radius is kept close
  // to the eye itself so the magnification decays to zero before it reaches the
  // cheekbone — only the eye grows, the cheek beside it stays its real size.
  if (s.eye > 0) {
    const k = (s.eye / 100) * 0.18;
    const le = avg(IDX.eyeL);
    const re = avg(IDX.eyeR);
    const eyeW = Math.max(1, dist(P(33), P(133)));
    const r = eyeW * 1.45;
    bulges.push({ cx: le.x, cy: le.y, r, k });
    bulges.push({ cx: re.x, cy: re.y, r, k });
  }

  // 코 슬림 — push the nose sides toward the nose centre. The radius is held
  // tight around the nostril wings so the warp does not reach down to the
  // philtrum or the mouth below — only the nose narrows.
  if (s.nose > 0) {
    const amt = s.nose / 100;
    const r = faceH * 0.1;
    const push = faceH * 0.02 * amt;
    const ln = P(IDX.noseL);
    const rn = P(IDX.noseR);
    trans.push({ cx: ln.x, cy: ln.y, r2: r * r, tx: (Math.sign(nose.x - ln.x) || 1) * push, ty: 0 });
    trans.push({ cx: rn.x, cy: rn.y, r2: r * r, tx: (Math.sign(nose.x - rn.x) || 1) * push, ty: 0 });
  }

  // 중안부 줄이기 — shorten the mid-face (the eye→nose third) by lifting the nose
  // region straight up. Pulling the nose toward the eye-line compresses the band
  // between them, so the middle of the face reads shorter. Only an upward
  // displacement is applied (tx = 0), and the radius is held tight around the
  // nose so it decays before it reaches the eyes above or the mouth below — the
  // jaw, eyes, mouth and background are all left exactly where they were.
  if (s.midface > 0) {
    const amt = s.midface / 100;
    const r = faceH * 0.11;
    const lift = faceH * 0.03 * amt;
    for (const i of IDX.midface) {
      const p = P(i);
      trans.push({ cx: p.x, cy: p.y, r2: r * r, tx: 0, ty: -lift });
    }
  }

  return { trans, bulges };
}

// Inverse map: for a destination point (px,py) on the output, return the
// source point to sample from the original frame. Displacements accumulate.
function inverseSample(px: number, py: number, trans: TransOp[], bulges: BulgeOp[]): Pt {
  let sx = px, sy = py;
  for (const o of trans) {
    const dx = px - o.cx, dy = py - o.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < o.r2) {
      const t2 = o.tx * o.tx + o.ty * o.ty;
      const base = (o.r2 - d2) / (o.r2 - d2 + t2);
      const f = base * base;
      sx -= f * o.tx;
      sy -= f * o.ty;
    }
  }
  for (const b of bulges) {
    const dx = px - b.cx, dy = py - b.cy;
    const r = Math.hypot(dx, dy);
    if (r < b.r) {
      const tnorm = r / b.r;
      // f < 1 near the centre → samples a smaller source region → magnifies.
      const f = 1 - b.k * (1 - tnorm) * (1 - tnorm);
      sx += (f - 1) * dx;
      sy += (f - 1) * dy;
    }
  }
  return { x: sx, y: sy };
}

// Texture-map a source triangle (u,v) onto a destination triangle (x,y) by
// clipping to the destination and applying the affine transform that carries
// one onto the other.
function drawTexTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
) {
  const D = u0 * (v1 - v2) - v0 * (u1 - u2) + (u1 * v2 - u2 * v1);
  if (D === 0) return;
  const a = (x0 * (v1 - v2) - v0 * (x1 - x2) + (x1 * v2 - x2 * v1)) / D;
  const c = (u0 * (x1 - x2) - x0 * (u1 - u2) + (u1 * x2 - u2 * x1)) / D;
  const e = (u0 * (v1 * x2 - v2 * x1) - v0 * (u1 * x2 - u2 * x1) + x0 * (u1 * v2 - u2 * v1)) / D;
  const b = (y0 * (v1 - v2) - v0 * (y1 - y2) + (y1 * v2 - y2 * v1)) / D;
  const d = (u0 * (y1 - y2) - y0 * (u1 - u2) + (u1 * y2 - u2 * y1)) / D;
  const f = (u0 * (v1 * y2 - v2 * y1) - v0 * (u1 * y2 - u2 * y1) + y0 * (u1 * v2 - u2 * v1)) / D;

  // Slightly inflate the destination triangle around its centroid so adjacent
  // cells overlap by a sub-pixel and no thin seams show between them.
  const gx = (x0 + x1 + x2) / 3, gy = (y0 + y1 + y2) / 3;
  const EXP = 0.6;
  const ex = (x: number, y: number, ax: 'x' | 'y') => {
    const vx = x - gx, vy = y - gy;
    const len = Math.hypot(vx, vy) || 1;
    return ax === 'x' ? x + (vx / len) * EXP : y + (vy / len) * EXP;
  };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ex(x0, y0, 'x'), ex(x0, y0, 'y'));
  ctx.lineTo(ex(x1, y1, 'x'), ex(x1, y1, 'y'));
  ctx.lineTo(ex(x2, y2, 'x'), ex(x2, y2, 'y'));
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

const GRID = 16; // cells per axis over the face region

// Warp the face region of `src` onto `ctx`. The caller must already have drawn
// the un-warped frame to `ctx` (this overdraws only the face region, whose
// boundary displacement is ~0 so it blends seamlessly).
export function warpFaceShape(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  landmarks: Pt[],
  width: number,
  height: number,
  settings: FaceShapeSettings,
): void {
  if (!hasFaceShape(settings)) return;
  const { trans, bulges } = buildOps(landmarks, settings);
  if (trans.length === 0 && bulges.length === 0) return;

  // Face bounding box from the landmarks, padded just enough that every warp
  // radius decays to zero before the grid edge. The padding is kept modest so
  // the resampled grid hugs the face: everything outside it stays exactly as
  // the originally-drawn frame, so the background no longer ripples with the
  // warp.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const padX = (maxX - minX) * 0.35;
  const padY = (maxY - minY) * 0.35;
  const x0 = Math.max(0, minX - padX);
  const y0 = Math.max(0, minY - padY);
  const x1 = Math.min(width, maxX + padX);
  const y1 = Math.min(height, maxY + padY);
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;

  // Destination vertices are a regular grid; source vertices are the inverse
  // warp of each, so drawing src→dst triangles "pulls" content into shape.
  const cols = GRID, rows = GRID;
  const dst: Pt[] = new Array((cols + 1) * (rows + 1));
  const srcPts: Pt[] = new Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const px = x0 + (bw * c) / cols;
      const py = y0 + (bh * r) / rows;
      const i = r * (cols + 1) + c;
      dst[i] = { x: px, y: py };
      srcPts[i] = inverseSample(px, py, trans, bulges);
    }
  }

  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = r * (cols + 1) + c;
      const i10 = i00 + 1;
      const i01 = i00 + (cols + 1);
      const i11 = i01 + 1;
      const d00 = dst[i00], d10 = dst[i10], d01 = dst[i01], d11 = dst[i11];
      const s00 = srcPts[i00], s10 = srcPts[i10], s01 = srcPts[i01], s11 = srcPts[i11];
      drawTexTriangle(ctx, src,
        s00.x, s00.y, s10.x, s10.y, s11.x, s11.y,
        d00.x, d00.y, d10.x, d10.y, d11.x, d11.y);
      drawTexTriangle(ctx, src,
        s00.x, s00.y, s11.x, s11.y, s01.x, s01.y,
        d00.x, d00.y, d11.x, d11.y, d01.x, d01.y);
    }
  }
  ctx.imageSmoothingEnabled = prevSmoothing;
}
