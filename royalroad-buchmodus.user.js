// ==UserScript==
// @name         Royal Road Buchmodus
// @namespace    rr-buchmodus
// @version      1.9
// @description  Liest Royal-Road-Kapitel wie ein Buch: umblättern, Doppelseite, Vollbild (auch iPad), Serifenschrift, Sepia/Dunkel, nahtlos ins nächste Kapitel.
// @match        https://www.royalroad.com/fiction/*/chapter/*
// @match        https://royalroad.com/fiction/*/chapter/*
// @homepageURL  https://github.com/Intertwined4/Royal-Road-als-Buch
// @updateURL    https://raw.githubusercontent.com/Intertwined4/Royal-Road-als-Buch/main/royalroad-buchmodus.user.js
// @downloadURL  https://raw.githubusercontent.com/Intertwined4/Royal-Road-als-Buch/main/royalroad-buchmodus.user.js
// @grant        none
// @inject-into  auto
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Einstellungen ----------
  const STORE = 'rrBook.settings';
  const FLAG = 'rrBook.openAt'; // 'start' | 'end' – nur für den Notfall-Fallback mit Neuladen
  const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(navigator.userAgent));
  const fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const defaults = { open: false, mode: 'paged', theme: 'sepia', size: (Math.min(screen.width, screen.height) < 640 ? 18 : 20), font: 0, spread: 'auto', view: 'dock' }; // view: 'dock' (Rand zum Andocken) | 'fs' (Vollbild)
  const FONTS = [
    { name: 'Buch', css: '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif' },
    { name: 'Georgia', css: 'Georgia,"Times New Roman",serif' },
    { name: 'Sans', css: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' },
  ];
  const THEMES = ['sepia', 'light', 'dark'];
  let s = load();

  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE) || '{}')); }
    catch (e) { return Object.assign({}, defaults); }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {} }
  function flagGet() { try { const v = sessionStorage.getItem(FLAG); sessionStorage.removeItem(FLAG); return v; } catch (e) { return null; } }
  function flagSet(v) { try { sessionStorage.setItem(FLAG, v); } catch (e) {} }

  // ---------- Kapitel aus einer Seite auslesen ----------
  // CSS-Regeln, mit denen Royal Road Text versteckt (z. B. Kopierschutz-Sätze)
  function hiddenSelectors(doc) {
    const out = [];
    doc.querySelectorAll('style').forEach(st => {
      const re = /([^{}]+)\{([^{}]*)\}/g; let m;
      while ((m = re.exec(st.textContent))) {
        if (/display\s*:\s*none|speak\s*:\s*never|visibility\s*:\s*hidden/i.test(m[2])) out.push(m[1].trim());
      }
    });
    return out;
  }

  // Kopie eines Textblocks ohne versteckte Elemente, Skripte und Fremdformatierung
  function cleanClone(el, live, hideSels) {
    if (live) el.querySelectorAll('*').forEach(n => {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') n.setAttribute('data-rr-hide', '');
    });
    const c = el.cloneNode(true);
    if (live) el.querySelectorAll('[data-rr-hide]').forEach(n => n.removeAttribute('data-rr-hide'));
    hideSels.forEach(sel => { try { c.querySelectorAll(sel).forEach(n => n.remove()); } catch (e) {} });
    c.querySelectorAll('[data-rr-hide], script, style, iframe, ins, noscript, button, link').forEach(n => n.remove());
    // Fremdformatierung raus (auch Abstände und Einzüge des Autors – die setzt der Buchmodus selbst)
    c.querySelectorAll('[style]').forEach(n => {
      ['font-family', 'font-size', 'line-height', 'color', 'background', 'background-color',
        'width', 'max-width', 'min-width', 'height', 'min-height', 'border-color', 'white-space', 'text-indent',
        'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
        'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right']
        .forEach(p => n.style.removeProperty(p));
    });
    c.querySelectorAll('[width]').forEach(n => n.removeAttribute('width'));
    c.querySelectorAll('font').forEach(n => { n.removeAttribute('face'); n.removeAttribute('size'); n.removeAttribute('color'); });

    const NB = s => s.replace(/\u00a0/g, ' ').trim();
    const isBr = n => n.nodeName === 'BR';
    const isWs = n => n.nodeType === 3 && !NB(n.textContent);
    const mkScene = () => { const p = document.createElement('p'); p.className = 'scene'; p.textContent = '⁂'; return p; };

    // Blöcke, deren Absätze nur durch <br><br> getrennt sind, in echte Absätze zerlegen
    [c, ...c.querySelectorAll('p, div')].forEach(b => {
      if (b !== c && !c.contains(b)) return;
      if (b.querySelector('p, div, table, ul, ol, blockquote, h1, h2, h3, h4')) return;
      const kids = [...b.childNodes];
      let dbl = false;
      for (let i = 0; i < kids.length && !dbl; i++) if (isBr(kids[i])) {
        let j = i + 1; while (j < kids.length && isWs(kids[j])) j++;
        if (j < kids.length && isBr(kids[j])) dbl = true;
      }
      if (!dbl) return;
      const frag = document.createDocumentFragment();
      const style = b.getAttribute('style');
      let curP = null, brs = 0, pend = [];
      const flush = () => { if (curP && NB(curP.textContent)) frag.appendChild(curP); curP = null; };
      kids.forEach(k => {
        if (isBr(k)) { brs++; pend.push(k); return; }
        if (isWs(k)) { pend.push(k); return; }
        if (brs >= 2) { flush(); if (brs >= 3) frag.appendChild(mkScene()); }
        else if (curP) pend.forEach(x => curP.appendChild(x));
        brs = 0; pend = [];
        if (!curP) { curP = document.createElement('p'); if (style) curP.setAttribute('style', style); }
        curP.appendChild(k);
      });
      flush();
      if (b === c) { c.textContent = ''; c.appendChild(frag); } else b.replaceWith(frag);
    });

    // Leerzeilen entfernen; mehrere Leerzeilen hintereinander = Szenenwechsel
    const blank = el => /^(P|DIV)$/.test(el.nodeName) && !NB(el.textContent) && !el.querySelector('img, table, hr, iframe, svg');
    [c, ...c.querySelectorAll('div, blockquote')].forEach(box => {
      if (box !== c && !c.contains(box)) return;
      let run = [];
      const endRun = () => {
        if (run.length >= 2) { run[0].replaceWith(mkScene()); run.slice(1).forEach(x => x.remove()); }
        else run.forEach(x => x.remove());
        run = [];
      };
      [...box.children].forEach(el => { if (blank(el)) run.push(el); else endRun(); });
      endRun();
    });

    // Szenentrenner aus Sternchen & Co. vereinheitlichen
    c.querySelectorAll('p, div').forEach(p => {
      if (p.querySelector('img, table, hr')) return;
      const t = NB(p.textContent);
      if (/^([*~#•·◇◆✦=\-–—_]\s*){3,}$/.test(t) || /^[*~#◇◆✦⁂]$/.test(t)) { p.className = 'scene'; p.textContent = '⁂'; }
    });
    // Text-Divs wie Absätze behandeln
    c.querySelectorAll('div').forEach(d => {
      if (!d.classList.contains('scene') && NB(d.textContent) && !d.querySelector('p, div, table, ul, ol, blockquote, img'))
        d.classList.add('para');
    });
    // doppelte Szenentrenner zusammenfassen
    c.querySelectorAll('.scene + .scene').forEach(x => x.remove());
    c.removeAttribute('class'); c.removeAttribute('id');
    return c;
  }

  function extract(doc, live, url) {
    const content = doc.querySelector('.chapter-inner.chapter-content, .chapter-content');
    if (!content) return null;
    const hs = hiddenSelectors(doc);
    const txt = sel => (doc.querySelector(sel) || {}).textContent?.trim() || '';
    const findNav = word => {
      const a = [...doc.querySelectorAll('a')].find(el =>
        el.textContent.trim().toLowerCase().includes(word) && el.getAttribute('href') &&
        !el.hasAttribute('disabled') && !el.classList.contains('disabled'));
      return a ? new URL(a.getAttribute('href'), url).href : null;
    };
    const notes = [...doc.querySelectorAll('.author-note-portlet')];
    const isBefore = n => !!(n.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING);
    const noteClone = n => cleanClone(n.querySelector('.author-note') || n, live, hs);
    return {
      url,
      docTitle: doc.title,
      chapTitle: txt('.fic-header h1') || txt('h1') || doc.title,
      ficTitle: txt('.fic-header h2'),
      nextUrl: findNav('next chapter'),
      prevUrl: findNav('previous chapter'),
      before: notes.filter(isBefore).map(noteClone),
      body: cleanClone(content, live, hs),
      after: notes.filter(n => !isBefore(n)).map(noteClone),
    };
  }

  const startUrl = location.href;
  let cur = extract(document, true, startUrl);
  if (!cur) return;

  // Kapitel im Hintergrund laden (für nahtloses Weiterblättern ohne Neuladen)
  const pageFetch = (typeof content === 'object' && content && typeof content.fetch === 'function') ? content.fetch.bind(content) : window.fetch.bind(window);
  const cache = new Map();
  function fetchChapter(url) {
    if (!cache.has(url)) {
      const p = pageFetch(url, { credentials: 'include' }).then(r => r.ok ? r.text() : Promise.reject(r.status));
      p.catch(() => cache.delete(url));
      cache.set(url, p);
    }
    return cache.get(url);
  }

  // ---------- Vollbild ----------
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function enterFs() {
    const el = host; // den Leser selbst ins Vollbild – Safari zieht ihn dann auf volle Bildschirmgröße
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!f || fsEl()) return;
    try { const p = f.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  function exitFs() {
    const f = document.exitFullscreen || document.webkitExitFullscreen;
    if (!f || !fsEl()) return;
    try { const p = f.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  // bei jeder Berührung im Leser Vollbild wiederherstellen, falls gewünscht
  function ensureFs() { if (fsOK && s.view === 'fs' && isOpen && !fsEl()) enterFs(); }

  // ---------- Leser ----------
  let host, root, wrap, spacer, pullEl, reader, bar, viewport, clip, pages, info, bar2;
  let page = 0, pageCount = 1, step = 1, built = false, isOpen = false, loading = false, closing = false;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .reader { position: absolute; inset: 0; z-index: 2147483647; display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
  .theme-sepia { --bg:#f4ecd8; --fg:#3b2f22; --muted:#8f7f66; --line:#e0d2b2; --accent:#8a5a1f; --btn:#ebe0c6; }
  .theme-light { --bg:#fbfaf7; --fg:#1f1e1c; --muted:#8a857a; --line:#e6e2d9; --accent:#7a5c2e; --btn:#f0ede6; }
  .theme-dark  { --bg:#191816; --fg:#d8d2c6; --muted:#7d776c; --line:#2f2d29; --accent:#c9a46a; --btn:#24221f; }

  .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px;
    font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted);
    border-bottom: 1px solid var(--line); transition: opacity .2s; min-height: 44px; }
  .bar.hidden, .foot.hidden { opacity: 0; pointer-events: none; }
  .titles { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .titles b { color: var(--fg); font-weight: 600; }
  .ctrls { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .ctrls button, .end a { font: inherit; color: var(--fg); background: var(--btn); border: 1px solid var(--line);
    border-radius: 6px; padding: 5px 9px; cursor: pointer; text-decoration: none; }
  .ctrls button:hover, .end a:hover { border-color: var(--accent); }
  /* Andock-Modus: Rand oben, Buch rastet darunter ein */
  .wrap { background: var(--bg); }
  .spacer { display: none; }
  .wrap.dock .spacer { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 14px;
    height: 160px; padding-bottom: 18px; scroll-snap-align: start; color: var(--muted);
    font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; border-bottom: 1px dashed var(--line); }
  .spacer .sp-hint { font-size: 14px; letter-spacing: .02em; }
  .spacer .sp-hint b { display: block; text-align: center; font-size: 20px; line-height: 1; margin-top: 4px; animation: nudge 1.6s ease-in-out infinite; }
  @keyframes nudge { 0%,100% { transform: translateY(0); } 50% { transform: translateY(5px); } }
  .spacer button { font: inherit; color: var(--fg); background: var(--btn); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; }
  .wrap.dock .reader { position: relative; inset: auto; height: 100vh; height: 100lvh; scroll-snap-align: start; scroll-snap-stop: always;
    transition: transform .25s ease; }
  .wrap.dock .reader.dragging { transition: none; }
  .pull { position: absolute; left: 0; right: 0; top: -54px; height: 54px; display: flex; align-items: center; justify-content: center;
    font: 13px system-ui, -apple-system, sans-serif; color: var(--muted); pointer-events: none; }
  .pull.ready { color: var(--accent); font-weight: 600; }
  .reader.fs .bar { padding-left: 84px; } /* Platz für Safaris Vollbild-✕ */
  .ctrls button.on { border-color: var(--accent); color: var(--accent); }
  .ctrls button:disabled { opacity: .35; cursor: default; }

  .viewport { flex: 1; min-height: 0; padding: 40px 5vw 28px; display: flex; justify-content: center; }
  .clip { height: 100%; width: 100%; }
  .paged .clip { overflow: hidden; }
  .scroll .clip { overflow-y: auto; max-width: none; }
  .scroll .viewport { padding: 0; }
  .scroll .pages { max-width: 34em; margin: 0 auto; padding: 3em 1.5em 6em; }
  .paged .pages { height: 100%; column-fill: auto; column-count: var(--cols); column-gap: var(--gap); }
  .paged.reader-spread .pages { column-rule: 1px solid var(--line); }

  .pages { font-family: var(--font); font-size: var(--size); line-height: 1.62; text-align: justify;
    hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; overflow-wrap: break-word; }
  .pages p, .pages div { margin: 0; }
  .pages h1.ct { font-size: 1.5em; font-weight: normal; text-align: center; line-height: 1.25; margin: 2.2em 0 .3em;
    break-after: avoid; text-indent: 0; letter-spacing: .02em; }
  .pages .ft { text-align: center; font-variant: small-caps; letter-spacing: .08em; color: var(--muted);
    font-size: .8em; margin: 0 0 2.4em; text-indent: 0; }
  .pages .orn { text-align: center; color: var(--muted); margin: -1.6em 0 2em; text-indent: 0; }
  .pages p, .pages .para { text-indent: 1.4em; }
  .pages .scene + p, .pages .scene + .para, .pages hr + p, .pages h1 + p, .pages h2 + p, .pages h3 + p,
  .pages table + p, .pages .lead, .pages .nofirst { text-indent: 0; }
  .pages .lead::first-letter { float: left; font-size: 3.1em; line-height: .85;
    padding: .06em .08em 0 0; color: var(--accent); }
  .pages [style*="center"], .pages center, .pages [align="center"] { text-indent: 0; }
  .pages .scene, .pages hr { display: block; border: 0; text-align: center; color: var(--muted); text-indent: 0 !important;
    margin: .9em 0; letter-spacing: .3em; }
  .pages hr::after { content: "⁂"; }
  .pages h2, .pages h3, .pages h4 { font-size: 1.1em; text-align: center; margin: 1.2em 0 .6em; text-indent: 0; break-after: avoid; }
  .pages img { max-width: 100%; max-height: calc(var(--h) - 2em); height: auto; display: block; margin: 1em auto; break-inside: avoid; }
  .pages table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: .82em; line-height: 1.4;
    text-align: left; break-inside: avoid; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .pages td, .pages th { border: 1px solid var(--line); padding: .35em .6em; vertical-align: top; }
  .pages td p, .pages th p, .pages li p { text-indent: 0; }
  .pages blockquote { margin: 1em 1.5em; font-style: italic; }
  .pages ul, .pages ol { margin: .6em 0 .6em 1.5em; padding: 0; text-align: left; }
  .pages a { color: var(--accent); }
  .note { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: .78em; line-height: 1.5;
    color: var(--muted); text-align: left; hyphens: manual; border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line); padding: .8em 0; margin: 1.6em 0; break-inside: avoid; }
  .note p { text-indent: 0 !important; margin: .35em 0 !important; }
  .note .lbl { font-size: .85em; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .4em; }
  .end { text-align: center; color: var(--muted); margin: 2.5em 0 1em; text-indent: 0; break-inside: avoid;
    font-family: system-ui, sans-serif; font-size: .8em; }
  .end a { display: inline-block; margin-top: 1em; }

  .foot { display: flex; align-items: center; gap: 14px; padding: 0 5vw max(14px, env(safe-area-inset-bottom)); color: var(--muted);
    font: 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; transition: opacity .2s; }
  .prog { flex: 1; height: 2px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .prog i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .15s; }
  .help { position: absolute; right: 16px; top: 52px; background: var(--btn); border: 1px solid var(--line);
    border-radius: 8px; padding: 12px 16px; font: 13px/1.7 system-ui, sans-serif; color: var(--fg); display: none; }
  .help.show { display: block; }
  .toast { position: absolute; left: 50%; bottom: 54px; transform: translate(-50%, 12px); opacity: 0; pointer-events: none;
    display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100% - 32px)); padding: 10px 12px 10px 16px;
    background: var(--fg); color: var(--bg); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.25);
    font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; transition: opacity .25s, transform .25s; z-index: 5; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
  .toast button { flex-shrink: 0; font: 600 14px system-ui, sans-serif; color: var(--fg); background: var(--bg);
    border: 0; border-radius: 8px; padding: 8px 12px; min-height: 36px; cursor: pointer; }
  /* Handy */
  @media (max-width: 640px) {
    .bar { padding: 6px 8px; min-height: 0; }
    .reader.fs .bar { padding-left: 8px; }
    .titles { display: none; }
    .ctrls { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; width: 100%; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .ctrls::-webkit-scrollbar { display: none; }
    .ctrls button { flex-shrink: 0; padding: 6px 9px; }
    .viewport { padding: 26px 22px 14px; }
    .foot { padding: 0 22px max(10px, env(safe-area-inset-bottom)); gap: 10px; }
    .help { left: 8px; right: 8px; top: 48px; font-size: 12px; }
    .wrap.dock .spacer { height: 130px; }
    .pages h1.ct { margin-top: 1.4em; }
  }
  /* kompakte Knopfleiste (schmale Bildschirme): alle Knöpfe sichtbar, ohne seitliches Wischen */
  .reader.compact .ctrls { justify-content: space-between; gap: 4px; overflow-x: visible; }
  .reader.compact .ctrls button { min-width: 34px; padding: 7px 0; font-size: 15px; text-align: center; }
  .help kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
  `;

  function build() {
    host = document.createElement('div');
    host.id = 'rr-buchmodus';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
      <div class="spacer">
        <button data-a="close">✕ Buchmodus beenden</button>
        <div class="sp-hint">Zum Lesen nach unten scrollen<b>⌄</b></div>
      </div>
      <div class="reader">
        <div class="pull"></div>
        <header class="bar">
          <div class="titles"><b></b><span></span></div>
          <div class="ctrls">
            <button data-a="prevch" title="Vorheriges Kapitel (P)">‹ Kap.</button>
            <button data-a="smaller" title="Kleiner (−)">A−</button>
            <button data-a="bigger" title="Größer (+)">A+</button>
            <button data-a="font" title="Schriftart (F)">Schrift</button>
            <button data-a="theme" title="Farbe (T)">Farbe</button>
            <button data-a="mode" title="Blättern / Scrollen (M)"></button>
            <button data-a="spread" title="Doppelseite (D)">▯▯</button>
            <button data-a="fs" title="Vollbild (V)">⛶</button>
            <button data-a="nextch" title="Nächstes Kapitel (N)">Kap. ›</button>
            <button data-a="help" title="Tastenkürzel">?</button>
            <button data-a="close" title="Schließen (Esc)">✕</button>
          </div>
        </header>
        <div class="help">
          <kbd>→</kbd> <kbd>Leertaste</kbd> weiterblättern &nbsp; <kbd>←</kbd> zurück<br>
          Tippen rechts / links oder wischen: blättern · Mitte: Leisten ein/aus<br>
          <kbd>N</kbd> / <kbd>P</kbd> nächstes / vorheriges Kapitel<br>
          <kbd>+</kbd> <kbd>−</kbd> Schriftgröße · <kbd>F</kbd> Schrift · <kbd>T</kbd> Farbe<br>
          iPad: kräftig nach unten ziehen = zurück zum Rand oben<br>
          <kbd>M</kbd> Blättern/Scrollen · <kbd>D</kbd> Doppelseite · <kbd>V</kbd> Vollbild · <kbd>Esc</kbd> schließen<br>
          <kbd>B</kbd> auf der Kapitelseite: Buchmodus öffnen
        </div>
        <div class="viewport"><div class="clip"><article class="pages"></article></div></div>
        <div class="toast" role="status"><span></span><button type="button"></button></div>
        <footer class="foot"><span class="pi"></span><div class="prog"><i></i></div><span class="pr"></span></footer>
      </div>
      </div>`;

    wrap = root.querySelector('.wrap');
    spacer = root.querySelector('.spacer');
    pullEl = root.querySelector('.pull');
    spacer.querySelector('button').addEventListener('click', () => close());
    reader = root.querySelector('.reader');
    bar = root.querySelector('.bar');
    bar2 = root.querySelector('.foot');
    viewport = root.querySelector('.viewport');
    clip = root.querySelector('.clip');
    pages = root.querySelector('.pages');
    info = { pi: root.querySelector('.pi'), pr: root.querySelector('.pr'), bar: root.querySelector('.prog i') };
    if (!fsOK) root.querySelector('[data-a="fs"]').style.display = 'none';

    root.querySelector('.ctrls').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      act(b.dataset.a);
    });
    viewport.addEventListener('click', e => {
      if (e.target.closest('a, button, .note')) { ensureFs(); return; }
      ensureFs();
      if (s.mode !== 'paged') { toggleBars(); return; }
      const r = viewport.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width;
      if (x < 0.3) prev(); else if (x > 0.7) next(); else toggleBars();
    });
    // Wischen: blättern; im Andock-Modus kräftig nach unten ziehen = zurück zum Rand
    const PULL = 130;
    let t0 = null;
    reader.addEventListener('touchstart', e => {
      const p = e.touches[0];
      const path = e.composedPath();
      t0 = { x: p.clientX, y: p.clientY, docked: isDocked(), clipTop: clip.scrollTop, inBar: path.includes(bar) };
    }, { passive: true });
    reader.addEventListener('touchmove', e => {
      if (!t0 || !t0.docked) return; // nicht angedockt → Seite scrollt normal (zum Einrasten)
      const p = e.touches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y;
      if (t0.inBar) { if (Math.abs(dy) > Math.abs(dx)) e.preventDefault(); return; } // Knopfleiste seitlich scrollbar lassen
      const innerAtTop = s.mode !== 'scroll' || clip.scrollTop <= 0;
      if (s.mode === 'paged' || (dy > 0 && innerAtTop)) e.preventDefault(); // Seite bleibt stehen, Safari-Leiste bleibt weg
      if (dy > 12 && Math.abs(dy) > Math.abs(dx) && innerAtTop && t0.clipTop <= 0) {
        reader.classList.add('dragging');
        reader.style.transform = 'translateY(' + Math.round(Math.min(dy * 0.45, 80)) + 'px)';
        const ready = dy > PULL;
        pullEl.classList.toggle('ready', ready);
        pullEl.textContent = ready ? '↑ Loslassen – zurück zum Rand' : 'Weiter ziehen, um den Buchmodus zu verlassen';
      }
    }, { passive: false });
    reader.addEventListener('touchend', e => {
      if (!t0) return;
      const p = e.changedTouches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y, st = t0; t0 = null;
      const pulled = reader.classList.contains('dragging');
      reader.classList.remove('dragging'); reader.style.transform = ''; pullEl.classList.remove('ready');
      if (st.docked && pulled && dy > PULL) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (st.inBar) return;
      if (s.mode === 'paged' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { ensureFs(); dx < 0 ? next() : prev(); }
    }, { passive: true });
    reader.addEventListener('touchcancel', () => { t0 = null; reader.classList.remove('dragging'); reader.style.transform = ''; }, { passive: true });
    let wheelLock = 0;
    viewport.addEventListener('wheel', e => {
      if (s.mode !== 'paged') return;
      if (isDock() && !isDocked()) return; // erst einrasten lassen
      e.preventDefault();
      const now = Date.now(); if (now - wheelLock < 350 || Math.abs(e.deltaY) < 8) return; wheelLock = now;
      e.deltaY > 0 ? next() : prev();
    }, { passive: false });
    clip.addEventListener('scroll', () => { if (s.mode === 'scroll') updateInfo(); }, { passive: true });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => isOpen && layout(true), 150); });
    const onFsChange = () => {
      if (!fsEl() && !closing && isOpen) { s.view = 'dock'; save(); } // selbst verlassen → nicht wieder erzwingen
      applyView();
      if (isOpen && isDock()) window.scrollTo(0, 0);
      root.querySelector('[data-a="fs"]').classList.toggle('on', !!fsEl());
      reader.classList.toggle('fs', !!fsEl() && isTouch);
      if (isOpen) setTimeout(() => layout(true), 250);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('popstate', () => location.reload());

    // Einrasten nach Richtung: leicht nach unten → Buch; nach oben → Rand
    let lastY = 0, dir = 1, snapT;
    window.addEventListener('scroll', () => {
      if (!isOpen || !isDock()) return;
      const y = window.scrollY; if (y !== lastY) dir = y > lastY ? 1 : -1; lastY = y;
      clearTimeout(snapT);
      snapT = setTimeout(() => {
        const top = Math.round(reader.getBoundingClientRect().top + window.scrollY), y2 = window.scrollY;
        if (Math.abs(y2 - top) <= 2 || y2 <= 2) return;
        window.scrollTo({ top: (y2 > top || dir > 0) ? top : 0, behavior: 'smooth' });
      }, 140);
    }, { passive: true });

    if (!document.getElementById('rr-dock-style')) {
      const st = document.createElement('style'); st.id = 'rr-dock-style';
      st.textContent = `
        html.rr-dock { overflow-y: auto !important; overflow-x: hidden !important; height: auto !important; }
        html.rr-dock body { margin: 0 !important; padding: 0 !important; overflow: visible !important; height: auto !important; min-height: 0 !important; transform: none !important; }
        html.rr-dock body > *:not(#rr-buchmodus) { display: none !important; }`;
      document.head.appendChild(st);
    }
    document.body.appendChild(host);
    built = true;
  }

  // Ansicht: Andock-Modus (iPad ohne Vollbild) oder fest über der Seite (Desktop / Vollbild)
  const FIXED_CSS = 'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;' +
    'width:100%!important;height:100%!important;margin:0!important;padding:0!important;transform:none!important;' +
    'z-index:2147483647!important;display:block;';
  const DOCK_CSS = 'position:relative!important;display:block;width:100%!important;margin:0!important;padding:0!important;transform:none!important;';
  const isDock = () => !!wrap && wrap.classList.contains('dock');
  const isDocked = () => isDock() && Math.abs(reader.getBoundingClientRect().top) < 8;
  function applyView() {
    const dock = isOpen && isTouch && !fsEl();
    document.documentElement.classList.toggle('rr-dock', dock);
    wrap.classList.toggle('dock', dock);
    host.style.cssText = isOpen ? (dock ? DOCK_CSS : FIXED_CSS) : FIXED_CSS + 'display:none!important;';
    document.documentElement.style.overflow = isOpen && !dock ? 'hidden' : '';
  }

  function render(d) {
    root.querySelector('.titles b').textContent = d.chapTitle;
    root.querySelector('.titles span').textContent = d.ficTitle ? '  ·  ' + d.ficTitle : '';
    root.querySelector('[data-a="prevch"]').disabled = !d.prevUrl;
    root.querySelector('[data-a="nextch"]').disabled = !d.nextUrl;

    pages.textContent = '';
    pages.lang = document.documentElement.lang || 'en';
    const add = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; e.textContent = text; pages.appendChild(e); return e; };
    add('h1', 'ct', d.chapTitle);
    if (d.ficTitle) add('p', 'ft', d.ficTitle);
    add('p', 'orn', '❦');
    const addNote = n => {
      const box = document.createElement('aside'); box.className = 'note';
      box.innerHTML = '<div class="lbl">Anmerkung des Autors</div>';
      box.appendChild(n.cloneNode(true)); pages.appendChild(box);
    };
    d.before.forEach(addNote);
    const body = d.body.cloneNode(true); body.className = 'first'; pages.appendChild(body);
    const lead = [...body.querySelectorAll('p, .para')].find(p => !p.classList.contains('scene') && p.textContent.replace(/\u00a0/g, ' ').trim()
      && !/center/.test(p.getAttribute('style') || '') && !p.closest('table'));
    if (lead) lead.classList.add('lead');
    d.after.forEach(addNote);
    const end = add('div', 'end', '— Ende des Kapitels —');
    if (d.nextUrl) {
      end.appendChild(document.createElement('br'));
      const a = document.createElement('a'); a.href = d.nextUrl; a.textContent = 'Nächstes Kapitel ›';
      a.addEventListener('click', e => { e.preventDefault(); loadChapter(d.nextUrl, 'start'); });
      end.appendChild(a);
    }
    pages.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', () => layout(true)); });
  }

  // ---------- Layout & Blättern ----------
  function apply() {
    const keep = ['reader-spread', 'fs'].filter(c => reader.classList.contains(c)).join(' ');
    reader.className = 'reader theme-' + s.theme + ' ' + s.mode + (keep ? ' ' + keep : '');
    THEMES.forEach(th => wrap.classList.toggle('theme-' + th, th === s.theme));
    reader.style.setProperty('--font', FONTS[s.font % FONTS.length].css);
    reader.style.setProperty('--size', s.size + 'px');
    const compact = window.innerWidth <= 640;
    reader.classList.toggle('compact', compact);
    const btn = a => root.querySelector('[data-a="' + a + '"]');
    const L = compact ? { prevch: '‹', font: 'Aa', theme: '◐', nextch: '›' } : { prevch: '‹ Kap.', font: 'Schrift', theme: 'Farbe', nextch: 'Kap. ›' };
    Object.keys(L).forEach(k => { btn(k).textContent = L[k]; });
    btn('mode').textContent = compact ? (s.mode === 'paged' ? '↕' : '⇆') : (s.mode === 'paged' ? 'Scrollen' : 'Blättern');
    btn('spread').style.display = s.mode === 'paged' && !compact ? '' : 'none';
    btn('help').style.display = compact ? 'none' : '';
  }

  function layout(keep) {
    const ratio = keep ? (s.mode === 'paged' ? (pageCount > 1 ? page / (pageCount - 1) : 0)
      : (clip.scrollHeight > clip.clientHeight ? clip.scrollTop / (clip.scrollHeight - clip.clientHeight) : 0)) : 0;
    apply();
    if (s.mode === 'paged') {
      const cs = getComputedStyle(viewport);
      const vw = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const vh = viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const twoFit = vw >= s.size * 52;
      const cols = (s.spread === 'on' || (s.spread === 'auto' && twoFit)) && vw >= s.size * 30 ? 2 : 1;
      const gap = Math.round(s.size * (cols === 2 ? 3.6 : 2.4));
      let W = Math.min(vw, (cols === 2 ? 68 : 34) * s.size);
      W = Math.floor((W - gap * (cols - 1)) / cols) * cols + gap * (cols - 1);
      clip.style.width = W + 'px';
      clip.style.height = Math.floor(vh) + 'px';
      reader.style.setProperty('--cols', cols);
      reader.style.setProperty('--gap', gap + 'px');
      reader.style.setProperty('--h', Math.floor(vh) + 'px');
      reader.classList.toggle('reader-spread', cols === 2);
      step = W + gap;
      pageCount = Math.max(1, Math.ceil((clip.scrollWidth + gap) / step - 0.02));
      go(Math.round(ratio * (pageCount - 1)));
    } else {
      clip.style.width = ''; clip.style.height = '';
      clip.scrollTop = ratio * (clip.scrollHeight - clip.clientHeight);
      updateInfo();
    }
  }

  function go(p) {
    page = Math.max(0, Math.min(pageCount - 1, p));
    clip.scrollLeft = page * step;
    updateInfo();
  }

  function updateInfo() {
    let pct;
    if (s.mode === 'paged') {
      pct = pageCount > 1 ? page / (pageCount - 1) : 1;
      info.pi.textContent = `Seite ${page + 1} von ${pageCount}`;
      const left = pageCount - page - 1;
      info.pr.textContent = left ? `noch ${left} ${left === 1 ? 'Seite' : 'Seiten'}` : (cur.nextUrl ? 'weiter → nächstes Kapitel' : 'Ende');
    } else {
      const max = clip.scrollHeight - clip.clientHeight;
      pct = max > 0 ? clip.scrollTop / max : 1;
      info.pi.textContent = Math.round(pct * 100) + ' %';
      info.pr.textContent = pct >= 0.999 && cur.nextUrl ? 'weiter → nächstes Kapitel' : '';
    }
    info.bar.style.width = (pct * 100).toFixed(1) + '%';
    if (cur.nextUrl && pct > 0.6) fetchChapter(cur.nextUrl).catch(() => {}); // vorladen
  }

  const atBottom = () => clip.scrollTop + clip.clientHeight >= clip.scrollHeight - 2;
  function next() {
    if (s.mode === 'scroll') {
      if (atBottom()) loadChapter(cur.nextUrl, 'start');
      else clip.scrollBy({ top: clip.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    hideBars();
    if (page < pageCount - 1) go(page + 1); else loadChapter(cur.nextUrl, 'start');
  }
  function prev() {
    if (s.mode === 'scroll') {
      if (clip.scrollTop <= 0) loadChapter(cur.prevUrl, 'end');
      else clip.scrollBy({ top: -clip.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    hideBars();
    if (page > 0) go(page - 1); else loadChapter(cur.prevUrl, 'end');
  }

  // Kapitel nachladen, ohne die Seite neu zu laden (Vollbild bleibt erhalten)
  async function loadChapter(url, at) {
    if (!url || loading) return;
    loading = true;
    info.pr.textContent = 'lädt …';
    try {
      const html = await fetchChapter(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const d = extract(doc, false, url);
      if (!d) throw new Error('kein Kapiteltext');
      cur = d;
      try { history.pushState({ rrBook: 1 }, '', url); } catch (e) {}
      if (d.docTitle) document.title = d.docTitle;
      render(d);
      layout(false);
      if (at === 'end') { if (s.mode === 'paged') go(pageCount - 1); else { clip.scrollTop = clip.scrollHeight; updateInfo(); } }
      else { if (s.mode === 'scroll') clip.scrollTop = 0; go(0); }
      if (d.nextUrl) fetchChapter(d.nextUrl).catch(() => {});
    } catch (e) {
      flagSet(at); location.href = url; // Fallback: klassisch neu laden
    } finally {
      loading = false;
    }
  }

  function hideBars() { bar.classList.add('hidden'); bar2.classList.add('hidden'); root.querySelector('.help').classList.remove('show'); }
  function toggleBars() { bar.classList.toggle('hidden'); bar2.classList.toggle('hidden'); root.querySelector('.help').classList.remove('show'); }

  function act(a) {
    switch (a) {
      case 'close': close(); return;
      case 'prevch': loadChapter(cur.prevUrl, 'start'); return;
      case 'nextch': loadChapter(cur.nextUrl, 'start'); return;
      case 'fs':
        if (fsEl()) { s.view = 'dock'; exitFs(); } // fullscreenchange schaltet auf Andock-Modus um
        else { s.view = 'fs'; enterFs(); }
        save(); return;
      case 'bigger': s.size = Math.min(34, s.size + 1); break;
      case 'smaller': s.size = Math.max(13, s.size - 1); break;
      case 'font': s.font = (s.font + 1) % FONTS.length; break;
      case 'theme': s.theme = THEMES[(THEMES.indexOf(s.theme) + 1) % THEMES.length]; break;
      case 'mode': s.mode = s.mode === 'paged' ? 'scroll' : 'paged'; break;
      case 'spread': s.spread = s.spread === 'off' ? 'on' : (s.spread === 'on' ? 'auto' : 'off'); break;
      case 'help': root.querySelector('.help').classList.toggle('show'); return;
    }
    save(); layout(true);
  }

  function open(at) {
    if (!built) { build(); render(cur); }
    isOpen = true; s.open = true; save();
    applyView();
    if (isDock()) window.scrollTo(0, 0);
    const run = () => { layout(false); if (at === 'end' && s.mode === 'paged') go(pageCount - 1); syncCheck(true); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(run));
  }
  function close() {
    closing = true; exitFs();
    isOpen = false; s.open = false; save();
    applyView();
    setTimeout(() => (closing = false), 500);
    if (cur.url !== startUrl) location.reload(); // darunterliegende Seite auf das aktuelle Kapitel bringen
  }

  // ---------- Geräteübergreifend weiterlesen (über Royal Roads „Continue Reading“) ----------
  const chapId = u => (String(u || '').match(/\/chapter\/(\d+)/) || [])[1] || null;
  const ficBase = (location.pathname.match(/^\/fiction\/\d+/) || [])[0];
  let lastSync = 0, declined = null, toastT;
  function toast(msg, label, fn) {
    const el = root.querySelector('.toast'), b = el.querySelector('button');
    el.querySelector('span').textContent = msg;
    b.textContent = label; b.onclick = () => { el.classList.remove('show'); fn(); };
    el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 9000);
  }
  async function syncCheck(force) {
    if (!ficBase || !isOpen || loading) return;
    const now = Date.now(); if (!force && now - lastSync < 15000) return; lastSync = now;
    try {
      const r = await pageFetch(location.origin + ficBase, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) return;
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const a = [...doc.querySelectorAll('a')].find(el => /continue reading/i.test(el.textContent) && chapId(el.getAttribute('href')));
      if (!a) return;
      const target = new URL(a.getAttribute('href'), location.origin).href;
      const tId = chapId(target), cId = chapId(cur.url);
      if (!tId || !cId || tId === cId || tId === declined) return;
      // Reihenfolge aus dem Inhaltsverzeichnis, sonst nach Kapitelnummer
      const toc = [...doc.querySelectorAll('#chapters a[href*="/chapter/"]')];
      const src = toc.length ? toc : [...doc.querySelectorAll('a[href*="/chapter/"]')]
        .filter(x => x !== a && !/continue|start reading|first chapter|latest chapter/i.test(x.textContent));
      const order = [...new Set(src.map(x => chapId(x.getAttribute('href'))).filter(Boolean))];
      const ti = order.indexOf(tId), ci = order.indexOf(cId);
      const ahead = ti >= 0 && ci >= 0 ? ti > ci : +tId > +cId;
      if (!ahead || loading || !isOpen) return;
      const from = cur.url;
      await loadChapter(target, 'start');
      if (chapId(cur.url) === tId) {
        toast('Auf einem anderen Gerät weitergelesen – weiter mit „' + cur.chapTitle + '“.', 'Zurück',
          () => { declined = tId; loadChapter(from, 'start'); });
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncCheck(); });
  window.addEventListener('pageshow', () => syncCheck());
  window.addEventListener('focus', () => syncCheck());

  // ---------- Tastatur ----------
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = e.key;
    if (!isOpen) { if (k === 'b' || k === 'B') { e.preventDefault(); open(); } return; }
    const map = {
      ArrowRight: () => s.mode === 'paged' && next(), ArrowLeft: () => s.mode === 'paged' && prev(),
      PageDown: next, PageUp: prev, ' ': () => (e.shiftKey ? prev() : next()),
      ArrowDown: () => s.mode === 'scroll' ? clip.scrollBy(0, 60) : next(),
      ArrowUp: () => s.mode === 'scroll' ? clip.scrollBy(0, -60) : prev(),
      Home: () => s.mode === 'paged' ? go(0) : (clip.scrollTop = 0),
      End: () => s.mode === 'paged' ? go(pageCount - 1) : (clip.scrollTop = clip.scrollHeight),
      Escape: close, n: () => act('nextch'), p: () => act('prevch'), v: () => act('fs'),
      '+': () => act('bigger'), '=': () => act('bigger'), '-': () => act('smaller'),
      f: () => act('font'), t: () => act('theme'), m: () => act('mode'), d: () => act('spread'), '?': () => act('help'),
    };
    const fn = map[k] || map[k.toLowerCase()];
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
  }, true);

  // ---------- Startknopf auf der Seite ----------
  const fab = document.createElement('button');
  fab.textContent = '📖 Buchmodus';
  fab.title = 'Buchmodus öffnen (B)';
  Object.assign(fab.style, {
    position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483646, padding: '10px 14px',
    font: '600 14px system-ui, sans-serif', color: '#3b2f22', background: '#f4ecd8',
    border: '1px solid #d8c8a4', borderRadius: '999px', boxShadow: '0 4px 14px rgba(0,0,0,.25)', cursor: 'pointer',
  });
  fab.addEventListener('click', () => { open(); if (fsOK && s.view === 'fs') enterFs(); });
  document.body.appendChild(fab);

  const at = flagGet();
  if (at || s.open) open(at);
})();
