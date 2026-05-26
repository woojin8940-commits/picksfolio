
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, MessageCircle, X, Send, Camera, Mic, MicOff, CameraOff, Monitor, Settings, Image as ImageIcon, Layout, Upload, Trash2, FlipHorizontal2, Sparkles, Sun, Contrast, Droplets, Thermometer, Eye, Radio, Copy, Check, ShoppingBag, Package, BarChart3, TrendingUp } from 'lucide-react';
import { apiService } from '../services/apiService';
import { BroadcasterSignaling, ChatMessage } from '../services/webrtcSignaling';
import { IVSBroadcaster } from '../services/ivsBroadcaster';

import SafeImage from './SafeImage';

interface LiveStreamingProps {
  userName: string;
  onClose: () => void;
  // Ephemeral product selection picked in 라이브 커머스 → 방송 상품 설정 for this
  // broadcast. Empty array means "no filter, show every registered product".
  selectedProductIds?: string[];
}

interface MaterialItem {
  id: string;
  name: string;
  type: 'banner' | 'product' | 'image';
  url: string;
  width: number; // percentage 10-100
  opacity: number; // 0-100
}

interface VideoFilters {
  brightness: number;   // 50-150, default 100
  contrast: number;     // 50-150, default 100
  saturation: number;   // 0-200, default 100
  warmth: number;       // 0-100, default 0 (sepia %)
  blur: number;         // 0-5, default 0 (px)
}

const DEFAULT_FILTERS: VideoFilters = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0 };

// Mobile-web optimized broadcast profile. Applied uniformly to all senders:
// 1080p @ 60fps from a phone overheats the encoder and produces severe frame
// drops on viewers; capping every broadcaster at 720p30 with a 2-second GOP
// keeps mobile devices within thermal budget. Bitrate is held at 4.5 Mbps —
// near-transparent for 720p H.264 on detail-heavy commerce subjects (apparel,
// cosmetics) while leaving uplink headroom on typical LTE/5G.
const MAX_QUALITY = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitrate: 4_500_000,
  keyframeIntervalSec: 2,
  description: '720p 30fps (mobile-web optimized)',
};

