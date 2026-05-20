(function () {
  "use strict";

  var campaignPanelOpen = false;
  var campaignData = [];
  var campaignFilter = "";
  var panelEl = null;
  var debounceTimer = null;

  function getSession() {
    try {
      var raw = localStorage.getItem("picks_user_session");
      if (!raw) return null;
      try {
        var parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && parsed.username) return parsed;
        if (typeof parsed === "string" && parsed) return { username: parsed, role: "user" };
      } catch (e) {}
      return raw.trim() ? { username: raw.trim(), role: "user" } : null;
    } catch (e) { return null; }
  }

  function esc(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function typeLabel(t) {
    return { collaboration: "협업", advertisement: "광고/협찬", review: "리뷰", event: "이벤트" }[t] || t;
  }

  function typeBadgeColor(t) {
    return {
      collaboration: "background:rgba(124,58,237,.2);color:#7c3aed",
      advertisement: "background:rgba(239,68,68,.12);color:#ef4444",
      review: "background:rgba(59,130,246,.2);color:#3b82f6",
      event: "background:rgba(16,185,129,.2);color:#10b981"
    }[t] || "background:rgba(100,116,139,.2);color:#94a3b8";
  }

  function rewardIcon(t) {
    return { cash: "💰", product: "🎁", commission: "📊", mixed: "✨" }[t] || "💎";
  }

  function categoryLabel(c) {
    return { beauty: "뷰티", fashion: "패션", food: "식품", tech: "테크", lifestyle: "라이프스타일", travel: "여행", health: "건강", other: "기타" }[c] || c;
  }

  function formatDate(d) {
    if (!d) return "";
    var date = new Date(d);
    if (isNaN(date.getTime())) return d;
    var y = date.getFullYear();
    var m = ("0" + (date.getMonth() + 1)).slice(-2);
    var dd = ("0" + date.getDate()).slice(-2);
    return y + "." + m + "." + dd;
  }

  async function fetchCampaigns(filter, search) {
    var url = new URL("/api/campaigns", location.origin);
    url.searchParams.set("status", "active");
    if (filter) url.searchParams.set("type", filter);
    if (search) url.searchParams.set("search", search);
    var res = await fetch(url);
    var data = await res.json();
    return data.campaigns || [];
  }

  async function checkApplication(campaignId, username) {
    var res = await fetch("/api/campaign-applications?campaign_id=" + encodeURIComponent(campaignId) + "&applicant=" + encodeURIComponent(username));
    return res.json();
  }

  async function submitApp(payload) {
    var res = await fetch("/api/campaign-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  function renderCampaignCard(c, compact) {
    var rewardText = c.reward_amount
      ? esc(c.reward_amount) + ' <span style="font-size:12px;color:#94a3b8;font-weight:500">' + ({fixed:"리워드",product:"제품제공",revenue_share:"수익배분",mixed:"복합"}[c.reward_type]||"리워드") + '</span>'
      : "";
    var applicantInfo = c.max_applicants > 0
      ? (c.max_applicants + "명 모집 | " + (c.application_count || 0) + "명 신청함")
      : ((c.application_count || 0) + "명 신청함");
    var endDate = c.end_date ? formatDate(c.end_date) + " 마감" : "";
    var daysLeft = "";
    if (c.end_date) {
      var diff = Math.ceil((new Date(c.end_date).getTime() - Date.now()) / (1000*60*60*24));
      if (diff === 0) daysLeft = "오늘 마감";
      else if (diff > 0 && diff <= 7) daysLeft = "D-" + diff;
    }

    var thumbHtml;
    if (c.thumbnail_url) {
      thumbHtml = '<div class="ci-card-thumb"><img src="' + esc(c.thumbnail_url) + '" alt="" style="width:100%;height:100%;object-fit:cover" /></div>';
    } else {
      thumbHtml = '<div class="ci-card-thumb ci-card-thumb-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="1.5"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>';
    }

    if (compact) {
      return '<div class="ci-card ci-card-compact" data-id="' + esc(c.id) + '">'
        + '<div style="display:flex;gap:12px">'
        + '<div class="ci-card-thumb-sm">' + (c.thumbnail_url ? '<img src="' + esc(c.thumbnail_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />' : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#f3e8ff,#fce7f3);border-radius:10px;display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="1.5"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>') + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
        + '<span class="ci-badge" style="' + typeBadgeColor(c.type) + '">' + typeLabel(c.type) + '</span>'
        + (c.brand_name ? '<span style="font-size:11px;color:#64748b;font-weight:600">' + esc(c.brand_name) + '</span>' : '')
        + '</div>'
        + '<div style="font-size:13px;font-weight:700;line-height:1.4;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.title) + '</div>'
        + (rewardText ? '<div style="font-size:14px;font-weight:800;color:#ef4444;margin-top:3px">' + rewardText + '</div>' : '')
        + '</div>'
        + '</div>'
        + '</div>';
    }

    return '<div class="ci-card" data-id="' + esc(c.id) + '">'
      + '<div style="display:flex;gap:14px;align-items:stretch">'
      + thumbHtml
      + '<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">'
      + '<div>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">'
      + '<span class="ci-badge" style="' + typeBadgeColor(c.type) + '">' + typeLabel(c.type) + '</span>'
      + (daysLeft ? '<span class="ci-badge" style="background:rgba(239,68,68,.1);color:#ef4444">' + daysLeft + '</span>' : '')
      + (c.brand_name ? '<span style="font-size:12px;color:#64748b;font-weight:600">' + esc(c.brand_name) + '</span>' : '')
      + '</div>'
      + '<div style="font-size:15px;font-weight:700;line-height:1.4;margin-bottom:4px;color:#1e293b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(c.title)
      + (c.description ? ' <span style="font-weight:400;color:#94a3b8">' + esc(c.description).substring(0, 40) + '</span>' : '')
      + '</div>'
      + (rewardText ? '<div style="font-size:15px;font-weight:800;color:#ef4444;margin-bottom:4px">' + rewardText + '</div>' : '')
      + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between">'
      + '<span style="font-size:11px;color:#94a3b8;font-weight:500">' + applicantInfo + (endDate ? ' · ' + endDate : '') + '</span>'
      + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;flex-shrink:0">'
      + '<button class="ci-apply-quick-btn" data-id="' + esc(c.id) + '">신청하기</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function createCampaignPanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement("div");
    panelEl.id = "campaignPanel";
    panelEl.innerHTML = '<div class="ci-panel-header">'
      + '<button class="ci-back-btn" id="ciPanelClose">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'
      + " 뒤로"
      + "</button>"
      + '<span style="font-size:17px;font-weight:700">캠페인 <span style="color:#a78bfa">협업</span></span>'
      + "</div>"
      + '<div class="ci-panel-body">'
      + '<div class="ci-search-bar">'
      + '<input type="text" id="ciSearch" placeholder="캠페인 검색..." />'
      + '<button id="ciSearchBtn">검색</button>'
      + "</div>"
      + '<div class="ci-filter-row">'
      + '<button class="ci-chip active" data-filter="">전체</button>'
      + '<button class="ci-chip" data-filter="advertisement">광고/협찬</button>'
      + '<button class="ci-chip" data-filter="collaboration">협업</button>'
      + '<button class="ci-chip" data-filter="review">리뷰</button>'
      + '<button class="ci-chip" data-filter="event">이벤트</button>'
      + "</div>"
      + '<div id="ciCampaignList" class="ci-campaign-list">'
      + '<div class="ci-loading">캠페인을 불러오는 중...</div>'
      + "</div>"
      + "</div>";

    document.body.appendChild(panelEl);

    panelEl.querySelector("#ciPanelClose").onclick = closeCampaignPanel;
    panelEl.querySelector("#ciSearchBtn").onclick = function () { loadPanelCampaigns(); };
    panelEl.querySelector("#ciSearch").onkeydown = function (ev) {
      if (ev.key === "Enter") loadPanelCampaigns();
    };

    panelEl.querySelectorAll(".ci-chip").forEach(function (chip) {
      chip.onclick = function () {
        panelEl.querySelectorAll(".ci-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        campaignFilter = chip.getAttribute("data-filter");
        loadPanelCampaigns();
      };
    });

    return panelEl;
  }

  function openCampaignPanel() {
    var p = createCampaignPanel();
    p.classList.add("open");
    campaignPanelOpen = true;
    updateSidebarActiveState();
    loadPanelCampaigns();
  }

  function closeCampaignPanel() {
    if (panelEl) panelEl.classList.remove("open");
    campaignPanelOpen = false;
    updateSidebarActiveState();
  }

  function updateSidebarActiveState() {
    document.querySelectorAll(".ci-sidebar-item, .ci-bottom-item").forEach(function (btn) {
      if (campaignPanelOpen) {
        btn.setAttribute("data-active", "true");
      } else {
        btn.removeAttribute("data-active");
      }
    });

    if (campaignPanelOpen) {
      document.body.classList.add("ci-panel-open");
    } else {
      document.body.classList.remove("ci-panel-open");
    }
  }

  async function loadPanelCampaigns() {
    var listEl = document.getElementById("ciCampaignList");
    if (!listEl) return;
    listEl.innerHTML = '<div class="ci-loading">불러오는 중...</div>';

    try {
      var searchEl = document.getElementById("ciSearch");
      var search = searchEl ? searchEl.value.trim() : "";
      campaignData = await fetchCampaigns(campaignFilter, search);

      if (campaignData.length === 0) {
        listEl.innerHTML = '<div class="ci-empty"><div style="font-size:40px;opacity:.5;margin-bottom:12px">🔍</div>'
          + '<div>조건에 맞는 캠페인이 없습니다.<br/>다른 유형으로 검색해 보세요!</div></div>';
        return;
      }

      listEl.innerHTML = campaignData.map(function (c) { return renderCampaignCard(c, false); }).join("");
      bindCardClicks(listEl);
    } catch (e) {
      listEl.innerHTML = '<div class="ci-empty">캠페인을 불러오지 못했습니다.</div>';
    }
  }

  function bindCardClicks(container) {
    container.querySelectorAll(".ci-card").forEach(function (card) {
      card.onclick = function (ev) {
        if (ev.target.closest && ev.target.closest(".ci-apply-quick-btn")) return;
        openCampaignDetail(card.getAttribute("data-id"));
      };
    });
    container.querySelectorAll(".ci-apply-quick-btn").forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.stopPropagation();
        var id = btn.getAttribute("data-id");
        var session = getSession();
        if (!session) {
          alert("로그인 후 지원 가능합니다.");
          return;
        }
        campaignData = campaignData.length ? campaignData : [];
        openCampaignDetail(id);
      };
    });
  }

  function openCampaignDetail(id) {
    var c = campaignData.find(function (x) { return x.id === id; });
    if (!c) return;

    var session = getSession();
    var overlay = document.createElement("div");
    overlay.className = "ci-detail-overlay open";

    var rewardInfo = "";
    if (c.reward_type || c.reward_amount) {
      var rtLabel = { fixed: "고정 금액", product: "제품 제공", revenue_share: "수익 배분", mixed: "복합" }[c.reward_type] || "";
      rewardInfo = '<div class="ci-detail-info-item" style="background:linear-gradient(135deg,#fef2f2,#fff1f2);border-color:#fecdd3"><div class="ci-detail-info-label" style="color:#ef4444">리워드</div>'
        + '<div class="ci-detail-info-value" style="color:#ef4444;font-size:17px">' + (c.reward_amount ? esc(c.reward_amount) : "") + (rtLabel ? '<span style="font-size:12px;color:#f87171;margin-left:6px">' + rtLabel + '</span>' : "") + "</div></div>";
    }

    var thumbnailHtml = "";
    if (c.thumbnail_url) {
      thumbnailHtml = '<div style="width:100%;height:200px;border-radius:14px;overflow:hidden;margin-bottom:16px;background:#f1f5f9"><img src="' + esc(c.thumbnail_url) + '" alt="" style="width:100%;height:100%;object-fit:cover" /></div>';
    }

    overlay.innerHTML = '<div class="ci-detail-header-bar">'
      + '<button class="ci-back-btn ci-detail-close">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'
      + " 뒤로</button></div>"
      + '<div class="ci-detail-body">'
      + thumbnailHtml
      + '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
      + '<span class="ci-badge" style="' + typeBadgeColor(c.type) + '">' + typeLabel(c.type) + "</span>"
      + '<span class="ci-badge" style="background:rgba(16,185,129,.15);color:#10b981">진행중</span>'
      + (c.category ? '<span class="ci-badge" style="background:rgba(100,116,139,.15);color:#94a3b8">' + categoryLabel(c.category) + "</span>" : "")
      + "</div>"
      + '<div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:8px">' + esc(c.title) + "</div>"
      + (c.brand_name ? '<div style="font-size:15px;color:#a78bfa;font-weight:600;margin-bottom:16px">' + esc(c.brand_name) + "</div>" : "")
      + (c.description ? '<div style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:20px;white-space:pre-wrap">' + esc(c.description) + "</div>" : "")
      + '<div class="ci-detail-info-grid">'
      + rewardInfo
      + '<div class="ci-detail-info-item"><div class="ci-detail-info-label">지원 현황</div>'
      + '<div class="ci-detail-info-value">' + (c.application_count || 0) + "명" + (c.max_applicants > 0 ? " / " + c.max_applicants + "명" : "") + "</div></div>"
      + (c.start_date ? '<div class="ci-detail-info-item"><div class="ci-detail-info-label">시작일</div><div class="ci-detail-info-value">' + formatDate(c.start_date) + "</div></div>" : "")
      + (c.end_date ? '<div class="ci-detail-info-item"><div class="ci-detail-info-label">종료일</div><div class="ci-detail-info-value">' + formatDate(c.end_date) + "</div></div>" : "")
      + "</div>"
      + (c.requirements ? '<div class="ci-detail-req"><div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:8px">참여 조건</div>'
        + '<div style="font-size:14px;line-height:1.6;color:#475569;white-space:pre-wrap">' + esc(c.requirements) + "</div></div>" : "")
      + "</div>"
      + '<div class="ci-apply-section"><div style="max-width:640px;margin:0 auto;padding:0 16px" id="ciApplyInner"></div></div>';

    document.body.appendChild(overlay);

    overlay.querySelector(".ci-detail-close").onclick = function () {
      overlay.classList.remove("open");
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 300);
    };

    var applyInner = overlay.querySelector("#ciApplyInner");

    if (!session) {
      applyInner.innerHTML = '<button class="ci-apply-btn" style="background:#e2e8f0;color:#94a3b8" disabled>로그인 후 지원 가능</button>';
      return;
    }

    applyInner.innerHTML = '<button class="ci-apply-btn" disabled>확인 중...</button>';

    checkApplication(c.id, session.username).then(function (appData) {
      if (appData.applied) {
        var st = appData.application.status;
        applyInner.innerHTML = '<button class="ci-apply-btn" style="background:#e2e8f0;color:#94a3b8" disabled>'
          + (st === "pending" ? "지원 완료 (검토중)" : st === "accepted" ? "수락됨 ✓" : "거절됨")
          + "</button>";
      } else {
        var isFull = c.max_applicants > 0 && (c.application_count || 0) >= c.max_applicants;
        applyInner.innerHTML = '<button class="ci-apply-btn" id="ciApplyBtn" ' + (isFull ? "disabled" : "") + ">"
          + (isFull ? "모집 마감" : "지원하기") + "</button>";

        if (!isFull) {
          var applyBtn = overlay.querySelector("#ciApplyBtn");
          if (applyBtn) {
            applyBtn.onclick = function () { openApplyModal(c.id, session.username, overlay); };
          }
        }
      }
    }).catch(function () {
      applyInner.innerHTML = '<button class="ci-apply-btn" disabled>상태 확인 실패</button>';
    });
  }

  function openApplyModal(campaignId, username, detailOverlay) {
    var modal = document.createElement("div");
    modal.className = "ci-modal-overlay open";
    modal.innerHTML = '<div class="ci-modal-content">'
      + '<div class="ci-modal-handle"></div>'
      + '<div style="font-size:18px;font-weight:700;margin-bottom:16px">캠페인 지원하기</div>'
      + '<div class="ci-form-group"><label>지원 메시지</label>'
      + '<textarea id="ciApplyMsg" class="ci-form-input" rows="4" placeholder="브랜드에게 전달할 메시지를 작성해 주세요"></textarea></div>'
      + '<div class="ci-form-group"><label>연락처</label>'
      + '<input type="text" id="ciApplyContact" class="ci-form-input" placeholder="이메일 또는 전화번호" /></div>'
      + '<div class="ci-form-group"><label>포트폴리오 URL (선택)</label>'
      + '<input type="url" id="ciApplyPortfolio" class="ci-form-input" placeholder="https://..." /></div>'
      + '<div id="ciApplyError" style="color:#ef4444;font-size:13px;margin-top:8px;text-align:center;display:none"></div>'
      + '<button id="ciSubmitApply" class="ci-submit-btn">지원하기</button>'
      + "</div>";

    document.body.appendChild(modal);

    modal.onclick = function (ev) {
      if (ev.target === modal) {
        modal.classList.remove("open");
        setTimeout(function () { if (modal.parentNode) modal.remove(); }, 300);
      }
    };

    modal.querySelector("#ciSubmitApply").onclick = async function () {
      var btn = modal.querySelector("#ciSubmitApply");
      var errEl = modal.querySelector("#ciApplyError");
      errEl.style.display = "none";
      btn.disabled = true;
      btn.textContent = "지원 중...";

      try {
        var result = await submitApp({
          campaign_id: campaignId,
          applicant_username: username,
          message: modal.querySelector("#ciApplyMsg").value.trim(),
          contact: modal.querySelector("#ciApplyContact").value.trim(),
          portfolio_url: modal.querySelector("#ciApplyPortfolio").value.trim(),
        });

        if (result.success || result.id) {
          modal.classList.remove("open");
          setTimeout(function () { if (modal.parentNode) modal.remove(); }, 300);
          if (detailOverlay) {
            detailOverlay.classList.remove("open");
            setTimeout(function () { if (detailOverlay.parentNode) detailOverlay.remove(); }, 300);
          }
          loadPanelCampaigns();
          loadDashboardWidget();
        } else {
          errEl.textContent = result.error || "지원에 실패했습니다.";
          errEl.style.display = "block";
        }
      } catch (e) {
        errEl.textContent = "네트워크 오류가 발생했습니다.";
        errEl.style.display = "block";
      }
      btn.disabled = false;
      btn.textContent = "지원하기";
    };
  }

  function isUserDashboard(navEl) {
    var text = navEl.textContent || "";
    if (text.indexOf("대시보드") < 0) return false;
    if (text.indexOf("비즈니스 제안") >= 0 || text.indexOf("보낸 제안") >= 0) return false;
    return true;
  }

  function findSeparator(navEl) {
    var children = navEl.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].tagName === "DIV" && children[i].className && children[i].className.indexOf("border-t") >= 0) {
        return children[i];
      }
    }
    return null;
  }

  function attachNavCloseHandlers(navEl) {
    var items = navEl.querySelectorAll("a, button");
    items.forEach(function (el) {
      if (el.classList.contains("ci-sidebar-item") || el.classList.contains("ci-back-btn")) return;
      if (el._ciNavClose) return;
      el._ciNavClose = true;
      el.addEventListener("click", function () {
        if (campaignPanelOpen) closeCampaignPanel();
      });
    });
  }

  function attachBottomNavCloseHandlers(gridEl) {
    if (!gridEl) return;
    var items = gridEl.querySelectorAll("button");
    items.forEach(function (el) {
      if (el.classList.contains("ci-bottom-item")) return;
      if (el._ciNavClose) return;
      el._ciNavClose = true;
      el.addEventListener("click", function () {
        if (campaignPanelOpen) closeCampaignPanel();
      });
    });
  }

  function injectSidebarItem(navEl) {
    if (navEl.querySelector(".ci-sidebar-item")) return;

    var sep = findSeparator(navEl);
    var btn = document.createElement("button");
    btn.className = "ci-sidebar-item";
    btn.innerHTML = '<span class="ci-sidebar-icon">🤝</span><span class="ci-sidebar-label">캠페인 협업</span>';
    btn.onclick = function (ev) {
      ev.stopPropagation();
      openCampaignPanel();
      closeMobileDrawer();
    };

    if (sep) {
      navEl.insertBefore(btn, sep);
    } else {
      navEl.appendChild(btn);
    }
  }

  function closeMobileDrawer() {
    document.querySelectorAll("aside").forEach(function (aside) {
      var parent = aside.parentElement;
      if (parent && parent.style && parent.className && parent.className.indexOf("fixed") >= 0 && parent.className.indexOf("inset-0") >= 0) {
        var closeBtn = aside.querySelector("button[aria-label]");
        if (closeBtn) closeBtn.click();
      }
    });
  }

  function findBottomNav() {
    var navs = document.querySelectorAll("nav");
    for (var i = 0; i < navs.length; i++) {
      var nav = navs[i];
      var cls = nav.className || "";
      if ((cls.indexOf("fixed-bottom-nav") >= 0) ||
          (cls.indexOf("fixed") >= 0 && cls.indexOf("bottom-0") >= 0 && cls.indexOf("md:hidden") >= 0)) {
        var grid = nav.querySelector("div");
        if (grid && grid.className && grid.className.indexOf("grid") >= 0) {
          return grid;
        }
      }
    }
    return null;
  }

  function injectBottomNavItem(gridEl) {
    if (!gridEl || gridEl.querySelector(".ci-bottom-item")) return;

    var match = gridEl.className.match(/grid-cols-(\d+)/);
    var cols = match ? parseInt(match[1]) : 5;
    gridEl.style.gridTemplateColumns = "repeat(" + (cols + 1) + ", minmax(0, 1fr))";

    var moreBtn = null;
    var buttons = gridEl.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var txt = (buttons[i].textContent || "").trim();
      if (txt.indexOf("더보기") >= 0 || txt.indexOf("⋯") >= 0) {
        moreBtn = buttons[i];
        break;
      }
    }

    var btn = document.createElement("button");
    btn.className = "ci-bottom-item";
    btn.innerHTML = '<span style="font-size:1.125rem;line-height:1;margin-bottom:2px">🤝</span>'
      + '<span style="font-size:11px;font-weight:900;letter-spacing:-0.04em;white-space:nowrap">캠페인</span>';
    btn.onclick = function () { openCampaignPanel(); };

    if (moreBtn) {
      gridEl.insertBefore(btn, moreBtn);
    } else {
      gridEl.appendChild(btn);
    }
  }

  function findDashboardGrid() {
    var grids = document.querySelectorAll("div");
    for (var i = 0; i < grids.length; i++) {
      var cls = grids[i].className || "";
      if (cls.indexOf("grid") >= 0 && cls.indexOf("grid-cols-1") >= 0 && cls.indexOf("md:grid-cols-2") >= 0 && cls.indexOf("gap-4") >= 0) {
        return grids[i];
      }
    }
    return null;
  }

  async function loadDashboardWidget() {
    var widget = document.getElementById("ciDashWidget");
    if (!widget) return;

    var listEl = widget.querySelector(".ci-widget-list");
    if (!listEl) return;

    try {
      var camps = await fetchCampaigns("", "");
      var top = camps.slice(0, 3);

      if (top.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">현재 진행 중인 캠페인이 없습니다.</div>';
        return;
      }

      listEl.innerHTML = top.map(function (c) { return renderCampaignCard(c, true); }).join("");

      listEl.querySelectorAll(".ci-card").forEach(function (card) {
        card.onclick = function () {
          campaignData = camps;
          openCampaignDetail(card.getAttribute("data-id"));
        };
      });
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">캠페인 정보를 불러오지 못했습니다.</div>';
    }
  }

  function injectDashboardWidget() {
    if (document.getElementById("ciDashWidget")) return;
    if (!getSession()) return;

    var dashGrid = findDashboardGrid();
    if (!dashGrid) return;

    var widget = document.createElement("div");
    widget.id = "ciDashWidget";
    widget.className = "ci-dash-widget";
    widget.innerHTML = '<div class="ci-widget-header">'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:18px">🤝</span>'
      + '<span style="font-size:14px;font-weight:800;color:#1e293b">캠페인 협업</span>'
      + "</div>"
      + '<button class="ci-widget-more" id="ciWidgetMore">전체보기 →</button>'
      + "</div>"
      + '<div class="ci-widget-list"><div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">불러오는 중...</div></div>';

    dashGrid.parentNode.insertBefore(widget, dashGrid);

    widget.querySelector("#ciWidgetMore").onclick = function () { openCampaignPanel(); };
    loadDashboardWidget();
  }

  function processDOM() {
    var navEls = document.querySelectorAll("nav");
    navEls.forEach(function (navEl) {
      var cls = navEl.className || "";
      if (cls.indexOf("flex-1") >= 0 && cls.indexOf("space-y-1") >= 0 && isUserDashboard(navEl)) {
        injectSidebarItem(navEl);
        attachNavCloseHandlers(navEl);
      }
    });

    var bottomGrid = findBottomNav();
    if (bottomGrid) {
      injectBottomNavItem(bottomGrid);
      attachBottomNavCloseHandlers(bottomGrid);
    }

    var dashGrid = findDashboardGrid();
    if (dashGrid && !document.getElementById("ciDashWidget")) {
      injectDashboardWidget();
    }

    if (campaignPanelOpen) {
      updateSidebarActiveState();
    }
  }

  function observeDOM() {
    var observer = new MutationObserver(function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processDOM, 100);
    });

    var root = document.getElementById("root");
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }

    processDOM();
  }

  function injectStyles() {
    var style = document.createElement("style");
    style.id = "ci-styles";
    style.textContent =
      '#campaignPanel{position:fixed;top:0;right:0;bottom:0;left:0;z-index:49;background:#fff;color:#1e293b;display:none;flex-direction:column;overflow:hidden}'
      + '@media(min-width:768px){#campaignPanel{left:256px}}'
      + '#campaignPanel.open{display:flex}'
      + '.ci-panel-header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 16px}'
      + '.ci-panel-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;max-width:640px;margin:0 auto;width:100%;padding:16px}'
      + '.ci-back-btn{background:none;border:none;color:#64748b;display:flex;align-items:center;gap:6px;font-size:14px;padding:0;cursor:pointer;font-family:inherit}'
      + '.ci-back-btn:hover{color:#1e293b}'
      + '.ci-search-bar{display:flex;gap:8px;margin-bottom:12px}'
      + '.ci-search-bar input{flex:1;padding:10px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;color:#1e293b;font-size:14px;outline:none;font-family:inherit}'
      + '.ci-search-bar input:focus{border-color:#7c3aed}'
      + '.ci-search-bar input::placeholder{color:#94a3b8}'
      + '.ci-search-bar button{padding:10px 16px;background:#7c3aed;color:#fff;border-radius:10px;font-size:14px;font-weight:500;border:none;cursor:pointer;font-family:inherit}'
      + '.ci-filter-row{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}'
      + '.ci-chip{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:500;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;transition:all .15s;font-family:inherit}'
      + '.ci-chip.active{background:#7c3aed;color:#fff}'
      + '.ci-chip:hover{background:#e2e8f0}'
      + '.ci-chip.active:hover{background:#6d28d9}'
      + '.ci-campaign-list{display:flex;flex-direction:column;gap:12px;padding-bottom:24px}'
      + '.ci-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px;transition:border-color .2s,box-shadow .2s;cursor:pointer}'
      + '.ci-card:hover{border-color:#7c3aed;box-shadow:0 2px 12px rgba(124,58,237,.08)}'
      + '.ci-card-compact{padding:12px}'
      + '.ci-card-thumb{width:88px;height:88px;border-radius:12px;overflow:hidden;flex-shrink:0;background:#f1f5f9}'
      + '.ci-card-thumb-empty{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f3e8ff,#fce7f3)}'
      + '.ci-card-thumb-sm{width:56px;height:56px;flex-shrink:0}'
      + '.ci-apply-quick-btn{padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:inherit}'
      + '.ci-apply-quick-btn:hover{background:#6d28d9}'
      + '.ci-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap}'
      + '.ci-loading{text-align:center;padding:40px;color:#64748b;font-size:14px}'
      + '.ci-empty{text-align:center;padding:48px 24px;color:#64748b;font-size:14px;line-height:1.6}'
      + '.ci-detail-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:50;background:#fff;color:#1e293b;overflow-y:auto;-webkit-overflow-scrolling:touch;display:none}'
      + '@media(min-width:768px){.ci-detail-overlay{left:256px}}'
      + '.ci-detail-overlay.open{display:block}'
      + '.ci-detail-header-bar{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid #e2e8f0;display:flex;align-items:center;height:56px;padding:0 16px}'
      + '.ci-detail-body{max-width:640px;margin:0 auto;padding:20px 16px 40px}'
      + '.ci-detail-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}'
      + '.ci-detail-info-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px}'
      + '.ci-detail-info-label{font-size:11px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}'
      + '.ci-detail-info-value{font-size:15px;font-weight:600;color:#1e293b}'
      + '.ci-detail-req{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px}'
      + '.ci-apply-section{position:sticky;bottom:0;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid #e2e8f0;padding:16px}'
      + '.ci-apply-btn{width:100%;padding:16px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-size:16px;font-weight:700;border-radius:12px;border:none;cursor:pointer;font-family:inherit;transition:all .15s}'
      + '.ci-apply-btn:hover{opacity:.9}'
      + '.ci-apply-btn:disabled{opacity:.5;cursor:not-allowed}'
      + '.ci-modal-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:51;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:none;align-items:flex-end;justify-content:center}'
      + '@media(min-width:768px){.ci-modal-overlay{left:256px}}'
      + '.ci-modal-overlay.open{display:flex}'
      + '.ci-modal-content{width:100%;max-width:640px;background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 32px;border-top:1px solid #e2e8f0;max-height:80dvh;overflow-y:auto}'
      + '.ci-modal-handle{width:36px;height:4px;background:#cbd5e1;border-radius:4px;margin:0 auto 20px}'
      + '.ci-form-group{margin-bottom:14px}'
      + '.ci-form-group label{display:block;font-size:13px;color:#64748b;margin-bottom:6px;font-weight:500}'
      + '.ci-form-input{width:100%;padding:12px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;color:#1e293b;font-size:15px;outline:none;font-family:inherit;box-sizing:border-box}'
      + '.ci-form-input:focus{border-color:#7c3aed}'
      + '.ci-form-input::placeholder{color:#475569}'
      + 'textarea.ci-form-input{resize:vertical;min-height:80px}'
      + '.ci-submit-btn{width:100%;padding:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-size:15px;font-weight:600;border-radius:10px;border:none;cursor:pointer;font-family:inherit;margin-top:8px;transition:all .15s}'
      + '.ci-submit-btn:hover{opacity:.9;transform:translateY(-1px)}'
      + '.ci-submit-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}'
      + '.ci-sidebar-item{width:100%;display:flex;align-items:center;gap:12px;padding:12px 20px;border-radius:16px;font-weight:900;font-size:14px;transition:all .2s;text-align:left;position:relative;cursor:pointer;border:none;font-family:inherit;background:transparent;color:#94a3b8}'
      + '.ci-sidebar-item:hover{background:rgba(255,255,255,.05);color:#fff}'
      + '.ci-sidebar-item[data-active="true"]{background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;box-shadow:0 8px 24px rgba(124,58,237,.4)}'
      + '.ci-sidebar-item[data-active="true"]::before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:24px;background:#fff;border-radius:0 4px 4px 0}'
      + '.ci-sidebar-icon{font-size:18px;transition:transform .3s}'
      + '.ci-sidebar-item:hover .ci-sidebar-icon{transform:scale(1.1)}'
      + '.ci-sidebar-label{transition:transform .3s}'
      + '.ci-sidebar-item:hover .ci-sidebar-label{transform:translateX(2px)}'
      + '.ci-bottom-item{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 2px;border-radius:12px;transition:all .15s;min-height:44px;background:none;border:none;cursor:pointer;font-family:inherit;color:#64748b}'
      + '.ci-bottom-item[data-active="true"]{color:#a78bfa}'
      + '.ci-dash-widget{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}'
      + '.ci-dash-widget .ci-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px}'
      + '.ci-dash-widget .ci-card:hover{border-color:#7c3aed;background:#f0f0ff}'
      + '.ci-dash-widget .ci-badge{font-size:10px;padding:2px 6px}'
      + '.ci-widget-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}'
      + '.ci-widget-more{background:none;border:none;color:#7c3aed;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;padding:4px 8px;border-radius:8px;transition:all .15s}'
      + '.ci-widget-more:hover{background:rgba(124,58,237,.08)}'
      + '.ci-widget-list{display:flex;flex-direction:column;gap:8px}'
      + '@media(min-width:768px){.ci-dash-widget{grid-column:1/-1;border-radius:24px;padding:20px 24px}}'
      + 'body.ci-panel-open nav button:not(.ci-sidebar-item):not(.ci-bottom-item){background:transparent!important;color:#94a3b8!important;box-shadow:none!important}'
      + 'body.ci-panel-open nav button:not(.ci-sidebar-item):not(.ci-bottom-item) div.absolute{display:none!important}'
      + 'body.ci-panel-open nav button:not(.ci-sidebar-item):not(.ci-bottom-item):hover{background:rgba(255,255,255,0.05)!important;color:#fff!important}'
      ;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", observeDOM);
    } else {
      observeDOM();
    }
  }

  init();
})();
