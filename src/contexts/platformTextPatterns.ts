// Generated from platform template literals with dynamic values preserved.
export const platformTextPatterns = [
  {
    "source": "^지금 같은 규모로 등록된 계정이 (.+?)명입니다\\. 평균이 뜻을 가지려면 최소 (.+?)명이 필요해서, 그 전에는 평균을 그리지 않습니다\\. 아래는 내 값이고, 등록이 쌓이면 이 자리에 비교 그래프가 저절로 켜집니다\\.$",
    "replacement": "There are $1 accounts registered at the same scale right now. An average needs at least $2 to mean anything, so we do not draw one before that. Below is your own value; once more accounts register, the comparison graph turns on here by itself."
  },
  {
    "source": "^(.+?)편 중 (.+?)편을 분류했습니다\\(나머지는 저장 · 공유를 못 받은 편입니다\\)\\. 각 지표는 내 계정의 그 지표 평균과 견줘서 판정하므로, \"두드러졌다\"는 절대 기준이 아니라 내 계정 안에서의 이야기입니다\\.$",
    "replacement": "$2 of $1 have been classified (the rest did not get saves or shares). Each metric is judged against your own account's average for that metric, so \"stood out\" is not an absolute bar — it is a story within your own account."
  },
  {
    "source": "^최근 (.+?)일 동안 하루 한 번 기록한 값의 변화입니다\\. 하루 단위 순증감이라, 같은 날 팔로우와 언팔로우가 함께 있었다면 서로 상쇄된 뒤의 숫자입니다\\.$",
    "replacement": "This is how the value changed, recorded once a day over the last $1 days. Because it is a daily net change, if there were follows and unfollows on the same day the number is what is left after they cancel out."
  },
  {
    "source": "^한 칸에 릴스 (.+?)편 이상이 쌓이고 평균이 뚜렷하게 높아야 결론으로 적습니다\\. 한 편으로 정한 \"좋은 시간대\"는 그 한 편의 이야기일 뿐이라서요\\.$",
    "replacement": "We only write a conclusion once a slot holds $1 or more Reels and the average is clearly higher. A \"good time slot\" decided from one Reel is only that one Reel's story."
  },
  {
    "source": "^우리 서비스에 연동된 인플루언서의 최근 콘텐츠에서 @(.+?) 언급을 찾아 보여줍니다\\. 연동하지 않은 계정이 태그한 게시물은 목록에 잡히지 않습니다\\.$",
    "replacement": "We look through the recent content of influencers connected to our service for mentions of @$1 and show them here. Posts tagged by accounts that are not connected do not show up in the list."
  },
  {
    "source": "^월별 콘텐츠 성과 그래프와 총 조회수에는 브랜드 계정이 올린 게시물 (.+?)개가 함께 반영됩니다\\. TOP 10 은 태그된 콘텐츠만 줄 세웁니다\\.$",
    "replacement": "The monthly content performance graph and the total views also include the $1 posts your brand account published. The TOP 10 ranks tagged content only."
  },
  {
    "source": "^이미 결제한 이용 기간인 (.+?)까지는 모든 기능을 그대로 이용할 수 있습니다\\. 그 이후에는 자동으로 해지되며, 다음 달부터 결제되지 않습니다\\.$",
    "replacement": "You keep every feature as it is until $1, the period you have already paid for. After that it is cancelled automatically, and you are not charged from next month."
  },
  {
    "source": "^인스타그램은 팔로워 (.+?)명부터 팔로워 구성을 알려줍니다(.+?)\\. 팔로워가 그 선을 넘으면 이 자리에 성별 · 연령대 · 국가 분포가 채워집니다\\.$",
    "replacement": "Instagram only reports the follower breakdown from $1 followers$2. Once your followers pass that line, the gender, age and country breakdown fills in here."
  },
  {
    "source": "^(.+?)를 받아온 콘텐츠가 없어 순위를 매기지 않았습니다\\. 올린 계정의 연동이 없거나, 올린 직후라 아직 집계되지 않은 콘텐츠입니다\\.$",
    "replacement": "No content has $1 collected, so nothing has been ranked. Either the posting account is not connected, or the content was just posted and has not been counted yet."
  },
  {
    "source": "^출시 혜택으로 (.+?)까지 무료로 이용합니다\\. 그 날부터 등록한 카드로 월 (.+?)원이 자동결제되며, 그 전에 해지하면 결제되지 않습니다\\.$",
    "replacement": "With the launch offer you use it free until $1. From that day KRW $2 a month is charged automatically to the card you registered, and if you cancel before then you are not charged."
  },
  {
    "source": "^@(.+?) 님이 수락한 제안입니다\\. 지우면 인플루언서 수신함과 협업 현황에서도 사라지고 되돌릴 수 없습니다\\. 계속하시겠습니까\\?$",
    "replacement": "@$1 accepted this offer. Deleting it removes it from the influencer's inbox and the collab status too, and it cannot be undone. Continue?"
  },
  {
    "source": "^업로드된 게시물 (.+?)건 중 아직 집계된 게시물이 없습니다\\. 인플루언서가 채널을 연동하면 조회수·좋아요·댓글이 채워집니다\\.$",
    "replacement": "None of the $1 uploaded posts have been counted yet. Once the influencer connects their channel, views, likes and comments fill in."
  },
  {
    "source": "^유형을 나누려면 한 편에 댓글 · 저장 · 공유가 모두 있어야 합니다\\. 지금은 (.+?)편 중 (.+?)편이고, (.+?)편부터 계산합니다\\.$",
    "replacement": "To sort by type, a Reel needs comments, saves and shares all present. Right now that is $2 out of $1, and we start calculating from $3."
  },
  {
    "source": "^전달했지만 아직 수정본이 오지 않은 피드백이 (.+?)개 있습니다\\. 그래도 (.+?) 검토를 완료하고 다음 단계로 넘어갈까요\\?$",
    "replacement": "There are $1 pieces of feedback that were delivered but have not come back revised. Finish the $2 review and move to the next stage anyway?"
  },
  {
    "source": "^업로드가 확인된 게시물이 (.+?)건 있습니다\\. 게시물 지표는 인플루언서 채널이 연동된 뒤부터 이 화면에 쌓입니다\\.$",
    "replacement": "There are $1 posts with confirmed uploads. Post metrics are accumulated on this screen after the influencer channel is linked."
  },
  {
    "source": "^@(.+?) 협업을 시작합니다\\. 브랜드와 인플루언서 진행사항에 바로 표시되고 되돌릴 수 없습니다\\. 계속하시겠습니까\\?$",
    "replacement": "Starting the collab with @$1. It appears right away in both the brand's and the influencer's progress and cannot be undone. Continue?"
  },
  {
    "source": "^내 계정은 (.+?)에 가깝습니다 — 분류된 (.+?)편 중 (.+?)편\\. 브랜드에게 제안할 때 이 강점을 그대로 말하면 됩니다\\.$",
    "replacement": "Your account is closest to $1 — $3 of the $2 classified. When you pitch a brand, say this strength exactly as it is."
  },
  {
    "source": "^업로드된 게시물 (.+?)건 중 (.+?)건이 집계됐습니다\\. 아래 목록에서 나머지 게시물의 사유를 확인할 수 있습니다\\.$",
    "replacement": "$2 of the $1 uploaded posts have been counted. You can check the reason for the remaining posts in the list below."
  },
  {
    "source": "^@(.+?) 님이 캠페인 (.+?)건을 맡고 있습니다\\. 해제하면 그 캠페인은 담당자 없는 상태가 됩니다\\. 계속할까요\\?$",
    "replacement": "@$1 is in charge of campaign $2. If disabled, the campaign will become ownerless. Shall we continue?"
  },
  {
    "source": "^함께할 인플루언서는 브랜드가 직접 수락하고, 그 뒤는 픽스폴리오 담당자(.+?)가 중간에서 맡습니다\\.$",
    "replacement": "The brand directly accepts the influencers to work with, and the person in charge of PICKSfolio, $1, takes charge of the process."
  },
  {
    "source": "^최근 (.+?)일 안에 올린 릴스가 없습니다\\. 기간을 늘려 보거나, 릴스를 올린 뒤 새로 불러오세요\\.$",
    "replacement": "No Reels were posted in the last $1 days. Try widening the range, or post a Reel and reload."
  },
  {
    "source": "^출시 혜택 코드가 등록되어 (.+?)을\\(를\\) (.+?)개월간 무료로 이용합니다\\. 지금 결제된 금액은 없습니다\\.$",
    "replacement": "A launch offer code has been registered, so you use $1 free for $2 months. Nothing has been charged right now."
  },
  {
    "source": "^이 캠페인의 집행 예산은 (.+?)이며, 단가는 집계된 게시물에 실제로 나간 지급액으로 계산합니다\\.$",
    "replacement": "This campaign's spend is $1, and the rate is calculated from the payouts that actually went out on the counted posts."
  },
  {
    "source": "^목록은 최대 (.+?)시간 동안 보관한 값을 보여주며, 새로 불러오기를 누르면 다시 조회합니다\\.$",
    "replacement": "The list shows values kept for up to $1 hours; press Reload to look them up again."
  },
  {
    "source": "^해지가 예약되었습니다\\. (.+?)까지 그대로 이용할 수 있고, 다음 결제는 진행되지 않습니다\\.$",
    "replacement": "Cancellation has been scheduled. You can keep using it as it is until $1, and the next payment will not go through."
  },
  {
    "source": "^@(.+?) 계정에 담당자 권한을 주었습니다\\. 이미 로그인 중이라면 새로고침 후 적용됩니다\\.$",
    "replacement": "@$1 account has been given administrator privileges. If you are already logged in, it will take effect after refreshing."
  },
  {
    "source": "^(.+?)건은 채널에 저장된 최근 게시물 기준이라 연동으로 받은 값보다 오래될 수 있습니다\\.$",
    "replacement": "$1 of them are based on the recent posts stored on the channel, so they can be older than the values fetched over the connection."
  },
  {
    "source": "^(.+?) 정산을 완료로 처리합니다\\. 인플루언서와 브랜드 화면에 '지급 완료'로 표시됩니다\\.$",
    "replacement": "Marking $1's settlement as complete. It shows as \"Paid\" on the influencer's and the brand's screens."
  },
  {
    "source": "^\\[Auth\\] Auto-logout on mount: (.+?)분간 활동 없음 — 세션 종료$",
    "replacement": "[Auth] Auto-logout on mount: $1 minutes of inactivity — session terminated"
  },
  {
    "source": "^이 캠페인의 집행 예산은 (.+?)이며, 조회수가 들어오면 CPV가 자동으로 계산됩니다\\.$",
    "replacement": "The execution budget for this campaign is $1, and CPV is automatically calculated as the number of views comes in."
  },
  {
    "source": "^지원자 목록에서 함께할 분을 (.+?)만큼 고르시면 담당자가 협업을 만들어 드립니다\\.$",
    "replacement": "Please select $1 people from the list of applicants and the person in charge will create a collaboration."
  },
  {
    "source": "^최근 (.+?)일 중 (.+?)일치만 기록돼 있습니다\\. 나머지 기간은 데이터 수집 중입니다\\.$",
    "replacement": "Only $2 days of the last $1 are on record. The rest of the period is still being collected."
  },
  {
    "source": "^(.+?)명으로 확정했습니다\\. 진행사항에서 선택한 인플루언서를 확인할 수 있습니다\\.$",
    "replacement": "Confirmed at $1. You can see the influencers you selected under Progress."
  },
  {
    "source": "^주민등록증 · 운전면허증 등 · jpg · png · pdf · 최대 (.+?)MB$",
    "replacement": "National ID card · driver's licence and so on · jpg · png · pdf · up to $1MB"
  },
  {
    "source": "^(.+?)에 더 수정할 부분이 없다면 검토를 완료합니다\\. 다음 단계로 넘어갈까요\\?$",
    "replacement": "If there is nothing more to change in the $1, the review is finished. Move to the next stage?"
  },
  {
    "source": "^담당자를 @(.+?) 로 변경했습니다\\. 진행 중인 협업 담당자도 함께 바뀝니다\\.$",
    "replacement": "The person in charge has been changed to @$1. The person responsible for ongoing collaboration also changes."
  },
  {
    "source": "^(.+?)까지로 확정 기한을 정했습니다\\. 브랜드 화면에 남은 시간이 표시됩니다\\.$",
    "replacement": "$1. The brand screen displays the remaining time."
  },
  {
    "source": "^릴스가 (.+?)편 이상 쌓이면 잘된 편들의 공통점을 문장으로 정리해 드립니다\\.$",
    "replacement": "Once you have $1 or more Reels, we write up what the ones that did well have in common."
  },
  {
    "source": "^@(.+?) 수락으로 처리하면 계약\\(협업\\)이 바로 생성됩니다\\. 계속하시겠습니까\\?$",
    "replacement": "@$1 If accepted, a contract (collaboration) will be created immediately. Do you want to continue?"
  },
  {
    "source": "^집행 요청 (.+?)건 포함 · 이력에서 고른 콘텐츠를 그대로 소재로 씁니다$",
    "replacement": "Includes $1 boost requests · the content you picked from the history is used as the creative exactly as it is"
  },
  {
    "source": "^\\[Auth\\] Auto-logout: (.+?)분간 활동 없음 — 세션 종료$",
    "replacement": "[Auth] Auto-logout: $1 minutes of inactivity — session ended"
  },
  {
    "source": "^인플루언서가 피드백을 반영해 (.+?)을 다시 올리면 검토할 수 있습니다\\.$",
    "replacement": "You can review it once the influencer applies the feedback and uploads the $1 again."
  },
  {
    "source": "^알림 신청한 (.+?)건을 전부 초기화하시겠습니까\\? 되돌릴 수 없습니다\\.$",
    "replacement": "Do you want to reset all $1 requests for notifications? There is no turning back."
  },
  {
    "source": "^브랜드 가이드 파일을 읽고 이 캠페인의 기획안 · 본문을 씁니다(.+?)$",
    "replacement": "Reads the brand guide files and writes this campaign's plan and caption$1"
  },
  {
    "source": "^클로드 플랜이 시작되었습니다\\. 기본 (.+?) 크레딧이 충전되었습니다\\.$",
    "replacement": "The Claude Plan has started. Your basic $1 credits have been recharged."
  },
  {
    "source": "^'(.+?)' 카테고리와 이 카테고리에 속한 포스트가 함께 삭제됩니다\\.$",
    "replacement": "The '$1' category and posts belonging to this category will be deleted together."
  },
  {
    "source": "^(.+?)개는 올린 계정의 연동을 찾을 수 없어 조회할 수 없었습니다\\.$",
    "replacement": "$1 could not be looked up because no connection was found for the posting account."
  },
  {
    "source": "^(.+?)까지 그대로 이용할 수 있고, 다음 결제는 진행되지 않습니다\\.$",
    "replacement": "You can keep using it as it is until $1, and the next payment will not go through."
  },
  {
    "source": "^인플루언서가 게시물에 @(.+?) 을 언급하면 이 목록에 나타납니다\\.$",
    "replacement": "When an influencer mentions @$1 in a post, it shows up in this list."
  },
  {
    "source": "^올라온 (.+?)을 확인하고 피드백을 남기거나 검토를 완료해 주세요\\.$",
    "replacement": "Please check the $1 that came in and either leave feedback or finish the review."
  },
  {
    "source": "^피드백 (.+?)개를 저장했습니다\\. 인플루언서에게 바로 전달됩니다\\.$",
    "replacement": "$1 pieces of feedback have been saved. They go straight to the influencer."
  },
  {
    "source": "^이미지가 큽니다\\. (.+?)MB 이하로 올려 주세요\\. \\(현재 (.+?)MB\\)$",
    "replacement": "The image is large. Please upload one under $1MB. (currently $2MB)"
  },
  {
    "source": "^(.+?)명으로 확정했습니다\\. 담당자가 조건을 정리해 제안합니다\\.$",
    "replacement": "$1 confirmed. The person in charge will organize the conditions and make a proposal."
  },
  {
    "source": "^다음 결제일은 (.+?)이며, 가입일 기준 매월 자동결제됩니다\\.$",
    "replacement": "The next payment date is $1, and payment is made automatically every month based on the date of subscription."
  },
  {
    "source": "^스탠다드 (.+?)명 · AI 협업 (.+?)명 · 프로 (.+?)명 · 주목 (.+?)명$",
    "replacement": "Standard $1 people · AI Collaboration $2 people · Pro $3 people · Attention $4 people"
  },
  {
    "source": "^릴스가 (.+?)편 이상 쌓이면 콘텐츠 코칭이 함께 표시됩니다\\.$",
    "replacement": "Once you have $1 or more Reels, content coaching is shown alongside."
  },
  {
    "source": "^(.+?)명의 협업을 시작했습니다\\. 양쪽 진행사항에 표시됩니다\\.$",
    "replacement": "The collabs for $1 have started. They show in both sides' progress."
  },
  {
    "source": "^브랜드가 (.+?)을 검토하면 피드백이나 다음 단계가 열립니다\\.$",
    "replacement": "Once the brand reviews the $1, feedback or the next stage opens up."
  },
  {
    "source": "^클로드 플랜이 시작되었어요\\. 기본 (.+?)이 지급되었습니다\\.$",
    "replacement": "The Claude Plan has begun. Default $1 has been paid."
  },
  {
    "source": "^@(.+?) 방송을 강제 종료하시겠습니까\\? 사유를 입력하세요\\.$",
    "replacement": "@$1 Do you want to force the broadcast to end? Please enter a reason."
  },
  {
    "source": "^@(.+?) 협업을 시작했습니다\\. 양쪽 진행사항에 표시됩니다\\.$",
    "replacement": "The collab with @$1 has started. It shows in both sides' progress."
  },
  {
    "source": "^\\((.+?)개는 인플루언서 성과 화면에서 이미 받아 둔 값\\)$",
    "replacement": "($1 of them are values already fetched on the influencer performance screen)"
  },
  {
    "source": "^(.+?) 복사에 실패했습니다\\. 직접 선택해 복사해 주세요\\.$",
    "replacement": "Could not copy $1. Please select it and copy it yourself."
  },
  {
    "source": "^장면 (.+?)에서 바꿨으면 하는 점 \\(없으면 비워 두세요\\)$",
    "replacement": "What you would like changed in scene $1 (leave it blank if nothing)"
  },
  {
    "source": "^\"(.+?)\"의 키워드와 답장 문구를 모두 입력해 주세요\\.$",
    "replacement": "Please enter both the keyword and the reply text for \"$1\"."
  },
  {
    "source": "^운영 부여 (.+?)명 · 유료 구독 (.+?)명 · 제휴 제공 (.+?)명$",
    "replacement": "Operator grant $1 · paid subscription $2 · partner comp $3"
  },
  {
    "source": "^연동이 없어 집계되지 않은 게시물이 (.+?)건 있습니다\\.$",
    "replacement": "There are $1 posts that were not counted because there is no connection."
  },
  {
    "source": "^mp4 · mov · webm 파일 · 최대 (.+?)MB$",
    "replacement": "mp4 · mov · webm files · up to $1MB"
  },
  {
    "source": "^브랜드 입금을 확인 완료로 처리합니다\\. 입금액 (.+?)원$",
    "replacement": "Marking the brand's deposit as confirmed. Deposit amount KRW $1"
  },
  {
    "source": "^수락했습니다\\. 담당자 \\(@(.+?)\\)가 이어서 진행합니다\\.$",
    "replacement": "Accepted. The person in charge (@$1) will continue."
  },
  {
    "source": "^복사에 실패했습니다\\. 이 링크를 사용해 주세요: (.+?)$",
    "replacement": "Copying failed. Please use this link: $1"
  },
  {
    "source": "^\\[Upload\\] API 업로드 시도 (.+?)/3 실패:$",
    "replacement": "[Upload] API upload attempt $1/3 failed:"
  },
  {
    "source": "^@(.+?) 으로 시작하는 유저의 방송 이력이 없습니다\\.$",
    "replacement": "There is no broadcast history for users starting with @$1."
  },
  {
    "source": "^판매 수수료는 (.+?)% ~ (.+?)% 사이로 입력해 주세요\\.$",
    "replacement": "Please enter the sales commission between $1% and $2%."
  },
  {
    "source": "^배분한 인원의 최소 집행액이 예산을 (.+?) 넘습니다\\.$",
    "replacement": "The minimum execution amount for the allocated number of people exceeds $1 the budget."
  },
  {
    "source": "^본문 캡션이 인스타그램 한도\\((.+?)자\\)를 넘었습니다\\.$",
    "replacement": "The caption is over the Instagram limit ($1 characters)."
  },
  {
    "source": "^(.+?) 검토를 완료했습니다\\. 다음 단계로 넘어갑니다\\.$",
    "replacement": "The $1 review is finished. Moving to the next stage."
  },
  {
    "source": "^카드로 (.+?)원이 결제되어 (.+?)이\\(가\\) 활성화되었습니다\\.$",
    "replacement": "KRW $1 has been paid with your card and $2 has been activated."
  },
  {
    "source": "^지원자 선정은 픽스폴리오 담당자(.+?)가 진행합니다\\.$",
    "replacement": "Applicant selection is conducted by PIXfolio staff member$1."
  },
  {
    "source": "^이미지 · PDF · 영상 파일 · 최대 (.+?)MB$",
    "replacement": "Image · PDF · video files · up to $1MB"
  },
  {
    "source": "^브랜드 피드백을 반영해 (.+?)을 다시 올려 주세요\\.$",
    "replacement": "Please apply the brand's feedback and upload the $1 again."
  },
  {
    "source": "^이 릴스들의 (.+?)는 나머지 릴스 평균의 (.+?)배였어요\\.$",
    "replacement": "The $1 on these Reels was $2× the average of the rest."
  },
  {
    "source": "^\\[Picks\\] 인증번호 \\[(.+?)\\]를 입력해주세요\\.$",
    "replacement": "[Picks] Please enter the authentication number [$1]."
  },
  {
    "source": "^초기화 완료: (.+?)명의 구독자가 삭제되었습니다\\.$",
    "replacement": "Initialization complete: $1 subscribers have been deleted."
  },
  {
    "source": "^광고 집행 예산은 (.+?)부터 입력할 수 있습니다\\.$",
    "replacement": "Advertising budget can be entered starting from $1."
  },
  {
    "source": "^(.+?)번 장면에서 바꾸고 싶은 점을 적어 주세요\\.$",
    "replacement": "$1 Please write down what you want to change in scene."
  },
  {
    "source": "^집계된 게시물 지급액 (.+?) ÷ 그 게시물 조회수$",
    "replacement": "$1 paid out across the counted posts ÷ the views on those posts"
  },
  {
    "source": "^'(.+?)' 계정이 올린 콘텐츠는 목록에 없습니다\\.$",
    "replacement": "There is no content posted by the account '$1' in the list."
  },
  {
    "source": "^(.+?)부터 등록한 카드로 월 (.+?)원이 자동결제됩니다\\.$",
    "replacement": "From $1, KRW $2 a month is charged automatically to the card you registered."
  },
  {
    "source": "^인플루언서가 (.+?)을 올리면 검토할 수 있습니다\\.$",
    "replacement": "You can review it once the influencer uploads the $1."
  },
  {
    "source": "^(.+?)에 올린 릴스가 전체 평균의 (.+?)배 \\((.+?)편 기준\\)$",
    "replacement": "Reels posted in $1 do $2× the overall average (based on $3)"
  },
  {
    "source": "^이미지를 가져오지 못했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "Could not fetch the image. (HTTP $1)"
  },
  {
    "source": "^연동 상태를 읽지 못했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "Could not read the connection status. (HTTP $1)"
  },
  {
    "source": "^배분한 인원의 집행액이 예산을 (.+?) 넘습니다\\.$",
    "replacement": "The spend across the people you allocated is $1 over the budget."
  },
  {
    "source": "^반응이 좋았던 릴스는 평균 (.+?)초 길이였어요\\.$",
    "replacement": "The Reels that did well averaged $1 seconds long."
  },
  {
    "source": "^(.+?) (.+?)원이 결제되어 (.+?)이\\(가\\) 활성화되었습니다\\.$",
    "replacement": "$1 $2 has been paid and $3 has been activated."
  },
  {
    "source": "^연동을 시작하지 못했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "Failed to start integration. (HTTP $1)"
  },
  {
    "source": "^(.+?)번 장면의 \\[장면\\] 설명을 적어 주세요\\.$",
    "replacement": "Please write a [scene] description of scene number $1."
  },
  {
    "source": "^@(.+?) 계정의 운영자 부여를 해제하시겠어요\\?$",
    "replacement": "Remove the operator grant from the @$1 account?"
  },
  {
    "source": "^(.+?) 검토 완료 · 다음 단계로 넘어갔습니다$",
    "replacement": "$1 review finished · moved to the next stage"
  },
  {
    "source": "^웹훅 구독에 실패했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "The webhook subscription failed. (HTTP $1)"
  },
  {
    "source": "^'(.+?)' 캠페인을 이 목록에서 삭제합니다\\.$",
    "replacement": "This removes the '$1' campaign from this list."
  },
  {
    "source": "^업로드된 게시물 (.+?)건 전부 집계됐습니다\\.(.+?)$",
    "replacement": "All $1 uploaded posts have been counted.$2"
  },
  {
    "source": "^담당자가 정한 지급일\\((.+?)\\)에 입금됩니다\\.$",
    "replacement": "It is paid on the payout date the person in charge set ($1)."
  },
  {
    "source": "^스크립트 로드 시간이 초과되었습니다: (.+?)$",
    "replacement": "The script took too long to load: $1"
  },
  {
    "source": "^카테고리가 '(.+?)'\\(으\\)로 변경되었습니다!$",
    "replacement": "Category changed to '$1'!"
  },
  {
    "source": "^완성될 나의 주소: (.+?)\\.picks\\.me$",
    "replacement": "My address to be completed: $1.picks.me"
  },
  {
    "source": "^인스타그램 연동이 (.+?)일 뒤 만료됩니다\\.$",
    "replacement": "Instagram integration expires in $1 days."
  },
  {
    "source": "^그 외 (.+?)개국이 남은 (.+?)%를 차지합니다\\.$",
    "replacement": "The other $1 countries make up the remaining $2%."
  },
  {
    "source": "^전체 등록 인플루언서 (.+?)명 기준입니다\\.$",
    "replacement": "Based on all $1 registered influencers."
  },
  {
    "source": "^진행 확정 인플루언서 (.+?)명 광고비 기준$",
    "replacement": "Based on the ad fees of the $1 confirmed influencers"
  },
  {
    "source": "^회원 목록을 불러오지 못했습니다 \\((.+?)\\)$",
    "replacement": "Could not load the member list ($1)"
  },
  {
    "source": "^파일 (.+?)이\\(가\\) 20MB를 초과합니다\\.$",
    "replacement": "File $1 exceeds 20 MB."
  },
  {
    "source": "^\"(.+?)\" 질문의 답변을 입력해 주세요\\.$",
    "replacement": "Please enter the answer for the \"$1\" question."
  },
  {
    "source": "^저장에 실패했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "Save failed. (HTTP $1)"
  },
  {
    "source": "^예약에 실패했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "The scheduling failed. (HTTP $1)"
  },
  {
    "source": "^취소에 실패했습니다\\. \\(HTTP (.+?)\\)$",
    "replacement": "The cancellation failed. (HTTP $1)"
  },
  {
    "source": "^(.+?)를 받아온 콘텐츠 (.+?)개 중 상위 (.+?)개$",
    "replacement": "Top $3 of the $2 pieces of content with $1 collected"
  },
  {
    "source": "^'(.+?)' 대화를 목록에서 삭제할까요\\?$",
    "replacement": "Delete the conversation with '$1' from the list?"
  },
  {
    "source": "^마감일을 골라 주세요 · 시작일 (.+?)$",
    "replacement": "Please select a due date · Start date $1"
  },
  {
    "source": "^스크립트를 불러올 수 없습니다: (.+?)$",
    "replacement": "Could not load the script: $1"
  },
  {
    "source": "^'(.+?)' 카테고리가 추가되었습니다!$",
    "replacement": "'$1' category has been added!"
  },
  {
    "source": "^'(.+?)' 카테고리가 삭제되었습니다!$",
    "replacement": "The '$1' category has been deleted!"
  },
  {
    "source": "^점선은 지난달 조회수\\((.+?)\\)입니다\\.$",
    "replacement": "The dotted line is last month's views ($1)."
  },
  {
    "source": "^@(.+?) 을 태그한 인플루언서 콘텐츠$",
    "replacement": "Influencer content tagging @$1"
  },
  {
    "source": "^선택한 (.+?)명의 협업을 시작합니다\\.$",
    "replacement": "Starting the collab for the $1 you selected."
  },
  {
    "source": "^(.+?) 상위 릴스 (.+?)편의 공통점입니다\\.$",
    "replacement": "What the top $2 Reels by $1 have in common."
  },
  {
    "source": "^파일 (.+?) 업로드에 실패했습니다\\.$",
    "replacement": "Failed to upload file $1."
  },
  {
    "source": "^(.+?)개의 자동화가 실행 중이에요\\.$",
    "replacement": "$1 automations running."
  },
  {
    "source": "^캠페인 (.+?)건 · 최근 30일 \\+(.+?)$",
    "replacement": "Campaign $1 cases · Last 30 days +$2"
  },
  {
    "source": "^(.+?)을 1명 이상 입력해 주세요\\.$",
    "replacement": "Please enter at least one $1."
  },
  {
    "source": "^AI 기획안 초안 · 장면 (.+?)개$",
    "replacement": "AI plan draft · $1 scenes"
  },
  {
    "source": "^· 브랜드 피드백 (.+?)건 확인 중$",
    "replacement": "· checking $1 pieces of brand feedback"
  },
  {
    "source": "^장면 (.+?)의 설명을 적어 주세요\\.$",
    "replacement": "Please write the description for scene $1."
  },
  {
    "source": "^그중 (.+?)편이 (.+?)요일에 올라갔어요\\.$",
    "replacement": "$1 of them went up on a $2."
  },
  {
    "source": "^캠페인 \\((.+?)/campaigns\\)$",
    "replacement": "Campaigns ($1/campaigns)"
  },
  {
    "source": "^커머스 판매 수수료 · 확정 (.+?)$",
    "replacement": "Commerce sales commission · confirmed $1"
  },
  {
    "source": "^(.+?) 정산을 완료로 처리했습니다\\.$",
    "replacement": "$1's settlement has been marked as complete."
  },
  {
    "source": "^@(.+?) 권한을 다시 주었습니다\\.$",
    "replacement": "@$1 permission was granted again."
  },
  {
    "source": "^@(.+?) 에게 제안을 보냈습니다\\.$",
    "replacement": "@$1."
  },
  {
    "source": "^확정 협업 (.+?)명 · 업로드 (.+?)건$",
    "replacement": "Confirmed collaboration $1 people · Uploads $2"
  },
  {
    "source": "^희망 최소 조회수: (.+?)회 이상$",
    "replacement": "Minimum number of views desired: $1 or more"
  },
  {
    "source": "^좋아요 수가 공개된 (.+?)개 기준$",
    "replacement": "Based on the $1 with public like counts"
  },
  {
    "source": "^이번 달\\((.+?)\\) vs 지난달\\((.+?)\\)$",
    "replacement": "This month ($1) vs last month ($2)"
  },
  {
    "source": "^업로드에 실패했습니다\\. \\((.+?)\\)$",
    "replacement": "The upload failed. ($1)"
  },
  {
    "source": "^(.+?) 결제로 (.+?)이 충전되었습니다\\.$",
    "replacement": "$2 has been charged with payment of $1."
  },
  {
    "source": "^(.+?) (.+?)명만큼 수락하시면 됩니다\\.$",
    "replacement": "You can accept $1 $2 people."
  },
  {
    "source": "^테스트 데이터 표시중 \\((.+?)\\)$",
    "replacement": "Displaying test data ($1)"
  },
  {
    "source": "^'(.+?)' 캠페인을 삭제합니다\\.$",
    "replacement": "Delete the '$1' campaign."
  },
  {
    "source": "^@(.+?) 님을 수락하시겠습니까\\?$",
    "replacement": "Do you want to accept @$1?"
  },
  {
    "source": "^CPV (.+?)원으로 표시됩니다\\.$",
    "replacement": "CPV is displayed as $1 won."
  },
  {
    "source": "^· 협업 (.+?)명 · 업로드 (.+?)건$",
    "replacement": "· Collaboration $1 people · Upload $2"
  },
  {
    "source": "^수락 (.+?)건 중 단가 확정 (.+?)건$",
    "replacement": "Out of $1 accepted, unit price confirmed $2"
  },
  {
    "source": "^(.+?)원 결제하고 자동결제 시작$",
    "replacement": "Pay KRW $1 and start automatic payments"
  },
  {
    "source": "^카카오가 오류를 돌려줌\\((.+?)\\)$",
    "replacement": "Kakao returned an error ($1)"
  },
  {
    "source": "^게시 시간은 주로 (.+?)였어요\\.$",
    "replacement": "They were mostly posted in $1."
  },
  {
    "source": "^(.+?) 접수를 취소하시겠습니까\\?$",
    "replacement": "$1 Are you sure you want to cancel your application?"
  },
  {
    "source": "^승인 완료\\. 정산 (.+?) 예약$",
    "replacement": "Approved. Settlement $1 Reservation"
  },
  {
    "source": "^(.+?)에게 메시지 보내기\\.\\.\\.$",
    "replacement": "Send message to $1..."
  },
  {
    "source": "^테스트 계정 표시중 \\((.+?)\\)$",
    "replacement": "Displaying test account ($1)"
  },
  {
    "source": "^@(.+?) 권한을 해제했습니다\\.$",
    "replacement": "@$1 permission has been revoked."
  },
  {
    "source": "^(.+?)명을 명단에 올렸습니다\\.(.+?)$",
    "replacement": "$1 people were added to the list.$2"
  },
  {
    "source": "^집행 (.+?) ÷ 집계된 조회수$",
    "replacement": "Execution $1 ÷ Aggregated views"
  },
  {
    "source": "^제안 발송 (.+?)건 응답 대기$",
    "replacement": "Send proposal Waiting for $1 response"
  },
  {
    "source": "^코드는 (.+?)자리 숫자입니다\\.$",
    "replacement": "The code is $1 digits."
  },
  {
    "source": "^원하는 (.+?)을 적어 주세요\\.$",
    "replacement": "Please write the $1 you want."
  },
  {
    "source": "^(.+?) 협업 기록이 없습니다\\.$",
    "replacement": "$1 There are no collaboration records."
  },
  {
    "source": "^(.+?) 접수가 취소되었습니다\\.$",
    "replacement": "$1 Your application has been cancelled."
  },
  {
    "source": "^(.+?)일 집행 기준 하루 약 (.+?)$",
    "replacement": "About $2 a day over $1 days"
  },
  {
    "source": "^(.+?) 업로드에 실패했습니다\\.$",
    "replacement": "Failed to upload $1."
  },
  {
    "source": "^전환 (.+?)건 · 전환 가치 (.+?)$",
    "replacement": "$1 conversions · conversion value $2"
  },
  {
    "source": "^\\(단가 미입력 (.+?)건 제외\\)$",
    "replacement": "(excluding $1 cases without unit price input)"
  },
  {
    "source": "^빌링키 발급 실패 \\((.+?)\\)$",
    "replacement": "Billing key issuance failed ($1)"
  },
  {
    "source": "^@(.+?) 계정에 (.+?)하시겠어요\\?$",
    "replacement": "Would you like to $2 to account @$1?"
  },
  {
    "source": "^업로드 (.+?)건 중 (.+?)건 집계$",
    "replacement": "Counting $2 out of $1 uploads"
  },
  {
    "source": "^(.+?)으로 클로드 플랜 시작$",
    "replacement": "Start Clod Plan with $1"
  },
  {
    "source": "^테스트 데이터 (.+?)건 숨김$",
    "replacement": "Hide test data $1"
  },
  {
    "source": "^@(.+?) 이름으로 전송됩니다$",
    "replacement": "@$1"
  },
  {
    "source": "^클로드 크레딧 충전 (.+?)원$",
    "replacement": "Claude credit recharge $1 won"
  },
  {
    "source": "^조회수가 있는 (.+?)개 기준$",
    "replacement": "Based on the $1 with views"
  },
  {
    "source": "^마감된 캠페인 (.+?)건 보기$",
    "replacement": "View $1 closed campaigns"
  },
  {
    "source": "^AI 본문 초안 · (.+?)자$",
    "replacement": "AI caption draft · $1 characters"
  },
  {
    "source": "^최근 릴스 · 숏폼 (.+?)편$",
    "replacement": "Latest Reels and short-form · $1"
  },
  {
    "source": "^· 확정 지급액 합계 (.+?)$",
    "replacement": "· Total confirmed payment amount $1"
  },
  {
    "source": "^국세청 확인 완료 · (.+?)$",
    "replacement": "National Tax Service verification completed · $1"
  },
  {
    "source": "^업로드 확인 완료 · (.+?)$",
    "replacement": "Upload confirmed · $1"
  },
  {
    "source": "^(.+?) 회원만 목록에서 보기$",
    "replacement": "Show only $1 members in the list"
  },
  {
    "source": "^\\(이미 있던 (.+?)명 제외\\)$",
    "replacement": "(excluding $1 who already existed)"
  },
  {
    "source": "^픽스폴리오 (.+?) 정기결제$",
    "replacement": "Pixfolio $1 Regular payment"
  },
  {
    "source": "^(.+?)에 포함되어 있습니다$",
    "replacement": "$1"
  },
  {
    "source": "^단가 미입력 (.+?)건 제외$",
    "replacement": "Excluding $1 cases without unit price input"
  },
  {
    "source": "^테스트 계정 (.+?)개 숨김$",
    "replacement": "Test account $1 hidden"
  },
  {
    "source": "^@(.+?) 계정의 릴스 성과$",
    "replacement": "Reels performance for @$1"
  },
  {
    "source": "^· 금액 조율 중 (.+?)명$",
    "replacement": "· $1 with the amount still being worked out"
  },
  {
    "source": "^현재 기획안 (.+?)장면 (.+?)개$",
    "replacement": "Current plan $1$2 scenes"
  },
  {
    "source": "^· 미반영 피드백 (.+?)건$",
    "replacement": "· $1 pieces of feedback not applied"
  },
  {
    "source": "^로컬에만 저장됨 — (.+)$",
    "replacement": "Saved locally only — $1"
  },
  {
    "source": "^로컬에만 저장됨 — (.+?)$",
    "replacement": "Saved locally only — $1"
  },
  {
    "source": "^(.+?) 기준 \\(UTC\\) ·$",
    "replacement": "$1 (UTC) ·"
  },
  {
    "source": "^(.+?)% \\(담당자 전달용\\)$",
    "replacement": "$1% (For delivery to person in charge)"
  },
  {
    "source": "^· 단가 미입력 (.+?)건$",
    "replacement": "· Unit price not entered $1 cases"
  },
  {
    "source": "^최근 릴스 (.+?)개 기준$",
    "replacement": "Based on $1 recent releases"
  },
  {
    "source": "^· (.+?) 계정으로 집행$",
    "replacement": "· Running on the $1 account"
  },
  {
    "source": "^· (.+?)명 금액 미확정$",
    "replacement": "· $1 amounts not confirmed"
  },
  {
    "source": "^(.+?)으로 기획안에 반영$",
    "replacement": "Apply $1 to the plan"
  },
  {
    "source": "^가이드 파일 (.+?)개 ·$",
    "replacement": "$1 guide files ·"
  },
  {
    "source": "^피드백 (.+?)개 저장하기$",
    "replacement": "Save $1 pieces of feedback"
  },
  {
    "source": "^선택한 (.+?)명 진행하기$",
    "replacement": "Start the $1 you selected"
  },
  {
    "source": "^토큰 교환 실패\\((.+?)\\)$",
    "replacement": "Token exchange failed ($1)"
  },
  {
    "source": "^제시가 (.+?) · 지급 (.+?)$",
    "replacement": "Present price $1 · Payment $2"
  },
  {
    "source": "^희망 인플루언서: (.+?)$",
    "replacement": "Hopeful Influencer: $1"
  },
  {
    "source": "^(.+?) (.+?)명의 진행 기록은$",
    "replacement": "The progress records of $2 $1"
  },
  {
    "source": "^(.+?) \\(직접 적은 값\\)$",
    "replacement": "$1 (entered manually)"
  },
  {
    "source": "^전체 리스트 \\((.+?)\\)$",
    "replacement": "Full list ($1)"
  },
  {
    "source": "^(.+?)명 더 배분 가능$",
    "replacement": "$1 more people can be distributed"
  },
  {
    "source": "^배송지_(.+?)건\\.csv$",
    "replacement": "shipping-addresses_$1.csv"
  },
  {
    "source": "^(.+?)원으로 구독 시작$",
    "replacement": "Start the subscription at KRW $1"
  },
  {
    "source": "^(.+?)으로 본문에 반영$",
    "replacement": "Apply $1 to the caption"
  },
  {
    "source": "^(.+?)을 복사했습니다\\.$",
    "replacement": "$1 has been copied."
  },
  {
    "source": "^(.+?) 제안이 없습니다$",
    "replacement": "$1 There are no suggestions"
  },
  {
    "source": "^(.+?) · (.+?)일 지났어요$",
    "replacement": "$1 · $2 days have passed"
  },
  {
    "source": "^채팅 모더레이션 (.+?)$",
    "replacement": "Chat Moderation $1"
  },
  {
    "source": "^(.+?) 에 의견 남기기$",
    "replacement": "$1"
  },
  {
    "source": "^채널 카테고리: (.+?)$",
    "replacement": "Channel Category: $1"
  },
  {
    "source": "^희망 게시 (.+?) ~ (.+?)$",
    "replacement": "Target posting $1 – $2"
  },
  {
    "source": "^이번 달 조회수 (.+?)$",
    "replacement": "Views this month $1"
  },
  {
    "source": "^브랜드 계정\\(@(.+?)\\)$",
    "replacement": "Brand account (@$1)"
  },
  {
    "source": "^존재 \\(길이: (.+?)\\)$",
    "replacement": "Existence (length: $1)"
  },
  {
    "source": "^\\(인플루언서 (.+?)명\\)$",
    "replacement": "($1 influencers)"
  },
  {
    "source": "^결제 실패 \\((.+?)\\)$",
    "replacement": "Payment failed ($1)"
  },
  {
    "source": "^현재 협업: #(.+?)$",
    "replacement": "Current Collaboration: #$1"
  },
  {
    "source": "^(.+?)님의 픽스폴리오$",
    "replacement": "$1’s pickfolio"
  },
  {
    "source": "^(.+?)자리 코드 입력$",
    "replacement": "Enter the $1-digit code"
  },
  {
    "source": "^전체 선택 \\((.+?)\\)$",
    "replacement": "Select all ($1)"
  },
  {
    "source": "^· 업데이트: (.+?)$",
    "replacement": "· Updated: $1"
  },
  {
    "source": "^게시물 ID: (.+?)$",
    "replacement": "Post ID: $1"
  },
  {
    "source": "^초기화 실패: (.+?)$",
    "replacement": "Initialization failed: $1"
  },
  {
    "source": "^업로드 채널: (.+?)$",
    "replacement": "Upload Channel: $1"
  },
  {
    "source": "^선호 스타일: (.+?)$",
    "replacement": "Preferred Style: $1"
  },
  {
    "source": "^커머스 수수료 (.+?)(.+?)$",
    "replacement": "Commerce commission $1$2"
  },
  {
    "source": "^(.+?) 건이 없습니다$",
    "replacement": "There are no $1 items"
  },
  {
    "source": "^· 실제 집행 (.+?)$",
    "replacement": "· actually spent $1"
  },
  {
    "source": "^(.+?)급 · 팔로워 (.+?)$",
    "replacement": "$1 tier · $2 followers"
  },
  {
    "source": "^확인 완료 · (.+?)$",
    "replacement": "Confirmed · $1"
  },
  {
    "source": "^지급 완료 · (.+?)$",
    "replacement": "Paid · $1"
  },
  {
    "source": "^(.+?) 검토 후 진행$",
    "replacement": "Proceed after the $1 review"
  },
  {
    "source": "^· 지급 예정 (.+?)$",
    "replacement": "· payout due $1"
  },
  {
    "source": "^장면 (.+?) 설명: (.+?)$",
    "replacement": "Scene $1 description: $2"
  },
  {
    "source": "^\\[(.+?)\\] (.+?) 캠페인$",
    "replacement": "[$1] $2 Campaign"
  },
  {
    "source": "^최근 7일 \\+(.+?)$",
    "replacement": "Last 7 days +$1"
  },
  {
    "source": "^· CPV (.+?)원$",
    "replacement": "· CPV $1 won"
  },
  {
    "source": "^📎 파일 (.+?)개$",
    "replacement": "📎 $1 files"
  },
  {
    "source": "^마감임박 D-(.+?)$",
    "replacement": "Deadline imminent D-$1"
  },
  {
    "source": "^· 협의중 (.+?)건$",
    "replacement": "· Negotiated $1 cases"
  },
  {
    "source": "^· 인스타 @(.+?)$",
    "replacement": "· Instagram @$1"
  },
  {
    "source": "^클릭 대비 (.+?)%$",
    "replacement": "$1% of clicks"
  },
  {
    "source": "^전체 (.+?)개 보기$",
    "replacement": "View all $1"
  },
  {
    "source": "^최근 (.+?)일 동안$",
    "replacement": "Over the last $1 days"
  },
  {
    "source": "^최근 (.+?)일 증감$",
    "replacement": "Change over the last $1 days"
  },
  {
    "source": "^동급 (.+?)명 평균$",
    "replacement": "Average of $1 peers"
  },
  {
    "source": "^정산 금액 (.+?)원$",
    "replacement": "Settlement amount KRW $1"
  },
  {
    "source": "^픽스폴리오 @(.+?)$",
    "replacement": "PICKSfolio @$1"
  },
  {
    "source": "^최근 릴스 (.+?)편$",
    "replacement": "Latest $1 Reels"
  },
  {
    "source": "^릴스 (.+?)편 기준$",
    "replacement": "Based on $1 Reels"
  },
  {
    "source": "^(.+?) · (.+?)일 경과$",
    "replacement": "$1 · $2 days passed"
  },
  {
    "source": "^(.+?) (.+?)명의 기록과$",
    "replacement": "$1 $2 records and"
  },
  {
    "source": "^(.+?) · 오늘까지$",
    "replacement": "$1 · Until today"
  },
  {
    "source": "^(.+?) · (.+?)일 남음$",
    "replacement": "$1 · $2 days left"
  },
  {
    "source": "^최근 동기화 (.+?)$",
    "replacement": "Recent Sync $1"
  },
  {
    "source": "^현재 상품: (.+?)$",
    "replacement": "Current product: $1"
  },
  {
    "source": "^평균 팔로워 (.+?)$",
    "replacement": "Average Follower $1"
  },
  {
    "source": "^· 안 읽음 (.+?)$",
    "replacement": "· Not read $1"
  },
  {
    "source": "^진행 방식: (.+?)$",
    "replacement": "Procedure: $1"
  },
  {
    "source": "^모집 구성: (.+?)$",
    "replacement": "Recruitment composition: $1"
  },
  {
    "source": "^제외 조건: (.+?)$",
    "replacement": "Exclusion condition: $1"
  },
  {
    "source": "^지급 예정일 (.+?)$",
    "replacement": "Payout due $1"
  },
  {
    "source": "^지난달 대비 (.+?)(.+?)(.+?)$",
    "replacement": "$1$2$3 vs last month"
  },
  {
    "source": "^· 총 예산 (.+?)$",
    "replacement": "· total budget $1"
  },
  {
    "source": "^키워드 답장 (.+?)$",
    "replacement": "Keyword reply $1"
  },
  {
    "source": "^(.+?) 배경색 선택$",
    "replacement": "Pick the background color for $1"
  },
  {
    "source": "^(.+?) 글자색 선택$",
    "replacement": "Pick the text color for $1"
  },
  {
    "source": "^(.+?) 색 되돌리기$",
    "replacement": "Reset the $1 color"
  },
  {
    "source": "^(.+?) 단가 낮은순$",
    "replacement": "Lowest $1 rate"
  },
  {
    "source": "^(.+?) 단가 미등록$",
    "replacement": "No $1 rate registered"
  },
  {
    "source": "^(.+?) (.+?)명\\(1인 (.+?)\\)$",
    "replacement": "$1 $2 people (1 person $3)"
  },
  {
    "source": "^(.+?)월 (.+?)일 \\((.+?)\\)$",
    "replacement": "$1month $2day ($3)"
  },
  {
    "source": "^@(.+?) 총 정산$",
    "replacement": "@$1 Total settlement"
  },
  {
    "source": "^/ 예정 (.+?)명$",
    "replacement": "/ Planned $1 people"
  },
  {
    "source": "^· 협찬 (.+?)명$",
    "replacement": "· Sponsored by $1 people"
  },
  {
    "source": "^· 동향 (.+?)(.+?)%$",
    "replacement": "· Trend $1$2%"
  },
  {
    "source": "^← 이전 (.+?)회$",
    "replacement": "← Previous $1 times"
  },
  {
    "source": "^· 담당 @(.+?)$",
    "replacement": "· Responsible @$1"
  },
  {
    "source": "^(.+?)일 지났어요$",
    "replacement": "$1 days have passed"
  },
  {
    "source": "^(.+?)원 결제하기$",
    "replacement": "Pay KRW $1"
  },
  {
    "source": "^(.+?)번째 안 ·$",
    "replacement": "draft $1 ·"
  },
  {
    "source": "^(.+?) 단계가 (.+?)\\.$",
    "replacement": "$1 step is $2."
  },
  {
    "source": "^최근 릴스 (.+?)$",
    "replacement": "Recent releases $1"
  },
  {
    "source": "^(.+?)(.+?) · (.+?) 확인$",
    "replacement": "$1$2 · $3 Confirm"
  },
  {
    "source": "^· 연락처 (.+?)$",
    "replacement": "· Contact $1"
  },
  {
    "source": "^요청사항: (.+?)$",
    "replacement": "Request: $1"
  },
  {
    "source": "^광고 코드 (.+?)$",
    "replacement": "Ad code $1"
  },
  {
    "source": "^전환 가치 (.+?)$",
    "replacement": "Conversion value $1"
  },
  {
    "source": "^예산 (.+?) 중 (.+?)$",
    "replacement": "$2 of a $1 budget"
  },
  {
    "source": "^· 마감: (.+?)$",
    "replacement": "· due: $1"
  },
  {
    "source": "^(.+?) 버튼 이름$",
    "replacement": "$1 button label"
  },
  {
    "source": "^(.+?) 색 고르기$",
    "replacement": "Pick the $1 color"
  },
  {
    "source": "^지급 예정 (.+?)$",
    "replacement": "Payout due $1"
  },
  {
    "source": "^· 커머스 (.+?)$",
    "replacement": "· commerce $1"
  },
  {
    "source": "^(.+?) 단가 있음$",
    "replacement": "Has a $1 rate"
  },
  {
    "source": "^등록 단가 (.+?)$",
    "replacement": "Registered rate $1"
  },
  {
    "source": "^(.+?) 입금 확인$",
    "replacement": "$1 deposit confirmed"
  },
  {
    "source": "^(.+?) 등록 필요$",
    "replacement": "$1 needs to be uploaded"
  },
  {
    "source": "^(.+?) 검토 필요$",
    "replacement": "$1 needs review"
  },
  {
    "source": "^나레이션: (.+?)$",
    "replacement": "Narration: $1"
  },
  {
    "source": "^\\(길이: (.+?)\\)$",
    "replacement": "(Length: $1)"
  },
  {
    "source": "^\\(담당 @(.+?)\\)$",
    "replacement": "(In charge @$1)"
  },
  {
    "source": "^\\(현재 (.+?)명\\)$",
    "replacement": "(currently $1)"
  },
  {
    "source": "^· (.+?) 까지$",
    "replacement": "· $1"
  },
  {
    "source": "^(.+?)명 신청중$",
    "replacement": "$1 people applying"
  },
  {
    "source": "^게시물 (.+?)개$",
    "replacement": "$1 posts"
  },
  {
    "source": "^키워드 (.+?)개$",
    "replacement": "Keyword $1"
  },
  {
    "source": "^(.+?)의 페이지$",
    "replacement": "Page of $1"
  },
  {
    "source": "^· (.+?) 차례$",
    "replacement": "· $1 Table of Contents"
  },
  {
    "source": "^마진율 (.+?)%$",
    "replacement": "Margin rate $1%"
  },
  {
    "source": "^(.+?)개 연령대$",
    "replacement": "$1 age bands"
  },
  {
    "source": "^(.+?)일 순증감$",
    "replacement": "Net change over $1 days"
  },
  {
    "source": "^· (.+?) 연동$",
    "replacement": "· connected $1"
  },
  {
    "source": "^(\\d+)년 (\\d+)월 (\\d+)일$",
    "replacement": "$2/$3/$1"
  },
  {
    "source": "^(.+?) · 오늘$",
    "replacement": "$1 · Today"
  },
  {
    "source": "^(.+?) 진행 중(.+?)$",
    "replacement": "$1 In progress$2"
  },
  {
    "source": "^· 예산 (.+?)$",
    "replacement": "· Budget $1"
  },
  {
    "source": "^마감임박 (.+?)$",
    "replacement": "Deadline imminent $1"
  },
  {
    "source": "^· 수락 (.+?)$",
    "replacement": "· Accept $1"
  },
  {
    "source": "^· 마감 (.+?)$",
    "replacement": "· Deadline $1"
  },
  {
    "source": "^· 배정 (.+?)$",
    "replacement": "· Assignment $1"
  },
  {
    "source": "^· 해제 (.+?)$",
    "replacement": "· Clear $1"
  },
  {
    "source": "^· 추천 (.+?)$",
    "replacement": "· Recommended: $1"
  },
  {
    "source": "^첫 기록 (.+?)$",
    "replacement": "First record $1"
  },
  {
    "source": "^· 확인 (.+?)$",
    "replacement": "· confirmed $1"
  },
  {
    "source": "^오늘 \\+(.+?)$",
    "replacement": "Today +$1"
  },
  {
    "source": "^(.+?)시간 전$",
    "replacement": "$1 hours ago"
  },
  {
    "source": "^시딩 (.+?)건$",
    "replacement": "Seeding $1 cases"
  },
  {
    "source": "^(.+?)시간 (.+?)분$",
    "replacement": "$1hours $2minutes"
  },
  {
    "source": "^(.+?)건 진행$",
    "replacement": "$1 in progress"
  },
  {
    "source": "^(.+?)번 장면$",
    "replacement": "$1 scene"
  },
  {
    "source": "^(.+?)개 지역$",
    "replacement": "$1 regions"
  },
  {
    "source": "^(.+?)일 지남$",
    "replacement": "$1 days past"
  },
  {
    "source": "^클릭 (.+?)회$",
    "replacement": "$1 clicks"
  },
  {
    "source": "^· (.+?)까지$",
    "replacement": "· until $1"
  },
  {
    "source": "^(.+?)일 남음$",
    "replacement": "$1 days left"
  },
  {
    "source": "^(.+?)일 동안$",
    "replacement": "over $1 days"
  },
  {
    "source": "^상위 (.+?)%$",
    "replacement": "Top $1%"
  },
  {
    "source": "^주목 (.+?)명$",
    "replacement": "$1 featured"
  },
  {
    "source": "^([\\d,]+)명 선택$",
    "replacement": "$1 selected"
  },
  {
    "source": "^팔로워 (.+?)$",
    "replacement": "Followers $1"
  },
  {
    "source": "^(.+?) 크레딧$",
    "replacement": "$1 Credits"
  },
  {
    "source": "^(.+?) 외 (.+?)건$",
    "replacement": "$1 and $2 items"
  },
  {
    "source": "^(.+?)점 · (.+?)$",
    "replacement": "$1 points · $2"
  },
  {
    "source": "^게시물 (.+?)$",
    "replacement": "Post $1"
  },
  {
    "source": "^(.+?) 캠페인$",
    "replacement": "$1 Campaign"
  },
  {
    "source": "^배경색 (.+?)$",
    "replacement": "Background color $1"
  },
  {
    "source": "^([\\d,]+)(.+?) 조회됨$",
    "replacement": "$1$2 looked up"
  },
  {
    "source": "^(.+?) 업로드$",
    "replacement": "uploaded $1"
  },
  {
    "source": "^(.+?) 프로필$",
    "replacement": "$1 profile"
  },
  {
    "source": "^자막: (.+?)$",
    "replacement": "Subtitles: $1"
  },
  {
    "source": "^(.+?)분 전$",
    "replacement": "$1 minutes ago"
  },
  {
    "source": "^(.+?)일 전$",
    "replacement": "$1 days ago"
  },
  {
    "source": "^(.+?): (.+?)명$",
    "replacement": "$1: $2 people"
  },
  {
    "source": "^(\\d+)월 (\\d+)일$",
    "replacement": "$1/$2"
  },
  {
    "source": "^총 ([\\d,]+)편$",
    "replacement": "$1 in total"
  },
  {
    "source": "^· (.+?)회$",
    "replacement": "· $1 times"
  },
  {
    "source": "^(.+?) 기준$",
    "replacement": "As of $1"
  },
  {
    "source": "^(.+?) 까지$",
    "replacement": "Until $1"
  },
  {
    "source": "^조회 (.+?)$",
    "replacement": "Views $1"
  },
  {
    "source": "^(.+?) 갱신$",
    "replacement": "$1 Update"
  },
  {
    "source": "^첨부 (.+?)$",
    "replacement": "Attachment $1"
  },
  {
    "source": "^예산 (.+?)$",
    "replacement": "Budget $1"
  },
  {
    "source": "^명단 (.+?)$",
    "replacement": "List $1"
  },
  {
    "source": "^광고 (.+?)$",
    "replacement": "Ad $1"
  },
  {
    "source": "^숏폼 (.+?)$",
    "replacement": "Short form $1"
  },
  {
    "source": "^(.+?) 부여$",
    "replacement": "Grant $1"
  },
  {
    "source": "^대기 (.+?)$",
    "replacement": "Wait $1"
  },
  {
    "source": "^댓글 (.+?)$",
    "replacement": "Comment $1"
  },
  {
    "source": "^올림 (.+?)$",
    "replacement": "Uploaded $1"
  },
  {
    "source": "^마감 (.+?)$",
    "replacement": "Due $1"
  },
  {
    "source": "^(.+?) 단계$",
    "replacement": "$1 stage"
  },
  {
    "source": "^(.+?) 채널$",
    "replacement": "$1 channel"
  },
  {
    "source": "^(.+?) 단가$",
    "replacement": "$1 rate"
  },
  {
    "source": "^제출 (.+?)$",
    "replacement": "Submitted $1"
  },
  {
    "source": "^완료 (.+?)$",
    "replacement": "$1 completed"
  },
  {
    "source": "^(.+?)/(.+?)명$",
    "replacement": "$1/$2 people"
  },
  {
    "source": "^(.+?)시간$",
    "replacement": "$1 hours"
  },
  {
    "source": "^([\\d,]+)개국$",
    "replacement": "$1 countries"
  },
  {
    "source": "^(.+?)부터$",
    "replacement": "From $1"
  },
  {
    "source": "^(.+?) (.+?)명$",
    "replacement": "$1 $2 people"
  },
  {
    "source": "^값 (.+?)$",
    "replacement": "Value $1"
  },
  {
    "source": "^(.+?)회$",
    "replacement": "$1 times"
  },
  {
    "source": "^(.+?)원$",
    "replacement": "$1 KRW"
  },
  {
    "source": "^(.+?)명$",
    "replacement": "$1 people"
  },
  {
    "source": "^(.+?)억$",
    "replacement": "$1 hundred million"
  },
  {
    "source": "^(.+?)만$",
    "replacement": "$1 ten-thousand"
  },
  {
    "source": "^(.+?)천$",
    "replacement": "$1 thousand"
  },
  {
    "source": "^(.+?)개$",
    "replacement": "$1"
  },
  {
    "source": "^(.+?)분$",
    "replacement": "$1 minutes"
  },
  {
    "source": "^(.+?)건$",
    "replacement": "$1 items"
  },
  {
    "source": "^(.+?)(.+?)원$",
    "replacement": "$1$2 KRW"
  },
  {
    "source": "^([\\d,]+)편$",
    "replacement": "$1 reels"
  },
] as const;
