import React, { useState, useEffect } from 'react';
import { Send, X, Loader2, AlertCircle, Check, Plus, Trash2, Link2, Sparkles, MessageCircle } from 'lucide-react';
import { apiService, DmAutomationItem, DmMessageButton, DmCarouselCard } from '../services/apiService';
import { useLanguage } from '../contexts/LanguageContext';

interface ManualDmModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  igUsername: string;
  automations: DmAutomationItem[];
  initialAutomation?: DmAutomationItem | null;
  entitled: boolean;
}

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const ManualDmModal: React.FC<ManualDmModalProps> = ({
  isOpen,
  onClose,
  userName,
  igUsername,
  automations,
  initialAutomation,
  entitled,
}) => {
  const { t } = useLanguage();

  const [recipientId, setRecipientId] = useState('');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('custom');
  const [messageType, setMessageType] = useState<'text' | 'carousel'>('text');
  const [message, setMessage] = useState('안녕하세요! 요청하신 안내 링크입니다 😊');
  const [buttons, setButtons] = useState<DmMessageButton[]>([
    { id: genId('btn'), label: '링크 바로가기', url: '' },
  ]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (initialAutomation) {
      setSelectedRuleId(initialAutomation.id);
      setMessage(initialAutomation.message || '');
      setMessageType(initialAutomation.messageType || 'text');
      setButtons(initialAutomation.buttons?.length ? [...initialAutomation.buttons] : []);
    } else {
      setSelectedRuleId('custom');
    }
  }, [initialAutomation, isOpen]);

  const handleSelectRule = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    if (ruleId === 'custom') {
      setMessage('안녕하세요! 요청하신 안내 링크입니다 😊');
      setMessageType('text');
      setButtons([{ id: genId('btn'), label: '링크 바로가기', url: '' }]);
      return;
    }
    const found = automations.find((a) => a.id === ruleId);
    if (found) {
      setMessage(found.message || '');
      setMessageType(found.messageType || 'text');
      setButtons(found.buttons ? [...found.buttons] : []);
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

  const handleSend = async () => {
    if (!recipientId.trim()) {
      setResult({
        success: false,
        message: t('dm.recipientRequired', '수신자 IGSID (Instagram-scoped ID)를 입력해주세요.', 'Recipient IGSID is required.'),
      });
      return;
    }

    if (!message.trim()) {
      setResult({
        success: false,
        message: t('dm.messageRequired', '발송할 DM 메시지 내용을 입력해주세요.', 'DM message content is required.'),
      });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const validButtons = buttons.filter((b) => b.label.trim());
      const res = await apiService.sendInstagramDm({
        username: userName,
        recipientId: recipientId.trim(),
        message: message.trim(),
        messageType,
        buttons: validButtons,
        ruleId: selectedRuleId !== 'custom' ? selectedRuleId : undefined,
        test: true,
      });

      if (res.success) {
        setResult({
          success: true,
          message: t('dm.sendSuccess', 'DM이 성공적으로 발송되었습니다!', 'DM sent successfully!'),
        });
        setTimeout(() => {
          setResult(null);
          onClose();
        }, 1800);
      } else {
        setResult({
          success: false,
          message: res.message || t('dm.sendFailed', 'DM 발송에 실패했습니다.', 'Failed to send DM.'),
        });
      }
    } catch (e: any) {
      setResult({
        success: false,
        message: e?.message || t('dm.sendError', '발송 중 오류가 발생했습니다.', 'An error occurred while sending.'),
      });
    } finally {
      setSending(false);
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
                {t('dm.manualModalTitle', '수동 DM 발송하기', 'Send DM Manually')}
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
            <div
              className={`p-4 rounded-2xl flex items-start gap-2 text-xs font-bold ${
                result.success
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}
            >
              {result.success ? <Check size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
              <span>{result.message}</span>
            </div>
          )}

          {/* 수신자 IGSID */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1.5">
              {t('dm.recipientLabel', '수신자 IGSID (Instagram User ID)', 'Recipient IGSID')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              placeholder={t('dm.recipientPlaceholder', '예: 123456789012345', 'e.g. 123456789012345')}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
            />
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              {t(
                'dm.recipientNotice',
                '인스타그램 정책상 수신자가 먼저 메시지를 보낸 24시간 이내에만 수동 DM 발송이 가능합니다.',
                'According to Instagram policy, manual DMs can only be sent within 24 hours after the user messages you.'
              )}
            </p>
          </div>

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
                  <option key={a.id} value={a.id}>
                    [자동화] {a.name || '제목 없음'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* DM 메시지 본문 */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1.5">
              {t('dm.messageText', 'DM 메시지 내용', 'DM Message Content')} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={t('dm.messagePlaceholder', '발송할 DM 문구를 입력하세요.', 'Type the DM message to send.')}
              className="w-full p-4 rounded-2xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 resize-none"
            />
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
                <span>{t('dm.sendNow', '수동 발송하기', 'Send DM Now')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualDmModal;
