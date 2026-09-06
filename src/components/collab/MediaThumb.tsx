import React, { useState } from 'react';

/**
 * 인스타 릴스·피드 그림 한 칸.
 *
 * 이 칸의 주소는 두 종류가 섞여 온다. 하나는 우리 저장소로 복사해 둔 주소
 * (`/api/images/...`)이고, 하나는 메타 CDN 주소다. 뒤쪽은 서명과 만료 시각이 박힌
 * 임시 주소여서 언젠가 404 로 죽는다 — 서버가 사본으로 옮기기 전에 굳은 행, 계정이
 * 게시물을 지운 경우, 복사가 실패한 칸이 그렇다.
 *
 * `onError` 를 달지 않으면 그 자리에 브라우저의 깨진 그림 아이콘이 그려진다. "릴스가
 * 있는데 보이는 것처럼 안 나온다"는 말이 이 모양이다 — 옆 칸은 멀쩡하고 한 칸만
 * 깨져 있으니, 보는 사람은 우리 화면이 고장 난 것으로 읽는다. 주소가 죽었을 때는
 * 회색 자리로 남긴다: 그림이 없는 것과 계정에 게시물이 없는 것을 구분해 주는 것이
 * 이 칸이 할 수 있는 전부다.
 *
 * 크기·모서리는 부르는 쪽이 className 으로 정한다. 그림과 회색 자리가 같은 클래스를
 * 쓰므로, 주소가 죽어도 칸 크기가 흔들리지 않는다(카드 높이가 서로 어긋나지 않는다).
 */
export const MediaThumb: React.FC<{
  src?: string | null;
  className: string;
  /** 회색 자리에 남길 짧은 말. 없으면 빈 회색 칸. */
  label?: string;
}> = ({ src, className, label }) => {
  // 죽은 주소를 기억한다. 목록이 다시 그려질 때 주소가 바뀌면 새 주소로 다시 시도한다.
  const [brokenSrc, setBrokenSrc] = useState('');
  const url = String(src || '');

  if (!url || brokenSrc === url) {
    return (
      <div className={`${className} bg-slate-100 flex items-center justify-center`}>
        {label ? <span className="text-[10px] text-slate-300 font-bold">{label}</span> : null}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBrokenSrc(url)}
      className={`${className} object-cover bg-slate-100`}
    />
  );
};

/**
 * 그림을 그 게시물로 가는 링크로 감싼다. 주소가 없으면 감싸지 않는다.
 *
 * 릴스는 정지된 표지가 아니라 영상이다. 편집·말투·호흡을 보려면 게시물을 열어야
 * 하는데, 눌러도 아무 일이 없는 그림 위에서는 아무도 두 번 누르지 않는다. 새 탭으로
 * 연다 — 후보를 견주던 명단이 그대로 남아 있어야 다음 사람을 이어서 볼 수 있다.
 */
export const MediaLink: React.FC<{
  permalink?: string | null;
  className?: string;
  children: React.ReactNode;
}> = ({ permalink, className = '', children }) => {
  const href = String(permalink || '');
  if (!href) return <div className={className}>{children}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} hover:opacity-80 transition-opacity`}
      title="인스타그램에서 이 게시물 보기"
    >
      {children}
    </a>
  );
};

export default MediaThumb;
