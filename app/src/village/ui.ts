// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Pop-ups (Brunnen, Impressum …) und Werkstatt.
// Bewusst ohne Framework, damit das Skizzendorf schlank bleibt.

// Platzhalter – vor dem Livegang ersetzen
const CONTACT_MAIL = 'kontakt@beispiel.de';
const TOOL_URL = '/'; // Janoschs Canvas (index.html); später Werkzeug je Haus per ?tool=…

export const CLAIM = 'Gestalten statt würfeln.';
export const SUBLINE = 'Prompten ist schnell. Zeichnen ist genau. SketchToCAD verbindet beides – direkt in 3D.';
/** Design-Varianten für den Claim im Intro, umschaltbar per ?claim=titel|hand|unten */
export type ClaimVariant = 'titel' | 'hand' | 'unten';

export type QuestKey = 'look' | 'walk' | 'well' | 'house';

export interface VillageUI {
  setMode(mode: 'intro' | 'village'): void;
  /** Claim im Intro ein-/ausblenden */
  introClaim(on: boolean): void;
  /** Banner nach der Landung (Claim + Button) */
  showHero(): void;
  /** Ankunfts-Quest einblenden / Aufgabe abhaken */
  showQuest(): void;
  questDone(key: QuestKey): void;
  showHover(label: string | null, x?: number, y?: number): void;
  openWell(): void;
  openTool(house: string): void;
  isOpen(): boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Handschrift unperfekt machen: Die Schrift (SketchHand) wechselt selbst die Buchstabenformen.
 *  Hier kommt nur noch Wort-für-Wort Variation dazu: Grundlinie, Neigung, Druck (Stärke), Tintenmenge.
 *  Buchstaben bleiben zusammen in einem Textknoten, damit die Kontext-Alternativen der Schrift greifen. */
function scribble(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.hw').forEach((node) => {
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const word of (n.textContent ?? '').split(/(\s+)/)) {
          if (!word) continue;
          if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(word)); continue; }
          const w = document.createElement('span');
          w.className = 'hw-w';
          w.textContent = word;
          w.style.transform = `translateY(${((Math.random() - 0.5) * 2.4).toFixed(2)}px) rotate(${((Math.random() - 0.5) * 2.2).toFixed(2)}deg)`;
          w.style.letterSpacing = `${((Math.random() - 0.5) * 0.03).toFixed(3)}em`;
          w.style.opacity = (0.84 + Math.random() * 0.16).toFixed(2);
          if (Math.random() < 0.18) w.style.fontWeight = '600';
          frag.appendChild(w);
        }
        n.parentNode!.replaceChild(frag, n);
      } else if (n.nodeType === 1 && !(n as HTMLElement).classList.contains('hw-w')) [...n.childNodes].forEach(walk);
    };
    [...node.childNodes].forEach(walk);
  });
}

/** Gerissene, leicht ausgefranste Papierkante als clip-path (px), mit zwei Eselsohr-Ecken und einem Einriss */
function tornClip(w: number, h: number, ear = 56, earBL = 38, notch = true) {
  const pts: string[] = [];
  const P = (x: number, y: number) => pts.push(`${x.toFixed(1)}px ${y.toFixed(1)}px`);
  const j = (a: number) => Math.random() * a;
  for (let x = 0; x < w - ear; x += 6) P(x, j(1.2));
  P(w - ear, j(1)); P(w, ear);
  const ny = h * (0.4 + Math.random() * 0.2);
  for (let y = ear; y < h; y += 6) {
    if (notch && y >= ny && y < ny + 6) { P(w - 2, y); P(w - 13, y + 5); P(w - 3, y + 10); y += 6; continue; }
    P(w - j(2.6), y);
  }
  for (let x = w; x > earBL; x -= 5) P(x, h - j(3.6) - (Math.random() < 0.06 ? 3 : 0));
  P(earBL, h - j(1)); P(0, h - earBL);
  for (let y = h - earBL; y > 0; y -= 6) P(j(2), y);
  return `polygon(${pts.join(',')})`;
}

