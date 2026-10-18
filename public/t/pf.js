/*
 * 픽스폴리오 판매 추적 스크립트 (카페24 몰 전체 페이지에 설치)
 *
 * 1) 모든 페이지: 주소에 ?pf={코드}가 있으면 7일 동안 이 브라우저에 저장한다.
 *    새 코드가 오면 덮어쓴다(마지막 클릭 인정).
 * 2) 주문완료 페이지: 저장된 코드가 7일 안이면 주문번호·결제금액·코드를 픽스폴리오로 보낸다.
 *    같은 주문은 한 번만 보낸다.
 *
 * 고객 이름·연락처·회원 정보는 읽지도 보내지도 않는다. 보낸 값은 픽스폴리오 서버가
 * 카페24 주문 API 로 다시 확인한 뒤에만 집계된다.
 */
(function () {
  try {
    var KEY = 'pf_ref';
    var TTL = 7 * 24 * 60 * 60 * 1000;
    var CODE = /^[a-z0-9]{6,20}$/;

    var me = document.currentScript;
    if (!me) {
      var all = document.getElementsByTagName('script');
      for (var i = 0; i < all.length; i++) {
        if ((all[i].src || '').indexOf('/t/pf.js') !== -1) { me = all[i]; break; }
      }
    }
    var src = me && me.src ? me.src : 'https://picks-folio.com/t/pf.js';
    var a = document.createElement('a');
    a.href = src;
    var origin = a.protocol + '//' + a.host;
    var mall = (src.match(/[?&]m=([^&#]+)/) || [])[1] || '';
    mall = decodeURIComponent(mall).toLowerCase();

    function param(name) {
      var m = location.search.match(new RegExp('[?&]' + name + '=([^&#]*)'));
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
    function setCookie(value, maxAgeSec) {
      try {
        document.cookie = KEY + '=' + encodeURIComponent(value) + ';path=/;max-age=' + maxAgeSec + ';SameSite=Lax';
      } catch (e) {}
    }
    function readCookie() {
      var m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    }
    function save(code) {
      var v = JSON.stringify({ c: code, t: Date.now() });
      try { localStorage.setItem(KEY, v); } catch (e) {}
      setCookie(v, TTL / 1000);
    }
    function load() {
      var raw = '';
      try { raw = localStorage.getItem(KEY) || ''; } catch (e) {}
      if (!raw) raw = readCookie();
      if (!raw) return null;
      try {
        var v = JSON.parse(raw);
        if (!v || !CODE.test(v.c) || Date.now() - Number(v.t) > TTL) return null;
        return v;
      } catch (e) { return null; }
    }

    // 1) 유입 코드 저장
    var incoming = (param('pf') || '').toLowerCase();
    if (CODE.test(incoming)) save(incoming);

    // 2) 주문완료 신호
    function orderInfo() {
      var d = window.EC_FRONT_EXTERNAL_SCRIPT_VARIABLE_DATA || {};
      var id = d.order_id || '';
      if (!id && /order_result/.test(location.pathname)) id = param('order_id');
      if (!id) return null;
      return { id: String(id), amount: Number(d.payed_amount || d.total_price || 0) || 0 };
    }
    function send(order, ref) {
      var sentKey = 'pf_sent_' + order.id;
      try { if (localStorage.getItem(sentKey)) return; localStorage.setItem(sentKey, '1'); } catch (e) {}
      var body = JSON.stringify({ m: mall, o: order.id, a: order.amount, c: ref.c });
      var url = origin + '/api/affiliate/collect';
      var ok = false;
      try {
        if (navigator.sendBeacon) ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      } catch (e) {}
      if (!ok && window.fetch) {
        try { fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true }); } catch (e) {}
      }
    }

    var tries = 0;
    (function check() {
      var ref = load();
      if (!ref || !mall) return;
      var order = orderInfo();
      if (order) return send(order, ref);
      // 주문 변수는 스크립트보다 늦게 채워질 수 있다. 주문완료 페이지에서만 잠깐 더 기다린다.
      if (/order_result/.test(location.pathname) && tries++ < 10) setTimeout(check, 500);
    })();
  } catch (e) {}
})();
