/* 元素週期表．單字版
 *
 * 音檔一樣是「單一音軌 + 時間戳記」：點某一格就 seek 到該元素的起點、
 * 到終點停住；按「依序播放」則整軌連續播完 88 個元素。
 */
(function () {
  'use strict';

  var app = document.getElementById('pt-app');
  if (!app) return;

  // 八個細分類收斂成三個顯示群組。週期表任兩分類都可能視覺相鄰，
  // 八色在這種情境過不了辨色障礙的分離度；三色可以。細分類用文字呈現。
  var GROUP = {
    alkali: 'metal', alkaline: 'metal', transition: 'metal', post: 'metal',
    metalloid: 'metalloid',
    nonmetal: 'nonmetal', halogen: 'nonmetal', noble: 'nonmetal'
  };
  var GROUP_NAME = { metal: '金屬', metalloid: '類金屬', nonmetal: '非金屬' };

  var DATA = {}, OFFSETS = {}, audio = null;
  // 播放模式要明確分開。timeupdate 大約每 250ms 才觸發一次，單獨播放偵測到
  // 越過終點時，currentTime 往往已經落進下一個元素的區間 —— 若這時還照
  // currentTime 更新畫面，就會「聽完一個卻跳到下一個」。所以 single 模式下
  // 完全不依音軌位置動畫面，只有 all（依序播放）才跟著走。
  var mode = null;          // 'single' | 'all' | null
  var stopAt = null;        // 只有 single 模式會設
  var els = {}, filterGrp = null, query = '';

  Promise.all([
    fetch('/elements/data.json').then(function (r) { return r.json(); }),
    fetch('/elements/audio/offsets.json').then(function (r) { return r.json(); }).catch(function () { return null; })
  ]).then(function (res) {
    DATA = res[0];
    if (res[1]) res[1].items.forEach(function (i) { OFFSETS[i.sym] = i; });
    render();
  }).catch(function (e) {
    app.innerHTML = '<div class="pt-loading">資料載入失敗：' + e.message + '</div>';
  });

  function render() {
    app.dataset.state = 'ready';
    app.innerHTML = headHtml() + toolsHtml() + legendHtml() +
      '<div class="pt-scroll"><div class="pt-grid"></div></div>' +
      '<div class="pt-detail"><span class="pt-d-empty">點任一個元素聽發音，或按「依序播放」從氫聽到 Og。</span></div>' +
      playerHtml();

    els.grid = app.querySelector('.pt-grid');
    els.detail = app.querySelector('.pt-detail');
    els.now = app.querySelector('.pt-now');
    els.fill = app.querySelector('.pt-bar-fill');
    els.bar = app.querySelector('.pt-bar');
    els.playAll = app.querySelector('#pt-play-all');

    buildGrid();
    bind();
  }

  function headHtml() {
    var dur = OFFSETS[DATA.elements[0].sym] ? lastEnd() : 0;
    return '<div class="pt-head">' +
      '<div><b>' + DATA.elements.length + '</b> <span>元素</span></div>' +
      '<div><b>7</b> <span>週期</span></div>' +
      (dur ? '<div><b>' + Math.round(dur / 60) + '</b> <span>分鐘音檔</span></div>' : '') +
      '<div class="pt-note">' + esc(DATA.meta.note) + '</div>' +
      '<div class="pt-note">' + esc(DATA.meta.ttsNote) + '</div>' +
      '</div>';
  }

  function toolsHtml() {
    return '<div class="pt-tools">' +
      '<input type="search" id="pt-search" placeholder="搜尋符號、中文、英文，如 Fe / 鐵 / iron">' +
      '<button class="pt-btn ghost" id="pt-clear">清除</button>' +
      '</div>';
  }

  function legendHtml() {
    return '<div class="pt-legend">' + ['metal', 'metalloid', 'nonmetal'].map(function (g) {
      return '<button class="pt-leg" data-grp="' + g + '" aria-pressed="false">' +
        '<i style="background:var(--pt-' + g + ')"></i>' + GROUP_NAME[g] + '</button>';
    }).join('') + '</div>';
  }

  function playerHtml() {
    return '<div class="pt-player">' +
      '<button class="pt-btn" id="pt-play-all">▶ 依序播放</button>' +
      '<button class="pt-btn ghost" id="pt-restart">⟲ 從頭</button>' +
      '<div class="pt-now">尚未播放</div>' +
      '<select id="pt-rate" title="播放速度">' +
        '<option value="0.75">0.75×</option><option value="0.9">0.9×</option>' +
        '<option value="1" selected>1×</option>' +
        '<option value="1.25">1.25×</option><option value="1.5">1.5×</option>' +
      '</select>' +
      '<label style="font-size:13px;display:flex;align-items:center;gap:4px">' +
        '<input type="checkbox" id="pt-loop"> 循環</label>' +
      '<div class="pt-bar"><div class="pt-bar-fill"></div></div>' +
      '</div>';
  }

  function buildGrid() {
    var html = '';
    DATA.elements.forEach(function (e) {
      var grp = GROUP[e.c];
      html += '<button class="pt-cell" data-sym="' + esc(e.sym) + '" data-grp="' + grp + '"' +
        ' style="grid-column:' + e.g + ';grid-row:' + e.p + '"' +
        ' title="' + esc(e.en + '（' + e.zh + '）') + '">' +
        '<span class="pt-z">' + e.z + '</span>' +
        '<span class="pt-sym">' + esc(e.sym) + '</span>' +
        '<span class="pt-zh">' + esc(e.zh) + '</span>' +
        '<span class="pt-en">' + esc(e.en) + '</span>' +
        '</button>';
    });
    // 鑭系錒系抽掉後的兩個空位，標示出來比留白清楚
    html += '<div class="pt-gap" style="grid-column:3;grid-row:6" title="鑭系（57-71）已略過">鑭系</div>';
    html += '<div class="pt-gap" style="grid-column:3;grid-row:7" title="錒系（89-103）已略過">錒系</div>';
    els.grid.innerHTML = html;
  }

  function bind() {
    app.addEventListener('click', function (ev) {
      var cell = ev.target.closest('.pt-cell');
      if (cell) return select(cell.dataset.sym, true);
      var leg = ev.target.closest('.pt-leg');
      if (leg) return toggleGroup(leg.dataset.grp);
    });
    app.querySelector('#pt-search').addEventListener('input', function () {
      query = this.value.trim().toLowerCase();
      applyFilter();
    });
    app.querySelector('#pt-clear').addEventListener('click', function () {
      query = ''; filterGrp = null;
      app.querySelector('#pt-search').value = '';
      app.querySelectorAll('.pt-leg').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      applyFilter();
    });
    els.playAll.addEventListener('click', function () {
      ensureAudio();
      if (audio.paused) { mode = 'all'; stopAt = null; audio.play(); } else audio.pause();
    });
    app.querySelector('#pt-restart').addEventListener('click', function () {
      ensureAudio(); mode = 'all'; stopAt = null; audio.currentTime = 0; audio.play();
    });
    app.querySelector('#pt-rate').addEventListener('change', function () {
      ensureAudio(); audio.playbackRate = parseFloat(this.value);
    });
    app.querySelector('#pt-loop').addEventListener('change', function () {
      ensureAudio(); audio.loop = this.checked;
    });
    els.bar.addEventListener('click', function (ev) {
      ensureAudio();
      var d = duration(); if (!d) return;
      var r = this.getBoundingClientRect();
      mode = 'all';           // 拖曳進度條視為要連續聽下去
      stopAt = null;
      audio.currentTime = ((ev.clientX - r.left) / r.width) * d;
      audio.play();
    });
  }

  function toggleGroup(g) {
    filterGrp = filterGrp === g ? null : g;
    app.querySelectorAll('.pt-leg').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.grp === filterGrp));
    });
    applyFilter();
  }

  function applyFilter() {
    DATA.elements.forEach(function (e) {
      var cell = els.grid.querySelector('.pt-cell[data-sym="' + e.sym + '"]');
      if (!cell) return;
      var okGrp = !filterGrp || GROUP[e.c] === filterGrp;
      var okQ = !query ||
        (e.sym + e.zh + e.en + e.z).toLowerCase().indexOf(query) >= 0;
      cell.classList.toggle('is-dim', !(okGrp && okQ));
    });
  }

  function find(sym) {
    return DATA.elements.filter(function (e) { return e.sym === sym; })[0];
  }

  function select(sym, play) {
    var e = find(sym);
    if (!e) return;
    els.detail.innerHTML =
      '<span class="pt-d-sym">' + esc(e.sym) + '</span>' +
      '<div class="pt-d-main"><b>' + esc(e.zh) + '　' + esc(e.en) + '</b><br>' +
        '<span>原子序 ' + e.z + '　第 ' + e.p + ' 週期　第 ' + e.g + ' 族　' +
        esc(DATA.categories[e.c]) + '</span></div>' +
      '<div class="pt-d-spell">' + esc(e.en.toUpperCase().split('').join(' ')) + '</div>' +
      (e.zhTTS ? '<div class="pt-note" style="flex-basis:100%">「' + esc(e.zh) +
        '」是 Unicode 罕用字，語音引擎讀不出來，改用同音的聲符「' + esc(e.zhTTS) +
        '」發音，讀音相同。</div>' : '');
    if (play) playOne(sym);
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio('/elements/audio/track-01.mp3');
    audio.preload = 'metadata';
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('play', function () { els.playAll.textContent = '⏸ 暫停'; });
    audio.addEventListener('pause', function () { els.playAll.textContent = '▶ 依序播放'; });
    return audio;
  }

  function playOne(sym) {
    var o = OFFSETS[sym];
    if (!o) return;
    ensureAudio();
    mode = 'single';
    stopAt = o.end;
    audio.currentTime = o.start;
    audio.play();
    markCell(sym);
    var e = find(sym);
    els.now.innerHTML = '正在播放　<b>' + esc(e.sym) + '</b>　' + esc(e.zh) + ' ' + esc(e.en);
  }

  var lastCell = null;
  // 高亮換到另一格時回傳那一格，沒換則回傳 null —— 讓呼叫端知道要不要
  // 順便更新詳情與捲動（timeupdate 每秒約四次，不能每次都重寫 DOM）。
  function markCell(sym) {
    var cell = els.grid.querySelector('.pt-cell[data-sym="' + sym + '"]');
    if (cell === lastCell) return null;
    if (lastCell) lastCell.classList.remove('is-playing');
    if (cell) cell.classList.add('is-playing');
    lastCell = cell;
    return cell;
  }

  function tick() {
    var d = duration();
    if (d) els.fill.style.width = (audio.currentTime / d * 100) + '%';

    if (mode === 'single') {
      // 到終點就停，而且不碰畫面 —— 高亮與詳情停在剛才點的那個元素，
      // 不會因為 currentTime 已越界而跳到下一個。
      if (stopAt !== null && audio.currentTime >= stopAt) {
        audio.pause();
        audio.currentTime = stopAt;   // 停在邊界，下次按依序播放才從下一個元素乾淨地開始
        stopAt = null;
      }
      return;
    }

    // 依序播放：畫面跟著音軌走，但只在換元素的那一刻更新
    var cur = currentSym();
    if (!cur) return;
    var cell = markCell(cur);
    if (!cell) return;
    var e = find(cur);
    els.now.innerHTML = '正在播放　<b>' + esc(e.sym) + '</b>　' + esc(e.zh) + ' ' + esc(e.en);
    select(cur, false);
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function currentSym() {
    var t = audio.currentTime;
    for (var i = 0; i < DATA.elements.length; i++) {
      var o = OFFSETS[DATA.elements[i].sym];
      if (o && t >= o.start && t < o.end) return DATA.elements[i].sym;
    }
    return null;
  }

  function lastEnd() {
    var last = OFFSETS[DATA.elements[DATA.elements.length - 1].sym];
    return last ? last.end : 0;
  }
  function duration() {
    if (audio && isFinite(audio.duration) && audio.duration) return audio.duration;
    return lastEnd();
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
