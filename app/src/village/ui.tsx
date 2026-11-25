// Oberfläche über der 3D-Welt: Leiste oben, Sprung-Button, Dialoge (Brunnen, Museum, Impressum …) und Werkstatt.
// React + Radix-Primitives (dieselbe Basis wie shadcn/ui, steckt schon im Projekt) und Reicon-Icons (MIT, https://reicon.dev).
// main.ts spricht nur mit dem VillageUI-Objekt aus createUI() und weiß nichts von React.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, DropdownMenu } from 'radix-ui';
import { ArrowLeft, ArrowRight, Copy, CopySuccess, Menu, Play, Xmark } from 'reicon-react';
import { DEMO } from '../lib/demo';

const CONTACT_MAIL = 'janoschbl@proton.me';
const TOOL_URL = (import.meta.env.VITE_TOOL_URL as string | undefined) ?? '/';
// Museum: geschnittenes Demo-Video (Wartezeiten der KI entfernt) im Rahmen auf der Pinnwand
const MUSEUM_VIDEO = '/museum/demo-kurz.mp4';
const MUSEUM_POSTER = '/museum/projekt.jpg';

/** Öffentliche QR-Seite (world.html): jeder Besucher bekommt seinen eigenen, nicht geteilten Canvas-Raum */
const PUBLIC_ROOM = (() => {
  // In der öffentlichen Demo öffnet sich kein Canvas → nichts im Browser speichern (siehe Datenschutzerklärung)
  if (DEMO || !(window as unknown as { ST_PUBLIC?: boolean }).ST_PUBLIC) return '';
  try {
    let r = localStorage.getItem('st3-room');
    if (!r) { r = 'p-' + Math.random().toString(36).slice(2, 12); localStorage.setItem('st3-room', r); }
    return r;
  } catch { return 'p-' + Math.random().toString(36).slice(2, 12); }
})();

export const CLAIM = 'Design, don’t gamble.';
export const SUBLINE = 'Prompting is fast. Sketching is precise. SketchTo3D gives you both, straight to 3D.';
/** Design-Varianten für den Claim im Intro (derzeit ausgeblendet), umschaltbar per ?claim=titel|hand|unten */
export type ClaimVariant = 'titel' | 'hand' | 'unten';

export type GuideKey = 'look' | 'walk';

export interface VillageUI {
  setMode(mode: 'intro' | 'village'): void;
  /** weit weg vom Brunnen? Dann zeigt sich der Zurück-Knopf */
  setFar(far: boolean): void;
  /** Claim im Intro ein-/ausblenden (Claim ist derzeit ausgeblendet) */
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

type Card = 'well' | 'about' | 'imprint' | 'privacy' | 'museum';
interface State {
  mode: 'intro' | 'village';
  card: Card | null;
  shop: string | null;   // Hausname der offenen Werkstatt
  guide: boolean;
  far: boolean;
}

// Kleiner Store ohne Bibliothek: main.ts schreibt, React liest
function createStore(init: State) {
  let s = init;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    set(p: Partial<State>) { s = { ...s, ...p }; subs.forEach((f) => f()); },
    sub(f: () => void) { subs.add(f); return () => subs.delete(f); },
  };
}
type Store = ReturnType<typeof createStore>;

const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------------------------------------------------------- Inhalte

const ADDRESS = (
  <>Janosch Dickhage<br />Wittekindsweg 1<br />59590 Geseke<br />Deutschland</>
);
const Mail = () => <a href={`mailto:${CONTACT_MAIL}`}>{CONTACT_MAIL}</a>;

/** E-Mail-Adresse zum Lesen und Kopieren – statt beim Klick ungefragt ein Mailprogramm zu öffnen */
function MailCopy() {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(CONTACT_MAIL).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }).catch(() => {});
  };
  return (
    <div className="vmail">
      <span className="vmail-addr">{CONTACT_MAIL}</span>
      <button type="button" className="vmail-copy" onClick={copy} aria-label={done ? 'Copied' : 'Copy e-mail address'}>
        <span className="vmail-ico" data-on={!done}><Copy size={18} aria-hidden /></span>
        <span className="vmail-ico" data-on={done}><CopySuccess size={18} aria-hidden /></span>
      </button>
    </div>
  );
}

