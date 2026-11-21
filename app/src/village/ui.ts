// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Pop-ups (Brunnen, Impressum …) und Werkstatt.
// Bewusst ohne Framework, damit das Skizzendorf schlank bleibt.

// Platzhalter – vor dem Livegang ersetzen
const CONTACT_MAIL = 'kontakt@beispiel.de';
const TOOL_URL = '/'; // Janoschs Canvas (index.html); später Werkzeug je Haus per ?tool=…

export const CLAIM = 'Gestalten statt würfeln.';
export const SUBLINE = 'Prompten ist schnell. Zeichnen ist genau. SketchToCAD verbindet beides – direkt in 3D.';
/** Design-Varianten für den Claim im Intro, umschaltbar per ?claim=titel|hand|unten */
export type ClaimVariant = 'titel' | 'hand' | 'unten';

export interface VillageUI {
  setMode(mode: 'intro' | 'village'): void;
  /** Claim im Intro ein-/ausblenden */
  introClaim(on: boolean): void;
  /** Banner nach der Landung (Claim + Button) */
  showHero(): void;
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

/** Handschrift unperfekt machen: jeder Buchstabe leicht gedreht, versetzt, unterschiedlich kräftig. */
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
          w.style.transform = `translateY(${(Math.random() - 0.5) * 2.2}px) rotate(${(Math.random() - 0.5) * 1.6}deg)`;
          for (const ch of word) {
            const c = document.createElement('span');
            c.className = 'hw-c';
            c.textContent = ch;
            c.style.transform = `translateY(${(Math.random() - 0.5) * 1.6}px) rotate(${(Math.random() - 0.5) * 5}deg) scale(${0.95 + Math.random() * 0.1})`;
            c.style.opacity = String(0.82 + Math.random() * 0.18);
            if (Math.random() < 0.25) c.style.fontWeight = '700';
            w.appendChild(c);
          }
          frag.appendChild(w);
        }
        n.parentNode!.replaceChild(frag, n);
      } else if (n.nodeType === 1 && !(n as HTMLElement).classList.contains('hw-c')) [...n.childNodes].forEach(walk);
    };
    [...node.childNodes].forEach(walk);
  });
}

/** Handgezeichnete Unterstreichung als SVG (wird beim Einblenden „gezogen“) */
const SWOOSH = `<svg class="swoosh" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 15 C 60 6, 120 20, 180 11 S 270 8, 296 13" pathLength="1"/></svg>`;

export function createUI(opts: { onJump: () => void; onReplayIntro: () => void; onOpenChange?: (open: boolean) => void; claim?: ClaimVariant }): VillageUI {
  const variant: ClaimVariant = opts.claim ?? 'titel';

  // ---------- Claim im Intro (Titelkarte)
  const title = el('div', `vtitle vtitle-${variant}`);
  title.setAttribute('aria-live', 'polite');
  title.innerHTML = variant === 'hand'
    ? `<h1 class="vtitle-h"><span class="vtitle-reveal">${CLAIM}</span></h1><p class="vtitle-sub">${SUBLINE}</p>`
    : `<h1 class="vtitle-h">Gestalten statt <span class="accent">würfeln.${SWOOSH}</span></h1><p class="vtitle-sub">${SUBLINE}</p>`;
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
  // ---------- Leiste oben
  const bar = el('header', 'vbar');
  bar.innerHTML = `
    <button class="vbar-logo" data-act="well" aria-label="Zum Brunnen">Sketch<span>To</span>CAD</button>
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
      ? `<div class="pad-rings" aria-hidden="true"></div><div class="pad-paper"><button class="vcard-x hw-x" data-act="close" aria-label="Schließen">×</button>${html}</div><span class="ear ear-tr" aria-hidden="true"></span><span class="ear ear-bl" aria-hidden="true"></span>`
      : `<button class="vcard-x" data-act="close" aria-label="Schließen">×</button>${html}`;
    if (pad) scribble(card);
    veil.classList.add('on');
    setOpen('card');
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  }
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
      <li class="hw"><b>Teile anpassen</b> – Dach, Tür, Griff: einzeln und auf den Zentimeter.</li>
      <li class="hw"><b>Ab in die Pipeline</b> – als USD, gemeinsam mit dem Art Department.</li>
    </ol>
    <p class="pad-ps hw">PS: Jedes Haus im Dorf ist eine Werkstatt – klick eins an!</p>
    <p class="pad-small">Prototyp – das eigene Modell ist noch im Training.</p>
    <div class="pad-actions">
      <button class="vcta" data-act="tool" data-house="Werkstatt">Jetzt 3D-Modell erstellen</button>
      <button class="vghost vghost-dark" data-act="replay">Intro nochmal ansehen</button>
    </div>`;

  const PROJECT = `
    <p class="vcard-kicker">Über das Projekt</p>
    <h2>SketchToCAD</h2>
    <p>Skizzen-Tools sind schnell, aber flach. CAD ist mächtig, aber langsam. SketchToCAD verbindet beides:
    Du zeichnest in 2D, ein selbst trainiertes Modell baut live ein 3D-Modell, und du bearbeitest es weiter wie in einem CAD-Programm.</p>
    <p>Gedacht für Film- und Produktions-Assets – Props, Set-Objekte, Figuren – vor allem in der Vorproduktion.</p>
    <div class="vcard-actions">
      <button class="vbtn vbtn-ink" data-act="well">Wie es funktioniert</button>
      <a class="vbtn" href="mailto:${CONTACT_MAIL}">Schreib uns</a>
    </div>`;

  const IMPRINT = `
    <p class="vcard-kicker">Rechtliches</p>
    <h2>Impressum</h2>
    <p><b>Verantwortlich für Organisation:</b><br>Craig und Maik</p>
    <p class="vcard-todo">Platzhalter – vor dem Livegang ersetzen: vollständiger Name, ladungsfähige Anschrift, E-Mail
    (Angaben nach § 5 DDG) und ggf. Verantwortliche/r für Inhalte.</p>
    <p>Kontakt: <a href="mailto:${CONTACT_MAIL}">${CONTACT_MAIL}</a></p>`;

  const PRIVACY = `
    <p class="vcard-kicker">Rechtliches</p>
    <h2>Datenschutz</h2>
    <p>Diese Seite setzt keine Cookies, nutzt kein Tracking und speichert keine Formulardaten.</p>
    <p class="vcard-todo">Platzhalter – vor dem Livegang durch eine vollständige Datenschutzerklärung ersetzen
    (u. a. Verantwortliche/r, Hosting und Server-Logs, Rechte der Betroffenen).</p>`;

  function openTool(house: string) {
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
    else if (act === 'well') showCard(WELL, true);
    else if (act === 'hero-close') { heroShownAt = 0; collapseHero(); }
    else if (act === 'project') showCard(PROJECT);
    else if (act === 'imprint') showCard(IMPRINT);
    else if (act === 'privacy') showCard(PRIVACY);
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
    openWell: () => showCard(WELL, true),
    introClaim(on) { title.classList.toggle('on', on); },
    showHero() {
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
