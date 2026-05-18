
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_MZRQAtcasu7LA-wFFz3tzA_RWlGSrEQ';

// 환경 변수 주입 확인 및 에러 로깅
if (!import.meta.env.VITE_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('[Supabase] 환경 변수가 설정되지 않았습니다. 기본 데모 서버를 사용합니다.');
} else {
  console.log('[Supabase] 환경 변수가 감지되었습니다.');
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] CRITICAL: Supabase URL 또는 Anon Key가 누락되었습니다!');
}

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

if (!supabase) {
  console.error('[Supabase] 클라이언트 초기화 실패!');
}