function CTA({ act, children }: { act: () => void; children: ReactNode }) {
  return <button type="button" className="vcta" onClick={act}>{children}<ArrowRight size={18} aria-hidden /></button>;
}

/** Echte Verwandlung: Kinderzeichnung → 3D-Modell aus unserer Pipeline (three.js, lädt erst beim Öffnen) */
function ModelDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<'sketch' | 'model'>('sketch');
  useEffect(() => {
    let stop = () => {};
    let alive = true;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./demo3d').then(({ mountDemo }) => { if (alive && ref.current) stop = mountDemo(ref.current, setStage, reduce); });
    return () => { alive = false; stop(); };
  }, []);
  return (
    <figure className="vdemo" aria-label="A child's sketch of a butterfly turns into a 3D model">
      <canvas ref={ref} />
      <figcaption>
        <span data-on={stage === 'sketch'}>Sketch</span>
        <span data-on={stage === 'model'}>3D model</span>
      </figcaption>
    </figure>
  );
}

function WellCard({ go }: { go: Go }) {
  return (
    <div className="vwell">
      <ModelDemo />
      <div>
        <p className="vcard-wip">Still a work in progress.</p>
        <Dialog.Title asChild><h2>Sketch it. Say it. Get 3D.</h2></Dialog.Title>
        <Dialog.Description className="vcard-lead">{SUBLINE}</Dialog.Description>
        <div className="vcard-actions vcard-actions-top">
          {DEMO
            ? <CTA act={() => go('museum')}>Watch the demo</CTA>
            : <>
                <CTA act={() => go('tool')}>Create a 3D model</CTA>
                <button type="button" className="vghost" onClick={() => go('museum')}><Play size={16} weight="Filled" aria-hidden />Watch the demo</button>
              </>}
        </div>
        <ol className="vsteps vsteps-tight">
          <li><b>Sketch</b> like on paper, just endless.</li>
          <li><b>Say</b> what the sketch can’t show: “wood, old, 10 cm longer”.</li>
          <li><b>Adjust parts</b> one by one, down to the centimetre.</li>
          <li><b>Into the scene</b> as USD, straight into Houdini, Unreal or Blender.</li>
        </ol>
      </div>
    </div>
  );
}

const TEAM = [
  { name: 'Martin Oliver Thiel', url: 'https://www.linkedin.com/in/martin-oliver-thiel-214784196/' },
  { name: 'Mariia Pravoslavna', url: 'https://www.linkedin.com/in/mariia-pravoslavna/' },
  { name: 'Janosch Dickhage', url: 'https://www.linkedin.com/in/janosch-dickhage-038380451/' },
];

/** About und Kontakt in einem: wer wir sind, was die Idee ist, Stand, und dass wir Jobs suchen */
function AboutCard({ go }: { go: Go }) {
  return (
    <>
      <figure className="vteam">
        <img src="/endslide/team1.jpg" alt="Martin, Mariia and Janosch with laptops at the hackathon table" width={1000} height={750} />
        <figcaption>Hackathon weekend at STARTPLATZ</figcaption>
      </figure>
      <Dialog.Title asChild><h2>Hi, we’re Martin, Mariia and Janosch.</h2></Dialog.Title>
      <Dialog.Description>We built SketchTo3D over a weekend at a hackathon at <a href="https://www.startplatz.de/" target="_blank" rel="noopener">STARTPLATZ</a>. A weekend turned out to be slightly too short, so we just kept building.</Dialog.Description>
      <p>The idea: you sketch something and get a finished 3D model as USD, ready for film and post-production. Right now it is good for planning and brainstorming. Later it should work end to end.</p>
      <p>It is not finished yet. The demo shows where it is at.</p>
      <div className="vcard-actions vcard-actions-top">
        <CTA act={() => go(DEMO ? 'museum' : 'tool')}>{DEMO ? 'Watch the demo' : 'Create a 3D model'}</CTA>
      </div>
      <h3>Contact</h3>
      <p>Mariia and I are looking for jobs in software development. If you need something built in this direction, or just want to talk about it, write us.</p>
      <MailCopy />
      <ul className="vlinks">
        {TEAM.map((m) => <li key={m.url}><a href={m.url} target="_blank" rel="noopener">{m.name}<span className="vlinks-tag">LinkedIn</span></a></li>)}
      </ul>
    </>
  );
}

