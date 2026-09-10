import { seoulDayOf } from "./campaign-recruit.mts";

/**
 * 승인된 카카오 알림톡 템플릿 모음.
 *
 * 템플릿 하나에는 두 가지가 붙어 있다 — 카카오가 심사해 준 **문구**와, 그 문구가
 * 요구하는 **치환 변수 이름**(`#{브랜드명}` 같은 것). 이 둘은 한 몸이라서 발송하는
 * 코드가 변수 이름을 하나라도 틀리면 그 발송은 알림톡으로 나가지 못하고 대체 문자로
 * 떨어진다(= 같은 내용이 문자 요금으로, 그것도 버튼 없이 나간다). 그래서 "어느
 * 이벤트가 어느 템플릿을 쓰고 그 템플릿의 변수는 무엇인가"를 발송 지점마다 적어
 * 두지 않고 이 파일 하나에 모아 둔다.
 *
 * 템플릿 ID 를 환경변수로 빼지 않은 이유. 예전에는 `SOLAPI_KAKAO_*_TEMPLATE_ID` 로
 * 받았는데, 템플릿을 새로 만들어 올리면 환경변수에는 지워진 템플릿 ID 가 남아 있고
 * 코드는 그것을 그대로 믿어서 모든 발송이 조용히 문자로 떨어졌다(2026-09 시점에
 * 기존 환경변수 네 개가 전부 삭제된 템플릿을 가리키고 있었다). 변수 이름이 바뀌면
 * 어차피 코드를 고쳐야 하므로, ID 도 문구와 같은 자리에 두고 함께 고친다.
 *
 * 새 템플릿을 붙일 때: 솔라피에서 승인된 문구를 그대로 읽어 `#{...}` 이름을 맞추고,
 * `message` 에는 같은 내용의 평문을 적는다(알림톡이 실패했을 때 나가는 대체 문자).
 */

export type AlimtalkTemplate = {
  templateId: string;
  variables: Record<string, string>;
  /** 알림톡 발송이 실패했을 때 대체 문자로 나가는 평문. */
  message: string;
};

/**
 * 치환 변수는 비어 있으면 안 된다.
 *
 * 값이 빈 문자열이면 카카오는 그 자리를 `#{협업명}` 그대로 둔 채 거절한다. 이름이
 * 비어 있는 것보다 "브랜드" 같은 총칭이라도 들어가 있는 편이 알림 자체가 나가지
 * 않는 것보다 낫다.
 */
const filled = (raw: unknown, fallback: string): string => {
  const value = String(raw ?? "").trim();
  return value || fallback;
};

/** 협업 상대를 부르는 이름. 표시 이름이 없으면 아이디로 부른다. */
const person = (raw: unknown) => filled(raw, "고객");

// ---------------------------------------------------------------------------
// 협업 진행 알림 (인플루언서 수신)
// ---------------------------------------------------------------------------

/** 진행사항 알림 - 제품발송완료 · 브랜드가 발송 처리를 누른 직후. */
export function productShippedAlimtalk(input: {
  influencer: string;
  brand: string;
  productName?: string;
  courier?: string;
  trackingNumber?: string;
  shippedAt?: string;
}): AlimtalkTemplate {
  const brand = filled(input.brand, "브랜드");
  const influencer = person(input.influencer);
  const productName = filled(input.productName, "협업 제품");
  const courier = filled(input.courier, "미기재");
  const trackingNumber = filled(input.trackingNumber, "미기재");
  const shippedAt = filled(seoulDayOf(input.shippedAt), seoulDayOf(new Date()));

  return {
    templateId: "KA01TP260831142130806pPN94fKmHpc",
    variables: {
      "#{브랜드명}": brand,
      "#{인플루언서명}": influencer,
      "#{상품명}": productName,
      "#{택배사}": courier,
      "#{송장번호}": trackingNumber,
      "#{발송일}": shippedAt,
    },
    message:
      `[픽스폴리오] ${brand} 제품이 발송되었어요\n\n` +
      `${influencer}님, ${brand}에서 협업 제품을 발송했어요.\n` +
      `상품명: ${productName}\n택배사: ${courier}\n송장번호: ${trackingNumber}\n발송일: ${shippedAt}\n\n` +
      `제품 수령 후 픽스폴리오 앱에서 확인해 주세요.`,
  };
}

