import React, { useEffect, useState } from 'react';
import {
  Instagram, Check, Plus, Trash2, Send, Loader2, ShieldCheck, MessageSquare,
  Zap, KeyRound, Info, X,
} from 'lucide-react';
import { apiService, DmAutomationSettings, DmRule, DmTrigger } from '../services/apiService';

interface DmAutomationProps {
  userName: string;
}

const TRIGGER_META: Record<DmTrigger, { label: string; desc: string; needsKeyword?: boolean }> = {
  welcome: { label: '첫 메시지 환영', desc: '고객이 처음 DM을 보내면 자동으로 인사 메시지를 보냅니다.' },
  new_follower: { label: '새 팔로워', desc: '새로운 팔로워에게 환영 DM을 보냅니다.' },
  comment_keyword: { label: '댓글 키워드', desc: '게시물 댓글에 특정 키워드가 달리면 DM을 보냅니다.', needsKeyword: true },
  story_reply: { label: '스토리 답장', desc: '스토리에 답장이 오면 자동으로 응답합니다.' },
  new_order: { label: '새 주문', desc: '라이브/스토어에서 주문이 발생하면 감사 DM을 보냅니다.' },
};

const genId = () => `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const blankRule = (): DmRule => ({
  id: genId(),
  trigger: 'welcome',
  keyword: '',
  message: '',
  enabled: true,
});

const DmAutomation: React.FC<DmAutomationProps> = ({ userName }) => {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [igUsername, setIgUsername] = useState('');
  const [igAccountId, setIgAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [rules, setRules] = useState<DmRule[]>([]);
  const [logs, setLogs] = useState<DmAutomationSettings['logs']>([]);

  const [testRecipient, setTestRecipient] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiService.getDmAutomation(userName).then((s) => {
      if (cancelled) return;
      setEnabled(s.enabled);
      setIgUsername(s.igUsername || '');
      setIgAccountId(s.igAccountId || '');
      setHasAccessToken(Boolean(s.hasAccessToken));
      setRules(Array.isArray(s.rules) ? s.rules : []);
      setLogs(s.logs || []);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [userName]);

  const connected = hasAccessToken && Boolean(igAccountId);

  const persist = async (overrides?: Partial<DmAutomationSettings> & { accessToken?: string }) => {
    setSaving(true);
    const payload = {
      enabled,
      igUsername,
      igAccountId,
      rules,
      // 토큰은 새로 입력했을 때만 전송한다(빈 값이면 서버가 기존 값 유지).
      ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      ...overrides,
    };
    const ok = await apiService.saveDmAutomation(userName, payload);
    setSaving(false);
    if (ok) {
      setSavedAt(Date.now());
      if (accessToken.trim()) { setHasAccessToken(true); setAccessToken(''); }
      setTimeout(() => setSavedAt((p) => (p && Date.now() - p > 1800 ? null : p)), 2200);
    } else {
      alert('저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
    return ok;
  };

  const addRule = () => setRules((prev) => [...prev, blankRule()]);
  const updateRule = (id: string, patch: Partial<DmRule>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRule = (id: string) => setRules((prev) => prev.filter((r) => r.id !== id));

  const runTest = async () => {
    if (!testMessage.trim()) { alert('테스트로 보낼 메시지를 입력해주세요.'); return; }
    if (!testRecipient.trim()) { alert('수신자 IGSID를 입력해주세요.'); return; }
    setTesting(true);
    setTestResult(null);
    const res = await apiService.sendInstagramDm({
      username: userName,
      recipientId: testRecipient.trim(),
      message: testMessage.trim(),
      test: true,
    });
    setTesting(false);
    setTestResult({
      ok: Boolean(res.success),
      text: res.success ? '테스트 DM을 전송했습니다.' : (res.message || '전송에 실패했습니다.'),
    });
    // 최신 로그 반영
    apiService.getDmAutomation(userName).then((s) => setLogs(s.logs || []));
  };

  const formatTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(new Date(iso));
    } catch { return iso; }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-7 h-7 text-pink-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white shadow-lg shadow-pink-500/30">
            <Instagram className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div>
            <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-0.5 md:mb-1">DM 자동화</h2>
            <p className="text-slate-500 font-medium text-[10px] md:text-base">
              인스타그램 DM을 규칙에 따라 자동으로 발송합니다.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-green-600 text-[11px] md:text-sm font-bold flex items-center gap-1">
              <Check size={15} /> 저장됨
            </span>
          )}
          <span className={`text-[10px] md:text-xs font-black px-3 py-1.5 rounded-full ${
            connected ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {connected ? '● 연결됨' : '○ 미연결'}
          </span>
        </div>
      </header>

      {/* 마스터 토글 */}
      <section className="bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 p-5 md:p-7 rounded-2xl md:rounded-[2rem] shadow-lg shadow-pink-500/20 mb-5 md:mb-7">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-white">
            <Zap className="w-6 h-6 md:w-7 md:h-7 shrink-0" />
            <div>
              <h3 className="text-base md:text-xl font-black">DM 자동 발송</h3>
              <p className="text-[10px] md:text-sm text-white/80 font-medium">
                {enabled ? '활성화되어 규칙에 따라 DM이 발송됩니다.' : '현재 비활성화 상태입니다.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setEnabled((v) => !v); persist({ enabled: !enabled }); }}
            className={`relative w-14 h-8 rounded-full transition-all shrink-0 ${enabled ? 'bg-white' : 'bg-white/30'}`}
            aria-label="DM 자동화 켜기/끄기"
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full transition-all ${
              enabled ? 'left-7 bg-pink-600' : 'left-1 bg-white'
            }`} />
          </button>
        </div>
      </section>

      {/* 계정 연결 */}
      <section className="bg-white p-5 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm mb-5 md:mb-7">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-pink-100 flex items-center justify-center">
            <KeyRound className="w-4 h-4 md:w-5 md:h-5 text-pink-600" />
          </div>
          <div>
            <h3 className="text-base md:text-xl font-black text-slate-900">인스타그램 계정 연결</h3>
            <p className="text-[10px] md:text-xs text-slate-500 font-medium">
              Instagram 비즈니스 계정 ID와 액세스 토큰을 입력하세요.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">인스타그램 아이디</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">@</span>
              <input
                type="text"
                value={igUsername}
                onChange={(e) => setIgUsername(e.target.value.replace(/^@/, ''))}
                placeholder="mybrand"
                className="w-full bg-white border border-slate-200 rounded-xl pl-7 pr-4 py-3 text-sm font-bold focus:outline-none focus:border-pink-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">비즈니스 계정 ID</label>
            <input
              type="text"
              value={igAccountId}
              onChange={(e) => setIgAccountId(e.target.value.trim())}
              placeholder="17841400000000000"
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-pink-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              액세스 토큰
              {hasAccessToken && <span className="ml-2 text-green-600 normal-case tracking-normal">저장됨 ✓</span>}
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={hasAccessToken ? '변경하려면 새 토큰을 입력하세요' : 'EAAG...'}
              autoComplete="off"
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-pink-500"
            />
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
          <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
            토큰은 안전하게 서버에만 저장되며 화면에는 다시 표시되지 않습니다. Meta 개발자 콘솔에서 발급한
            <b> instagram_manage_messages</b> 권한이 포함된 페이지 액세스 토큰이 필요합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={() => persist()}
          disabled={saving}
          className="mt-4 w-full md:w-auto flex items-center justify-center gap-2 bg-slate-900 text-white rounded-xl py-3 px-8 text-sm font-black hover:bg-slate-800 transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
          계정 정보 저장
        </button>
      </section>

      {/* 자동 응답 규칙 */}
      <section className="bg-white p-5 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm mb-5 md:mb-7">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-purple-100 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-base md:text-xl font-black text-slate-900">자동 응답 규칙</h3>
              <p className="text-[10px] md:text-xs text-slate-500 font-medium">상황별로 자동 발송할 메시지를 설정하세요.</p>
            </div>
          </div>
          <span className="text-slate-400 text-[10px] md:text-xs font-bold">{rules.length}개</span>
        </div>

        {rules.length === 0 ? (
          <div className="text-center py-8 md:py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60 mb-4">
            <MessageSquare size={26} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-bold text-sm">등록된 규칙이 없습니다</p>
            <p className="text-slate-400 text-xs mt-1">아래 버튼을 눌러 자동 응답 규칙을 추가하세요</p>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            {rules.map((rule) => {
              const meta = TRIGGER_META[rule.trigger];
              return (
                <div key={rule.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <select
                      value={rule.trigger}
                      onChange={(e) => updateRule(rule.id, { trigger: e.target.value as DmTrigger })}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-black text-slate-700 focus:outline-none focus:border-pink-500"
                    >
                      {(Object.keys(TRIGGER_META) as DmTrigger[]).map((t) => (
                        <option key={t} value={t}>{TRIGGER_META[t].label}</option>
                      ))}
                    </select>
                    {meta.needsKeyword && (
                      <input
                        type="text"
                        value={rule.keyword || ''}
                        onChange={(e) => updateRule(rule.id, { keyword: e.target.value })}
                        placeholder="키워드 (예: 가격)"
                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                      />
                    )}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                      className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${rule.enabled ? 'bg-pink-500' : 'bg-slate-300'}`}
                      aria-label="규칙 켜기/끄기"
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.id)}
                      className="w-9 h-9 bg-white border border-red-100 text-red-400 rounded-lg flex items-center justify-center hover:text-red-500 transition-all"
                      aria-label="규칙 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mb-2">{meta.desc}</p>
                  <textarea
                    value={rule.message}
                    onChange={(e) => updateRule(rule.id, { message: e.target.value })}
                    placeholder="보낼 메시지를 입력하세요. 예: 안녕하세요! 문의해주셔서 감사합니다 😊"
                    rows={3}
                    maxLength={1000}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-2">
          <button
            type="button"
            onClick={addRule}
            className="flex-1 flex items-center justify-center gap-2 bg-purple-50 text-purple-600 rounded-xl py-3 px-4 text-sm font-black hover:bg-purple-100 transition-all"
          >
            <Plus size={16} /> 규칙 추가
          </button>
          <button
            type="button"
            onClick={() => persist()}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-pink-600 text-white rounded-xl py-3 px-4 text-sm font-black hover:bg-pink-700 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            규칙 저장
          </button>
        </div>
      </section>

      {/* 테스트 전송 */}
      <section className="bg-white p-5 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm mb-5 md:mb-7">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Send className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base md:text-xl font-black text-slate-900">테스트 전송</h3>
            <p className="text-[10px] md:text-xs text-slate-500 font-medium">실제 DM이 정상 발송되는지 바로 확인하세요.</p>
          </div>
        </div>
        <div className="space-y-3">
          <input
            type="text"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            placeholder="수신자 IGSID (Instagram-scoped ID)"
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-blue-500"
          />
          <textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="테스트 메시지 내용"
            rows={2}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-blue-500 resize-none"
          />
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="w-full md:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl py-3 px-8 text-sm font-black hover:bg-blue-700 transition-all disabled:opacity-50"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            테스트 DM 보내기
          </button>
          {testResult && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold ${
              testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {testResult.ok ? <Check size={16} /> : <X size={16} />}
              {testResult.text}
            </div>
          )}
        </div>
      </section>

      {/* 최근 발송 기록 */}
      {logs && logs.length > 0 && (
        <section className="bg-white p-5 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-base md:text-xl font-black text-slate-900 mb-4">최근 발송 기록</h3>
          <div className="space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50/70 border border-slate-100 rounded-xl px-4 py-3">
                <span className={`text-[10px] font-black px-2 py-1 rounded-full shrink-0 ${
                  log.status === 'sent' ? 'bg-green-100 text-green-700'
                    : log.status === 'failed' ? 'bg-red-100 text-red-600'
                    : 'bg-slate-200 text-slate-500'
                }`}>
                  {log.status === 'sent' ? '전송' : log.status === 'failed' ? '실패' : '건너뜀'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-700 truncate">
                    {log.recipientId ? `→ ${log.recipientId}` : '수신자 없음'}
                    {log.test && <span className="ml-1 text-blue-500">(테스트)</span>}
                  </p>
                  {(log.error || log.reason) && (
                    <p className="text-[10px] text-red-400 font-medium truncate">{log.error || log.reason}</p>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-bold shrink-0">{formatTime(log.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default DmAutomation;
