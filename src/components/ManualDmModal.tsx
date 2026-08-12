import React, { useState, useEffect } from 'react';
import { Send, X, Loader2, AlertCircle, Check, Plus, Trash2, Image as ImageIcon, CornerDownRight } from 'lucide-react';
import { apiService, DmAutomationItem, DmMessageButton, InstagramMedia } from '../services/apiService';
import { useLanguage } from '../contexts/LanguageContext';

interface ManualDmModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  igUsername: string;
  automations: DmAutomationItem[];
  initialAutomation?: DmAutomationItem | null;
  entitled: boolean;
  media?: InstagramMedia[];
}

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * 결과 표시.
 *
 * 발송 결과를 사실대로 보여준다. 예전에는 결과와 무관하게 언제나 "보냈습니다!"만
 * 띄우고 실제 결과는 서버 로그에만 남겼는데, 인스타그램이 24시간 창·비공개 답장
 * 1회 제한으로 발송을 거부해도 화면은 성공으로 보였다. 그러면 사용자는 새 문구가
 * 나갔다고 믿은 채 DM 함에서 예전에 도착한 메시지만 보게 되고, 이를 "메시지를
 * 바꿨는데 계속 예전 문구가 온다"로 읽는다. 무엇이 왜 안 나갔는지 화면에서 바로
 * 알 수 있어야 한다.
 */
type ResultTone = 'success' | 'warn' | 'error';

const TONE_STYLE: Record<ResultTone, string> = {
  success: 'bg-green-50 text-green-700 border border-green-200',
  warn: 'bg-amber-50 text-amber-700 border border-amber-200',
  error: 'bg-red-50 text-red-600 border border-red-200',
};

