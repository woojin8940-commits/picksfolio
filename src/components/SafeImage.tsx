
import React from 'react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {}

const SafeImage: React.FC<SafeImageProps> = (props) => {
  return <img {...props} referrerPolicy="no-referrer" />;
};

export default SafeImage;
