// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Pop-ups (Brunnen, Impressum …) und Werkstatt.
// Bewusst ohne Framework, damit das Skizzendorf schlank bleibt.

// Platzhalter – vor dem Livegang ersetzen
const CONTACT_MAIL = 'kontakt@beispiel.de';
const TOOL_URL = '/'; // Janoschs Canvas (index.html); später Werkzeug je Haus per ?tool=…

export interface VillageUI {
  setMode(mode: 'intro' | 'village'): void;
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

export function createUI(opts: { onJump: () => void; onReplayIntro: () => void; onOpenChange?: (open: boolean) => void }): VillageUI {
  // ---------- Leiste oben
  const bar = el('header', 'vbar');
  bar.innerHTML = `
    <button class="vbar-logo" data-act="well" aria-label="Zum Brunnen">Sketch<span>To</span>CAD</button>
    <nav class="vbar-nav">
      <button data-act="project">Projekt</button>
      <a href="mailto:${CONTACT_MAIL}">Kontakt</a>
      <button data-act="imprint">Impressum</button>
      <button data-act="privacy">Datenschutz</button>
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

  function showCard(html: string) {
    card.innerHTML = `<button class="vcard-x" data-act="close" aria-label="Schließen">×</button>${html}`;
    veil.classList.add('on');
    setOpen('card');
    (card.querySelector('[data-act="close"]') as HTMLElement).focus();
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
    <p class="vcard-kicker">Der Dorfbrunnen</p>
    <h2>Von der Skizze zum 3D-Modell</h2>
    <ol class="vsteps">
      <li><b>Skizzieren</b><span>Zeichne frei auf einem unendlichen Canvas – Striche, Formen, Notizen.</span></li>
      <li><b>Live in 3D</b><span>Ein eigenes, schlankes Modell baut aus der Skizze ein 3D-Modell – während du zeichnest.</span></li>
      <li><b>Teile bearbeiten</b><span>Das Modell besteht aus einzelnen Teilen. Umfärben, verschieben oder per Text ändern: „Mach das Horn länger.“</span></li>
      <li><b>Weiter in die Produktion</b><span>Export als USD – dem Standard in Film und Animation.</span></li>
    </ol>
    <p class="vcard-note">Jedes Haus im Dorf ist eine Werkstatt. Klick eins an und probier es aus.</p>
    <div class="vcard-actions">
      <button class="vbtn vbtn-ink" data-act="tool" data-house="Werkstatt">Werkstatt öffnen</button>
      <button class="vbtn" data-act="replay">Intro nochmal ansehen</button>
    </div>
    <p class="vcard-small">Prototyp – das eigene Modell ist noch im Training.</p>`;

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
    else if (act === 'well') showCard(WELL);
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
    openWell: () => showCard(WELL),
    openTool,
    isOpen: () => !!open,
  };
}
