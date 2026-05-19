
import React from 'react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {}

const SafeImage: React.FC<SafeImageProps> = ({ loading, decoding, referrerPolicy, ...rest }) => {
  return (
    <img
      {...rest}
      referrerPolicy={referrerPolicy ?? 'no-referrer'}
      decoding={decoding ?? 'async'}
      loading={loading ?? 'lazy'}
    />
  );
};

export default SafeImage;
