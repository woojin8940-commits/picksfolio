import React from 'react';
import {
  CheckCircle2,
  Clock3,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
  XCircle,
} from 'lucide-react';
import { MetaAdAccount, MetaAdDiagnosis, MetaPermission } from '../utils/adAccounts';

/**
 * 메타 계정 연동 안내 — 광고 화면이 연동 전에 보여 주는 전부.
 *
 * 연동이 없으면 광고 화면에는 붙일 데이터가 없다. 그래서 요약·목록을 비워 둔 채로
 * 그리지 않고 이 카드로 화면을 바꾼다 — 숫자가 있는 자리에 빈 값이 서 있으면
 * 브랜드는 "광고가 없다"로 읽는다. 실제로는 "아직 연결되지 않았다"다.
 *
 * 권한 체크리스트를 여기 그대로 적는 이유는, 연동을 눌러도 광고 데이터가 바로
 * 오지 않기 때문이다. 인스타그램 인사이트만 승인됐고 광고 쪽 세 권한은 심사 중이라,
 * 그 사실을 연동 버튼과 같은 화면에 두지 않으면 연동한 뒤 숫자가 예시인 것을
 * 연동 실패로 읽게 된다. 연동을 마치면 이 목록의 상태는 동의 화면에서 실제로
 * 승인·거부된 결과로 덮인다(추측이 아니라 `/me/permissions` 응답이다).
 *
 * 연동한 뒤에도 같은 카드를 '연동 설정' 으로 다시 연다 — 계정을 바꾸거나 다시
 * 연동하는 일은 연동을 처음 붙이는 일과 같은 화면에서 하는 편이 찾기 쉽다.
 */

interface MetaAdConnectCardProps {
  connected: boolean;
  connectedAt: string | null;
  metaUserName: string | null;
  /** 연동으로 쓸 수 있게 된 광고 계정. 연동 전에는 빈 목록이다. */
  accounts: MetaAdAccount[];
  selectedAccountId: string | null;
  /** 권한 목록. 연동 후에는 실제 동의 결과가 반영된 상태로 들어온다. */
  permissions: MetaPermission[];
  /** 연동 진단 결과. 무엇이 되고 무엇이 막혔는지를 카드 아래에 적는다. */
  diagnosis?: MetaAdDiagnosis | null;
  /** 서버에서 연동 상태를 읽는 중. 연동 여부를 아직 모르는 상태다. */
  loading?: boolean;
  /** 연동 시작 중 — 곧 페이스북 로그인 대화상자로 떠난다. */
  connecting?: boolean;
  error?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectAccount: (accountId: string) => void;
  /** 계정이 골라져 있을 때만 광고 현황으로 돌아갈 수 있다. */
  onBack?: () => void;
}

const formatConnectedAt = (iso: string | null): string => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** 권한 한 줄. 승인 · 대기 · 거부 세 상태를 구분해 그린다. */
const PermissionRow: React.FC<{ permission: MetaPermission }> = ({ permission }) => {
  const approved = permission.status === 'approved';
  const declined = permission.status === 'declined';
  return (
    <li className="flex items-start gap-2.5 px-3.5 py-3">
      <span
        className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
          approved ? 'bg-emerald-50' : declined ? 'bg-rose-50' : 'bg-slate-100'
        }`}
      >
        {approved ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
        ) : declined ? (
          <XCircle className="w-3.5 h-3.5 text-rose-500" strokeWidth={3} />
        ) : (
          <Clock3 className="w-3.5 h-3.5 text-slate-400" strokeWidth={3} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-black text-slate-900">{permission.label}</span>
          {/* 심사에서 쓰는 권한 이름을 같이 적는다 — 메타 앱 설정 화면과 같은 말이어야 한다. */}
          <span className="text-[10px] font-bold text-slate-400 break-all">{permission.scope}</span>
        </div>
        <p className="text-[10px] text-slate-400 font-medium mt-0.5">{permission.purpose}</p>
      </div>
      <span
        className={`px-1.5 py-0.5 rounded text-[10px] font-black flex-shrink-0 ${
          approved
            ? 'bg-emerald-50 text-emerald-600'
            : declined
              ? 'bg-rose-50 text-rose-500'
              : 'bg-slate-100 text-slate-500'
        }`}
      >
        {approved ? '승인됨' : declined ? '거부됨' : '대기중'}
      </span>
    </li>
  );
};

/** 진단 한 줄. 그래프 호출 하나의 결과를 사람이 읽을 수 있게 적는다. */
const DiagnosisRow: React.FC<{ label: string; ok: boolean; detail: string }> = ({
  label,
  ok,
  detail,
}) => (
  <li className="flex items-start gap-2 px-3.5 py-2.5">
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${ok ? 'bg-emerald-500' : 'bg-rose-400'}`}
    />
    <div className="min-w-0 flex-1">
      <span className="text-[11px] font-black text-slate-700">{label}</span>
      <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-words">{detail}</p>
    </div>
  </li>
);

