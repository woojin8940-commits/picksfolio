import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Share2, Radio, Users } from 'lucide-react';
import { Block, DesignSettings, ProductFolder, OpenScheduleItem } from '../types';
import { getPublicProfileByUsername, supabase, withTimeout } from '../services/supabase';
import { trackView, trackClick } from '../services/analyticsService';
import { getLinkGridItems } from '../services/settingsService';
import { themeIsDark } from '../utils/themeColor';
import { apiService } from '../services/apiService';
import type { ViewerSignaling } from '../services/webrtcSignaling';
import SafeImage from './SafeImage';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import PublicPageBody, { DEFAULT_PUBLIC_DESIGN } from './PublicPageBody';
import ProductSheet from './ProductSheet';
import { useLanguage } from '../contexts/LanguageContext';

const loadLiveStream = () => import('./LiveStream');

/**
 * socials 의 기본값.
 *
 * liveNotify 는 남겨 둔다 — 예전에 저장된 socials 에 들어 있는 값이라, 없애도
 * 화면에 영향이 없지만 저장된 JSON 을 덮어쓸 때 키가 사라지는 것을 막기 위해
 * 기본값에는 그대로 둔다. 라이브 알림 버튼 자체는 더 이상 그리지 않는다.
 */
const DEFAULT_SOCIALS = { instagram: '', youtube: '', tiktok: '', phone: '', kakao: '', naver: '', businessProposal: false, liveNotify: false };
const LiveStream = React.lazy(loadLiveStream);

interface UserPageProps {
  username: string;
  onBackToDashboard?: () => void;
}

interface AboutSection {
  id: string;
  title: string;
  content: string;
}

interface ProfileData {
  full_name: string;
  bio: string;
  avatar_url?: string;
  aboutSections?: AboutSection[];
}

interface LinkData {
  id: string;
  title: string;
  url: string;
  image?: string;
  category?: string;
}

const ENABLE_SUPABASE_REALTIME = import.meta.env.VITE_ENABLE_SUPABASE_REALTIME === '1';

