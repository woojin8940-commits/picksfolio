import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal, CollabRecord, Settlement } from '../types';
import { apiService } from '../services/apiService';
import { formatNumberWithCommas, stripCommas, formatKRW, todayInSeoul } from '../utils/formatters';
import UserSettlement from './UserSettlement';
import {
  CampaignCollabStatus,
  openCampaignCollab,
  toCampaignCollabStatuses,
} from '../utils/campaignCollabStatus';

interface BusinessCalendarProps {
  userName: string;
}

// 협업 내역 한 줄은 세 가지 출처에서 온다.
//  - manual     : 사용자가 직접 남긴 협업 기록. 수정·삭제 가능
//  - settlement : 정산금 항목에서 파생된 읽기 전용 항목
//  - proposal   : 정산 항목이 아직 없는 수락된 제안(과거 데이터 보정)
// 협업 내역 한 줄은 네 가지 출처에서 온다(아래 campaign 이 나중에 붙었다).
type CollabSource = 'manual' | 'settlement' | 'proposal' | 'campaign';
type CollabListItem = CollabRecord & {
  _source?: CollabSource;
  // 읽기 전용 항목 표시용. 기존 코드가 쓰던 플래그를 그대로 유지한다.
  _fromSettlement?: boolean;
  _proposalId?: string;
  /**
   * 캠페인 협업에서 온 줄. 진행사항 보드로 가는 길이 여기에만 있다.
   *
   * 이 출처가 없던 동안, 캠페인에 선정돼 촬영을 하고 있어도 협업 현황은 비어 있었다 —
   * 협업 내역에 줄이 생기는 시점이 "담당자가 일정을 확정한 뒤"였기 때문이다. 정작
   * 가이드를 받고 기획안을 내는 초반 몇 주가 통째로 빠져 있었다.
   */
  _collabId?: string;
  _campaignId?: string;
  _progress?: number;
  _todo?: string;
};