function ImprintCard() {
  return (
    <div lang="de">
      <Dialog.Title asChild><h2>Impressum</h2></Dialog.Title>
      <Dialog.Description className="vcard-small">Angaben gemäß § 5 DDG</Dialog.Description>
      <p>{ADDRESS}</p>
      <h3>Kontakt</h3>
      <p>E-Mail: <Mail /></p>
      <h3>Verantwortlich für den Inhalt</h3>
      <p className="vcard-small">nach § 18 Abs. 2 MStV</p>
      <p>{ADDRESS}</p>
      <h3>Schriften und Icons</h3>
      <p className="vcard-small">Schriften Fredoka und Nunito (SIL Open Font License 1.1), Icons von Reicon (MIT-Lizenz). Alles wird lokal von diesem Server geladen.</p>
    </div>
  );
}

function PrivacyCard() {
  return (
    <div lang="de">
      <Dialog.Title asChild><h2>Datenschutz</h2></Dialog.Title>
      <Dialog.Description className="vcard-lead">Kurz: keine Cookies, kein Tracking, keine Analyse, keine Inhalte von fremden Servern.</Dialog.Description>
      <h3>Verantwortlicher</h3>
      <p>{ADDRESS}<br />E-Mail: <Mail /></p>
      <h3>Hosting und Server</h3>
      <p>Die Seite liegt auf einem gemieteten Server in einem Rechenzentrum in Frankfurt am Main. Wenn du die Seite aufrufst, verarbeitet der Server technisch zwangsläufig deine IP-Adresse, den Zeitpunkt, die angefragte Datei und die Kennung deines Browsers, um dir die Seite auszuliefern. Der Webserver schreibt dazu keine Zugriffsprotokolle; die Daten werden also nicht gespeichert.</p>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Mein berechtigtes Interesse ist, die Seite sicher und fehlerfrei auszuliefern.</p>
      <h3>Cookies und lokaler Speicher</h3>
      <p>Diese Seite setzt keine Cookies. Das Skizzendorf speichert nichts auf deinem Gerät. Nur das Zeichenwerkzeug legt Einstellungen (zum Beispiel das zuletzt gewählte Werkzeug) im lokalen Speicher deines Browsers ab, damit sie beim nächsten Besuch noch da sind. Diese Daten verlassen dein Gerät nicht. Grundlage ist § 25 Abs. 2 Nr. 2 TDDDG. Du kannst sie jederzeit in deinem Browser löschen.</p>
      <h3>Schriften und externe Dienste</h3>
      <p>Alle Schriften, Icons, Bilder und Videos kommen von diesem Server. Es werden keine Google Fonts, keine CDNs, keine Analyse- oder Werbedienste eingebunden. Die KI-Funktionen sind in dieser öffentlichen Demo abgeschaltet; es werden also auch keine Zeichnungen an KI-Dienste geschickt.</p>
      <h3>Kontakt per E-Mail</h3>
      <p>Wenn du mir schreibst, nutze ich deine Adresse und deine Nachricht nur, um dir zu antworten (Art. 6 Abs. 1 lit. b bzw. f DSGVO), und lösche sie, sobald die Sache erledigt ist und keine Aufbewahrungspflicht besteht.</p>
      <h3>Deine Rechte</h3>
      <p>Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21). Eine E-Mail an mich genügt.</p>
      <p>Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für mich zuständigen Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (<a href="https://www.ldi.nrw.de" target="_blank" rel="noopener">ldi.nrw.de</a>).</p>
      <p className="vcard-small">Stand: November 2026</p>
    </div>
  );
}