const UserPage: React.FC<UserPageProps> = ({ username, onBackToDashboard }) => {
  const { language } = useLanguage();
  const normalizedUsername = useMemo(() => (username || '').toLowerCase(), [username]);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing blocks:', e);
    }
    return [];
  });

  const [design, setDesign] = useState<DesignSettings>(() => {
    /* 기본값은 미리보기와 함께 쓴다(components/PublicPageBody). */
    const defaultDesign = DEFAULT_PUBLIC_DESIGN;

    try {
      if (!normalizedUsername) return defaultDesign;
      const saved = localStorage.getItem(`picks_design_${normalizedUsername}`);
      if (saved) return { ...defaultDesign, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return defaultDesign;
  });

  const [socials, setSocials] = useState(() => {
    try {
      if (!normalizedUsername) return DEFAULT_SOCIALS;
      const saved = localStorage.getItem(`picks_socials_${normalizedUsername}`);
      if (saved) return { ...DEFAULT_SOCIALS, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing socials:', e);
    }
    return DEFAULT_SOCIALS;
  });

  const [_productFolders, setProductFolders] = useState<ProductFolder[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_folders_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [openSchedule, setOpenSchedule] = useState<OpenScheduleItem[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_schedule_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [linkGridCategories, setLinkGridCategories] = useState<string[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_categories_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [profile, setProfile] = useState<ProfileData | null>(() => {
    try {
      if (!normalizedUsername) return null;
      const saved = localStorage.getItem(`picks_profile_${normalizedUsername}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          full_name: parsed.name,
          bio: parsed.bio,
          avatar_url: parsed.avatar_url,
          aboutSections: Array.isArray(parsed.aboutSections) ? parsed.aboutSections : []
        };
      }
    } catch (e) {
      console.error('Error parsing profile:', e);
    }
    return null;
  });
  const [links, setLinks] = useState<LinkData[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveState, setLiveState] = useState<{ isLive: boolean; currentProduct?: any; viewerCount: number; activeMaterial?: any }>({
    isLive: false,
    viewerCount: 0
  });

  /**
   * 개인페이지가 열려 있는 동안 body 를 흰 종이색으로 둔다.
   *
   * 배경색은 상단 커버와 같은 폭(가운데 칸)까지만 칠하고 그 바깥은 흰 여백이다.
   * 그 여백을 그리는 칸은 화면 크기만큼만 있어서, iOS 의 overscroll 되돌림 구간과
   * 데스크톱 축소(zoom)가 남기는 바깥 여백에는 body 색이 비친다 — 기본 body 는
   * 어두운 색이라 흰 페이지 위아래로 검은 띠가 스쳤다. 떠날 때 되돌려 놓는다.
   */
  useEffect(() => {
    document.body.classList.add('userpage-canvas');
    return () => document.body.classList.remove('userpage-canvas');
  }, []);

  useEffect(() => {
    const loadData = async () => {
      // Load from localStorage for immediate UI (optimistic display while cloud fetches)
      const savedLive = localStorage.getItem(`picks_live_${normalizedUsername}`);
      if (savedLive) {
        try {
          const parsed = JSON.parse(savedLive);
          // Guard against a stale cached "방송중": if the cached record claims live
          // but its heartbeat is old (broadcast crashed or ended without the
          // off-write landing), don't optimistically show the live banner — wait
          // for the API poll to confirm. Mirrors the staleness check in api-live.
          const cachedStale =
            parsed.isLive &&
            typeof parsed.heartbeatAt === 'number' &&
            Date.now() - parsed.heartbeatAt > 40_000;
          setLiveState({
            isLive: cachedStale ? false : parsed.isLive,
            currentProduct: parsed.currentProduct,
            viewerCount: parsed.viewerCount || 0,
            activeMaterial: parsed.activeMaterial
          });
        } catch (e) {
          console.error('Error parsing live:', e);
        }
      }

      apiService.getLiveState(normalizedUsername)
        .then((apiLiveResult) => {
          if (!apiLiveResult) return;
          setLiveState({
            isLive: apiLiveResult.isLive,
            currentProduct: apiLiveResult.currentProduct,
            viewerCount: apiLiveResult.viewerCount || 0,
            activeMaterial: apiLiveResult.activeMaterial
          });
        })
        .catch(() => {});

      let apiDataResult: any = null;
      try {
        apiDataResult = await apiService.getSiteData(normalizedUsername);
      } catch (e) {
        console.warn('[UserPage] Site API load failed:', e);
      }

      try {
        // 0. Netlify Blobs API에서 데이터 로드 (최우선 클라우드 스토리지)
        let apiLoaded = false;
        try {
          const apiData = apiDataResult;
          if (apiData) {
            apiLoaded = true;
            // Cloud is source of truth: use cloud data even if empty (admin may have cleared it)
            if (Array.isArray(apiData.blocks)) {
              setBlocks(apiData.blocks);
              localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(apiData.blocks));
            }
            if (apiData.design) {
              setDesign(prev => ({ ...prev, ...(apiData.design as any) }));
              localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(apiData.design));
            }
            if (apiData.profile) {
              setProfile({
                full_name: apiData.profile.name || '',
                bio: apiData.profile.bio || '',
                avatar_url: apiData.profile.avatar_url,
                aboutSections: Array.isArray(apiData.profile.aboutSections)
                  ? apiData.profile.aboutSections
                  : []
              });
              try {
                const existingProfile = JSON.parse(localStorage.getItem(`picks_profile_${normalizedUsername}`) || '{}');
                localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify({ ...existingProfile, ...apiData.profile }));
              } catch { localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify(apiData.profile)); }
            }
            if (apiData.socials) {
              /* 서버 값으로 갈아 끼운다(먼저 그려 둔 localStorage 값 위에 덮지 않는다).
                 켜 둔 값만 저장되는 칸이 있어서 — 검색바는 껐을 때만 hideSearchBar 가
                 남는다 — 두 벌을 겹치면 서버에서 지워진 값이 예전 localStorage 에서
                 살아남는다. 검색바를 다시 켜도 이 기기에서만 계속 숨어 있던 이유다. */
              setSocials({ ...DEFAULT_SOCIALS, ...(apiData.socials as any) });
              localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(apiData.socials));
            }
            if (apiData.productFolders) {
              setProductFolders(apiData.productFolders);
              localStorage.setItem(`picks_folders_${normalizedUsername}`, JSON.stringify(apiData.productFolders));
            }
            if (apiData.openSchedule) {
              setOpenSchedule(apiData.openSchedule);
              localStorage.setItem(`picks_schedule_${normalizedUsername}`, JSON.stringify(apiData.openSchedule));
            }
            if (Array.isArray(apiData.linkGridCategories)) {
              setLinkGridCategories(apiData.linkGridCategories);
              localStorage.setItem(`picks_categories_${normalizedUsername}`, JSON.stringify(apiData.linkGridCategories));
            }
          }
        } catch (apiError) {
          console.warn('[UserPage] API 데이터 로드 실패, Supabase로 폴백:', apiError);
        }

        // If API failed, fall back to localStorage for immediate display
        if (!apiLoaded) {
          try {
            const savedBlocks = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
            const savedDesign = localStorage.getItem(`picks_design_${normalizedUsername}`);
            const savedSocials = localStorage.getItem(`picks_socials_${normalizedUsername}`);
            const savedProfile = localStorage.getItem(`picks_profile_${normalizedUsername}`);

            if (savedBlocks) {
              const parsed = JSON.parse(savedBlocks);
              setBlocks(Array.isArray(parsed) ? parsed : []);
            }
            if (savedDesign) setDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));
            if (savedSocials) setSocials({ ...DEFAULT_SOCIALS, ...JSON.parse(savedSocials) });
            if (savedProfile) {
              const parsed = JSON.parse(savedProfile);
              setProfile({
                full_name: parsed.name,
                bio: parsed.bio,
                avatar_url: parsed.avatar_url,
                aboutSections: Array.isArray(parsed.aboutSections) ? parsed.aboutSections : []
              });
            }
          } catch (e) {
            console.error('Error loading from localStorage:', e);
          }
        }

        // 1. Supabase에서 데이터 로드 (API에서 못 불러온 경우에만 폴백)
        // API(Netlify Blobs)에서 이미 데이터를 로드했으면 Supabase 조회를 건너뛴다
        if (!apiLoaded) {
          try {
            if (supabase) {
              let profileData: any = null;
              let profileError: any = null;

              try {
                const result = await withTimeout(
                  getPublicProfileByUsername(username, 'id, username, full_name, bio, avatar_url'),
                  5000,
                  'UserPage 프로필 조회'
                );
                profileData = result?.data ?? null;
                profileError = result?.error ?? null;
              } catch (profileFetchErr: any) {
                // site_data column missing, timeout, or any other DB error — use defaults
                console.warn('[UserPage] 프로필 조회 예외 (기본값 사용):', profileFetchErr?.message || profileFetchErr);
                profileData = null;
                profileError = profileFetchErr;
              }

              if (profileError) {
                console.warn('[UserPage] 프로필 조회 오류:', profileError?.message || profileError);
              }

              if (!profileError && profileData) {
                // 이 화면의 profile.full_name 은 "표시 이름"이다(위의 API 경로는
                // site_data 의 profile.name 을 여기에 넣는다). profiles.full_name
                // 은 가입 폼의 실명이라 그대로 넣으면 site_data 를 못 읽은 방문에만
                // 커버 사진 위의 이름이 실명으로 바뀐다. 표시 이름의 기본값은
                // 가입 시점과 같은 아이디다(netlify/functions/auth-signup).
                setProfile({ ...profileData, full_name: profileData.username || '' });

                // Fetch Link Grid Items (New Source of Truth for Blocks)
                const cloudBlocks = await getLinkGridItems(username);
                if (cloudBlocks && cloudBlocks.length > 0) {
                  setBlocks(cloudBlocks);
                  localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(cloudBlocks));
                }
              }

              // Fetch link_grid_items (replaces non-existent 'links' table)
              try {
                if (profileData?.id) {
                  const { data: linksData, error: linksError } = await supabase
                    .from('link_grid_items')
                    .select('id, title, price, image_url, link, display_order')
                    .eq('user_id', profileData.id)
                    .order('display_order', { ascending: true });

                  if (!linksError && linksData) {
                    setLinks(linksData.map((l: any) => ({
                      id: l.id,
                      title: l.title,
                      url: l.link,
                      image: l.image_url,
                    })));
                  }
                }
              } catch {
                // Table may not exist yet — silently ignore
              }
            }
          } catch (supabaseError) {
            console.warn('[UserPage] Supabase 데이터 로드 실패 (API 데이터는 유지됨):', supabaseError);
          }
        }
      } catch (e) {
        console.error("Error loading user data:", e);
      }
    };

    loadData();
    trackView(username);

      // 4. Supabase Realtime Subscription
      // This ensures that when data changes on PC, the mobile browser updates immediately without cache issues.
      let profileChannel: any = null;
      let gridChannel: any = null;
      let loadDataTimer: ReturnType<typeof setTimeout> | null = null;

      // Debounce loadData to prevent rapid re-renders during broadcasting
      const debouncedLoadData = () => {
        if (loadDataTimer) clearTimeout(loadDataTimer);
        loadDataTimer = setTimeout(() => { loadData(); }, 500);
      };

      if (supabase && ENABLE_SUPABASE_REALTIME) {
        // Listen to link grid items changes (filtered to this user only)
        gridChannel = supabase
          .channel('public:link_grid_items')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'link_grid_items',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Link grid items updated for', username);
              debouncedLoadData();
            }
          )
          .subscribe();

        // Listen to profile changes
        profileChannel = supabase
          .channel('public:profiles')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'profiles',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Profile updated for', username);
              debouncedLoadData();
            }
          )
          .subscribe();
      }

      // Listen for changes from other tabs (Admin Dashboard)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key?.toLowerCase().includes(normalizedUsername)) {
          debouncedLoadData();
        }
      };

      window.addEventListener('storage', handleStorageChange);
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        if (loadDataTimer) clearTimeout(loadDataTimer);
        if (profileChannel && supabase) supabase.removeChannel(profileChannel);
        if (gridChannel && supabase) supabase.removeChannel(gridChannel);
      };
  }, [normalizedUsername, username]);

  // Poll live state from API so viewers detect broadcasts without Supabase Realtime
  useEffect(() => {
    let active = true;
    // Count consecutive isLive=false readings. The "라이브 중" banner is turned ON
    // immediately, but only turned OFF after several consecutive confirmed-false
    // readings. This keeps the banner steady through transient false blips (a host
    // momentarily backgrounding the app, a product-switch race, a slow read) that
    // previously made the banner vanish and then reappear a few seconds later.
    let consecutiveOff = 0;
    const pollLive = async () => {
      try {
        const apiLive = await apiService.getLiveState(normalizedUsername);
        if (!active || !apiLive) return; // null = fetch failed; keep current state
        if (apiLive.isLive) {
          consecutiveOff = 0;
        } else {
          consecutiveOff += 1;
        }
        const suppressOff = !apiLive.isLive && consecutiveOff < 3;
        setLiveState((prev) => {
          // Broadcast briefly read as ended — hold the banner until confirmed.
          if (suppressOff && prev.isLive) return prev;
          // Only update if changed to avoid unnecessary re-renders
          const newProductId = apiLive.currentProduct?.id || null;
          const prevProductId = prev.currentProduct?.id || null;
          const newMaterialId = apiLive.activeMaterial?.id || null;
          const prevMaterialId = prev.activeMaterial?.id || null;
          const newMaterialUrl = apiLive.activeMaterial?.url || null;
          const prevMaterialUrl = prev.activeMaterial?.url || null;
          if (
            prev.isLive !== apiLive.isLive ||
            prev.viewerCount !== (apiLive.viewerCount || 0) ||
            prevProductId !== newProductId ||
            prevMaterialId !== newMaterialId ||
            prevMaterialUrl !== newMaterialUrl
          ) {
            return {
              isLive: apiLive.isLive,
              currentProduct: apiLive.currentProduct,
              viewerCount: apiLive.viewerCount || 0,
              activeMaterial: apiLive.activeMaterial,
            };
          }
          return prev;
        });
      } catch {}
    };
    const timer = setInterval(pollLive, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [normalizedUsername]);

  // Pre-connect WebRTC signaling when broadcast is live (before user taps the banner)
  // This eliminates the ~5-15s signaling roundtrip delay when opening the live modal
  const preSignalingRef = useRef<ViewerSignaling | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (liveState.isLive && !showLiveModal && !preSignalingRef.current) {
      loadLiveStream().catch(() => {});
      import('../services/webrtcSignaling')
        .then(({ ViewerSignaling }) => {
          if (cancelled || !liveState.isLive || showLiveModal || preSignalingRef.current) return;
          console.log('[UserPage] Live detected, pre-connecting WebRTC signaling');
          const signaling = new ViewerSignaling(normalizedUsername);
          preSignalingRef.current = signaling;
          signaling.connect();
        })
        .catch(() => {});
    }
    // Clean up pre-connection if broadcast ends and modal is not open
    if (!liveState.isLive && !showLiveModal && preSignalingRef.current) {
      console.log('[UserPage] Live ended, cleaning up pre-connected signaling');
      preSignalingRef.current.disconnect();
      preSignalingRef.current = null;
    }
    return () => {
      cancelled = true;
    };
  }, [liveState.isLive, showLiveModal, normalizedUsername]);

  // Preload/decode the active material image so it appears instantly inside
  // the live modal instead of briefly rendering a blank frame while the
  // browser decodes the newly-arrived URL.
  useEffect(() => {
    const url = liveState.activeMaterial?.url;
    if (!url) return;
    const img = new Image();
    try { (img as any).decoding = 'async'; } catch {}
    try { (img as any).fetchPriority = 'high'; } catch {}
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
  }, [liveState.activeMaterial?.id, liveState.activeMaterial?.url]);

  // When modal closes, clean up the pre-connected signaling (LiveStream handles its own cleanup)
  useEffect(() => {
    if (showLiveModal) {
      // Modal opened — LiveStream takes ownership, clear our ref so we don't double-disconnect
      preSignalingRef.current = null;
    }
  }, [showLiveModal]);

  // Clean up signaling on unmount
  useEffect(() => {
    return () => {
      if (preSignalingRef.current) {
        preSignalingRef.current.disconnect();
        preSignalingRef.current = null;
      }
    };
  }, []);

  // Live broadcast indicator is shown at the top; viewer taps it to open the stream

  // Handle Kakao OAuth callback for viewer login
  useEffect(() => {
    const redirectUsername = localStorage.getItem('picks_live_kakao_redirect');
    if (!redirectUsername || redirectUsername.toLowerCase() !== normalizedUsername) return;
    if (!supabase) {
      localStorage.removeItem('picks_live_kakao_redirect');
      return;
    }

    const processKakaoUser = async (user: any, session: any = null) => {
      const meta = user.user_metadata;
      const kakaoUser: {
        nickname: string;
        profileImage?: string;
        provider: 'kakao';
        userId: string;
        username?: string;
      } = {
        nickname: meta?.full_name || meta?.name || meta?.preferred_username || '카카오 사용자',
        profileImage: meta?.avatar_url || meta?.picture || undefined,
        provider: 'kakao' as const,
        userId: user.id,
      };

      // The viewer's chat name is the link name they chose at signup (their
      // profile username) — not a separate per-stream nickname. Resolve it from
      // the server so returning members chat under the same handle every time.
      try {
        const accessToken = session?.access_token || (await supabase!.auth.getSession()).data.session?.access_token || '';
        const providerToken =
          session?.provider_token ||
          sessionStorage.getItem('kakao_provider_token') ||
          '';
        const setupRes = await fetch('/.netlify/functions/kakao-profile-setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            user_id: user.id,
            user_metadata: user.user_metadata || {},
            identities: user.identities || [],
            email: user.email || '',
            provider_token: providerToken,
          }),
        });
        const setupJson = await setupRes.json();
        const linkName: string = setupJson?.profile?.username || '';
        if (linkName && !linkName.startsWith('_kakao_') && !linkName.startsWith('_kk_')) {
          kakaoUser.username = linkName;
        }
        const fetchedName = setupJson?.profile?.full_name;
        if (fetchedName && (!kakaoUser.nickname || kakaoUser.nickname === '카카오 사용자')) {
          kakaoUser.nickname = fetchedName;
        }
      } catch (e) {
        console.warn('[UserPage] link-name resolve failed:', e);
      }

      localStorage.setItem('picks_kakao_user', JSON.stringify(kakaoUser));
      localStorage.removeItem('picks_live_kakao_redirect');

      if (kakaoUser.username) {
        await supabase!.auth.signOut();
      }

      // Auto-open live stream modal
      setShowLiveModal(true);
    };

    const initKakaoCallback = async () => {
      // Handle PKCE code exchange for viewer Kakao login
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      // === URL 파라미터 디버그 로그 ===
      console.log('[UserPage] === 카카오 리다이렉트 URL 파라미터 점검 ===');
      console.log('[UserPage] 현재 전체 URL:', window.location.href);
      console.log('[UserPage] code 파라미터 존재:', !!code, code ? `(길이: ${code.length})` : '');
      console.log('[UserPage] error 파라미터:', params.get('error') || '(없음)');
      console.log('[UserPage] error_description 파라미터:', params.get('error_description') || '(없음)');
      console.log('[UserPage] state 파라미터:', params.get('state') ? '존재' : '(없음)');
      console.log('[UserPage] 전체 쿼리스트링:', window.location.search || '(비어있음)');
      console.log('[UserPage] === URL 파라미터 점검 끝 ===');

      // === PKCE code_verifier 로컬 스토리지 점검 ===
      console.log('[UserPage] === PKCE code_verifier 점검 ===');
      const storedKeys = Object.keys(localStorage).filter(k =>
        k.includes('code_verifier') || k.includes('pkce') || k.includes('supabase') || k.includes('auth-token')
      );
      console.log('[UserPage] 관련 localStorage 키 목록:', storedKeys);
      storedKeys.forEach(key => {
        const val = localStorage.getItem(key);
        console.log(`[UserPage]   ${key}: ${val ? `존재 (길이: ${val.length})` : '비어있음'}`);
      });
      console.log('[UserPage] === PKCE code_verifier 점검 끝 ===');

      if (code) {
        try {
          const { data, error } = await supabase!.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[UserPage] OAuth code exchange failed:', error.message);
            console.log('[UserPage] === 에러 상세 출력 (console.dir) ===');
            console.dir(error, { depth: null });
            console.log('[UserPage] 에러 status:', (error as any).status || '(없음)');
            console.log('[UserPage] 에러 code:', (error as any).code || '(없음)');
            console.log('[UserPage] === 에러 상세 출력 끝 ===');
          } else {
            console.log('[UserPage] OAuth 코드 교환 성공, 세션:', !!data?.session);
          }
          // Clean up the URL
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        } catch (e) {
          console.error('[UserPage] OAuth code exchange error:', e);
          console.log('[UserPage] === catch 에러 상세 출력 (console.dir) ===');
          console.dir(e, { depth: null });
          console.log('[UserPage] === catch 에러 상세 출력 끝 ===');
        }
      }

      // Try getting existing session
      const { data: { session } } = await supabase!.auth.getSession();
      if (session?.user) {
        processKakaoUser(session.user, session);
        return true;
      }
      return false;
    };

    let subscriptionRef: any = null;

    initKakaoCallback().then((handled) => {
      if (handled) return;

      // Fallback: listen for auth state change (only fresh sign-ins, not existing sessions)
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          processKakaoUser(session.user, session);
          subscription.unsubscribe();
        }
      });
      subscriptionRef = subscription;
    });

    // Clean up after 10 seconds if no auth event
    const cleanupTimer = setTimeout(() => {
      localStorage.removeItem('picks_live_kakao_redirect');
      if (subscriptionRef) subscriptionRef.unsubscribe();
    }, 10000);

    return () => {
      clearTimeout(cleanupTimer);
      if (subscriptionRef) subscriptionRef.unsubscribe();
    };
  }, [normalizedUsername]);

  const selectedBlock = useMemo(() => blocks.find(b => b.id === selectedBlockId), [blocks, selectedBlockId]);

  /**
   * 본문(커버 · 버튼 · 카테고리 · 카드)은 PublicPageBody 가, 상품 서랍은
   * ProductSheet 가 그린다 — 편집 화면 오른쪽의 미리보기가 같은 컴포넌트를 쓴다.
   * 여기 남은 값은 본문 아래의 푸터가 쓰는 것뿐이다.
   */
  const isDark = themeIsDark(design);
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

  /**
   * 라이브 방송 띠.
   *
   * 커버 사진 위에 얹히는 띠라 두 레이아웃이 같은 자리에 그린다 — 본문의
   * topBanner 로 넘긴다. 예전에는 포트폴리오 · 큐레이션 분기에 같은 마크업을 두 번
   * 적어 두어서, 한쪽만 고쳐지면 레이아웃을 바꿨을 때 띠가 달라졌다.
   */
  const liveBanner = liveState.isLive ? (
    <div
      onClick={() => setShowLiveModal(true)}
      className="relative cursor-pointer overflow-hidden group w-screen left-1/2 -translate-x-1/2"
    >
      <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-full border-2 border-white/80 overflow-hidden">
                <SafeImage src={profile?.avatar_url || DEFAULT_AVATAR} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-red-600 rounded-full border-2 border-white flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="bg-white/20 backdrop-blur-sm text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">LIVE</span>
                <span className="text-white text-xs font-black">라이브 방송 중</span>
              </div>
              <span className="text-white/70 text-[10px] font-medium">탭하여 시청하기</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1">
              <Users size={12} className="text-white" />
              <span className="text-white text-[10px] font-bold">{liveState.viewerCount.toLocaleString()}</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-all">
              <Radio size={14} className="text-white" />
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
    </div>
  ) : null;

  return (
    <>
      {onBackToDashboard && (
        <button
          type="button"
          onClick={onBackToDashboard}
          className="fixed left-3 z-[80] flex items-center gap-2 rounded-full border border-white/20 bg-slate-950/85 px-4 py-2.5 text-xs font-black text-white shadow-xl backdrop-blur-md transition active:scale-95 md:left-5 md:top-5"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          aria-label="홈 대시보드로 돌아가기"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          대시보드
        </button>
      )}
      <PublicPageBody
        design={design}
        profile={profile}
        socials={socials}
        blocks={blocks}
        linkGridCategories={linkGridCategories}
        openSchedule={openSchedule}
        featuredLinks={links}
        proposalHref={`/${normalizedUsername}/proposal`}
        language={language}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
        onSelectBlock={setSelectedBlockId}
        onTrackClick={(blockId) => trackClick(username, blockId)}
        topBanner={liveBanner}
      >

        {/* Footer */}
        <footer className="py-12 flex flex-col items-center space-y-6 shrink-0">
          <button 
            onClick={() => {
              navigator.share({
                title: `${username}님의 픽스폴리오`,
                url: window.location.href
              }).catch(() => {
                navigator.clipboard.writeText(window.location.href);
                alert('링크가 복사되었습니다!');
              });
            }}
            className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:scale-105 transition-all shadow-2xl"
          >
            <Share2 size={18} />
            페이지 공유하기
          </button>
          
          <div className="flex items-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all cursor-pointer">
            <span className="text-[10px] font-black tracking-tighter">POWERED BY</span>
            <span className="text-sm font-black text-blue-600 tracking-tighter">PICKSFOLIO</span>
          </div>

          {/* 통신판매중개자 사업자 정보 및 고객센터 (전자상거래법 제20조 / 결제 연동 심사 대응) */}
          <div className={`w-full max-w-md mx-auto pt-6 mt-2 border-t text-center space-y-1.5 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              본 페이지의 라이브 커머스 거래는 통신판매중개 플랫폼 픽스폴리오(Picksfolio)를 통해 이루어집니다.
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              상호명 픽스폴리오(Picksfolio) | 대표자 신우진
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              사업자등록번호 220-26-01995 | 통신판매업신고 제 2026-부천원미-0846 호
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              고객센터 070-7954-8452 | woojin8940@inplace-ad.com
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              <a href="/terms" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                이용약관
              </a>
              <span className={subTextColor}>|</span>
              <a href="/privacy" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                개인정보처리방침 · 취소/환불/배송 안내
              </a>
            </div>
          </div>
        </footer>

        {/* Product Detail Drawer */}
        <ProductSheet
          block={selectedBlock || null}
          design={design}
          onClose={() => setSelectedBlockId(null)}
          onProductClick={() => trackClick(username, selectedBlockId || '')}
        />
        
        {/* Live Commerce Modal - keep mounted once opened, only close on user action */}
        {showLiveModal && (
          <React.Suspense fallback={null}>
            <LiveStream
              username={username}
              currentProduct={liveState.currentProduct}
              activeMaterial={liveState.activeMaterial}
              viewerCount={liveState.viewerCount}
              onClose={() => setShowLiveModal(false)}
              preConnectedSignaling={preSignalingRef.current}
            />
          </React.Suspense>
        )}

      </PublicPageBody>
    </>
  );
};

export default UserPage;
