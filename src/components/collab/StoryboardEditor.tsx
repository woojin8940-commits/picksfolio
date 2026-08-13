import React, { useState } from 'react';
import {
  StoryboardScene,
  emptyScene,
  normalizeScenes,
  sceneIsEmpty,
  RECOMMENDED_SCENE_COUNT,
} from '../../utils/collabScenes';

/**
 * 대본(스토리보드) 작성.
 *
 * 예전에는 한 칸에 여러 줄을 적어 한 줄이 한 장면이었다. 그렇게 모인 대본에는 붙일
 * 곳이 없다 — 브랜드가 "두 번째 자막"에 대해 말하려 해도 자막이라는 칸 자체가 없었다.
 * 장면을 화면·자막·나레이션으로 나눠 받으면 검수 화면이 장면마다 의견을 매달 수 있고,
 * 수정 요청이 왔을 때 어디를 고쳐야 하는지도 분명해진다.
 */

interface StoryboardEditorProps {
  /** 수정 제출이면 지난 버전을 이어 받는다. 처음부터 다시 쓰게 하면 안 된다. */
  initialScenes?: unknown;
  submitting?: boolean;
  onSubmit: (scenes: StoryboardScene[]) => void;
  onCancel?: () => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const FIELDS: Array<{ key: keyof StoryboardScene; label: string; placeholder: string; rows: number }> = [
  { key: 'visual', label: '장면', placeholder: '어떤 화면을 찍는지 (예: 제품을 손에 들고 카메라 정면)', rows: 2 },
  { key: 'subtitle', label: '자막', placeholder: '화면에 뜨는 글자', rows: 1 },
  { key: 'narration', label: '나레이션', placeholder: '말로 하는 내용', rows: 2 },
];

const StoryboardEditor: React.FC<StoryboardEditorProps> = ({
  initialScenes,
  submitting,
  onSubmit,
  onCancel,
  onNotify,
}) => {
  const [scenes, setScenes] = useState<StoryboardScene[]>(() => {
    const parsed = normalizeScenes(initialScenes);
    if (parsed.length > 0) return parsed;
    return Array.from({ length: RECOMMENDED_SCENE_COUNT }, emptyScene);
  });

  const patch = (index: number, key: keyof StoryboardScene, value: string) => {
    setScenes(prev => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  };

  const addScene = () => setScenes(prev => [...prev, emptyScene()]);

  const removeScene = (index: number) => {
    if (scenes.length <= 1) return;
    setScenes(prev => prev.filter((_, i) => i !== index));
  };

  const moveScene = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= scenes.length) return;
    setScenes(prev => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const filled = scenes.filter(s => !sceneIsEmpty(s));

  const submit = () => {
    if (filled.length === 0) {
      onNotify?.('장면 내용을 입력해 주세요.', 'error');
      return;
    }
    // 화면 설명이 없는 장면은 촬영할 수 없다. 자막만 적힌 장면을 그대로 보내면
    // 검수하는 쪽이 무엇을 보고 판단해야 할지 알 수 없다.
    const noVisual = filled.findIndex(s => !s.visual.trim());
    if (noVisual >= 0) {
      onNotify?.(`${noVisual + 1}번 장면의 [장면] 설명을 적어 주세요.`, 'error');
      return;
    }
    // 빈 장면은 버리고 보낸다 — 기본 5칸을 다 채우지 않는 경우가 흔하다.
    onSubmit(filled);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <h4 className="text-sm font-black text-slate-900">대본 입력</h4>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
          장면 단위로 나눠 적어 주세요. 브랜드와 담당자가 장면마다 의견을 남깁니다.
        </p>
        <p
          className={`text-[11px] font-bold mt-1.5 ${
            filled.length >= RECOMMENDED_SCENE_COUNT ? 'text-emerald-600' : 'text-blue-600'
          }`}
        >
          작성한 장면 {filled.length}개 · 최소 {RECOMMENDED_SCENE_COUNT}개 장면을 권장합니다
        </p>
      </div>

      <div className="p-4 md:p-5 space-y-3 bg-slate-50/60">
        {scenes.map((scene, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-100 p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-black text-slate-900"># {i + 1}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveScene(i, -1)}
                  disabled={i === 0}
                  className="w-6 h-6 rounded-md bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200 disabled:opacity-30"
                  aria-label="위로"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveScene(i, 1)}
                  disabled={i === scenes.length - 1}
                  className="w-6 h-6 rounded-md bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200 disabled:opacity-30"
                  aria-label="아래로"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeScene(i)}
                  disabled={scenes.length <= 1}
                  className="px-2 h-6 rounded-md bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                >
                  삭제
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {FIELDS.map(f => (
                <div key={f.key} className="flex gap-2 items-start">
                  <span className="text-[10px] font-black text-slate-400 w-11 flex-shrink-0 pt-2">
                    [{f.label}]
                  </span>
                  <textarea
                    value={scene[f.key]}
                    onChange={e => patch(i, f.key, e.target.value)}
                    rows={f.rows}
                    placeholder={f.placeholder}
                    className="flex-1 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:border-blue-400"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addScene}
          className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 text-[11px] font-black text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + 장면 추가
        </button>
      </div>

      <div className="px-4 md:px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-3">
        <p className="text-[10px] text-slate-400 font-medium">
          내용이 비어 있는 장면은 제출에서 제외됩니다
        </p>
        <div className="flex gap-1.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 bg-slate-100 text-slate-500 rounded-lg text-[11px] font-black hover:bg-slate-200"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-5 py-2 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
          >
            {submitting ? '제출 중...' : '대본 제출하기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoryboardEditor;