const LiveStreaming: React.FC<LiveStreamingProps> = ({ userName, onClose, selectedProductIds }) => {
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [showMaterialPanel, setShowMaterialPanel] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newMaterialType, setNewMaterialType] = useState<'banner' | 'product' | 'image'>('banner');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isMirrored, setIsMirrored] = useState(true);
  const [filters, setFilters] = useState<VideoFilters>(DEFAULT_FILTERS);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [actualResolution, setActualResolution] = useState<string>('');

  // AWS IVS Stream State
  const [ivsConfig, setIvsConfig] = useState<{ ingestServer: string; streamKey: string; playbackUrl: string; rtmpUrl: string } | null>(null);
  const [ivsLoading, setIvsLoading] = useState(true);
  const [showStreamInfo, setShowStreamInfo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [capBlock, setCapBlock] = useState<{ kind: 'monthly' | 'daily'; message: string } | null>(null);

  // Live Products & Cart State
  const [liveProducts, setLiveProducts] = useState<{ id: string; name: string; price?: string; image?: string; link?: string; blockTitle?: string; options?: { id: string; name: string; values: any[] }[] }[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [showProductPanel, setShowProductPanel] = useState(false);
  const [showCartPanel, setShowCartPanel] = useState(false);
  const [cartStats, setCartStats] = useState<{ totalViewers: number; totalItems: number; totalRevenue: number; productCounts: { productId: string; name: string; count: number; image?: string; link: string; price?: string; optionCounts: Record<string, Record<string, number>> }[] } | null>(null);
  const [cartCarts, setCartCarts] = useState<any[]>([]);
  const [cartError, setCartError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const signalingRef = useRef<BroadcasterSignaling | null>(null);
  const ivsBroadcasterRef = useRef<IVSBroadcaster | null>(null);
  const [ivsBroadcasting, setIvsBroadcasting] = useState(false);
  const [liveUsage, setLiveUsage] = useState<{
    monthLabel: string;
    totalMinutes: number;
    includedMinutesRemaining: number;
    overageMinutes: number;
    overageAmountKrw: number;
  } | null>(null);
  const isLiveRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<VideoFilters>(DEFAULT_FILTERS);
  const isMirroredRef = useRef(true);
  const broadcastStartTimeRef = useRef<string>('');
  const broadcastIdRef = useRef<string>('');
  const peakViewerCountRef = useRef(0);

  // Local recording: capture the same canvas stream that gets broadcast, plus
  // the live audio track. The full recording is uploaded to Netlify Blobs on
  // broadcast stop so an admin can replay it later in the admin dashboard.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>('video/webm');

  // Background tab streaming: WebAudio timing loop keeps canvas alive when tab is hidden
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgTimerNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const isBackgroundRef = useRef(false);
  const lastDrawTimeRef = useRef(0);
  const TARGET_FPS = 30;
  const FRAME_INTERVAL = 1000 / TARGET_FPS; // ~33.3ms


  // Draw a single frame to the canvas (shared by both rAF and background timer)
  const drawFrame = useCallback((sourceVideo: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    if (!sourceVideo.videoWidth) return;

    // 30fps throttle: skip frame if not enough time has elapsed
    const now = performance.now();
    if (now - lastDrawTimeRef.current < FRAME_INTERVAL) return;
    lastDrawTimeRef.current = now;

    // Double-resolution buffer for high-DPI displays (only on foreground)
    const dpr = isBackgroundRef.current ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const targetW = sourceVideo.videoWidth * dpr;
    const targetH = sourceVideo.videoHeight * dpr;

    // Conditional resize: avoid per-frame memory allocation and context reinitialization
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      // Re-apply after resize (canvas state resets on dimension change)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    const f = filtersRef.current;
    const filterStr = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) sepia(${f.warmth}%) blur(${f.blur}px)`;

    ctx.filter = filterStr;
    ctx.save();
    if (isMirroredRef.current) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  // Start WebAudio-based background timer (keeps canvas alive when tab is hidden)
  const startBackgroundTimer = useCallback((sourceVideo: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    if (audioContextRef.current) return; // Already running

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      // Use ScriptProcessorNode (deprecated but widely supported) as a timing source
      // The onaudioprocess callback fires reliably even when the tab is in the background
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      bgTimerNodeRef.current = processor;

      processor.onaudioprocess = () => {
        if (isBackgroundRef.current) {
          drawFrame(sourceVideo, canvas, ctx);
        }
      };

      // Connect to destination (required for the callback to fire)
      // Create a silent oscillator to keep the audio context alive
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 0; // Silent
      oscillator.connect(gainNode);
      gainNode.connect(processor);
      processor.connect(audioCtx.destination);
      oscillator.start();

      console.log('[LiveStreaming] Background WebAudio timer started');
    } catch (e) {
      console.warn('[LiveStreaming] WebAudio background timer failed, falling back to setInterval:', e);
    }
  }, [drawFrame]);

  const stopBackgroundTimer = useCallback(() => {
    if (bgTimerNodeRef.current) {
      bgTimerNodeRef.current.disconnect();
      bgTimerNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  // Handle page visibility changes for background tab streaming
  useEffect(() => {
    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      isBackgroundRef.current = hidden;

      if (hidden && isLiveRef.current) {
        console.log('[LiveStreaming] Tab hidden — switching to WebAudio background timer');
        const sourceVideo = videoRef.current;
        const canvas = canvasRef.current;
        if (sourceVideo && canvas) {
          const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          if (ctx) {
            startBackgroundTimer(sourceVideo, canvas, ctx);
          }
        }
      } else {
        console.log('[LiveStreaming] Tab visible — switching back to rAF');
        // Background timer keeps running alongside rAF; drawFrame's throttle
        // ensures we don't double-draw
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopBackgroundTimer();
    };
  }, [startBackgroundTimer, stopBackgroundTimer]);

  // Keep the screen awake while the broadcaster is live. Without this, mobile
  // devices lock after a minute of no touch input, which suspends getUserMedia
  // and kills the broadcast. The Wake Lock API is auto-released when the page
  // is hidden, so we also re-acquire on visibilitychange.
  const wakeLockRef = useRef<any>(null);
  useEffect(() => {
    if (!isLive) {
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release?.(); } catch {}
        wakeLockRef.current = null;
      }
      return;
    }
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.wakeLock?.request) return;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock.request('screen');
        wakeLockRef.current = lock;
        lock.addEventListener?.('release', () => {
          // Browser released it (e.g., tab hidden); acquire again when visible.
          wakeLockRef.current = null;
        });
        console.log('[LiveStreaming] Screen wake lock acquired');
      } catch (e) {
        console.warn('[LiveStreaming] Wake lock request failed (non-fatal):', e);
      }
    };

    acquire();

    const onVis = () => {
      if (document.visibilityState === 'visible' && isLiveRef.current && !wakeLockRef.current) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release?.(); } catch {}
        wakeLockRef.current = null;
      }
    };
  }, [isLive]);

  // Clean up live state across all storage layers (called on unmount and explicit stop)
  const cleanupLiveState = useCallback(async () => {
    const normalizedUsername = userName.toLowerCase();
    const liveData = { isLive: false, viewerCount: 0, currentProduct: null };
    try { localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData)); } catch {}
    try { await apiService.saveLiveState(userName, liveData); } catch {}
  }, [userName]);

  // Initialize signaling once
  useEffect(() => {
    const signaling = new BroadcasterSignaling(userName);
    signalingRef.current = signaling;

    // Listen for incoming chat messages from viewers
    signaling.onChat((msg) => {
      setMessages(prev => {
        // Prevent duplicates
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return () => {
      signaling.stop();
      signalingRef.current = null;
      if (ivsBroadcasterRef.current) {
        ivsBroadcasterRef.current.stop().catch(() => {});
        ivsBroadcasterRef.current = null;
      }
      // Explicitly release all MediaStream tracks to free hardware (camera/mic)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (canvasStreamRef.current) {
        canvasStreamRef.current.getTracks().forEach(track => track.stop());
        canvasStreamRef.current = null;
      }
      stopBackgroundTimer();
      // Always clean up live state when component unmounts (e.g., closing the panel)
      cleanupLiveState();
    };
  }, [userName, cleanupLiveState]);

  // Handle browser tab close / navigation: clean up live state via beacon API
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isLiveRef.current) {
        const normalizedUsername = userName.toLowerCase();
        const liveData = JSON.stringify({ isLive: false, viewerCount: 0, currentProduct: null });
        // Use sendBeacon for reliable delivery during page unload
        navigator.sendBeacon(
          `/api/live/${encodeURIComponent(normalizedUsername)}`,
          new Blob([liveData], { type: 'application/json' })
        );
        try { localStorage.setItem(`picks_live_${normalizedUsername}`, liveData); } catch {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [userName]);

  // Fetch AWS IVS stream key automatically (one-click broadcast)
  useEffect(() => {
    const fetchStreamConfig = async () => {
      setIvsLoading(true);
      setCapBlock(null);
      try {
        const config = await apiService.getStreamKey(userName);
        if (config && (config as any).capReached) {
          setCapBlock({
            kind: (config as any).capReached,
            message: (config as any).error || '라이브 송출 한도에 도달했습니다.',
          });
          setIvsConfig(null);
        } else if (config && (config as any).streamKey) {
          setIvsConfig(config as any);
        }
      } catch (e) {
        console.error('[IVS] Failed to fetch stream config:', e);
      } finally {
        setIvsLoading(false);
      }
    };
    fetchStreamConfig();
  }, [userName]);

  // Live time usage (current month: 3h included + 8,900원/h overage). Refresh
  // when the broadcast ends so the badge reflects the just-finished session.
  const refreshLiveUsage = useCallback(async () => {
    try {
      const result = await apiService.getLiveUsage(userName);
      if (result?.usage) {
        setLiveUsage({
          monthLabel: result.usage.monthLabel,
          totalMinutes: result.usage.totalMinutes,
          includedMinutesRemaining: result.usage.includedMinutesRemaining,
          overageMinutes: result.usage.overageMinutes,
          overageAmountKrw: result.usage.overageAmountKrw,
        });
      }
    } catch (e) {
      console.warn('[Live] getLiveUsage failed (non-blocking):', e);
    }
  }, [userName]);

  useEffect(() => {
    refreshLiveUsage();
  }, [refreshLiveUsage]);

  // Sync refs for use in animation loop
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);

  // Load pre-configured live products. Filter to the seller's per-broadcast
  // selection passed in from LiveCommerceManagement; if no selection was made,
  // fall back to showing every registered product.
  useEffect(() => {
    const loadProducts = async () => {
      const products = await apiService.getLiveProducts(userName);
      if (!products.length) return;
      const selected = Array.isArray(selectedProductIds) ? selectedProductIds : [];
      const filtered = selected.length
        ? products.filter(p => selected.includes(p.id))
        : products;
      setLiveProducts(filtered.length ? filtered : products);
    };
    loadProducts();
  }, [userName, selectedProductIds]);

  // Poll cart stats while live
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const fetchCartStats = async () => {
      try {
        const data = await apiService.getLiveCartStats(userName);
        if (cancelled) return;
        if (data) {
          const stats = data.stats && typeof data.stats === 'object' ? data.stats : null;
          const carts = Array.isArray(data.carts) ? data.carts : [];
          if (stats) {
            setCartStats({
              totalViewers: stats.totalViewers ?? 0,
              totalItems: stats.totalItems ?? 0,
              totalRevenue: stats.totalRevenue ?? 0,
              productCounts: Array.isArray(stats.productCounts) ? stats.productCounts : [],
            });
          } else {
            setCartStats(null);
          }
          setCartCarts(carts);
          setCartError(false);
        } else {
          setCartError(true);
        }
      } catch {
        if (!cancelled) setCartError(true);
      }
    };
    fetchCartStats();
    const interval = setInterval(fetchCartStats, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, userName]);

  // Push active product + active material to live state so viewers can see them
  useEffect(() => {
    if (!isLive) return;
    const activeProduct = liveProducts.find(p => p.id === activeProductId) || null;
    const material = materials.find(m => m.id === activeMaterialId) || null;
    apiService.saveLiveState(userName, {
      isLive: true,
      viewerCount,
      currentProduct: activeProduct,
      activeMaterial: material
    });
  }, [activeProductId, activeMaterialId, isLive, userName, viewerCount, liveProducts, materials]);

  // Canvas rendering loop: draws video with filters + mirror, produces stream for WebRTC
  // Uses shared drawFrame() with 30fps throttling and background tab support
  const startCanvasLoop = useCallback((sourceVideo: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Maximize rendering quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Reset timing for fresh start
    lastDrawTimeRef.current = 0;

    const draw = () => {
      drawFrame(sourceVideo, canvas, ctx);
      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    // Create stream from canvas at 30fps for reliable WebRTC transmission
    const canvasStream = canvas.captureStream(TARGET_FPS);
    canvasStreamRef.current = canvasStream;

    // Start background timer preemptively so it's ready when tab goes hidden
    startBackgroundTimer(sourceVideo, canvas, ctx);

    return canvasStream;
  }, [drawFrame, startBackgroundTimer]);

  const stopCanvasLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    // Stop WebAudio background timer
    stopBackgroundTimer();
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(t => t.stop());
      canvasStreamRef.current = null;
    }
  }, [stopBackgroundTimer]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    const el = chatEndRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Update viewer count from signaling + server heartbeats
  useEffect(() => {
    if (!isLive) return;
    const updateViewerCount = async () => {
      const webrtcCount = signalingRef.current?.getViewerCount() ?? 0;

      // Also fetch server-side viewer count from heartbeats
      let serverCount = 0;
      try {
        const state = await apiService.getLiveState(userName);
        if (state) {
          serverCount = state.viewerCount || 0;
        }
      } catch {}

      // Use the maximum of WebRTC peers and server-tracked viewers
      const totalCount = Math.max(webrtcCount, serverCount);
      setViewerCount(totalCount);
      if (totalCount > peakViewerCountRef.current) {
        peakViewerCountRef.current = totalCount;
      }
    };
    updateViewerCount();
    const interval = setInterval(updateViewerCount, 3000);
    return () => clearInterval(interval);
  }, [isLive, userName]);

  // Get camera stream and pipe through canvas for filters/mirror
  useEffect(() => {
    let mounted = true;

    if (isCameraOn) {
      const q = MAX_QUALITY;
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: q.width, min: 320 },
          height: { ideal: q.height, min: 240 },
          frameRate: { ideal: q.frameRate, max: q.frameRate, min: 15 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        }
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          streamRef.current = stream;

          // Set content hint for video tracks to optimize encoding for detail
          stream.getVideoTracks().forEach(track => {
            if ('contentHint' in track) {
              track.contentHint = 'detail';
            }
          });

          // Log actual video resolution for debugging
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            const settings = videoTrack.getSettings();
            console.log(`[Camera] Actual resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
            setActualResolution(`${settings.width}x${settings.height}`);
          }

          // Set up hidden source video for canvas rendering
          const sourceVideo = videoRef.current;
          if (sourceVideo) {
            sourceVideo.srcObject = stream;
            // Explicitly play to ensure frames are decoded
            sourceVideo.play().catch(() => {});
          }

          // Apply current mic state to new stream
          stream.getAudioTracks().forEach(track => {
            track.enabled = isMicOn;
          });

          // Start canvas rendering loop
          if (sourceVideo) {
            const canvasStream = startCanvasLoop(sourceVideo);
            // Combine canvas video track + original audio tracks for WebRTC
            if (canvasStream) {
              const audioTracks = stream.getAudioTracks();
              audioTracks.forEach(t => canvasStream.addTrack(t));
              // Update signaling with the canvas stream if live
              if (signalingRef.current && isLiveRef.current) {
                signalingRef.current.updateStream(canvasStream);
              }
            }
          }
        })
        .catch(err => console.error("Error accessing camera:", err));
    } else {
      stopCanvasLoop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    return () => {
      mounted = false;
      stopCanvasLoop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isCameraOn, startCanvasLoop, stopCanvasLoop]);

  // Toggle mic by enabling/disabling audio tracks (no stream recreation)
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMicOn;
      });
    }
  }, [isMicOn]);

  // Load saved materials from localStorage, then cloud
  const materialsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`picks_materials_${userName.toLowerCase()}`);
      if (saved) setMaterials(JSON.parse(saved));
    } catch {}

    // Load from cloud API (authoritative source)
    apiService.getSiteData(userName).then(apiData => {
      if (apiData && Array.isArray(apiData.materials) && apiData.materials.length > 0) {
        setMaterials(apiData.materials);
        localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(apiData.materials));
      }
    })
      .catch(e => console.warn('[LiveStreaming] Failed to load materials from cloud:', e))
      .finally(() => { materialsLoadedRef.current = true; });
  }, [userName]);

  // Save materials to both localStorage and cloud on change (skip until initial load completes
  // so we don't overwrite cloud-stored banners with an empty initial state)
  const saveMaterialsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!materialsLoadedRef.current) return;
    localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(materials));
    // Debounce cloud save to avoid excessive API calls
    if (saveMaterialsRef.current) clearTimeout(saveMaterialsRef.current);
    saveMaterialsRef.current = setTimeout(() => {
      apiService.saveSiteData(userName, { materials }).catch(e =>
        console.warn('[LiveStreaming] Failed to save materials to cloud:', e)
      );
    }, 2000);
  }, [materials, userName]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const id = Date.now().toString();
    const name = newMaterialName || file.name.replace(/\.[^.]+$/, '');
    const type = newMaterialType;
    const width = type === 'banner' ? 90 : 50;

    // Read as data URL first so the thumbnail preview is available instantly,
    // then upload to blob storage and swap in the hosted URL. The hosted URL
    // keeps the live-state payload small so viewers render the banner
    // immediately instead of waiting for a huge base64 string to arrive.
    const dataUrl: string = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve((ev.target?.result as string) || '');
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    }).catch(() => '');

    if (!dataUrl) {
      setNewMaterialName('');
      return;
    }

    const item: MaterialItem = { id, name, type, url: dataUrl, width, opacity: 100 };
    setMaterials(prev => [...prev, item]);
    setNewMaterialName('');

    try {
      const hostedUrl = await apiService.uploadImage(userName, file, file.name);
      if (hostedUrl) {
        // Preload the hosted image so the URL swap does not cause a flash
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = hostedUrl;
        });
        setMaterials(prev => prev.map(m => (m.id === id ? { ...m, url: hostedUrl } : m)));
      }
    } catch (err) {
      console.warn('[LiveStreaming] Banner upload fell back to inline data URL:', err);
    }
  }, [newMaterialName, newMaterialType, userName]);

  const removeMaterial = useCallback((id: string) => {
    setMaterials(prev => prev.filter(m => m.id !== id));
    if (activeMaterialId === id) setActiveMaterialId(null);
  }, [activeMaterialId]);

  const updateMaterialSize = useCallback((id: string, width: number) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, width: Math.max(10, Math.min(100, width)) } : m));
  }, []);

  const activeMaterial = materials.find(m => m.id === activeMaterialId);

  // Preload all material images once loaded so activation renders instantly
  useEffect(() => {
    materials.forEach(m => {
      if (!m.url) return;
      const img = new Image();
      img.decoding = 'sync';
      img.src = m.url;
    });
  }, [materials]);

  /** Validate stream and start WebRTC broadcast — reused by toggleLive and auto-retry */
  const startLocalRecorder = (stream: MediaStream) => {
    if (recorderRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[Recording] MediaRecorder not supported in this browser; replay will be unavailable.');
      return;
    }

    // Build a recorder stream that combines the broadcast canvas (with filters
    // already baked in) with the live mic audio from the raw camera stream.
    const tracks: MediaStreamTrack[] = [];
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);
    const cameraAudio = streamRef.current?.getAudioTracks()[0];
    const fallbackAudio = stream.getAudioTracks()[0];
    const audioTrack = cameraAudio || fallbackAudio;
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) return;

    const recorderStream = new MediaStream(tracks);

    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = candidates.find(t => {
      try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
    }) || '';
    recorderMimeRef.current = mimeType || 'video/webm';

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: 1_500_000 })
        : new MediaRecorder(recorderStream, { videoBitsPerSecond: 1_500_000 });
    } catch (e) {
      console.warn('[Recording] MediaRecorder init failed:', e);
      return;
    }

    recorderChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recorderChunksRef.current.push(ev.data);
    };
    recorder.onerror = (ev) => console.warn('[Recording] recorder error:', ev);
    try {
      // 5-second slice keeps memory growth bounded and lets us recover most of
      // the recording if the tab is closed without a clean stop.
      recorder.start(5000);
      recorderRef.current = recorder;
      console.log('[Recording] started', mimeType);
    } catch (e) {
      console.warn('[Recording] recorder.start failed:', e);
    }
  };

  const stopAndUploadLocalRecorder = async (broadcastId: string, durationSeconds: number) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    const chunks = recorderChunksRef.current;
    recorderChunksRef.current = [];

    // Wait for the recorder to flush its final chunk.
    await new Promise<void>(resolve => {
      const finalize = () => resolve();
      recorder.addEventListener('stop', finalize, { once: true });
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else finalize();
      } catch {
        finalize();
      }
      // Hard timeout in case 'stop' never fires.
      setTimeout(finalize, 4000);
    });

    if (chunks.length === 0) {
      console.warn('[Recording] no chunks captured; skipping upload.');
      return;
    }

    const mime = recorderMimeRef.current || 'video/webm';
    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) return;

    try {
      const url = `/api/broadcast-recording/${encodeURIComponent(userName.toLowerCase())}/${encodeURIComponent(broadcastId)}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
          'x-recording-duration-seconds': String(Math.max(0, Math.round(durationSeconds))),
          'x-recording-size-bytes': String(blob.size),
        },
        body: blob,
      });
      if (!res.ok) {
        console.warn('[Recording] upload failed:', res.status, await res.text().catch(() => ''));
      } else {
        console.log('[Recording] upload complete', blob.size, 'bytes');
      }
    } catch (e) {
      console.warn('[Recording] upload threw:', e);
    }
  };

  const startBroadcastWithStream = (stream: MediaStream) => {
    if (!signalingRef.current) return;

    // Start the local MediaRecorder once we know the broadcast stream is good.
    // The recorder writes to memory; the final blob is uploaded on stop.
    startLocalRecorder(stream);

    const videoTracks = stream.getVideoTracks().filter(t => t.readyState === 'live');
    const audioTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
    console.log(`[Broadcast] Starting with ${videoTracks.length} video, ${audioTracks.length} audio tracks`);

    if (videoTracks.length === 0) {
      console.error('[Broadcast] CRITICAL: No live video tracks available! Viewers will see black screen.');
    }
    videoTracks.forEach((track, i) => {
      const settings = track.getSettings();
      console.log(`[Broadcast] Video track ${i}: enabled=${track.enabled}, readyState=${track.readyState}, ` +
        `resolution=${settings.width}x${settings.height}, frameRate=${settings.frameRate}, ` +
        `deviceId=${settings.deviceId || 'canvas'}`);
      if (!track.enabled) {
        console.warn(`[Broadcast] Video track ${i} was disabled, forcing enabled`);
        track.enabled = true;
      }
    });
    audioTracks.forEach((track, i) => {
      console.log(`[Broadcast] Audio track ${i}: enabled=${track.enabled}, readyState=${track.readyState}`);
    });

    try {
      if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
        const videoCapabilities = RTCRtpSender.getCapabilities('video');
        if (videoCapabilities) {
          const supportedCodecs = videoCapabilities.codecs.map(c => c.mimeType).filter((v, i, a) => a.indexOf(v) === i);
          console.log('[Broadcast] Supported video codecs:', supportedCodecs.join(', '));
          const hasH264 = supportedCodecs.some(c => c.toLowerCase().includes('h264'));
          const hasVP8 = supportedCodecs.some(c => c.toLowerCase().includes('vp8'));
          if (!hasH264 && !hasVP8) {
            console.warn('[Broadcast] WARNING: Neither H.264 nor VP8 supported – viewers on mobile may see black screen');
          }
          if (hasH264) {
            console.log('[Broadcast] H.264 available – good compatibility with mobile/in-app browsers');
          }
        }
      }
    } catch (e) {
      console.warn('[Broadcast] Could not check codec capabilities:', e);
    }

    signalingRef.current.start(stream);

    // Parallel: push the same canvas stream to AWS IVS via RTMPS so viewers
    // have an HLS fallback and we absorb scale beyond WebRTC peer capacity.
    // Runs best-effort — a failure here must not take down the WebRTC path.
    if (ivsConfig && !ivsBroadcasterRef.current) {
      const broadcaster = new IVSBroadcaster();
      ivsBroadcasterRef.current = broadcaster;
      (async () => {
        try {
          await broadcaster.init({
            width: MAX_QUALITY.width,
            height: MAX_QUALITY.height,
            frameRate: MAX_QUALITY.frameRate,
            bitrate: MAX_QUALITY.bitrate,
            keyframeIntervalSec: MAX_QUALITY.keyframeIntervalSec,
          });
          broadcaster.onError((err) => console.warn('[IVS] client error:', err));
          broadcaster.onConnectionStateChange((s) => console.log('[IVS] connection state:', s));
          await broadcaster.start(stream, ivsConfig.ingestServer, ivsConfig.streamKey);
          setIvsBroadcasting(true);
          console.log('[IVS] broadcast started to', ivsConfig.ingestServer);
        } catch (err) {
          console.error('[IVS] Failed to start IVS broadcast (WebRTC continues):', err);
          try { await broadcaster.stop(); } catch {}
          if (ivsBroadcasterRef.current === broadcaster) ivsBroadcasterRef.current = null;
          setIvsBroadcasting(false);
        }
      })();
    }
  };

  const toggleLive = async () => {
    const newState = !isLive;
    const normalizedUsername = userName.toLowerCase();

    if (newState) {
      // Clear previous cart data BEFORE going live to prevent stale data in polls
      try { await apiService.clearLiveCart(userName); } catch (e) { console.warn('[Live] clearLiveCart failed (non-blocking):', e); }

      const vCount = 0;
      setViewerCount(vCount);
      broadcastStartTimeRef.current = new Date().toISOString();
      // Keep id strictly URL-safe so it round-trips through the recording
      // upload route (`:broadcastId`) and the admin replay route without
      // any encoding surprises.
      broadcastIdRef.current = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      peakViewerCountRef.current = 0;

      // Reset all stats from previous broadcast
      setCartStats(null);
      setCartCarts([]);
      setCartError(false);
      setMessages([]);
      setActiveProductId(null);

      // Now set live state - this triggers cart polling, which will see empty cart
      setIsLive(newState);
      isLiveRef.current = newState;

      // Start WebRTC signaling to broadcast canvas stream (with filters) to viewers
      // Try canvas stream first (has filters/mirror), then raw camera, with retry
      let broadcastStream = canvasStreamRef.current || streamRef.current;

      // If no stream available yet, wait for camera to initialize with retries
      if (!broadcastStream) {
        for (let i = 0; i < 6; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          broadcastStream = canvasStreamRef.current || streamRef.current;
          if (broadcastStream) break;
        }
      }

      // If still no stream after initial retries, show notice and auto-retry after 1 second
      if (!broadcastStream) {
        console.warn('[Broadcast] 카메라 준비 중 — 1초 후 자동 재시도합니다.');
        setMessages(prev => [
          ...prev,
          {
            id: `system-camera-${Date.now()}`,
            user: 'System',
            text: '카메라 준비 중입니다. 잠시 후 자동으로 재시도합니다.',
            timestamp: Date.now(),
          },
        ]);
        setTimeout(async () => {
          const retryStream = canvasStreamRef.current || streamRef.current;
          if (retryStream && signalingRef.current && isLiveRef.current) {
            console.log('[Broadcast] 자동 재시도 — 스트림 발견, 방송 시작');
            startBroadcastWithStream(retryStream);
          } else {
            console.error('[Broadcast] 자동 재시도 실패 — 여전히 스트림 없음. 방송을 다시 시작해주세요.');
          }
        }, 1000);
      } else if (signalingRef.current && broadcastStream) {
        startBroadcastWithStream(broadcastStream);
      }

      const initialActiveMaterial = activeMaterialId
        ? materials.find(m => m.id === activeMaterialId) || null
        : null;

      let savedBroadcastTitle = '';
      try {
        savedBroadcastTitle = localStorage.getItem(`picks_broadcast_title_${normalizedUsername}`) || '';
      } catch {}

      const liveData = {
        isLive: true,
        viewerCount: vCount,
        currentProduct: null,
        activeMaterial: initialActiveMaterial,
        broadcastTitle: savedBroadcastTitle,
        startedAt: broadcastStartTimeRef.current,
      };

      // Update LocalStorage for immediate local sync
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData));

      // Fire-and-forget: API sync must NEVER block or crash the broadcast
      apiService.saveLiveState(userName, liveData).catch(e => console.warn('[Live] saveLiveState failed (non-blocking):', e));
    } else {
      setIsLive(newState);
      isLiveRef.current = newState;

      // Save broadcast history before cleanup
      const endTime = new Date().toISOString();
      const startTime = broadcastStartTimeRef.current || endTime;
      const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      // Get final cart stats (non-blocking — default to empty if fetch fails)
      let finalCartStats = { totalViewers: 0, totalItems: 0, totalRevenue: 0, productCounts: [] as any[] };
      try {
        const finalCartData = await apiService.getLiveCartStats(userName);
        if (finalCartData?.stats) finalCartStats = finalCartData.stats;
      } catch (e) { console.warn('[Live] getLiveCartStats failed:', e); }

      // Save broadcast record (non-blocking). Once the row is inserted, kick
      // off the recording upload so the back-fill UPDATE finds an existing row.
      const broadcastId = broadcastIdRef.current || Date.now().toString();
      apiService.saveBroadcastRecord(userName, {
        id: broadcastId,
        startedAt: startTime,
        endedAt: endTime,
        durationMinutes,
        products: liveProducts,
        cartStats: finalCartStats,
        peakViewers: peakViewerCountRef.current,
        totalMessages: messages.length,
      })
        .then(() => refreshLiveUsage())
        .then(() => stopAndUploadLocalRecorder(broadcastId, durationMs / 1000))
        .catch(e => console.warn('[Live] saveBroadcastRecord/upload failed (non-blocking):', e));

      setViewerCount(0);
      setIsCameraOn(false);
      setIsMicOn(false);
      setActiveProductId(null);
      setActiveMaterialId(null);

      // Stop WebRTC signaling
      signalingRef.current?.stop();

      // Stop IVS broadcast (if running) — fire-and-forget so the UI doesn't
      // stall on network teardown.
      if (ivsBroadcasterRef.current) {
        const b = ivsBroadcasterRef.current;
        ivsBroadcasterRef.current = null;
        b.stop().catch(e => console.warn('[IVS] stop failed:', e));
        setIvsBroadcasting(false);
      }

      const liveData = { isLive: false, viewerCount: 0, currentProduct: null, activeMaterial: null };

      // Update LocalStorage
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData));

      // Fire-and-forget: cleanup sync — must not block UI.
      // Note: registered live products are intentionally preserved across
      // broadcasts; only the seller can remove them from BroadcastSettings.
      apiService.saveLiveState(userName, liveData).catch(e => console.warn('[Live] saveLiveState (off) failed:', e));
      apiService.clearLiveCart(userName).catch(e => console.warn('[Live] clearLiveCart failed:', e));
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      user: '나(스트리머)',
      text: newMessage,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    // Send to viewers via signaling channel
    signalingRef.current?.sendChat(msg);
    setNewMessage('');
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950 flex flex-col md:flex-row">
      {/* Main Stream Area */}
      <div className="flex-1 min-h-0 relative bg-black overflow-hidden flex items-center justify-center">
        {/* Source video: invisible but still rendered so browsers decode frames */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute w-px h-px opacity-0 pointer-events-none"
          style={{ top: 0, left: 0 }}
        />
        {/* Canvas shows filtered/mirrored output */}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
          style={{ objectFit: 'contain' }}
        />
        
        {!isCameraOn && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
            <div className="text-center space-y-4">
              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                <CameraOff size={40} className="text-slate-600" />
              </div>
              <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Camera is Off</p>
            </div>
          </div>
        )}

        {/* Material Overlays */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {activeMaterial && (
            <div
              key={activeMaterial.id}
              style={{
                width: `${activeMaterial.width}%`,
                height: activeMaterial.type === 'banner' ? `${activeMaterial.width}%` : 'auto',
                opacity: activeMaterial.opacity / 100,
                position: 'absolute',
                ...(activeMaterial.type === 'banner'
                  ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
                  : activeMaterial.type === 'product'
                  ? { right: '12px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }
                  : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
              }}
            >
              {activeMaterial.type === 'banner' ? (
                <div className="w-full h-full bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
                  <img
                    src={activeMaterial.url}
                    alt={activeMaterial.name}
                    className="w-full flex-1 object-cover min-h-0"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                  <div className="p-3 bg-black/60 flex-shrink-0">
                    <p className="text-white font-black text-center uppercase tracking-widest text-sm">{activeMaterial.name}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
                  <img
                    src={activeMaterial.url}
                    alt={activeMaterial.name}
                    className="w-full h-auto object-cover"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                  <div className="p-2 bg-black/60 backdrop-blur-md">
                    <p className="text-white text-xs font-black text-center">{activeMaterial.name}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Product Preview Overlay - shows seller what viewers see */}
        {activeProductId && (() => {
          const activeProduct = liveProducts.find(p => p.id === activeProductId);
          if (!activeProduct) return null;
          return (
            <div
              className="absolute right-3 md:right-4 w-[60vw] max-w-[240px] md:max-w-[280px] z-20 pointer-events-none"
              style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
            >
              <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-2.5 relative">
                <div className="absolute -top-2 left-3 px-2 py-0.5 bg-green-600 rounded-full">
                  <span className="text-white text-[8px] font-black uppercase tracking-widest">시청자 화면 미리보기</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {activeProduct.image ? (
                    <SafeImage src={activeProduct.image} alt={activeProduct.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-white/20" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 border border-white/20">
                      <Package size={16} className="text-white/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-[11px] font-black truncate">{activeProduct.name}</h4>
                    {activeProduct.price && <p className="text-white/60 text-[9px] truncate">{activeProduct.price}</p>}
                  </div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <div className="flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-orange-500/50 text-white/70 flex items-center justify-center gap-1">
                    <ShoppingBag size={10} /> 상품 담기
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-purple-600/50 text-white/70 flex items-center justify-center">
                    구매
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Overlay UI */}
        <div className="absolute inset-0 p-3 md:p-8 flex flex-col justify-between pointer-events-none safe-area-pad">
          <div className="flex justify-between items-start pointer-events-auto">
            <div className="flex items-center gap-2 md:gap-4 flex-wrap">
              <div className="bg-black/40 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-white/10 flex items-center gap-2 md:gap-3">
                <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-white text-xs font-black uppercase tracking-widest">
                  {isLive ? 'LIVE' : 'PREVIEW'}
                </span>
                {isLive && (
                  <div className="h-4 w-[1px] bg-white/20 mx-1" />
                )}
                {isLive && (
                  <span className="text-white/60 text-[10px] font-bold flex items-center gap-1">
                    <Users size={12} /> {viewerCount}
                  </span>
                )}
              </div>
              {liveUsage && (
                <div
                  className="bg-black/40 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-white/10 text-white text-[10px] md:text-[11px] font-bold flex items-center gap-2"
                  title="이번 달 라이브 송출 시간 · 후불 누적 (시간당 8,900원) · 매출 수수료 7.5%(PG 포함)"
                >
                  <span className="text-white/40 uppercase tracking-widest text-[9px]">이번 달</span>
                  <span>
                    포함{' '}
                    {Math.floor(liveUsage.includedMinutesRemaining / 60)}시간{' '}
                    {liveUsage.includedMinutesRemaining % 60}분 남음
                  </span>
                  <span className="text-white/30">·</span>
                  <span className={liveUsage.overageAmountKrw > 0 ? 'text-amber-300' : 'text-white/60'}>
                    후불 {liveUsage.overageAmountKrw.toLocaleString()}원
                  </span>
                </div>
              )}
              {capBlock && (
                <div className="bg-red-600/90 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-red-400/40 text-white text-[10px] md:text-[11px] font-black flex items-center gap-2">
                  <span className="uppercase tracking-widest text-[9px]">자동 차단</span>
                  <span>{capBlock.message}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 md:gap-3 items-start flex-wrap justify-end">
              {/* Quality Badge - Always Max */}
              <div className="hidden md:flex bg-black/40 backdrop-blur-md px-3 py-3 rounded-full text-white items-center gap-2">
                <Monitor size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest text-green-400">
                  {MAX_QUALITY.description}
                </span>
                {actualResolution && (
                  <span className="text-[9px] font-mono text-white/40">{actualResolution}</span>
                )}
              </div>
              {/* IVS Stream Status */}
              <button
                onClick={() => setShowStreamInfo(!showStreamInfo)}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${
                  ivsConfig ? (isLive ? 'bg-red-600 animate-pulse' : 'bg-green-600') : 'bg-yellow-600'
                }`}
                title="AWS IVS 송출 정보"
              >
                <Radio size={18} />
              </button>
              {/* Mirror toggle */}
              <button
                onClick={() => setIsMirrored(!isMirrored)}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${isMirrored ? 'bg-blue-600' : 'bg-black/40 hover:bg-black/60'}`}
                title="거울 모드"
              >
                <FlipHorizontal2 size={20} />
              </button>
              {/* Filter panel toggle */}
              <button
                onClick={() => { setShowFilterPanel(!showFilterPanel); setShowMaterialPanel(false); }}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${showFilterPanel ? 'bg-pink-600' : 'bg-black/40 hover:bg-black/60'}`}
                title="필터"
              >
                <Sparkles size={20} />
              </button>
              <button
                onClick={() => { setShowMaterialPanel(!showMaterialPanel); setShowFilterPanel(false); }}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${showMaterialPanel ? 'bg-purple-600' : 'bg-black/40 hover:bg-black/60'}`}
              >
                <Settings size={20} />
              </button>
              <button onClick={onClose} className="p-2 md:p-3 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Bottom Menu Bar */}
          <div className="flex flex-col gap-3 md:gap-4 pointer-events-auto max-h-[70vh] md:max-h-none overflow-y-auto scrollbar-hide">
            {/* AWS IVS Stream Info Panel (One-Click Broadcast) */}
            {showStreamInfo && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl md:rounded-[2rem] w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-white font-black text-xs md:text-sm uppercase tracking-widest flex items-center gap-2">
                    <Radio size={16} className="text-red-400" /> AWS IVS 송출 설정
                  </h4>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    ivsConfig ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {ivsLoading ? '로딩중...' : ivsConfig ? '연결됨' : '미설정'}
                  </div>
                </div>

                {ivsConfig ? (
                  <div className="space-y-3">
                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">Ingest Server</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{ivsConfig.ingestServer}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.ingestServer, 'ingest')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'ingest' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">Stream Key (자동 연동)</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{'*'.repeat(20)}...{ivsConfig.streamKey.slice(-6)}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.streamKey, 'key')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'key' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">RTMP URL (OBS 연동용)</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{ivsConfig.rtmpUrl}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.rtmpUrl, 'rtmp')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'rtmp' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 mt-2">
                      <p className="text-green-400 text-xs font-bold">
                        원클릭 송출 활성화됨 - [라이브 시작] 버튼을 누르면 자동으로 송출이 시작됩니다.
                      </p>
                      <p className="text-green-400/60 text-[10px] mt-1">
                        OBS Studio 사용 시 위 정보를 복사해 설정하세요.
                      </p>
                      {ivsBroadcasting && (
                        <p className="text-red-400 text-[11px] font-bold mt-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                          IVS 송출 중 (RTMPS)
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-center">
                    <p className="text-yellow-400 text-xs font-bold mb-2">스트림 키가 설정되지 않았습니다</p>
                    <p className="text-yellow-400/60 text-[10px]">관리자에게 문의하거나 환경 변수를 확인해주세요.</p>
                  </div>
                )}
              </div>
            )}

            {/* Filter Panel */}
            {showFilterPanel && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl md:rounded-[2rem] w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-white font-black text-xs md:text-sm uppercase tracking-widest flex items-center gap-2">
                        <Sparkles size={16} className="text-pink-400" /> 영상 필터
                      </h4>
                      <button
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                        className="text-white/40 text-[10px] font-bold uppercase tracking-widest hover:text-white transition-all px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10"
                      >
                        초기화
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Brightness */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                            <Sun size={14} className="text-yellow-400" /> 밝기
                          </label>
                          <span className="text-white/40 text-[10px] font-mono">{filters.brightness}%</span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="150"
                          value={filters.brightness}
                          onChange={(e) => setFilters(f => ({ ...f, brightness: Number(e.target.value) }))}
                          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-yellow-400"
                        />
                      </div>

                      {/* Contrast */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                            <Contrast size={14} className="text-orange-400" /> 대비
                          </label>
                          <span className="text-white/40 text-[10px] font-mono">{filters.contrast}%</span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="150"
                          value={filters.contrast}
                          onChange={(e) => setFilters(f => ({ ...f, contrast: Number(e.target.value) }))}
                          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-orange-400"
                        />
                      </div>

                      {/* Saturation */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                            <Droplets size={14} className="text-blue-400" /> 채도
                          </label>
                          <span className="text-white/40 text-[10px] font-mono">{filters.saturation}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={filters.saturation}
                          onChange={(e) => setFilters(f => ({ ...f, saturation: Number(e.target.value) }))}
                          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>

                      {/* Warmth */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                            <Thermometer size={14} className="text-red-400" /> 따뜻함
                          </label>
                          <span className="text-white/40 text-[10px] font-mono">{filters.warmth}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={filters.warmth}
                          onChange={(e) => setFilters(f => ({ ...f, warmth: Number(e.target.value) }))}
                          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-red-400"
                        />
                      </div>

                      {/* Blur (Skin Smoothing) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                            <Eye size={14} className="text-purple-400" /> 스무딩
                          </label>
                          <span className="text-white/40 text-[10px] font-mono">{filters.blur}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="0.5"
                          value={filters.blur}
                          onChange={(e) => setFilters(f => ({ ...f, blur: Number(e.target.value) }))}
                          className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-400"
                        />
                      </div>
                    </div>

                    {/* Filter presets */}
                    <div className="flex gap-2 mt-4 flex-wrap">
                      <button
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 text-white/60 hover:text-white transition-all"
                      >
                        기본
                      </button>
                      <button
                        onClick={() => setFilters({ brightness: 110, contrast: 105, saturation: 120, warmth: 10, blur: 0.5 })}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 transition-all"
                      >
                        뷰티
                      </button>
                      <button
                        onClick={() => setFilters({ brightness: 105, contrast: 110, saturation: 130, warmth: 15, blur: 0 })}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-all"
                      >
                        따뜻한
                      </button>
                      <button
                        onClick={() => setFilters({ brightness: 105, contrast: 115, saturation: 110, warmth: 0, blur: 0 })}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-all"
                      >
                        선명한
                      </button>
                      <button
                        onClick={() => setFilters({ brightness: 110, contrast: 95, saturation: 80, warmth: 5, blur: 1 })}
                        className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-all"
                      >
                        소프트
                      </button>
                    </div>
              </div>
            )}

            {/* Material Management Panel */}
            {showMaterialPanel && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl md:rounded-[2rem] w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                <h4 className="text-white font-black text-xs md:text-sm mb-4 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon size={16} /> 방송 자료 관리
                </h4>

                {/* Add new material */}
                <div className="space-y-3 mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMaterialName}
                      onChange={(e) => setNewMaterialName(e.target.value)}
                      placeholder="자료 이름"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs placeholder:text-white/30"
                    />
                    <select
                      value={newMaterialType}
                      onChange={(e) => setNewMaterialType(e.target.value as any)}
                      className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs appearance-none"
                    >
                      <option value="banner">배너</option>
                      <option value="product">상품</option>
                      <option value="image">이미지</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 bg-purple-600/20 border border-purple-500/30 text-purple-400 rounded-xl py-2 px-3 text-xs font-bold hover:bg-purple-600/30 transition-all"
                    >
                      <Upload size={14} /> 파일 업로드
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                {/* Material list */}
                <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
                  {materials.length === 0 && (
                    <p className="text-white/30 text-xs text-center py-3">등록된 자료가 없습니다</p>
                  )}
                  {materials.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                        activeMaterialId === item.id
                          ? 'bg-purple-600/20 border-purple-500/40'
                          : 'bg-white/5 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      <img src={item.url} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold truncate">{item.name}</p>
                        <span className="text-white/40 text-[10px] uppercase">{item.type}</span>
                      </div>
                      {/* Size preset control */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 30); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 30 ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="작은 크기"
                        >
                          S
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 50); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 50 ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="중간 크기"
                        >
                          M
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 90); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 90 ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="큰 크기"
                        >
                          L
                        </button>
                      </div>
                      {/* Toggle display */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMaterialId(activeMaterialId === item.id ? null : item.id);
                        }}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                          activeMaterialId === item.id
                            ? 'bg-purple-600 text-white'
                            : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {activeMaterialId === item.id ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMaterial(item.id); }}
                        className="p-1 text-red-400/60 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick material toggle bar */}
            {materials.length > 0 && (
              <div className="bg-black/40 backdrop-blur-md p-2 rounded-2xl border border-white/10 flex gap-2 flex-wrap">
                {materials.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveMaterialId(activeMaterialId === item.id ? null : item.id)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                      activeMaterialId === item.id ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {item.type === 'banner' ? <Layout size={12} /> : <ImageIcon size={12} />}
                    {item.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-between items-end">
              <div className="flex items-center gap-2 md:gap-3">
                <button
                  onClick={() => setIsCameraOn(!isCameraOn)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isCameraOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                >
                  {isCameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
                </button>
                <button
                  onClick={() => setIsMicOn(!isMicOn)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isMicOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                >
                  {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  onClick={() => setIsMirrored(!isMirrored)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isMirrored ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'}`}
                  title="거울 모드"
                >
                  <FlipHorizontal2 size={20} />
                </button>
                <button className="hidden md:block p-4 bg-white/10 backdrop-blur-md text-white rounded-full hover:bg-white/20 transition-all">
                  <Monitor size={24} />
                </button>
              </div>

              <button
                onClick={toggleLive}
                disabled={!isLive && !!capBlock}
                title={capBlock ? capBlock.message : undefined}
                className={`px-6 md:px-10 py-3 md:py-5 rounded-full text-sm md:text-lg font-black transition-all shadow-2xl active:scale-95 flex items-center gap-2 md:gap-3 ${isLive ? 'bg-red-600 text-white hover:bg-red-700' : capBlock ? 'bg-slate-500 text-white/80 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              >
                {ivsConfig && <Radio size={20} className={isLive ? 'animate-pulse' : ''} />}
                {isLive ? '방송 종료' : capBlock ? (capBlock.kind === 'monthly' ? '월 한도 도달' : '오늘 한도 도달') : '라이브 시작'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar (Chat, Products & Cart Stats) */}
      <div className="w-full md:w-[420px] bg-slate-900 border-t md:border-t-0 md:border-l border-white/5 flex flex-col h-[35vh] md:h-auto shrink-0">
        {/* Tab navigation */}
        <div className="flex border-b border-white/5">
          <button
            onClick={() => { setShowProductPanel(false); setShowCartPanel(false); }}
            className={`flex-1 p-3 md:p-4 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${
              !showProductPanel && !showCartPanel ? 'text-purple-400 border-b-2 border-purple-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <MessageCircle size={14} /> 채팅
          </button>
          <button
            onClick={() => { setShowProductPanel(true); setShowCartPanel(false); }}
            className={`flex-1 p-3 md:p-4 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${
              showProductPanel ? 'text-green-400 border-b-2 border-green-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <ShoppingBag size={14} /> 상품
            {liveProducts.length > 0 && <span className="bg-green-600 text-white text-[9px] px-1.5 rounded-full">{liveProducts.length}</span>}
          </button>
          <button
            onClick={() => { setShowCartPanel(true); setShowProductPanel(false); }}
            className={`flex-1 p-3 md:p-4 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${
              showCartPanel ? 'text-orange-400 border-b-2 border-orange-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <BarChart3 size={14} /> 담기현황
            {cartStats && cartStats.totalItems > 0 && <span className="bg-orange-600 text-white text-[9px] px-1.5 rounded-full">{cartStats.totalItems}</span>}
          </button>
        </div>

        {/* Chat Panel */}
        {!showProductPanel && !showCartPanel && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-hide overscroll-contain">
              {messages.map(msg => (
                <div key={msg.id} className="animate-in slide-in-from-bottom-2 duration-200">
                  <span className="text-purple-400 text-xs font-black uppercase tracking-wide block mb-1">{msg.user}</span>
                  <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none text-white text-[15px] leading-snug">
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 bg-slate-950/50">
              <div className="relative">
                <input
                  type="text"
                  placeholder="메시지를 입력하세요..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-white text-[15px] outline-none focus:border-purple-500/50 transition-all placeholder:text-white/30"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <button
                  onClick={handleSendMessage}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-purple-500 hover:text-purple-400"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Product Push Panel */}
        {showProductPanel && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3 scrollbar-hide">
            <p className="text-white/40 text-xs font-medium mb-2">
              상품을 선택하면 시청자 화면에 표시됩니다. 시청자가 '상품 담기' 버튼으로 담을 수 있습니다.
            </p>
            {liveProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <Package size={28} className="text-white/20" />
                </div>
                <p className="text-white/40 font-bold text-sm">등록된 상품이 없습니다</p>
                <p className="text-white/20 text-xs mt-1">라이브 커머스 메뉴에서 상품을 먼저 설정해주세요</p>
              </div>
            ) : (
              liveProducts.map(product => {
                const isActive = activeProductId === product.id;
                return (
                  <div
                    key={product.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      isActive ? 'bg-green-600/20 border-green-500/40' : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    {product.image ? (
                      <SafeImage src={product.image} alt={product.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Package size={18} className="text-white/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-bold truncate">{product.name}</p>
                      {product.price && <p className="text-white/40 text-[10px]">{product.price}</p>}
                      {product.link && <p className="text-blue-400 text-[9px] truncate">{product.link}</p>}
                    </div>
                    <button
                      onClick={() => setActiveProductId(isActive ? null : product.id)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        isActive ? 'bg-green-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {isActive ? '표시중' : '띄우기'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Cart Stats Panel */}
        {showCartPanel && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 scrollbar-hide">
            {/* Error State */}
            {cartError && !cartStats && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-3">
                  <BarChart3 size={22} className="text-red-400" />
                </div>
                <p className="text-red-400 font-bold text-sm">데이터를 불러오지 못했습니다</p>
                <p className="text-white/30 text-xs mt-1">잠시 후 자동으로 재시도합니다</p>
              </div>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">담은 시청자</p>
                <p className="text-white text-xl font-black">{cartStats?.totalViewers || 0}<span className="text-white/40 text-xs">명</span></p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">총 담은 수</p>
                <p className="text-orange-400 text-xl font-black">{cartStats?.totalItems || 0}<span className="text-white/40 text-xs">개</span></p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">예상 매출</p>
                <p className="text-green-400 text-lg font-black">{(cartStats?.totalRevenue || 0).toLocaleString()}<span className="text-white/40 text-xs">원</span></p>
              </div>
            </div>

            {/* Product Ranking */}
            {cartStats && Array.isArray(cartStats.productCounts) && cartStats.productCounts.length > 0 && (
              <div>
                <h5 className="text-white/60 text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                  <TrendingUp size={14} className="text-orange-400" /> 상품별 담기 순위
                </h5>
                <div className="space-y-2">
                  {cartStats.productCounts.map((item, i) => (
                    <div key={item.productId || i} className="bg-white/5 p-2.5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                          i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-white/10 text-white/40'
                        }`}>
                          {i + 1}
                        </span>
                        {item.image ? (
                          <SafeImage src={item.image} alt={item.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                            <Package size={12} className="text-white/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-bold truncate">{item.name}</p>
                          {item.price && <p className="text-white/30 text-[10px]">{item.price}</p>}
                        </div>
                        <span className="text-orange-400 text-sm font-black">{item.count}</span>
                      </div>
                      {/* Option breakdown */}
                      {item.optionCounts && Object.keys(item.optionCounts).length > 0 && (
                        <div className="mt-2 ml-9 space-y-1.5">
                          {Object.entries(item.optionCounts).map(([optName, values]) => (
                            <div key={optName}>
                              <p className="text-white/30 text-[9px] font-bold uppercase tracking-wider mb-1">{optName}</p>
                              <div className="flex flex-wrap gap-1">
                                {values && typeof values === 'object' ? Object.entries(values).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0)).map(([val, cnt]) => (
                                  <span key={val} className="text-[9px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-bold">
                                    {val} <span className="text-purple-400">{cnt}</span>
                                  </span>
                                )) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Viewer Carts Detail */}
            {Array.isArray(cartCarts) && cartCarts.length > 0 && (
              <div>
                <h5 className="text-white/60 text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Users size={14} className="text-purple-400" /> 시청자별 담은 상품
                </h5>
                <div className="space-y-2">
                  {cartCarts.map((cart, cartIdx) => (
                    <div key={cart.viewerId || cartIdx} className="bg-white/5 p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        {cart.viewerProfileImage && (
                          <img src={cart.viewerProfileImage} alt="" className="w-6 h-6 rounded-full object-cover" />
                        )}
                        <span className="text-purple-400 text-xs font-bold">{cart.viewerNickname || '시청자'}</span>
                        <span className="text-white/20 text-[10px]">{Array.isArray(cart.items) ? cart.items.length : 0}개</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.isArray(cart.items) && cart.items.map((item: any, idx: number) => (
                          <span key={`${item.productId}-${idx}`} className="text-white/60 text-[10px] bg-white/5 px-2 py-0.5 rounded-full">
                            {item.productName}
                            {item.selectedOptions && typeof item.selectedOptions === 'object' && Object.keys(item.selectedOptions).length > 0 && (
                              <span className="text-purple-300 ml-1">({Object.values(item.selectedOptions).join('/')})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!cartStats || cartStats.totalItems === 0) && !cartError && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <BarChart3 size={28} className="text-white/20" />
                </div>
                <p className="text-white/40 font-bold text-sm">아직 담은 데이터가 없습니다</p>
                <p className="text-white/20 text-xs mt-1">{isLive ? '시청자가 상품을 담으면 여기에 표시됩니다' : '방송을 시작하면 실시간으로 확인할 수 있습니다'}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveStreaming;
