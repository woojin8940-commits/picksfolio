-- 협업 대화 목록에서 "이 대화 삭제".
--
-- 목록은 계정 하나에 계속 쌓인다. 끝난 협업, 답장 없이 흐지부지된 제안, 테스트로
-- 열린 방까지 남아 있어서 지금 챙겨야 할 대화가 아래로 밀린다. 그런데 대화방 자체를
-- 지울 수는 없다 — 방은 두 사람(또는 담당자까지 셋)이 함께 쓰는 기록이고, 정산이나
-- 분쟁이 생기면 근거가 된다. 한쪽이 지우면 상대의 대화 내역까지 사라진다.
--
-- 그래서 "누가 어느 방을 자기 목록에서 내렸는지"만 기록한다. 방과 메시지는 그대로
-- 남고, 목록을 만들 때 이 표에 있는 방을 걸러낸다.
--
-- hidden_at 을 남기는 이유는 되살릴 시점을 판단해야 하기 때문이다. 목록에서 내린 뒤
-- 상대가 새 메시지를 보내면 그 대화는 다시 보여야 한다 — 안 그러면 한 번 삭제한
-- 업체의 연락을 영구히 놓친다. 삭제 시각보다 나중에 온 메시지가 있으면 목록에
-- 되돌리고 이 행을 지운다(목록 조회 쪽에서 처리).
CREATE TABLE IF NOT EXISTS timeline_hidden (
    proposal_id TEXT NOT NULL,
    username TEXT NOT NULL,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (proposal_id, username)
);

CREATE INDEX IF NOT EXISTS idx_timeline_hidden_username ON timeline_hidden(username);
