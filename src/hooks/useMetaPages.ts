import { useCallback, useEffect, useState } from 'react';
import {
  MetaPage,
  fetchMetaPages,
  needsReconnect,
  readSelectedPageId,
  subscribeSelectedPage,
  writeSelectedPageId,
} from '../utils/metaAdsApi';

/**
 * 연동한 메타 계정이 관리하는 페이스북 페이지 목록과, 지금 고른 페이지.
 *
 * 목록은 매번 메타에서 읽는다(GET /me/accounts — pages_show_list). 고른 페이지는 광고
 * 현황·집행 창·캠페인 이력이 같이 봐야 해서 브라우저에 하나만 남기고, 서버가 돌려준
 * 목록에 있을 때만 인정한다. 고른 게 없으면 광고 권한이 있는 첫 페이지를 쓴다.
 */
export const useMetaPages = (username: string, enabled: boolean) => {
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [reconnect, setReconnect] = useState(false);
  const [fetchedAt, setFetchedAt] = useState('');
  const [storedId, setStoredId] = useState(() => readSelectedPageId(username));

  const refresh = useCallback(async () => {
    if (!username || !enabled) return;
    setLoading(true);
    const res = await fetchMetaPages(username);
    if (res.ok) {
      setPages(res.pages);
      setFetchedAt(res.fetchedAt);
      setError('');
      setReconnect(false);
    } else {
      setError(res.error);
      setReconnect(needsReconnect(res));
    }
    setLoading(false);
    setLoaded(true);
  }, [username, enabled]);

  useEffect(() => {
    setStoredId(readSelectedPageId(username));
    void refresh();
    return subscribeSelectedPage(() => setStoredId(readSelectedPageId(username)));
  }, [username, refresh]);

  const page =
    pages.find((p) => p.id === storedId) || pages.find((p) => p.canAdvertise) || pages[0] || null;

  const selectPage = useCallback(
    (pageId: string) => {
      writeSelectedPageId(username, pageId);
      setStoredId(pageId);
    },
    [username],
  );

  return { pages, page, selectPage, loading, loaded, error, reconnect, fetchedAt, refresh };
};
