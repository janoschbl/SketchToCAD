# Base44-Prompt: SketchToCAD Landing Page (MVP)

Direkt in Base44 einfügen.

---

Build a single-page, production-grade launch website for **SketchToCAD**: a tool where you sketch in 2D on an infinite canvas and a custom real-time model builds an editable 3D model live next to it. Think "NVIDIA Canvas, but for 3D / CAD". Price anchor: ~€100 one-time (early-access price). The site must look like a €100,000 agency build: Linear / Vercel / Teenage Engineering / Apple-product-page level. Absolutely NOT generic "AI startup" slop.

## Look & feel
- Dark, near-black background (#0A0A0B), one single accent color: electric orange-red (#FF4D1F), used sparingly (CTA, sketch strokes, highlights). Everything else is off-white and grays.
- Typography: huge, tight, confident headlines (Inter Tight or Geist, weight 600, letter-spacing -0.03em). Mono (JetBrains Mono) for small technical labels like "01 / SKETCH", "REAL-TIME", "STEP · STL · OBJ".
- Lots of whitespace, 12-column grid, thin 1px hairline borders, subtle grain/noise overlay, blueprint-style fine grid in the hero background that fades out.
- Motion: smooth, physical, restrained. Scroll-linked animations (Framer Motion), sticky sections, parallax only where it adds meaning. 60fps. Respect prefers-reduced-motion.
- BANNED: purple/blue AI gradients, glowing orbs, robot/brain/sparkle icons, stock photos, emoji, "revolutionize / unleash / supercharge", generic 3-column icon cards, fake testimonials, fake logos.

## Hero (above the fold) – the wow moment
- Headline: **"Draw it. Get it in 3D."** Subline: "Sketch on an infinite canvas. A purpose-built model builds your 3D model live – and turns it into real, editable CAD."
- Right under it: a live **interactive demo** (see below), not a screenshot. The visitor can draw within 2 seconds.
- Two buttons: primary "Get early access – €99", secondary "Watch 30s demo". Small mono line below: "Runs in your browser · Export STEP / STL / OBJ".

## Interactive demo (most important part – build this properly)
Split view in a framed "app window" (rounded 16px, hairline border, soft shadow):
- **Left: 2D sketch canvas** (HTML canvas, pointer events). Visitor draws freehand strokes in the accent color on a dark grid. Minimal toolbar: Pen, Eraser, Undo, Clear.
- **Right: 3D viewport** (three.js / react-three-fiber) with a clean studio-lit, matte-clay material, soft shadows, slow orbit controls.
- Behavior: since no backend model is connected yet, the 3D side is **simulated convincingly**: 
  - Provide 4 one-click presets ("Chair", "Lamp", "Camera prop", "Spaceship hull") that auto-draw a sketch stroke by stroke (animated), while the 3D model grows live in sync (low-poly mesh morphing/assembling from the strokes, segment by segment).
  - When the visitor draws freely, derive a simple live 3D shape from their strokes (e.g. lathe/extrude/revolve of the drawn silhouette) so it feels real and responsive.
  - Show a toggle "Parts" that colors the model's segments individually (selectable parts) and a toggle "Wireframe".
  - A small mono status bar: "latency 42 ms · 1,284 tris · 6 parts".
- Be honest in a tiny caption under the demo: "Interactive preview – the real model is in early access." No fake claims.

## Sections (in this order)
1. **Hero + demo** (above).
2. **Problem / contrast**: big statement "Sketch tools are fast but flat. CAD is powerful but slow." Then a clean 4-column comparison table: Excalidraw / NVIDIA Canvas / Classic CAD / **SketchToCAD** with checkmarks (free canvas, real-time AI feedback, 3D output, parametric editing). SketchToCAD column highlighted.
3. **How it works** – 4 pinned scroll steps with a sticky visual that changes: 01 Sketch → 02 Live 3D → 03 Refine parts → 04 Export to CAD. Each step has a short headline, one sentence, and a looping mini-animation.
4. **Features** as a bento grid (asymmetric, not 3 equal cards): Live generation · Your sketch stays linked to the model (edit sketch → model updates) · Prompt + sketch + reference images combined · Selectable parts (segmentation) · Built for film & production props · Runs lightweight, no giant LLM · Export STEP/STL/OBJ. Each tile with a tiny looping visual, not an icon.
5. **Under the hood** (credibility for nerds): short section "Custom model, not a chatbot wrapper." Mention it's inspired by research like MeshPad (ICCV 2025, TUM) and NVIDIA Canvas, link to the paper: https://arxiv.org/abs/2503.01425. Keep it factual and modest.
6. **Use cases**: film props & set objects, product concepts, game assets, makers/3D printing. A horizontal scrolling strip of 3D turntable placeholders.
7. **Pricing**: one single card, centered. "Early Access – €99 one-time." Bullet list: lifetime updates for v1, all export formats, commercial use, founder Discord. Button "Reserve my spot". Under it: "Founding-member price, goes up at launch." Add a waitlist email form (store emails in Base44 database, show success state with a subtle confetti-free animation).
8. **FAQ** (accordion, 6 items): Does it run offline? Which formats? Is it parametric CAD? What hardware? When do I get access? Is my data private?
9. **Final CTA**: giant headline "Stop modeling. Start sketching." + email field + button.
10. **Footer**: minimal, GitHub link https://github.com/janoschbl/SketchToCAD, Impressum/Datenschutz links, language switch DE/EN.

## Copy rules
- Default language **German**, with working EN toggle. Tone: precise, confident, a bit dry. Short sentences. No hype words, no exclamation marks.
- Every claim must be something a builder could actually deliver; mark the product as "Early Access / in development" where relevant.

## Technical / quality bar
- React + Tailwind + Framer Motion + react-three-fiber. Fully responsive (mobile: demo works with touch, 3D viewport stacks under the canvas).
- Lighthouse performance > 90: lazy-load three.js, no layout shift, optimized fonts.
- Proper meta tags, Open Graph image (dark, with headline + accent sketch line), favicon (an orange pen-stroke forming a cube corner).
- Accessible: keyboard focus states, contrast AA, alt texts.
- Sticky slim navbar (logo wordmark "SketchToCAD" in mono + small orange dot, links: Demo, How, Pricing, FAQ, button "Early access") that gains a blur background on scroll.

Start by building the hero + interactive demo first and make it feel flawless, then the remaining sections.
