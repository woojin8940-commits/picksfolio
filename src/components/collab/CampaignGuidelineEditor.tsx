import React, { useState } from 'react';
import { authHeaders } from '../../services/apiService';

/**
 * 콘텐츠 가이드라인 — 등록 이후에 작성한다.
 *
 * 예전에는 캠페인 등록 폼 안에 있었다. 그런데 가이드라인은 "누가 찍을지"가 정해진
 * 뒤에야 구체적으로 쓸 수 있는 내용이다(어느 장면을 강조할지, 어떤 표현을 피해야
 * 하는지). 등록 단계에 두면 아직 정하지 못한 브랜드는 빈칸으로 넘기고, 결국 촬영이
 * 시작될 때까지 아무도 채우지 않았다.
 *
 * 그래서 등록에서 빼고 상세 화면의 배너로 옮겼다. 비어 있으면 [필수] 배지를 달고
 * 눈에 걸리게 둔다 — 담당자가 인플루언서에게 가이드를 전달하는 단계에서 반드시
 * 필요한 내용이기 때문이다.
 */

interface CampaignGuidelineEditorProps {
  campaignId: string;
  guidelineNote: string;
  guidelineUrl: string;
  isOwner: boolean;
  /** 저장 후 상위 화면의 캠페인 상태를 갱신한다. */
  onSaved: (next: { guideline_note: string; guideline_url: string }) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const INPUT =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const CampaignGuidelineEditor: React.FC<CampaignGuidelineEditorProps> = ({
  campaignId,
  guidelineNote,
  guidelineUrl,
  isOwner,
  onSaved,
  onNotify,
}) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(guidelineNote);
  const [url, setUrl] = useState(guidelineUrl);
  const [saving, setSaving] = useState(false);

  const written = !!(guidelineNote.trim() || guidelineUrl.trim());

  const save = async () => {
    if (!note.trim() && !url.trim()) {
      onNotify('가이드라인 내용이나 문서 링크 중 하나는 있어야 합니다.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: campaignId, guideline_note: note, guideline_url: url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify(err.error || '가이드라인 저장에 실패했습니다.', 'error');
        return;
      }
      onSaved({ guideline_note: note, guideline_url: url });
      onNotify('가이드라인을 저장했습니다. 담당자가 인플루언서에게 전달합니다.');
      setOpen(false);
    } catch {
      onNotify('가이드라인 저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {written ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900">콘텐츠 가이드라인</p>
              {guidelineNote && (
                <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap mt-2 leading-relaxed">
                  {guidelineNote}
                </p>
              )}
              {guidelineUrl && (
                <a
                  href={guidelineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[11px] text-blue-600 font-black hover:underline mt-2"
                >
                  가이드라인 문서 보기 →
                </a>
              )}
            </div>
            {isOwner && (
              <button
                onClick={() => setOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-black text-slate-600 flex-shrink-0 transition-colors"
              >
                수정
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-blue-900">
              콘텐츠 가이드라인 작성하기
              <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-blue-600 text-white text-[10px] align-middle">필수</span>
            </p>
            <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
              인플루언서가 촬영할 때 지켜야 할 것을 적어 주세요. 담당자가 이 내용을 정리해 전달합니다.
              작성 전에는 촬영이 시작되지 않습니다.
            </p>
          </div>
          {isOwner && (
            <button
              onClick={() => setOpen(true)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex-shrink-0 transition-colors"
            >
              가이드라인 작성
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="bg-white w-full md:max-w-xl rounded-t-3xl md:rounded-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">콘텐츠 가이드라인</h3>
              <p className="text-[11px] text-slate-400 font-medium mt-1">
                꼭 넣어야 하는 장면·문구와, 피해야 할 표현을 적어 주세요.
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">가이드라인 내용</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={9}
                  maxLength={2000}
                  className={INPUT}
                  placeholder={
                    '예)\n· 제품명은 영상 시작 5초 안에 언급해 주세요.\n· 사용 전/후를 같은 조명에서 촬영해 주세요.\n· "치료", "완치" 등 의학적 표현은 사용할 수 없습니다.\n· 유료 광고 표기(#광고)를 본문 첫 줄에 넣어 주세요.'
                  }
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1 text-right">{note.length}/2,000</p>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">가이드라인 문서 링크 (선택)</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className={INPUT}
                  placeholder="https://"
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  PDF·노션 등 자료가 있으면 링크를 넣어 주세요.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CampaignGuidelineEditor;
