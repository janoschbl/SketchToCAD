// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Pop-ups (Brunnen, Impressum …) und Werkstatt.
// Bewusst ohne Framework, damit das Skizzendorf schlank bleibt.

import { DEMO } from '../lib/demo';

// Platzhalter – vor dem Livegang ersetzen
const CONTACT_MAIL = 'contact@example.com';
const TOOL_URL = (import.meta.env.VITE_TOOL_URL as string | undefined) ?? '/';
// Museum: Demo-Video (läuft direkt im Vollbild)
const MUSEUM_VIDEO = '/museum/projekt-4kreise.mp4';
const MUSEUM_POSTER = '/museum/projekt.jpg';

/** Öffentliche QR-Seite (world.html): jeder Besucher bekommt seinen eigenen, nicht geteilten Canvas-Raum */
const PUBLIC_ROOM = (() => {
  if (!(window as unknown as { ST_PUBLIC?: boolean }).ST_PUBLIC) return '';
  try {
    let r = localStorage.getItem('st3-room');
    if (!r) { r = 'p-' + Math.random().toString(36).slice(2, 12); localStorage.setItem('st3-room', r); }
    return r;
  } catch { return 'p-' + Math.random().toString(36).slice(2, 12); }
})();

export const CLAIM = 'Design, don’t gamble.';
export const SUBLINE = 'Prompting is fast. Sketching is precise. SketchTo3D gives you both – straight to 3D.';
/** Design-Varianten für den Claim im Intro, umschaltbar per ?claim=titel|hand|unten */
export type ClaimVariant = 'titel' | 'hand' | 'unten';

export type GuideKey = 'look' | 'walk';

