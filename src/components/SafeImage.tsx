
import React from 'react';
import { optimizeImageUrl } from '../utils/imageOptimize';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  // Target render width in CSS px for the on-demand image transform. Defaults
  // to a sensible size for avatars / small cards; same-origin images only.
  optimizeWidth?: number;
}

const SafeImage: React.FC<SafeImageProps> = ({ loading, decoding, referrerPolicy, src, optimizeWidth, ...rest }) => {
  return (
    <img
      {...rest}
      src={typeof src === 'string' ? optimizeImageUrl(src, { width: optimizeWidth ?? 640 }) : src}
      referrerPolicy={referrerPolicy ?? 'no-referrer'}
      decoding={decoding ?? 'async'}
      loading={loading ?? 'lazy'}
    />
  );
};

export default SafeImage;