export const ManualDmModal: React.FC<ManualDmModalProps> = ({
  isOpen,
  onClose,
  userName,
  igUsername,
  automations,
  initialAutomation,
  entitled,
  media = [],
}) => {
  const { t } = useLanguage();

  /**
   * 직접 작성 기본 문구는 화면 언어를 따라간다. 이 값은 화면 문구가 아니라 그대로
   * 인스타그램으로 나가는 내용이라, 한국어로 고정해 두면 영어로 쓰는 사용자가
   * 손대지 않은 기본값 그대로 한국어 DM 을 보내게 된다.
   */
  const defaultMessage = t(
    'dm.manualDefaultMessage',
    '안녕하세요! 요청하신 안내 링크입니다 😊',
    'Hello! Here is the link you requested 😊',
  );
  const defaultButtonLabel = t('dm.defaultButtonLabel', '링크 바로가기', 'Open link');

  const [selectedRuleId, setSelectedRuleId] = useState<string>('custom');
  const [messageType, setMessageType] = useState<'text' | 'carousel'>('text');
  const [message, setMessage] = useState(defaultMessage);
  const [buttons, setButtons] = useState<DmMessageButton[]>([
    { id: genId('btn'), label: defaultButtonLabel, url: '' },
  ]);
  /**
   * 댓글에 함께 남길 공개 답글 문구.
   *
   * 비워 두면 DM 만 나간다. 채워 두면 DM 과 같이 각 대상의 댓글에 답글이 달린다.
   * 자동화에 답글을 설정해 둔 경우 그 문구를 그대로 불러온다 — 수동으로 보낼 때만
   * 답글이 빠지면 "자동은 답글이 달리는데 수동은 안 달린다"가 된다.
   */
  const [replies, setReplies] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: ResultTone; message: string } | null>(null);

  /** 자동화에 설정된 답글 문구(꺼져 있으면 없는 것으로 본다). */
  const repliesOf = (a?: DmAutomationItem | null): string[] =>
    a?.replyEnabled ? (a.replies || []).filter((r) => r && r.trim()) : [];

  useEffect(() => {
    if (!isOpen) return;

    setResult(null);
    if (initialAutomation) {
      setSelectedRuleId(initialAutomation.id);
      setMessage(initialAutomation.message || '');
      setMessageType(initialAutomation.messageType || 'text');
      setButtons(initialAutomation.buttons?.length ? [...initialAutomation.buttons] : []);
      setReplies(repliesOf(initialAutomation));
    } else {
      setSelectedRuleId('custom');
      setMessage(defaultMessage);
      setMessageType('text');
      setButtons([{ id: genId('btn'), label: defaultButtonLabel, url: '' }]);
      setReplies([]);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [initialAutomation, isOpen]);

  const handleMessageChange = (value: string) => {
    setMessage(value);
    setMessageType('text');
  };

  const handleSelectRule = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    if (ruleId === 'custom') {
      setMessage(defaultMessage);
      setMessageType('text');
      setButtons([{ id: genId('btn'), label: defaultButtonLabel, url: '' }]);
      setReplies([]);
      return;
    }
    const found = automations.find((a) => a.id === ruleId);
    if (found) {
      setMessage(found.message || '');
      setMessageType(found.messageType || 'text');
      setButtons(found.buttons ? [...found.buttons] : []);
      setReplies(repliesOf(found));
    }
  };

  const handleAddButton = () => {
    if (buttons.length >= 3) return;
    setButtons([...buttons, { id: genId('btn'), label: '', url: '' }]);
  };

  const handleUpdateButton = (id: string, field: 'label' | 'url', val: string) => {
    setButtons(buttons.map((b) => (b.id === id ? { ...b, [field]: val } : b)));
  };

  const handleRemoveButton = (id: string) => {
    setButtons(buttons.filter((b) => b.id !== id));
  };

  const handleAddReply = () => setReplies([...replies, '']);

  const handleUpdateReply = (index: number, val: string) => {
    setReplies(replies.map((r, i) => (i === index ? val : r)));
  };

  const handleRemoveReply = (index: number) => {
    setReplies(replies.filter((_, i) => i !== index));
  };

  const selectedRule = automations.find((a) => a.id === selectedRuleId);
  const activeMediaScope = selectedRule ? selectedRule.mediaScope : initialAutomation?.mediaScope;
  const activeMediaIds = selectedRule ? selectedRule.mediaIds : initialAutomation?.mediaIds;

  const effectiveMediaIds = activeMediaScope === 'selected' && activeMediaIds?.length ? activeMediaIds : undefined;
  const effectiveMediaId = effectiveMediaIds && effectiveMediaIds.length === 1 ? effectiveMediaIds[0] : undefined;
  const targetMediaPost = effectiveMediaId ? media.find((m) => m.id === effectiveMediaId) : null;

  const handleSend = async () => {
    const validReplies = replies.map((r) => r.trim()).filter(Boolean);

    // DM 본문 없이 댓글 답글만 보내는 것도 발송이다. 둘 다 비었을 때만 막는다.
    if (!message.trim() && validReplies.length === 0) {
      setResult({
        tone: 'error',
        message: t(
          'dm.contentRequired',
          '보낼 DM 내용이나 댓글 답글 중 하나는 입력해주세요.',
          'Enter a DM message or a comment reply to send.',
        ),
      });
      return;
    }

    setSending(true);
    setResult(null);

    const validButtons = buttons.filter((b) => b.label.trim());

    let outcome: { tone: ResultTone; message: string; done: boolean };
    try {
      const res = await apiService.sendInstagramDm({
        username: userName,
        mediaId: effectiveMediaId,
        mediaIds: effectiveMediaIds,
        message: message.trim(),
        messageType,
        buttons: validButtons,
        cards: messageType === 'carousel' ? (selectedRule?.cards || initialAutomation?.cards) : undefined,
        replies: validReplies,
        ruleId: selectedRuleId !== 'custom' ? selectedRuleId : undefined,
        test: true,
      });

      // DM 과 댓글 답글은 함께 나간다. 둘 중 하나라도 나갔으면 발송된 것이다.
      const sentCount = (res.count || 0) + (res.replyCount || 0);
      const failedCount = (res.failCount || 0) + (res.replyFailCount || 0);
      // 서버가 건수·건너뜀·실패 이유를 사람이 읽을 문장으로 이미 만들어 준다.
      // (플랜 미충족처럼 요청 자체가 거절된 경우는 error 에 이유가 담긴다.)
      const detail = res.message?.trim() || res.error?.trim();

      if (res.connected === false) {
        outcome = {
          tone: 'error',
          message: detail || t(
            'dm.notConnected',
            '인스타그램 계정이 연동되지 않아 발송하지 못했습니다.',
            'The Instagram account is not connected, so nothing was sent.',
          ),
          done: false,
        };
      } else if (res.indeterminate) {
        outcome = {
          tone: 'warn',
          message: detail || t(
            'dm.sendIndeterminate',
            '발송 결과를 확인하지 못했습니다. 인스타그램 DM 함을 확인한 뒤 다시 시도해 주세요.',
            'The send result could not be confirmed. Check your Instagram inbox before retrying.',
          ),
          done: false,
        };
      } else if (sentCount > 0) {
        // 한 건이라도 나갔으면 성공이다. 건너뛴 대상·남은 대상 안내는 함께 보여준다.
        outcome = {
          tone: failedCount > 0 || (res.remaining || 0) > 0 ? 'warn' : 'success',
          message: detail || t('dm.sentAlert', '보냈습니다!', 'Sent!'),
          done: failedCount === 0 && (res.remaining || 0) === 0,
        };
      } else {
        // 한 건도 나가지 않았다. 이유(24시간 창·중복·연동 문제)를 그대로 보여준다.
        outcome = {
          tone: res.success ? 'warn' : 'error',
          message: detail || t(
            'dm.sendNothingSent',
            '발송된 DM이 없습니다. 인스타그램 정책상 최근 24시간 안에 댓글을 남긴 사람에게만 보낼 수 있어요.',
            'No DMs were sent. Instagram only allows messaging people who commented within the last 24 hours.',
          ),
          done: false,
        };
      }
    } catch (e) {
      console.error('[ManualDmModal] 발송 요청 실패:', e);
      outcome = {
        tone: 'error',
        message: t(
          'dm.sendRequestFailed',
          '발송 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          'The send request failed. Please try again in a moment.',
        ),
        done: false,
      };
    }

    setResult({ tone: outcome.tone, message: outcome.message });
    setSending(false);

    // 전부 정상 발송된 경우에만 자동으로 닫는다. 그 밖의 결과는 사용자가 읽고
    // 조치(대상·문구·연동 확인)할 수 있게 화면에 남겨 둔다.
    if (outcome.done) {
      setTimeout(() => {
        setResult(null);
        onClose();
      }, 2200);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 md:p-6 border-b border-slate-100 bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-pink-500 to-orange-400 flex items-center justify-center text-white shadow-md">
              <Send size={18} />
            </div>
            <div>
              <h3 className="font-black text-base md:text-lg">
                {t('dm.manualModalTitleBatch', '댓글 단 사람 모두에게 보내기', 'Send to All Commenters')}
              </h3>
              <p className="text-[11px] text-slate-300 font-medium">
                @{igUsername || userName} {t('dm.accountLabel', '계정으로 발송', 'Account')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 md:p-6 overflow-y-auto space-y-4 flex-1">
          {result && (
            <div className={`p-4 rounded-2xl flex items-start gap-2 text-xs font-bold ${TONE_STYLE[result.tone]}`}>
              {result.tone === 'success' ? (
                <Check size={16} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{result.message}</span>
            </div>
          )}

          {/* 발송 대상 게시물 정보 */}
          {targetMediaPost ? (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-3">
              {targetMediaPost.mediaUrl ? (
                <img src={targetMediaPost.mediaUrl} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-slate-200" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 text-slate-400">
                  <ImageIcon size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="inline-block px-2 py-0.5 rounded-md bg-pink-100 text-pink-700 text-[10px] font-black mb-0.5">
                  발송 대상 게시물
                </span>
                <p className="text-xs font-bold text-slate-800 truncate">
                  {targetMediaPost.caption ? targetMediaPost.caption.slice(0, 45) : `게시물 ID: ${targetMediaPost.id}`}
                </p>
              </div>
            </div>
          ) : effectiveMediaIds && effectiveMediaIds.length > 1 ? (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-slate-700">
              <span className="px-2 py-0.5 rounded-md bg-pink-100 text-pink-700 text-[10px] font-black">
                발송 대상
              </span>
              <span>선택된 게시물 {effectiveMediaIds.length}개 댓글 작성자</span>
            </div>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-slate-700">
              <span className="px-2 py-0.5 rounded-md bg-pink-100 text-pink-700 text-[10px] font-black">
                발송 대상
              </span>
              <span>모든 최근 게시물 댓글 작성자</span>
            </div>
          )}

          {/* 템플릿 불러오기 */}
          {automations.length > 0 && (
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1.5">
                {t('dm.templateSelectLabel', '자동화 템플릿 선택', 'Select Template')}
              </label>
              <select
                value={selectedRuleId}
                onChange={(e) => handleSelectRule(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-pink-500 bg-white"
              >
                <option value="custom">{t('dm.customInput', '직접 작성 (Custom Message)', 'Custom Input')}</option>
                {automations.map((a) => (
                  <option key={a.id} value={a.id} data-user-content>
                    [자동화] {a.name || '제목 없음'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* DM 메시지 본문 */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1.5">
              {t('dm.messageText', 'DM 메시지 내용', 'DM Message Content')}
            </label>
            <textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              rows={3}
              placeholder={t('dm.messagePlaceholder', '발송할 DM 문구를 입력하세요.', 'Type the DM message to send.')}
              className="w-full p-4 rounded-2xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 resize-none"
            />
          </div>

          {/* 댓글 공개 답글 — 입력해 두면 DM 과 함께 나간다 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <CornerDownRight size={13} className="text-slate-400" />
                {t('dm.commentReply', '댓글 답글 (선택)', 'Comment Reply (optional)')}
              </label>
              <button
                type="button"
                onClick={handleAddReply}
                className={`text-xs font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1 ${
                  replies.length === 0 ? 'hidden' : ''
                }`}
              >
                <Plus size={13} /> {t('dm.addReply', '답글 추가', 'Add Reply')}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 font-medium mb-2">
              {t(
                'dm.commentReplyHint',
                '입력해 두면 DM과 함께 각 댓글에 공개 답글이 달려요. 여러 개면 무작위로 하나가 달립니다.',
                'If filled in, a public reply is posted on each comment along with the DM. With several, one is picked at random.',
              )}
            </p>

            {replies.length === 0 ? (
              <button
                type="button"
                onClick={handleAddReply}
                className="w-full border border-dashed border-slate-300 rounded-2xl py-2.5 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500 transition-colors"
              >
                + {t('dm.addReply', '답글 추가', 'Add Reply')}
              </button>
            ) : (
              <div className="space-y-2">
                {replies.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={r}
                      onChange={(e) => handleUpdateReply(idx, e.target.value)}
                      placeholder={t('dm.replyPlaceholder', '예: DM 확인해주세요! 📩', 'e.g. Check your DMs! 📩')}
                      className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-pink-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveReply(idx)}
                      className="text-slate-400 hover:text-red-500 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 링크 버튼 설정 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black text-slate-700">
                {t('dm.buttons', '링크 버튼 설정', 'Link Buttons')}
              </label>
              {buttons.length < 3 && (
                <button
                  type="button"
                  onClick={handleAddButton}
                  className="text-xs font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1"
                >
                  <Plus size={13} /> {t('dm.addButton', '버튼 추가', 'Add Button')}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {buttons.map((b, idx) => (
                <div key={b.id || idx} className="flex items-center gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <input
                    type="text"
                    value={b.label}
                    onChange={(e) => handleUpdateButton(b.id, 'label', e.target.value)}
                    placeholder={t('dm.buttonLabelPlaceholder', '버튼 라벨 (예: 링크 바로가기)', 'Button Label')}
                    className="w-1/3 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-pink-500"
                  />
                  <input
                    type="url"
                    value={b.url}
                    onChange={(e) => handleUpdateButton(b.id, 'url', e.target.value)}
                    placeholder="https://..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:border-pink-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveButton(b.id)}
                    className="text-slate-400 hover:text-red-500 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 md:p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            {t('dm.cancel', '취소', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !entitled}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-pink-600 to-orange-500 hover:opacity-95 shadow-lg shadow-pink-500/20 disabled:opacity-50 transition-all"
          >
            {sending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>{t('dm.sending', '발송 중...', 'Sending...')}</span>
              </>
            ) : (
              <>
                <Send size={14} />
                <span>{t('dm.send', '보내기', 'Send')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualDmModal;
