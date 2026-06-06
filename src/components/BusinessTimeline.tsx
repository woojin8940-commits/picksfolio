
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/apiService';
import type { ClaudeCreditsResponse } from '../services/apiService';
import {
  payClaudePlan,
  issueClaudeBillingKey,
  CLAUDE_PAY_METHODS,
  type ClaudePayMethod,
} from '../utils/claudeCharge';
import { AiMarkdown } from './AiMarkdown';

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TimelineAttachment {
  url: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface TimelineComment {
  id: string;
  proposalId: string;
  authorType: 'influencer' | 'business';
  authorName: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  readBy: string[];
  attachments?: TimelineAttachment[];
}

interface TimelineData {
  proposalId: string;
  influencerUsername: string;
  businessUsername: string;
  companyName: string;
  proposalTitle: string;
  comments?: TimelineComment[];
  createdAt: string;
  unreadCount?: number;
}

interface BusinessTimelineProps {
  userName: string;
  userType?: 'influencer' | 'business';
  initialProposalId?: string;
}

const BusinessTimeline: React.FC<BusinessTimelineProps> = ({ userName, userType = 'influencer', initialProposalId }) => {
  const normalizedUserName = userName.replace(/^biz\//, '');
  const cacheKey = `picks_timelines_${userType}_${normalizedUserName.toLowerCase()}`;
  const detailCacheKey = (proposalId: string) => `picks_timeline_detail_${proposalId}`;

  const initialTimelines = (() => {
    if (typeof window === 'undefined') return [] as TimelineData[];
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as TimelineData[]) : [];
    } catch {
      return [] as TimelineData[];
    }
  })();

  const initialDetail = (() => {
    if (typeof window === 'undefined' || !initialProposalId) return null;
    try {
      const raw = localStorage.getItem(detailCacheKey(initialProposalId));
      return raw ? (JSON.parse(raw) as TimelineData) : null;
    } catch {
      return null;
    }
  })();

  const [timelines, setTimelines] = useState<TimelineData[]>(initialTimelines);
  const [selectedTimeline, setSelectedTimeline] = useState<TimelineData | null>(initialDetail);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(initialTimelines.length === 0);
  const [showList, setShowList] = useState(!initialProposalId);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [windowFocused, setWindowFocused] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef<number>(0);

  // Pinned AI assistant (top of the collaboration message list)
  const [aiActive, setAiActive] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  // Whether the current account's plan includes the AI assistant. AI is bundled
  // into the 스탠다드 AI 멤버십 (6,900) and 커머스 멤버십 (13,900) tiers only — the
  // plain 스탠다드 (4,900) tier does not include it. Stays null until loaded.
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(() => {
    const cached = apiService.getCachedSellerVerification(normalizedUserName);
    if (!cached) return null;
    const plan = cached.membership_plan;
    return (
      !!cached.membership_active &&
      (plan === 'standard_ai' || plan === 'commerce' || plan === 'live')
    );
  });
  const aiEndRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  // Model selection. Gemini (default) is the membership-bundled model; Claude is
  // the optional premium model billed against the separately-purchased Claude plan
  // credit wallet. Switching models keeps the same conversation — the chat history
  // is held here and re-sent on every request, so neither model "forgets" the other.
  const [aiModel, setAiModel] = useState<'gemini' | 'claude'>('gemini');
  const [claudeData, setClaudeData] = useState<ClaudeCreditsResponse | null>(null);
  const [claudeModalOpen, setClaudeModalOpen] = useState(false);
  const [lastClaudeCost, setLastClaudeCost] = useState<number | null>(null);

  const refreshClaudeCredits = useCallback(async () => {
    const data = await apiService.getClaudeCredits(normalizedUserName);
    if (data) setClaudeData(data);
    return data;
  }, [normalizedUserName]);

  // Load the wallet the first time Claude is chosen (and keep it fresh thereafter).
  useEffect(() => {
    if (aiModel === 'claude' && !claudeData) {
      refreshClaudeCredits();
    }
  }, [aiModel, claudeData, refreshClaudeCredits]);

  useEffect(() => {
    let cancelled = false;
    apiService.getSellerVerification(normalizedUserName).then((data) => {
      if (cancelled) return;
      const plan = data?.membership_plan;
      setAiEnabled(
        !!data?.membership_active &&
          (plan === 'standard_ai' || plan === 'commerce' || plan === 'live'),
      );
    });
    return () => { cancelled = true; };
  }, [normalizedUserName]);

  // While a conversation (or the AI chat) is open on mobile, hide the app's
  // bottom navigation bar so the message composer can sit flush at the very
  // bottom of the screen. The conversation has its own back button, so the
  // global nav is not needed here. Cleared when returning to the list/unmount.
  useEffect(() => {
    const chatOpen = !!selectedTimeline || aiActive;
    if (chatOpen) {
      document.body.classList.add('timeline-chat-open');
    } else {
      document.body.classList.remove('timeline-chat-open');
    }
    return () => document.body.classList.remove('timeline-chat-open');
  }, [selectedTimeline, aiActive]);

  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [aiMessages, aiLoading]);

  const openAiAssistant = () => {
    setAiActive(true);
    setShowList(false);
  };

  const sendAiMessage = async (text: string) => {
    const content = text.trim();
    if (!content || aiLoading) return;

    // Gemini requires an AI membership; Claude requires an active Claude plan with
    // a positive credit balance. Pre-checks keep the user from sending a doomed
    // request — but the server is the source of truth and re-validates either way.
    if (aiModel === 'gemini' && aiEnabled === false) {
      setAiMessages(prev => [
        ...prev,
        { role: 'user', content },
        { role: 'assistant', content: 'AI 어시스턴트는 스탠다드 AI 멤버십(6,900원) 또는 커머스 멤버십에서 이용할 수 있어요. 플랜을 업그레이드하면 바로 사용할 수 있습니다.' },
      ]);
      setAiInput('');
      return;
    }
    if (aiModel === 'claude') {
      const c = claudeData?.credits;
      if (c && (!c.planActive || c.balanceKrw <= 0)) {
        setClaudeModalOpen(true);
        return;
      }
    }

    const nextMessages: AiMessage[] = [...aiMessages, { role: 'user', content }];
    setAiMessages(nextMessages);
    setAiInput('');
    setAiLoading(true);
    if (aiInputRef.current) aiInputRef.current.style.height = 'auto';

    const context = selectedTimeline
      ? {
          title: selectedTimeline.proposalTitle,
          partner: userType === 'influencer' ? selectedTimeline.companyName : selectedTimeline.influencerUsername,
          transcript: (selectedTimeline.comments || [])
            .slice(-40)
            .map(c => `${c.authorName}(${c.authorType === 'business' ? '비즈니스' : '인플루언서'}): ${c.content || '[첨부 파일]'}`)
            .join('\n'),
        }
      : null;

    // Compact summary of every conversation the user has, so the AI can answer
    // workspace-wide questions ("how many companies?", "which need a reply?",
    // "draft a reply to <company>") — not just the one in focus. Transcripts
    // are read server-side from the canonical store.
    const timelineSummary = timelines.map(t => ({
      proposalId: t.proposalId,
      influencerUsername: t.influencerUsername,
      businessUsername: t.businessUsername,
      companyName: t.companyName,
      proposalTitle: t.proposalTitle,
      createdAt: t.createdAt,
    }));

    try {
      const res = await fetch('/api/collab-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUserName.toLowerCase(),
          userType,
          model: aiModel,
          activeProposalId: selectedTimeline?.proposalId || '',
          timelines: timelineSummary,
          messages: nextMessages,
          context,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === 'MEMBERSHIP_REQUIRED') setAiEnabled(false);
        // Claude plan not active / credits exhausted — surface the wallet modal so
        // the user can activate or recharge without losing the conversation.
        if (data?.code === 'CLAUDE_PLAN_REQUIRED' || data?.code === 'CLAUDE_CREDITS_EMPTY') {
          await refreshClaudeCredits();
          setAiMessages(prev => prev.slice(0, -1));
          setAiInput(content);
          setClaudeModalOpen(true);
          return;
        }
        setAiMessages(prev => [...prev, { role: 'assistant', content: data?.error || 'AI 응답에 실패했어요. 잠시 후 다시 시도해 주세요.' }]);
      } else {
        setAiMessages(prev => [...prev, { role: 'assistant', content: data.reply || '...' }]);
        // Reflect the credit deduction returned by the Claude path.
        if (data.model === 'claude' && typeof data.balanceKrw === 'number') {
          setLastClaudeCost(typeof data.creditsUsed === 'number' ? data.creditsUsed : null);
          setClaudeData(prev =>
            prev ? { ...prev, credits: { ...prev.credits, balanceKrw: data.balanceKrw } } : prev,
          );
        }
      }
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: '네트워크 오류로 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.' }]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAiMessage(aiInput);
    }
  };

  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const fetchTimelines = useCallback(async () => {
    try {
      const res = await fetch(`/api/timeline/list/${normalizedUserName}?type=${userType}`);
      const data = await res.json();
      if (data.timelines) {
        setTimelines(data.timelines);
        try { localStorage.setItem(cacheKey, JSON.stringify(data.timelines)); } catch {}
      }
    } catch (e) {
      console.error('Failed to fetch timelines:', e);
    } finally {
      setLoading(false);
    }
  }, [normalizedUserName, userType, cacheKey]);

  const fetchTimelineDetail = useCallback(async (proposalId: string, showCachedImmediately = false) => {
    if (showCachedImmediately) {
      const cached = (() => {
        try {
          const raw = localStorage.getItem(detailCacheKey(proposalId));
          return raw ? JSON.parse(raw) as TimelineData : null;
        } catch { return null; }
      })();
      const fromList = timelines.find(t => t.proposalId === proposalId);
      if (cached) {
        setSelectedTimeline(cached);
        lastMessageCountRef.current = cached.comments?.length || 0;
      } else if (fromList && fromList.comments) {
        setSelectedTimeline(fromList);
        lastMessageCountRef.current = fromList.comments?.length || 0;
      }
    }
    try {
      const res = await fetch(`/api/timeline/detail/${proposalId}`);
      const data = await res.json();
      if (data.timeline) {
        const serverCount = (data.timeline.comments || []).length;
        setSelectedTimeline(prev => {
          if (prev && prev.proposalId === proposalId) {
            const pendingMsgs = (prev.comments || []).filter((c: TimelineComment) => c.id.startsWith('pending_'));
            const serverIds = new Set((data.timeline.comments || []).map((c: TimelineComment) => c.id));
            const stillPending = pendingMsgs.filter((c: TimelineComment) => !serverIds.has(c.id.replace('pending_', 'tc_')));
            if (serverCount === lastMessageCountRef.current && stillPending.length === 0) {
              return prev;
            }
            lastMessageCountRef.current = serverCount;
            return { ...data.timeline, comments: [...(data.timeline.comments || []), ...stillPending] };
          }
          lastMessageCountRef.current = serverCount;
          return data.timeline;
        });
        try { localStorage.setItem(detailCacheKey(proposalId), JSON.stringify(data.timeline)); } catch {}
        fetch(`/api/timeline/read/${proposalId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: normalizedUserName.toLowerCase() }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Failed to fetch timeline detail:', e);
    }
  }, [normalizedUserName, timelines]);

  useEffect(() => {
    fetchTimelines();
    const ms = windowFocused ? 15000 : 60000;
    const interval = setInterval(fetchTimelines, ms);
    return () => clearInterval(interval);
  }, [fetchTimelines, windowFocused]);

  useEffect(() => {
    if (initialProposalId) {
      fetchTimelineDetail(initialProposalId, true);
      setShowList(false);
    }
  }, [initialProposalId, fetchTimelineDetail]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedTimeline?.comments]);

  useEffect(() => {
    if (!selectedTimeline) return;
    const ms = windowFocused ? 5000 : 30000;
    const interval = setInterval(() => {
      fetchTimelineDetail(selectedTimeline.proposalId);
    }, ms);
    return () => clearInterval(interval);
  }, [selectedTimeline?.proposalId, fetchTimelineDetail, windowFocused]);

  const handleSendMessage = () => {
    if ((!newMessage.trim() && pendingFiles.length === 0) || !selectedTimeline) return;

    const messageContent = newMessage.trim();
    const filesToUpload = [...pendingFiles];

    const optimisticId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticComment: TimelineComment = {
      id: optimisticId,
      proposalId: selectedTimeline.proposalId,
      authorType: userType,
      authorName: normalizedUserName,
      authorUsername: normalizedUserName.toLowerCase(),
      content: messageContent,
      createdAt: new Date().toISOString(),
      readBy: [normalizedUserName.toLowerCase()],
    };

    setSelectedTimeline(prev => prev ? {
      ...prev,
      comments: [...(prev.comments || []), optimisticComment],
    } : null);
    setNewMessage('');
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const proposalId = selectedTimeline.proposalId;
    const timelineInfo = {
      influencerUsername: selectedTimeline.influencerUsername,
      businessUsername: selectedTimeline.businessUsername,
      companyName: selectedTimeline.companyName,
      proposalTitle: selectedTimeline.proposalTitle,
    };

    (async () => {
      try {
        const uploadedAttachments: TimelineAttachment[] = [];
        for (const file of filesToUpload) {
          const formData = new FormData();
          formData.append('image', file);
          formData.append('username', normalizedUserName.toLowerCase());
          const uploadRes = await fetch('/api/upload-image', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.url) {
            uploadedAttachments.push({
              url: uploadData.url,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
            });
          }
        }

        if (uploadedAttachments.length > 0) {
          setSelectedTimeline(prev => {
            if (!prev) return null;
            return {
              ...prev,
              comments: (prev.comments || []).map(c =>
                c.id === optimisticId ? { ...c, attachments: uploadedAttachments } : c
              ),
            };
          });
        }

        const res = await fetch(`/api/timeline/comment/${proposalId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorType: userType,
            authorName: normalizedUserName,
            authorUsername: normalizedUserName.toLowerCase(),
            content: messageContent,
            ...timelineInfo,
            ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
          }),
        });

        const data = await res.json();
        if (data.success && data.comment) {
          setSelectedTimeline(prev => {
            if (!prev) return null;
            return {
              ...prev,
              comments: (prev.comments || []).map(c =>
                c.id === optimisticId ? data.comment : c
              ),
            };
          });
        }
      } catch (e) {
        console.error('Failed to send message:', e);
        setSelectedTimeline(prev => {
          if (!prev) return null;
          return {
            ...prev,
            comments: (prev.comments || []).map(c =>
              c.id === optimisticId ? { ...c, id: `failed_${optimisticId}` } : c
            ),
          };
        });
      }
    })();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
  };

  const addPendingFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const maxSize = 20 * 1024 * 1024;
    const validFiles = files.filter(f => f.size <= maxSize);
    if (validFiles.length < files.length) {
      alert('20MB를 초과하는 파일은 제외되었습니다.');
    }
    setPendingFiles(prev => [...prev, ...validFiles]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addPendingFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverComposer(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOverComposer(false);
  };

  const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverComposer(false);
    const files = Array.from(e.dataTransfer.files || []);
    addPendingFiles(files);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const isWordFile = (fileType: string, fileName = '') => {
    const lowerName = fileName.toLowerCase();
    return (
      fileType.includes('word') ||
      fileType.includes('document') ||
      lowerName.endsWith('.doc') ||
      lowerName.endsWith('.docx')
    );
  };

  const isExcelFile = (fileType: string, fileName = '') => {
    const lowerName = fileName.toLowerCase();
    return (
      fileType.includes('excel') ||
      fileType.includes('sheet') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.xlsx')
    );
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.startsWith('video/')) return '🎬';
    if (fileType === 'application/pdf') return '📄';
    if (fileType.includes('word') || fileType.includes('document')) return '📘';
    if (fileType.includes('excel') || fileType.includes('sheet')) return '📗';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return '📊';
    if (fileType.includes('zip')) return '📦';
    return '📎';
  };

  const renderDocPreview = (fileType: string, fileName: string) => {
    const isWord = isWordFile(fileType, fileName);
    const isExcel = isExcelFile(fileType, fileName);

    if (!isWord && !isExcel) return null;

    const bgClass = isWord ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200';
    const label = isWord ? 'WORD' : 'EXCEL';
    const ext = isWord ? 'DOC' : 'XLS';

    return (
      <div className={`w-11 h-11 rounded-lg border flex flex-col items-center justify-center shrink-0 ${bgClass}`}>
        <span className="text-[9px] font-black leading-none">{ext}</span>
        <span className="text-[8px] font-bold leading-none mt-0.5">{label}</span>
      </div>
    );
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateSeparator = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return '오늘';
    if (date.toDateString() === yesterday.toDateString()) return '어제';

    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  };

  const getInitials = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const totalUnread = timelines.reduce((sum, t) => sum + (t.unreadCount || 0), 0);

  const filteredTimelines = timelines.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.companyName.toLowerCase().includes(q) ||
      t.influencerUsername.toLowerCase().includes(q) ||
      t.proposalTitle.toLowerCase().includes(q)
    );
  });

  // Sidebar conversation list
  const renderSidebar = () => (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Sidebar Header */}
      <div className="shrink-0 px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-base font-extrabold text-gray-900 tracking-tight">협업 메시지</h2>
            {totalUnread > 0 && (
              <span className="bg-blue-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full">
                {totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="대화 검색..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300/30 transition-all"
          />
        </div>
      </div>

      {/* Pinned AI assistant — fixed at the very top of the message list.
          Only shown when the account's plan includes AI (스탠다드 AI 6,900 / 커머스 13,900). */}
      {aiEnabled === true && (
        <div className="shrink-0 px-2 pb-2">
          <button
            onClick={openAiAssistant}
            className={`w-full text-left px-3 py-3 rounded-xl transition-all group border ${
              aiActive
                ? 'bg-gradient-to-r from-violet-50 to-blue-50 border-violet-300 ring-1 ring-violet-300/40'
                : 'bg-gradient-to-r from-violet-50/70 to-blue-50/70 border-violet-100 hover:border-violet-200 hover:from-violet-50 hover:to-blue-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-sm">
                <span className="text-base leading-none">✨</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-extrabold text-gray-900 truncate">AI 어시스턴트</span>
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-600 tracking-tight">BETA</span>
                </div>
                <p className="text-[11px] text-gray-500 font-medium truncate mt-0.5">전체 협업 현황 · 답장 초안 · 일정 정리</p>
              </div>
              <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredTimelines.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-gray-400">
              {searchQuery ? '검색 결과가 없습니다' : '아직 대화가 없습니다'}
            </p>
            {!searchQuery && (
              <p className="text-[11px] text-gray-400 mt-1">
                제안이 수락되면 여기에 표시됩니다
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTimelines.map(timeline => {
              const comments = timeline.comments || [];
              const lastComment = comments.length > 0
                ? comments[comments.length - 1]
                : null;
              const isUnread = (timeline.unreadCount || 0) > 0;
              const isActive = selectedTimeline?.proposalId === timeline.proposalId;
              const displayName = userType === 'influencer' ? timeline.companyName : timeline.influencerUsername;

              return (
                <button
                  key={timeline.proposalId}
                  onClick={() => {
                    setAiActive(false);
                    setSelectedTimeline(timeline);
                    fetchTimelineDetail(timeline.proposalId, true);
                    setShowList(false);
                  }}
                  className={`w-full text-left px-3 py-3 rounded-xl transition-all group ${
                    isActive
                      ? 'bg-blue-50 border border-blue-200'
                      : isUnread
                        ? 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                        : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Avatar */}
                    <div className={`shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center text-xs md:text-sm font-bold ${
                      isActive
                        ? 'bg-blue-500 text-white'
                        : userType === 'influencer'
                          ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                          : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                    }`}>
                      {getInitials(displayName)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`text-[13px] md:text-sm font-bold truncate ${
                          isUnread ? 'text-gray-900' : 'text-gray-700'
                        }`}>
                          {displayName}
                        </span>
                        <span className="text-[10px] md:text-[11px] text-gray-400 font-medium shrink-0">
                          {lastComment ? formatTime(lastComment.createdAt) : formatTime(timeline.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] md:text-xs text-blue-600 font-semibold truncate mb-0.5 md:mb-1">
                        # {timeline.proposalTitle}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-[11px] md:text-xs truncate ${
                          isUnread ? 'text-gray-600 font-semibold' : 'text-gray-400 font-medium'
                        }`}>
                          {lastComment
                            ? `${lastComment.authorType === userType ? '나' : lastComment.authorName}: ${
                                lastComment.content
                                  ? lastComment.content
                                  : lastComment.attachments && lastComment.attachments.length > 0
                                    ? `📎 파일 ${lastComment.attachments.length}개`
                                    : '대화를 시작해보세요'
                              }`
                            : '대화를 시작해보세요'
                          }
                        </p>
                        {isUnread && (
                          <span className="shrink-0 bg-blue-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1.5 rounded-full">
                            {timeline.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // Message area (Slack-style flat messages)
  const renderMessages = () => {
    if (!selectedTimeline) {
      return (
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-gray-600 mb-1.5">대화를 선택하세요</h3>
            <p className="text-xs text-gray-400">
              왼쪽에서 프로젝트를 선택하면 메시지가 여기에 표시됩니다
            </p>
          </div>
        </div>
      );
    }

    const partnerName = userType === 'influencer'
      ? selectedTimeline.companyName
      : selectedTimeline.influencerUsername;

    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        {/* Channel Header (Slack-style) */}
        <div className="shrink-0 bg-white border-b border-gray-200 px-3 py-1.5 md:px-5 md:py-3 shadow-sm z-10">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile back button */}
            <button
              onClick={() => {
                setSelectedTimeline(null);
                setShowList(true);
                fetchTimelines();
              }}
              className="md:hidden p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4 md:w-5 md:h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 text-[14px] md:text-[17px] font-bold leading-none">#</span>
                <h2 className="text-[13px] md:text-[15px] font-extrabold text-gray-900 truncate tracking-tight">
                  {partnerName}
                </h2>
                <svg className="w-3 h-3 md:w-3.5 md:h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <p className="text-[10px] md:text-[11px] text-gray-500 font-medium truncate">
                  {selectedTimeline.proposalTitle}
                </p>
              </div>
            </div>

            {/* Header actions */}
            <div className="flex items-center gap-1 shrink-0">
              <div className="hidden md:flex items-center -space-x-1.5 bg-white border border-gray-200 rounded-md px-1.5 py-1">
                <div className={`w-6 h-6 rounded-[4px] flex items-center justify-center text-[10px] font-bold ring-2 ring-white ${
                  userType === 'influencer'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                    : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                }`}>
                  {getInitials(selectedTimeline.influencerUsername)}
                </div>
                <div className={`w-6 h-6 rounded-[4px] flex items-center justify-center text-[10px] font-bold ring-2 ring-white ${
                  userType === 'business'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                    : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                }`}>
                  {getInitials(selectedTimeline.companyName)}
                </div>
                <span className="text-[11px] text-gray-600 font-semibold pl-2 pr-1">2</span>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto py-3 md:py-4 pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-4 scrollbar-hide">
          {/* Bottom-anchored column: messages rest just above the composer even when the
              conversation is short, and grow upward / scroll normally once it overflows. */}
          <div className="min-h-full flex flex-col justify-end">
          {/* Channel intro (Slack-style) */}
          <div className="px-3 md:px-5 pb-2 md:pb-4 mb-1 md:mb-2">
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-2 md:mb-3">
              <span className="text-lg md:text-2xl font-bold text-white leading-none">#</span>
            </div>
            <h3 className="text-base md:text-xl font-extrabold text-gray-900 mb-0.5 md:mb-1">
              <span className="text-gray-400 font-bold">#&nbsp;</span>{partnerName}
            </h3>
            <p className="text-xs md:text-sm text-gray-500 leading-relaxed">
              <span className="font-semibold text-gray-700">{partnerName}</span>와의 협업 공간
            </p>
            <div className="mt-2 md:mt-3 inline-flex items-center gap-1.5 md:gap-2 bg-gray-50 border border-gray-200 rounded-md px-2 md:px-3 py-1 md:py-1.5">
              <svg className="w-3 h-3 md:w-3.5 md:h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-[11px] md:text-xs font-semibold text-gray-700 truncate">{selectedTimeline.proposalTitle}</span>
              <span className="text-[10px] md:text-[11px] text-gray-400">·</span>
              <span className="text-[10px] md:text-[11px] text-gray-500">{selectedTimeline.companyName}</span>
            </div>
          </div>

          {(selectedTimeline.comments || []).length === 0 && (
            <div className="text-center py-5 md:py-8 px-4">
              <p className="text-xs md:text-sm text-gray-400 font-medium">아직 메시지가 없습니다</p>
              <p className="text-[11px] md:text-xs text-gray-400 mt-1">첫 번째 메시지를 보내 협업을 시작하세요</p>
            </div>
          )}

          {/* Slack-style messages: all left-aligned, avatar + author + content, hover highlight */}
          {(selectedTimeline.comments || []).map((comment, idx) => {
            const isMe = comment.authorUsername.toLowerCase() === normalizedUserName.toLowerCase();
            const showDate = idx === 0 || (
              new Date(comment.createdAt).toDateString() !==
              new Date((selectedTimeline.comments || [])[idx - 1].createdAt).toDateString()
            );
            const prevComment = idx > 0 ? (selectedTimeline.comments || [])[idx - 1] : null;
            const isSameAuthor = prevComment &&
              prevComment.authorUsername === comment.authorUsername &&
              !showDate &&
              (new Date(comment.createdAt).getTime() - new Date(prevComment.createdAt).getTime()) < 300000;

            const otherPartyUsername = isMe
              ? (userType === 'influencer' ? selectedTimeline.businessUsername : selectedTimeline.influencerUsername)
              : '';
            const readByOther = isMe && otherPartyUsername
              ? comment.readBy.includes(otherPartyUsername.toLowerCase())
              : false;

            const isBusiness = comment.authorType === 'business';
            const roleLabel = isBusiness ? '비즈니스' : '인플루언서';

            return (
              <React.Fragment key={comment.id}>
                {showDate && (
                  <div className="relative flex items-center my-2 md:my-4 px-3 md:px-5">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="mx-2 md:mx-3 text-[10px] md:text-xs font-bold text-gray-700 bg-white border border-gray-200 px-2 md:px-3 py-0.5 rounded-full shadow-sm">
                      {formatDateSeparator(comment.createdAt)}
                    </span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                )}

                <div
                  className={`group relative flex gap-2 md:gap-3 px-3 md:px-5 ${
                    isSameAuthor ? 'py-0.5' : 'pt-2 pb-1 md:pt-3 md:pb-1.5 mt-1 md:mt-2'
                  } ${isMe ? 'flex-row-reverse' : ''} hover:bg-gray-50 transition-colors`}
                >
                  {/* Avatar column */}
                  {!isSameAuthor ? (
                    <div className={`shrink-0 w-7 h-7 md:w-10 md:h-10 rounded-md flex items-center justify-center text-xs md:text-base font-bold ${
                      isBusiness
                        ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                    }`}>
                      {getInitials(comment.authorName)}
                    </div>
                  ) : (
                    <div className="shrink-0 w-7 md:w-10 flex items-start justify-center pt-0.5">
                      <span className="text-[10px] md:text-[11px] text-gray-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                        {formatMessageTime(comment.createdAt)}
                      </span>
                    </div>
                  )}

                  <div className={`min-w-0 flex-1 ${isMe ? 'text-right' : ''}`}>
                    {/* Author row - only first in group */}
                    {!isSameAuthor && (
                      <div className={`flex items-baseline gap-1.5 md:gap-2 flex-wrap leading-none mb-1 md:mb-1.5 ${
                        isMe ? 'justify-end' : ''
                      }`}>
                        <span className="text-[12px] md:text-[13px] font-semibold text-gray-700 tracking-tight">
                          {comment.authorName}
                        </span>
                        <span className={`text-[10px] md:text-[11px] font-bold px-1 md:px-1.5 py-0.5 rounded ${
                          isBusiness
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-emerald-50 text-emerald-600'
                        }`}>
                          {roleLabel}
                        </span>
                        {isMe && (
                          <span className="text-[10px] md:text-[11px] font-semibold px-1 md:px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
                            나
                          </span>
                        )}
                        <span className="text-[11px] md:text-[12px] text-gray-500 font-medium tabular-nums">
                          {formatMessageTime(comment.createdAt)}
                        </span>
                      </div>
                    )}

                    {/* Message content */}
                    {comment.content && (
                      <div className={`inline-block max-w-full ${isMe ? 'bg-blue-50 border border-blue-100 rounded-2xl rounded-tr-sm px-2.5 py-1.5 md:px-3.5 md:py-2' : 'md:bg-transparent md:border-0 md:rounded-none md:px-0 md:py-0 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-2.5 py-1.5 md:px-3.5 md:py-2'}`}>
                        <p className="text-[13px] leading-[1.5] md:text-[15px] md:leading-[1.6] text-gray-900 whitespace-pre-wrap break-words font-normal">
                          {comment.content}
                        </p>
                      </div>
                    )}

                    {/* Attachments */}
                    {comment.attachments && comment.attachments.length > 0 && (
                      <div className={`${comment.content ? 'mt-2' : ''} space-y-2 ${
                        isMe ? 'flex flex-col items-end' : ''
                      }`}>
                        {comment.attachments.map((att, attIdx) => {
                          if (att.fileType.startsWith('image/')) {
                            return (
                              <div key={attIdx} className="group/img inline-flex flex-col gap-1">
                                <a href={att.url} target="_blank" rel="noopener noreferrer" className="block">
                                  <img
                                    src={att.url}
                                    alt={att.fileName}
                                    className="w-full max-w-[240px] md:max-w-[420px] max-h-[240px] md:max-h-[340px] rounded-lg border border-gray-200 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                  />
                                </a>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const link = document.createElement('a');
                                    link.href = att.url;
                                    link.download = att.fileName || 'image';
                                    link.target = '_blank';
                                    link.rel = 'noopener noreferrer';
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium md:opacity-0 md:group-hover/img:opacity-100 transition-opacity text-gray-500 hover:text-gray-700 hover:bg-gray-100 ${
                                    isMe ? 'self-end' : 'self-start'
                                  }`}
                                  title="저장"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  저장
                                </button>
                              </div>
                            );
                          }
                          if (att.fileType.startsWith('video/')) {
                            return (
                              <video
                                key={attIdx}
                                src={att.url}
                                controls
                                preload="metadata"
                                className="w-full max-w-[240px] md:max-w-[420px] max-h-[240px] md:max-h-[320px] rounded-lg border border-gray-200"
                              />
                            );
                          }
                          const docPreview = renderDocPreview(att.fileType, att.fileName);
                          return (
                            <a
                              key={attIdx}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors bg-white hover:bg-gray-50 border border-gray-200 max-w-[420px] text-left"
                            >
                              {docPreview || <span className="text-base shrink-0">{getFileIcon(att.fileType)}</span>}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate text-gray-700">
                                  {att.fileName}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {formatFileSize(att.fileSize)}
                                </p>
                              </div>
                              <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {/* Status indicators for own messages */}
                    {isMe && comment.id.startsWith('pending_') && (
                      <div className="mt-1 inline-flex items-center gap-1">
                        <div className="w-3 h-3 border-[1.5px] border-gray-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] text-gray-400 font-medium">전송 중...</span>
                      </div>
                    )}
                    {isMe && comment.id.startsWith('failed_') && (
                      <div className="mt-1 inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-[11px] text-red-500 font-medium">전송 실패</span>
                      </div>
                    )}
                    {isMe && readByOther && !comment.id.startsWith('pending_') && !comment.id.startsWith('failed_') && (
                      <div className="mt-1 inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span className="text-[11px] text-emerald-600 font-semibold">읽음</span>
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Message Composer (fixed at the very bottom on mobile) */}
        <div className="fixed bottom-0 left-0 right-0 md:static md:bottom-auto px-2 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] md:px-5 md:pb-4 pt-1.5 md:pt-2 bg-white border-t border-gray-100 md:border-t-0 z-[120] md:z-10 md:shrink-0" style={{ touchAction: 'manipulation' }}>
          <div
            onDragOver={handleComposerDragOver}
            onDragEnter={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            className={`relative bg-white border-2 rounded-lg overflow-hidden focus-within:border-gray-400 transition-all ${
              isDragOverComposer ? 'border-blue-400 ring-2 ring-blue-400/35' : 'border-gray-300'
            }`}
          >
            {isDragOverComposer && (
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-blue-50/80 backdrop-blur-[1px]">
                <div className="px-3 py-2 rounded-lg border border-blue-300 bg-white/90 text-[12px] font-semibold text-blue-600">
                  파일을 놓으면 첨부됩니다
                </div>
              </div>
            )}
            {/* Pending files preview */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="relative group flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 max-w-[180px]">
                    {file.type.startsWith('image/') ? (
                      <img src={URL.createObjectURL(file)} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    ) : (
                      renderDocPreview(file.type, file.name) || <span className="text-sm shrink-0">{getFileIcon(file.type)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-gray-700 font-medium truncate">{file.name}</p>
                      <p className="text-[9px] text-gray-400">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      onClick={() => removePendingFile(idx)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 md:gap-2 p-2 md:p-2.5">
              {/* File attachment button */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors"
                title="파일 첨부"
              >
                <svg className="w-4 h-4 md:w-[18px] md:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <textarea
                ref={textareaRef}
                value={newMessage}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder={`${partnerName}에게 메시지 보내기...`}
                rows={1}
                className="flex-1 bg-transparent text-[13px] md:text-[15px] text-gray-900 placeholder-gray-400 resize-none focus:outline-none py-1 px-1 leading-relaxed"
                style={{ maxHeight: '80px' }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() && pendingFiles.length === 0}
                className={`shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all ${
                  (newMessage.trim() || pendingFiles.length > 0)
                    ? 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14m-7-7l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="hidden md:flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 font-medium">
                  Shift + Enter로 줄바꿈
                </span>
              </div>
              {(newMessage.trim() || pendingFiles.length > 0) && (
                <span className="text-[11px] text-blue-500 font-medium">
                  Enter로 전송
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // AI assistant chat panel (opened from the pinned item at the top of the list)
  const renderAiChat = () => {
    const suggestions = selectedTimeline
      ? ['이 대화 요약해줘', `${userType === 'influencer' ? selectedTimeline.companyName : selectedTimeline.influencerUsername}에게 보낼 답장 초안 써줘`, '답장이 필요한 협업 알려줘', '다음 할 일과 일정 정리해줘']
      : ['지금 대화 중인 업체가 몇 곳이야?', '답장이 필요한 협업 알려줘', '먼저 챙겨야 할 협업 우선순위 정리해줘', '협찬 계약서에서 꼭 확인할 점은?'];

    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        {/* Header */}
        <div className="shrink-0 bg-white border-b border-gray-200 px-3 py-1.5 md:px-5 md:py-3 shadow-sm z-10">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => { setAiActive(false); setShowList(true); }}
              className="md:hidden p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="shrink-0 w-7 h-7 md:w-9 md:h-9 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-sm">
              <span className="text-sm md:text-base leading-none">✨</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[13px] md:text-[15px] font-extrabold text-gray-900 truncate tracking-tight">AI 어시스턴트</h2>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-600">BETA</span>
              </div>
              <p className="text-[10px] md:text-[11px] text-gray-500 font-medium truncate mt-0.5">
                {selectedTimeline ? `현재 협업: #${selectedTimeline.proposalTitle}` : '모든 협업을 함께 보고 업무를 도와드려요'}
              </p>
            </div>

            {/* Model selector — Gemini (free, membership) vs Claude (premium credits).
                Switching keeps the same conversation; neither model forgets the other. */}
            <div className="shrink-0 flex items-center gap-1.5">
              {aiModel === 'claude' && claudeData?.credits.planActive && (
                <button
                  type="button"
                  onClick={() => setClaudeModalOpen(true)}
                  title="클로드 크레딧 관리"
                  className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-[11px] font-black hover:bg-orange-100 transition-colors"
                >
                  🪙 {(claudeData.credits.balanceKrw || 0).toLocaleString()}원
                </button>
              )}
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setAiModel('gemini')}
                  className={`px-2 md:px-2.5 py-1 rounded-md text-[11px] md:text-xs font-bold transition-all ${
                    aiModel === 'gemini' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ✨ 제미나이
                </button>
                <button
                  type="button"
                  onClick={() => setAiModel('claude')}
                  className={`px-2 md:px-2.5 py-1 rounded-md text-[11px] md:text-xs font-bold transition-all ${
                    aiModel === 'claude' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🤖 클로드
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Membership gate (Gemini only — Claude is gated by its own plan/wallet) */}
        {aiModel === 'gemini' && aiEnabled === false ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <span className="text-2xl leading-none">✨</span>
              </div>
              <h3 className="text-base font-extrabold text-gray-900 mb-1.5">AI 어시스턴트는 AI 멤버십 전용 기능입니다</h3>
              <p className="text-xs text-gray-500 leading-relaxed mb-5">
                스탠다드 AI 멤버십(6,900원) 또는 커머스 멤버십(13,900원)을 구독하면 협업 대화 요약, 일정 정리, 답장 초안 작성을 바로 이용할 수 있어요. 비즈니스 계정과 일반 계정 모두 동일한 멤버십으로 사용할 수 있습니다.
              </p>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('navigate-membership'))}
                className="px-5 py-2.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg"
              >
                멤버십 플랜 보기
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-3 md:py-4 pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-4 scrollbar-hide">
              {aiMessages.length === 0 && (
                <div className="max-w-lg mx-auto text-center pt-4 md:pt-8">
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center mx-auto mb-3 shadow-lg">
                    <span className="text-xl md:text-2xl leading-none">✨</span>
                  </div>
                  <h3 className="text-sm md:text-base font-extrabold text-gray-900 mb-1">무엇을 도와드릴까요?</h3>
                  <p className="text-[11px] md:text-xs text-gray-500 leading-relaxed mb-4">
                    모든 협업을 한눈에 파악해 드려요. 대화 중인 업체 현황, 답장이 필요한 협업, 답장 초안은 물론 계약·정산·세금·광고 표시 같은 업무·법률 질문까지 물어보세요.
                  </p>
                  <div className="flex flex-col gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendAiMessage(s)}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[12px] md:text-[13px] font-semibold text-gray-700 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-all"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 md:space-y-4 max-w-3xl mx-auto">
                {aiMessages.map((m, idx) => (
                  <div key={idx} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gradient-to-br from-violet-500 to-blue-600 text-white'
                    }`}>
                      {m.role === 'user' ? getInitials(normalizedUserName) : '✨'}
                    </div>
                    <div className={`min-w-0 max-w-[82%] ${m.role === 'user' ? 'text-right' : ''}`}>
                      <div className={`inline-block px-3 py-2 md:px-3.5 md:py-2.5 rounded-2xl text-[13px] md:text-[15px] leading-[1.6] break-words text-left ${
                        m.role === 'user'
                          ? 'bg-blue-50 border border-blue-100 text-gray-900 rounded-tr-sm whitespace-pre-wrap'
                          : 'bg-gray-50 border border-gray-100 text-gray-900 rounded-tl-sm'
                      }`}>
                        {m.role === 'assistant'
                          ? <AiMarkdown content={m.content} />
                          : m.content}
                      </div>
                    </div>
                  </div>
                ))}

                {aiLoading && (
                  <div className="flex gap-2.5">
                    <div className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-xs">✨</div>
                    <div className="inline-flex items-center gap-1 px-3.5 py-3 rounded-2xl rounded-tl-sm bg-gray-50 border border-gray-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
                <div ref={aiEndRef} />
              </div>
            </div>

            {/* Composer */}
            <div className="fixed bottom-0 left-0 right-0 md:static md:bottom-auto px-2 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] md:px-5 md:pb-4 pt-1.5 md:pt-2 bg-white border-t border-gray-100 md:border-t-0 z-[120] md:z-10 md:shrink-0" style={{ touchAction: 'manipulation' }}>
              <div className="max-w-3xl mx-auto relative bg-white border-2 border-gray-300 rounded-lg overflow-hidden focus-within:border-violet-400 transition-all">
                <div className="flex items-end gap-1.5 md:gap-2 p-2 md:p-2.5">
                  <textarea
                    ref={aiInputRef}
                    value={aiInput}
                    onChange={(e) => {
                      setAiInput(e.target.value);
                      const ta = e.target;
                      ta.style.height = 'auto';
                      ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
                    }}
                    onKeyDown={handleAiKeyDown}
                    placeholder="AI에게 무엇이든 물어보세요..."
                    rows={1}
                    className="flex-1 bg-transparent text-[13px] md:text-[15px] text-gray-900 placeholder-gray-400 resize-none focus:outline-none py-1 px-1 leading-relaxed"
                    style={{ maxHeight: '80px' }}
                  />
                  <button
                    onClick={() => sendAiMessage(aiInput)}
                    disabled={!aiInput.trim() || aiLoading}
                    className={`shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all ${
                      aiInput.trim() && !aiLoading
                        ? 'bg-gradient-to-br from-violet-600 to-blue-600 text-white hover:opacity-90 active:scale-95'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14m-7-7l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              {aiModel === 'claude' && (
                <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 mt-1.5 px-1">
                  {claudeData?.credits.planActive ? (
                    <p className="text-[10px] md:text-[11px] text-gray-500 font-bold truncate">
                      🤖 클로드 · 남은 크레딧 <span className="text-orange-600">{(claudeData.credits.balanceKrw || 0).toLocaleString()}원</span>
                      {lastClaudeCost != null && <span className="text-gray-400 font-medium"> · 직전 답변 {lastClaudeCost.toLocaleString()}원</span>}
                      {claudeData.credits.autoRecharge && <span className="text-gray-400 font-medium"> · 자동충전 켜짐</span>}
                    </p>
                  ) : (
                    <p className="text-[10px] md:text-[11px] text-gray-500 font-bold truncate">
                      🤖 클로드는 클로드 플랜 전용이에요. 시작하면 기본 크레딧이 지급됩니다.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setClaudeModalOpen(true)}
                    className="shrink-0 text-[11px] font-black text-orange-600 hover:text-orange-700 px-2 py-1 rounded-lg border border-orange-200 hover:bg-orange-50 transition-colors"
                  >
                    {claudeData?.credits.planActive ? '크레딧 충전' : '클로드 플랜 시작'}
                  </button>
                </div>
              )}
              <p className="hidden md:block max-w-3xl mx-auto text-[10px] text-gray-400 font-medium mt-1.5 px-1">
                AI는 협업에 도움을 주기 위한 참고용이며, 중요한 내용은 직접 확인해 주세요.
              </p>
            </div>
          </>
        )}

        {claudeModalOpen && claudeData && (
          <ClaudePlanModal
            username={normalizedUserName}
            data={claudeData}
            onClose={() => setClaudeModalOpen(false)}
            onUpdated={(d) => setClaudeData(d)}
          />
        )}
      </div>
    );
  };

  // Mobile: show list or detail
  // Desktop: two-panel layout
  // When a conversation or the AI chat is open on mobile, the global bottom nav
  // is hidden, so the panel should fill the full viewport height and the
  // composer rests flush at the very bottom. In the list view the nav is still
  // visible, so leave room for it.
  const chatOpen = !!selectedTimeline || aiActive;
  // On desktop the whole app is rendered at `html { zoom: 0.75 }` (see index.css).
  // A plain `100vh` height is therefore scaled down to ~75% of the real viewport,
  // which left the panel's bottom edge floating in the middle of the page. Divide
  // by the zoom factor — the same compensation index.css applies to min-h-screen —
  // so the panel fills the full viewport height and its bottom sits at the very
  // bottom of the page.
  return (
    <div className={`${chatOpen ? 'h-[100dvh]' : 'h-[calc(100dvh-60px)]'} md:h-[calc(100vh/0.75)] w-full animate-in fade-in duration-300`}>
      {/* Desktop: Two-panel layout */}
      <div className="hidden md:flex h-full rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 shadow-lg shadow-gray-200/50">
        <div className="w-[320px] shrink-0">
          {renderSidebar()}
        </div>
        <div className="flex-1 min-w-0">
          {aiActive ? renderAiChat() : renderMessages()}
        </div>
      </div>

      {/* Mobile: Single panel */}
      <div className="md:hidden h-full overflow-hidden">
        {!aiActive && showList && !selectedTimeline ? (
          <div className="h-full overflow-hidden border-t border-gray-200">
            {renderSidebar()}
          </div>
        ) : (
          <div className="h-full overflow-hidden flex flex-col">
            {aiActive ? renderAiChat() : renderMessages()}
          </div>
        )}
      </div>
    </div>
  );
};

// Claude plan wallet management — activation, manual recharge, and auto-recharge.
// Rendered as a modal from the AI chat when the user picks Claude and either has
// no active plan or has run their credits down. Sold separately from memberships.
const krw = (n: number) => `${(n || 0).toLocaleString()}원`;

const ClaudePlanModal: React.FC<{
  username: string;
  data: ClaudeCreditsResponse;
  onClose: () => void;
  onUpdated: (d: ClaudeCreditsResponse) => void;
}> = ({ username, data, onClose, onUpdated }) => {
  const [payMethod, setPayMethod] = useState<ClaudePayMethod>('CARD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const credits = data.credits;
  const active = credits.planActive;

  const handleActivate = async () => {
    setError(null); setNotice(null); setBusy(true);
    const out = await payClaudePlan(username, 'activation', data.activationPriceKrw, payMethod);
    setBusy(false);
    if (!out.success || !out.result) { setError(out.error || '결제에 실패했습니다.'); return; }
    onUpdated(out.result);
    setNotice(`클로드 플랜이 시작되었어요. 기본 크레딧 ${krw(data.activationGrantKrw)}이 지급되었습니다.`);
  };

  const handleRecharge = async (amountKrw: number) => {
    setError(null); setNotice(null); setBusy(true);
    const out = await payClaudePlan(username, 'recharge', amountKrw, payMethod);
    setBusy(false);
    if (!out.success || !out.result) { setError(out.error || '충전에 실패했습니다.'); return; }
    onUpdated(out.result);
    setNotice(`${krw(amountKrw)} 크레딧이 충전되었습니다.`);
  };

  const handleAutoToggle = async () => {
    setError(null); setNotice(null); setBusy(true);
    try {
      if (credits.autoRecharge) {
        const res = await apiService.setClaudeAutoRecharge(username, { autoRecharge: false });
        if (!res.success) { setError(res.error || '설정 변경에 실패했습니다.'); return; }
        onUpdated(res as ClaudeCreditsResponse);
        setNotice('자동충전을 껐어요.');
      } else {
        // Enabling needs a billing key so the server can charge without a window.
        const issued = await issueClaudeBillingKey(username, payMethod);
        if (!issued.success || !issued.billingKey) { setError(issued.error || '결제수단 등록에 실패했습니다.'); return; }
        const res = await apiService.setClaudeAutoRecharge(username, {
          autoRecharge: true,
          billingKey: issued.billingKey,
        });
        if (!res.success) { setError(res.error || '설정 저장에 실패했습니다.'); return; }
        onUpdated(res as ClaudeCreditsResponse);
        setNotice(`크레딧이 ${krw(credits.autoRechargeAmountKrw)} 미만이 되면 자동으로 충전됩니다.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white text-sm">🤖</div>
            <div>
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Claude</p>
              <h3 className="text-base font-black text-slate-900">클로드 플랜</h3>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-xl" aria-label="닫기">×</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">{error}</div>}
          {notice && <div className="bg-green-50 border border-green-200 text-green-700 text-xs font-bold rounded-lg px-3 py-2">✓ {notice}</div>}

          {/* Payment method */}
          <div>
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
            <div className="grid grid-cols-3 gap-2">
              {CLAUDE_PAY_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPayMethod(m.id)}
                  className={`py-2.5 px-2 rounded-xl border-2 text-xs font-bold transition-all ${
                    payMethod === m.id ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {!active ? (
            <>
              <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs font-black text-orange-500 uppercase tracking-widest mb-1">플랜 시작</p>
                <p className="text-3xl font-black text-orange-700">{krw(data.activationPriceKrw)}</p>
                <p className="text-xs font-bold text-orange-600 mt-2">결제 즉시 기본 크레딧 {krw(data.activationGrantKrw)} 지급</p>
                <ul className="mt-3 space-y-1.5 text-[12px] text-slate-600">
                  <li className="flex items-start gap-2"><span className="text-orange-500 font-bold">✓</span>협업 타임라인 AI를 <strong>Claude</strong>로 사용 (깊은 분석·문서 검토에 강함)</li>
                  <li className="flex items-start gap-2"><span className="text-orange-500 font-bold">✓</span>사용한 토큰만큼만 크레딧 차감 · 남는 크레딧은 이월</li>
                  <li className="flex items-start gap-2"><span className="text-orange-500 font-bold">✓</span>크레딧 소진 시 재충전 또는 자동충전 선택</li>
                  <li className="flex items-start gap-2"><span className="text-orange-500 font-bold">✓</span>제미나이(무료 기본)는 그대로 사용 가능</li>
                </ul>
              </div>
              <button
                type="button"
                onClick={handleActivate}
                disabled={busy}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all shadow-md disabled:opacity-50"
              >
                {busy ? '처리 중...' : `${krw(data.activationPriceKrw)}으로 클로드 플랜 시작`}
              </button>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                클로드 플랜은 멤버십과 별도로 결제되는 선불 크레딧입니다. 결제 시점에 표시 금액만 결제되며, 자동충전을 켜기 전에는 자동으로 결제되지 않습니다.
              </p>
            </>
          ) : (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">남은 크레딧</p>
                <p className="text-3xl font-black text-slate-900">{krw(credits.balanceKrw)}</p>
                {credits.balanceKrw <= 0 && (
                  <p className="text-xs font-bold text-red-500 mt-1.5">크레딧을 모두 사용했어요. 충전하면 계속 이용할 수 있습니다.</p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">크레딧 충전</p>
                <div className="grid grid-cols-3 gap-2">
                  {data.rechargePacksKrw.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => handleRecharge(amt)}
                      disabled={busy}
                      className="py-3 px-2 rounded-xl border-2 border-orange-200 bg-white text-orange-700 text-sm font-black hover:bg-orange-50 transition-all disabled:opacity-50"
                    >
                      {krw(amt)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">자동충전</p>
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                    잔액이 {krw(credits.autoRechargeAmountKrw)} 미만이면 {krw(credits.autoRechargeAmountKrw)}을 자동으로 충전합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoToggle}
                  disabled={busy}
                  className={`shrink-0 relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${credits.autoRecharge ? 'bg-orange-500' : 'bg-slate-300'}`}
                  aria-pressed={credits.autoRecharge}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${credits.autoRecharge ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                자동충전을 켜면 결제 수단(빌링키)을 등록하고, 잔액이 부족할 때 등록된 수단으로 자동 결제됩니다. 하루 자동충전 횟수에는 안전 상한이 있습니다. 언제든 끌 수 있어요.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessTimeline;
