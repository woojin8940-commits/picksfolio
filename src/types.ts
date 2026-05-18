
export enum TemplateType {
  SHOPPABLE_GRID = 'shoppable_grid',
  PORTFOLIO = 'portfolio',
  LINK_LIST = 'link_list'
}

export interface Product {
  id: string;
  name: string;
  price?: string;
  image?: string;
  link: string;
}

export interface Block {
  id: string;
  title: string;
  category: string;
  coverMedia: string;
  mediaType: 'image' | 'video';
  products: Product[];
}

export interface DesignSettings {
  templateType: TemplateType;
  theme: string;
  accentColor: string;
  borderRadius: 'none' | 'md' | 'full';
  gridGap: number;
  gridColumns: number;
  gridStyle: 'magazine' | 'standard';
  fontFamily: 'Sans' | 'Serif' | 'Mono';
  buttonStyle: 'solid' | 'outline' | 'ghost';
  backgroundType: 'solid' | 'gradient' | 'image';
  customGradient?: string;
  profileLayout: 'center' | 'left';
  homePriority: 'products' | 'portfolio';
  background_image?: string;
  portfolioHeaderImage?: string;
  portfolioHeaderColor?: string;
  portfolioFontSize?: 'small' | 'medium' | 'large';
  title?: string;
  description?: string;
}
