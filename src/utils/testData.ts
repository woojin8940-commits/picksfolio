// Shared heuristics for separating operational data from leftover test / dummy
// records so the operator dashboard can hide them behind a toggle.
//
// These patterns intentionally err on the side of NOT hiding real accounts:
// they only match obvious seed/QA artifacts (testuser*, *_tester*, picksfolio12,
// repeated single-jamo titles like "ㅇㅇㅇ", literal "테스트" labels, etc.).

const TEST_USERNAME_PATTERNS: RegExp[] = [
  /test/i,            // testuser, testusesr, testuser12, biz_tester123 …
  /tester/i,
  /dummy/i,
  /sample/i,
  /^picksfolio\d+$/i, // picksfolio12 (the numbered QA alias, not the brand account)
  /^qa[_-]?/i,
];

// Dummy free-text that shows up in seeded proposals.
const TEST_TEXT_PATTERNS: RegExp[] = [
  /^[ㄱ-ㅎㅏ-ㅣ\s]+$/,   // only Korean jamo, e.g. "ㅇㅇㅇㅇ"
  /테스트/,
  /^test\b/i,
  /^\.+$/,               // "...", "."
];

export const isTestUsername = (username?: string | null): boolean => {
  const u = (username || '').toLowerCase().replace(/^biz\//, '').trim();
  if (!u) return false;
  return TEST_USERNAME_PATTERNS.some(re => re.test(u));
};

const looksLikeDummyText = (value?: string | null): boolean => {
  const v = (value || '').trim();
  if (!v) return false;
  return TEST_TEXT_PATTERNS.some(re => re.test(v));
};

// A proposal counts as test data when any party or its free-text fields look
// like seed/QA content.
export const isTestProposal = (p: {
  _username?: string;
  influencer_username?: string;
  business_username?: string;
  company_name?: string;
  contact_person?: string;
  title?: string;
  content?: string;
}): boolean => {
  if (isTestUsername(p._username || p.influencer_username)) return true;
  if (isTestUsername(p.business_username)) return true;
  if (isTestUsername(p.company_name)) return true;
  if (looksLikeDummyText(p.company_name)) return true;
  if (looksLikeDummyText(p.contact_person)) return true;
  if (looksLikeDummyText(p.title)) return true;
  return false;
};
