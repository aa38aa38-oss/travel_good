/* 北海道最強導遊 — 主程式（無任何付費 API） */
(function () {
  'use strict';
  var SPOTS = window.SPOTS || [], DAYS = window.DAYS || [], FAQ = window.FAQ || [], TODOS = window.TODOS || [];
  var $ = function (id) { return document.getElementById(id); };
  var byId = {}; SPOTS.forEach(function (s) { byId[s.id] = s; });

  var DAY_COLOR = ['#9E9E9E', '#E53935', '#1E88E5', '#43A047', '#8E24AA', '#8E24AA', '#FB8C00', '#00897B', '#111111', '#6D4C41', '#37474F'];
  var AREAS = window.AREAS || [];
  var CAT = { sight: '📸', food: '🍜', shop: '🛍', stay: '🏨', move: '🚉', city: '📰' };
  var TRIP_START = new Date(2027, 0, 10);

  /* ── 本機儲存 ── */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('hk_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('hk_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var prefs = store.get('prefs', { alert: true, sound: true, wake: true, sim: false, rate: 1 });
  var notified = store.get('notified', {});   // 已跳過通知
  var heard = store.get('heard', {});         // 已聽過
  var todoDone = store.get('todo', {});

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dist(a, b) {
    var R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' 公尺' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' 公里'; }
  function navUrl(s) { return s.u || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.q || s.jp || s.n); }
  function todayDay() {
    var n = new Date(), d = Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - TRIP_START) / 86400000) + 1;
    return d >= 1 && d <= 7 ? d : 0;
  }
  var ALSO = { 5: { teine: 1, highland: 1, skimeet: 1 }, 6: { jigoku: 1 }, 1: { sato: 1 } };   // 跨日重複出現的點
  function inDay(s, d) { return s.d === d || !!(ALSO[d] && ALSO[d][s.id]) || !!(s.dd && s.dd.indexOf(d) >= 0); }
  function dayLabel(s) { return s.c === 'city' ? '專題・' + s.area : s.d === 9 ? '加碼・' + s.area : s.d === 10 ? '各地・' + s.area : s.d ? 'Day ' + s.d : '口袋名單'; }
  function gUrl(q) { return 'https://www.google.com/search?q=' + encodeURIComponent(q); }

  /* ══════════ 地圖 ══════════ */
  var map, layers = {}, curLayer = 'street', markers = {}, meMarker, meCircle, myPos = null, follow = false, filter = 'all';

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([43.0687, 141.3508], 12);
    layers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap' });
    layers.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, crossOrigin: true, attribution: 'Imagery © Esri' });
    layers.street.addTo(map);
    SPOTS.forEach(function (s) {
      if (s.nomap) return;
      var m = L.marker(s.ll, { icon: pinIcon(s), title: s.n, zIndexOffset: s.c === 'city' ? -500 : 0 });
      m.on('click', function () { openSheet(s.id); });
      markers[s.id] = m;
    });
    map.on('dragstart', function () { follow = false; $('btnLocate').classList.remove('on'); });
    map.on('click', function (e) { if (prefs.sim) onPos(e.latlng.lat, e.latlng.lng, 10, true); });
    applyFilter(todayDay() ? String(todayDay()) : 'all', true);
  }
  function pinIcon(s) {
    return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30],
      html: '<div class="pin' + (s.c === 'city' ? ' city' : '') + (heard[s.id] ? ' heard' : '') + '" style="background:' + DAY_COLOR[s.d] + '"><i>' + CAT[s.c] + '</i></div>' });
  }
  function refreshPin(id) { if (markers[id] && byId[id]) markers[id].setIcon(pinIcon(byId[id])); }

  function renderChips() {
    var t = todayDay(), items = [['all', '全部']];
    for (var d = 1; d <= 7; d++) items.push([String(d), (d === t ? '今天・' : '') + 'Day ' + d]);
    items.push(['0', '口袋名單']); items.push(['9', '加碼景點']); items.push(['10', '北海道各地']);
    $('dayChips').innerHTML = items.map(function (i) {
      return '<button class="chip' + (i[0] === filter ? ' on' : '') + '" data-f="' + i[0] + '">' + i[1] + '</button>';
    }).join('');
  }
  function applyFilter(f, fit) {
    filter = f; renderChips();
    var pts = [];
    SPOTS.forEach(function (s) {
      if (!markers[s.id]) return;
      var show = f === 'all' ? true : s.c === 'city' ? (f !== '0' && f !== '9' && inDay(s, Number(f))) : inDay(s, Number(f));
      if (show) { markers[s.id].addTo(map); if ((s.c !== 'city' || s.r) && !(f === 'all' && s.d === 10)) pts.push(s.ll); } else { map.removeLayer(markers[s.id]); }
    });
    if (fit && pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
  }

  /* ══════════ 定位 ══════════ */
  var watchId = null;
  function gps(msg, cls) { var g = $('gpsStatus'); g.textContent = msg; g.className = 'gps' + (cls ? ' ' + cls : ''); }

  function startGeo() {
    if (!('geolocation' in navigator)) { gps('這支手機不支援定位', 'err'); return; }
    if (watchId != null) return;
    gps('定位中…');
    watchId = navigator.geolocation.watchPosition(function (p) {
      if (prefs.sim) return;
      onPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy || 0, false);
    }, function (e) {
      gps(e.code === 1 ? '定位被拒絕：請到瀏覽器設定允許「位置」' : '定位失敗，請到戶外或稍候', 'err');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  function onPos(lat, lng, acc, sim) {
    var first = !myPos; myPos = [lat, lng];
    if (!meMarker) {
      meMarker = L.marker(myPos, { icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="me"></div>' }), zIndexOffset: 1000, interactive: false }).addTo(map);
      meCircle = L.circle(myPos, { radius: acc, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(myPos); meCircle.setLatLng(myPos).setRadius(acc); }
    if (follow || (first && !sim)) { follow = true; $('btnLocate').classList.add('on'); map.setView(myPos, Math.max(map.getZoom(), 15)); }
    gps((sim ? '測試位置' : '定位中') + '・誤差約 ' + Math.round(acc) + ' 公尺', 'ok');

    var near = SPOTS.filter(function (s) { return !s.nomap; }).map(function (s) { return { s: s, m: dist(myPos, s.ll) }; }).sort(function (a, b) { return a.m - b.m; });
    var nb = $('nearBar');
    var n0 = near.filter(function (x) { return x.s.c !== 'city'; })[0];
    if (n0 && n0.m < 3000) { nb.hidden = false; nb.textContent = '最近：' + n0.s.n + '・' + fmtDist(n0.m); nb.dataset.id = n0.s.id; }
    else nb.hidden = true;
    if ($('tab-plan').classList.contains('active')) renderPlan();

    if (!prefs.alert || acc > 200) return;
    var hits = near.filter(function (x) { return x.s.r > 0 && x.m <= x.s.r && !notified[x.s.id]; });
    var spotHits = hits.filter(function (x) { return x.s.c !== 'city'; });   // 景點優先，城市專題等沒有景點時才跳
    if (spotHits.length) hits = spotHits;
    if (hits.length && $('alert').hidden && $('sheet').hidden) showAlert(hits);
  }

  /* ══════════ 到點通知 ══════════ */
  var alertId = null, audioCtx = null;
  function showAlert(hits) {
    var s = hits[0].s; alertId = s.id;
    hits.forEach(function (h) { notified[h.s.id] = 1; });
    store.set('notified', notified);
    $('alertTitle').textContent = s.c === 'city' ? '城市專題：' + s.n : '你已進入「' + s.n + '」爆料範圍';
    $('alertHead').textContent = s.h;
    $('alertMore').textContent = hits.length > 1 ? '附近還有：' + hits.slice(1, 4).map(function (h) { return h.s.n; }).join('、') : '';
    $('alert').hidden = false;
    if (prefs.sound) beep();
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (e) {} }
  }
  function hideAlert() { $('alert').hidden = true; alertId = null; }
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
    try { if ('speechSynthesis' in window) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
  }
  function beep() {
    if (!audioCtx) return;
    try {
      [880, 1175, 1568].forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.16;
        o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.16);
      });
    } catch (e) {}
  }

  /* ══════════ 語音 ══════════ */
  var tts = { queue: [], idx: 0, token: 0, playing: false, voice: null };
  var hasTTS = 'speechSynthesis' in window;
  function pickVoice() {
    if (!hasTTS) return;
    var vs = speechSynthesis.getVoices() || [];
    var rank = function (v) { var l = (v.lang || '').replace('_', '-').toLowerCase();
      return l === 'zh-tw' ? 3 : (l.indexOf('zh-hant') === 0 || l === 'cmn-hant-tw') ? 3 : l === 'zh-cn' || l.indexOf('cmn') === 0 ? 2 : l.indexOf('zh') === 0 && l !== 'zh-hk' ? 1 : 0; };
    var best = null, br = 0;
    vs.forEach(function (v) { var r = rank(v); if (r > br) { br = r; best = v; } });
    tts.voice = best;
  }
  if (hasTTS) { pickVoice(); try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) { speechSynthesis.onvoiceschanged = pickVoice; } }

  function clean(t) { return String(t).replace(/[【】「」『』（）()]/g, '，').replace(/[→↔⇄]/g, '到').replace(/・/g, '，').replace(/¥\s?([\d,]+)/g, '$1 日圓').replace(/L\.O\./g, '最後點餐').replace(/–/g, '到'); }
  function chunks(t) {
    var out = [], cur = '';
    (clean(t).match(/[^。！？!?；]+[。！？!?；]*/g) || []).forEach(function (p) {
      if ((cur + p).length > 150 && cur) { out.push(cur); cur = p; } else cur += p;
    });
    if (cur.trim()) out.push(cur);
    return out;
  }
  function speakQueue(items, onDone) {       // items: [{text, el}]
    stopSpeak();
    if (!hasTTS) { alert('這個瀏覽器不支援語音朗讀，請直接看文字。'); return; }
    tts.queue = []; items.forEach(function (it) { chunks(it.text).forEach(function (c) { tts.queue.push({ text: c, el: it.el }); }); });
    tts.idx = 0; tts.onDone = onDone; tts.playing = true; updatePlayBtn();
    setTimeout(next, 80);
  }
  function next() {
    var my = ++tts.token;
    document.querySelectorAll('.seg.now').forEach(function (e) { e.classList.remove('now'); });
    if (!tts.playing) return;
    if (tts.idx >= tts.queue.length) { tts.playing = false; updatePlayBtn(); if (tts.onDone) tts.onDone(); return; }
    var q = tts.queue[tts.idx], u = new SpeechSynthesisUtterance(q.text);
    u.lang = 'zh-TW'; if (tts.voice) u.voice = tts.voice; u.rate = Number(prefs.rate) || 1;
    if (q.el) { q.el.classList.add('now'); try { q.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    var done = function () { if (my !== tts.token) return; tts.idx++; next(); };
    u.onend = done; u.onerror = done;
    tts.cur = u;                       // 防止被回收導致 onend 不觸發
    speechSynthesis.speak(u);
  }
  function pauseSpeak() { tts.playing = false; tts.token++; if (hasTTS) speechSynthesis.cancel(); updatePlayBtn(); }
  function resumeSpeak() { if (!tts.queue.length) return; tts.playing = true; updatePlayBtn(); setTimeout(next, 80); }
  function stopSpeak() {
    tts.playing = false; tts.token++; tts.queue = []; tts.idx = 0;
    if (hasTTS) speechSynthesis.cancel();
    document.querySelectorAll('.seg.now').forEach(function (e) { e.classList.remove('now'); });
    updatePlayBtn();
  }
  function updatePlayBtn() {
    var b = $('playBtn'); if (!b) return;
    b.textContent = tts.playing ? '❚❚ 暫停' : (tts.queue.length && tts.idx > 0 && tts.idx < tts.queue.length ? '▶ 繼續' : '▶ 播放');
  }

  /* ══════════ 景點卡 ══════════ */
  var sheetId = null;
  function openSheet(id, autoplay) {
    var s = byId[id]; if (!s) return;
    stopSpeak(); sheetId = id; hideAlert();
    var m = s.h.match(/^【(.+?)】(.*)$/), tag = m ? m[1] : '爆料', head = m ? m[2] : s.h;
    var h = '<div class="badges"><span class="badge" style="background:' + DAY_COLOR[s.d] + ';color:#fff">' + dayLabel(s) + '</span>' +
      (s.t ? '<span class="badge">' + esc(s.t) + '</span>' : '') +
      (myPos && !s.nomap && s.c !== 'city' ? '<span class="badge">距離 ' + fmtDist(dist(myPos, s.ll)) + '</span>' : '') + '</div>' +
      '<h2 class="headline" data-say="' + esc(tag + '。' + head) + '"><mark>' + esc(tag) + '</mark>' + esc(head) + '</h2>' +
      '<div class="names">' + CAT[s.c] + ' ' + esc(s.n) + (s.jp ? '・' + esc(s.jp) : '') + '</div>' +
      (s.w ? '<div class="warn seg-say" data-say="' + esc('注意。' + s.w) + '">⚠️ ' + esc(s.w) + '</div>' : '') +
      (s.i ? '<div class="info">🕒 ' + esc(s.i) + '</div>' : '');
    s.s.forEach(function (g) {
      h += '<div class="seg" data-say="' + esc(g[0] + '。' + g[1]) + '"><span class="cue">' + (s.c === 'city' ? '📌 ' : '👀 ') + esc(g[0]) + '</span><p>' + esc(g[1]) + '</p></div>';
    });
    if (s.tip && s.tip.length) {
      h += '<ul class="tips seg" data-say="' + esc('最後幾條線報。' + s.tip.join(' ')) + '">' + s.tip.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    if (s.rel && s.rel.length) {
      h += '<div class="rel"><h4>延伸爆料</h4>' + s.rel.filter(function (r) { return byId[r]; }).map(function (r) { return '<button data-open="' + r + '">' + CAT[byId[r].c] + ' ' + esc(byId[r].n) + '</button>'; }).join('') + '</div>';
    }
    if (s.c !== 'city') h += '<div class="navrow"><a class="go" href="' + esc(navUrl(s)) + '" target="_blank" rel="noopener">🧭 用 Google Maps 導航</a>' +
      '<button id="showOnMap">🗺 在地圖上看</button>' +
      '<a class="g" href="' + esc(gUrl((s.jp || s.n).replace(/[（(].*$/, ''))) + '" target="_blank" rel="noopener">🔎 Google 搜尋</a></div>';
    $('sheetBody').innerHTML = h; $('sheetBody').scrollTop = 0;
    $('sheet').hidden = false;
    if ($('showOnMap')) $('showOnMap').onclick = function () { closeSheet(); switchTab('map'); follow = false; $('btnLocate').classList.remove('on');
      if (!map.hasLayer(markers[id])) applyFilter('all'); map.setView(s.ll, 17); };
    if (autoplay) playSheet();
  }
  function playSheet() {
    var els = $('sheetBody').querySelectorAll('[data-say]'), items = [];
    els.forEach(function (e) { items.push({ text: e.getAttribute('data-say'), el: e.classList.contains('seg') ? e : null }); });
    var id = sheetId;
    speakQueue(items, function () { heard[id] = 1; store.set('heard', heard); refreshPin(id); if ($('tab-topic').classList.contains('active')) renderTopics(); });
  }
  function closeSheet() { stopSpeak(); $('sheet').hidden = true; sheetId = null; }

  /* ══════════ 行程 ══════════ */
  function itemHtml(s) {
    return '<button class="item' + (heard[s.id] ? ' heard' : '') + '" data-open="' + s.id + '"><span class="em">' + CAT[s.c] + '</span>' +
      '<span class="tx"><b>' + esc(s.n) + '</b><small>' + esc(s.t || '') + '</small></span>' +
      (myPos ? '<span class="dist">' + fmtDist(dist(myPos, s.ll)) + '</span>' : '') + '</button>';
  }
  function renderPlan() {
    var t = todayDay(), h = '';
    DAYS.forEach(function (d) {
      h += '<div class="day" id="day' + d.d + '"><div class="day-h" style="background:' + DAY_COLOR[d.d] + '"><b>Day ' + d.d + (d.d === t ? '・今天' : '') + '</b><small>' + esc(d.date) + '</small><b>' + esc(d.title) + '</b></div><div class="day-b">' +
        '<div class="day-sub">' + esc(d.sub) + '</div>' +
        (d.warn ? '<div class="warn">⚠️ ' + esc(d.warn) + '</div>' : '') +
        '<ul class="moves">' + d.move.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' +
        (d.stay ? '<div class="stay">🏨 住宿：' + esc(d.stay) + '</div>' : '') +
        SPOTS.filter(function (s) { return inDay(s, d.d); }).map(itemHtml).join('') + '</div></div>';
    });
    h += '<div class="day"><div class="day-h" style="background:' + DAY_COLOR[0] + '"><b>口袋名單</b><small>沒排進行程，路過一樣爆料</small></div><div class="day-b">' +
      SPOTS.filter(function (s) { return s.d === 0; }).map(itemHtml).join('') + '</div></div>';
    [[9, '加碼景點', '行程之外，同城市與定山溪的經典去處'], [10, '北海道各地', '有空多留幾天再去：道央、道北、函館、道東']].forEach(function (g) {
      h += '<div class="day"><div class="day-h" style="background:' + DAY_COLOR[g[0]] + '"><b>' + g[1] + '</b><small>' + g[2] + '</small></div><div class="day-b">';
      AREAS.forEach(function (a) {
        var list = SPOTS.filter(function (s) { return s.d === g[0] && s.area === a; });
        if (list.length) h += '<div class="day-sub" style="margin-top:10px">' + esc(a) + '</div>' + list.map(itemHtml).join('');
      });
      h += '</div></div>';
    });
    var sc = $('planList'), top = sc.scrollTop; sc.innerHTML = h; sc.scrollTop = top;
  }

  /* ══════════ 專題 ══════════ */
  function renderTopics() {
    var h = '<p class="none" style="margin-top:0">每座城市的地理、歷史、人文、經濟內幕。搭車、排隊、泡完湯的時候聽。</p>';
    AREAS.forEach(function (a) {
      var list = SPOTS.filter(function (s) { return s.c === 'city' && s.area === a; });
      if (!list.length) return;
      h += '<div class="topic-h">' + esc(a) + '</div>';
      list.forEach(function (s) {
        h += '<button class="topic' + (heard[s.id] ? ' heard' : '') + '" data-open="' + s.id + '"><b>' + esc(s.n) + '</b><small>' + esc(s.h) + '</small></button>';
      });
    });
    var sc = $('topicList'), top = sc.scrollTop; sc.innerHTML = h; sc.scrollTop = top;
  }

  /* ══════════ 爆料台（關鍵字搜尋，非 AI） ══════════ */
  var STOP = { '怎麼': 1, '什麼': 1, '哪裡': 1, '可以': 1, '請問': 1, '有沒': 1, '沒有': 1, '是不': 1, '不是': 1, '要怎': 1, '麼去': 1, '我們': 1, '一下': 1, '的話': 1, '告訴': 1, '訴我': 1, '想要': 1, '麼樣': 1, '為什': 1 };
  function norm(t) { return String(t).toLowerCase().replace(/[臺]/g, '台').replace(/[\s,.，。、！？!?：:；;「」『』（）()【】・\-–]/g, ' '); }
  function tokens(q) {
    var out = [], n = norm(q);
    (n.match(/[a-z0-9]{2,}/g) || []).forEach(function (w) { out.push(w); });
    (n.match(/[぀-ヿ一-鿿]+/g) || []).forEach(function (run) {
      if (run.length === 1) out.push(run);
      for (var i = 0; i < run.length - 1; i++) { var b = run.substr(i, 2); if (!STOP[b]) out.push(b); }
    });
    return out;
  }
  var INDEX = [];
  FAQ.forEach(function (f) { INDEX.push({ type: 'faq', f: f, strong: norm(f.k + ' ' + f.q), weak: norm(f.a) }); });
  SPOTS.forEach(function (s) {
    INDEX.push({ type: 'spot', s: s, strong: norm(s.n + ' ' + (s.jp || '') + ' ' + (s.k || '')), mid: norm(s.h),
      weak: norm(s.s.map(function (g) { return g.join(' '); }).join(' ') + ' ' + (s.tip || []).join(' ') + ' ' + (s.w || '') + ' ' + (s.i || '')) });
  });
  function search(q) {
    var tk = tokens(q); if (!tk.length) return [];
    var res = [];
    INDEX.forEach(function (d) {
      var sc = 0;
      tk.forEach(function (t) {
        var w = t.length === 1 ? 0.5 : 1;
        if (d.strong.indexOf(t) >= 0) sc += 3 * w; else if (d.mid && d.mid.indexOf(t) >= 0) sc += 2 * w; else if (d.weak.indexOf(t) >= 0) sc += 1 * w;
      });
      if (d.type === 'faq') sc *= 1.15;
      if (sc > 0) res.push({ d: d, sc: sc / Math.sqrt(tk.length) });
    });
    res.sort(function (a, b) { return b.sc - a.sc; });
    if (!res.length || res[0].sc < 1.4) return [];
    return res.filter(function (r) { return r.sc >= res[0].sc * 0.6; }).slice(0, 4);
  }
  function renderAnswers(q) {
    var res = search(q), box = $('askResults'), h = '';
    if (!res.length) {
      h = '<div class="ans"><span class="tag">本台致歉</span><h3>這條線報本台還沒挖到！</h3><p>爆料台只查得到這趟行程的景點、餐廳、交通和注意事項。換個關鍵字試試，例如店名、地名，或按上面的「Google」直接查。</p></div>';
    } else res.forEach(function (r, i) {
      var d = r.d, title, body, say, acts = '<button data-say-i="' + i + '">🔊 唸給我聽</button>';
      if (d.type === 'faq') { title = d.f.q; body = d.f.a; if (d.f.go && byId[d.f.go]) acts += '<button data-open="' + d.f.go + '">📍 ' + esc(byId[d.f.go].n) + '</button>'; }
      else { title = d.s.n + '（' + dayLabel(d.s) + '）'; body = d.s.h + ' ' + d.s.s.slice(0, 2).map(function (g) { return g[1]; }).join(' ') + (d.s.i ? ' 營業資訊：' + d.s.i + '。' : '') + (d.s.w ? ' 注意：' + d.s.w : ''); acts += '<button data-open="' + d.s.id + '">📰 看完整爆料</button>'; if (d.s.c !== 'city') acts += '<a class="g" href="' + esc(gUrl(d.s.jp || d.s.n)) + '" target="_blank" rel="noopener">🔎 Google</a>'; }
      say = title + '。' + body;
      h += '<div class="ans"><span class="tag">' + (i === 0 ? '頭條線報' : '相關線報') + '</span><h3>' + esc(title) + '</h3><p class="seg" data-ans="' + esc(say) + '">' + esc(body) + '</p><div class="acts">' + acts + '</div></div>';
    });
    box.innerHTML = h;
  }
  function renderAskChips() {
    var hot = ['登別怎麼去', '哪些要訂位', '哪天休館', '螃蟹哪裡吃', '湯咖哩', '夜景比較', '滑雪集合', '伴手禮', '霜淇淋路線', '有多冷', '緊急電話', '黃金神威', '地址怎麼看', '便利商店', '溫泉泉質', '愛努', '大谷翔平', '小樽為什麼沒落', '定山溪怎麼去', '一月有什麼祭典'];
    $('askChips').innerHTML = hot.map(function (t) { return '<button class="chip" data-q="' + t + '">' + t + '</button>'; }).join('');
  }

  /* ══════════ 待辦 ══════════ */
  function renderTodo() {
    var h = '';
    TODOS.forEach(function (g, gi) {
      h += '<div class="todo-g"><h3>' + esc(g.g) + '</h3>' + g.items.map(function (t, i) {
        var k = gi + '_' + i, on = !!todoDone[k];
        return '<label class="' + (on ? 'done' : '') + '"><input type="checkbox" data-todo="' + k + '"' + (on ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
      }).join('') + '</div>';
    });
    $('todoList').innerHTML = h;
  }

  /* ══════════ 分頁、設定、其他 ══════════ */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    if (name === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 50);
    if (name === 'plan') renderPlan();
    if (name === 'topic') renderTopics();
  }
  var wakeLock = null;
  function wake() {
    if (!prefs.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
  }
  function unwake() { if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wake(); });

  function savePrefs() { store.set('prefs', prefs); }
  function syncSettings() {
    $('optAlert').checked = prefs.alert; $('optSound').checked = prefs.sound; $('optWake').checked = prefs.wake; $('optSim').checked = prefs.sim;
    $('rateSel').value = String(prefs.rate);
  }

  function bind() {
    document.querySelector('.tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
    $('dayChips').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) { follow = false; $('btnLocate').classList.remove('on'); applyFilter(b.dataset.f, true); } });
    $('btnLayer').onclick = function () {
      map.removeLayer(layers[curLayer]); curLayer = curLayer === 'street' ? 'sat' : 'street'; layers[curLayer].addTo(map);
      this.classList.toggle('on', curLayer === 'sat');
    };
    $('btnLocate').onclick = function () {
      if (!myPos) { startGeo(); return; }
      follow = true; this.classList.add('on'); map.setView(myPos, Math.max(map.getZoom(), 16));
    };
    $('nearBar').onclick = function () { if (this.dataset.id) openSheet(this.dataset.id); };

    $('alertPlay').onclick = function () { var id = alertId; openSheet(id, true); };
    $('alertRead').onclick = function () { openSheet(alertId); };
    $('alertSkip').onclick = hideAlert;

    $('sheetClose').onclick = closeSheet;
    $('playBtn').onclick = function () { if (tts.playing) pauseSpeak(); else if (tts.queue.length && tts.idx > 0 && tts.idx < tts.queue.length) resumeSpeak(); else playSheet(); };
    $('stopBtn').onclick = stopSpeak;
    $('rateSel').onchange = function () { prefs.rate = Number(this.value); savePrefs(); };

    document.body.addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]');
      if (o) { openSheet(o.dataset.open); return; }
      var q = e.target.closest('[data-q]');
      if (q) { $('askInput').value = q.dataset.q; renderAnswers(q.dataset.q); return; }
      var s = e.target.closest('[data-say-i]');
      if (s) { var p = s.closest('.ans').querySelector('[data-ans]'); speakQueue([{ text: p.getAttribute('data-ans'), el: p }]); }
    });
    $('askForm').addEventListener('submit', function (e) { e.preventDefault(); stopSpeak(); renderAnswers($('askInput').value); $('askInput').blur(); });

    $('askGoogle').onclick = function () {
      var q = $('askInput').value.trim();
      if (!q) { $('askInput').focus(); return; }
      window.open(gUrl(q + ' 北海道'), '_blank', 'noopener');
    };

    $('todoList').addEventListener('change', function (e) {
      var k = e.target.dataset.todo; if (!k) return;
      if (e.target.checked) todoDone[k] = 1; else delete todoDone[k];
      store.set('todo', todoDone); e.target.closest('label').classList.toggle('done', e.target.checked);
    });

    $('btnSettings').onclick = function () { syncSettings(); $('settings').hidden = false; };
    $('settingsClose').onclick = function () { $('settings').hidden = true; };
    $('optAlert').onchange = function () { prefs.alert = this.checked; savePrefs(); };
    $('optSound').onchange = function () { prefs.sound = this.checked; savePrefs(); };
    $('optWake').onchange = function () { prefs.wake = this.checked; savePrefs(); if (this.checked) wake(); else unwake(); };
    $('optSim').onchange = function () { prefs.sim = this.checked; savePrefs(); gps(this.checked ? '測試模式：點地圖任一處模擬位置' : '定位中…'); if (this.checked) { $('settings').hidden = true; switchTab('map'); } };
    $('btnResetHeard').onclick = function () { notified = {}; heard = {}; store.set('notified', notified); store.set('heard', heard); SPOTS.forEach(function (s) { refreshPin(s.id); }); this.textContent = '已重設 ✓'; };
    $('btnTestVoice').onclick = function () { unlockAudio(); beep(); speakQueue([{ text: '獨家直擊！北海道最強導遊，語音測試成功。' }]); };

    $('btnStart').onclick = function () { unlockAudio(); $('intro').hidden = true; startGeo(); wake(); map.invalidateSize(); };
    $('btnBrowse').onclick = function () { unlockAudio(); $('intro').hidden = true; map.invalidateSize(); };
    window.addEventListener('pagehide', function () { if (hasTTS) speechSynthesis.cancel(); });
  }

  initMap(); bind(); renderAskChips(); renderTodo(); syncSettings();
  if (prefs.sim) gps('測試模式：點地圖任一處模擬位置');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.__guide = { onPos: onPos, search: search, spots: SPOTS };   // 測試用
})();
