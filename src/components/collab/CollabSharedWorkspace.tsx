import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';

type WorkspaceRole = 'brand' | 'influencer';

type Props = {
  collabId: string;
  role: WorkspaceRole;
  detail: any;
  onRefresh: () => Promise<any> | void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  isEn?: boolean;
};

const KIND_LABEL: Record<string, string> = {
  guide: '가이드 파일',
  plan: '기획안',
  video: '영상 초안',
  other: '공유 자료',
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  shared: { label: '확인 대기', cls: 'bg-amber-50 text-amber-600' },
  confirmed: { label: '확인 완료', cls: 'bg-emerald-50 text-emerald-600' },
  revision: { label: '수정 요청', cls: 'bg-orange-50 text-orange-600' },
};

const CollabSharedWorkspace: React.FC<Props> = ({ collabId, role, detail, onRefresh, onNotify, isEn }) => {
  const [kind, setKind] = useState(role === 'brand' ? 'guide' : 'plan');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [adCode, setAdCode] = useState(detail?.collab?.adCode || '');

  useEffect(() => {
    setAdCode(detail?.collab?.adCode || '');
  }, [detail?.collab?.adCode]);

  const upload = async () => {
    if (!file) {
      onNotify(isEn ? 'Choose a file.' : '공유할 파일을 선택해 주세요.', 'error');
      return;
    }
    setBusy(true);
    const fileUrl = await apiService.uploadProposalAttachment(`collab-${collabId}`, file);
    if (!fileUrl) {
      setBusy(false);
      onNotify(isEn ? 'Upload failed.' : '파일 업로드에 실패했습니다.', 'error');
      return;
    }
    const res = await apiService.collabAction(collabId, 'add_asset', {
      kind,
      title: title.trim() || file.name,
      fileUrl,
      fileName: file.name,
      mimeType: file.type,
    });
    setBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setTitle('');
    setFile(null);
    onNotify(isEn ? 'File shared.' : '협업 자료를 공유했습니다.');
    await onRefresh();
  };

  const review = async (assetId: string, status: 'confirmed' | 'revision') => {
    const note = status === 'revision'
      ? window.prompt('수정이 필요한 내용을 입력해 주세요.')?.trim() || ''
      : '';
    if (status === 'revision' && !note) return;
    setBusy(true);
    const res = await apiService.collabAction(collabId, 'review_asset', { assetId, status, note });
    setBusy(false);
    if (res.error) onNotify(res.error, 'error');
    else {
      onNotify(status === 'confirmed' ? '자료를 확인 완료로 표시했습니다.' : '수정 요청을 전달했습니다.');
      await onRefresh();
    }
  };

  const saveAdCode = async () => {
    setBusy(true);
    const res = await apiService.collabAction(collabId, 'update_ad_code', { adCode: adCode.trim() });
    setBusy(false);
    if (res.error) onNotify(res.error, 'error');
    else {
      onNotify(isEn ? 'Ad code shared.' : '광고코드를 공유했습니다.');
      await onRefresh();
    }
  };

  const assets = Array.isArray(detail?.assets) ? detail.assets : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
        <p className="text-sm font-black text-slate-900">{isEn ? 'Shared campaign files' : '협업 자료함'}</p>
        <p className="text-[10px] text-slate-400 font-medium mt-0.5">
          {role === 'brand'
            ? '가이드를 올리고, 인플루언서가 공유한 기획안과 영상 초안을 확인해 주세요.'
            : '브랜드 가이드를 확인하고 기획안·영상 초안을 같은 곳에 공유해 주세요.'}
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2">
          <select
            value={kind}
            onChange={event => setKind(event.target.value)}
            className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-2 bg-white"
          >
            {role === 'brand' ? (
              <option value="guide">가이드 파일</option>
            ) : (
              <>
                <option value="plan">기획안</option>
                <option value="video">영상 초안</option>
                <option value="other">기타 자료</option>
              </>
            )}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="자료 제목 (선택)"
              className="text-xs border border-slate-200 rounded-lg px-3 py-2"
            />
            <input
              type="file"
              accept="image/*,video/*,application/pdf"
              onChange={event => setFile(event.target.files?.[0] || null)}
              className="text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
            />
          </div>
          <button
            onClick={upload}
            disabled={busy || !file}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
          >
            {busy ? '처리 중...' : '공유하기'}
          </button>
        </div>
        <p className="text-[10px] text-slate-400">이미지·영상·PDF, 파일당 10MB 이하</p>

        {assets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-[11px] text-slate-400 font-bold">
            아직 공유된 자료가 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {assets.map((asset: any) => {
              const status = STATUS_LABEL[asset.status] || STATUS_LABEL.shared;
              const canReview = role === 'brand' && asset.uploadedByRole === 'influencer';
              return (
                <div key={asset.id} className="rounded-lg border border-slate-100 p-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black text-blue-600">{KIND_LABEL[asset.kind] || KIND_LABEL.other}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${status.cls}`}>{status.label}</span>
                      <span className="text-[9px] text-slate-300 font-bold">
                        {asset.uploadedByRole === 'brand' ? '브랜드 공유' : asset.uploadedByRole === 'influencer' ? '인플루언서 공유' : '담당자 공유'}
                      </span>
                    </div>
                    <a href={asset.fileUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-slate-800 font-black hover:text-blue-600 truncate mt-1">
                      {asset.title || asset.fileName || '파일 열기'}
                    </a>
                    {asset.reviewNote && <p className="text-[10px] text-orange-600 font-medium mt-1">수정 요청: {asset.reviewNote}</p>}
                  </div>
                  {canReview && asset.status !== 'confirmed' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => review(asset.id, 'confirmed')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black disabled:opacity-40">확인 완료</button>
                      <button onClick={() => review(asset.id, 'revision')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 text-[10px] font-black disabled:opacity-40">수정 요청</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 font-black mb-1.5">광고코드</p>
          {role === 'influencer' ? (
            <div className="flex gap-2">
              <input
                value={adCode}
                onChange={event => setAdCode(event.target.value)}
                placeholder="브랜드가 사용할 광고코드를 입력해 주세요."
                className="min-w-0 flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2"
              />
              <button onClick={saveAdCode} disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-[11px] font-black disabled:opacity-40">공유</button>
            </div>
          ) : detail?.collab?.adCode ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
              <code className="text-xs text-slate-700 font-bold break-all">{detail.collab.adCode}</code>
              <button onClick={() => navigator.clipboard?.writeText(detail.collab.adCode)} className="text-[10px] text-blue-600 font-black shrink-0">복사</button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 font-medium">인플루언서가 광고코드를 공유하면 이곳에 표시됩니다.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollabSharedWorkspace;