/**
 * 연동 직후 메타에 실제로 물어본 결과.
 *
 * 권한이 승인으로 찍혀 있어도 심사 전 앱에서는 데이터가 오지 않는 경우가 있다
 * (앱 관리자 계정 밖은 코드 200 으로 막힌다). 그 차이는 권한 목록만 봐서는 알 수 없어서,
 * 광고 계정 · 비즈니스 · 캠페인을 한 번씩 읽어 본 결과를 그대로 적는다.
 */
const DiagnosisBlock: React.FC<{ diagnosis: MetaAdDiagnosis }> = ({ diagnosis }) => {
  const probe = diagnosis.probes || ({} as MetaAdDiagnosis['probes']);
  const detail = (p: { ok: boolean; count?: number; error?: string }, unit: string) =>
    p?.ok ? `${p.count ?? 0}${unit} 조회됨` : p?.error || '조회하지 못했습니다.';
  return (
    <div className="mt-4">
      <p className="text-[11px] font-black text-slate-500">연동 진단 결과</p>
      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
        연동할 때 Meta에 실제로 물어본 결과입니다. 액세스 토큰은 저장하지 않습니다.
      </p>
      <ul className="mt-2 rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden bg-slate-50/50">
        <DiagnosisRow
          label="광고 계정 (me/adaccounts)"
          ok={!!probe.adaccounts?.ok}
          detail={detail(probe.adaccounts, '개')}
        />
        <DiagnosisRow
          label="비즈니스 (me/businesses)"
          ok={!!probe.businesses?.ok}
          detail={detail(probe.businesses, '개')}
        />
        <DiagnosisRow
          label={`캠페인 (${probe.campaigns?.accountId || 'act_{id}'}/campaigns)`}
          ok={!!probe.campaigns?.ok}
          detail={detail(probe.campaigns, '건')}
        />
      </ul>
      {diagnosis.declined?.length > 0 && (
        <p className="text-[10px] text-rose-500 font-bold mt-2 leading-relaxed">
          동의 화면에서 꺼진 권한이 있습니다: {diagnosis.declined.join(', ')} · '다시 연동하기'를
          누르면 그 권한을 한 번 더 물어봅니다.
        </p>
      )}
    </div>
  );
};

