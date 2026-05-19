
import { getSiteSettings, getLinkGridItems, SiteSettings } from './settingsService';
import { Block } from '../types';

interface CacheData {
  settings: SiteSettings | null;
  gridItems: Block[] | null;
  timestamp: number;
}

const cache: Record<string, CacheData> = {};
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

export const prefetchLinkData = async (userName: string) => {
  if (!userName) return;
  
  const normalizedUsername = userName.toLowerCase();
  const now = Date.now();
  
  // If cache exists and is fresh, don't refetch
  if (cache[normalizedUsername] && (now - cache[normalizedUsername].timestamp < CACHE_EXPIRY)) {
    return;
  }

  console.log(`[Prefetch] Fetching data for ${userName}...`);
  
  try {
    const [settings, gridItems] = await Promise.all([
      getSiteSettings(normalizedUsername),
      getLinkGridItems(normalizedUsername)
    ]);
    
    cache[normalizedUsername] = {
      settings,
      gridItems,
      timestamp: Date.now()
    };
    
    console.log(`[Prefetch] Data cached for ${userName}`);
  } catch (e) {
    console.error(`[Prefetch] Failed for ${userName}:`, e);
  }
};

export const getCachedLinkData = (userName: string) => {
  const normalizedUsername = userName.toLowerCase();
  const data = cache[normalizedUsername];
  
  if (data && (Date.now() - data.timestamp < CACHE_EXPIRY)) {
    return data;
  }
  
  return null;
};

export const clearLinkCache = (userName: string) => {
  const normalizedUsername = userName.toLowerCase();
  delete cache[normalizedUsername];
};

export const clearAllLinkCache = () => {
  Object.keys(cache).forEach(key => delete cache[key]);
};