/** Zerknittertes Papier: Licht/Schatten aus einer Höhenkarte (Rauschen → Beleuchtung) */
const crumple = (seed: number) => `<svg class="pad-crumple" aria-hidden="true"><filter id="crumple${seed}" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.010 0.013" numOctaves="5" seed="${seed}"/>
  <feDiffuseLighting lighting-color="#fff" surfaceScale="2.8" diffuseConstant="1.05"><feDistantLight azimuth="235" elevation="50"/></feDiffuseLighting>
  <feComponentTransfer><feFuncR type="linear" slope="1.3" intercept="-0.5"/><feFuncG type="linear" slope="1.3" intercept="-0.5"/><feFuncB type="linear" slope="1.3" intercept="-0.5"/></feComponentTransfer>
</filter><rect width="100%" height="100%" filter="url(#crumple${seed})"/></svg>`;

/** Mit Rotstift umkreist / unterstrichen */
const CIRCLED = `<svg class="pad-circle" viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M30 20 C 70 4, 205 2, 270 15 C 302 23, 294 53, 248 61 C 178 71, 68 69, 24 56 C -2 47, 2 25, 42 13 C 76 5, 124 5, 158 8"/></svg>`;
const UNDERLINED = `<svg class="pad-under" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M3 9 C 40 3, 80 13, 122 7 S 200 4, 237 10"/></svg>`;

/** Spiralbindung als SVG: Lochung im Papier + Metallschlaufe mit Glanz */
function spiral(width: number) {
  const n = Math.max(8, Math.floor((width - 40) / 21));
  const gap = (width - 40) / n;
  let rings = '';
  const bent = 2 + Math.floor(Math.random() * (n - 4));
  for (let i = 0; i < n; i++) {
    const x = 20 + gap * (i + 0.5) + (Math.random() - 0.5) * 1.2;
    const rot = (Math.random() - 0.5) * 7 + (i === bent ? 16 : 0);
    rings += `<g transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} 31)"><ellipse cx="${x}" cy="31" rx="3.6" ry="3" fill="#1b1612"/>
      <path d="M${x - 2.4} 31 C ${x - 3.5} 14, ${x + 4} 3, ${x + 6} 9 S ${x + 3} 26, ${x + 1.5} 30" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="3.4" transform="translate(1.6 2.2)" filter="url(#ringShadow)"/>
      <path d="M${x - 2.4} 31 C ${x - 3.5} 14, ${x + 4} 3, ${x + 6} 9 S ${x + 3} 26, ${x + 1.5} 30" fill="none" stroke="url(#wire)" stroke-width="2.8" stroke-linecap="round"/></g>`;
  }
  return `<svg class="pad-spiral" viewBox="0 0 ${width} 40" width="${width}" height="40" aria-hidden="true">
    <defs><linearGradient id="wire" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d6d6f"/><stop offset=".35" stop-color="#f4f4f2"/><stop offset=".55" stop-color="#a9a9a8"/><stop offset="1" stop-color="#4c4c4e"/></linearGradient>
    <filter id="ringShadow"><feGaussianBlur stdDeviation="1.1"/></filter></defs>${rings}</svg>`;
}

/** Handgezeichnete Unterstreichung als SVG (wird beim Einblenden „gezogen“) */
/** Pipeline-Zeile: USD-Export und Zielprogramme (nur Namen, keine fremden Logos) */
const TOOLS = `<p class="vtools"><span class="vtools-usd">USD</span><span class="vtools-arrow">→</span><span>Houdini</span><span>Unreal</span><span>Blender</span></p>`;

const SWOOSH = `<svg class="swoosh" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 15 C 60 6, 120 20, 180 11 S 270 8, 296 13" pathLength="1"/></svg>`;

