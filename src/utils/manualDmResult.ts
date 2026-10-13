export interface ManualDmBatchResult {
  success: boolean;
  connected?: boolean;
  count?: number;
  replyCount?: number;
  failCount?: number;
  replyFailCount?: number;
  partialCount?: number;
  remaining?: number;
  incomplete?: boolean;
  indeterminate?: boolean;
  message?: string;
  error?: string;
}

export function manualDmResult(batches: ManualDmBatchResult[], english = false, requestFailed = false): {
  tone: 'success' | 'warn' | 'error'; message: string; done: boolean;
} {
  const count = (value?: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  const sum = (field: 'count' | 'replyCount' | 'failCount' | 'replyFailCount' | 'partialCount') =>
    batches.reduce((total, batch) => total + count(batch[field]), 0);
  const sent = sum('count');
  const replies = sum('replyCount');
  const failures = sum('failCount') + sum('replyFailCount');
  const partial = sum('partialCount');
  const last = batches[batches.length - 1];
  const summary = english ? `DM sent: ${sent}; replies sent: ${replies}.` : `DM ${sent}건, 답글 ${replies}건 발송했습니다.`;
  if (requestFailed || !last || last.indeterminate) {
    return { tone: 'warn', done: false, message: `${summary} ${english
      ? 'The last request could not be confirmed. Check delivery before retrying.'
      : '마지막 요청의 발송 결과를 확인하지 못했습니다. 인스타그램에서 도착 여부를 확인해 주세요.'}` };
  }
  if (last.connected === false || last.error) {
    return { tone: 'error', done: false, message: `${summary} ${last.error || last.message || (english ? 'Reconnect Instagram.' : '인스타그램 연동을 확인해 주세요.')}` };
  }
  if (count(last.remaining) > 0 || last.incomplete) {
    return { tone: 'warn', done: false, message: `${summary} ${english
      ? 'Some targets remain. Sending is not complete.'
      : '아직 처리하지 못한 대상이 있어 발송이 끝나지 않았습니다.'} ${last.message || ''}`.trim() };
  }
  if (failures > 0 || partial > 0) {
    return { tone: sent + replies > 0 ? 'warn' : 'error', done: false, message: `${summary} ${english
      ? `Failed sends: ${failures}; partially sent DMs: ${partial}.`
      : `실패 ${failures}건, 일부만 발송된 DM ${partial}건이 있습니다.`} ${last.message || ''}`.trim() };
  }
  if (!last.success) {
    return { tone: 'warn', done: false, message: `${summary} ${last.message || (english ? 'No eligible targets were sent.' : '발송 가능한 대상이 없습니다.')}` };
  }
  return { tone: 'success', done: true, message: summary };
}