export interface VillageUI {
  setMode(mode: 'intro' | 'village'): void;
  /** Claim im Intro ein-/ausblenden */
  introClaim(on: boolean): void;
  /** Steuerungshinweis nach der Landung; verschwindet, sobald man gelaufen ist und sich umgesehen hat */
  showGuide(): void;
  noteDone(key: GuideKey): void;
  openTeam(): void;
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

export function createUI(opts: { onJump: () => void; onReplayIntro: () => void; onWell?: () => void; onOpenChange?: (open: boolean) => void; onTeam?: () => void; claim?: ClaimVariant }): VillageUI {
  const variant: ClaimVariant = opts.claim ?? 'titel';

  // ---------- Claim im Intro (Titelkarte)
  const title = el('div', `vtitle vtitle-${variant}`);
  title.setAttribute('aria-live', 'polite');
  title.hidden = true; // Claim-Headline im Intro entfernt
  document.body.appendChild(title);

  // ---------- Steuerungshinweis: eine kleine Leiste unten, kein Zettel
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const keys = el('div', 'vkeys');
  keys.innerHTML = touch
    ? `<span class="vkeys-t">Joystick: walk</span><span class="vkeys-sep"></span><span class="vkeys-t">Swipe: look around</span>`
    : `<span class="vkeys-wasd"><kbd class="k-w">W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span class="vkeys-t">walk</span>
       <span class="vkeys-sep"></span><span class="vkeys-mouse" aria-hidden="true"><i></i></span><span class="vkeys-t">drag to look around</span>`;
  document.body.appendChild(keys);
  const doneSet = new Set<GuideKey>();
  let guideShown = false;
  function noteDone(k: GuideKey) {
    if (!guideShown) return;
    doneSet.add(k);
    if (doneSet.has('walk') && doneSet.has('look')) keys.classList.remove('on');
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
    <span class="vsketch-txt"><b>${DEMO ? 'Watch the demo →' : 'Sketch now →'}</b><small>${DEMO ? 'See a sketch turn into a 3D model.' : 'Draw it – get a 3D model for your scene.'}</small></span>`;
  document.body.appendChild(sketchNow);

  // ---------- Leiste oben
  const bar = el('header', 'vbar');
  bar.innerHTML = `
    <button class="vbar-logo" data-act="well" aria-label="To the well"><span class="vbar-word">Sketch<span>To</span>3D</span><small>3D assets for film · USD export</small></button>
    <nav class="vbar-nav">
      <button data-act="project">About</button>
      <a href="mailto:${CONTACT_MAIL}">Contact</a>
      <button data-act="imprint">Imprint</button>
      <button data-act="privacy">Privacy</button>
      
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

  // ---------- Pop-up (schlichte Karte)
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

  let open: 'card' | 'shop' | 'video' | null = null;
  const setOpen = (v: typeof open) => { open = v; opts.onOpenChange?.(!!v); };

  function showCard(html: string) {
    card.innerHTML = `<button class="vcard-x" data-act="close" aria-label="Close">×</button>${html}`;
    veil.classList.add('on');
    setOpen('card');
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  }

  function closeAll() {
    if (full) { closeVideo(); return; }
    veil.classList.remove('on');
    card.querySelector('video')?.pause();
    if (shop.classList.contains('on')) {
      shop.classList.remove('on');
      setTimeout(() => { if (!shop.classList.contains('on')) frame.src = 'about:blank'; }, 400);
    }
    setOpen(null);
  }

  const WELL = `
    <p class="vcard-kicker">How it works</p>
    <h2>Sketch it. Say it. Get 3D.</h2>
    <p class="vcard-lead">Prompting is fast. Sketching is precise. SketchTo3D gives you both – straight to 3D.</p>
    <ol class="vsteps">
      <li><b>Sketch</b> – like on paper, just endless.</li>
      <li><b>Say</b> what the sketch can’t show: “wood, old, 10 cm longer”.</li>
      <li><b>Adjust parts</b> – one by one, down to the centimetre.</li>
      <li><b>Into the scene</b> – as USD, straight into Houdini, Unreal or Blender.</li>
    </ol>
    <div class="vcard-actions">
      ${DEMO ? '<button class="vcta" data-act="museum">Watch the demo</button>' : '<button class="vcta" data-act="tool" data-house="Workshop">Create a 3D model now</button><button class="vghost vghost-dark" data-act="museum">Watch the demo</button>'}
    </div>`;

  const PROJECT = `
    <p class="vcard-kicker">About</p>
    <h2>What is SketchTo3D?</h2>
    <p>Prompting is fast, but rarely gives you exactly what you have in mind. Sketching is precise, but slow to get to a finished 3D model.</p>
    <p>We combine both: you sketch, say what you want – and get a 3D model you can keep refining, part by part.</p>
    <p><b>Who is it for?</b> Film and post-production teams building backgrounds and foregrounds – together with the art department.</p>
    <p><b>What comes out?</b> Clean 3D elements with named parts and real-world scale – as USD, ready for Houdini, Unreal and Blender.</p>
    <div class="vcard-actions">
      <button class="vcta" data-act="${DEMO ? 'museum' : 'tool'}" data-house="Workshop">${DEMO ? 'Watch the demo' : 'Create a 3D model now'}</button>
      <a class="vghost vghost-dark" href="mailto:${CONTACT_MAIL}">Write to us</a>
    </div>`;

  const IMPRINT = `
    <p class="vcard-kicker">Legal</p>
    <h2>Imprint</h2>
    <p><b>Responsible for organisation:</b><br>Craig and Maik</p>
    <p class="vcard-todo">Before going live: add full name, postal address, e-mail (§ 5 DDG)!</p>
    <p><a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a></p>`;

  const PRIVACY = `
    <p class="vcard-kicker">Legal</p>
    <h2>Privacy</h2>
    <p>This site sets no cookies, uses no tracking and stores no form data.</p>
    <p class="vcard-todo">Before going live: full privacy policy (controller, hosting, server logs, your rights)!</p>
    <p><a href="mailto:${CONTACT_MAIL}">Questions? Write to us</a></p>`;

  // ---------- Museum: Video direkt im Vollbild (kein Papier davor). Abspielen und Vollbild passieren im Klick selbst – nur so erlauben macOS/Chrome beides.
  let full: HTMLElement | null = null;
  function closeVideo() {
    const f = full; if (!f) return;
    full = null;
    f.classList.remove('on');
    f.querySelector('video')?.pause();
    setTimeout(() => f.remove(), 600);
    setOpen(null);
  }
  function openMuseum() {
    if (full) return;
    if (shop.classList.contains('on')) closeAll();
    veil.classList.remove('on');
        const f = document.createElement('div');
    f.className = 'vfull';
    f.innerHTML = `<video playsinline preload="auto" poster="${MUSEUM_POSTER}" src="${MUSEUM_VIDEO}"></video><button class="vfull-x" aria-label="Close">×</button>`;
    const v = f.querySelector('video')!;
    document.body.appendChild(f);
    full = f;
    setOpen('video');
    // 1) Vollbild + Abspielen sofort, noch im Klick (Nutzergeste)
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { /* CSS-Vollbild bleibt */ });
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });   // notfalls stumm starten, damit es nie hängt
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add('on')));
    v.addEventListener('ended', closeVideo);
    f.querySelector('.vfull-x')!.addEventListener('click', closeVideo);
    f.addEventListener('click', (e) => { if (e.target === f) closeVideo(); });
    v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
  }

  function openTool(house: string) {
    // Öffentliche Demo: das Werkzeug ist (noch) nicht frei benutzbar – stattdessen das Demo-Video zeigen
    if (DEMO) { openMuseum(); return; }
        veil.classList.remove('on');
    (shop.querySelector('.vshop-title') as HTMLElement).textContent = house === 'Workshop' ? 'Workshop' : `Workshop · ${house}`;
    const url = `${TOOL_URL}?from=village&house=${encodeURIComponent(house)}${PUBLIC_ROOM ? `&room=${PUBLIC_ROOM}` : ''}`;
    // Gehostete Seiten (Base44) senden X-Frame-Options: DENY → dort kein iframe, sondern normale Navigation (Canvas hat einen Zurück-Knopf)
    if (import.meta.env.VITE_TOOL_URL) { location.href = url; return; }
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
    else if (act === 'well') { opts.onWell?.(); showCard(WELL); }
    else if (act === 'museum') { closeAll(); openMuseum(); }
    else if (act === 'project') showCard(PROJECT);
    else if (act === 'imprint') showCard(IMPRINT);
    else if (act === 'privacy') showCard(PRIVACY);
    else if (act === 'tool') openTool(t.dataset.house ?? 'Workshop');
    else if (act === 'replay') { closeAll(); opts.onReplayIntro(); }
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && full) { e.stopPropagation(); closeVideo(); } else if (e.key === 'Escape' && open) { e.stopPropagation(); closeAll(); } }, true);

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
    openWell: () => showCard(WELL),
    openTeam: () => opts.onTeam?.(),
    openMuseum,
    showGuide() {
      if (guideShown) return;
      guideShown = true;
      keys.classList.add('on');
      setTimeout(() => keys.classList.remove('on'), 20000);
    },
    noteDone,
    introClaim(on) { title.classList.toggle('on', on); },
    openTool,
    isOpen: () => !!open,
  };
}
