
const getDateKey = (date?: Date) => {
  const d = date || new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
};

const analyticsApi = (username: string) =>
  `/api/analytics/${encodeURIComponent(username.toLowerCase())}`;

export const trackView = (username: string) => {
  const dateKey = getDateKey();
  fetch(analyticsApi(username), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'track-view', date: dateKey })
  }).catch(e => console.error('Failed to track view:', e));
};

export const trackClick = (username: string, blockId: string) => {
  const dateKey = getDateKey();
  fetch(analyticsApi(username), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'track-click', blockId, date: dateKey })
  }).catch(e => console.error('Failed to track click:', e));
};

export const getStatsForDate = async (username: string, dateString: string) => {
  try {
    const res = await fetch(`${analyticsApi(username)}?start=${dateString}&end=${dateString}&type=stats`);
    if (!res.ok) return { views: 0, clicks: 0, ctr: 0 };
    return await res.json();
  } catch (e) {
    console.error('Failed to get stats:', e);
    return { views: 0, clicks: 0, ctr: 0 };
  }
};

export const getTodayStats = async (username: string) => {
  return getStatsForDate(username, getDateKey());
};

export const getTopClickedItemsForDate = async (username: string, dateString: string) => {
  try {
    const res = await fetch(`${analyticsApi(username)}?start=${dateString}&end=${dateString}&type=top-items`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.topItems || []).map((item: any) => ({
      id: item.blockId || item.id,
      count: item.clicks || item.count || 0
    }));
  } catch (e) {
    console.error('Failed to get top items:', e);
    return [];
  }
};

export const getStatsForRange = async (username: string, startDate: string, endDate: string) => {
  try {
    const res = await fetch(`${analyticsApi(username)}?start=${startDate}&end=${endDate}&type=stats`);
    if (!res.ok) return { views: 0, clicks: 0, ctr: 0 };
    return await res.json();
  } catch (e) {
    console.error('Failed to get stats for range:', e);
    return { views: 0, clicks: 0, ctr: 0 };
  }
};

export const getTopClickedItemsForRange = async (username: string, startDate: string, endDate: string) => {
  try {
    const res = await fetch(`${analyticsApi(username)}?start=${startDate}&end=${endDate}&type=top-items`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.topItems || []).map((item: any) => ({
      id: item.blockId || item.id,
      count: item.clicks || item.count || 0
    }));
  } catch (e) {
    console.error('Failed to get top items for range:', e);
    return [];
  }
};

export const getTopClickedItems = async (username: string) => {
  return getTopClickedItemsForDate(username, getDateKey());
};
