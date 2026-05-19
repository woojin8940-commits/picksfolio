
const getDateKey = (date?: Date) => {
  const d = date || new Date();
  return d.toISOString().split('T')[0];
};

export const trackView = (username: string) => {
  const normalizedUsername = username.toLowerCase();
  const dateKey = getDateKey();
  const key = `picks_stats_views_${normalizedUsername}_${dateKey}`;
  const current = parseInt(localStorage.getItem(key) || '0');
  localStorage.setItem(key, (current + 1).toString());

  fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'track-view', date: dateKey }),
  }).catch(() => {});
};

export const trackClick = (username: string, blockId: string) => {
  const normalizedUsername = username.toLowerCase();
  const dateKey = getDateKey();

  const totalClicksKey = `picks_stats_clicks_${normalizedUsername}_${dateKey}`;
  const totalClicks = parseInt(localStorage.getItem(totalClicksKey) || '0');
  localStorage.setItem(totalClicksKey, (totalClicks + 1).toString());

  const blockClicksKey = `picks_stats_block_clicks_${normalizedUsername}_${dateKey}`;
  let blockClicks: Record<string, number> = {};
  try {
    const saved = localStorage.getItem(blockClicksKey);
    blockClicks = saved ? JSON.parse(saved) : {};
  } catch (e) {
    blockClicks = {};
  }
  blockClicks[blockId] = (blockClicks[blockId] || 0) + 1;
  localStorage.setItem(blockClicksKey, JSON.stringify(blockClicks));

  fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'track-click', blockId, date: dateKey }),
  }).catch(() => {});
};

export const getStatsForDate = async (username: string, dateString: string) => {
  const normalizedUsername = username.toLowerCase();

  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}?start=${dateString}&end=${dateString}&type=stats`);
    if (res.ok) {
      const data = await res.json();
      const views = data.views?.[0]?.count ? Number(data.views[0].count) : 0;
      const clicks = data.clicks?.[0]?.count ? Number(data.clicks[0].count) : 0;
      const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0';
      return { views, clicks, ctr: parseFloat(ctr) };
    }
  } catch {}

  const views = parseInt(localStorage.getItem(`picks_stats_views_${normalizedUsername}_${dateString}`) || '0');
  const clicks = parseInt(localStorage.getItem(`picks_stats_clicks_${normalizedUsername}_${dateString}`) || '0');
  const ctr = views > 0 ? ((clicks / views) * 100).toFixed(1) : '0';
  return { views, clicks, ctr: parseFloat(ctr) };
};

export const getTodayStats = async (username: string) => {
  return getStatsForDate(username, getDateKey());
};

export const getTopClickedItemsForDate = async (username: string, dateString: string) => {
  const normalizedUsername = username.toLowerCase();

  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}?start=${dateString}&end=${dateString}&type=top-items`);
    if (res.ok) {
      const data = await res.json();
      return (data || []).map((d: any) => ({ id: d.block_id, count: Number(d.click_count) })).slice(0, 5);
    }
  } catch {}

  let blockClicks: Record<string, number> = {};
  try {
    const saved = localStorage.getItem(`picks_stats_block_clicks_${normalizedUsername}_${dateString}`);
    blockClicks = saved ? JSON.parse(saved) : {};
  } catch {
    blockClicks = {};
  }

  return Object.entries(blockClicks)
    .map(([id, count]) => ({ id, count: count as number }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
};

export const getStatsForRange = async (username: string, startDate: string, endDate: string) => {
  const normalizedUsername = username.toLowerCase();

  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}?start=${startDate}&end=${endDate}&type=stats`);
    if (res.ok) {
      const data = await res.json();
      const totalViews = (data.views || []).reduce((sum: number, d: any) => sum + Number(d.count), 0);
      const totalClicks = (data.clicks || []).reduce((sum: number, d: any) => sum + Number(d.count), 0);
      const ctr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : '0';
      return { views: totalViews, clicks: totalClicks, ctr: parseFloat(ctr) };
    }
  } catch {}

  const start = new Date(startDate);
  const end = new Date(endDate);
  let totalViews = 0;
  let totalClicks = 0;
  const current = new Date(start);
  while (current <= end) {
    const dateKey = current.toISOString().split('T')[0];
    const stats = await getStatsForDate(username, dateKey);
    totalViews += stats.views;
    totalClicks += stats.clicks;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  const ctr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : '0';
  return { views: totalViews, clicks: totalClicks, ctr: parseFloat(ctr) };
};

export const getTopClickedItemsForRange = async (username: string, startDate: string, endDate: string) => {
  const normalizedUsername = username.toLowerCase();

  try {
    const res = await fetch(`/api/analytics/${encodeURIComponent(normalizedUsername)}?start=${startDate}&end=${endDate}&type=top-items`);
    if (res.ok) {
      const data = await res.json();
      return (data || []).map((d: any) => ({ id: d.block_id, count: Number(d.click_count) })).slice(0, 5);
    }
  } catch {}

  const start = new Date(startDate);
  const end = new Date(endDate);
  const aggregatedClicks: Record<string, number> = {};
  const current = new Date(start);
  while (current <= end) {
    const dateKey = current.toISOString().split('T')[0];
    let blockClicks: Record<string, number> = {};
    try {
      const saved = localStorage.getItem(`picks_stats_block_clicks_${normalizedUsername}_${dateKey}`);
      blockClicks = saved ? JSON.parse(saved) : {};
    } catch {
      blockClicks = {};
    }
    Object.entries(blockClicks).forEach(([id, count]) => {
      aggregatedClicks[id] = (aggregatedClicks[id] || 0) + (count as number);
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return Object.entries(aggregatedClicks)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
};

export const getTopClickedItems = async (username: string) => {
  return getTopClickedItemsForDate(username, getDateKey());
};
