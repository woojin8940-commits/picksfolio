-- 브랜드 멤버십 "엔터프라이즈 문의하기"로 받는 문의.
--
-- 멤버십 화면의 문의 폼이 회사명 · 담당자 성함 · 연락처 · 이메일 · 문의 내용을 남긴다.
-- 로그인한 브랜드 계정에서 보냈으면 그 회사 아이디(company_username)를 함께 적는다.
-- 운영자가 연락한 뒤 진행 상태(status)와 상담 메모(memo)를 같은 행에 남긴다.
CREATE TABLE IF NOT EXISTS enterprise_inquiries (
  id BIGSERIAL PRIMARY KEY,
  company_username TEXT,
  company TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',       -- 'new' | 'contacted' | 'done'
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enterprise_inquiries_created_at_idx
  ON enterprise_inquiries (created_at DESC);
