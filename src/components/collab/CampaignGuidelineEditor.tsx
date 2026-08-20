import React, { useState } from 'react';
import { authHeaders, apiService } from '../../services/apiService';

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
 *
 * 파일 업로드가 중심이다. 브랜드가 실제로 가진 가이드는 PDF·PPT·이미지 파일이고,
 * 링크 칸만 있으면 어딘가에 먼저 올려 공유 주소를 만들어야 해서 대부분은 그냥
 * 카카오톡으로 파일을 보내고 이 칸을 비워 두었다. 여기 올린 파일은 진행사항의
 * 인플루언서 상세에서 그대로 열린다.
 */

export type GuidelineFile = {
  url: string;
  name: string;
  mimeType?: string;
  uploadedAt?: string;
  uploadedBy?: string;
};

interface CampaignGuidelineEditorProps {
  campaignId: string;
  guidelineNote: string;
  guidelineUrl: string;
  guidelineFiles: GuidelineFile[];
  isOwner: boolean;
  /** 저장 후 상위 화면의 캠페인 상태를 갱신한다. */
  onSaved: (next: { guideline_note: string; guideline_url: string; guideline_files: GuidelineFile[] }) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const INPUT =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

/** 저장된 값이 문자열(JSONB 문자열)로 올 때가 있어 화면에서 한 번 더 풀어 준다. */
export const parseGuidelineFiles = (raw: unknown): GuidelineFile[] => {
  let value: any = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((f: any) => f && typeof f.url === 'string' && f.url);
};

const CampaignGuidelineEditor: React.FC<CampaignGuidelineEditorProps> = ({
  campaignId,
  guidelineNote,
  guidelineUrl,
  guidelineFiles,
  isOwner,
  onSaved,
  onNotify,
}) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(guidelineNote);
  const [url, setUrl] = useState(guidelineUrl);
  const [files, setFiles] = useState<GuidelineFile[]>(guidelineFiles);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const written = !!(guidelineNote.trim() || guidelineUrl.trim() || guidelineFiles.length > 0);

  const openEditor = () => {
    // 열 때마다 저장된 값에서 다시 시작한다. 취소하고 다시 열었을 때 지웠던 줄이
    // 남아 있으면 무엇이 저장된 상태인지 알 수 없다.
    setNote(guidelineNote);
    setUrl(guidelineUrl);
    setFiles(guidelineFiles);
    setOpen(true);
  };

  const addFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    const added: GuidelineFile[] = [];
    for (const file of Array.from(picked)) {
      const fileUrl = await apiService.uploadProposalAttachment(`guideline-${campaignId}`, file);
      if (!fileUrl) {
        onNotify(`${file.name} 업로드에 실패했습니다.`, 'error');
        continue;
      }
      added.push({
        url: fileUrl,
        name: file.name,
        mimeType: file.type || '',
        uploadedAt: new Date().toISOString(),
      });
    }
    setUploading(false);
    if (added.length > 0) setFiles(prev => [...prev, ...added]);
  };

  const save = async () => {
    if (!note.trim() && !url.trim() && files.length === 0) {
      onNotify('가이드라인 파일을 올리거나 내용을 적어 주세요.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: campaignId,
          guideline_note: note,
          guideline_url: url,
          guideline_files: files,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify(err.error || '가이드라인 저장에 실패했습니다.', 'error');
        return;
      }
      onSaved({ guideline_note: note, guideline_url: url, guideline_files: files });
      onNotify('가이드라인을 저장했습니다. 진행 중인 인플루언서에게 그대로 전달됩니다.');
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
              {guidelineFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {guidelineFiles.map(file => (
                    <a
                      key={file.url}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-[11px] font-black text-slate-700 max-w-full transition-colors"
                    >
                      <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span className="truncate">{file.name}</span>
                    </a>
                  ))}
                </div>
              )}
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
                onClick={openEditor}
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
              콘텐츠 가이드라인 올리기
              <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-blue-600 text-white text-[10px] align-middle">필수</span>
            </p>
            <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
              가이드라인 파일(PDF·이미지)을 올려 주세요. 진행 중인 인플루언서가 진행사항 화면에서 바로 열어 봅니다.
              올리기 전에는 촬영이 시작되지 않습니다.
            </p>
          </div>
          {isOwner && (
            <button
              onClick={openEditor}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex-shrink-0 transition-colors"
            >
              가이드라인 올리기
            </button>
          )}
        </div>
      )}

      {open && (
        /* 휴대폰에서는 아래쪽에서 올라오는 시트다. 앱 하단 탭 바(z-[100])보다 위에
           떠야 '취소·저장' 줄이 탭 바에 덮여 잘리지 않는다. */
        <div className="fixed inset-0 z-[150] bg-slate-900/50 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="bg-white w-full md:max-w-xl rounded-t-3xl md:rounded-3xl max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom,0px)] md:pb-0">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">콘텐츠 가이드라인</h3>
              <p className="text-[11px] text-slate-400 font-medium mt-1">
                가지고 계신 가이드 파일을 그대로 올려 주세요. 파일이 여러 개여도 됩니다.
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">가이드라인 파일</label>
                {files.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {files.map(file => (
                      <div key={file.url} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2">
                        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 text-xs font-bold text-slate-800 hover:text-blue-600 truncate"
                        >
                          {file.name}
                        </a>
                        <button
                          onClick={() => setFiles(prev => prev.filter(f => f.url !== file.url))}
                          className="text-[11px] font-black text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx"
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                  disabled={uploading}
                  className="w-full text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-lg file:bg-slate-100 file:px-3 file:py-2 file:text-[11px] file:font-black file:text-slate-700 disabled:opacity-50"
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  {uploading ? '업로드 중...' : 'PDF·이미지·문서, 파일당 10MB 이하'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">가이드라인 내용 (선택)</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={7}
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
                  노션·구글 드라이브처럼 링크로 공유하는 자료가 있으면 넣어 주세요.
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
                disabled={saving || uploading}
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
