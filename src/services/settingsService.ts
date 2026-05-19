import { Block, TemplateType, DesignSettings } from '../types';
import { supabase } from './supabase';
import { apiService } from './apiService';

export interface SiteSettings {
  userName: string;
  templateType: TemplateType;
  blocks: Block[];
  portfolio?: any[];
  design?: DesignSettings;
  socials?: any;
  profile?: any;
}

export const getSiteSettings = async (userName: string): Promise<SiteSettings | null> => {
  const normalizedUsername = userName.toLowerCase();

  // 1. Try Netlify Blobs API first (primary cloud source of truth)
  try {
    const apiData = await apiService.getSiteData(normalizedUsername);
    if (apiData && (apiData.blocks || apiData.design || apiData.profile || apiData.portfolio)) {
      return {
        userName,
        templateType: (apiData.design as any)?.templateType || TemplateType.SHOPPABLE_GRID,
        blocks: apiData.blocks || [],
        portfolio: apiData.portfolio,
        design: apiData.design,
        socials: apiData.socials,
        profile: apiData.profile
      };
    }
  } catch (e) {
    console.warn('Error loading site settings from API:', e);
  }

  // 2. Try Supabase as fallback (if available)
  try {
    if (supabase) {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', normalizedUsername)
        .maybeSingle();

      if (!error && profileData) {
        return {
          userName,
          templateType: TemplateType.SHOPPABLE_GRID,
          blocks: [],
          profile: {
            name: profileData.nickname || profileData.full_name || '',
            bio: profileData.bio || '',
            avatar_url: profileData.avatar_url || ''
          }
        };
      }
    }
  } catch (e) {
    console.warn('Error loading site settings from Supabase:', e);
  }

  // 3. Fallback to LocalStorage
  try {
    const savedBlocks = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
    const savedDesign = localStorage.getItem(`picks_design_${normalizedUsername}`);
    const savedPortfolio = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);

    const localBlocks = savedBlocks ? JSON.parse(savedBlocks) : null;
    const localPortfolio = savedPortfolio ? JSON.parse(savedPortfolio) : null;
    const localDesign = savedDesign ? JSON.parse(savedDesign) : null;

    if (localBlocks || localPortfolio) {
      return {
        userName,
        templateType: TemplateType.SHOPPABLE_GRID,
        blocks: localBlocks || [],
        portfolio: localPortfolio || undefined,
        design: localDesign || undefined
      };
    }
  } catch (e) {
    console.error('Error loading site settings from LocalStorage:', e);
  }

  // Default fallback
  return {
    userName,
    templateType: TemplateType.SHOPPABLE_GRID,
    blocks: []
  };
};

export const getLinkGridItems = async (userName: string): Promise<Block[]> => {
  if (!supabase) return [];
  
  try {
    const normalizedUsername = userName.toLowerCase();
    
    // 1. Get user_id from profiles table using username
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle();
    
    if (profileError || !profile) return [];

    // 2. Fetch items for that user_id
    const { data, error } = await supabase
      .from('link_grid_items')
      .select('id, title, price, image_url, link, display_order')
      .eq('user_id', profile.id)
      .order('display_order', { ascending: true });
    
    if (error) throw error;
    
    return (data || []).map(item => ({
      id: item.id,
      title: item.title,
      category: 'ITEM', // Default category
      coverMedia: item.image_url,
      mediaType: 'image',
      products: [
        {
          id: item.id + '-p',
          name: item.title,
          price: item.price,
          link: item.link
        }
      ]
    }));
  } catch (e) {
    console.error('Error fetching link_grid_items:', e);
    return [];
  }
};

export const updateLinkGridItems = async (blocks: Block[]) => {
  if (!supabase) return false;
  
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("User not authenticated");

    // 1. Get existing item IDs for this user
    const { data: existingItems, error: fetchError } = await supabase
      .from('link_grid_items')
      .select('id')
      .eq('user_id', user.id);
    
    if (fetchError) throw fetchError;
    
    const existingIds = (existingItems || []).map(item => item.id);
    const currentIds = blocks.map(b => b.id);
    
    // 2. Identify items to delete
    const idsToDelete = existingIds.filter(id => !currentIds.includes(id));
    
    if (idsToDelete.length > 0) {
      await supabase
        .from('link_grid_items')
        .delete()
        .in('id', idsToDelete)
        .eq('user_id', user.id);
    }
    
    // 3. Upsert current items
    if (blocks.length > 0) {
      const itemsToUpsert = blocks.map((block, index) => ({
        id: block.id,
        user_id: user.id,
        title: block.title,
        price: block.products?.[0]?.price || '0',
        image_url: block.coverMedia,
        link: block.products?.[0]?.link || '',
        display_order: index
      }));
      
      const { error: upsertError } = await supabase
        .from('link_grid_items')
        .upsert(itemsToUpsert, { onConflict: 'id' });
      
      if (upsertError) throw upsertError;
    }
    
    return true;
  } catch (e) {
    console.error('Error updating link_grid_items:', e);
    return false;
  }
};

export const updateSiteSettings = async (userName: string, settings: Partial<SiteSettings>) => {
  const normalizedUsername = userName.toLowerCase();

  // 1. Update LocalStorage (Immediate)
  if (settings.blocks) {
    localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(settings.blocks));
  }

  if (settings.portfolio) {
    localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(settings.portfolio));
  }

  if (settings.design) {
    localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(settings.design));
  }

  if (settings.socials) {
    localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(settings.socials));
  }

  // 2. Sync to Netlify Blobs API (Primary Cloud Storage)
  try {
    const apiPayload: Record<string, any> = {};
    if (settings.blocks !== undefined) apiPayload.blocks = settings.blocks;
    if (settings.design !== undefined) apiPayload.design = settings.design;
    if (settings.portfolio !== undefined) apiPayload.portfolio = settings.portfolio;
    if (settings.socials !== undefined) apiPayload.socials = settings.socials;
    if (settings.profile !== undefined) apiPayload.profile = settings.profile;

    if (Object.keys(apiPayload).length > 0) {
      await apiService.saveSiteData(normalizedUsername, apiPayload);
    }
  } catch (e) {
    console.warn('Error syncing to Netlify Blobs API:', e);
  }

  // 3. Also sync to Supabase if available (secondary backup)
  if (supabase) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return true; // Skip Supabase sync if not authenticated

      const currentSiteData: any = {};

      // Deep merge design and profile
      const newSiteData = {
        ...currentSiteData,
        ...settings,
        design: settings.design ? {
          ...(currentSiteData.design || {}),
          ...settings.design
        } : currentSiteData.design,
        profile: settings.profile ? {
          ...(currentSiteData.profile || {}),
          ...settings.profile
        } : currentSiteData.profile
      };

      delete newSiteData.userName;

      const updateData: any = {
        username: normalizedUsername
      };

      // Sync top-level fields
      if (settings.profile) {
        if (settings.profile.name) updateData.nickname = settings.profile.name;
        if (settings.profile.bio) updateData.bio = settings.profile.bio;
        if (settings.profile.avatar_url) updateData.avatar_url = settings.profile.avatar_url;
        if (settings.profile.links?.phone) updateData.phone = settings.profile.links.phone;
      }

      await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          ...updateData,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (e) {
      console.warn('Error syncing to Supabase:', e);
    }
  }

  return true;
};