/** Museum: Demo-Video im Rahmen auf einer Pinnwand, darüber ein angepinnter Zettel „Work in progress“ */
function Museum() {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current;
    // Der Klick, der das Museum öffnet, gilt als Nutzergeste → mit Ton starten, sonst notfalls stumm
    el?.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
  }, []);
  return (
    <div className="vboard">
      <div className="vboard-note">
        <span className="vboard-pin" aria-hidden />
        <Dialog.Title asChild><h2>Work in progress</h2></Dialog.Title>
        <Dialog.Description>Demo: from a sketch to an animated 3D butterfly.</Dialog.Description>
      </div>
      <figure className="vboard-frame">
        <video ref={v} src={MUSEUM_VIDEO} poster={MUSEUM_POSTER} playsInline controls preload="auto" />
      </figure>
    </div>
  );
}

// ---------------------------------------------------------------- Oberfläche

type Go = (to: Card | 'tool') => void;

function useStore(store: Store) { return useSyncExternalStore(store.sub, store.get); }

function TopBar({ store, go }: { store: Store; go: Go }) {
  const { mode } = useStore(store);
  const links: { label: string; de?: boolean; to: Card }[] = [
    { label: 'About & contact', to: 'about' },
    { label: 'Impressum', to: 'imprint', de: true },
    { label: 'Datenschutz', to: 'privacy', de: true },
  ];
  return (
    <header className={`vbar${mode === 'intro' ? ' quiet' : ''}`}>
      <button type="button" className="vbar-logo" onClick={() => go('well')} aria-label="SketchTo3D: how it works">
        <span className="vbar-word">Sketch<span>To</span>3D</span>
        <small>3D assets for film</small>
      </button>
      <nav className="vbar-nav" aria-label="Main">
        {links.map((l) => <button key={l.label} type="button" lang={l.de ? 'de' : undefined} onClick={() => go(l.to)}>{l.label}</button>)}
      </nav>
      {/* Schmale Bildschirme: dieselben Links im Radix-Dropdown */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger className="vbar-menu" aria-label="Menu"><Menu size={20} /></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="vmenu" align="end" sideOffset={8}>
            {links.map((l) => (
              <DropdownMenu.Item key={l.label} className="vmenu-item" lang={l.de ? 'de' : undefined}
                onSelect={() => go(l.to)}>{l.label}</DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}

function Overlay({ store, go, close, onJump }: { store: Store; go: Go; close: () => void; onJump: () => void }) {
  const { mode, card, shop, guide, far } = useStore(store);
  return (
    <>
      <TopBar store={store} go={go} />

      {/* Sprung-Button unten rechts: im Intro „Skip intro“; im Dorf nur, wenn man weit weg ist – als Pfeil, beim Überfahren klappt die Beschriftung auf */}
      {mode === 'intro'
        ? <button type="button" className="vjump" data-mode="intro" onClick={(e) => { e.stopPropagation(); onJump(); }}>Skip intro<ArrowRight size={16} aria-hidden /></button>
        : <button type="button" className={`vback${far ? ' on' : ''}`} aria-label="Back to the well" tabIndex={far ? 0 : -1}
            onClick={(e) => { e.stopPropagation(); onJump(); }}>
            <span className="vback-label">Back to the well</span><span className="vback-ico"><ArrowLeft size={18} aria-hidden /></span>
          </button>}

      {/* Steuerungshinweis unten mittig */}
      <div className={`vkeys${guide ? ' on' : ''}`} aria-hidden={!guide}>
        {touch
          ? <><span>Joystick: walk</span><span className="vkeys-sep" /><span>Swipe: look around</span></>
          : <><span className="vkeys-wasd"><kbd className="k-w">W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>walk</span>
              <span className="vkeys-sep" /><span className="vkeys-mouse" aria-hidden="true"><i /></span><span>drag to look around</span></>}
      </div>

      {/* Karten und Museum: ein Radix-Dialog (Fokusfalle, Escape, Klick daneben schließt) */}
      <Dialog.Root open={card !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="vveil" />
          <Dialog.Content className={card === 'museum' ? 'vdialog vdialog-museum' : card === 'well' ? 'vdialog vcard vcard-wide' : 'vdialog vcard'} aria-describedby={undefined}
            // Fokus auf die Karte selbst statt auf den Schließen-Knopf (sonst leuchtet beim Öffnen gleich der Fokusring)
            onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus({ preventScroll: true }); }}>
            {card === 'well' && <WellCard go={go} />}
            {card === 'about' && <AboutCard go={go} />}
            {card === 'imprint' && <ImprintCard />}
            {card === 'privacy' && <PrivacyCard />}
            {card === 'museum' && <Museum />}
            <Dialog.Close className="vcard-x" aria-label="Close"><Xmark size={20} /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Werkstatt (nur mit KI-Backend): Canvas im Vollbild-Dialog */}
      <Dialog.Root open={shop !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <Dialog.Portal>
          <Dialog.Content className="vshop" aria-describedby={undefined}>
            <div className="vshop-head">
              <Dialog.Title className="vshop-title">{shop === 'Workshop' || !shop ? 'Workshop' : `Workshop · ${shop}`}</Dialog.Title>
              <Dialog.Close className="vghost vghost-ink"><ArrowLeft size={16} aria-hidden />Back to the village</Dialog.Close>
            </div>
            {shop && <iframe className="vshop-frame" title="Workshop"
              src={`${TOOL_URL}?from=village&house=${encodeURIComponent(shop)}${PUBLIC_ROOM ? `&room=${PUBLIC_ROOM}` : ''}`} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export function createUI(opts: { onJump: () => void; onReplayIntro: () => void; onWell?: () => void; onOpenChange?: (open: boolean) => void; onTeam?: () => void; onMuseum?: () => void; claim?: ClaimVariant }): VillageUI {
  const store = createStore({ mode: 'intro', card: null, shop: null, guide: false, far: false });
  let wasOpen = false;
  store.sub(() => {
    const { card, shop } = store.get();
    const open = card !== null || shop !== null;
    if (open !== wasOpen) { wasOpen = open; opts.onOpenChange?.(open); }
  });

  // Name beim Überfahren: folgt dem Mauszeiger jedes Frame → bewusst ohne React
  const tip = document.createElement('div');
  tip.className = 'vtip';
  document.body.appendChild(tip);

  function openTool(house: string) {
    // Öffentliche Demo: das Werkzeug ist nicht frei benutzbar – stattdessen das Demo-Video zeigen
    if (DEMO) { store.set({ card: 'museum', shop: null }); return; }
    // Gehostete Seiten ohne iframe-Erlaubnis → normale Navigation (Canvas hat einen Zurück-Knopf)
    if (import.meta.env.VITE_TOOL_URL) {
      location.href = `${TOOL_URL}?from=village&house=${encodeURIComponent(house)}${PUBLIC_ROOM ? `&room=${PUBLIC_ROOM}` : ''}`;
      return;
    }
    store.set({ card: null, shop: house });
  }
  const go: Go = (to) => {
    if (to === 'tool') openTool('Workshop');
    else { if (to === 'well') opts.onWell?.(); store.set({ card: to, shop: null }); }
  };
  const close = () => store.set({ card: null, shop: null });
  // Museum gesehen (egal über welchen Weg) → Quest-Pfeil ist fertig
  store.sub(() => { if (store.get().card === 'museum') opts.onMuseum?.(); });

  const host = document.createElement('div');
  host.className = 'vui';
  document.body.appendChild(host);
  createRoot(host).render(<Overlay store={store} go={go} close={close} onJump={opts.onJump} />);

  let guideShown = false;
  const done = new Set<GuideKey>();

  return {
    setMode: (mode) => store.set({ mode }),
    setFar: (far) => { if (store.get().far !== far) store.set({ far }); },
    showHover(label, x = 0, y = 0) {
      if (!label) { tip.classList.remove('on'); return; }
      tip.textContent = label;
      tip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
      tip.classList.add('on');
    },
    openWell: () => go('well'),
    openTeam: () => opts.onTeam?.(),
    openMuseum: () => store.set({ card: 'museum', shop: null }),
    showGuide() {
      if (guideShown) return;
      guideShown = true;
      store.set({ guide: true });
      setTimeout(() => store.set({ guide: false }), 20000);
    },
    noteDone(k) {
      if (!guideShown) return;
      done.add(k);
      if (done.has('walk') && done.has('look')) store.set({ guide: false });
    },
    introClaim() { /* Claim-Headline im Intro entfernt */ },
    openTool,
    isOpen: () => { const s = store.get(); return s.card !== null || s.shop !== null; },
  };
}
