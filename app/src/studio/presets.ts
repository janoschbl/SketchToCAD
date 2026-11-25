// KI-Studio: Vorgaben pro Motiv. Sie sorgen dafür, dass Zeichnung, Prompt (Server: HINTS in server_local.py) und
// Animation zusammenpassen: Draufsicht, Symmetrie, Vorlage zum Nachzeichnen, passende Farben, Flug-Rig.
import { N } from './pad';

type Pt = [number, number];
export type GuideKind = 'wings' | 'elytra';
export type Preset = {
  /** Klassenname für den Server (Prompt-Hinweise) */
  name: string;
  en: string;
  /** Muster im Subject, das dieses Preset auswählt */
  match: RegExp;
  /** Spiegelachse (senkrecht) oder n-zählige Drehsymmetrie */
  mirror?: boolean;
  radial?: number;
  /** Hilfslinien zum Nachzeichnen (nur Vorlage, nicht Teil der Skizze) */
  guide: () => Pt[][];
  /** Standardfarben dieses Motivs für den KI-Stift (Hinweis in der Zeichenfläche) */
  colors: string[];
  tip: string;
  /** Beispiele für „Ask AI“ */
  ideas: string[];
  /** Animation im 3D-Fenster */
  fly?: GuideKind;
};

const mirrorX = (g: Pt[]): Pt[] => g.map(([x, y]) => [N - x, y]);
const both = (g: Pt[]): Pt[][] => [g, mirrorX(g)];
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = (2 * Math.PI * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt; });
/** Chaikin-Glättung: eckige Stützpunkte → weiche Kontur */
function smooth(p: Pt[], closed = true, it = 3): Pt[] {
  let a = p;
  for (let k = 0; k < it; k++) {
    const o: Pt[] = [];
    const n = a.length, last = closed ? n : n - 1;
    if (!closed) o.push(a[0]);
    for (let i = 0; i < last; i++) {
      const [x0, y0] = a[i], [x1, y1] = a[(i + 1) % n];
      o.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    if (!closed) o.push(a[n - 1]);
    a = o;
  }
  return closed ? [...a, a[0]] : a;
}

function butterflyGuide(): Pt[][] {
  const fore: Pt[] = [[266, 238], [305, 165], [385, 95], [458, 78], [474, 130], [440, 212], [360, 262], [268, 262]];
  const hind: Pt[] = [[268, 272], [362, 282], [425, 335], [404, 408], [340, 436], [290, 384], [268, 330]];
  return [
    ...both(smooth(fore)), ...both(smooth(hind)),
    ellipse(256, 262, 11, 92),
    ...both(smooth([[250, 176], [232, 132], [214, 96]], false, 2)),
  ];
}

function ladybugGuide(): Pt[][] {
  const spots = [[196, 262, 22], [316, 262, 22], [182, 352, 24], [330, 352, 24], [222, 420, 18], [290, 420, 18]];
  const legs: Pt[] = [[134, 262], [88, 240]], legs2: Pt[] = [[128, 318], [76, 326]], legs3: Pt[] = [[146, 384], [104, 420]];
  return [
    ellipse(256, 302, 132, 152),                  // Flügeldecken (Rundkuppel)
    ellipse(256, 128, 58, 36),                    // Kopf
    smooth([[196, 168], [256, 150], [316, 168], [326, 196], [256, 206], [186, 196]]), // Halsschild
    [[256, 206], [256, 454]],                     // Mittelnaht zwischen den Decken
    ...spots.map(([x, y, r]) => ellipse(x, y, r, r, 24)),
    ...both(smooth([[236, 106], [220, 70], [206, 46]], false, 2)),
    ...[legs, legs2, legs3].flatMap((l) => both(l)),
  ];
}

function starfishGuide(): Pt[][] {
  const R = 214, r0 = 52, tipAngles = [0, 1, 2, 3, 4].map((k) => -Math.PI / 2 + (k * 2 * Math.PI) / 5);
  const out: Pt[] = [];
  for (let i = 0; i < 160; i++) {
    const a = -Math.PI / 2 + (i / 160) * 2 * Math.PI;
    const r = r0 + (R - r0) * Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 3.4);
    out.push([N / 2 + r * Math.cos(a), N / 2 + r * Math.sin(a)]);
  }
  out.push(out[0]);
  const grooves: Pt[][] = tipAngles.map((a) => [[N / 2 + 20 * Math.cos(a), N / 2 + 20 * Math.sin(a)], [N / 2 + 0.82 * R * Math.cos(a), N / 2 + 0.82 * R * Math.sin(a)]]);
  return [out, ...grooves, ellipse(N / 2, N / 2, 18, 18, 24)];
}

export const PRESETS: Preset[] = [
  {
    name: 'butterfly', en: 'Butterfly', match: /butterfl|moth|schmetterling|falter/i, mirror: true, guide: butterflyGuide,
    colors: ['#f08c14', '#1f5fe0', '#000000'], fly: 'wings',
    ideas: ['Make the wing pattern blue and green, mostly blue', 'Body dark brown', 'Wings purple with a bit of pink'],
    tip: 'Top view, wings open. Draw one side, the mirror does the rest.',
  },
  {
    name: 'ladybug', en: 'Ladybug', match: /ladybug|ladybird|lady ?bug|marienk/i, mirror: true, guide: ladybugGuide,
    colors: ['#e02020', '#000000', '#ffffff'], fly: 'elytra',
    ideas: ['Shell orange with black spots', 'Head and pronotum black', 'Make the shell yellow'],
    tip: 'Top view: red shell with black spots, dark head. Draw one half, the mirror does the rest.',
  },
  {
    name: 'starfish', en: 'Starfish', match: /starfish|sea ?star|seestern/i, radial: 5, guide: starfishGuide,
    colors: ['#f08c14', '#e02020', '#f0d828'],
    ideas: ['Make it purple with pink dots', 'Arms orange, center red', 'Make it bright red'],
    tip: 'Top view, five arms. Draw one arm, it is repeated five times around the center.',
  },
];

export const presetFor = (subject: string): Preset | undefined => PRESETS.find((p) => p.match.test(subject));
