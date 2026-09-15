import React, { useState } from 'react';
import { Block, DesignSettings, OpenScheduleItem } from '../types';
import PublicPageBody, { DEFAULT_PUBLIC_DESIGN, type AboutSection } from './PublicPageBody';
import ProductSheet from './ProductSheet';

/**
 * 편집 화면 오른쪽 폰 안의 미리보기.
 *
 * 예전에는 이 파일이 공개 페이지를 손으로 베낀 별개의 화면이었다. 폰 폭에 맞춰
 * 글자와 여백을 따로 적어 두었기 때문에(text-[5px] · size={5} 같은 값들) 공개
 * 페이지를 고쳐도 여기는 그대로 남아, 시간이 지나며 둘이 서로 다른 화면이 됐다 —
 * 미리보기에만 있는 머리글("My Curations / Explore My Picks")이 포트폴리오가 아닌
 * 레이아웃에도 나오고, 검색바가 카테고리 버튼 아래에 붙고, 배경색이 달랐고
 * (#1E1E2E 대 #050a15), 소개 · 오픈 일정 · 카테고리 묶음은 아예 없었다.
 *
 * 지금은 공개 페이지와 같은 컴포넌트(PublicPageBody · ProductSheet)를 그린다.
 * 폰 프레임 안(약 373px)이므로 `compact` 로 데스크톱 변형만 빼고, 나머지는 방문자가
 * 보는 화면 그대로다. 미리보기지만 카테고리 · 검색 · 상품 서랍은 실제로 동작한다 —
 * 저장하기 전에 눌러 보고 확인할 수 있어야 한다.
 */
interface PagePreviewProps {
  /** 지금 편집 중인 값으로 만든 디자인. 저장될 것과 같은 객체여야 한다. */
  design: DesignSettings;
  profile: { name?: string; bio?: string; avatar_url?: string; aboutSections?: AboutSection[] };
  socials: any;
  blocks: Block[];
  /** 블록에 아직 쓰이지 않은 카테고리까지 포함한 목록. */
  managedCategories?: string[];
  openSchedule?: OpenScheduleItem[];
  /** 비즈니스 제안 버튼이 갈 주소를 만드는 데 쓴다. */
  username?: string;
}

const PagePreview: React.FC<PagePreviewProps> = ({
  design,
  profile,
  socials,
  blocks,
  managedCategories = [],
  openSchedule = [],
  username,
}) => {
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const selectedBlock = React.useMemo(
    () => blocks.find(b => b.id === selectedBlockId) || null,
    [blocks, selectedBlockId],
  );

  /* 공개 페이지는 저장된 디자인을 기본값 위에 얹어 그린다 — 미리보기도 같은 순서로
     얹어야 아직 고르지 않은 칸이 같은 값으로 채워진다. */
  const fullDesign = { ...DEFAULT_PUBLIC_DESIGN, ...design };

  return (
    <>
    <PublicPageBody
      compact
      design={fullDesign}
      profile={{
        full_name: profile?.name,
        bio: profile?.bio,
        avatar_url: profile?.avatar_url,
        aboutSections: profile?.aboutSections,
      }}
      socials={socials}
      blocks={blocks}
      linkGridCategories={managedCategories}
      openSchedule={openSchedule}
      proposalHref={username ? `/${username}/proposal` : '#'}
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
      searchQuery={searchQuery}
      onSearchQuery={setSearchQuery}
      onSelectBlock={setSelectedBlockId}
    />
    {/* 서랍은 본문 밖에 둔다 — 본문 안(가운데 칸)은 `relative` 라서, 그 안에서
        `absolute bottom-0` 은 페이지 맨 아래(스크롤을 다 내린 자리)에 붙는다.
        본문 밖으로 내면 기준이 폰 프레임이 되어, 실제 페이지에서 `fixed` 가 창
        아래에 붙는 것과 같은 자리에 올라온다. */}
    <ProductSheet
      compact
      block={selectedBlock}
      design={fullDesign}
      onClose={() => setSelectedBlockId(null)}
    />
    </>
  );
};

export default PagePreview;
