/* Podcast site. All content loads at runtime from site.json and episodes.json. */
(function () {
  'use strict';

  const PREVIEW = !!window.__PREVIEW__;
  const RATES = [1, 1.25, 1.5, 2];
  const SKIP_BACK = 15, SKIP_FWD = 30;
  const FONTS = {
    'inter': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'space-grotesk': "'Space Grotesk', system-ui, -apple-system, sans-serif",
    'lora': "'Lora', Georgia, 'Times New Roman', serif",
    'fraunces': "'Fraunces', Georgia, 'Times New Roman', serif",
    'system-sans': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    'system-serif': "ui-serif, Georgia, 'Times New Roman', serif",
    'system-rounded': "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
    'system-mono': "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  };

  const mem = {};
  const store = {
    get(k) { if (PREVIEW) return k in mem ? mem[k] : null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { if (PREVIEW) { mem[k] = String(v); return; } try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } }
  };

  const $ = (s) => document.querySelector(s);
  const audio = $('#audio');
  const root = document.documentElement;
  const ui = {
    status: $('#status'), list: $('#episodes'), player: $('#player'),
    seek: $('#p-seek'), cur: $('#p-cur'), dur: $('#p-dur'), play: $('#p-play'),
    title: $('#p-title'), sub: $('#p-sub'), cover: $('#p-cover'), speed: $('#p-speed'),
    prev: $('#p-prev'), next: $('#p-next'), back: $('#p-back'), fwd: $('#p-fwd')
  };

  let site = null, episodes = [], sorted = [], items = {}, map = {};
  let current = null, pendingSeek = 0, pendingForce = false, scrubbing = false, seekHold = false, seekHoldTimer = 0, lastTarget = 0, lastSave = 0, lastPosState = 0;
  let rate = parseFloat(store.get('pc:rate')) || 1;
  if (RATES.indexOf(rate) < 0) rate = 1;
  let userMode = store.get('pc:mode');

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }
  function parseDuration(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string' || !v) return 0;
    if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    const p = v.split(':').map(Number);
    if (p.some(isNaN)) return 0;
    return p.reduce((a, x) => a * 60 + x, 0);
  }
  function fmtDuration(sec) {
    sec = Math.round(sec);
    if (!sec) return '';
    if (sec < 60) return sec + ' sec';
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  }
  function fmtDate(d) {
    if (!d) return '';
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00Z') : new Date(d);
    if (isNaN(dt)) return d;
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(dt); }
    catch (e) { return d; }
  }
  function resolve(p) { return (p && map[p]) || p || ''; }
  function audioSrc(ep) {
    const u = ep.audioUrl || '';
    if (/^(https?:|blob:|data:|\/)/i.test(u) || map[u]) return resolve(u);
    if (site && site.r2BaseUrl && u && u.indexOf('/') < 0) return site.r2BaseUrl.replace(/\/+$/, '') + '/' + u;
    return u;
  }
  function coverSrc(ep) {
    return resolve(ep.coverPath) || resolve((site && site.homeScreen && site.homeScreen.icon) || 'icons/icon-512.png');
  }
  function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }
  function sec(name) { return !site.sections || site.sections[name] !== false; }

  function hexToRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(h) {
    const c = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /* ---------- theme ---------- */
  function effectiveMode() {
    if (userMode === 'light' || userMode === 'dark') return userMode;
    const d = site && site.theme && site.theme.defaultMode;
    if (d === 'light' || d === 'dark') return d;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const t = site.theme || {};
    const mode = effectiveMode(), dark = mode === 'dark';
    const bg = dark ? (t.backgroundDark || '#121212') : (t.background || '#fbfaf8');
    const text = dark ? (t.textDark || '#efede8') : (t.text || '#1c1b1a');
    const accent = (dark && t.accentDark) || t.accent || '#e8590c';
    const s = root.style;
    s.setProperty('--accent', accent);
    s.setProperty('--on-accent', lum(accent) > 0.4 ? '#111' : '#fff');
    s.setProperty('--bg', bg);
    s.setProperty('--text', text);
    s.setProperty('--font-body', FONTS[t.bodyFont] || FONTS['system-sans']);
    s.setProperty('--font-heading', FONTS[t.headingFont] || FONTS[t.bodyFont] || FONTS['system-sans']);
    root.dataset.theme = mode;
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = bg;
    const btn = $('#theme-toggle');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.hidden = !sec('themeToggle');
  }

  /* ---------- header / about ---------- */
  function renderHeader() {
    $('#site-name').textContent = site.name || '';
    document.title = site.name || document.title;
    const tag = $('#tagline');
    tag.textContent = site.tagline || '';
    tag.hidden = !(site.tagline && sec('tagline'));
    const logo = $('#logo');
    if (site.logo && sec('logo')) { logo.src = resolve(site.logo); logo.hidden = false; } else { logo.hidden = true; }
    const about = $('#about');
    about.textContent = '';
    if (site.about && sec('about')) {
      String(site.about).split(/\n{2,}/).forEach((para) => about.appendChild(el('p', '', para.trim())));
      about.hidden = false;
    } else about.hidden = true;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && (site.description || site.tagline)) desc.content = site.description || site.tagline;
    const at = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const appName = (site.homeScreen && site.homeScreen.appName) || site.name;
    if (at && appName) at.content = appName;
  }

  /* ---------- episode list ---------- */
  function sortEpisodes() {
    sorted = episodes.slice();
    if (site.order !== 'manual') {
      sorted.sort((a, b) => {
        const da = String(a.date || ''), db = String(b.date || '');
        if (da !== db) return da < db ? 1 : -1;
        return (Number(b.number) || 0) - (Number(a.number) || 0);
      });
    }
  }
  function savedPos(ep) { return parseFloat(store.get('pc:pos:' + ep.id)) || 0; }

  function renderList() {
    ui.list.textContent = '';
    items = {};
    ui.list.className = 'episodes ' + (site.layout === 'grid' ? 'grid' : 'list');
    ui.status.textContent = sorted.length ? '' : 'No episodes yet.';
    const orderLabel = $('#order-label');
    if (orderLabel) orderLabel.textContent = sorted.length > 1 && site.order !== 'manual' ? 'Newest first' : '';
    const showDesc = sec('descriptions');
    sorted.forEach((ep) => {
      const li = el('li', 'ep');
      li.dataset.id = ep.id;
      const cover = el('button', 'ep-cover');
      cover.type = 'button'; cover.tabIndex = -1; cover.setAttribute('aria-hidden', 'true');
      const img = el('img'); img.src = coverSrc(ep); img.alt = ''; img.loading = 'lazy'; img.width = 120; img.height = 120;
      cover.appendChild(img);
      cover.addEventListener('click', () => toggleEpisode(ep));

      const body = el('div', 'ep-body');
      const bits = [];
      if (ep.number != null && ep.number !== '' && sec('episodeNumbers')) bits.push('Episode ' + ep.number);
      if (ep.date) bits.push(fmtDate(ep.date));
      const d = fmtDuration(parseDuration(ep.duration));
      if (d) bits.push(d);
      body.appendChild(el('h3', 'ep-title', ep.title || 'Untitled'));
      let desc = null, more = null;
      if (showDesc && ep.description) {
        desc = el('div', 'ep-desc clamped');
        String(ep.description).split(/\n{2,}/).forEach((p) => desc.appendChild(el('p', '', p.trim())));
        body.appendChild(desc);
      }
      if (desc) {
        const actions = el('div', 'ep-actions');
        more = el('button', 'btn link', 'Show more'); more.type = 'button'; more.hidden = true;
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
          const open = desc.classList.toggle('clamped') === false;
          more.textContent = open ? 'Show less' : 'Show more';
          more.setAttribute('aria-expanded', String(open));
        });
        actions.appendChild(more);
        body.appendChild(actions);
      }
      body.appendChild(el('p', 'ep-meta', bits.join(' · ')));
      const prog = el('div', 'ep-progress empty'); prog.appendChild(el('span'));
      body.appendChild(prog);

      const play = el('button', 'ep-play'); play.type = 'button';
      play.addEventListener('click', () => toggleEpisode(ep));

      li.appendChild(cover); li.appendChild(body); li.appendChild(play);
      ui.list.appendChild(li);
      items[ep.id] = { li, play, prog, desc, more, ep };
      const total = parseDuration(ep.duration), pos = savedPos(ep);
      setProgress(items[ep.id], pos, total);
    });
    requestAnimationFrame(() => Object.keys(items).forEach((id) => {
      const it = items[id];
      if (it.desc && it.more) it.more.hidden = it.desc.scrollHeight <= it.desc.clientHeight + 1;
    }));
    updateListState();
  }
  function setProgress(it, pos, total) {
    const pct = total > 0 ? Math.min(100, (pos / total) * 100) : 0;
    it.prog.classList.toggle('empty', pct <= 0);
    it.prog.firstChild.style.width = pct + '%';
  }
  function updateListState() {
    Object.keys(items).forEach((id) => {
      const it = items[id];
      const isCur = current && current.id === id;
      const playing = isCur && !audio.paused;
      it.li.classList.toggle('is-current', !!isCur);
      it.play.textContent = playing ? 'Pause' : (isCur ? 'Resume' : 'Play');
      it.play.classList.toggle('is-on', !!playing);
      it.play.setAttribute('aria-label', (playing ? 'Pause: ' : 'Play: ') + (it.ep.title || 'episode'));
    });
  }

  /* ---------- playback ---------- */
  function saveProgress() {
    if (!current) return;
    const t = audio.currentTime;
    if (isFinite(t) && t > 0 && !audio.ended) store.set('pc:pos:' + current.id, Math.floor(t));
    store.set('pc:last', current.id);
    lastSave = Date.now();
  }
  function neighbor(dir) {
    if (!current) return null;
    const idx = sorted.findIndex((e) => e.id === current.id);
    if (idx < 0) return null;
    const step = site.autoplayNext === 'newer' ? -1 : 1;
    return sorted[idx + dir * step] || null;
  }
  function loadEpisode(ep, autoplay) {
    if (!ep) return;
    const changed = !current || current.id !== ep.id;
    if (changed) saveProgress();
    current = ep;
    if (changed) {
      audio.src = audioSrc(ep);          // same <audio> element, only the source changes
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      pendingSeek = savedPos(ep); pendingForce = false; seekHold = false; scrubbing = false;
      const total = parseDuration(ep.duration);
      ui.seek.max = total || 0;
      ui.seek.value = pendingSeek;
      setSeekUi(pendingSeek, total);
    }
    store.set('pc:last', ep.id);
    ui.player.hidden = false;
    document.body.classList.add('has-player');
    updatePlayerUi();
    updateMediaMetadata();
    syncPlayerSpace();
    if (autoplay) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => { updatePlayerUi(); });
    }
  }
  function toggleEpisode(ep) {
    if (current && current.id === ep.id) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
    else loadEpisode(ep, true);
  }
  function setSeekUi(t, total) {
    ui.cur.textContent = fmtTime(t);
    ui.dur.textContent = fmtTime(total);
    const max = parseFloat(ui.seek.max) || 0;
    ui.seek.style.setProperty('--pct', (max > 0 ? Math.min(100, (t / max) * 100) : 0) + '%');
    ui.seek.setAttribute('aria-valuetext', fmtTime(t) + ' of ' + fmtTime(total));
  }
  function updatePlayerUi() {
    if (!current) return;
    ui.title.textContent = current.title || '';
    const bits = [];
    if (current.number != null && current.number !== '') bits.push('Episode ' + current.number);
    if (site && site.name) bits.push(site.name);
    ui.sub.textContent = bits.join(' · ');
    ui.cover.src = coverSrc(current);
    const playing = !audio.paused;
    ui.player.classList.toggle('is-playing', playing);
    ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    ui.prev.disabled = !neighbor(-1);
    ui.next.disabled = !neighbor(1);
    ui.speed.textContent = rate + '×';
    ui.speed.setAttribute('aria-label', 'Playback speed ' + rate + 'x. Tap to change.');
    updateListState();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
  function syncPlayerSpace() {
    const h = ui.player.hidden ? 0 : ui.player.offsetHeight;
    root.style.setProperty('--player-space', (h ? h + 16 : 0) + 'px');
  }
  /* Single entry point for every user seek (slider, skip buttons, lock screen).
     Holds the slider at the target until the browser reports 'seeked', so stale
     timeupdate events can't snap the playhead back. */
  function seekTo(t) {
    const dur = isFinite(audio.duration) ? audio.duration : (current ? parseDuration(current.duration) : 0);
    t = Math.max(0, Math.min(dur > 0 ? dur : Infinity, t));
    if (!isFinite(t)) return;
    lastTarget = t;
    ui.seek.value = t;
    setSeekUi(t, dur);
    if (audio.readyState < 1) { pendingSeek = t; pendingForce = true; return; }   // metadata not ready yet: apply on loadedmetadata
    seekHold = true;
    clearTimeout(seekHoldTimer);
    seekHoldTimer = setTimeout(() => { seekHold = false; onTime(); }, 2000);       // safety net if 'seeked' never fires
    try { audio.currentTime = t; } catch (e) { seekHold = false; }
  }
  function seekBy(d) { seekTo(audio.currentTime + d); }

  function onTime() {
    const t = audio.currentTime;
    const d = isFinite(audio.duration) ? audio.duration : (current ? parseDuration(current.duration) : 0);
    if (!scrubbing && !seekHold) { ui.seek.value = t; setSeekUi(t, d); }
    if (Date.now() - lastSave > 3000) {
      saveProgress();
      if (current && items[current.id]) setProgress(items[current.id], t, d);
    }
    if (Date.now() - lastPosState > 10000) updatePositionState();
  }

  /* ---------- Media Session (lock screen / Control Center) ---------- */
  function updateMediaMetadata() {
    if (!('mediaSession' in navigator) || !current || typeof MediaMetadata === 'undefined') return;
    const src = absUrl(coverSrc(current));
    const type = /\.png(\?|$)/i.test(src) ? 'image/png' : /\.webp(\?|$)/i.test(src) ? 'image/webp' : 'image/jpeg';
    const art = ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'].map((s) => ({ src, sizes: s, type }));
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title || '', artist: site.name || '', album: site.name || '', artwork: art
      });
    } catch (e) { /* ignore */ }
  }
  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    lastPosState = Date.now();
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.max(0, Math.min(audio.currentTime, d)) });
    } catch (e) { /* ignore */ }
  }
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* unsupported */ } };
    set('play', () => { audio.play().catch(() => {}); });
    set('pause', () => { audio.pause(); });
    set('seekbackward', (d) => seekBy(-((d && d.seekOffset) || SKIP_BACK)));
    set('seekforward', (d) => seekBy((d && d.seekOffset) || SKIP_FWD));
    set('seekto', (d) => { if (d && typeof d.seekTime === 'number') { seekTo(d.seekTime); updatePositionState(); } });
    if (site.lockScreenTrackButtons !== false) {
      set('previoustrack', () => { const e = neighbor(-1); if (e) loadEpisode(e, true); });
      set('nexttrack', () => { const e = neighbor(1); if (e) loadEpisode(e, true); });
    } else {
      set('previoustrack', null);
      set('nexttrack', null);
    }
  }

  function wirePlayer() {
    ui.play.addEventListener('click', () => { if (!current) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); });
    ui.back.addEventListener('click', () => seekBy(-SKIP_BACK));
    ui.fwd.addEventListener('click', () => seekBy(SKIP_FWD));
    ui.prev.addEventListener('click', () => { const e = neighbor(-1); if (e) loadEpisode(e, true); });
    ui.next.addEventListener('click', () => { const e = neighbor(1); if (e) loadEpisode(e, true); });
    ui.speed.addEventListener('click', () => {
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      audio.defaultPlaybackRate = rate; audio.playbackRate = rate;
      store.set('pc:rate', rate);
      updatePlayerUi();
    });
    // Scrubbing: the slider only updates the UI while dragging; the seek is committed once on release.
    let commitPending = false;
    function commitScrub() {
      if (!scrubbing) return;
      scrubbing = false;
      commitPending = false;
      seekTo(parseFloat(ui.seek.value) || 0);
      saveProgress();
    }
    const beginScrub = () => { scrubbing = true; commitPending = true; };
    ui.seek.addEventListener('pointerdown', beginScrub);
    ui.seek.addEventListener('touchstart', beginScrub, { passive: true });
    ui.seek.addEventListener('keydown', beginScrub);
    ui.seek.addEventListener('input', () => {
      scrubbing = true;
      setSeekUi(parseFloat(ui.seek.value) || 0, parseFloat(ui.seek.max) || 0);
    });
    ui.seek.addEventListener('change', commitScrub);
    ui.seek.addEventListener('keyup', commitScrub);
    // Release can happen outside the slider (finger/cursor drifted off) or be cancelled by iOS: commit anyway.
    ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach((n) => window.addEventListener(n, () => { if (commitPending) setTimeout(commitScrub, 0); }, true));
    window.addEventListener('blur', () => { if (commitPending) commitScrub(); });

    audio.addEventListener('play', () => { ui.status.textContent = ''; updatePlayerUi(); updatePositionState(); });
    audio.addEventListener('pause', () => { saveProgress(); updatePlayerUi(); updatePositionState(); });
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeked', () => {
      seekHold = false; clearTimeout(seekHoldTimer);
      // A jump far from the target on a stream with no seekable ranges means the server ignored the Range header.
      if (lastTarget > 2 && !audio.seekable.length && Math.abs(audio.currentTime - lastTarget) > 2) {
        ui.status.textContent = 'Skipping ahead is not available for this episode (the audio server must support Range requests).';
      } else if (ui.status.textContent.indexOf('Skipping ahead') === 0) ui.status.textContent = '';
      lastTarget = 0;
      onTime(); updatePositionState();
    });
    audio.addEventListener('ratechange', updatePositionState);
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      if (isFinite(d)) {
        ui.seek.max = d;
        if (pendingSeek > 0 && (pendingForce ? pendingSeek < d : pendingSeek < d - 3)) { audio.currentTime = pendingSeek; if (pendingForce) { ui.seek.value = pendingSeek; setSeekUi(pendingSeek, d); } }
        if (current && items[current.id]) setProgress(items[current.id], pendingSeek, d);
      }
      pendingSeek = 0; pendingForce = false;
      audio.playbackRate = rate;
      onTime();
      updatePositionState();
    });
    audio.addEventListener('durationchange', () => {
      if (isFinite(audio.duration)) { ui.seek.max = audio.duration; setSeekUi(audio.currentTime, audio.duration); updatePositionState(); }
    });
    audio.addEventListener('ended', () => {
      if (current) {
        store.set('pc:pos:' + current.id, 0);
        if (items[current.id]) setProgress(items[current.id], 0, 1);
      }
      const next = site.autoplayNext === 'off' ? null : neighbor(1);
      if (next) loadEpisode(next, true); else updatePlayerUi();
    });
    audio.addEventListener('error', () => {
      if (!current) return;
      ui.status.textContent = 'This episode could not be played. Check your connection and try again.';
      updatePlayerUi();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
    window.addEventListener('pagehide', saveProgress);
    window.addEventListener('resize', syncPlayerSpace);
    if (window.ResizeObserver) new ResizeObserver(syncPlayerSpace).observe(ui.player);
  }

  /* ---------- Add to Home Screen hint ---------- */
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
  function isIOSSafari() { return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent); }
  function renderHint() {
    const box = $('#hint');
    const enabled = sec('hint') && (!site.homeScreen || site.homeScreen.showHint !== false);
    let show = enabled;
    if (!PREVIEW) show = enabled && isIOSSafari() && !isStandalone() && store.get('pc:hint-dismissed') !== '1';
    box.hidden = !show;
    if (!show) return;
    const t = box.querySelector('#hint-text');
    t.textContent = '';
    const msg = (site.homeScreen && site.homeScreen.hintText) || 'Add this podcast to your Home Screen: tap Share, then Add to Home Screen.';
    t.appendChild(document.createTextNode(msg + ' '));
    const svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    const span = el('span'); span.innerHTML = svg; t.appendChild(span);
  }

  /* ---------- boot ---------- */
  function renderAll() {
    applyTheme();
    renderHeader();
    sortEpisodes();
    if (current) current = sorted.find((e) => e.id === current.id) || current;
    renderList();
    updatePlayerUi();
    renderHint();
    syncPlayerSpace();
  }
  function fetchJson(path) {
    return fetch(path, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
  }
  function start() {
    wirePlayer();
    $('#theme-toggle').addEventListener('click', () => {
      userMode = effectiveMode() === 'dark' ? 'light' : 'dark';
      store.set('pc:mode', userMode);
      applyTheme();
    });
    $('#hint-close').addEventListener('click', () => { store.set('pc:hint-dismissed', '1'); $('#hint').hidden = true; });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (site) applyTheme(); });

    if (PREVIEW) {
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.type !== 'podcast-preview') return;
        if (d.map) map = d.map;
        if ('mode' in d) userMode = (d.mode === 'light' || d.mode === 'dark') ? d.mode : null;
        site = d.site; episodes = d.episodes || [];
        if (!ui.status.dataset.ready) { ui.status.dataset.ready = '1'; setupMediaSession(); }
        renderAll();
      });
      parent.postMessage({ type: 'preview-ready' }, '*');
      return;
    }

    Promise.all([fetchJson('site.json'), fetchJson('episodes.json')]).then((res) => {
      site = res[0] || {};
      episodes = Array.isArray(res[1]) ? res[1] : (res[1] && res[1].episodes) || [];
      setupMediaSession();
      renderAll();
      const last = store.get('pc:last');
      const ep = sorted.find((e) => e.id === last);
      if (ep) loadEpisode(ep, false);   // restore last episode and position, paused
    }).catch(() => {
      ui.status.textContent = 'Could not load the podcast data. Please refresh to try again.';
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }
  }
  start();
})();
