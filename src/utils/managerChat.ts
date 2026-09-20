/**
 * 담당자와 대화하는 창구 한 곳.
 *
 * 앱 안의 대화방으로 보내던 자리다. 그런데 담당자가 실제로 답하는 곳은 픽스폴리오
 * 카카오톡 채널이라, 인플루언서가 앱에 남긴 말은 한참 뒤에 읽히거나 결국 카카오톡으로
 * 다시 옮겨 적어야 했다. 조건 · 일정 문의는 답이 빨라야 다음 단계가 움직이니 사람이
 * 있는 창구로 곧장 보낸다.
 *
 * 주소를 이 파일 하나에 둔다. 협업 캠페인 화면과 캠페인 상세의 '담당자와 대화하기' 가
 * 서로 다른 곳을 가리키면, 같은 문의가 어느 버튼을 눌렀는지에 따라 담당자에게 닿거나
 * 닿지 않는다 — 실제로 캠페인 상세 쪽만 앱 안 타임라인으로 남아 있었다.
 */

import { openExternalUrl } from './externalLink';

export const MANAGER_CHAT_URL = 'https://pf.kakao.com/_ziZxhX/chat';

/** 담당자(픽스폴리오 카카오톡 채널) 대화창을 연다. */
export const openManagerChat = (): boolean => openExternalUrl(MANAGER_CHAT_URL);