/** 기획안 · 영상 세 템플릿이 같은 세 변수를 쓴다. 한 자리에서 만든다. */
const collabNames = (input: { influencer: string; brand: string; campaignTitle?: string }) => ({
  brand: filled(input.brand, "브랜드"),
  influencer: person(input.influencer),
  campaign: filled(input.campaignTitle, "협업 프로젝트"),
});

/** 기획안 피드백 알림 · 브랜드가 기획안에 피드백을 남겼을 때. */
export function planFeedbackAlimtalk(input: {
  influencer: string;
  brand: string;
  campaignTitle?: string;
}): AlimtalkTemplate {
  const { brand, influencer, campaign } = collabNames(input);
  return {
    templateId: "KA01TP2609010737326558nyZkCm80qL",
    variables: {
      "#{브랜드명}": brand,
      "#{인플루언서명}": influencer,
      "#{협업명}": campaign,
    },
    message:
      `[픽스폴리오] ${brand} 기획안 피드백이 도착했어요\n\n` +
      `${influencer}님, ${brand}에서 제출하신 기획안에 대한 피드백을 남겼어요.\n` +
      `협업명: ${campaign}\n\n피드백을 확인하고 기획안을 수정해 주세요.`,
  };
}

/** 기획안 검토 완료 · 피드백 반영까지 끝나 영상 초안 단계로 넘어갈 때. */
export function planApprovedAlimtalk(input: {
  influencer: string;
  brand: string;
  campaignTitle?: string;
}): AlimtalkTemplate {
  const { brand, influencer, campaign } = collabNames(input);
  return {
    templateId: "KA01TP260831142343308yRGgSMyilJk",
    variables: {
      "#{브랜드명}": brand,
      "#{인플루언서명}": influencer,
      "#{협업명}": campaign,
    },
    message:
      `[픽스폴리오] ${brand} 기획안 검토가 완료되었어요\n\n` +
      `${influencer}님, ${brand}에서 기획안 검토를 완료했어요.\n` +
      `협업명: ${campaign}\n\n다음 단계인 영상 초안을 제출해 주세요.`,
  };
}

/** 영상 초안 피드백 알림 · 브랜드가 초안 영상에 피드백을 남겼을 때. */
export function videoFeedbackAlimtalk(input: {
  influencer: string;
  brand: string;
  campaignTitle?: string;
}): AlimtalkTemplate {
  const { brand, influencer, campaign } = collabNames(input);
  return {
    templateId: "KA01TP260901074010582E8cfh4jKUNU",
    variables: {
      "#{브랜드명}": brand,
      "#{인플루언서명}": influencer,
      "#{협업명}": campaign,
    },
    message:
      `[픽스폴리오] ${brand} 영상 초안 피드백이 도착했어요\n\n` +
      `${influencer}님, ${brand}에서 제출하신 영상 초안에 피드백을 남겼어요.\n` +
      `협업명: ${campaign}\n\n피드백을 확인하고 영상을 수정해 주세요.`,
  };
}

/** 영상 초안 검토 완료 · 초안 검토가 끝나 업로드 단계로 넘어갈 때. */
export function videoApprovedAlimtalk(input: {
  influencer: string;
  brand: string;
  campaignTitle?: string;
}): AlimtalkTemplate {
  const { brand, influencer, campaign } = collabNames(input);
  return {
    templateId: "KA01TP260831142659845Z7dxTyDPNf1",
    variables: {
      "#{브랜드명}": brand,
      "#{인플루언서명}": influencer,
      "#{협업명}": campaign,
    },
    message:
      `[픽스폴리오] ${brand} 영상 초안 검토가 완료됐어요\n\n` +
      `${influencer}님, ${brand}에서 제출하신 영상 초안 검토를 완료했어요.\n` +
      `협업명: ${campaign}\n\n검토 결과를 확인하고 업로드 단계를 진행해 주세요.`,
  };
}

// ---------------------------------------------------------------------------
// 제안 · 메시지 알림
// ---------------------------------------------------------------------------

