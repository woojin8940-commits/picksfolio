import React from 'react';
import { Block, DesignSettings } from '../types';
import { externalLinkProps } from '../utils/externalLink';
import { themeIsDark } from '../utils/themeColor';
import MediaAuto from './MediaAuto';
import { FALLBACK_IMAGE } from './PublicPageBody';

/**
 * 카드를 누르면 아래에서 올라오는 상품 서랍.
 *
 * 공개 페이지(UserPage)와 편집 화면 미리보기(PagePreview)가 같은 서랍을 쓴다 —
 * 예전에는 미리보기 쪽에만 "연결된 상품" 이라는 다른 서랍이 따로 적혀 있어서,
 * 실제로는 상품 이름 · 주소가 나오는 자리에 이름만 한 줄 나왔다.
 *
 * 상품 한 줄에는 따로 "구매하기" 버튼이 있었지만, 줄 전체가 이미 같은 곳으로
 * 가는 링크라 좁은 화면에서 이름을 밀어내는 값만 했다. 이제 버튼 없이 줄 자체를
 * `<a>` 로 그린다 — 어디를 눌러도 상품 주소로 가고, 이름에 쓸 자리가 넓어진다.
 *
 * 닫혀 있어도 붙어 있고(translate-y-full 로 화면 밖에 내려둔다) 그림자는 열려
 * 있을 때만 그린다 — 위로 60px 번지는 그림자가 닫힌 서랍에도 걸려 있으면, 아무
 * 것도 누르지 않은 페이지의 아래쪽이 늘 어두웠다.
 */
interface ProductSheetProps {
  /** 열려 있는 블록. null 이면 서랍은 화면 밖에 내려가 있다. */
  block: Block | null;
  design: DesignSettings;
  onClose: () => void;
  /** 상품 줄을 눌렀을 때(집계용). */
  onProductClick?: () => void;
  /**
   * 폰 프레임 안에 그리는 중인가.
   *
   * 미리보기는 데스크톱 창 안의 폰 프레임에 들어가므로 `fixed`(창 기준)가 아니라
   * `absolute`(폰 기준)로 눕히고, 데스크톱 변형(`sm:` · `md:`)을 쓰지 않는다.
   */
  compact?: boolean;
}

const ProductSheet: React.FC<ProductSheetProps> = ({ block, design, onClose, onProductClick, compact = false }) => {
  const w = (cls: string) => (compact ? '' : cls);
  const isDark = themeIsDark(design);
  const hairline = isDark ? 'border-white/15' : 'border-[#0B0F1A]/10';
  const open = !!block;

  return (
    <>
      <div className={`${compact ? 'absolute' : 'fixed'} bottom-0 left-0 right-0 max-w-3xl mx-auto p-6 ${w('sm:p-8 md:p-10')} pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] rounded-t-[2.5rem] ${w('sm:rounded-t-[3rem]')} transition-transform duration-500 z-[110] ${open ? 'translate-y-0 shadow-[0_-20px_60px_rgba(0,0,0,0.3)]' : 'translate-y-full shadow-none'} ${isDark ? 'bg-[#0f172a] text-white' : 'bg-white text-slate-900'}`}>
        <div className={`w-12 h-1 rounded-full mx-auto mb-8 cursor-pointer ${isDark ? 'bg-white/20' : 'bg-slate-200'}`} onClick={onClose}></div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-blue-600 mb-1">Shop the Selection</h4>
            <h3 className="text-lg font-black tracking-tight">{block?.title}</h3>
          </div>
          <button onClick={onClose} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDark ? 'bg-white/10 text-white/40 hover:text-white' : 'bg-slate-100 text-slate-400 hover:text-slate-900'}`}>✕</button>
        </div>
        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-2 scrollbar-hide pb-4">
          {block?.products?.map((p) => (
            <a
              key={p.id}
              {...externalLinkProps(p.link)}
              onClick={() => onProductClick?.()}
              className={`flex items-center gap-4 p-5 rounded-2xl border group shadow-sm transition-all cursor-pointer ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:border-blue-200'}`}
            >
              {/* Product Thumbnail */}
              <div className={`w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 border ${hairline}`}>
                <MediaAuto src={p.image || (p as any).imageUrl || (p as any).manual_image_url || block?.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-black truncate mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{p.name}</div>
                <span className={`text-[9px] font-bold truncate opacity-60 block ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{(p.link || '').replace('https://', '').replace('http://', '').split('/')[0]}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
      {open && <div className={`${compact ? 'absolute' : 'fixed'} inset-0 bg-black/60 backdrop-blur-md z-[90] transition-opacity`} onClick={onClose}></div>}
    </>
  );
};

export default ProductSheet;
