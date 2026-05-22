
import React, { useState, useEffect, useRef, useCallback } from 'react';

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
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-base font-extrabold text-gray-900 tracking-tight">협업 메시지</h2>
            {totalUnread > 0 && (
              <span className="bg-purple-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full">
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
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300/30 transition-all"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
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
                    setSelectedTimeline(timeline);
                    fetchTimelineDetail(timeline.proposalId, true);
                    setShowList(false);
                  }}
                  className={`w-full text-left px-3 py-3 rounded-xl transition-all group ${
                    isActive
                      ? 'bg-purple-50 border border-purple-200'
                      : isUnread
                        ? 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                        : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Avatar */}
                    <div className={`shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center text-xs md:text-sm font-bold ${
                      isActive
                        ? 'bg-purple-500 text-white'
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
                      <p className="text-[11px] md:text-xs text-purple-600 font-semibold truncate mb-0.5 md:mb-1">
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
                          <span className="shrink-0 bg-purple-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1.5 rounded-full">
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
              <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto py-3 md:py-4 pb-[68px] md:pb-4 scrollbar-hide">
          {/* Channel intro (Slack-style) */}
          <div className="px-3 md:px-5 pb-2 md:pb-4 mb-1 md:mb-2">
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mb-2 md:mb-3">
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
                          <span className="text-[10px] md:text-[11px] font-semibold px-1 md:px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">
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
                      <div className={`inline-block max-w-full ${isMe ? 'bg-purple-50 border border-purple-100 rounded-2xl rounded-tr-sm px-2.5 py-1.5 md:px-3.5 md:py-2' : 'md:bg-transparent md:border-0 md:rounded-none md:px-0 md:py-0 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-2.5 py-1.5 md:px-3.5 md:py-2'}`}>
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

        {/* Message Composer (fixed at bottom on mobile) */}
        <div className="fixed bottom-[calc(60px+env(safe-area-inset-bottom,0px))] left-0 right-0 md:static md:bottom-auto px-2 pb-1 md:px-5 md:pb-4 pt-1.5 md:pt-2 bg-white border-t border-gray-100 md:border-t-0 z-20 md:z-10 md:shrink-0" style={{ touchAction: 'manipulation' }}>
          <div
            onDragOver={handleComposerDragOver}
            onDragEnter={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            className={`relative bg-white border-2 rounded-lg overflow-hidden focus-within:border-gray-400 transition-all ${
              isDragOverComposer ? 'border-purple-400 ring-2 ring-purple-400/35' : 'border-gray-300'
            }`}
          >
            {isDragOverComposer && (
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-purple-50/80 backdrop-blur-[1px]">
                <div className="px-3 py-2 rounded-lg border border-purple-300 bg-white/90 text-[12px] font-semibold text-purple-600">
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
                className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-purple-500 transition-colors"
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
                    ? 'bg-purple-600 text-white hover:bg-purple-500 active:scale-95'
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
                <span className="text-[11px] text-purple-500 font-medium">
                  Enter로 전송
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Mobile: show list or detail
  // Desktop: two-panel layout
  return (
    <div className="h-[calc(100vh-60px)] md:h-[calc(100vh-2rem)] w-full animate-in fade-in duration-300">
      {/* Desktop: Two-panel layout */}
      <div className="hidden md:flex h-full rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 shadow-lg shadow-gray-200/50">
        <div className="w-[320px] shrink-0">
          {renderSidebar()}
        </div>
        <div className="flex-1 min-w-0">
          {renderMessages()}
        </div>
      </div>

      {/* Mobile: Single panel */}
      <div className="md:hidden h-full overflow-hidden">
        {showList && !selectedTimeline ? (
          <div className="h-full overflow-hidden border-t border-gray-200">
            {renderSidebar()}
          </div>
        ) : (
          <div className="h-full overflow-hidden flex flex-col">
            {renderMessages()}
          </div>
        )}
      </div>
    </div>
  );
};

export default BusinessTimeline;