const MetaAdConnectCard: React.FC<MetaAdConnectCardProps> = ({
  connected,
  connectedAt,
  metaUserName,
  accounts,
  selectedAccountId,
  permissions,
  diagnosis,
  loading,
  connecting,
  error,
  onConnect,
  onDisconnect,
  onSelectAccount,
  onBack,
}) => (
  <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 md:p-7">
    {/* 연동 버튼보다 먼저 읽혀야 하는 문장이다 — 연동해도 광고 데이터는 아직 오지 않는다. */}
    <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-3">
      <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[12px] font-black text-amber-800">
          이 권한들은 심사가 끝나야 실제로 활성화됩니다
        </p>
        <p className="text-[11px] text-amber-700 font-medium mt-1 leading-relaxed">
          지금 연동하면 인스타그램 인사이트만 실제로 동작하고, 광고 지표 조회·집행은 메타 앱 심사가
          끝난 뒤부터 열립니다. 그때까지 광고 화면의 숫자는 예시 데이터입니다.
        </p>
      </div>
    </div>

    {loading && !connected ? (
      <div className="mt-5 flex items-center justify-center gap-2 py-8">
        <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
        <span className="text-[12px] font-bold text-slate-400">연동 상태 확인 중...</span>
      </div>
    ) : connected ? (
      <div className="mt-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" strokeWidth={3} />
          </span>
          <p className="text-[14px] md:text-base font-black text-slate-900">Meta 계정이 연동되었습니다</p>
        </div>
        <p className="text-[11px] text-slate-400 font-bold mt-1.5">
          {metaUserName || 'Meta 계정'}
          {connectedAt && ` · ${formatConnectedAt(connectedAt)} 연동`}
        </p>

        <div className="mt-4">
          <p className="text-[11px] font-black text-slate-500">광고 계정 선택</p>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            광고 현황과 부스팅 집행이 여기서 고른 계정을 기준으로 동작합니다.
          </p>
          {accounts.length === 0 ? (
            /*
              연동은 됐는데 광고 계정이 하나도 오지 않는 경우다. 목록이 빈 채로 서 있으면
              연동이 실패한 것으로 읽히므로, 무엇이 없는 상태인지 그 자리에 적는다.
              (권한 거부, 비즈니스 관리자에 광고 계정 없음, 심사 전 앱의 접근 제한이
              모두 이 결과로 나타난다 — 아래 진단 결과에 이유가 적힌다.)
            */
            <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <p className="text-[11px] font-black text-slate-600">
                이 Meta 계정에서 접근할 수 있는 광고 계정이 없습니다
              </p>
              <p className="text-[10px] text-slate-400 font-medium mt-1 leading-relaxed">
                광고 계정 권한이 있는 Meta 계정으로 다시 연동하거나, 비즈니스 관리자에서 이 계정에
                광고 계정 접근 권한을 준 뒤 '다시 연동하기'를 눌러 주세요.
              </p>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {accounts.map((account) => {
                const on = account.id === selectedAccountId;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => onSelectAccount(account.id)}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2.5 text-left px-3.5 py-3 rounded-2xl border transition-colors ${
                      on
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full border-[5px] flex-shrink-0 ${
                        on ? 'border-blue-600 bg-white' : 'border-slate-200 bg-white'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-black text-slate-900 truncate">
                        {account.name}
                      </span>
                      <span className="block text-[10px] text-slate-400 font-medium mt-0.5 truncate">
                        {account.businessName} · {account.id}
                        {account.currency && ` · ${account.currency}`}
                      </span>
                    </span>
                    {on && <span className="text-[10px] font-black text-blue-600 flex-shrink-0">선택됨</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {onBack && selectedAccountId && (
            <button
              type="button"
              onClick={onBack}
              className="flex-1 min-w-[140px] py-3 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 transition-colors"
            >
              광고 현황으로 돌아가기
            </button>
          )}
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="flex-1 min-w-[120px] py-3 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-black hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {connecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {connecting ? 'Meta로 이동 중...' : '다시 연동하기'}
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            className="flex-1 min-w-[120px] py-3 rounded-xl border border-slate-200 text-rose-500 text-[12px] font-black hover:bg-rose-50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Unlink className="w-3.5 h-3.5" />
            연동 해제
          </button>
        </div>
        {/* 저장한 토큰이 없으므로 해제는 이쪽 기록을 지우는 일이다. 그 범위를 적어 둔다. */}
        <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
          연동 해제는 픽스폴리오에 남은 연동 기록을 지웁니다. Meta 쪽 앱 권한까지 회수하려면
          Facebook 설정 &gt; 비즈니스 통합에서 앱을 삭제해 주세요.
        </p>
      </div>
    ) : (
      <div className="mt-5 text-center">
        <span className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
          <Link2 className="w-6 h-6 text-blue-600" />
        </span>
        <p className="text-[15px] md:text-lg font-black text-slate-900 mt-3">
          아직 Meta 계정이 연동되지 않았습니다
        </p>
        <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed max-w-md mx-auto">
          Meta 계정을 연동하면 광고 계정을 고르고, 캠페인 이력에서 고른 콘텐츠를 픽스폴리오 안에서
          바로 광고로 돌릴 수 있습니다.
        </p>
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="mt-4 w-full max-w-xs mx-auto py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {connecting ? 'Meta로 이동 중...' : 'Meta 계정 연동하기'}
        </button>
        {/* 버튼을 누르면 어디로 가는지 미리 적는다 — 페이스북 로그인 창이 뜨는 것이 정상이다. */}
        <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed max-w-xs mx-auto">
          Facebook 로그인 창이 열리고 광고 관리·광고 조회·비즈니스 관리 권한에 대한 동의를
          요청합니다.
        </p>
      </div>
    )}

    {error && (
      <p className="mt-3 text-[11px] font-bold text-rose-500 text-center leading-relaxed">{error}</p>
    )}

    <div className="mt-5">
      <p className="text-[11px] font-black text-slate-500">연동에 필요한 권한</p>
      <ul className="mt-2 rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
        {permissions.map((permission) => (
          <PermissionRow key={permission.scope} permission={permission} />
        ))}
      </ul>
    </div>

    {connected && diagnosis && <DiagnosisBlock diagnosis={diagnosis} />}
  </div>
);

export default MetaAdConnectCard;
