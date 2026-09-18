import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MetaAdAccount,
  MetaAdConnection,
  MetaAdDiagnosis,
  MetaPermission,
  disconnectMetaAccount,
  findAdAccount,
  listAdAccounts,
  loadAdConnection,
  readCachedDiagnosis,
  resolveMetaPermissions,
  selectAdAccount,
  startMetaAdConnect,
  subscribeAdConnection,
  toAdConnection,
} from '../utils/adAccounts';

/**
 * 메타 광고 계정 연동 상태를 화면에 붙인다.
 *
 * 광고 현황과 부스팅 창이 같은 값을 봐야 하고(한쪽에서 계정을 바꾸면 다른 쪽도
 * 따라와야 한다), 두 화면이 각자 구독을 적으면 그 규칙이 두 군데로 갈라진다.
 * 그래서 읽기·구독·바꾸기를 여기 한 번만 적는다.
 *
 * 연동 여부는 이제 서버에서 읽는다(mock 이던 시절에는 화면이 스스로 적었다). 읽는
 * 동안은 `loading` 이다 — 연동을 아직 모르는 상태와 연동이 없는 상태를 같게 두면,
 * 연동해 둔 사람이 화면을 열 때마다 연동 안내가 한 번 번쩍이고 지나간다.
 */
export const useMetaAdConnection = (username: string) => {
  const cached = readCachedDiagnosis(username);
  const [diagnosis, setDiagnosis] = useState<MetaAdDiagnosis | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState('');
  /** 연동 시작 중(서버에서 authorize URL 을 받아 메타로 떠나기까지). */
  const [connecting, setConnecting] = useState(false);

  /** 서버에서 다시 읽는다. 연동을 마치고 돌아온 화면이 이 값을 쓴다. */
  const refresh = useCallback(
    async (force = false) => {
      if (!username) return;
      setLoading(readCachedDiagnosis(username) === undefined);
      try {
        setDiagnosis(await loadAdConnection(username, { force }));
        setError('');
      } catch (e) {
        setError((e as Error)?.message || '연동 상태를 읽지 못했습니다.');
      } finally {
        setLoading(false);
      }
    },
    [username],
  );

  useEffect(() => {
    const current = readCachedDiagnosis(username);
    setDiagnosis(current ?? null);
    setLoading(current === undefined);
    void refresh();
    // 다른 화면이 계정을 바꾸거나 연동을 해제하면 캐시가 바뀐다. 같은 값을 다시 읽는다.
    return subscribeAdConnection(() => setDiagnosis(readCachedDiagnosis(username) ?? null));
  }, [username, refresh]);

  const connection: MetaAdConnection = useMemo(
    () => toAdConnection(username, diagnosis),
    [username, diagnosis],
  );

  /**
   * 연동 시작 — 실제 페이스북 로그인 대화상자로 이동한다.
   *
   * 성공하면 이 화면은 사라진다(브라우저가 facebook.com 으로 떠난다). 그래서 돌아오는
   * 경우는 시작하지 못한 경우뿐이고, 그때만 오류를 화면에 남긴다.
   */
  const connect = useCallback(async () => {
    if (!username) return;
    setConnecting(true);
    setError('');
    const returnTo =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : undefined;
    const res = await startMetaAdConnect(username, returnTo);
    if (res.error) {
      setError(res.error);
      setConnecting(false);
    }
  }, [username]);

  const disconnect = useCallback(async () => {
    if (!username) return;
    await disconnectMetaAccount(username);
    setDiagnosis(readCachedDiagnosis(username) ?? null);
  }, [username]);

  const selectAccount = useCallback(
    (accountId: string) => {
      selectAdAccount(username, accountId);
      // 선택은 브라우저에만 남는다. 진단 결과 자체는 바뀌지 않으므로 파생값(connection)만
      // 다시 계산되도록 같은 객체를 새로 담는다.
      setDiagnosis((prev) => (prev ? { ...prev } : prev));
    },
    [username],
  );

  // 목록은 서버가 돌려준 `/me/adaccounts` 응답이다(연동 전에는 빈 목록). 화면이 이 값을
  // 의존성으로 쓰기 때문에 같은 진단 결과에서는 같은 배열이어야 한다.
  const accounts: MetaAdAccount[] = useMemo(() => listAdAccounts(diagnosis), [diagnosis]);
  const account = useMemo(
    () => findAdAccount(accounts, connection.selectedAccountId),
    [accounts, connection.selectedAccountId],
  );

  /** 권한 목록의 승인 상태. 연동 후에는 실제 동의 결과로 덮인다. */
  const permissions: MetaPermission[] = useMemo(() => resolveMetaPermissions(diagnosis), [diagnosis]);

  return {
    connection,
    /** 연동으로 쓸 수 있게 된 광고 계정. 연동 전에는 빈 목록이다. */
    accounts,
    /** 지금 고른 광고 계정. 고르기 전에는 null 이다. */
    account,
    connected: connection.connected,
    /** 연동 진단 결과 원본(무엇이 되고 무엇이 막혔는지). 연동 전에는 null. */
    diagnosis,
    permissions,
    loading,
    connecting,
    error,
    connect,
    disconnect,
    selectAccount,
    refresh,
  };
};
