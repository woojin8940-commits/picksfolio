// Banuba Face AR Web SDK wrapper — real-time face beautification (얼굴 보정).
//
// The live broadcast pipeline in LiveStreaming.tsx is "camera → hidden <video>
// → canvas (drawFrame) → captureStream → WebRTC / IVS / recording". This module
// inserts Banuba between the camera and that canvas: it takes the raw camera
// MediaStream, runs face tracking + skin/morph beautification on-device (WASM),
// and exposes a PROCESSED video track. LiveStreaming attaches that track to a
// second hidden <video> and draws it instead of the raw camera, so the mirror,
// CSS color filters, captureStream, IVS send and local recording downstream all
// inherit the beautified image with no further changes.
//
// The SDK (~several MB of WASM + neural models) is loaded lazily from the
// jsDelivr CDN only when the broadcaster turns 얼굴 보정 on, so it never affects
// normal page load. The client token is a public, domain-bound identifier (like
// the Toss client key) supplied via the VITE_BANUBA_TOKEN build env var.

// Pin the SDK to the version the bundled beauty effect (public/assets/banuba/
// face-beauty.zip, taken from Banuba's beauty-web sample) was authored against,
// so the effect and engine stay compatible.
const SDK_VERSION = '1.17.0';
const SDK_BASE = `https://cdn.jsdelivr.net/npm/@banuba/webar@${SDK_VERSION}/dist`;
const SDK_ENTRY = `${SDK_BASE}/BanubaSDK.browser.esm.min.js`;

// Modules are the on-device neural detectors the beauty effect depends on:
// face_tracker locates the 68 face points (and drives the FaceMorph reshaping),
// skin/eyes/lips power the retouch and whitening. They live next to the engine
// on the same CDN. (Only module names that actually exist in the package are
// listed — e.g. there is no standalone "face" module.)
const MODULES = ['face_tracker', 'skin', 'eyes', 'lips'].map(
  (m) => `${SDK_BASE}/modules/${m}.zip`
);

// Self-hosted effect bundle (served same-origin from /public) — exposes the
// Skin / FaceMorph / Teeth runtime JS API the strength preset below drives.
const EFFECT_URL = '/assets/banuba/face-beauty.zip';

export const BANUBA_TOKEN: string =
  (import.meta as any).env?.VITE_BANUBA_TOKEN || '';

export function isBeautySupported(): boolean {
  // Needs WebAssembly + a configured token. Camera/canvas support is already
  // gated by the broadcast flow itself.
  return typeof WebAssembly !== 'undefined' && !!BANUBA_TOKEN;
}

// Translate a single 0..1 "얼굴 보정 강도" slider into a natural-looking preset:
// strong skin smoothing, gentle teeth/eye whitening, and subtle face/eye morphs
// so the result reads as "polished", not "distorted".
function beautyScript(strength: number): string {
  const s = Math.max(0, Math.min(1, strength));
  const skin = s; // skin softening tracks the slider directly
  const teeth = s * 0.6;
  const eyesMorph = s * 0.25;
  const faceMorph = s * 0.2;
  const noseMorph = s * 0.15;
  return [
    `Skin.softening(${skin.toFixed(3)})`,
    `Teeth.whitening(${teeth.toFixed(3)})`,
    `FaceMorph.eyes(${eyesMorph.toFixed(3)})`,
    `FaceMorph.face(${faceMorph.toFixed(3)})`,
    `FaceMorph.nose(${noseMorph.toFixed(3)})`,
  ].join('\n');
}

export interface BeautyProcessor {
  /** Processed video track to feed the broadcast canvas. */
  getVideoTrack(): MediaStreamTrack | null;
  /** Re-apply the beautification preset at a new strength (0..1). */
  setStrength(strength: number): void;
  /** Release the WASM player and processed stream. */
  destroy(): Promise<void>;
}

/**
 * Build a Banuba beauty processor around an existing camera MediaStream.
 * Returns null (and logs) if the SDK can't load or no token is configured, so
 * the caller can fall back to the raw camera without breaking the broadcast.
 */
export async function createBeautyProcessor(
  cameraStream: MediaStream,
  initialStrength: number
): Promise<BeautyProcessor | null> {
  if (!isBeautySupported()) {
    console.warn('[Banuba] beautification unavailable (no WebAssembly or token).');
    return null;
  }

  let sdk: any;
  try {
    // Full CDN URL — Vite leaves it untouched (@vite-ignore) and the browser
    // loads the ESM module natively, resolving its own .wasm/.data next to it.
    sdk = await import(/* @vite-ignore */ SDK_ENTRY);
  } catch (e) {
    console.warn('[Banuba] failed to load SDK from CDN:', e);
    return null;
  }

  const { Player, Module, Effect, MediaStream: BanubaMediaStream, MediaStreamCapture } = sdk;
  if (!Player || !MediaStreamCapture) {
    console.warn('[Banuba] SDK missing expected exports.');
    return null;
  }

  try {
    const [player, modules, effect] = await Promise.all([
      Player.create({ devicePixelRatio: 1, clientToken: BANUBA_TOKEN }),
      Module.preload(MODULES),
      Effect.preload(EFFECT_URL),
    ]);

    await player.addModule(...modules);
    await player.applyEffect(effect);

    const capture = new MediaStreamCapture(player);
    // Feed the already-acquired camera stream so we don't open a second camera.
    await player.use(new BanubaMediaStream(cameraStream));
    player.play();

    const apply = (strength: number) => {
      try {
        effect.evalJs(beautyScript(strength));
      } catch (e) {
        console.warn('[Banuba] evalJs failed:', e);
      }
    };
    apply(initialStrength);

    return {
      getVideoTrack: () => {
        try {
          return capture.getVideoTracks()[0] ?? null;
        } catch {
          return null;
        }
      },
      setStrength: apply,
      destroy: async () => {
        try { player.pause?.(); } catch {}
        try { await player.clearEffect?.(); } catch {}
        try { player.destroy?.(); } catch {}
      },
    };
  } catch (e) {
    console.warn('[Banuba] failed to initialize beauty processor:', e);
    return null;
  }
}