const COLLAB_CATEGORIES = ['광고', '커머스', '기타'] as const;
const COLLAB_STATUSES = [
  { value: 'scheduled', label: '예정' },
  { value: 'in_progress', label: '진행중' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
] as const;

/**
 * 로컬 날짜를 YYYY-MM-DD 로 만든다.
 *
 * `new Date().toISOString()` 은 UTC 기준이라, 한국 시간 오전 9시 이전에는 어제
 * 날짜가 나온다. 캘린더의 "오늘"과 완료 여부 판정이 하루씩 어긋나던 원인이라
 * 로컬 연·월·일을 직접 조립한다.
 */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayOnly = (value?: string) => (value || '').split('T')[0];

/**
 * 'YYYY-MM-DD' 를 로컬 자정 Date 로 만든다.
 *
 * `new Date('2026-07-15')` 는 UTC 자정으로 해석되는데, 여기에 getDate()/setDate()
 * 로 하루씩 더하면 로컬 기준(한국은 +9)과 어긋나서 같은 날이 두 번 잡히거나
 * 마지막 날이 빠지는 일이 생긴다. 그래서 연·월·일을 직접 넘겨 로컬 날짜로 만든다.
 */
const parseYmd = (value?: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayOnly(value));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const normalizeText = (v?: string) => (v || '').trim().toLowerCase();

/** 두 협업 기간이 겹치는지. 값이 비어 있으면 겹친다고 보지 않는다. */
const windowsOverlap = (aStart?: string, aEnd?: string, bStart?: string, bEnd?: string) => {
  const a1 = dayOnly(aStart);
  const b1 = dayOnly(bStart);
  if (!a1 || !b1) return false;
  const a2 = dayOnly(aEnd) || a1;
  const b2 = dayOnly(bEnd) || b1;
  return a1 <= b2 && b1 <= a2;
};


const BusinessCalendar: React.FC<BusinessCalendarProps> = ({ userName }) => {
  const [proposals, setProposals] = useState<BusinessProposal[]>([]);
  const [collabRecords, setCollabRecords] = useState<CollabRecord[]>([]);
  const [campaignCollabs, setCampaignCollabs] = useState<CampaignCollabStatus[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCollab, setEditingCollab] = useState<CollabRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'proposals' | 'collabs'>('all');
  const [jumpYear, setJumpYear] = useState('');
  const [jumpMonth, setJumpMonth] = useState('');
  // Top-level section of the 협업 현황 page: the calendar, the list of collab
  // deals (커머스/광고/기타), or the settlement (정산금) summary.
  const [topTab, setTopTab] = useState<'calendar' | 'collabs' | 'settlement'>('calendar');
  const [collabFilter, setCollabFilter] = useState<'전체' | '커머스' | '광고' | '기타'>('전체');
  // Period filter for the 협업 내역 / 정산금 views: a quick month/year preset
  // or a custom start~end date range. Empty range means "전체 기간".
  const [periodPreset, setPeriodPreset] = useState<'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'>('all');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    company_name: '',
    category: '기타' as CollabRecord['category'],
    date: '',
    end_date: '',
    fee: 0,
    status: 'scheduled' as CollabRecord['status'],
    memo: '',
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [proposalData, collabData, settlementData, campaignRes] = await Promise.all([
        apiService.getProposals(userName),
        apiService.getCollabRecords(userName),
        apiService.getSettlements(userName),
        // 캠페인 협업. 실패하면 빈 배열로 두고 나머지는 그대로 그린다 — 이 요청 하나
        // 때문에 제안·정산까지 못 보게 만들 이유가 없다.
        apiService.getCollabs('influencer').catch(() => ({ collabs: [] as any[] })),
      ]);
      setProposals(proposalData);
      setCollabRecords(collabData);
      setSettlements(settlementData);
      setCampaignCollabs(toCampaignCollabStatuses(campaignRes.collabs || [], 'influencer'));
      setLoading(false);
    };
    fetchData();
  }, [userName]);

  const handleComplete = async (proposalId: string) => {
    setUpdatingId(proposalId);
    const success = await apiService.updateProposalStatus(userName, proposalId, 'completed');
    if (success) {
      setProposals(prev =>
        prev.map(p => p.id === proposalId ? { ...p, status: 'completed', updated_at: new Date().toISOString() } : p)
      );
    }
    setUpdatingId(null);
  };

  const resetForm = () => {
    setFormData({
      title: '',
      company_name: '',
      category: '기타',
      date: selectedDate || '',
      end_date: '',
      fee: 0,
      status: 'scheduled',
      memo: '',
    });
    setEditingCollab(null);
  };

  const openAddForm = () => {
    resetForm();
    setFormData(prev => ({ ...prev, date: selectedDate || todayInSeoul() }));
    setShowAddForm(true);
  };

  const openEditForm = (collab: CollabRecord) => {
    setEditingCollab(collab);
    setFormData({
      title: collab.title,
      company_name: collab.company_name,
      category: collab.category,
      date: collab.date,
      end_date: collab.end_date || '',
      fee: collab.fee,
      status: collab.status,
      memo: collab.memo || '',
    });
    setShowAddForm(true);
  };

  const handleSaveCollab = async () => {
    if (!formData.title || !formData.date) return;
    setSaving(true);

    if (editingCollab) {
      const success = await apiService.updateCollabRecord(userName, editingCollab.id, formData);
      if (success) {
        setCollabRecords(prev =>
          prev.map(c => c.id === editingCollab.id ? { ...c, ...formData, updated_at: new Date().toISOString() } : c)
        );
      }
    } else {
      const record = await apiService.createCollabRecord(userName, formData);
      if (record) {
        setCollabRecords(prev => [...prev, record]);
      }
    }

    setSaving(false);
    setShowAddForm(false);
    resetForm();
  };

  const handleDeleteCollab = async (collabId: string) => {
    if (!confirm('이 협업 기록을 삭제하시겠습니까?')) return;
    const success = await apiService.deleteCollabRecord(userName, collabId);
    if (success) {
      setCollabRecords(prev => prev.filter(c => c.id !== collabId));
    }
  };

  const handleUpdateCollabStatus = async (collabId: string, status: CollabRecord['status']) => {
    setUpdatingId(collabId);
    const success = await apiService.updateCollabRecord(userName, collabId, { status });
    if (success) {
      setCollabRecords(prev =>
        prev.map(c => c.id === collabId ? { ...c, status, updated_at: new Date().toISOString() } : c)
      );
    }
    setUpdatingId(null);
  };

  const acceptedProposals = useMemo(
    () => proposals.filter(p => p.status === 'accepted' || p.status === 'completed'),
    [proposals]
  );

  // Calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = ymd(new Date());

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(ymd(now));
  };

  const handleJumpToDate = () => {
    const y = parseInt(jumpYear);
    const m = parseInt(jumpMonth);
    if (y >= 2020 && y <= 2099 && m >= 1 && m <= 12) {
      setCurrentDate(new Date(y, m - 1, 1));
      setJumpYear('');
      setJumpMonth('');
    }
  };

  const getDateStr = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Map proposal events per date
  // 날짜 키는 로컬 기준으로 만든다. 예전에는 UTC 자정으로 파싱한 Date 에
  // setDate() 로 하루씩 더하면서 toISOString() 으로 키를 뽑았는데, 한국 시간대에서는
  // 첫날이 두 번 들어가고 마지막 날이 아예 빠져 캘린더 막대가 하루 짧게 그려졌다.
  const proposalEventsMap = useMemo(() => {
    const map: Record<string, BusinessProposal[]> = {};
    acceptedProposals.forEach(p => {
      const start = parseYmd(p.start_date);
      const end = parseYmd(p.end_date);
      if (!start || !end) return;
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = ymd(cursor);
        if (!map[key]) map[key] = [];
        map[key].push(p);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [acceptedProposals]);

  // 기간이 지났으면 완료, 시작했으면 진행중. 정산이 완료 처리되면 그대로 완료.
  const derivedStatus = (settlementDone: boolean, start: string, end?: string): CollabRecord['status'] => {
    if (settlementDone) return 'completed';
    const from = dayOnly(start);
    const to = dayOnly(end) || from;
    if (to && to < today) return 'completed';
    if (from && from <= today) return 'in_progress';
    return 'scheduled';
  };

  /**
   * 진행 중인 캠페인 협업.
   *
   * 담당자가 일정을 확정하면 서버가 같은 협업을 협업 내역에 한 줄로 올린다(그 줄에는
   * `collab_id` 가 붙는다). 그 줄이 이미 있으면 여기서 또 만들지 않는다 — 하나의
   * 협업이 두 줄이 되면 총 협업 수와 수익 합계가 두 번 세어진다.
   */
  const campaignCollabItems = useMemo<CollabListItem[]>(() => {
    const recorded = new Set(
      collabRecords.map(c => String((c as any).collab_id || '')).filter(Boolean),
    );
    return campaignCollabs
      .filter(c => c.state !== 'cancelled' && !recorded.has(c.id))
      .map(c => {
        const date = dayOnly(c.startDate);
        const endDate = dayOnly(c.endDate) || undefined;
        return {
          id: `campaign_collab_${c.id}`,
          title: c.title,
          company_name: c.companyName,
          category: c.category,
          date,
          end_date: endDate,
          fee: c.fee,
          status:
            c.state === 'completed' ? ('completed' as const) : derivedStatus(false, date, endDate),
          memo: c.todo,
          created_at: c.createdAt || date,
          updated_at: c.updatedAt,
          _source: 'campaign' as CollabSource,
          _fromSettlement: true,
          _collabId: c.id,
          _campaignId: c.campaignId,
          _progress: c.progress,
          _todo: c.todo,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignCollabs, collabRecords, today]);

  // Map collab records per date
  const collabEventsMap = useMemo(() => {
    const map: Record<string, CollabListItem[]> = {};
    // 직접 남긴 기록과 캠페인 협업을 같은 막대로 그린다. 캘린더에만 빠지면 "협업
    // 내역에는 있는데 그 날짜에는 아무것도 없는" 상태가 된다.
    [...collabRecords.map(c => ({ ...c, _source: 'manual' as CollabSource })), ...campaignCollabItems].forEach(c => {
      const start = parseYmd(c.date);
      if (!start) return;
      const end = parseYmd(c.end_date) || start;
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = ymd(cursor);
        if (!map[key]) map[key] = [];
        map[key].push(c);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [collabRecords, campaignCollabItems]);

  // Stable ordering of proposal events
  const eventOrder = useMemo(() => {
    const order: Record<string, number> = {};
    const sorted = [...acceptedProposals].sort((a, b) => {
      const startDiff = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
      if (startDiff !== 0) return startDiff;
      return new Date(b.end_date).getTime() - new Date(a.end_date).getTime();
    });
    sorted.forEach((p, i) => { order[p.id] = i; });
    return order;
  }, [acceptedProposals]);

  const getEventPosition = (startDate: string, endDate: string, dateStr: string) => {
    // 문자열 그대로 비교하고 요일도 로컬 날짜로 구한다. toISOString() 을 쓰면
    // 타임존에 따라 시작/끝 판정이 하루씩 밀려 막대의 둥근 모서리가 엉켰다.
    const startStr = dayOnly(startDate);
    const endStr = dayOnly(endDate);
    const dayOfWeek = (parseYmd(dateStr) || new Date(dateStr)).getDay();
    const isFirst = dateStr === startStr || dayOfWeek === 0;
    const isLast = dateStr === endStr || dayOfWeek === 6;
    return { isFirst, isLast };
  };

  const selectedProposalEvents = selectedDate ? (proposalEventsMap[selectedDate] || []) : [];
  const selectedCollabEvents = selectedDate ? (collabEventsMap[selectedDate] || []) : [];

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getProposalStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'bg-green-500';
      case 'completed': return 'bg-blue-500';
      default: return 'bg-blue-500';
    }
  };

  const getCollabStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-amber-500';
      case 'in_progress': return 'bg-orange-500';
      case 'completed': return 'bg-teal-500';
      case 'cancelled': return 'bg-slate-400';
      default: return 'bg-blue-500';
    }
  };

  const getCollabStatusLabel = (status: string) => {
    switch (status) {
      case 'scheduled': return '예정';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      case 'cancelled': return '취소';
      default: return status;
    }
  };

  const getCollabStatusTextColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'text-amber-500';
      case 'in_progress': return 'text-orange-500';
      case 'completed': return 'text-teal-500';
      case 'cancelled': return 'text-slate-400';
      default: return 'text-amber-500';
    }
  };

  // Keep the displayed status in sync with the calendar. A 예정/진행중 record whose
  // work window has already ended (or whose settlement is done) is shown as 완료됨,
  // so a deal whose date has passed no longer lingers as "진행중". Explicit
  // 'completed'/'cancelled' records are left untouched. Dates are YYYY-MM-DD, so
  // plain string comparison is correct.
  /**
   * 캠페인 협업 줄에 붙는 진행률 배지.
   *
   * 협업 내역의 다른 줄(직접 기록 · 정산 · 제안)에는 진행률이라는 개념이 없다. 이
   * 배지가 있는 줄만 다섯 단계로 굴러가는 협업이고, 눌렀을 때 갈 곳이 있는 줄이다.
   */
  const campaignBadge = (c: CollabListItem) =>
    c._collabId ? (
      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 shrink-0">
        캠페인 {c._progress ?? 0}%
      </span>
    ) : null;

  const effectiveCollabStatus = (c: CollabRecord): CollabRecord['status'] => {
    if (c.status === 'completed' || c.status === 'cancelled') return c.status;
    const end = c.end_date || c.date;
    if (end && end < today) return 'completed';
    return c.status;
  };

  // An accepted business proposal whose end date has passed is treated as
  // 완료됨 in the calendar, mirroring the collab-record behaviour above.
  const isProposalDone = (p: BusinessProposal): boolean => {
    if (p.status === 'completed') return true;
    const end = (p.end_date || '').split('T')[0];
    return !!end && end < today;
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case '광고': return 'bg-pink-100 text-pink-700';
      case '커머스': return 'bg-indigo-100 text-indigo-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const getDaysLeft = (endDate: string) => {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return '마감됨';
    if (diff === 0) return 'D-Day';
    return `D-${diff}`;
  };

  // All collabs sorted for history view. 협업 내역은 세 출처를 합친 하나의 목록이다.
  //  1) 직접 남긴 협업 기록
  //  2) 정산금 항목(제안·캠페인 수락 시 자동 생성되거나 업체가 등록)
  //  3) 정산 항목이 아직 없는 수락된 제안
  // 예전에는 "완료된 정산"만 합쳐서, 진행 중인 협업은 협업 내역에 아예 없었고
  // 캘린더 탭의 합계와 협업 내역 탭의 합계가 서로 다른 값을 보여줬다.
  const proposalById = useMemo(() => {
    const map = new Map<string, BusinessProposal>();
    proposals.forEach(p => map.set(p.id, p));
    return map;
  }, [proposals]);

  // 같은 협업을 직접 기록으로도 남겼다면 두 번 세지 않는다. 제목+업체명이 같은
  // 경우와, 제목 표기만 다른 경우(같은 업체·같은 금액·기간 겹침)를 모두 본다.
  // 단, 제목·업체명이 같아도 기간이 전혀 겹치지 않으면 다른 협업으로 본다.
  // 매달 같은 이름으로 진행하는 협업에서, 한 달치를 직접 기록해 두면 나머지 달의
  // 정산·제안 내역이 통째로 사라지던 문제가 있었다.
  const isCoveredByManualRecord = (item: { title: string; company_name: string; fee: number; date: string; end_date?: string }) =>
    collabRecords.some(c => {
      const sameCompany = normalizeText(c.company_name) === normalizeText(item.company_name);
      const sameTitle = !!normalizeText(item.title) && normalizeText(c.title) === normalizeText(item.title);
      // 한쪽 날짜가 비어 있으면 기간을 비교할 근거가 없으니 날짜는 따지지 않는다.
      const datesComparable = !!dayOnly(c.date) && !!dayOnly(item.date);
      if (sameTitle && sameCompany) {
        if (!datesComparable) return true;
        if (windowsOverlap(c.date, c.end_date, item.date, item.end_date)) return true;
      }
      return (
        !!normalizeText(item.company_name) &&
        sameCompany &&
        c.fee > 0 && c.fee === item.fee &&
        windowsOverlap(c.date, c.end_date, item.date, item.end_date)
      );
    });

  const asCollabCategory = (value?: string): CollabRecord['category'] =>
    value === '광고' || value === '커머스' ? value : '기타';

  const settlementCollabs = useMemo<CollabListItem[]>(() => {
    const seenProposalIds = new Set<string>();
    const items: CollabListItem[] = [];

    settlements.forEach(s => {
      // 같은 제안에서 나온 정산이 중복 저장돼 있으면 한 번만 센다.
      if (s.proposal_id) {
        if (seenProposalIds.has(s.proposal_id)) return;
        seenProposalIds.add(s.proposal_id);
      }

      const source = s.proposal_id ? proposalById.get(s.proposal_id) : undefined;
      // 날짜는 제안의 협업 기간을 우선 쓴다. 없으면 정산 일정으로 대체한다.
      const date = dayOnly(source?.start_date) || dayOnly(s.completed_at || s.scheduled_date || s.created_at);
      const endDate = dayOnly(source?.end_date) || undefined;
      const fee = s.amount || 0;
      const title = s.title || source?.title || '협업 프로젝트';
      const companyName = s.company_name || source?.company_name || '';

      if (isCoveredByManualRecord({ title, company_name: companyName, fee, date, end_date: endDate })) return;

      items.push({
        id: `stl_collab_${s.id}`,
        title,
        company_name: companyName,
        // 예전에는 무조건 '기타'로 넣어서 커머스/광고 필터에 걸리지 않았다.
        category: asCollabCategory(source?.category),
        date,
        end_date: endDate,
        fee,
        status: derivedStatus(s.status === 'completed', date, endDate),
        memo: s.memo || '',
        created_at: s.created_at || date,
        updated_at: s.updated_at,
        _source: 'settlement',
        _fromSettlement: true,
        _proposalId: s.proposal_id || undefined,
      });
    });

    return items;
  }, [settlements, collabRecords, proposalById, today]);

  // 정산 항목이 만들어지기 전에 수락된 제안은 위 목록에 안 잡힌다. 협업 내역에서
  // 통째로 빠지지 않도록 읽기 전용 항목으로 채워 넣는다.
  const proposalCollabs = useMemo<CollabListItem[]>(() => {
    const covered = new Set(
      settlements.map(s => s.proposal_id).filter(Boolean) as string[]
    );
    return acceptedProposals
      .filter(p => !covered.has(p.id))
      .map(p => {
        const date = dayOnly(p.start_date);
        const endDate = dayOnly(p.end_date) || undefined;
        return {
          id: `prop_collab_${p.id}`,
          title: p.title || '협업 프로젝트',
          company_name: p.company_name || '',
          category: asCollabCategory(p.category),
          date,
          end_date: endDate,
          fee: p.fee || 0,
          status: derivedStatus(p.status === 'completed', date, endDate),
          memo: '',
          created_at: p.created_at || date,
          updated_at: p.updated_at,
          _source: 'proposal' as CollabSource,
          _fromSettlement: true,
          _proposalId: p.id,
        };
      })
      .filter(item => !isCoveredByManualRecord(item));
  }, [acceptedProposals, settlements, collabRecords, today]);

  const allCollabsSorted = useMemo<CollabListItem[]>(() => {
    const manual: CollabListItem[] = collabRecords.map(c => ({ ...c, _source: 'manual' }));
    // 날짜가 비어 있는 항목(정산 일정이 없는 경우)은 뒤로 밀되 목록에서 빠지지는
    // 않게 한다. new Date('') 는 NaN 이라 예전 정렬에서는 순서가 뒤죽박죽이었다.
    return [...manual, ...settlementCollabs, ...proposalCollabs, ...campaignCollabItems].sort((a, b) => {
      const aDate = dayOnly(a.date);
      const bDate = dayOnly(b.date);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.localeCompare(aDate);
    });
  }, [collabRecords, settlementCollabs, proposalCollabs, campaignCollabItems]);

  // Stats — 캘린더 탭의 "일정 현황" 타일과 협업 내역 탭의 요약이 같은 목록
  // (allCollabsSorted)에서 계산된다. 예전에는 캘린더 타일이 "직접 기록 + 수락된
  // 제안"을, 협업 내역 타일이 "직접 기록"만 세서 같은 화면에서 숫자가 달랐다.
  const totalCollabs = allCollabsSorted.length;
  const completedCollabs = allCollabsSorted.filter(c => effectiveCollabStatus(c) === 'completed').length;
  const inProgressCollabs = allCollabsSorted.filter(c => effectiveCollabStatus(c) === 'in_progress').length;
  const scheduledCollabs = allCollabsSorted.filter(c => effectiveCollabStatus(c) === 'scheduled').length;
  const totalRevenue = allCollabsSorted
    .filter(c => effectiveCollabStatus(c) === 'completed')
    .reduce((sum, c) => sum + c.fee, 0);

  // Upcoming deadlines — 협업 내역과 같은 목록을 쓰므로 제안과 정산이 각각
  // 따로 잡혀 두 번 나오는 일이 없다.
  const upcomingDeadlines = useMemo(() => {
    return allCollabsSorted
      .filter(c => {
        const status = effectiveCollabStatus(c);
        if (status !== 'scheduled' && status !== 'in_progress') return false;
        const end = dayOnly(c.end_date) || dayOnly(c.date);
        return !!end && end >= today;
      })
      .map(c => ({
        id: c.id,
        title: c.title,
        company: c.company_name,
        endDate: c.end_date || c.date,
        type: c._source || 'manual',
      }))
      .sort((a, b) => dayOnly(a.endDate).localeCompare(dayOnly(b.endDate)))
      .slice(0, 6);
  }, [allCollabsSorted, today]);

  // --- Period (월별 / 기간 지정) filtering ---------------------------------
  const applyPreset = (preset: 'all' | 'thisMonth' | 'lastMonth' | 'thisYear') => {
    setPeriodPreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setRangeStart('');
      setRangeEnd('');
    } else if (preset === 'thisMonth') {
      setRangeStart(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setRangeEnd(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (preset === 'lastMonth') {
      setRangeStart(ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setRangeEnd(ymd(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else if (preset === 'thisYear') {
      setRangeStart(ymd(new Date(now.getFullYear(), 0, 1)));
      setRangeEnd(ymd(new Date(now.getFullYear(), 11, 31)));
    }
  };

  // A collab overlaps the selected period if its [date, end_date] window
  // intersects [rangeStart, rangeEnd]. Empty range = include everything.
  // YYYY-MM-DD strings compare lexicographically, so plain string comparison works.
  // 날짜를 모르는 항목(정산 일정이 비어 있는 경우)은 기간을 지정했을 때 판단할
  // 근거가 없으므로 제외한다. 전체 기간에서는 그대로 보인다.
  const inSelectedPeriod = (startStr: string, endStr?: string) => {
    if (!rangeStart && !rangeEnd) return true;
    const s = dayOnly(startStr);
    if (!s) return false;
    const e = dayOnly(endStr) || s;
    if (rangeStart && e < rangeStart) return false;
    if (rangeEnd && s > rangeEnd) return false;
    return true;
  };

  const periodLabel = useMemo(() => {
    if (!rangeStart && !rangeEnd) return '전체 기간';
    return `${rangeStart || '처음'} ~ ${rangeEnd || '오늘'}`;
  }, [rangeStart, rangeEnd]);

  // Collab deals filtered by category AND period for the 협업 내역 tab.
  const filteredCollabs = useMemo(() => {
    return allCollabsSorted
      .filter(c => collabFilter === '전체' || c.category === collabFilter)
      .filter(c => inSelectedPeriod(c.date, c.end_date));
  }, [allCollabsSorted, collabFilter, rangeStart, rangeEnd]);

  // Totals scoped to the current period filter (ignores the category filter so
  // the summary always reflects the whole selected period).
  const periodCollabs = useMemo(
    () => allCollabsSorted.filter(c => inSelectedPeriod(c.date, c.end_date)),
    [allCollabsSorted, rangeStart, rangeEnd]
  );
  const periodTotalFee = useMemo(() => periodCollabs.reduce((sum, c) => sum + c.fee, 0), [periodCollabs]);
  const periodCompletedFee = useMemo(
    () => periodCollabs.filter(c => effectiveCollabStatus(c) === 'completed').reduce((sum, c) => sum + c.fee, 0),
    [periodCollabs]
  );

  // 카테고리 집계도 협업 내역 목록과 같은 출처를 쓴다.
  // 기간을 고르면 목록·합계와 함께 이 숫자들도 같은 기간으로 좁혀진다. 예전에는
  // 목록만 걸러지고 위쪽 타일은 전체 기간 숫자를 그대로 보여줘서, "이번 달"을
  // 골랐는데 총 협업 건수가 목록보다 훨씬 많은 것처럼 읽혔다.
  const periodCommerceCount = useMemo(() => periodCollabs.filter(c => c.category === '커머스').length, [periodCollabs]);
  const periodAdCount = useMemo(() => periodCollabs.filter(c => c.category === '광고').length, [periodCollabs]);

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="p-4 md:px-14 md:py-6 w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">협업 현황</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">
            협업 캘린더, 협업 내역(커머스·광고), 정산금을 한곳에서 관리합니다
          </p>
        </div>
        {topTab !== 'settlement' && (
          <button
            onClick={openAddForm}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-black rounded-xl hover:bg-blue-700 transition-all shrink-0 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            협업 기록 추가
          </button>
        )}
      </div>

      {/* Top section tabs */}
      <div className="flex gap-2 mb-5 md:mb-6 overflow-x-auto scrollbar-hide">
        {([
          { id: 'calendar', label: '협업 캘린더', icon: '📅' },
          { id: 'collabs', label: '협업 내역', icon: '🤝' },
          { id: 'settlement', label: '정산금', icon: '💰' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTopTab(t.id)}
            className={`px-4 md:px-5 py-2.5 text-sm font-black rounded-xl transition-all shrink-0 flex items-center gap-1.5 ${
              topTab === t.id ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {topTab === 'calendar' && (
      <>
      {/* On wide screens the calendar sits beside its stats/legend sidebar; on
          narrow screens they stack vertically. */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Calendar Grid */}
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Month Navigation + Date Jump */}
            <div className="flex flex-col gap-3 p-4 md:p-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <button
                  onClick={prevMonth}
                  className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                >
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-xl md:text-2xl font-black text-slate-900">
                  {year}년 {month + 1}월
                </h3>
                <button
                  onClick={nextMonth}
                  className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                >
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              {/* Quick Nav */}
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <button
                  onClick={goToToday}
                  className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                >
                  오늘
                </button>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    placeholder="년도"
                    value={jumpYear}
                    onChange={e => setJumpYear(e.target.value)}
                    className="w-20 px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    min={2020}
                    max={2099}
                  />
                  <input
                    type="number"
                    placeholder="월"
                    value={jumpMonth}
                    onChange={e => setJumpMonth(e.target.value)}
                    className="w-14 px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    min={1}
                    max={12}
                  />
                  <button
                    onClick={handleJumpToDate}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                  >
                    이동
                  </button>
                </div>
              </div>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7">
              {weekDays.map(day => (
                <div key={day} className="p-2.5 text-center text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days — on desktop the grid is enlarged to fill nearly the full viewport
                height so the month cells are big; this also pushes the 협업 히스토리 list below the
                fold so it only appears on scroll. Rows divide the space equally. */}
            <div className="grid grid-cols-7 md:auto-rows-fr md:h-[calc(100vh-170px)]">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="p-2 md:p-3 min-h-[80px] md:min-h-0 border-b border-r border-slate-50" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = getDateStr(day);
                const pEvents = proposalEventsMap[dateStr] || [];
                const cEvents = collabEventsMap[dateStr] || [];
                const totalEvents = pEvents.length + cEvents.length;
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const dayOfWeek = (firstDay + i) % 7;

                return (
                  <div
                    key={day}
                    onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                    className={`p-2 md:p-3 min-h-[80px] md:min-h-0 overflow-hidden border-b border-r border-slate-50 cursor-pointer transition-all hover:bg-blue-50/50 ${
                      isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${
                      isToday
                        ? 'bg-blue-600 text-white'
                        : dayOfWeek === 0
                        ? 'text-red-400'
                        : dayOfWeek === 6
                        ? 'text-blue-400'
                        : 'text-slate-700'
                    }`}>
                      {day}
                    </span>
                    <div className="mt-1.5">
                      {/* Proposal events */}
                      {pEvents
                        .sort((a, b) => (eventOrder[a.id] ?? 0) - (eventOrder[b.id] ?? 0))
                        .slice(0, 1)
                        .map(ev => {
                          const { isFirst, isLast } = getEventPosition(ev.start_date, ev.end_date, dateStr);
                          return (
                            <div
                              key={ev.id}
                              className={`${getProposalStatusColor(isProposalDone(ev) ? 'completed' : ev.status)} text-white text-[11px] md:text-xs font-bold py-1 leading-tight overflow-hidden whitespace-nowrap mb-[1px] ${
                                isFirst && isLast ? 'rounded px-1.5 mx-0' :
                                isFirst ? 'rounded-l pl-1.5 -mr-[13px] md:-mr-[13px]' :
                                isLast ? 'rounded-r pr-1.5 -ml-[13px] md:-ml-[13px]' :
                                '-mx-[13px] md:-mx-[13px]'
                              }`}
                            >
                              {isFirst ? ev.title : '\u00A0'}
                            </div>
                          );
                        })}
                      {/* Collab events */}
                      {cEvents.slice(0, 1).map(ev => {
                        const endDate = ev.end_date || ev.date;
                        const { isFirst, isLast } = getEventPosition(ev.date, endDate, dateStr);
                        return (
                          <div
                            key={ev.id}
                            className={`${getCollabStatusColor(effectiveCollabStatus(ev))} text-white text-[11px] md:text-xs font-bold py-1 leading-tight overflow-hidden whitespace-nowrap mb-[1px] ${
                              isFirst && isLast ? 'rounded px-1.5 mx-0' :
                              isFirst ? 'rounded-l pl-1.5 -mr-[13px] md:-mr-[13px]' :
                              isLast ? 'rounded-r pr-1.5 -ml-[13px] md:-ml-[13px]' :
                              '-mx-[13px] md:-mx-[13px]'
                            }`}
                          >
                            {isFirst ? ev.title : '\u00A0'}
                          </div>
                        );
                      })}
                      {totalEvents > 2 && (
                        <p className="text-[11px] font-bold text-slate-400 px-1">+{totalEvents - 2}건</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Date Detail */}
          {selectedDate && (
            <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-black text-slate-900 text-base">
                  {formatDate(selectedDate)} 일정
                </h4>
                <button
                  onClick={() => {
                    setFormData(prev => ({ ...prev, date: selectedDate }));
                    openAddForm();
                  }}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  이 날짜에 추가
                </button>
              </div>

              {/* Tab filter */}
              <div className="flex gap-2 mb-4">
                {(['all', 'proposals', 'collabs'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {tab === 'all' ? '전체' : tab === 'proposals' ? '제안' : '협업 기록'}
                  </button>
                ))}
              </div>

              {(activeTab === 'all' || activeTab === 'proposals') && selectedProposalEvents.length > 0 && (
                <div className="space-y-3 mb-4">
                  {activeTab === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">비즈니스 제안</p>}
                  {selectedProposalEvents.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                      <div className={`w-2 h-12 rounded-full shrink-0 ${getProposalStatusColor(isProposalDone(ev) ? 'completed' : ev.status)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{ev.title}</p>
                        <p className="text-xs font-bold text-slate-400">{ev.company_name} · {formatFee(ev.fee)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-xs font-black ${isProposalDone(ev) ? 'text-blue-500' : 'text-green-500'}`}>
                          {isProposalDone(ev) ? '완료' : '진행중'}
                        </span>
                      </div>
                      {ev.status === 'accepted' && !isProposalDone(ev) && (
                        <button
                          onClick={() => handleComplete(ev.id)}
                          disabled={updatingId === ev.id}
                          className="px-4 py-2 bg-blue-500 text-white text-xs font-black rounded-lg hover:bg-blue-600 transition-all disabled:opacity-60 shrink-0"
                        >
                          완료 처리
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(activeTab === 'all' || activeTab === 'collabs') && selectedCollabEvents.length > 0 && (
                <div className="space-y-3">
                  {activeTab === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">협업 기록</p>}
                  {selectedCollabEvents.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                      <div className={`w-2 h-12 rounded-full shrink-0 ${getCollabStatusColor(effectiveCollabStatus(ev))}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-black text-slate-900 text-sm truncate">{ev.title}</p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(ev.category)}`}>
                            {ev.category}
                          </span>
                          {campaignBadge(ev)}
                        </div>
                        <p className="text-xs font-bold text-slate-400">
                          {ev.company_name ? `${ev.company_name} · ` : ''}{formatFee(ev.fee)}
                          {ev.end_date && ` · ${formatDate(ev.date)} ~ ${formatDate(ev.end_date)}`}
                        </p>
                        {ev.memo && <p className="text-xs text-slate-400 mt-1 truncate">{ev.memo}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-black ${getCollabStatusTextColor(effectiveCollabStatus(ev))}`}>
                          {getCollabStatusLabel(effectiveCollabStatus(ev))}
                        </span>
                        {/* 캠페인 협업은 이 화면에서 고치거나 지울 수 있는 기록이 아니다 —
                            단계와 일정이 협업 진행에서 나오므로, 진행사항으로 보낸다. */}
                        {ev._collabId ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openCampaignCollab({ campaignId: ev._campaignId, collabId: ev._collabId });
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-violet-100 text-violet-600 text-[11px] font-black hover:bg-violet-200 transition-all"
                          >
                            진행사항
                          </button>
                        ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditForm(ev); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                            title="수정"
                          >
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCollab(ev.id); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 transition-all"
                            title="삭제"
                          >
                            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {((activeTab === 'all' && selectedProposalEvents.length === 0 && selectedCollabEvents.length === 0) ||
                (activeTab === 'proposals' && selectedProposalEvents.length === 0) ||
                (activeTab === 'collabs' && selectedCollabEvents.length === 0)) && (
                <p className="text-slate-400 text-sm font-bold text-center py-4">이 날짜에 해당하는 일정이 없습니다.</p>
              )}
            </div>
          )}

          {/* Collab History List */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">협업 히스토리</h4>
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-8">로딩 중...</p>
            ) : allCollabsSorted.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm font-bold">아직 기록된 협업이 없습니다.</p>
                <p className="text-slate-300 text-xs mt-1">캠페인에 선정되거나 제안을 수락하면 자동으로 올라오고, 그 밖의 협업은 "협업 기록 추가"로 남길 수 있습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allCollabsSorted.map(c => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group ${
                      c._collabId ? 'hover:bg-violet-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      // 캠페인 협업은 날짜보다 진행사항이 알고 싶은 것이다 — 지금 내
                      // 차례가 무엇인지는 보드에만 있다.
                      if (c._collabId) {
                        openCampaignCollab({ campaignId: c._campaignId, collabId: c._collabId });
                        return;
                      }
                      const d = new Date(c.date);
                      setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
                      setSelectedDate(c.date);
                    }}
                  >
                    <div className={`w-2 h-8 rounded-full shrink-0 ${getCollabStatusColor(effectiveCollabStatus(c))}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-slate-900 text-sm truncate">{c.title}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(c.category)}`}>
                          {c.category}
                        </span>
                        {campaignBadge(c)}
                      </div>
                      <p className="text-xs font-bold text-slate-400">
                        {formatDate(c.date)}{c.end_date ? ` ~ ${formatDate(c.end_date)}` : ''} · {c.company_name || '미지정'} · {formatFee(c.fee)}
                      </p>
                      {c._todo && <p className="text-[10px] font-bold text-violet-500 mt-0.5 truncate">{c._todo}</p>}
                    </div>
                    <span className={`text-xs font-black shrink-0 ${getCollabStatusTextColor(effectiveCollabStatus(c))}`}>
                      {getCollabStatusLabel(effectiveCollabStatus(c))}
                    </span>
                    {/* 캠페인 협업의 상태는 단계 진행에서 나온다. 여기서 손으로 바꾸면
                        보드의 단계와 어긋나므로 상태 버튼을 두지 않는다. */}
                    {!c._collabId && effectiveCollabStatus(c) !== 'completed' && effectiveCollabStatus(c) !== 'cancelled' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateCollabStatus(c.id, c.status === 'scheduled' ? 'in_progress' : 'completed');
                        }}
                        disabled={updatingId === c.id}
                        className="px-3 py-1.5 text-[11px] font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-40 shrink-0"
                      >
                        {c.status === 'scheduled' ? '진행 시작' : '완료 처리'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="xl:w-96 shrink-0 space-y-6">
          {/* Stats */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">일정 현황</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-amber-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-amber-600">{scheduledCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-amber-500">예정</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-orange-600">{inProgressCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-orange-500">진행중</p>
              </div>
              <div className="bg-teal-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-teal-600">{completedCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-teal-500">완료됨</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-blue-600">{totalCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
              </div>
            </div>
            {totalRevenue > 0 && (
              <div className="mt-3 bg-gradient-to-r from-blue-50 to-pink-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-lg md:text-xl font-black text-blue-700">{formatFee(totalRevenue)}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">완료 협업 총 수익</p>
              </div>
            )}
          </div>

          {/* Upcoming Deadlines */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">다가오는 마감</h4>
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-4">로딩 중...</p>
            ) : upcomingDeadlines.length === 0 ? (
              <p className="text-slate-400 text-sm font-bold text-center py-4">예정된 마감이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {upcomingDeadlines.map(p => {
                  const daysLeft = getDaysLeft(p.endDate);
                  const isUrgent = daysLeft === 'D-Day' || (daysLeft.startsWith('D-') && parseInt(daysLeft.slice(2)) <= 3);
                  return (
                    <div key={p.id} className={`p-3 rounded-xl border ${isUrgent ? 'border-red-200 bg-red-50/50' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-black ${isUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                            {daysLeft}
                          </span>
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                            p.type === 'proposal'
                              ? 'bg-green-100 text-green-600'
                              : p.type === 'settlement'
                                ? 'bg-teal-100 text-teal-600'
                                : 'bg-amber-100 text-amber-600'
                          }`}>
                            {p.type === 'proposal' ? '제안' : p.type === 'settlement' ? '정산' : '협업'}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-300">~{formatDate(p.endDate)}</span>
                      </div>
                      <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                      <p className="text-xs font-bold text-slate-400 mt-0.5">{p.company}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">범례</h4>
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">제안</p>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-slate-600">진행중 (수락됨)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                <span className="text-sm font-bold text-slate-600">완료됨</span>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">협업 기록</p>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-amber-500" />
                <span className="text-sm font-bold text-slate-600">예정</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-orange-500" />
                <span className="text-sm font-bold text-slate-600">진행중</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-teal-500" />
                <span className="text-sm font-bold text-slate-600">완료됨</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-slate-400" />
                <span className="text-sm font-bold text-slate-600">취소</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {topTab === 'collabs' && (
        <div className="space-y-5">
          {/* Category summary — 아래 기간 필터와 같은 기간을 기준으로 센다 */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{periodLabel} 기준</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-indigo-50 rounded-2xl p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-indigo-600">{periodCommerceCount}</p>
                <p className="text-[10px] md:text-xs font-bold text-indigo-500">커머스</p>
              </div>
              <div className="bg-pink-50 rounded-2xl p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-pink-600">{periodAdCount}</p>
                <p className="text-[10px] md:text-xs font-bold text-pink-500">광고</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-blue-600">{periodCollabs.length}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
              </div>
              <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-4 text-center">
                <p className="text-base md:text-xl font-black text-teal-700">{formatFee(periodCompletedFee)}</p>
                <p className="text-[10px] md:text-xs font-bold text-teal-500">완료 수익</p>
              </div>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            {(['전체', '커머스', '광고', '기타'] as const).map(f => (
              <button
                key={f}
                onClick={() => setCollabFilter(f)}
                className={`px-4 py-2 text-xs font-black rounded-lg transition-all ${
                  collabFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Period filter: 월별 / 기간 지정 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">기간별 보기</p>
              <p className="text-[11px] font-bold text-blue-600">{periodLabel}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {([
                { id: 'all', label: '전체' },
                { id: 'thisMonth', label: '이번 달' },
                { id: 'lastMonth', label: '지난 달' },
                { id: 'thisYear', label: '올해' },
              ] as const).map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`px-3.5 py-2 text-xs font-black rounded-lg transition-all ${
                    periodPreset === p.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={rangeStart}
                onChange={e => { setRangeStart(e.target.value); setPeriodPreset('custom'); }}
                className="px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
              />
              <span className="text-slate-300 font-bold text-xs">~</span>
              <input
                type="date"
                value={rangeEnd}
                onChange={e => { setRangeEnd(e.target.value); setPeriodPreset('custom'); }}
                className="px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
              />
              {(rangeStart || rangeEnd) && (
                <button
                  onClick={() => applyPreset('all')}
                  className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-all"
                >
                  초기화
                </button>
              )}
            </div>
            {/* Period summary — 건수는 위 타일과 겹치므로 금액만 보여준다 */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-sm md:text-lg font-black text-blue-700">{formatFee(periodTotalFee)}</p>
                <p className="text-[10px] font-bold text-blue-400">총 금액</p>
              </div>
              <div className="bg-teal-50 rounded-xl p-3 text-center">
                <p className="text-sm md:text-lg font-black text-teal-700">{formatFee(periodCompletedFee)}</p>
                {/* 정산 완료 여부가 아니라 "협업이 끝난 건"의 금액 합계다. 정산 입금
                    여부는 정산금 탭에서 따로 관리한다. */}
                <p className="text-[10px] font-bold text-teal-400">완료 협업 금액</p>
              </div>
            </div>
          </div>

          {/* Collab list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-8">로딩 중...</p>
            ) : filteredCollabs.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm font-bold">
                  {rangeStart || rangeEnd
                    ? '선택한 기간에 해당하는 협업 기록이 없습니다.'
                    : collabFilter === '전체' ? '아직 기록된 협업이 없습니다.' : `${collabFilter} 협업 기록이 없습니다.`}
                </p>
                <p className="text-slate-300 text-xs mt-1">상단의 "협업 기록 추가" 버튼으로 기록을 남겨보세요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCollabs.map(c => (
                  <div
                    key={c.id}
                    onClick={() => {
                      if (c._collabId) openCampaignCollab({ campaignId: c._campaignId, collabId: c._collabId });
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all group ${
                      c._collabId ? 'cursor-pointer hover:bg-violet-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-2 h-10 rounded-full shrink-0 ${getCollabStatusColor(effectiveCollabStatus(c))}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-slate-900 text-sm truncate">{c.title}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(c.category)}`}>
                          {c.category}
                        </span>
                        {campaignBadge(c)}
                      </div>
                      <p className="text-xs font-bold text-slate-400">
                        {formatDate(c.date)}{c.end_date ? ` ~ ${formatDate(c.end_date)}` : ''} · {c.company_name || '미지정'} · {formatFee(c.fee)}
                      </p>
                      {c.memo && <p className="text-xs text-slate-400 mt-0.5 truncate">{c.memo}</p>}
                    </div>
                    <span className={`text-xs font-black shrink-0 ${getCollabStatusTextColor(effectiveCollabStatus(c))}`}>
                      {getCollabStatusLabel(effectiveCollabStatus(c))}
                    </span>
                    {c._fromSettlement ? (
                      <span
                        className="text-[10px] font-black text-slate-300 shrink-0 px-2"
                        title={c._source === 'campaign'
                          ? '진행 중인 캠페인 협업입니다. 눌러서 진행사항을 확인하세요'
                          : c._source === 'proposal'
                            ? '수락한 협업 제안에서 자동 반영된 내역입니다'
                            : '정산금에서 자동 반영된 내역입니다'}
                      >
                        {c._source === 'campaign' ? '캠페인' : c._source === 'proposal' ? '제안' : '정산'}
                      </span>
                    ) : (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(c); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                        title="수정"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCollab(c.id); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 transition-all"
                        title="삭제"
                      >
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {topTab === 'settlement' && (
        // 정산금 탭에서 금액을 고치거나 완료 처리하면, 협업 내역·합계도 같은
        // 값으로 다시 계산되도록 목록을 그대로 넘겨받는다.
        <UserSettlement userName={userName} embedded onSettlementsChange={setSettlements} />
      )}

      {/* Add/Edit Collab Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {editingCollab ? '협업 기록 수정' : '협업 기록 추가'}
              </h3>
              <p className="text-xs font-bold text-slate-400 mt-1">
                협업 내용을 입력하고 캘린더에서 관리하세요
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">제목 *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="예: 브랜드A 인스타 콘텐츠 협업"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">업체명</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={e => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
                  placeholder="협업 업체명"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">카테고리</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData(prev => ({ ...prev, category: e.target.value as CollabRecord['category'] }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none bg-white"
                  >
                    {COLLAB_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">상태</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as CollabRecord['status'] }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none bg-white"
                  >
                    {COLLAB_STATUSES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">시작일 *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">종료일</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={e => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.fee ? formatNumberWithCommas(formData.fee) : ''}
                  onChange={e => setFormData(prev => ({ ...prev, fee: parseInt(stripCommas(e.target.value)) || 0 }))}
                  placeholder="0"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">메모</label>
                <textarea
                  value={formData.memo}
                  onChange={e => setFormData(prev => ({ ...prev, memo: e.target.value }))}
                  placeholder="협업 관련 메모 (선택사항)"
                  rows={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3 justify-end">
              <button
                onClick={() => { setShowAddForm(false); resetForm(); }}
                className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all"
              >
                취소
              </button>
              <button
                onClick={handleSaveCollab}
                disabled={saving || !formData.title || !formData.date}
                className="px-5 py-2.5 text-sm font-black text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50"
              >
                {saving ? '저장 중...' : editingCollab ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessCalendar;