/** 비즈니스 제안 도착 · 개인페이지의 비즈니스 제안 버튼으로 제안이 들어왔을 때. */
export function businessProposalAlimtalk(input: {
  influencer: string;
  companyName?: string;
  proposalTitle?: string;
}): AlimtalkTemplate {
  const influencer = person(input.influencer);
  const company = filled(input.companyName, "브랜드");
  const summary = filled(input.proposalTitle, "협업 제안").slice(0, 200);

  return {
    templateId: "KA01TP2609010734512080sjpqrKSbFI",
    variables: {
      "#{고객명}": influencer,
      "#{업체명}": company,
      "#{제안내용}": summary,
    },
    message:
      `[픽스폴리오] 비즈니스 제안 도착\n\n` +
      `${influencer}님, 새로운 비즈니스 제안이 도착했습니다.\n` +
      `제안 업체: ${company}\n제안 내용: ${summary}\n\n` +
      `픽스폴리오 대시보드에서 상세 내용을 확인해 주세요.`,
  };
}

/**
 * 협업 타임라인 메시지 알림.
 *
 * 이 템플릿에는 메시지 본문이 들어가지 않는다 — 대화 내용을 알림톡으로 흘리지 않고
 * "누가 어느 협업에 말을 걸었다"만 알린다. 본문은 앱 푸시와 협업방에서 읽는다.
 */
export function timelineMessageAlimtalk(input: {
  recipient: string;
  senderName?: string;
  projectName?: string;
}): AlimtalkTemplate {
  const recipient = person(input.recipient);
  const sender = filled(input.senderName, "협업 상대");
  const project = filled(input.projectName, "협업 프로젝트");

  return {
    templateId: "KA01TP2608311436298357D6QCmduX61",
    variables: {
      "#{발신자명}": sender,
      "#{고객명}": recipient,
      "#{협업명}": project,
    },
    message:
      `[픽스폴리오] ${sender} 새 메시지가 도착했어요\n\n` +
      `${recipient}님, ${sender}님이 협업 타임라인에 새 메시지를 보냈어요.\n` +
      `협업명: ${project}\n\n픽스폴리오 앱에서 확인해 주세요.`,
  };
}

// ---------------------------------------------------------------------------
// 진단
// ---------------------------------------------------------------------------

/**
 * 코드가 실제로 쓰는 템플릿 목록.
 *
 * 운영자 진단(api-alimtalk-diagnose)이 이 목록을 돌면서 솔라피에 올라간 템플릿과
 * 대조한다 — 그 템플릿이 아직 존재하고 승인 상태인지, 그리고 문구가 요구하는 변수
 * 이름이 여기 적힌 것과 같은지. 템플릿을 새로 올려 ID 가 바뀌면 발송은 조용히
 * 대체 문자로 떨어지므로, 발송이 실패하기 전에 이 화면에서 먼저 보이게 한다.
 *
 * 값은 형태만 맞춘 예시다(실제 발송에는 쓰이지 않는다).
 */
export const ALIMTALK_TEMPLATE_CATALOG: { label: string; template: AlimtalkTemplate }[] = (() => {
  const sample = { influencer: "예시", brand: "예시브랜드", campaignTitle: "예시 캠페인" };
  return [
    {
      label: "제품 발송 완료 (인플루언서)",
      template: productShippedAlimtalk({ ...sample, productName: "예시 제품", courier: "예시택배", trackingNumber: "0000" }),
    },
    { label: "기획안 피드백 (인플루언서)", template: planFeedbackAlimtalk(sample) },
    { label: "기획안 검토 완료 (인플루언서)", template: planApprovedAlimtalk(sample) },
    { label: "영상 초안 피드백 (인플루언서)", template: videoFeedbackAlimtalk(sample) },
    { label: "영상 초안 검토 완료 (인플루언서)", template: videoApprovedAlimtalk(sample) },
    {
      label: "비즈니스 제안 도착 (인플루언서)",
      template: businessProposalAlimtalk({ influencer: "예시", companyName: "예시업체", proposalTitle: "예시 제안" }),
    },
    {
      label: "협업 타임라인 새 메시지 (양쪽)",
      template: timelineMessageAlimtalk({ recipient: "예시", senderName: "예시업체", projectName: "예시 협업" }),
    },
  ];
})();