export function createUI(opts: { onJump: () => void; onReplayIntro: () => void; onWell?: () => void; onOpenChange?: (open: boolean) => void; claim?: ClaimVariant }): VillageUI {
  const variant: ClaimVariant = opts.claim ?? 'titel';

  // ---------- Claim im Intro (Titelkarte)
  const title = el('div', `vtitle vtitle-${variant}`);
  title.setAttribute('aria-live', 'polite');
  title.innerHTML = variant === 'hand'
    ? `<h1 class="vtitle-h"><span class="vtitle-reveal">${CLAIM}</span></h1><p class="vtitle-sub">${SUBLINE}</p>`
    : `<p class="vtitle-kicker">3D-Assets für Film &amp; Postproduktion</p><h1 class="vtitle-h">Gestalten statt <span class="accent">würfeln.${SWOOSH}</span></h1><p class="vtitle-sub">${SUBLINE}</p>${TOOLS}`;
  document.body.appendChild(title);

  // ---------- Banner nach der Landung: Claim + wichtigste Handlung
  const hero = el('section', 'vhero');
  hero.innerHTML = `
    <p class="vhero-kicker">Für Film, Post &amp; Art Departments</p>
    <h2 class="vhero-h">Gestalten statt <span class="accent">würfeln.${SWOOSH}</span></h2>
    <p class="vhero-sub">${SUBLINE}</p>
    <div class="vhero-actions">
      <button class="vcta" data-act="tool" data-house="Werkstatt">Jetzt 3D-Modell erstellen</button>
      <button class="vghost" data-act="well">So funktioniert’s</button>
    </div>
    <button class="vhero-x" data-act="hero-close" aria-label="Banner schließen">×</button>`;
  document.body.appendChild(hero);
  let heroShownAt = 0;
  const collapseHero = () => {
    if (!hero.classList.contains('on') || performance.now() - heroShownAt < 1500) return;
    hero.classList.remove('on');
    bar.classList.add('with-cta');
  };
  // ---------- Ankunfts-Quest (wie im Spiel): Aufgaben-Zettel + Steuerungshinweis
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const TASKS: [QuestKey, string, string][] = touch
    ? [['look', 'Umsehen', 'mit dem Finger wischen'], ['walk', 'Herumlaufen', 'Joystick links unten'],
       ['well', 'Brunnen antippen', 'so funktioniert’s'], ['house', 'Eine Werkstatt besuchen', 'ein Haus antippen']]
    : [['look', 'Umsehen', 'Maus gedrückt ziehen'], ['walk', 'Herumlaufen', 'W A S D oder Pfeiltasten'],
       ['well', 'Brunnen anklicken', 'so funktioniert’s'], ['house', 'Eine Werkstatt besuchen', 'ein Haus anklicken']];
  const quest = el('aside', 'vquest');
  quest.setAttribute('aria-label', 'Quest');
  quest.innerHTML = `
    <button class="vquest-tab" data-act="quest-toggle" aria-label="Quest ein-/ausklappen"><span>!</span> Quest</button>
    <div class="vquest-body">
      <p class="vquest-kicker">Quest</p>
      <h3 class="vquest-h">Willkommen im Skizzendorf</h3>
      <ul>${TASKS.map(([k, t, h]) => `<li data-q="${k}"><svg class="qbox" viewBox="0 0 24 24" aria-hidden="true"><path class="qframe" d="M4 5 C 9 3.5, 16 4.2, 20 4.6 C 20.5 10, 20 15, 19.6 20 C 14 20.4, 9 20.2, 4.4 19.6 C 3.8 14, 4 9, 4 5"/><path class="qtick" pathLength="1" d="M6 12 C 8 13.5, 9.5 15.5, 10.5 17.5 C 12.5 12, 16 7, 22 2.5"/></svg><span class="qt"><b>${t}</b><small>${h}</small></span></li>`).join('')}</ul>
      <p class="vquest-done">Quest erfüllt! Viel Spaß beim Gestalten.</p>
    </div>`;
  document.body.appendChild(quest);
  const keys = el('div', 'vkeys');
  keys.innerHTML = touch
    ? `<span class="vkeys-t">Joystick links unten: laufen · Wischen: umsehen</span>`
    : `<span class="vkeys-wasd"><kbd class="k-w">W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span class="vkeys-t">laufen</span>
       <span class="vkeys-mouse" aria-hidden="true"><i></i></span><span class="vkeys-t">ziehen: umsehen</span>
       <span class="vkeys-t vkeys-click">Häuser &amp; Brunnen anklicken</span>`;
  document.body.appendChild(keys);
  const doneSet = new Set<QuestKey>();
  let questShown = false;
  function questDone(k: QuestKey) {
    if (!questShown || doneSet.has(k)) return;
    doneSet.add(k);
    quest.querySelector(`[data-q="${k}"]`)?.classList.add('done');
    if (doneSet.has('walk') && doneSet.has('look')) keys.classList.remove('on');
    if (doneSet.size === TASKS.length) {
      quest.classList.add('complete');
      setTimeout(() => quest.classList.add('min'), 3500);
    }
  }

  // ---------- Leiste oben
  const bar = el('header', 'vbar');
  bar.innerHTML = `
    <button class="vbar-logo" data-act="well" aria-label="Zum Brunnen"><span class="vbar-word">Sketch<span>To</span>CAD</span><small>3D-Assets für Film · USD-Export</small></button>
    <nav class="vbar-nav">
      <button data-act="project">Projekt</button>
      <a href="mailto:${CONTACT_MAIL}">Kontakt</a>
      <button data-act="imprint">Impressum</button>
      <button data-act="privacy">Datenschutz</button>
      <button class="vbar-cta" data-act="tool" data-house="Werkstatt">3D-Modell erstellen</button>
    </nav>`;
  document.body.appendChild(bar);

  // ---------- Sprung-Button (wechselt die Rolle: Intro überspringen ↔ Zurück zum Brunnen)
  const jump = el('button', 'vjump');
  jump.type = 'button';
  jump.addEventListener('click', (e) => { e.stopPropagation(); opts.onJump(); });
  document.body.appendChild(jump);

  // ---------- Name beim Überfahren
  const tip = el('div', 'vtip');
  document.body.appendChild(tip);

  // ---------- SVG-Filter: Kugelschreiber (raue Kanten, ungleichmäßiger Farbauftrag)
  const defs = document.createElement('div');
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs.innerHTML = `<svg width="0" height="0"><filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.035 0.25" numOctaves="2" seed="9" result="flow"/>
      <feColorMatrix in="flow" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.45" result="mask"/>
      <feComposite in="rough" in2="mask" operator="in"/>
    </filter></svg>`;
  document.body.appendChild(defs);

  // ---------- Pop-up (Skizzen-Zettel)
  const veil = el('div', 'vveil');
  const card = el('div', 'vcard');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  veil.appendChild(card);
  document.body.appendChild(veil);

  // ---------- Werkstatt (Canvas im Overlay)
  const shop = el('div', 'vshop');
  shop.innerHTML = `
    <div class="vshop-head">
      <span class="vshop-title"></span>
      <button class="vbtn" data-act="close">← Zurück ins Dorf</button>
    </div>
    <iframe class="vshop-frame" title="Werkstatt"></iframe>`;
  document.body.appendChild(shop);
  const frame = shop.querySelector('iframe')!;

  let open: 'card' | 'shop' | null = null;
  const setOpen = (v: typeof open) => { open = v; opts.onOpenChange?.(!!v); };

  function showCard(html: string, pad = false) {
    card.classList.toggle('pad', pad);
    card.innerHTML = pad
      ? `<div class="pad-board" aria-hidden="true"></div><div class="pad-sheet s2" aria-hidden="true"></div><div class="pad-sheet s1" aria-hidden="true"></div>
         <div class="pad-paper"><div class="pad-ink">${html}</div>${crumple(1 + Math.floor(Math.random() * 90))}<div class="pad-light" aria-hidden="true"></div></div>
         <span class="ear ear-tr" aria-hidden="true"></span><span class="ear ear-bl" aria-hidden="true"></span>
         ${spiral(560)}<button class="vcard-x hw-x" data-act="close" aria-label="Schließen">×</button>`
      : `<button class="vcard-x" data-act="close" aria-label="Schließen">×</button>${html}`;
    if (pad) {
      scribble(card);
      requestAnimationFrame(() => fitPad());
    }
    veil.classList.add('on');
    setOpen('card');
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  }
  /** Risskanten an die echte Größe anpassen und den Block so skalieren, dass er ohne Scrollen ins Fenster passt */
  function fitPad() {
    if (!card.classList.contains('pad')) return;
    const paper = card.querySelector<HTMLElement>('.pad-paper');
    if (!paper) return;
    card.style.setProperty('--fit', '1');
    const w = paper.offsetWidth, h = paper.offsetHeight;
    paper.style.clipPath = tornClip(w, h);
    card.querySelectorAll<HTMLElement>('.pad-sheet').forEach((sh) => (sh.style.clipPath = tornClip(w, h, 0, 0, false)));
    const avail = innerHeight - (innerWidth < 600 ? 96 : 56), need = card.offsetHeight + 30;
    card.style.setProperty('--fit', String(Math.min(1, avail / need)));
  }
  addEventListener('resize', () => { if (open === 'card') fitPad(); });

  function closeAll() {
    veil.classList.remove('on');
    if (shop.classList.contains('on')) {
      shop.classList.remove('on');
      setTimeout(() => { if (!shop.classList.contains('on')) frame.src = 'about:blank'; }, 400);
    }
    setOpen(null);
  }

  const WELL = `
    <div class="pad-head hw">Notiz vom Brunnen</div>
    <h2 class="pad-h hw">Gestalten statt würfeln!</h2>
    <p class="hw">Prompten ist schnell. Zeichnen ist genau.<br>SketchToCAD verbindet beides – direkt in 3D.</p>
    <ol class="pad-list">
      <li class="hw"><b>Skizzieren</b> – wie auf Papier, nur unendlich groß.</li>
      <li class="hw"><b>Dazu sagen</b>, was die Skizze nicht zeigt: „Holz, alt, 10 cm länger“.</li>
      <li class="hw"><b>Teile anpassen</b> – einzeln und auf den Zentimeter.</li>
      <li class="hw"><b>Ab in die Szene</b> – als USD direkt in Houdini, Unreal oder Blender.</li>
    </ol>
    <div class="pad-links">
      <button class="pad-link main" data-act="tool" data-house="Werkstatt"><span class="hw">→ Jetzt 3D-Modell erstellen!</span>${CIRCLED}</button>
      <button class="pad-link minor" data-act="replay"><span class="hw">Intro nochmal ansehen</span>${UNDERLINED}</button>
    </div>
    <p class="pad-pencil hw">(Prototyp – unser Modell lernt noch)</p>`;

  const PROJECT = `
    <div class="pad-head hw">Notiz: Über uns</div>
    <h2 class="pad-h hw">Was ist SketchToCAD?</h2>
    <p class="hw">Prompten geht schnell, trifft aber selten genau das, was du im Kopf hast. Zeichnen ist genau, aber langsam bis zum fertigen 3D-Modell.</p>
    <p class="hw">Wir verbinden beides: Du skizzierst, sagst dazu, was du willst – und bekommst ein 3D-Modell, das du Teil für Teil weiterbearbeitest.</p>
    <p class="hw"><b>Für wen?</b> Filmproduktionen und Postproduktion, die Hinter- und Vordergründe bauen – gemeinsam mit dem Art Department.</p>
    <p class="hw"><b>Was kommt raus?</b> Saubere 3D-Elemente mit benannten Teilen und echten Maßen – als USD, bereit für Houdini, Unreal und Blender.</p>
    <div class="pad-links">
      <button class="pad-link main" data-act="well"><span class="hw">→ So funktioniert’s</span>${CIRCLED}</button>
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Schreib uns</span>${UNDERLINED}</a>
    </div>`;

  const IMPRINT = `
    <div class="pad-head hw">Notiz: Rechtliches</div>
    <h2 class="pad-h hw">Impressum</h2>
    <p class="hw"><b>Verantwortlich für Organisation:</b><br>Craig und Maik</p>
    <p class="pad-todo hw">Vor dem Livegang ergänzen: voller Name, Anschrift, E-Mail (§ 5 DDG)!</p>
    <div class="pad-links">
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Kontakt: ${CONTACT_MAIL}</span>${UNDERLINED}</a>
    </div>`;

  const PRIVACY = `
    <div class="pad-head hw">Notiz: Rechtliches</div>
    <h2 class="pad-h hw">Datenschutz</h2>
    <p class="hw">Diese Seite setzt keine Cookies, nutzt kein Tracking und speichert keine Formulardaten.</p>
    <p class="pad-todo hw">Vor dem Livegang: vollständige Datenschutzerklärung (Verantwortliche, Hosting, Server-Logs, deine Rechte)!</p>
    <div class="pad-links">
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Fragen? Schreib uns</span>${UNDERLINED}</a>
    </div>`;

  function openTool(house: string) {
    if (house !== 'Werkstatt') questDone('house');
    heroShownAt = 0; collapseHero();
    veil.classList.remove('on');
    (shop.querySelector('.vshop-title') as HTMLElement).textContent = `Werkstatt · ${house}`;
    const url = `${TOOL_URL}?from=village&house=${encodeURIComponent(house)}`;
    if (!frame.src.endsWith(url)) frame.src = url;
    shop.classList.add('on');
    setOpen('shop');
  }

  // Ein Klick-Handler für alles mit data-act
  document.body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) { if (e.target === veil) closeAll(); return; }
    const act = t.dataset.act;
    if (act === 'close') closeAll();
    else if (act === 'well') { opts.onWell?.(); questDone('well'); showCard(WELL, true); }
    else if (act === 'quest-toggle') quest.classList.toggle('min');
    else if (act === 'hero-close') { heroShownAt = 0; collapseHero(); }
    else if (act === 'project') showCard(PROJECT, true);
    else if (act === 'imprint') showCard(IMPRINT, true);
    else if (act === 'privacy') showCard(PRIVACY, true);
    else if (act === 'tool') openTool(t.dataset.house ?? 'Werkstatt');
    else if (act === 'replay') { closeAll(); opts.onReplayIntro(); }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAll(); } }, true);

  return {
    setMode(mode) {
      jump.textContent = mode === 'intro' ? 'Intro überspringen ›' : '⟲ Zurück zum Brunnen';
      jump.dataset.mode = mode;
      bar.classList.toggle('quiet', mode === 'intro');
    },
    showHover(label, x = 0, y = 0) {
      if (!label) { tip.classList.remove('on'); return; }
      tip.textContent = label;
      tip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
      tip.classList.add('on');
    },
    openWell: () => { questDone('well'); showCard(WELL, true); },
    showQuest() {
      if (questShown) return;
      questShown = true;
      quest.classList.add('on');
      keys.classList.add('on');
      setTimeout(() => keys.classList.remove('on'), 16000);
      if (touch || innerWidth < 760) setTimeout(() => { if (!quest.classList.contains('complete')) quest.classList.add('min'); }, 9000);
    },
    questDone,
    introClaim(on) { title.classList.toggle('on', on); },
    showHero() {
      bar.classList.add('with-cta');
      return;
      if (hero.dataset.shown) return;
      hero.dataset.shown = '1';
      heroShownAt = performance.now();
      hero.classList.add('on');
      // Sobald man losläuft oder sich umsieht, klappt das Banner ein – der Button wandert in die Leiste
      const off = () => collapseHero();
      addEventListener('keydown', (e) => { if (/^(w|a|s|d|arrow)/i.test(e.key)) off(); });
      document.getElementById('scene')?.addEventListener('pointerdown', off);
      setTimeout(off, 14000);
    },
    openTool,
    isOpen: () => !!open,
  };
}
