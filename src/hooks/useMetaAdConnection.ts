import { useCallback, useEffect, useState } from 'react';
import {
  MetaAdAccount,
  MetaAdConnection,
  connectMetaAccount,
  disconnectMetaAccount,
  findAdAccount,
  listAdAccounts,
  readAdConnection,
  selectAdAccount,
  subscribeAdConnection,
} from '../utils/adAccounts';

/**
 * 메타 광고 계정 연동 상태를 화면에 붙인다.
 *
 * 광고 현황과 부스팅 창이 같은 값을 봐야 하고(한쪽에서 계정을 바꾸면 다른 쪽도
 * 따라와야 한다), 두 화면이 각자 구독을 적으면 그 규칙이 두 군데로 갈라진다.
 * 그래서 읽기·구독·바꾸기를 여기 한 번만 적는다.
 */
export const useMetaAdConnection = (username: string) => {
  const [connection, setConnection] = useState<MetaAdConnection>(() => readAdConnection(username));

  useEffect(() => {
    setConnection(readAdConnection(username));
    return subscribeAdConnection(() => setConnection(readAdConnection(username)));
  }, [username]);

  const connect = useCallback(() => {
    // 실제 OAuth 리다이렉트가 붙을 자리는 connectMetaAccount() 안에 적어 뒀다.
    setConnection(connectMetaAccount(username));
  }, [username]);

  const disconnect = useCallback(() => {
    setConnection(disconnectMetaAccount(username));
  }, [username]);

  const selectAccount = useCallback(
    (accountId: string) => {
      setConnection(selectAdAccount(username, accountId));
    },
    [username],
  );

  // 목록은 연동 상태에서 그대로 온다(연동 전에는 빈 목록). 화면이 이 값을 의존성으로
  // 쓰기 때문에 매 렌더에 새 배열을 만들지 않는 편이 낫다 — listAdAccounts 가 같은
  // 배열을 돌려준다.
  const accounts: MetaAdAccount[] = listAdAccounts(username);
  const account = findAdAccount(connection.selectedAccountId);

  return {
    connection,
    /** 연동으로 쓸 수 있게 된 광고 계정. 연동 전에는 빈 목록이다. */
    accounts,
    /** 지금 고른 광고 계정. 고르기 전에는 null 이다. */
    account,
    connected: connection.connected,
    connect,
    disconnect,
    selectAccount,
  };
};
