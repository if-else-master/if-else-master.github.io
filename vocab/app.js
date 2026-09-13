/* 單字文法補救站
 *
 * 音檔只有一個檔案（track-01.mp3），不是一百個小檔。offsets.json 記錄每個字在
 * 音軌裡的起訖秒數，所以「單獨播一個字」其實是 seek 到該字的起點再在終點停住。
 * 同一份音檔因此同時服務逐字複習與整軌睡前播放，省一半流量也省一半儲存。
 */
(function () {
  'use strict';

  var app = document.getElementById('vocab-app');
  if (!app) return;

  var DATA = {};
  var OFFSETS = {};          // word -> {start, end}
  var audio = null;
  var stopAt = null;         // 單字播放時的停止秒數；整軌播放時為 null
  var sleepTimer = null;
  var els = {};

  Promise.all([
    fetch('/vocab/data.json').then(function (r) { return r.json(); }),
    fetch('/vocab/audio/offsets.json').then(function (r) { return r.json(); }).catch(function () { return null; })
  ]).then(function (res) {
    DATA = res[0];
    if (res[1]) res[1].words.forEach(function (w) { OFFSETS[w.w] = w; });
    render();
  }).catch(function (e) {
    app.innerHTML = '<div class="vb-loading">單字資料載入失敗：' + e.message + '</div>';
  });

  // ── 畫面 ────────────────────────────────────────
  function render() {
    var all = [];
    DATA.roots.forEach(function (r) { r.words.forEach(function (w) { all.push(w); }); });

    app.dataset.state = 'ready';
    app.innerHTML =
      statsHtml(all) +
      controlsHtml() +
      '<div class="vb-list"></div>' +
      playerHtml();

    els.list = app.querySelector('.vb-list');
    els.search = app.querySelector('#vb-search');
    els.now = app.querySelector('.vb-now');
    els.fill = app.querySelector('.vb-bar-fill');
    els.bar = app.querySelector('.vb-bar');
    els.playBtn = app.querySelector('#vb-play-all');

    bindControls();
    paint();
  }

  function statsHtml(all) {
    var lv = {};
    all.forEach(function (w) { lv[w.lv] = (lv[w.lv] || 0) + 1; });
    var dur = OFFSETS[all[0] && all[0].w] ? totalDuration() : 0;
    return '<div class="vb-stats">' +
      '<div><b>' + all.length + '</b> <span>單字</span></div>' +
      '<div><b>' + DATA.roots.length + '</b> <span>字根</span></div>' +
      '<div><b>' + all.length + '</b> <span>文法點</span></div>' +
      (dur ? '<div><b>' + Math.round(dur / 60) + '</b> <span>分鐘音檔</span></div>' : '') +
      '<div class="vb-src">' + esc(DATA.meta.source) + '｜語音：macOS ' +
        esc(DATA.meta.voice.en) + '（英）＋ ' + esc(DATA.meta.voice.zh) + '（中）</div>' +
      '</div>';
  }

  function controlsHtml() {
    var roots = DATA.roots.map(function (r) {
      return '<button class="vb-chip" data-filter="root" data-val="' + r.id + '" aria-pressed="false">' +
        esc(r.form) + '<i style="font-style:normal;color:inherit;opacity:.7"> ' + esc(r.meaning) + '</i></button>';
    }).join('');
    var lvs = [1, 2, 3, 4, 5, 6].map(function (n) {
      return '<button class="vb-chip" data-filter="lv" data-val="' + n + '" aria-pressed="false">L' + n + '</button>';
    }).join('');
    return '<div class="vb-controls">' +
      '<input type="search" id="vb-search" placeholder="搜尋單字、中文、文法點…">' +
      '<button class="vb-chip" data-filter="reset" aria-pressed="false">全部</button>' +
      '</div>' +
      '<div class="vb-controls">' + roots + '</div>' +
      '<div class="vb-controls">' + lvs + '</div>';
  }

  function playerHtml() {
    return '<div class="vb-player">' +
      '<button id="vb-play-all">▶ 睡前播放</button>' +
      '<button class="vb-ghost" id="vb-restart">⟲ 從頭</button>' +
      '<div class="vb-now">尚未播放</div>' +
      '<select id="vb-rate" title="播放速度">' +
        '<option value="0.75">0.75×</option>' +
        '<option value="0.9">0.9×</option>' +
        '<option value="1" selected>1×</option>' +
        '<option value="1.25">1.25×</option>' +
        '<option value="1.5">1.5×</option>' +
      '</select>' +
      '<select id="vb-sleep" title="睡眠定時">' +
        '<option value="0">不定時</option>' +
        '<option value="10">10 分後停</option>' +
        '<option value="20">20 分後停</option>' +
        '<option value="30">30 分後停</option>' +
      '</select>' +
      '<label style="font-size:13px;display:flex;align-items:center;gap:4px">' +
        '<input type="checkbox" id="vb-loop"> 循環</label>' +
      '<div class="vb-bar"><div class="vb-bar-fill"></div></div>' +
      '</div>';
  }

  var filter = { root: null, lv: null, q: '' };

  function paint() {
    var html = '';
    var shown = 0;
    DATA.roots.forEach(function (r) {
      if (filter.root && filter.root !== r.id) return;
      var words = r.words.filter(match);
      if (!words.length) return;
      shown += words.length;
      html += '<section class="vb-root">' +
        '<div class="vb-root-head">' +
          '<span class="vb-root-form">' + esc(r.form) + '</span>' +
          '<span class="vb-root-mean">' + esc(r.meaning) + '</span>' +
          '<span class="vb-root-origin">' + esc(r.origin) + '</span>' +
          '<span class="vb-root-count">' + words.length + ' 字</span>' +
        '</div>' +
        words.map(wordHtml).join('') +
        '</section>';
    });
    els.list.innerHTML = shown ? html : '<div class="vb-empty">找不到符合的單字。</div>';
  }

  function match(w) {
    if (filter.lv && w.lv !== filter.lv) return false;
    if (!filter.q) return true;
    var q = filter.q.toLowerCase();
    return (w.w + w.zh + w.en + w.zhs + w.g + w.gnote + w.gloss).toLowerCase().indexOf(q) >= 0;
  }

  function wordHtml(w) {
    var parts = w.parts.map(function (p) {
      return '<span class="vb-part">' + esc(p[0]) + ' <i>' + esc(p[1]) + '</i></span>';
    }).join('<span class="vb-plus">+</span>');
    var canPlay = !!OFFSETS[w.w];
    return '<article class="vb-word" data-w="' + esc(w.w) + '">' +
      '<div class="vb-w-top">' +
        '<span class="vb-w">' + esc(w.w) + '</span>' +
        '<span class="vb-pos">' + esc(w.pos) + '</span>' +
        '<span class="vb-lv" data-lv="' + w.lv + '">L' + w.lv + '</span>' +
        '<span class="vb-zh">' + esc(w.zh) + '</span>' +
        (canPlay ? '<button class="vb-play" data-play="' + esc(w.w) + '" title="播放這個字">▶</button>' : '') +
      '</div>' +
      '<div class="vb-parts">' + parts + '</div>' +
      '<div class="vb-gloss">' + esc(w.gloss) + '</div>' +
      '<div class="vb-sent">' +
        '<div class="vb-en">' + esc(w.en) + '</div>' +
        '<div class="vb-zhs">' + esc(w.zhs) + '</div>' +
      '</div>' +
      '<div class="vb-gram"><b>文法：' + esc(w.g) + '</b><br>' +
        '<span class="vb-gnote">' + esc(w.gnote) + '</span></div>' +
      '</article>';
  }

  // ── 互動 ────────────────────────────────────────
  function bindControls() {
    app.addEventListener('click', function (e) {
      var chip = e.target.closest('.vb-chip');
      if (chip) return onChip(chip);
      var play = e.target.closest('[data-play]');
      if (play) return playWord(play.dataset.play);
    });

    els.search.addEventListener('input', function () {
      filter.q = this.value.trim();
      paint();
    });

    els.playBtn.addEventListener('click', toggleAll);
    app.querySelector('#vb-restart').addEventListener('click', function () {
      ensureAudio();
      stopAt = null;
      audio.currentTime = 0;
      audio.play();
    });
    app.querySelector('#vb-rate').addEventListener('change', function () {
      ensureAudio();
      audio.playbackRate = parseFloat(this.value);
    });
    app.querySelector('#vb-sleep').addEventListener('change', function () {
      setSleep(parseInt(this.value, 10));
    });
    app.querySelector('#vb-loop').addEventListener('change', function () {
      ensureAudio();
      audio.loop = this.checked;
    });
    els.bar.addEventListener('click', function (e) {
      ensureAudio();
      var d = totalDuration();
      if (!d) return;
      var rect = this.getBoundingClientRect();
      stopAt = null;
      audio.currentTime = ((e.clientX - rect.left) / rect.width) * d;
      audio.play();
    });
  }

  function onChip(chip) {
    var kind = chip.dataset.filter;
    if (kind === 'reset') {
      filter.root = filter.lv = null;
      filter.q = '';
      els.search.value = '';
    } else {
      var val = kind === 'lv' ? parseInt(chip.dataset.val, 10) : chip.dataset.val;
      filter[kind] = filter[kind] === val ? null : val;   // 再按一次取消
    }
    app.querySelectorAll('.vb-chip').forEach(function (c) {
      var k = c.dataset.filter;
      var v = k === 'lv' ? parseInt(c.dataset.val, 10) : c.dataset.val;
      c.setAttribute('aria-pressed', String(k !== 'reset' && filter[k] === v));
    });
    paint();
  }

  // ── 播放 ────────────────────────────────────────
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio('/vocab/audio/track-01.mp3');
    audio.preload = 'metadata';
    audio.addEventListener('timeupdate', onTick);
    audio.addEventListener('play', function () { els.playBtn.textContent = '⏸ 暫停'; });
    audio.addEventListener('pause', function () { els.playBtn.textContent = '▶ 睡前播放'; });
    return audio;
  }

  function playWord(word) {
    var o = OFFSETS[word];
    if (!o) return;
    ensureAudio();
    stopAt = o.end;
    audio.currentTime = o.start;
    audio.play();
  }

  function toggleAll() {
    ensureAudio();
    if (audio.paused) { stopAt = null; audio.play(); }
    else audio.pause();
  }

  function onTick() {
    if (stopAt !== null && audio.currentTime >= stopAt) {
      audio.pause();
      stopAt = null;
    }
    var d = totalDuration();
    if (d) els.fill.style.width = (audio.currentTime / d * 100) + '%';
    highlight(currentWord());
  }

  function currentWord() {
    var t = audio.currentTime;
    var words = (DATA.roots || []).reduce(function (a, r) { return a.concat(r.words); }, []);
    for (var i = 0; i < words.length; i++) {
      var o = OFFSETS[words[i].w];
      if (o && t >= o.start && t < o.end) return words[i];
    }
    return null;
  }

  var lastEl = null;
  function highlight(w) {
    if (!w) return;
    els.now.innerHTML = '正在播放　<b>' + esc(w.w) + '</b>　' + esc(w.zh);
    var el = els.list.querySelector('.vb-word[data-w="' + cssEsc(w.w) + '"]');
    if (el === lastEl) return;
    if (lastEl) lastEl.classList.remove('is-playing');
    if (el) {
      el.classList.add('is-playing');
      // 只在整軌播放時跟著捲動，單字試聽不打擾閱讀
      if (stopAt === null) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    lastEl = el;
  }

  function setSleep(min) {
    clearTimeout(sleepTimer);
    if (!min) return;
    sleepTimer = setTimeout(function () {
      if (audio && !audio.paused) fadeOut();
    }, min * 60 * 1000);
  }

  // 睡眠定時到了不要硬切，淡出比較不會把人吵醒
  function fadeOut() {
    var v = audio.volume;
    var step = setInterval(function () {
      v -= 0.05;
      if (v <= 0) {
        clearInterval(step);
        audio.pause();
        audio.volume = 1;
      } else {
        audio.volume = v;
      }
    }, 400);
  }

  function totalDuration() {
    if (audio && isFinite(audio.duration) && audio.duration) return audio.duration;
    var words = (DATA.roots || []).reduce(function (a, r) { return a.concat(r.words); }, []);
    var last = words.length ? OFFSETS[words[words.length - 1].w] : null;
    return last ? last.end : 0;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
})();
