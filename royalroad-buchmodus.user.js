// ==UserScript==
// @name         Royal Road Buchmodus
// @namespace    rr-buchmodus
// @version      2.3
// @description  Liest Royal-Road-Kapitel wie ein Buch: umblättern, Doppelseite, Serifenschrift, Sepia/Dunkel, Bilder, nahtlos ins nächste Kapitel, Weiterlesen auf anderen Geräten.
// @match        https://www.royalroad.com/fiction/*/chapter/*
// @match        https://royalroad.com/fiction/*/chapter/*
// @homepageURL  https://github.com/Intertwined4/Royal-Road-als-Buch
// @updateURL    https://raw.githubusercontent.com/Intertwined4/Royal-Road-als-Buch/main/royalroad-buchmodus.user.js
// @downloadURL  https://raw.githubusercontent.com/Intertwined4/Royal-Road-als-Buch/main/royalroad-buchmodus.user.js
// @grant        none
// @inject-into  auto
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ===== Tastaturschutz =====================================================
  // Läuft schon beim Seitenstart, also vor Royal Roads eigenen Tastenbefehlen (Pfeiltasten = Kapitel
  // wechseln). Solange der Buchmodus offen ist, werden seine Tasten beim Drücken UND Loslassen geschluckt.
  let keyHandler = null;
  const guard = e => { if (keyHandler && keyHandler(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  ['keydown', 'keyup', 'keypress'].forEach(t => window.addEventListener(t, guard, true));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(main, 0), { once: true });
  else main();

  function main() {

    // ===== Einstellungen =====================================================
    const STORE = 'rrBook.settings', FLAG = 'rrBook.openAt';
    const FONTS = ['"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif',
      'Georgia,"Times New Roman",serif', 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'];
    const THEMES = ['sepia', 'light', 'dark'];
    const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(navigator.userAgent));
    const fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    const defaults = { open: false, mode: 'paged', theme: 'sepia', font: 0, spread: 'auto', view: 'dock', // view: 'dock' | 'fs'
      size: Math.min(screen.width, screen.height) < 640 ? 18 : 20 };
    const tryDo = (f, fb) => { try { return f(); } catch (e) { return fb; } };
    let s = Object.assign({}, defaults, tryDo(() => JSON.parse(localStorage.getItem(STORE) || '{}'), {}));
    const save = () => tryDo(() => localStorage.setItem(STORE, JSON.stringify(s)));
    // Merkt sich über ein Neuladen hinweg, ob am Anfang oder Ende eines Kapitels geöffnet werden soll
    const flag = v => tryDo(() => v ? sessionStorage.setItem(FLAG, v)
      : (v = sessionStorage.getItem(FLAG), sessionStorage.removeItem(FLAG), v), null);

    const txt = el => (el ? el.textContent : '').replace(/ /g, ' ').trim();
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

    // ===== Kapitel aus einer Seite auslesen ==================================
    // CSS-Regeln, mit denen Royal Road Text versteckt (Kopierschutz-Sätze)
    const hiddenSelectors = doc => [...doc.querySelectorAll('style')].flatMap(st =>
      [...st.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(m => /display\s*:\s*none|speak\s*:\s*never|visibility\s*:\s*hidden/i.test(m[2])).map(m => m[1].trim()));

    const STRIP = ['font-family', 'font-size', 'line-height', 'color', 'background', 'background-color', 'width', 'max-width',
      'min-width', 'height', 'min-height', 'border-color', 'white-space', 'text-indent', 'margin', 'margin-top', 'margin-bottom',
      'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right'];
    const scene = () => make('p', 'scene', '⁂');

    // Kopie eines Textblocks: ohne Verstecktes und Fremdformatierung, Absätze wie im Buch
    function cleanClone(el, live, hideSels, base) {
      const hasPic = n => /^(IMG|PICTURE)$/.test(n.nodeName) || !!n.querySelector('img, picture');
      if (live) el.querySelectorAll('*').forEach(n => {
        const cs = getComputedStyle(n);
        if ((cs.display === 'none' || cs.visibility === 'hidden') && !hasPic(n)) n.setAttribute('data-rr-hide', '');
      });
      const c = el.cloneNode(true);
      if (live) el.querySelectorAll('[data-rr-hide]').forEach(n => n.removeAttribute('data-rr-hide'));
      hideSels.forEach(sel => tryDo(() => c.querySelectorAll(sel).forEach(n => { if (!hasPic(n)) n.remove(); })));
      c.querySelectorAll('[data-rr-hide], script, style, iframe, ins, noscript, button, link').forEach(n => n.remove());

      // Bilder: spät ladende Bilder auflösen, Adressen absolut machen, sofort laden
      c.querySelectorAll('img').forEach(img => {
        const lazy = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-lazy'].map(a => img.getAttribute(a)).find(Boolean);
        const src = img.getAttribute('src') || '';
        if (lazy && (!src || /^data:|placeholder|blank|spacer|lazy|pixel/i.test(src))) img.setAttribute('src', lazy);
        const lss = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
        if (lss) img.setAttribute('srcset', lss);
        tryDo(() => img.setAttribute('src', new URL(img.getAttribute('src'), base).href));
        img.setAttribute('loading', 'eager'); img.setAttribute('decoding', 'async');
        img.classList.remove('lazyload', 'lazyloading', 'lazy');
        ['opacity', 'visibility', 'display'].forEach(p => img.style.removeProperty(p));
      });
      c.querySelectorAll('source[data-srcset]').forEach(so => so.setAttribute('srcset', so.getAttribute('data-srcset')));

      // Schrift, Farben, Abstände und Einzüge des Autors entfernen – die setzt der Buchmodus selbst
      c.querySelectorAll('[style]').forEach(n => STRIP.forEach(p => n.style.removeProperty(p)));
      c.querySelectorAll('[width]').forEach(n => n.removeAttribute('width'));
      c.querySelectorAll('font').forEach(n => ['face', 'size', 'color'].forEach(a => n.removeAttribute(a)));

      // Blöcke, deren Absätze nur durch <br><br> getrennt sind, in echte Absätze zerlegen
      const isBr = n => n.nodeName === 'BR', isWs = n => n.nodeType === 3 && !txt(n);
      [c, ...c.querySelectorAll('p, div')].forEach(b => {
        if ((b !== c && !c.contains(b)) || b.querySelector('p, div, table, ul, ol, blockquote, h1, h2, h3, h4')) return;
        const kids = [...b.childNodes];
        const dbl = kids.some((k, i) => { if (!isBr(k)) return false; let j = i + 1; while (j < kids.length && isWs(kids[j])) j++; return j < kids.length && isBr(kids[j]); });
        if (!dbl) return;
        const frag = document.createDocumentFragment(), style = b.getAttribute('style');
        let p = null, brs = 0, pend = [];
        const flush = () => { if (p && (txt(p) || p.querySelector('img, picture, svg'))) frag.appendChild(p); p = null; };
        kids.forEach(k => {
          if (isBr(k)) { brs++; pend.push(k); return; }
          if (isWs(k)) { pend.push(k); return; }
          if (brs >= 2) { flush(); if (brs >= 3) frag.appendChild(scene()); } else if (p) p.append(...pend);
          brs = 0; pend = [];
          if (!p) { p = make('p'); if (style) p.setAttribute('style', style); }
          p.appendChild(k);
        });
        flush();
        if (b === c) c.replaceChildren(frag); else b.replaceWith(frag);
      });

      // Leerzeilen entfernen; mehrere hintereinander = Szenenwechsel
      const blank = el => /^(P|DIV)$/.test(el.nodeName) && !txt(el) && !el.querySelector('img, picture, table, hr, iframe, svg');
      [c, ...c.querySelectorAll('div, blockquote')].forEach(box => {
        if (box !== c && !c.contains(box)) return;
        let run = [];
        const end = () => { if (run.length >= 2) run.shift().replaceWith(scene()); run.forEach(x => x.remove()); run = []; };
        [...box.children].forEach(el => blank(el) ? run.push(el) : end());
        end();
      });

      // Szenentrenner aus Sternchen & Co. vereinheitlichen, Text-Divs wie Absätze behandeln
      c.querySelectorAll('p, div').forEach(p => {
        const t = txt(p);
        if (!p.querySelector('img, table, hr') && (/^([*~#•·◇◆✦=\-–—_]\s*){3,}$/.test(t) || /^[*~#◇◆✦⁂]$/.test(t))) { p.className = 'scene'; p.textContent = '⁂'; }
        else if (p.nodeName === 'DIV' && t && !p.querySelector('p, div, table, ul, ol, blockquote, img')) p.classList.add('para');
      });
      c.querySelectorAll('.scene + .scene').forEach(x => x.remove());
      c.removeAttribute('class'); c.removeAttribute('id');
      return c;
    }

    function extract(doc, live, url) {
      const content = doc.querySelector('.chapter-inner.chapter-content, .chapter-content');
      if (!content) return null;
      const hs = hiddenSelectors(doc);
      const nav = word => {
        const a = [...doc.querySelectorAll('a')].find(el => txt(el).toLowerCase().includes(word) && el.getAttribute('href') &&
          !el.hasAttribute('disabled') && !el.classList.contains('disabled'));
        return a ? new URL(a.getAttribute('href'), url).href : null;
      };
      const notes = [...doc.querySelectorAll('.author-note-portlet')];
      const before = n => !!(n.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING);
      const note = n => cleanClone(n.querySelector('.author-note') || n, live, hs, url);
      return {
        url, docTitle: doc.title,
        chapTitle: txt(doc.querySelector('.fic-header h1')) || txt(doc.querySelector('h1')) || doc.title,
        ficTitle: txt(doc.querySelector('.fic-header h2')),
        nextUrl: nav('next chapter'), prevUrl: nav('previous chapter'),
        before: notes.filter(before).map(note), body: cleanClone(content, live, hs, url), after: notes.filter(n => !before(n)).map(note),
      };
    }

    const startUrl = location.href;
    let cur = extract(document, true, startUrl);
    if (!cur) return;

    // Kapitel im Hintergrund laden (in Firefox-Content-Scripts über den Seiten-Fetch)
    const pageFetch = typeof content === 'object' && content && typeof content.fetch === 'function' ? content.fetch.bind(content) : window.fetch.bind(window);
    const cache = new Map();
    const fetchChapter = url => {
      if (!cache.has(url)) {
        const p = pageFetch(url, { credentials: 'include' }).then(r => r.ok ? r.text() : Promise.reject(r.status));
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return cache.get(url);
    };

    // ===== Vollbild ==========================================================
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const call = (obj, ...names) => { const f = names.map(n => obj[n]).find(Boolean); if (f) tryDo(() => { const p = f.call(obj); if (p && p.catch) p.catch(() => {}); }); };
    const enterFs = () => { if (!fsEl()) call(host, 'requestFullscreen', 'webkitRequestFullscreen'); }; // der Leser selbst, nicht die Seite
    const exitFs = () => { if (fsEl()) call(document, 'exitFullscreen', 'webkitExitFullscreen'); };
    const ensureFs = () => { if (fsOK && s.view === 'fs' && isOpen && !fsEl()) enterFs(); };

    // ===== Oberfläche ========================================================
    const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .theme-sepia { --bg:#f4ecd8; --fg:#3b2f22; --muted:#8f7f66; --line:#e0d2b2; --accent:#8a5a1f; --btn:#ebe0c6; }
    .theme-light { --bg:#fbfaf7; --fg:#1f1e1c; --muted:#8a857a; --line:#e6e2d9; --accent:#7a5c2e; --btn:#f0ede6; }
    .theme-dark  { --bg:#191816; --fg:#d8d2c6; --muted:#7d776c; --line:#2f2d29; --accent:#c9a46a; --btn:#24221f; }
    .ui { font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .wrap { background: var(--bg); }
    .reader { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }

    /* Leisten */
    .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px; min-height: 44px; line-height: 1.2;
      color: var(--muted); border-bottom: 1px solid var(--line); transition: opacity .2s; }
    .bar.hidden, .foot.hidden { opacity: 0; pointer-events: none; }
    .reader.fs .bar { padding-left: 84px; } /* Platz für Safaris Vollbild-✕ */
    .titles { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .titles b { color: var(--fg); font-weight: 600; }
    .ctrls { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
    button, .end a { font: inherit; color: var(--fg); background: var(--btn); border: 1px solid var(--line); border-radius: 6px;
      padding: 5px 9px; cursor: pointer; text-decoration: none; }
    .ctrls button:hover, .end a:hover, .ctrls button.on { border-color: var(--accent); }
    .ctrls button.on { color: var(--accent); }
    .ctrls button:disabled { opacity: .35; cursor: default; }
    .foot { display: flex; align-items: center; gap: 14px; padding: 0 5vw max(14px, env(safe-area-inset-bottom)); color: var(--muted);
      font-size: 12px; line-height: 1; transition: opacity .2s; }
    .prog { flex: 1; height: 2px; background: var(--line); border-radius: 2px; overflow: hidden; }
    .prog i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .15s; }
    .help { position: absolute; right: 16px; top: 52px; display: none; background: var(--btn); border: 1px solid var(--line);
      border-radius: 8px; padding: 12px 16px; line-height: 1.7; color: var(--fg); }
    .help.show { display: block; }
    .help kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
    .toast { position: absolute; left: 50%; bottom: 54px; z-index: 5; display: flex; align-items: center; gap: 12px;
      max-width: min(560px, calc(100% - 32px)); padding: 10px 12px 10px 16px; background: var(--fg); color: var(--bg);
      border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.25); font-size: 14px;
      opacity: 0; pointer-events: none; transform: translate(-50%, 12px); transition: opacity .25s, transform .25s; }
    .toast.show { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
    .toast button { flex-shrink: 0; font-weight: 600; color: var(--fg); background: var(--bg); border: 0; border-radius: 8px; padding: 8px 12px; }
    .lb { position: absolute; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center;
      background: rgba(10,10,10,.94); cursor: zoom-out; padding: 16px; }
    .lb.show { display: flex; }
    .lb img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 3px; }

    /* Andock-Modus (Tablet/Handy): Rand oben, Buch rastet darunter ein */
    .spacer { display: none; }
    .wrap.dock .spacer { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 14px;
      height: 160px; padding-bottom: 18px; color: var(--muted); border-bottom: 1px dashed var(--line); }
    .spacer button { border-radius: 999px; padding: 6px 14px; }
    .sp-hint { font-size: 14px; }
    .sp-hint b { display: block; text-align: center; font-size: 20px; line-height: 1; margin-top: 4px; animation: nudge 1.6s ease-in-out infinite; }
    @keyframes nudge { 50% { transform: translateY(5px); } }
    .wrap.dock .reader { position: relative; height: 100vh; height: 100lvh; transition: transform .25s ease; }
    .wrap.dock .reader.dragging { transition: none; }
    .pull { position: absolute; left: 0; right: 0; top: -54px; height: 54px; display: flex; align-items: center; justify-content: center;
      color: var(--muted); pointer-events: none; }
    .pull.ready { color: var(--accent); font-weight: 600; }

    /* Seiten */
    .viewport { flex: 1; min-height: 0; padding: 40px 5vw 28px; display: flex; justify-content: center; }
    .clip { height: 100%; width: 100%; }
    .paged .clip { overflow: hidden; }
    .paged .pages { height: 100%; column-fill: auto; column-count: var(--cols); column-gap: var(--gap); }
    .paged.reader-spread .pages { column-rule: 1px solid var(--line); }
    .scroll .viewport { padding: 0; }
    .scroll .clip { overflow-y: auto; }
    .scroll .pages { max-width: 34em; margin: 0 auto; padding: 3em 1.5em 6em; }

    /* Satz */
    .pages { font-family: var(--font); font-size: var(--size); line-height: 1.62; text-align: justify;
      hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; overflow-wrap: break-word; }
    .pages p, .pages div { margin: 0; }
    .pages p, .pages .para { text-indent: 1.4em; }
    .pages .scene + p, .pages .scene + .para, .pages .sub + p, .pages .sub + .para, .pages hr + p, .pages h1 + p, .pages h2 + p,
    .pages h3 + p, .pages table + p, .pages .lead, .pages [style*="center"], .pages [align="center"],
    .pages td p, .pages th p, .pages li p { text-indent: 0; }
    .pages h1.ct { font-size: 1.5em; font-weight: normal; text-align: center; line-height: 1.25; margin: 2.2em 0 .3em; letter-spacing: .02em; break-after: avoid; }
    .pages .ft { text-align: center; font-variant: small-caps; letter-spacing: .08em; color: var(--muted); font-size: .8em; margin: 0 0 2.4em; text-indent: 0; }
    .pages .orn { text-align: center; color: var(--muted); margin: -1.6em 0 2em; text-indent: 0; }
    .pages .sub { text-align: center; text-indent: 0 !important; margin: 0 0 1.2em; font-size: 1.05em; }
    .pages .lead::first-letter { float: left; font-size: 3.1em; line-height: .85; padding: .06em .08em 0 0; color: var(--accent); }
    .pages .scene, .pages hr { display: block; border: 0; text-align: center; color: var(--muted); text-indent: 0 !important; margin: .9em 0; letter-spacing: .3em; }
    .pages hr::after { content: "⁂"; }
    .pages h2, .pages h3, .pages h4 { font-size: 1.1em; text-align: center; margin: 1.2em 0 .6em; text-indent: 0; break-after: avoid; }
    .pages img { display: block; max-width: 100%; max-height: calc(var(--h) - 2.5em); width: auto; height: auto; object-fit: contain;
      margin: 1.2em auto; break-inside: avoid; border-radius: 3px; box-shadow: 0 2px 10px rgba(0,0,0,.12); cursor: zoom-in; }
    .pages p:has(> img:only-child), .pages p:has(> a:only-child > img) { text-indent: 0; text-align: center; }
    .scroll .pages img { max-height: 85vh; }
    .pages table { width: 100%; border-collapse: collapse; margin: 1em 0; font: .82em/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      text-align: left; break-inside: avoid; }
    .pages td, .pages th { border: 1px solid var(--line); padding: .35em .6em; vertical-align: top; }
    .pages blockquote { margin: 1em 1.5em; font-style: italic; }
    .pages ul, .pages ol { margin: .6em 0 .6em 1.5em; padding: 0; text-align: left; }
    .pages a { color: var(--accent); }
    .note { font: .78em/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted); text-align: left; hyphens: manual;
      border-block: 1px solid var(--line); padding: .8em 0; margin: 1.6em 0; break-inside: avoid; }
    .note p { text-indent: 0 !important; margin: .35em 0 !important; }
    .note .lbl { font-size: .85em; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .4em; }
    .end { text-align: center; color: var(--muted); margin: 2.5em 0 1em; text-indent: 0; break-inside: avoid; font: .8em system-ui, sans-serif; }
    .end a { display: inline-block; margin-top: 1em; }

    /* Handy: kompakte Leiste mit allen Knöpfen, schmalere Ränder */
    @media (max-width: 640px) {
      .bar { padding: 6px 8px; min-height: 0; }
      .reader.fs .bar { padding-left: 8px; }
      .titles, [data-a="help"], [data-a="spread"] { display: none !important; }
      .ctrls { width: 100%; flex-wrap: nowrap; justify-content: space-between; }
      .ctrls button { min-width: 34px; padding: 7px 0; font-size: 15px; text-align: center; }
      .viewport { padding: 26px 22px 14px; }
      .foot { padding: 0 22px max(10px, env(safe-area-inset-bottom)); gap: 10px; }
      .help { left: 8px; right: 8px; top: 48px; font-size: 12px; }
      .wrap.dock .spacer { height: 130px; }
      .pages h1.ct { margin-top: 1.4em; }
    }`;

    // Knöpfe: [Aktion, langer Text, kurzer Text (Handy), Tooltip]
    const BUTTONS = [['prevch', '‹ Kap.', '‹', 'Vorheriges Kapitel (P)'], ['smaller', 'A−', 'A−', 'Kleiner (−)'],
      ['bigger', 'A+', 'A+', 'Größer (+)'], ['font', 'Schrift', 'Aa', 'Schriftart (F)'], ['theme', 'Farbe', '◐', 'Farbe (T)'],
      ['mode', '', '', 'Blättern / Scrollen (M)'], ['spread', '▯▯', '▯▯', 'Doppelseite (D)'], ['fs', '⛶', '⛶', 'Vollbild (V)'],
      ['nextch', 'Kap. ›', '›', 'Nächstes Kapitel (N)'], ['help', '?', '?', 'Tastenkürzel'], ['close', '✕', '✕', 'Schließen (Esc)']];

    let host, root, $, btn, wrap, reader, bar, foot, viewport, clip, pages, pullEl;
    let page = 0, pageCount = 1, step = 1, isOpen = false, loading = false, closing = false;

    function build() {
      host = make('div'); host.id = 'rr-buchmodus';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="wrap ui">
          <div class="spacer"><button data-a="close">✕ Buchmodus beenden</button><div class="sp-hint">Zum Lesen nach unten scrollen<b>⌄</b></div></div>
          <div class="reader">
            <div class="pull"></div>
            <header class="bar"><div class="titles"><b></b><span></span></div><div class="ctrls">
              ${BUTTONS.map(([a, , , t]) => `<button data-a="${a}" title="${t}"></button>`).join('')}</div></header>
            <div class="help">
              <kbd>→</kbd> <kbd>Leertaste</kbd> weiterblättern &nbsp; <kbd>←</kbd> zurück<br>
              Tippen rechts / links oder wischen: blättern · Mitte: Leisten ein/aus<br>
              <kbd>N</kbd> / <kbd>P</kbd> nächstes / vorheriges Kapitel<br>
              <kbd>+</kbd> <kbd>−</kbd> Schriftgröße · <kbd>F</kbd> Schrift · <kbd>T</kbd> Farbe<br>
              Tablet/Handy: kräftig nach unten ziehen = zurück zum Rand oben<br>
              <kbd>M</kbd> Blättern/Scrollen · <kbd>D</kbd> Doppelseite · <kbd>V</kbd> Vollbild · <kbd>Esc</kbd> schließen<br>
              <kbd>B</kbd> auf der Kapitelseite: Buchmodus öffnen
            </div>
            <div class="viewport"><div class="clip"><article class="pages"></article></div></div>
            <div class="lb"><img alt=""></div>
            <div class="toast" role="status"><span></span><button type="button"></button></div>
            <footer class="foot"><span class="pi">&nbsp;</span><div class="prog"><i></i></div><span class="pr">&nbsp;</span></footer>
          </div>
        </div>`;
      $ = sel => root.querySelector(sel);
      btn = a => bar.querySelector(`[data-a="${a}"]`);
      [wrap, reader, bar, foot, viewport, clip, pages, pullEl] = ['.wrap', '.reader', '.bar', '.foot', '.viewport', '.clip', '.pages', '.pull'].map($);
      if (!fsOK) btn('fs').style.display = 'none';

      root.addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) act(b.dataset.a); });
      const lb = $('.lb');
      lb.addEventListener('click', () => lb.classList.remove('show'));
      viewport.addEventListener('click', e => {
        ensureFs();
        const im = e.target.closest('img');
        if (im) { e.preventDefault(); lb.querySelector('img').src = im.currentSrc || im.src; lb.classList.add('show'); return; }
        if (e.target.closest('a, button, .note')) return;
        const r = viewport.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (s.mode === 'paged' && x < 0.3) prev(); else if (s.mode === 'paged' && x > 0.7) next(); else bars('toggle');
      });

      // Wischen = blättern; im Andock-Modus kräftig nach unten ziehen = zurück zum Rand
      const PULL = 130;
      let t0 = null;
      const resetPull = () => { reader.classList.remove('dragging'); reader.style.transform = ''; pullEl.classList.remove('ready'); };
      reader.addEventListener('touchstart', e => {
        const p = e.touches[0];
        t0 = { x: p.clientX, y: p.clientY, docked: isDocked(), clipTop: clip.scrollTop, inBar: e.composedPath().includes(bar) };
      }, { passive: true });
      reader.addEventListener('touchmove', e => {
        if (!t0 || !t0.docked) return; // nicht angedockt: Seite scrollt normal (zum Einrasten)
        const p = e.touches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y, vertical = Math.abs(dy) > Math.abs(dx);
        if (t0.inBar) { if (vertical) e.preventDefault(); return; }
        const innerTop = s.mode !== 'scroll' || clip.scrollTop <= 0;
        if (s.mode === 'paged' || (dy > 0 && innerTop)) e.preventDefault(); // Seite bleibt stehen, Browserleiste bleibt weg
        if (dy > 12 && vertical && innerTop && t0.clipTop <= 0) {
          reader.classList.add('dragging');
          reader.style.transform = 'translateY(' + Math.round(Math.min(dy * 0.45, 80)) + 'px)';
          pullEl.classList.toggle('ready', dy > PULL);
          pullEl.textContent = dy > PULL ? '↑ Loslassen – zurück zum Rand' : 'Weiter ziehen, um den Buchmodus zu verlassen';
        }
      }, { passive: false });
      reader.addEventListener('touchend', e => {
        if (!t0) return;
        const p = e.changedTouches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y, st = t0, pulled = reader.classList.contains('dragging');
        t0 = null; resetPull();
        if (st.docked && pulled && dy > PULL) window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (!st.inBar && s.mode === 'paged' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { ensureFs(); dx < 0 ? next() : prev(); }
      }, { passive: true });
      reader.addEventListener('touchcancel', () => { t0 = null; resetPull(); }, { passive: true });

      let wheelLock = 0;
      viewport.addEventListener('wheel', e => {
        if (s.mode !== 'paged' || (isDock() && !isDocked())) return; // im Andock-Modus erst einrasten lassen
        e.preventDefault();
        const now = Date.now(); if (now - wheelLock < 350 || Math.abs(e.deltaY) < 8) return;
        wheelLock = now; e.deltaY > 0 ? next() : prev();
      }, { passive: false });
      clip.addEventListener('scroll', () => { if (s.mode === 'scroll') updateInfo(); }, { passive: true });
      let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => isOpen && layout(true), 150); });

      const onFs = () => {
        if (!fsEl() && !closing && isOpen) { s.view = 'dock'; save(); } // selbst verlassen: nicht wieder erzwingen
        applyView();
        if (isOpen && isDock()) window.scrollTo(0, 0);
        btn('fs').classList.toggle('on', !!fsEl());
        reader.classList.toggle('fs', !!fsEl() && isTouch);
        if (isOpen) setTimeout(() => layout(true), 250);
      };
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
      window.addEventListener('popstate', () => location.reload());

      // Einrasten nach Richtung: leicht nach unten → Buch, nach oben → Rand
      let lastY = 0, dir = 1, snapT;
      window.addEventListener('scroll', () => {
        if (!isOpen || !isDock()) return;
        const y = window.scrollY; if (y !== lastY) dir = y > lastY ? 1 : -1; lastY = y;
        clearTimeout(snapT);
        snapT = setTimeout(() => {
          const top = Math.round(reader.getBoundingClientRect().top + window.scrollY), y2 = window.scrollY;
          if (Math.abs(y2 - top) > 2 && y2 > 2) window.scrollTo({ top: y2 > top || dir > 0 ? top : 0, behavior: 'smooth' });
        }, 140);
      }, { passive: true });

      const st = make('style');
      st.textContent = `html.rr-dock { overflow-y: auto !important; overflow-x: hidden !important; height: auto !important; }
        html.rr-dock body { margin: 0 !important; padding: 0 !important; overflow: visible !important; height: auto !important; min-height: 0 !important; transform: none !important; }
        html.rr-dock body > *:not(#rr-buchmodus) { display: none !important; }`;
      document.head.appendChild(st);
      document.body.appendChild(host);
    }

    // Ansicht: Andock-Modus (Tablet/Handy ohne Vollbild) oder fest über der Seite (PC / Vollbild)
    const BASE_CSS = 'width:100%!important;margin:0!important;padding:0!important;transform:none!important;display:block;';
    const FIXED_CSS = BASE_CSS + 'position:fixed!important;inset:0!important;height:100%!important;z-index:2147483647!important;';
    const DOCK_CSS = BASE_CSS + 'position:relative!important;';
    const isDock = () => !!wrap && wrap.classList.contains('dock');
    const isDocked = () => isDock() && Math.abs(reader.getBoundingClientRect().top) < 8;
    function applyView() {
      const dock = isOpen && isTouch && !fsEl();
      document.documentElement.classList.toggle('rr-dock', dock);
      wrap.classList.toggle('dock', dock);
      host.style.cssText = !isOpen ? FIXED_CSS + 'display:none!important;' : dock ? DOCK_CSS : FIXED_CSS;
      document.documentElement.style.overflow = isOpen && !dock ? 'hidden' : '';
    }

    function render(d) {
      $('.titles b').textContent = d.chapTitle;
      $('.titles span').textContent = d.ficTitle ? '  ·  ' + d.ficTitle : '';
      btn('prevch').disabled = !d.prevUrl;
      btn('nextch').disabled = !d.nextUrl;
      const note = n => { const box = make('aside', 'note'); box.append(make('div', 'lbl', 'Anmerkung des Autors'), n.cloneNode(true)); return box; };
      const body = d.body.cloneNode(true); body.className = 'first';
      pages.lang = document.documentElement.lang || 'en';
      pages.replaceChildren(make('h1', 'ct', d.chapTitle), ...(d.ficTitle ? [make('p', 'ft', d.ficTitle)] : []), make('p', 'orn', '❦'),
        ...d.before.map(note), body, ...d.after.map(note));

      // Fette Zwischentitel am Anfang zentrieren (oder weglassen, wenn sie nur den Kapiteltitel wiederholen);
      // der große Anfangsbuchstabe kommt erst beim ersten richtigen Textabsatz
      const norm = x => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const headLike = p => { const t = txt(p); return t.length <= 140 && /[\p{L}\p{N}]/u.test(t) && !!p.querySelector('strong, b, u, h1, h2, h3, h4') &&
        norm([...p.querySelectorAll('strong, b, u, h1, h2, h3, h4')].map(txt).join('')) === norm(t); };
      for (const p of body.querySelectorAll('p, .para')) {
        if (p.classList.contains('scene') || p.closest('table') || !txt(p)) continue;
        if (headLike(p)) { if (norm(txt(p)) === norm(d.chapTitle)) p.remove(); else p.classList.add('sub'); continue; }
        if (!/center/.test(p.getAttribute('style') || '')) { p.classList.add('lead'); break; }
      }

      const end = pages.appendChild(make('div', 'end', '— Ende des Kapitels —'));
      if (d.nextUrl) {
        const a = make('a', '', 'Nächstes Kapitel ›'); a.href = d.nextUrl;
        a.addEventListener('click', e => { e.preventDefault(); loadChapter(d.nextUrl, 'start'); });
        end.append(make('br'), a);
      }
      pages.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', () => layout(true)); });
    }

    // ===== Layout & Blättern =================================================
    function apply() {
      const keep = ['reader-spread', 'fs'].filter(c => reader.classList.contains(c));
      reader.className = ['reader', 'theme-' + s.theme, s.mode, ...keep].join(' ');
      THEMES.forEach(t => wrap.classList.toggle('theme-' + t, t === s.theme));
      reader.style.setProperty('--font', FONTS[s.font % FONTS.length]);
      reader.style.setProperty('--size', s.size + 'px');
      const short = window.innerWidth <= 640;
      BUTTONS.forEach(([a, long, sh]) => { if (long) btn(a).textContent = short ? sh : long; });
      btn('mode').textContent = s.mode === 'paged' ? (short ? '↕' : 'Scrollen') : (short ? '⇆' : 'Blättern');
      btn('spread').style.display = s.mode === 'paged' ? '' : 'none';
    }

    function layout(keep) {
      const ratio = !keep ? 0 : s.mode === 'paged' ? (pageCount > 1 ? page / (pageCount - 1) : 0)
        : (clip.scrollHeight > clip.clientHeight ? clip.scrollTop / (clip.scrollHeight - clip.clientHeight) : 0);
      apply();
      pages.style.transform = ''; clip.scrollLeft = 0; // vor dem Messen zurücksetzen
      if (s.mode !== 'paged') {
        clip.style.width = clip.style.height = '';
        clip.scrollTop = ratio * (clip.scrollHeight - clip.clientHeight);
        return updateInfo();
      }
      const cs = getComputedStyle(viewport);
      const vw = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const vh = Math.floor(viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
      const cols = (s.spread === 'on' || (s.spread === 'auto' && vw >= s.size * 52)) && vw >= s.size * 30 ? 2 : 1;
      const gap = Math.round(s.size * (cols === 2 ? 3.6 : 2.4));
      let W = Math.min(vw, (cols === 2 ? 68 : 34) * s.size);
      W = Math.floor((W - gap * (cols - 1)) / cols) * cols + gap * (cols - 1); // ganzzahlige Spaltenbreite, sonst verrutschen Seiten
      clip.style.width = W + 'px'; clip.style.height = vh + 'px';
      reader.style.setProperty('--cols', cols);
      reader.style.setProperty('--gap', gap + 'px');
      reader.style.setProperty('--h', vh + 'px');
      reader.classList.toggle('reader-spread', cols === 2);
      step = W + gap;
      pageCount = Math.max(1, Math.ceil((clip.scrollWidth + gap) / step - 0.02));
      go(Math.round(ratio * (pageCount - 1)));
    }

    // Blättern per Verschieben statt Scrollen: Scrollen bleibt hängen, wenn die letzte
    // Doppelseite nur eine Spalte hat, und zeigt dann die vorige Seite doppelt
    function go(p) {
      page = Math.max(0, Math.min(pageCount - 1, p));
      pages.style.transform = page ? 'translateX(' + (-page * step) + 'px)' : '';
      updateInfo();
    }

    function updateInfo() {
      let pct, left = '';
      if (s.mode === 'paged') {
        pct = pageCount > 1 ? page / (pageCount - 1) : 1;
        const n = pageCount - page - 1;
        $('.pi').textContent = `Seite ${page + 1} von ${pageCount}`;
        left = n ? `noch ${n} ${n === 1 ? 'Seite' : 'Seiten'}` : cur.nextUrl ? 'weiter → nächstes Kapitel' : 'Ende';
      } else {
        const max = clip.scrollHeight - clip.clientHeight;
        pct = max > 0 ? clip.scrollTop / max : 1;
        $('.pi').textContent = Math.round(pct * 100) + ' %';
        if (pct >= 0.999 && cur.nextUrl) left = 'weiter → nächstes Kapitel';
      }
      $('.pr').textContent = left || '\u00a0';
      $('.prog i').style.width = (pct * 100).toFixed(1) + '%';
      if (cur.nextUrl && pct > 0.6) fetchChapter(cur.nextUrl).catch(() => {}); // nächstes Kapitel vorladen
    }

    function turn(dirn) {
      const fwd = dirn > 0;
      if (s.mode === 'scroll') {
        const atEdge = fwd ? clip.scrollTop + clip.clientHeight >= clip.scrollHeight - 2 : clip.scrollTop <= 0;
        if (atEdge) loadChapter(fwd ? cur.nextUrl : cur.prevUrl, fwd ? 'start' : 'end');
        else clip.scrollBy({ top: dirn * clip.clientHeight * 0.9, behavior: 'smooth' });
        return;
      }
      bars('hide');
      const target = page + dirn;
      if (target >= 0 && target < pageCount) go(target); else loadChapter(fwd ? cur.nextUrl : cur.prevUrl, fwd ? 'start' : 'end');
    }
    const next = () => turn(1), prev = () => turn(-1);

    // Kapitel nachladen, ohne die Seite neu zu laden (Vollbild und Andock-Position bleiben)
    async function loadChapter(url, at) {
      if (!url || loading) return;
      loading = true;
      $('.pr').textContent = 'lädt …';
      try {
        const d = extract(new DOMParser().parseFromString(await fetchChapter(url), 'text/html'), false, url);
        if (!d) throw new Error('kein Kapiteltext');
        cur = d;
        tryDo(() => history.pushState({ rrBook: 1 }, '', url));
        if (d.docTitle) document.title = d.docTitle;
        render(d);
        layout(false);
        if (s.mode === 'scroll') { clip.scrollTop = at === 'end' ? clip.scrollHeight : 0; updateInfo(); }
        else go(at === 'end' ? pageCount - 1 : 0);
        if (d.nextUrl) fetchChapter(d.nextUrl).catch(() => {});
      } catch (e) {
        flag(at); location.href = url; // Notlösung: klassisch neu laden
      } finally {
        loading = false;
      }
    }

    function bars(how) {
      const hide = how === 'hide' || (how === 'toggle' && !bar.classList.contains('hidden'));
      bar.classList.toggle('hidden', hide); foot.classList.toggle('hidden', hide);
      $('.help').classList.remove('show');
    }

    function act(a) {
      const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length];
      switch (a) {
        case 'close': return close();
        case 'prevch': return loadChapter(cur.prevUrl, 'start');
        case 'nextch': return loadChapter(cur.nextUrl, 'start');
        case 'help': return $('.help').classList.toggle('show');
        case 'fs': s.view = fsEl() ? 'dock' : 'fs'; fsEl() ? exitFs() : enterFs(); return save();
        case 'bigger': s.size = Math.min(34, s.size + 1); break;
        case 'smaller': s.size = Math.max(13, s.size - 1); break;
        case 'font': s.font = (s.font + 1) % FONTS.length; break;
        case 'theme': s.theme = cycle(THEMES, s.theme); break;
        case 'mode': s.mode = cycle(['paged', 'scroll'], s.mode); break;
        case 'spread': s.spread = cycle(['auto', 'off', 'on'], s.spread); break;
      }
      save(); layout(true);
    }

    function open(at) {
      if (!host) { build(); render(cur); }
      isOpen = s.open = true; save();
      applyView();
      if (isDock()) window.scrollTo(0, 0);
      (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => {
        layout(false); if (at === 'end' && s.mode === 'paged') go(pageCount - 1); syncCheck(true);
      }));
    }
    function close() {
      closing = true; exitFs(); setTimeout(() => (closing = false), 500);
      isOpen = s.open = false; save();
      applyView();
      if (cur.url !== startUrl) location.reload(); // darunterliegende Seite auf das aktuelle Kapitel bringen
    }

    // ===== Weiterlesen auf anderen Geräten (über Royal Roads „Continue Reading“) =====
    const chapId = u => (String(u || '').match(/\/chapter\/(\d+)/) || [])[1] || null;
    const ficBase = (location.pathname.match(/^\/fiction\/\d+/) || [])[0];
    let lastSync = 0, declined = null, toastT;
    function toast(msg, label, fn) {
      const el = $('.toast'), b = el.querySelector('button');
      el.querySelector('span').textContent = msg;
      b.textContent = label; b.onclick = () => { el.classList.remove('show'); fn(); };
      el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 9000);
    }
    async function syncCheck(force) {
      if (!ficBase || !isOpen || loading || (!force && Date.now() - lastSync < 15000)) return;
      lastSync = Date.now();
      try {
        const r = await pageFetch(location.origin + ficBase, { credentials: 'include', cache: 'no-store' });
        if (!r.ok) return;
        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        const a = [...doc.querySelectorAll('a')].find(el => /continue reading/i.test(el.textContent) && chapId(el.getAttribute('href')));
        if (!a) return;
        const target = new URL(a.getAttribute('href'), location.origin).href, tId = chapId(target), cId = chapId(cur.url);
        if (!tId || !cId || tId === cId || tId === declined) return;
        // Reihenfolge aus dem Inhaltsverzeichnis, sonst nach Kapitelnummer
        const toc = [...doc.querySelectorAll('#chapters a[href*="/chapter/"]')];
        const links = toc.length ? toc : [...doc.querySelectorAll('a[href*="/chapter/"]')]
          .filter(x => x !== a && !/continue|start reading|first chapter|latest chapter/i.test(x.textContent));
        const order = [...new Set(links.map(x => chapId(x.getAttribute('href'))).filter(Boolean))];
        const ti = order.indexOf(tId), ci = order.indexOf(cId);
        if (!(ti >= 0 && ci >= 0 ? ti > ci : +tId > +cId) || loading || !isOpen) return;
        const from = cur.url;
        await loadChapter(target, 'start');
        if (chapId(cur.url) === tId) toast('Auf einem anderen Gerät weitergelesen – weiter mit „' + cur.chapTitle + '“.', 'Zurück',
          () => { declined = tId; loadChapter(from, 'start'); });
      } catch (e) {}
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncCheck(); });
    window.addEventListener('pageshow', () => syncCheck());
    window.addEventListener('focus', () => syncCheck());

    // ===== Tastatur ==========================================================
    const lastKey = {};
    const KEYS = { n: 'nextch', p: 'prevch', v: 'fs', '+': 'bigger', '=': 'bigger', '-': 'smaller', f: 'font', t: 'theme', m: 'mode', d: 'spread', '?': 'help' };
    // Gibt true zurück, wenn die Taste dem Buchmodus gehört; ausgeführt wird nur beim Drücken
    keyHandler = e => {
      const t = e.target, k = e.key || '', down = e.type === 'keydown';
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return false;
      if (!isOpen) { if (k.toLowerCase() !== 'b') return false; if (down) open(); return true; }
      const lb = $('.lb.show');
      if (lb) { if (!['Escape', ' ', 'Enter'].includes(k)) return false; if (down) lb.classList.remove('show'); return true; }
      const paged = s.mode === 'paged';
      const map = {
        ArrowRight: () => paged && next(), ArrowLeft: () => paged && prev(), PageDown: next, PageUp: prev,
        ' ': () => e.shiftKey ? prev() : next(), Escape: close,
        ArrowDown: () => paged ? next() : clip.scrollBy(0, 60), ArrowUp: () => paged ? prev() : clip.scrollBy(0, -60),
        Home: () => paged ? go(0) : (clip.scrollTop = 0), End: () => paged ? go(pageCount - 1) : (clip.scrollTop = clip.scrollHeight),
      };
      const fn = map[k] || (KEYS[k.toLowerCase()] && (() => act(KEYS[k.toLowerCase()])));
      if (!fn) return false;
      // Gedrückt gehaltene Tasten nicht wiederholen und sehr schnelle Doppelanschläge derselben Taste (z. B. Rapid
      // Trigger bei Hall-Effekt-Tastaturen) nur einmal zählen – sonst blättert ein Druck mehrere Seiten weiter
      if (down && !e.repeat && !(e.timeStamp - (lastKey[k] ?? -1e9) < 150)) { lastKey[k] = e.timeStamp; fn(); }
      return true;
    };

    // ===== Startknopf auf der Kapitelseite ===================================
    const fab = make('button', '', '📖 Buchmodus');
    fab.title = 'Buchmodus öffnen (B)';
    fab.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;padding:10px 14px;font:600 14px system-ui,sans-serif;' +
      'color:#3b2f22;background:#f4ecd8;border:1px solid #d8c8a4;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;';
    fab.addEventListener('click', () => { open(); if (fsOK && s.view === 'fs') enterFs(); });
    document.body.appendChild(fab);

    const at = flag();
    if (at || s.open) open(at);
  }
})();
