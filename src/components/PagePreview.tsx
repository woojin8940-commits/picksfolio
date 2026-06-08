import React, { useState } from 'react';
import { Hash, ExternalLink, ChevronRight, Briefcase, Bell } from 'lucide-react';
import SafeImage from './SafeImage';
import MediaAuto from './MediaAuto';
import { renderPortfolioHtml } from './richText';

type ThemePreset = 'midnight' | 'white';
type LayoutTemplate = 'grid' | 'list';
type HomePriority = 'curation' | 'portfolio';
type PortfolioFontSize = 'small' | 'medium' | 'large';

interface PagePreviewProps {
  theme: ThemePreset;
  accentColor: string;
  /** Cover header background/image. */
  header: { color?: string; image?: string; imagePosition?: string | number };
  profile: { name?: string; bio?: string };
  userName: string;
  portfolioFontSize: PortfolioFontSize;
  socials: any;
  homePriority: HomePriority;
  layoutTemplate: LayoutTemplate;
  /** Curation / link-grid items. */
  curationBlocks: any[];
  /** Portfolio section blocks. */
  portfolioBlocks: any[];
  /** Explicit curation categories; derived from blocks when omitted. */
  managedCategories?: string[];
}

/**
 * Single source of truth for the right-side phone preview used by both the
 * Link Grid (LinkManagement) and Portfolio (PortfolioManagement) editors.
 * Mirrors the real public page so both editors render identically.
 */
