// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Pop-ups (Brunnen, Impressum …) und Werkstatt.
// Bewusst ohne Framework, damit das Skizzendorf schlank bleibt.

// Platzhalter – vor dem Livegang ersetzen
const CONTACT_MAIL = 'contact@example.com';
const TOOL_URL = '/';
// Museum: fertiges Projektvideo. Datei hier ablegen: app/public/museum/projekt.mp4 (optional Vorschaubild projekt.jpg)
const MUSEUM_VIDEO = '/museum/projekt.mp4';
const MUSEUM_POSTER = '/museum/projekt.jpg';
const MUSEUM_TITLE = 'Our first project';
const MUSEUM_NOTE = 'From a sketch via SketchToCAD to the finished scene.'; // Janoschs Canvas (index.html); später Werkzeug je Haus per ?tool=…

export const CLAIM = 'Design, don’t gamble.';
export const SUBLINE = 'Prompting is fast. Sketching is precise. SketchToCAD gives you both – straight to 3D.';
/** Design-Varianten für den Claim im Intro, umschaltbar per ?claim=titel|hand|unten */
export type ClaimVariant = 'titel' | 'hand' | 'unten';

export type QuestKey = 'look' | 'walk' | 'well' | 'house' | 'museum';

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
  openMuseum(): void;
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
    : `<p class="vtitle-kicker">3D assets for film &amp; post-production</p><h1 class="vtitle-h">Design, don’t <span class="accent">gamble.${SWOOSH}</span></h1><p class="vtitle-sub">${SUBLINE}</p>${TOOLS}`;
  document.body.appendChild(title);

  // ---------- Banner nach der Landung: Claim + wichtigste Handlung
  const hero = el('section', 'vhero');
  hero.innerHTML = `
    <p class="vhero-kicker">For film, post &amp; art departments</p>
    <h2 class="vhero-h">Design, don’t <span class="accent">gamble.${SWOOSH}</span></h2>
    <p class="vhero-sub">${SUBLINE}</p>
    <div class="vhero-actions">
      <button class="vcta" data-act="tool" data-house="Workshop">Create a 3D model now</button>
      <button class="vghost" data-act="well">How it works</button>
    </div>
    <button class="vhero-x" data-act="hero-close" aria-label="Close banner">×</button>`;
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
    ? [['look', 'Look around', 'swipe with your finger'], ['walk', 'Walk around', 'joystick bottom left'],
       ['well', 'Tap the well', 'how it works'], ['museum', 'Explore the museum', 'watch a finished project'], ['house', 'Visit a workshop', 'tap a house']]
    : [['look', 'Look around', 'click and drag'], ['walk', 'Walk around', 'W A S D or arrow keys'],
       ['well', 'Click the well', 'how it works'], ['museum', 'Explore the museum', 'watch a finished project'], ['house', 'Visit a workshop', 'click a house']];
  const quest = el('aside', 'vquest');
  quest.setAttribute('aria-label', 'Quest');
  quest.innerHTML = `
    <button class="vquest-tab" data-act="quest-toggle" aria-label="Show or hide quest"><span>!</span> Quest</button>
    <div class="vquest-body">
      <p class="vquest-kicker">Quest</p>
      <h3 class="vquest-h">Welcome to Sketch Village</h3>
      <ul>${TASKS.map(([k, t, h]) => `<li data-q="${k}"><svg class="qbox" viewBox="0 0 24 24" aria-hidden="true"><path class="qframe" d="M4 5 C 9 3.5, 16 4.2, 20 4.6 C 20.5 10, 20 15, 19.6 20 C 14 20.4, 9 20.2, 4.4 19.6 C 3.8 14, 4 9, 4 5"/><path class="qtick" pathLength="1" d="M6 12 C 8 13.5, 9.5 15.5, 10.5 17.5 C 12.5 12, 16 7, 22 2.5"/></svg><span class="qt"><b>${t}</b><small>${h}</small></span></li>`).join('')}</ul>
      <p class="vquest-done">Quest complete! Have fun creating.</p>
    </div>`;
  document.body.appendChild(quest);
  const keys = el('div', 'vkeys');
  keys.innerHTML = touch
    ? `<span class="vkeys-t">Joystick bottom left: walk · Swipe: look around</span>`
    : `<span class="vkeys-wasd"><kbd class="k-w">W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span class="vkeys-t">walk</span>
       <span class="vkeys-mouse" aria-hidden="true"><i></i></span><span class="vkeys-t">drag: look around</span>
       <span class="vkeys-t vkeys-click">Click houses &amp; the well</span>`;
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

  // ---------- „Sketch now“: immer sichtbar links – erklärt das Produkt in einer Sekunde (Skizze wird zu 3D)
  const sketchNow = el('button', 'vsketch');
  sketchNow.type = 'button';
  sketchNow.dataset.act = 'tool';
  sketchNow.dataset.house = 'Workshop';
  sketchNow.setAttribute('aria-label', 'Sketch now – turn a drawing into a 3D model');
  sketchNow.innerHTML = `
    <svg class="vsketch-cube" viewBox="0 0 80 78" aria-hidden="true">
      <polygon class="f top" points="40,8 72,21 40,34 8,21"/><polygon class="f left" points="8,21 40,34 40,70 8,57"/><polygon class="f right" points="72,21 40,34 40,70 72,57"/>
      <path class="ln" pathLength="1" d="M40 8 L72 21 L40 34 L8 21 Z M8 21 L8 57 L40 70 L72 57 L72 21 M40 34 L40 70"/>
    </svg>
    <span class="vsketch-txt"><b>Sketch now →</b><small>Draw it – get a 3D model for your scene.</small></span>`;
  document.body.appendChild(sketchNow);

  // ---------- Leiste oben
  const bar = el('header', 'vbar');
  bar.innerHTML = `
    <button class="vbar-logo" data-act="well" aria-label="To the well"><span class="vbar-word">Sketch<span>To</span>CAD</span><small>3D assets for film · USD export</small></button>
    <nav class="vbar-nav">
      <button data-act="project">About</button>
      <a href="mailto:${CONTACT_MAIL}">Contact</a>
      <button data-act="imprint">Imprint</button>
      <button data-act="privacy">Privacy</button>
      <button class="vbar-cta" data-act="tool" data-house="Workshop">Create 3D model</button>
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
      <button class="vbtn" data-act="close">← Back to the village</button>
    </div>
    <iframe class="vshop-frame" title="Workshop"></iframe>`;
  document.body.appendChild(shop);
  const frame = shop.querySelector('iframe')!;

  let open: 'card' | 'shop' | null = null;
  const setOpen = (v: typeof open) => { open = v; opts.onOpenChange?.(!!v); };

  function showCard(html: string, pad = false, kind: '' | 'museum' = '') {
    card.classList.toggle('pad', pad);
    card.classList.toggle('museum', kind === 'museum');
    card.innerHTML = pad
      ? `<div class="pad-board" aria-hidden="true"></div><div class="pad-sheet s2" aria-hidden="true"></div><div class="pad-sheet s1" aria-hidden="true"></div>
         <div class="pad-paper${kind === 'museum' ? ' plain' : ''}"><div class="pad-ink">${html}</div>${crumple(1 + Math.floor(Math.random() * 90))}<div class="pad-light" aria-hidden="true"></div></div>
         <span class="ear ear-tr" aria-hidden="true"></span><span class="ear ear-bl" aria-hidden="true"></span>
         ${spiral(kind === 'museum' ? 940 : 560)}<button class="vcard-x hw-x" data-act="close" aria-label="Close">×</button>`
      : `<button class="vcard-x" data-act="close" aria-label="Close">×</button>${html}`;
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
    card.querySelector('video')?.pause();
    if (shop.classList.contains('on')) {
      shop.classList.remove('on');
      setTimeout(() => { if (!shop.classList.contains('on')) frame.src = 'about:blank'; }, 400);
    }
    setOpen(null);
  }

  const WELL = `
    <div class="pad-head hw">Note from the well</div>
    <h2 class="pad-h hw">Design, don’t gamble!</h2>
    <p class="hw">Prompting is fast. Sketching is precise.<br>SketchToCAD gives you both – straight to 3D.</p>
    <ol class="pad-list">
      <li class="hw"><b>Sketch</b> – like on paper, just endless.</li>
      <li class="hw"><b>Say</b> what the sketch can’t show: “wood, old, 10 cm longer”.</li>
      <li class="hw"><b>Adjust parts</b> – one by one, down to the centimetre.</li>
      <li class="hw"><b>Into the scene</b> – as USD, straight into Houdini, Unreal or Blender.</li>
    </ol>
    <div class="pad-links">
      <button class="pad-link main" data-act="tool" data-house="Workshop"><span class="hw">→ Create a 3D model now!</span>${CIRCLED}</button>
      <button class="pad-link minor" data-act="replay"><span class="hw">Watch the intro again</span>${UNDERLINED}</button>
    </div>
    <p class="pad-pencil hw">(Prototype – our model is still learning)</p>`;

  const PROJECT = `
    <div class="pad-head hw">Note: About us</div>
    <h2 class="pad-h hw">What is SketchToCAD?</h2>
    <p class="hw">Prompting is fast, but rarely gives you exactly what you have in mind. Sketching is precise, but slow to get to a finished 3D model.</p>
    <p class="hw">We combine both: you sketch, say what you want – and get a 3D model you can keep refining, part by part.</p>
    <p class="hw"><b>Who is it for?</b> Film and post-production teams building backgrounds and foregrounds – together with the art department.</p>
    <p class="hw"><b>What comes out?</b> Clean 3D elements with named parts and real-world scale – as USD, ready for Houdini, Unreal and Blender.</p>
    <div class="pad-links">
      <button class="pad-link main" data-act="well"><span class="hw">→ How it works</span>${CIRCLED}</button>
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Write to us</span>${UNDERLINED}</a>
    </div>`;

  const IMPRINT = `
    <div class="pad-head hw">Note: Legal</div>
    <h2 class="pad-h hw">Imprint</h2>
    <p class="hw"><b>Responsible for organisation:</b><br>Craig and Maik</p>
    <p class="pad-todo hw">Before going live: add full name, postal address, e-mail (§ 5 DDG)!</p>
    <div class="pad-links">
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Contact: ${CONTACT_MAIL}</span>${UNDERLINED}</a>
    </div>`;

  const PRIVACY = `
    <div class="pad-head hw">Note: Legal</div>
    <h2 class="pad-h hw">Privacy</h2>
    <p class="hw">This site sets no cookies, uses no tracking and stores no form data.</p>
    <p class="pad-todo hw">Before going live: full privacy policy (controller, hosting, server logs, your rights)!</p>
    <div class="pad-links">
      <a class="pad-link minor" href="mailto:${CONTACT_MAIL}"><span class="hw">Questions? Write to us</span>${UNDERLINED}</a>
    </div>`;

  const MUSEUM = `
    <div class="pad-head hw">Note: Museum</div>
    <h2 class="pad-h hw">Exhibit No. 1 – ${MUSEUM_TITLE}</h2>
    <figure class="pin">
      <span class="tape tl" aria-hidden="true"></span><span class="tape tr" aria-hidden="true"></span>
      <video class="pin-video" controls playsinline preload="metadata" poster="${MUSEUM_POSTER}" src="${MUSEUM_VIDEO}"></video>
      <div class="pin-empty"><span class="hw">Our finished project will be showing here soon.</span><small>Put the video at app/public${MUSEUM_VIDEO}</small></div>
    </figure>
    <p class="pin-caption hw">${MUSEUM_NOTE}</p>
    <p class="pin-flow hw">Sketch → SketchToCAD → USD → Scene</p>
    <div class="pad-links">
      <button class="pad-link minor" data-act="close"><span class="hw">← back to the village</span>${UNDERLINED}</button>
    </div>`;

  function openMuseum() {
    questDone('museum');
    if (shop.classList.contains('on')) closeAll();
    showCard(MUSEUM, true, 'museum');
    const v = card.querySelector<HTMLVideoElement>('video')!;
    const fig = card.querySelector<HTMLElement>('.pin')!;
    const empty = () => { fig.classList.add('empty'); requestAnimationFrame(() => fitPad()); };
    v.addEventListener('error', empty);
    v.addEventListener('loadedmetadata', () => { fig.classList.remove('empty'); requestAnimationFrame(() => fitPad()); setTimeout(() => v.play().catch(() => {}), 500); });
  }

  function openTool(house: string) {
    if (house !== 'Workshop') questDone('house');
    heroShownAt = 0; collapseHero();
    veil.classList.remove('on');
    (shop.querySelector('.vshop-title') as HTMLElement).textContent = house === 'Workshop' ? 'Workshop' : `Workshop · ${house}`;
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
    else if (act === 'tool') openTool(t.dataset.house ?? 'Workshop');
    else if (act === 'replay') { closeAll(); opts.onReplayIntro(); }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAll(); } }, true);

  return {
    setMode(mode) {
      jump.textContent = mode === 'intro' ? 'Skip intro ›' : '⟲ Back to the well';
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
    openMuseum,
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