const PagePreview: React.FC<PagePreviewProps> = ({
  theme,
  accentColor,
  header,
  profile,
  userName,
  portfolioFontSize,
  socials,
  homePriority,
  layoutTemplate,
  curationBlocks,
  portfolioBlocks,
  managedCategories,
}) => {
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [previewSelectedBlock, setPreviewSelectedBlock] = useState<any | null>(null);

  const themePreset = theme;
  const blocks = curationBlocks || [];

  const categories = managedCategories ?? (() => {
    const catSet = new Set<string>();
    for (const b of blocks) {
      if (b && b.category) catSet.add(b.category);
    }
    return Array.from(catSet);
  })();

  return (
    <>
      {/* Cover Header - matching personal page */}
      <div
        className="relative aspect-[4/5] flex-shrink-0"
        style={{ background: header.color || (themePreset === 'white' ? 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)' : 'linear-gradient(135deg, #2563EB 0%, #4f46e5 100%)') }}
      >
        {header.image && (
          <SafeImage
            src={header.image}
            alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: `center ${header.imagePosition || '50'}%` }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(to top, ${themePreset === 'white' ? '#F8FAFC' : '#1E1E2E'} 0%, ${themePreset === 'white' ? '#F8FAFC' : '#1E1E2E'}88 20%, transparent 50%)` }}
        />
        <div className="absolute bottom-2 left-3 right-3">
          <h3 className="text-sm font-black tracking-tighter mb-0.5">{profile.name || userName}</h3>
          <p className={`font-black uppercase tracking-[0.2em] ${
            portfolioFontSize === 'small' ? 'text-[5px]' :
            portfolioFontSize === 'large' ? 'text-[8px]' :
            'text-[6px]'
          }`} style={{ color: accentColor }}>{profile.bio || 'Visual Storyteller'}</p>
        </div>
      </div>

      {/* Contact / action buttons — must mirror the real personal page exactly.
          The public page renders ONLY the business-proposal, live-notify and the
          user's custom buttons here (it does NOT show standalone social-network
          badges), so the preview shows the same set and nothing the user hasn't
          actually enabled. */}
      {(() => {
        const customButtons = (socials.customButtons || []).filter(
          (b: any) => b.label?.trim() && b.url?.trim()
        );
        const hasAny = socials.businessProposal || socials.liveNotify || customButtons.length > 0;
        if (!hasAny) return null;
        return (
          <div className="flex gap-1 px-2 pt-2 pb-1 overflow-x-auto scrollbar-hide justify-center flex-wrap">
            {socials.businessProposal && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[5px] font-bold text-white whitespace-nowrap" style={{ backgroundColor: accentColor }}>
                <Briefcase size={5} strokeWidth={2.5} />
                비즈니스 제안
              </span>
            )}
            {socials.liveNotify && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[5px] font-bold bg-[#2563EB] text-white whitespace-nowrap">
                <Bell size={5} strokeWidth={2.5} />
                라이브 알림받기
              </span>
            )}
            {customButtons.map((btn: any) => (
              <span key={btn.id} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[5px] font-bold text-white whitespace-nowrap" style={{ backgroundColor: btn.color || '#2563EB' }}>
                <ExternalLink size={5} strokeWidth={2.5} />
                {btn.label}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Content sections ordered by homePriority */}
      <div className="flex flex-col">
      <div style={{ order: homePriority === 'portfolio' ? 2 : 1 }}>
      {/* Curation Section Header */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex justify-between items-end mb-2">
          <div>
            <h4 className="text-[6px] font-black uppercase tracking-[0.15em] mb-0.5" style={{ color: accentColor }}>My Curations</h4>
            <h3 className="text-[9px] font-black tracking-tighter">Explore My Picks</h3>
          </div>
          <div className={`text-[6px] font-black uppercase tracking-widest ${themePreset === 'white' ? 'text-slate-300' : 'text-white/20'}`}>{blocks.length} Items</div>
        </div>
      </div>

      {/* Category Tabs */}
      {(() => {
        const previewCategories = ['전체', ...categories];
        return previewCategories.length > 1 ? (
          <div className="px-2 pb-2 overflow-x-auto scrollbar-hide flex gap-1">
            {previewCategories.map(cat => (
              <span
                key={cat}
                className={`px-2 py-0.5 text-[6px] font-black whitespace-nowrap rounded-full border ${cat === '전체' ? 'text-white border-transparent' : themePreset === 'white' ? 'bg-white border-slate-200 text-slate-400' : 'bg-white/10 border-white/20 text-white/50'}`}
                style={cat === '전체' ? { backgroundColor: accentColor } : {}}
              >
                {cat}
              </span>
            ))}
          </div>
        ) : null;
      })()}

      {/* Grid / List Content */}
      {layoutTemplate === 'grid' ? (
        <div className="px-2 pb-4">
          <div
            className="grid grid-flow-dense"
            style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: '3px' }}
          >
            {blocks.map((block) => {
              const colSpanVal = block.displayType === 'grid' ? (block.colSpan || 1) : 1;
              const gridSpan = colSpanVal === 1 ? 6 : colSpanVal === 2 ? 3 : 2;
              const blockDisplay = block.displayType || 'grid';
              const pos = block.coverMediaPosition || { x: 50, y: 50 };

              if (blockDisplay === 'text') {
                return (
                  <div
                    key={block.id}
                    onClick={() => { setPreviewSelectedBlock(block); setShowBottomSheet(true); }}
                    className="relative overflow-hidden cursor-pointer group flex flex-col justify-center px-2 py-1"
                    style={{
                      gridColumn: `span ${gridSpan}`,
                      minHeight: '30px',
                      backgroundColor: (block.highlight && block.highlight !== 'transparent') ? block.highlight : undefined,
                    }}
                  >
                    {block.textContent ? (
                      <div
                        className="text-[7px] leading-relaxed whitespace-pre-wrap overflow-hidden"
                        style={{
                          fontSize: `${Math.max(5, Math.min(10, (block.fontSizePx || 14) * 0.5))}px`,
                          fontWeight: block.bold ? 'bold' : undefined,
                          fontStyle: block.italic ? 'italic' : undefined,
                          textDecoration: [block.underline ? 'underline' : '', block.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
                          color: block.color || (themePreset === 'white' ? '#37352f' : 'rgba(255,255,255,0.8)'),
                        }}
                        dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(block.textContent) }}
                      />
                    ) : (
                      <div className={`text-[6px] opacity-50 ${themePreset === 'white' ? 'text-slate-300' : 'text-white/30'}`}>텍스트 입력</div>
                    )}
                  </div>
                );
              }

              if (blockDisplay === 'minimal') {
                return (
                  <div
                    key={block.id}
                    onClick={() => { setPreviewSelectedBlock(block); setShowBottomSheet(true); }}
                    className={`relative overflow-hidden cursor-pointer group shadow-sm ${themePreset === 'white' ? 'bg-white border border-slate-100' : 'bg-white/5 border border-white/10'}`}
                    style={{
                      gridColumn: `span ${gridSpan}`,
                      borderRadius: '0.75rem',
                    }}
                  >
                    {block.coverMedia && (
                      <div className="aspect-[16/10] overflow-hidden">
                        <MediaAuto
                          src={block.coverMedia}
                          alt=""
                          className="w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
                          style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                        />
                      </div>
                    )}
                    <div className="p-1.5">
                      <div className="text-[7px] font-black truncate uppercase tracking-tight">{block.title}</div>
                      <div className="text-[6px] font-bold uppercase tracking-widest mt-0.5" style={{ color: accentColor }}>{block.category}</div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={block.id}
                  onClick={() => { setPreviewSelectedBlock(block); setShowBottomSheet(true); }}
                  className={`relative overflow-hidden cursor-pointer group shadow-sm aspect-square`}
                  style={{
                    gridColumn: `span ${gridSpan}`,
                    borderRadius: '0.75rem',
                  }}
                >
                  <MediaAuto
                    src={block.coverMedia}
                    alt=""
                    className="w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
                    style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                  />
                  <div className="absolute top-1.5 right-1.5">
                    <span className="bg-black/60 backdrop-blur-md text-[7px] font-black px-1.5 py-0.5 rounded-md text-white border border-white/10">{block.products?.length || 0}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                    <div className="text-[7px] font-black truncate text-white uppercase tracking-tight">{block.title}</div>
                    <div className="text-[6px] font-bold text-white/50 uppercase tracking-widest mt-0.5">{block.category}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-3 pb-4 space-y-1.5">
          {blocks.flatMap(block =>
            (block.products || []).map((p: any) => (
              <div
                key={p.id}
                className={`flex items-center justify-between p-2 border transition-all ${themePreset === 'white' ? 'bg-white border-slate-100' : 'bg-white/5 border-white/10'}`}
                style={{ borderRadius: '0.75rem' }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                  <div className={`w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                    <MediaAuto src={p.image || block.coverMedia} alt="" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-[8px] font-black truncate">{p.name}</span>
                </div>
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: accentColor, color: '#fff' }}>
                  <ExternalLink size={8} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
      </div>

      {portfolioBlocks.length > 0 && (
      <div style={{ order: homePriority === 'portfolio' ? 1 : 2 }} className="px-2 pt-3 pb-2">
        <div className="flex items-center gap-1 mb-1.5 px-1">
          <div className="flex-1 h-[0.5px]" style={{ backgroundColor: accentColor, opacity: 0.3 }}></div>
          <h4 className="text-[5px] font-black uppercase tracking-[0.15em]" style={{ color: accentColor }}>Portfolio</h4>
          <div className="flex-1 h-[0.5px]" style={{ backgroundColor: accentColor, opacity: 0.3 }}></div>
        </div>
        {/* Portfolio category tabs */}
        {(() => {
          const catBlocks = portfolioBlocks.filter(b => b && b.type === 'category');
          if (catBlocks.length === 0) return null;
          return (
            <div className="px-1 pb-1.5 overflow-x-auto scrollbar-hide flex gap-1">
              <span className={`px-1.5 py-0.5 text-[5px] font-black whitespace-nowrap rounded-full text-white border-transparent`} style={{ backgroundColor: accentColor }}>전체</span>
              {catBlocks.map((c: any) => (
                <span key={c.id} className={`px-1.5 py-0.5 text-[5px] font-black whitespace-nowrap rounded-full border ${themePreset === 'white' ? 'bg-white border-slate-200 text-slate-400' : 'bg-white/10 border-white/20 text-white/50'}`}>
                  {(c.content || '').trim() || '카테고리'}
                </span>
              ))}
            </div>
          );
        })()}
        <div className="space-y-1">
          {portfolioBlocks.filter(Boolean).map((block: any) => {
            if (!block) return null;
            if (block.type === 'category') {
              return (
                <div key={block.id} className="pt-1 pb-0.5 flex items-center gap-1">
                  <Hash size={7} className="text-blue-500 shrink-0" />
                  <span className={`text-[7px] font-black truncate ${themePreset === 'white' ? 'text-slate-900' : 'text-white'}`}>{block.content || '카테고리'}</span>
                </div>
              );
            }
            if (block.type === 'text') {
              return (
                <div key={block.id}>
                  <div
                    className={`rounded-lg border px-1.5 py-1 ${themePreset === 'white' ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/10'}`}
                    style={(block.highlight && block.highlight !== 'transparent') ? { backgroundColor: block.highlight, borderColor: 'transparent' } : undefined}
                  >
                    <div
                      className={`text-[6px] leading-relaxed whitespace-pre-wrap ${block.bold ? 'font-bold' : 'font-medium'}`}
                      style={{
                        color: block.color || (themePreset === 'white' ? '#37352f' : 'rgba(255,255,255,0.8)'),
                        fontStyle: block.italic ? 'italic' : undefined,
                        textDecoration: block.underline ? 'underline' : block.strikethrough ? 'line-through' : undefined
                      }}
                      dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(block.content || '') }}
                    />
                  </div>
                </div>
              );
            }
            if (block.type === 'image') {
              const imgs = Array.isArray(block.images) && block.images.length > 0 ? block.images : [block.content || ''];
              const cols = Math.min(4, Math.max(1, Number(block.gridColumns) || 1));
              const displayImgs = imgs.slice(0, cols).filter(Boolean);
              if (displayImgs.length === 0) return null;
              if (cols === 1) {
                return (
                  <div key={block.id}>
                    {displayImgs.map((src: string, i: number) => (
                      <div key={i} className={`overflow-hidden rounded-lg border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                        <MediaAuto src={src} alt="" className="w-full h-auto block" style={block.imagePositions?.[i] ? { objectPosition: `${block.imagePositions[i].x}% ${block.imagePositions[i].y}%` } : undefined} />
                      </div>
                    ))}
                  </div>
                );
              }
              if (cols === 3 && displayImgs.length === 3) {
                return (
                  <div key={block.id} className="grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[4/3]">
                    <div className={`row-span-2 overflow-hidden rounded-md border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                      <MediaAuto src={displayImgs[0]} alt="" className="w-full h-full object-cover" style={block.imagePositions?.[0] ? { objectPosition: `${block.imagePositions[0].x}% ${block.imagePositions[0].y}%` } : undefined} />
                    </div>
                    <div className={`overflow-hidden rounded-md border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                      <MediaAuto src={displayImgs[1]} alt="" className="w-full h-full object-cover" style={block.imagePositions?.[1] ? { objectPosition: `${block.imagePositions[1].x}% ${block.imagePositions[1].y}%` } : undefined} />
                    </div>
                    <div className={`overflow-hidden rounded-md border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                      <MediaAuto src={displayImgs[2]} alt="" className="w-full h-full object-cover" style={block.imagePositions?.[2] ? { objectPosition: `${block.imagePositions[2].x}% ${block.imagePositions[2].y}%` } : undefined} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={block.id} className={`grid gap-0.5 ${cols >= 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {displayImgs.map((src: string, i: number) => (
                    <div key={i} className={`overflow-hidden rounded-md aspect-square border ${themePreset === 'white' ? 'border-slate-200' : 'border-white/10'}`}>
                      <MediaAuto src={src} alt="" className="w-full h-full object-cover" style={block.imagePositions?.[i] ? { objectPosition: `${block.imagePositions[i].x}% ${block.imagePositions[i].y}%` } : undefined} />
                    </div>
                  ))}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
      )}
      </div>

      {showBottomSheet && previewSelectedBlock && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowBottomSheet(false)}></div>
          <div className={`relative rounded-t-[2rem] p-4 animate-in slide-in-from-bottom duration-300 ${themePreset === 'white' ? 'bg-white' : 'bg-[#1E1E2E]'}`}>
            <h3 className="text-[10px] font-black mb-3">연결된 상품</h3>
            <div className="space-y-2">
              {(previewSelectedBlock.products || []).map((product: any) => (
                <a
                  key={product.id}
                  href={product.link?.startsWith('http') ? product.link : `https://${product.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between p-2.5 rounded-xl border ${themePreset === 'white' ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/10'}`}
                >
                  <span className="text-[8px] font-black">{product.name}</span>
                  <ChevronRight size={10} style={{ color: accentColor }} />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PagePreview;
