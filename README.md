# SketchToCAD

> Zeichne in 2D auf einem unendlichen Canvas – ein selbst trainiertes Echtzeit-Modell baut daraus live ein 3D-Modell, das du anschließend wie in einem CAD-Programm weiterbearbeitest.

**Repository:** <https://github.com/janoschbl/SketchToCAD>

**Status:** 💡 Ideen- und Konzeptphase. Es gibt noch keinen Code. Dieses Dokument hält Vision, Recherche und einen ersten Plan fest.

---

## Idee

Heute gibt es zwei getrennte Welten:

- **Skizzen-Tools** wie [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT-Lizenz): schnell, intuitiv, ein großer freier Canvas – aber nur 2D.
- **CAD-Programme**: mächtig und präzise, aber mit hoher Einstiegshürde, weil man Features, Constraints und Parameter von Hand aufbauen muss.

**SketchToCAD** verbindet beides. Das Vorbild für die Interaktion ist [NVIDIA Canvas](https://blogs.nvidia.com/blog/2021/06/23/studio-canvas-app) (früher GauGAN): Dort verwandeln einfache Pinselstriche in Echtzeit ein realistisches Landschaftsbild. Wir übertragen dieses Prinzip von **2D-Skizze → 2D-Bild** auf **2D-Skizze → 3D-Modell**.

### Kernablauf

1. **Zeichnen:** Nutzer:innen skizzieren auf einem Excalidraw-artigen Canvas (Striche, Formen, Radieren, Verschieben).
2. **Live-Generierung:** Ein eigenes, selbst trainiertes Modell erzeugt bei jeder Änderung der Skizze in Echtzeit bzw. interaktiver Geschwindigkeit ein 3D-Modell, das neben dem Canvas angezeigt wird.
3. **Iterieren:** Striche ergänzen oder löschen → das 3D-Modell passt sich inkrementell an (kein Neustart von null).
4. **CAD-Weiterbearbeitung:** Das 3D-Modell wird in eine editierbare CAD-Darstellung überführt (Primitive, Skizzen + Extrusionen, Maße, Constraints), auf der man wie in einem klassischen CAD-Programm weiterbaut – aber ausgehend von einfachen Zeichnungen.
5. **Export:** Standardformate (z. B. STEP/STL/OBJ).

### Geplante Features

- **Für Film-/Produktions-Assets, nicht nur „ein kleines Modell“:** Das Ziel sind Objekte im Bezug auf Filme (Props, Set-Objekte), nicht ein einzelnes Spielzeugmodell.
- **Die Skizze bleibt erhalten:** Skizze → Modell, aber die Skizze wird nicht verworfen. Sie bleibt als Quelle und Steuerung am Modell, Änderungen an der Skizze wirken auf das Modell.
- **Hybrides Eingabesystem:** Prompt, Skizze und Referenzbilder lassen sich kombinieren.
- **Großer Canvas mit Toolpalette** (Auswahl, Hand, Formen, Pfeil, Linie, Stift, Text, Notiz, Radierer – wie bei Excalidraw).
- **Einzelteilbearbeitung / Segmentierung:** Das Modell besteht aus einzeln auswählbaren und editierbaren Teilen.
- **Kein großes LLM als Kern:** Statt eines allgemeinen LLM soll ein eigenes, kleineres Transformer-Modell laufen, ähnlich wie NVIDIA Canvas für Bilder (schnell, spezialisiert, lokal ausführbar).

### Abgrenzung

| | Excalidraw | NVIDIA Canvas | Klassisches CAD | **SketchToCAD** |
|---|---|---|---|---|
| Freier Skizzen-Canvas | ✅ | ✅ (Pinsel) | ❌ | ✅ |
| KI-Echtzeit-Feedback | ❌ | ✅ (2D-Bild) | ❌ | ✅ (3D-Modell) |
| 3D-Ausgabe | ❌ | ❌ | ✅ | ✅ |
| Parametrisch editierbar | ❌ | ❌ | ✅ | ✅ (Ziel) |

### Abgrenzung zu Mule Create und die Frage „Mule als Basis?“

[Mule Create](https://github.com/felixbfx/MuleCreate) ist ein verwandtes, aber anderes Produkt. Die folgende Einordnung stammt aus einer Code-Analyse des Repos (Stand der Recherche, Alpha-Version).

| | Mule Create | SketchToCAD |
|---|---|---|
| Zeichenfläche | 3D-Viewport: Striche auf Ebenen/Flächen im Raum | Großer 2D-Canvas mit Toolpalette (Excalidraw-artig) |
| KI | Externes Agenten-LLM baut nach dem Export (Sketch Brief) in Blender/Houdini nach | Eigenes, kleines Modell generiert live im Editor |
| Skizze ↔ Modell | Export als statische Szene/Brief | Skizze bleibt am Modell verknüpft, Änderungen wirken live |
| Teile | Punkte/Kanten/Flächen manuell editieren | Segmentierte Einzelteile eines generierten Modells |
| Plattform | Desktop (Python, Qt/PySide6, OpenGL 3.3) | Web-first (Ziel) |
| Lizenz | GPL-3.0 | offen |

**Technischer Befund zu Mule:** Python-Anwendung mit ca. 50.000 Zeilen Code, Qt-Oberfläche, eigener ModernGL-Renderer, Szenen als JSON (`.mule`), USD-Export und ein lokaler MCP-Server. Es gibt keine ML-Inferenz im Projekt und keinen 2D-Infinite-Canvas als Hauptfläche. Live-Updates, stabile Teile-IDs und die Skizze-Modell-Verknüpfung müssten komplett neu gebaut werden.

**Kann man Mule als Basis nehmen?** Die Analyse empfiehlt: **eher nein, als Referenz ja.**
- Die **GPL-3.0** würde jedes abgeleitete, verteilte Produkt ebenfalls unter GPL-3.0 stellen (Quellcode offenlegen). Das ist nur dann ok, wenn SketchToCAD ohnehin Open Source unter GPL sein soll. Für eine kommerzielle Nutzung bitte rechtlich prüfen lassen.
- Die **Architektur passt nicht**: Desktop-Qt statt Web, 3D-Zeichnen statt 2D-Canvas, Handoff an externe Agenten statt Live-Inferenz.
- **Sinnvoll zu übernehmen sind Ideen, nicht Code:** Brief-Export für KI-Agenten, USD als Austauschformat, MCP-Schnittstelle zum Steuern per Agent, Referenzbilder/Notizen am Objekt.
- **Empfohlener Weg:** neue Web-App mit Excalidraw (MIT) oder tldraw (Lizenz prüfen) für den Canvas, three.js für die 3D-Ansicht und ein separater Inferenz-Dienst für das eigene Modell.

---

## Forschungsstand und Quellen

### MeshPad – wichtigster Referenzpunkt

**MeshPad: Interactive Sketch-Conditioned Artist-Reminiscent Mesh Generation and Editing** (ICCV 2025; Technische Universität München und AUDI AG).
Autor:innen: Haoxuan Li, Ziya Erkoç, Lei Li, Daniele Sirigatti, Vladislav Rosov, Angela Dai, Matthias Nießner.

- 📄 Paper: [arXiv:2503.01425](https://arxiv.org/abs/2503.01425) · [ICCV 2025 Open Access](https://openaccess.thecvf.com/content/ICCV2025/html/Li_MeshPad_Interactive_Sketch-Conditioned_Artist-Reminiscent_Mesh_Generation_and_Editing_ICCV_2025_paper.html)
- 🌐 Projektseite: <https://derkleineli.github.io/meshpad>
- 💻 Code: <https://github.com/DerKleineLi/meshpad-release> (Lizenz: *Automotive Development Public Non-Commercial License v1.0* – also nicht-kommerziell; vor einer Wiederverwendung die Lizenz im Detail prüfen)

Was MeshPad macht:

- Erzeugt **Dreiecks-Meshes** aus Skizzeneingaben und erlaubt **iteratives Editieren**.
- Zerlegt das Editieren in zwei Operationen: **Löschen** (Mesh-Bereiche zu radierten Strichen entfernen, per Token-Klassifikation) und **Hinzufügen** (neue Geometrie zu neuen Strichen, autoregressiv).
- Nutzt eine **vertex-aligned speculative prediction**, damit ein Editierschritt nur **wenige Sekunden** dauert.
- Berichtete Ergebnisse: über 22 % bessere Chamfer-Distanz gegenüber früheren skizzenbasierten Mesh-Methoden und 90 % Präferenz in einer Nutzerstudie.

**Relevanz für uns:** MeshPad zeigt, dass skizzenbasiertes, *inkrementelles* 3D-Editieren machbar ist. Es liefert aber ein **Mesh** und keine parametrische CAD-Datei, und „wenige Sekunden“ ist noch nicht echtes Echtzeit. Genau diese beiden Lücken wollen wir adressieren.

### Weitere relevante Arbeiten

| Arbeit | Worum geht es | Link |
|---|---|---|
| **Sketch2CAD** (2020) | Sequenzielles CAD-Modellieren durch Skizzieren im Kontext des bestehenden Modells | [arXiv:2009.04927](https://arxiv.org/pdf/2009.04927) |
| **CADrawer** (Eurographics) | Autoregressive Generierung von CAD-Programmen aus 3D-Skizzen | [EG Digital Library](https://diglib.eg.org/items/e8d37226-58fe-4b8f-a878-6efba31c5ba6) |
| **CadVLM** | Vision-Language-Modell zur Generierung parametrischer CAD-Skizzen | [arXiv:2409.17457](https://arxiv.org/pdf/2409.17457) |
| **SketchDream** | Skizzenbasierte Text-zu-3D-Generierung und -Bearbeitung | [arXiv:2405.06461](https://arxiv.org/pdf/2405.06461) |
| **VRSketch2Shape** (Dez. 2025) | 3D-Formgenerierung aus sequenziellen VR-Skizzen mit Diffusion | [arXiv:2512.04761](https://arxiv.org/pdf/2512.04761v2) |
| **VRsketch2Gaussian** | VR-Skizze + Text → 3D-Objekt als Gaussian Splats | [arXiv:2503.12383](https://arxiv.org/html/2503.12383v1) |
| **Multimodale XR-Pipeline Skizze → Mesh** | Mesh in unter ca. 20 s via Multi-View-Bilddiffusion plus Rekonstruktion | [arXiv:2412.09008](https://web3.arxiv.org/pdf/2412.09008) |
| **Sketch123** (2025) | Zweistufige Diffusion mit Multi-Spectral-Channel-Cross-Attention für skizzenbasierte 3D-Generierung | [Projektseite](https://yongjinliu.github.io//publication/2025-Sketch123_Multi-spectral_channel_cross_attention_for_sketch-based_3D_generation_via_diffusion_models) |

### UI- und Interaktionsvorbilder

- [Excalidraw](https://github.com/excalidraw/excalidraw) – „Virtual whiteboard for sketching hand-drawn like diagrams“ (MIT). Kandidat als Canvas-Basis oder Referenz.
- [NVIDIA Canvas](https://blogs.nvidia.com/blog/2021/06/23/studio-canvas-app) / [GauGAN-Hintergrund](https://blogs.nvidia.com/blog/ai-decoded-gan-canvas-app) – Echtzeit-Feedback beim Zeichnen als Interaktionsparadigma.

> Hinweis zur Recherche: Ein Modell, das strikt in Echtzeit aus 2D-Skizzen 3D-Modelle erzeugt, haben wir in der ersten Suche nicht gefunden. Die Ergebnisse oben sind die nächsten Verwandten. Die Liste ist ein Startpunkt und noch nicht vollständig.

---

## Erweiterte Literaturübersicht

Diese Sektion wurde von mehreren parallelen Recherche-Läufen zusammengetragen. Aufgenommen sind nur Quellen mit funktionierendem Link; Lizenzen und Geschwindigkeitsangaben stehen nur dort, wo die Quelle sie nennt. **Lizenzen und Latenzen vor einer Entscheidung immer selbst nachprüfen.**

### 1. Sketch-to-3D (Skizze → 3D-Form)

| Arbeit | Jahr / Venue | Repräsentation | Relevanz für uns |
|---|---|---|---|
| [Sketch2Model](https://cg.cs.tsinghua.edu.cn/papers/CVPR-2021-Sketch2Model.pdf) | CVPR 2021 | Mesh aus einer Freihandskizze, view-aware | Behandelt die Blickwinkel-Mehrdeutigkeit explizit; Nutzer:in kann die Ansicht vorgeben |
| [Sketch2Mesh](https://openaccess.thecvf.com/content/ICCV2021/papers/Guillard_Sketch2Mesh_Reconstructing_and_Editing_3D_Shapes_From_Sketches_ICCV_2021_paper.pdf) | ICCV 2021 | Latenter Shape-Code → Mesh, differenzierbare Projektion | Konturen aus Strichen anpassen und Form per Strichen editieren (Link war beim Prüfen nicht abrufbar, bitte manuell prüfen) |
| [SENS](https://arxiv.org/abs/2306.06088) | arXiv 2023 | Part-aware implizites Feld, Transformer-Decoder | Teile einzeln editieren und neu generieren statt alles neu zu bauen |
| [Doodle Your 3D](https://arxiv.org/abs/2312.04043) | CVPR 2024 | Niedrigdimensionaler impliziter Shape-Raum, part-level | Abstrakte Kritzeleien → präzise Formen; geringer Rechenaufwand |
| [Deep3DSketch-im](https://doi.org/10.1631/FITEE.2300314) | FITEE 2024 | SDF | „Rapid“ im Titel, keine verifizierte Latenzzahl |
| [Sketch2NeRF](https://arxiv.org/abs/2401.14257) | arXiv 2024 | NeRF per Optimierung | Multi-View-Skizzen + Text; Optimierung pro Szene, nicht live-tauglich |
| [Sketch3D](https://arxiv.org/abs/2404.01843) | arXiv 2024 | 3D Gaussian Splatting | Stilkonsistent; mehrstufig, eher asynchron |
| [S3D: Sketch-Driven 3D Model Generation](https://arxiv.org/abs/2505.04185) | CVPR-Workshop 2025 | Segmentierungsmasken → 3D-Modul | Kompakte Feed-forward-Architektur |
| [3D VR Sketch Guided 3D Shape Prototyping](https://arxiv.org/abs/2306.10830) | ICCV 2023 | Latenter Normalizing-Flow-Prior | 3D-Striche im Raum; liefert mehrere Kandidaten |
| [Reality3DSketch](https://arxiv.org/abs/2310.18148) | IEEE TMM 2023 | Neuronale 3D-Vorhersage + Posenschätzung | AR-Platzierung; „>5× schneller“ bezieht sich auf Nutzeraufgabe, nicht Modell-Latenz |
| [Freehand Sketch-Based 3D Reconstruction with Contour Constraints](https://doi.org/10.1145/3756884.3766043) | VRST 2025 | Mesh mit Konturbedingungen | Synthetische Handzeichnungs-Striche aus Meshes (nützlich fürs Training) |
| [3D Reconstruction from Sketches](https://arxiv.org/abs/2505.14621) | arXiv 2025 | Stitching → CycleGAN → Tiefenschätzung | Modulare Baseline; Autor:innen nennen Generalisierungsgrenzen |
| [Order Matters: 3D Shape Generation from Sequential VR Sketches](https://arxiv.org/abs/2512.04761) | arXiv 2025 | Diffusion mit reihenfolgebewusster Strichcodierung | Strichreihenfolge als Signal – passt zu inkrementellem Zeichnen |
| [Sketch-to-Multi-View](https://ahmedbourouis.github.io/S2MV/) | 2026 | Konsistente Mehransichten in einem Forward-Pass | Code laut Projektseite „coming soon“; Ausgabe sind Bilder, kein 3D |
| [3D Shape Reconstruction from Sketches via Multi-view CNNs](https://kalo-ai.github.io/papers/SketchModeling/sketch_modeling.pdf) | 2017 | Punktwolke | Historische Baseline |

Weitere Hinweise, im Detail noch nicht verifiziert (Behauptungen stammen aus den verlinkten Seiten/Suchtreffern):
[MSU-3D](https://www.sciencedirect.com/science/article/pii/S0957417425033639) · [SketchFormer3D](https://www.sciencedirect.com/science/article/pii/S0957417425035468) · [Magic3DSketch](https://www.sciencedirect.com/science/article/pii/S0925231225025974) (behauptet >100 FPS – Messbedingungen unklar) · [Sketch-A-Shape](https://damassets.autodesk.net/content/dam/autodesk/www/pdfs/sketch-a-shape.pdf) (zero-shot) · [CanvasDream](https://doi.org/10.1111/cgf.70504)

### 2. CAD-Generierung, parametrisches CAD und 3D→CAD

**Konstruktionssequenzen (Sketch + Extrude) und Datensätze**

| Arbeit | Jahr / Venue | Link | Repräsentation / Relevanz |
|---|---|---|---|
| DeepCAD | ICCV 2021 | [Projekt](https://www.cs.columbia.edu/cg/deepcad/index.html) · [Code](https://github.com/ChrisWu1997/DeepCAD) | Tokenisierte Sketch/Extrude-Sequenzen; erstes großes generatives Modell mit Modellierungshistorie |
| Fusion 360 Gallery | SIGGRAPH/TOG 2021 | [Paper](https://arxiv.org/abs/2010.02392) · [Repo](https://github.com/AutodeskAILab/Fusion360GalleryDataset) | Menschliche Konstruktionssequenzen + Gym-Umgebung; Nutzungsbedingungen je Teilmenge prüfen |
| SkexGen | ICML 2022 | [Paper](https://proceedings.mlr.press/v162/xu22k.html) · [Code](https://github.com/samxuxiang/SkexGen) | Getrennte Codebücher für Topologie, Geometrie, Extrusion |
| HNC-CAD | ICML 2023 | [Paper](https://arxiv.org/abs/2307.09425) · [Code](https://github.com/samxuxiang/hnc-cad) | Hierarchische diskrete Codes; grob-zu-fein-Kontrolle |
| Text2CAD | NeurIPS 2024 | [Paper](https://arxiv.org/abs/2409.17106) · [Code](https://github.com/SadilKhan/Text2CAD) | Text → CAD-Sequenz (ca. 170K Modelle, 660K Anweisungen) |
| SketchGraphs | 2020 | [Paper](https://arxiv.org/abs/2007.08506) · [Daten](https://github.com/PrincetonLIPS/SketchGraphs) | 15M 2D-Skizzen als Primitive + Constraint-Graph; wichtig für „Striche → lösbare Skizze“ |
| ABC Dataset | CVPR 2019 | [Seite](https://deep-geometry.github.io/abc-dataset/) | 1M CAD-Modelle mit analytischen Kurven/Flächen (STEP, Mesh) |
| Sketch2CAD | SIGGRAPH Asia 2020 | [Paper](https://arxiv.org/abs/2009.04927) · [Projekt](https://geometry.cs.ucl.ac.uk/projects/2020/sketch2cad/) | Sequenzielles CAD durch Skizzieren im Kontext – inhaltlich unser nächster Verwandter |
| CADrawer | Eurographics | [Eintrag](https://diglib.eg.org/items/e8d37226-58fe-4b8f-a878-6efba31c5ba6) | CAD-Programme aus 3D-Skizzen, autoregressiv |
| CadVLM | 2024 | [Paper](https://arxiv.org/pdf/2409.17457) | Parametrische CAD-Skizzen mit Vision-Language-Modell |

**Rekonstruktion aus Punktwolken / B-Rep-Generierung / Code**

| Arbeit | Jahr / Venue | Link | Repräsentation / Relevanz |
|---|---|---|---|
| Point2CAD | CVPR 2024 | [Paper](https://openaccess.thecvf.com/content/CVPR2024/html/Liu_Point2CAD_Reverse_Engineering_CAD_Models_from_3D_Point_Clouds_CVPR_2024_paper.html) · [Code](https://github.com/THLsword/Point2CAD) | Punktwolke → editierbare Feature-Historie |
| CAD-Recode | ICCV 2025 | [Paper](https://openaccess.thecvf.com/content/ICCV2025/html/Rukhovich_CAD-Recode_Reverse_Engineering_CAD_Code_from_Point_Clouds_ICCV_2025_paper.html) · [Projekt](https://cad-recode.github.io/) · [Code](https://github.com/filaPro/cad-recode) | Ausführbarer CadQuery-Python-Code; interpretierbar und per LLM editierbar |
| PCD2CAD | 2026 | [Daten](https://zenodo.org/records/21623298) · [Code](https://github.com/saidharb/Point-Cloud-Reconstruction) | Punktwolken mit DeepCAD-artigen Sequenzen |
| BrepGen | ACM TOG 2024 | [Projekt](https://brepgen.github.io/) · [Code](https://github.com/samxuxiang/BrepGen) | Diffusion direkt auf B-Rep (Flächen/Kanten/Vertices) |
| SolidGen | ICML 2022 | [Paper](https://arxiv.org/abs/2203.13944) · [Code](https://github.com/AutodeskAILab/SolidGen) | Autoregressive B-Rep-Solids |
| BrepNet | CVPR 2021 | [Paper](https://arxiv.org/abs/2104.00706) · [Code](https://github.com/AutodeskAILab/BRepNet) | Topologisches Message-Passing auf B-Rep (Erkennung/Encoder) |
| CSGNet | CVPR 2018 | [Projekt](https://hippogriff.github.io/CSGNet/) | Programmrückgewinnung als CSG-Baum |
| JoinABLe | 2021 | [Paper](https://arxiv.org/abs/2111.12772) | Parametrische Baugruppen/Gelenke |
| [CadQuery](https://github.com/CadQuery/cadquery) (Apache-2.0) · [OpenSCAD](https://github.com/openscad/openscad) (GPL-2.0) | – | – | Skriptbasierte CAD-Ausgabeformate, deterministisch und gut für LLM-Ausgabe |

**Erkenntnisse für uns:** Statt eines Dreiecks-Meshes sollte das Ziel eine **Feature-Historie oder ein ausführbares CAD-Programm** sein (DeepCAD, Text2CAD, CAD-Recode). Skizzenstriche sollten zu Primitiven geparst, mit Constraints versehen und gelöst werden, Maße werden zu editierbaren Parametern (SketchGraphs). Nach jedem Schritt ausführen und validieren; stabile Feature-IDs behalten.

### 3. Mesh-Generierung und 3D-Foundation-Modelle (mögliche Backbones)

**Autoregressive Mesh-Modelle**

| Arbeit | Jahr / Venue | Link | Anmerkung |
|---|---|---|---|
| PolyGen | ICML 2020 | [Paper](https://arxiv.org/abs/2002.10880) · [Code](https://github.com/google-deepmind/deepmind-research/tree/master/polygen) | Erst Vertices, dann Faces; lange serielle Sequenzen |
| MeshGPT | ICLR 2024 | [Paper](https://arxiv.org/abs/2311.15475) · [Projekt](https://nihalsid.github.io/mesh-gpt/) · [Code](https://github.com/nihalsid/mesh-gpt) | VQ-tokenisierte Dreiecke, Decoder-only |
| MeshXL | NeurIPS 2024 | [Paper](https://arxiv.org/abs/2405.20853) · [Projekt](https://meshxl.org/) | Neuronales Koordinatenfeld |
| MeshAnything | 2024 | [Paper](https://arxiv.org/abs/2406.10163) · [Code](https://github.com/buaacyw/MeshAnything) | Form → künstlerische Topologie; denkbar als asynchrones Retopo |
| LLaMA-Mesh | 2024 | [Paper](https://arxiv.org/abs/2411.09595) · [Code](https://github.com/nv-tlabs/LLaMA-Mesh) | Mesh als LLM-Token-Ausgabe |
| MeshLLM | ICCV 2025 | [Paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Fang_MeshLLM_Empowering_Large_Language_Models_to_Progressively_Understand_and_Generate_ICCV_2025_paper.pdf) | Progressives Verstehen/Generieren |
| BPT | CVPR 2025 | [Paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Weng_Scaling_Mesh_Generation_via_Compressive_Tokenization_CVPR_2025_paper.pdf) | Kompressive Tokenisierung – weniger Decodier-Schritte |

Nur namentlich bekannt, Quellenlinks noch zu verifizieren: MeshAnything V2, PivotMesh, EdgeRunner, Meshtron (NVIDIA), FreeMesh, DeepMesh.

**Native 3D-Latent-Diffusion und Feed-forward-Rekonstruktion**

| Arbeit | Jahr / Venue | Link | Geschwindigkeit / Lizenz laut Quelle |
|---|---|---|---|
| 3DShape2VecSet | CVPR 2023 | [Paper](https://arxiv.org/abs/2301.11445) · [Code](https://github.com/1zb/3DShape2VecSet) | – |
| Michelangelo | NeurIPS 2023 | [Paper](https://arxiv.org/abs/2306.17115) | Gemeinsamer Bild-Text-Shape-Latent |
| CLAY | SIGGRAPH 2024 | [Paper](https://arxiv.org/abs/2406.13897) · [Code](https://github.com/CLAY-3D/CLAY) | Mehrere Bedingungen (Text, Bild, Punktwolke, Voxel) |
| TRELLIS | CVPR 2025 | [Paper](https://arxiv.org/abs/2412.01506) · [Code](https://github.com/microsoft/TRELLIS) | Strukturierte sparse Latents; Gewichts-Lizenz prüfen |
| Hunyuan3D 2.0 | 2025 | [Paper](https://arxiv.org/abs/2501.12202) · [Code](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | Tencent Hunyuan Community License (Einschränkungen prüfen) |
| Direct3D | 2024 | [Paper](https://arxiv.org/abs/2405.14832) · [Code](https://github.com/Stable-X/Direct3D) | – |
| Step1X-3D | 2025 | [Code](https://github.com/stepfun-ai/Step1X-3D) | Lizenz zu prüfen |
| Instant3D | 2023 | [Paper](https://arxiv.org/abs/2311.06214) · [Projekt](https://instant-3d.github.io/) | Schnell, genaue Zeit nicht verifiziert |
| LRM | 2023 | [Paper](https://arxiv.org/abs/2311.04400) · [Projekt](https://yiconghong.me/LRM) | ca. 5 s laut Quelle |
| OpenLRM | – | [Code](https://github.com/3DTopia/OpenLRM) | Offene LRM-Reproduktion |
| TripoSR | 2024 | [Paper](https://arxiv.org/abs/2403.02151) · [Code](https://github.com/VAST-AI-Research/TripoSR) | < 0,5 s laut Quelle; MIT – bester Referenzwert für eine schnelle Vorschau |
| InstantMesh | 2024 | [Paper](https://arxiv.org/abs/2404.07191) · [Code](https://github.com/TencentARC/InstantMesh) | < 10 s laut Quelle |
| Instructive3D | 2025 | [Paper](https://arxiv.org/abs/2501.04374) | Text-Edits im 3D-Latent |
| InstaInpaint | 2025 | [Paper](https://arxiv.org/abs/2506.10980) · [Projekt](https://dhmbb2.github.io/InstaInpaint_page/) | 0,4 s laut Quelle; lokale 3D-Reparatur aus 2D-Edit |

**Beschleunigungstechniken:** [Speculative Decoding](https://arxiv.org/abs/2211.17192) (auch von MeshPad genutzt, dort als „vertex-aligned speculative prediction“), [KV-Cache](https://huggingface.co/docs/transformers/kv_cache), kompressive Mesh-Tokenisierung (BPT).

**Erkenntnisse für uns:** Eine strikt live, strichweise streamende Mesh-Generierung haben die Recherche-Läufe nicht gefunden. Praktisch heißt das eine **Grob-zu-fein-Pipeline**: schnelle Feed-forward-Vorschau (TripoSR-Klasse) sofort, Topologie-Bereinigung und CAD-Fitting asynchron. Das Hauptmanko fast aller Modelle: Sie nehmen Bilder, Text oder Punktwolken, **keine Skizzenstriche** – ein eigener Strich-Encoder muss trainiert werden.

### 4. Echtzeit-Zeichen-KI, Datensätze, Produkte, Web-Bausteine

**Echtzeit-Skizze→Bild und Beschleunigung**

[NVIDIA Canvas](https://www.nvidia.com/en-eu/studio/canvas.html) · [GauGAN/SPADE](https://nvlabs.github.io/SPADE/) · [pix2pix](https://phillipi.github.io/pix2pix/) · [StreamDiffusion](https://github.com/cumulo-autumn/StreamDiffusion) ([ICCV-2025-Paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Kodaira_StreamDiffusion_A_Pipeline-level_Solution_for_Real-Time_Interactive_Generation_ICCV_2025_paper.pdf)) · [StreamDiffusionV2](https://streamdiffusionv2.github.io/) · [Latent Consistency Models](https://arxiv.org/abs/2310.04378) (2–4 Schritte) · [LCM-LoRA](https://arxiv.org/abs/2311.05556) · [Consistency Models](https://arxiv.org/abs/2303.01469) · [SDXL-Turbo](https://huggingface.co/stabilityai/sdxl-turbo) · [ControlNet](https://github.com/lllyasviel/ControlNet) · [T2I-Adapter](https://github.com/TencentARC/T2I-Adapter) · [tldraw „Make Real“](https://www.tldraw.com/blog/make-real) · [Krea Realtime](https://www.krea.ai/realtime) · [Scribble Diffusion](https://scribblediffusion.com/)

**Datensätze für Training und synthetische Skizzen** (Lizenz je Datensatz/Asset prüfen!)

| Datensatz | Inhalt | Lizenzhinweis laut Recherche |
|---|---|---|
| [ShapeNet](https://shapenet.org/) | Große kategorisierte 3D-Sammlung | Registrierung; keine pauschale kommerzielle Lizenz |
| [ShapeNet-Sketch](https://github.com/benjamin-li/ShapeNet-Sketch) | Skizzen zu 3D-Kategorien | Repo-Bedingungen prüfen |
| [ModelNet](https://modelnet.cs.princeton.edu/) | CAD-Meshes (10/40 Klassen) | Forschungsdatensatz |
| [Objaverse](https://objaverse.allenai.org/docs/objaverse-1.0/) · [Objaverse-XL](https://github.com/allenai/objaverse-xl) | 800K+ bzw. 10M+ Assets | Index ODC-By; **pro Objekt unterschiedliche Lizenzen** |
| [ABC](https://deep-geometry.github.io/abc-dataset/) | 1M CAD-Modelle | Kein pauschal permissiver Grant |
| [DeepCAD](https://github.com/ChrisWu1997/DeepCAD) | 178K parametrische Sequenzen | Laut Recherche MIT, Quellbedingungen prüfen |
| [Fusion 360 Gallery](https://github.com/AutodeskAILab/Fusion360GalleryDataset) | 8.625 Konstruktionssequenzen | Laut Recherche nur nicht-kommerzielle Forschung |
| [Thingi10K](https://ten-thousand-models.appspot.com/) | 10K Druckmodelle | Lizenz je Modell |
| [SketchGraphs](https://github.com/PrincetonLIPS/SketchGraphs) | Parametrische CAD-Skizzen + Constraints | Bedingungen prüfen |
| [Quick, Draw!](https://github.com/googlecreativelab/quickdraw-dataset) | Millionen Vektor-Kritzeleien | CC BY 4.0 |
| [SketchyCOCO](https://www.sysu-imsl.com/en/materials_datasets.html) | Skizze-Bild-Paare | Autor:innen-Bedingungen |
| [Informative Drawings](https://informative-drawings.github.io/) | Stilisierte Strichzeichnungen | Bedingungen prüfen |

Kantenextraktion für synthetische Skizzen: [HED](https://github.com/s9xie/hed) · [DexiNed](https://github.com/xavysp/DexiNed) · [Freestyle/Suggestive Contours](https://freestyle.sourceforge.net/) (Blender).

**Bestehende Produkte (Skizze/Bild/Text → 3D bzw. CAD)**

[Meshy](https://www.meshy.ai/) · [Tripo AI](https://www.tripo3d.ai/) · [Rodin / Hyper3D](https://hyper3d.ai/) · [Zoo Text-to-CAD](https://zoo.dev/text-to-cad) · [Adam CAD](https://adamcad.com/) · [Autodesk Project Bernini](https://www.autodesk.com/research/publications/project-bernini) – alles kommerzielle bzw. Forschungsangebote; Nutzungsrechte der Ausgaben je Tarif prüfen.

**Web-Bausteine**

| Baustein | Zweck | Lizenz laut Recherche |
|---|---|---|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | Einbettbarer Skizzen-Canvas | MIT |
| [tldraw SDK](https://github.com/tldraw/tldraw) | Erweiterbarer Canvas | Für Produktion kommerzielle Lizenz; aktuelle Bedingungen prüfen |
| [three.js](https://threejs.org/) | 3D-Vorschau im Browser | MIT |
| [OpenCascade.js](https://github.com/donalffons/opencascade.js) | B-Rep-Kernel im Browser (WASM) | LGPL-2.1+ |
| [CadQuery](https://github.com/CadQuery/cadquery) | Parametrisches CAD in Python | Apache-2.0 |
| [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) · [WebGPU](https://www.w3.org/TR/webgpu/) · [Transformers.js](https://huggingface.co/docs/transformers.js/) · [Diffusers](https://github.com/huggingface/diffusers) | Inferenz im Browser bzw. Server-Backend | MIT / – / Apache-2.0 / Apache-2.0 (Modell-Lizenzen separat) |

**Verwandtes Open-Source-Projekt: Mule Create**

[Mule Create](https://github.com/felixbfx/MuleCreate) (GPL-3.0, Alpha) ist ein Programm für technisches 3D-Skizzieren: Man zeichnet Linien auf Ebenen im Raum, aus denen Flächen, Lofts und Kurvennetze werden. Dazu kommen Notizen, Referenzbilder und Sprachkommentare. Der Export ist ein „Sketch Brief“, mit dem eine KI (z. B. Claude Code oder Codex) das Objekt in Houdini oder Blender nachbaut. Über einen lokalen MCP-Server kann die KI die Szene auch live einsehen. Windows-Build verfügbar, Linux läuft aus dem Quellcode (laut README kaum getestet), Oberfläche auf Englisch und Deutsch.

- Download (Windows): [Releases](https://github.com/felixbfx/MuleCreate/releases)
- Quellcode: <https://github.com/felixbfx/MuleCreate>
- Diskussionen (Mules und Rezepte teilen): [Discussions](https://github.com/felixbfx/MuleCreate/discussions)
- Bugs und Feedback: [Issues](https://github.com/felixbfx/MuleCreate/issues)
- Release-Video: [„Go get a Mule! – Official Open Source Release“](https://www.youtube.com/watch?v=_I35lzvzHvs)

*Relevanz:* Mule geht den umgekehrten Weg zu uns. Der Mensch skizziert direkt im 3D-Raum und eine KI rekonstruiert das Ergebnis aus dem „Brief“, statt dass ein eigenes Echtzeit-Modell live generiert. Interessant als UX-Referenz fürs 3D-Skizzieren und als Beispiel für die Anbindung von KI-Agenten über MCP.

**Erkenntnisse für uns:**
- Für eine erste Live-Schleife: schnelles destilliertes Modell (LCM/Turbo) plus Skizzen-Conditioning, Pipeline-Optimierungen wie bei StreamDiffusion.
- Für CAD-Ergebnisse: parametrische Sequenzen (DeepCAD, Fusion 360, SketchGraphs) und gerenderte Skizzen aus lizenzierten CAD-Assets als Trainingsdaten.
- **Datenrechte sind eine Kernrandbedingung.** Fusion 360 Gallery ist laut Recherche nur nicht-kommerziell nutzbar, Objaverse hat Pro-Objekt-Lizenzen. Eine lizenzbewusste Daten-Pipeline ist nötig.
- Praktischer Web-Stack: Excalidraw oder tldraw für die 2D-Eingabe, Inferenz-Backend für große Modelle, three.js plus OpenCascade.js für Vorschau und editierbare Geometrie.

---

## Eigenes kleines Modell statt großem LLM

Die Idee: kein allgemeines LLM, sondern ein **spezialisiertes, kleines Transformer-Modell** wie bei NVIDIA Canvas. Die folgende Recherche ist ein Planungsstand. Zahlen zu Parametern und Rechenaufwand sind Schätzungen und keine veröffentlichten Messwerte, sofern nicht anders gekennzeichnet.

### Was wir von NVIDIA Canvas lernen

[GauGAN](https://nvlabs.github.io/SPADE/) (SPADE, CVPR 2019) speist das Label-Layout des Nutzers über räumlich adaptive Normalisierung in mehrere Generator-Schichten ein. Übertragbar ist das Rezept: **eine aufgabenspezifische Eingabe-Repräsentation, ein kompakter Feed-forward-Generator, GPU-freundliche dichte Operationen und eine bewusst begrenzte Domäne.** Konkrete FPS- oder Größenangaben zu Canvas sind in keiner geprüften Quelle belegt; wir übernehmen keine.

3D-Analogon: Skizzen-Raster plus Strich-Vektoren → ein Forward-Pass → Latent der Geometrie. Das Modell wird fortlaufend aus einem grob aufgelösten Proxy gerendert, teure Oberflächenextraktion läuft erst nach einer kurzen Pause oder auf „Verfeinern“. Nur geänderte Teile werden neu dekodiert.

### Architekturkandidaten

| Ansatz | Quelle | Eignung |
|---|---|---|
| Skizzenbedingte, teilbewusste implizite Modelle (SENS / SPAGHETTI) | [SENS](https://onlinelibrary.wiley.com/doi/full/10.1111/cgf.15015) · [Code](https://github.com/AlexandreBinninger/SENS) | 256×256-Skizze → ViT-Patches → Transformer-Decoder → Part-Latents. **Am nächsten an unserer Idee** (Live-Edit einzelner Teile) |
| Part-Latent-Diffusion (Doodle Your 3D) | [Paper](https://openaccess.thecvf.com/content/CVPR2024/papers/Bandyopadhyay_Doodle_Your_3D_From_Abstract_Freehand_Sketches_to_Precise_3D_CVPR_2024_paper.pdf) · [Projekt](https://hmrishavbandy.github.io/doodle23d/) | Synthetische Skizzen (CLIPasso-Kantenkarten) statt gepaarter Menschdaten; Diffusion evtl. zu langsam pro Strich → als „Commit/Regenerate“ oder später destillieren |
| Feed-forward-Triplane (LRM) | [LRM](https://arxiv.org/abs/2311.04400) | 500M Parameter, ca. 5 s; zeigt das Ein-Pass-Prinzip, ist aber als Ganzes viel zu groß |
| Latent-Set + impliziter Decoder | [3DShape2VecSet](https://arxiv.org/abs/2301.11445) | Kompakter Mittelweg: Vektor-Set-Latent, gemeinsamer SDF/Occupancy-Decoder, Mesh-Extraktion |
| Teilebasierte Generatoren (nur große Modelle) | [PartGen](https://arxiv.org/abs/2412.18608) · [PartCrafter](https://arxiv.org/abs/2506.05573) (1B Parameter, [Code](https://github.com/wgsxm/PartCrafter)) · [PartPacker](https://huggingface.co/nvidia/PartPacker) (nicht kommerziell) | Als Lehrer-Modell oder Datengenerator denkbar, nicht als Kern; Lizenzen prüfen |

Ein kleines autoregressives Modell mit komprimierten Mesh-Tokens halten wir für möglich. Ein konkretes, verifiziertes Beispiel mit Parameter- und Laufzeitangaben wurde nicht gefunden; das bleibt Forschungsrichtung.

### Eingaben kombinieren ohne LLM (Prompt + Skizze + Bilder)

Empfehlung (Engineering-Vorschlag, keine Paper-Aussage):
- **Eingefrorene Encoder** als Merkmalsextraktoren: CLIP/SigLIP für Text, DINOv2 oder CLIP für Referenzbilder.
- Skizze als **Strich-Vektorfolge** (Koordinaten, Reihenfolge, Druck) plus Raster-Ansicht.
- Kleine **Adapter und ein Fusions-Transformer** mit Modalitäts-Embeddings; Cross-Attention in eine gelernte Menge von „Part-Queries“.
- Für die Live-Schleife Text- und Bildmerkmale cachen, nur Skizzen-Tokens inkrementell aktualisieren.
- Nutzer-Sperren („dieses Teil nicht verändern“) überschreiben generierte Änderungen.

### Teile und Segmentierung

Eine persistente **Teile-Struktur** pro Modell: semantische ID, Latent, Transformation, Geometrie, Eltern/Befestigung, zugehörige Skizzenstriche. Stabile IDs über alle Edits sind wichtiger als Texturqualität. Neuronale Felder und Gaussians sind nicht automatisch CAD; später braucht es einen eigenen Export-Schritt (Primitive/Ebenen/Rotationskörper anpassen oder wasserdichtes Mesh nachzeichnen).

### Trainingsdaten und grobe Rechenschätzung

- Start mit einer **schmalen Prop-Taxonomie** (Handwerkzeug, Behälter, Möbel, Rüstung, Set Dressing) aus lizenzierten, gefilterten Assets ([Objaverse](https://openaccess.thecvf.com/content/CVPR2023/html/Deitke_Objaverse_A_Universe_of_Annotated_3D_Objects_CVPR_2023_paper.html): 800K+ Modelle, Lizenz je Objekt).
- Pro Asset 8–24 Ansichten rendern: Linien, Silhouette, Tiefe, Normalen, Part-Masken; Skizzen per [CLIPasso](https://clipasso.github.io/clipasso/) abstrahieren und zufällig verrauschen (Strichstärke, Lücken, Kamera).
- Echte Handskizzen nur für Validierung und kleine Kalibrierung, weil synthetische Konturen die Künstlerabsicht nicht vollständig abbilden.
- **Planungsschätzung** (nicht aus Papern): eingefrorener Decoder + ca. 10–50M trainierbare Parameter + 10k–50k kuratierte Assets wären ein plausibles Erstexperiment auf einer 24–48-GB-GPU, Tage bis wenige Wochen. Ein Shape-Autoencoder/Decoder von Grund auf kann das deutlich sprengen; besser mit einem vorhandenen Latent-Decoder oder einem niedrig aufgelösten SDF-Modell starten. Vor dem Skalieren Durchsatz an 1k Assets messen.

### Vorschlag: minimale Architektur und Trainingsplan

1. MVP nur für **einzelne Props und eine feste Kamera**; Striche als Vektoren und als Raster speichern.
2. Teilbewusste implizite Latent-Repräsentation (SENS/SPAGHETTI-artig) oder kompaktes Latent-Set (3DShape2VecSet-artig). Beides ist für unsere Latenz noch unbewiesen und muss gemessen werden.
3. Decoder zuerst **eingefroren**; trainiert wird ein kleiner ViT-Skizzen-Encoder mit 4–8 Transformer-Blöcken, der Part-Latents und Transformationen vorhersagt (Ziel 10–50M Parameter, nur ein Budgetvorschlag).
4. **Unsicherheitskopf**: unsichere Geometrie bleibt editierbar, die UI kann Alternativen zeigen.
5. Training zuerst mit Latent-Regression, dann Render-Konsistenz, SDF/Occupancy und Part-Masken-Loss.
6. Interaktiver Pfad deterministisch Feed-forward: bei Strichänderung nur betroffenes Part-Latent aktualisieren, grobe Vorschau pro Frame, volle Dekodierung entprellt.
7. Ein kleiner Latent-Diffusion-/Flow-Verfeinerer erst **nach** funktionierender Regression, für „Variationen“, später auf 1–4 Schritte destilliert ([Consistency Models](https://arxiv.org/abs/2303.01469) belegen das Prinzip nur für Bilder).
8. Vergleich mit SENS und Doodle Your 3D auf zurückgehaltenen Handskizzen: Edit-Lokalität, Teilekonsistenz, Latenz, Speicher, Geometrie-Validität.
9. Separater CAD-Export-Schritt (Primitive fitten oder Mesh nachzeichnen).
10. Daten-Herkunft und Lizenzen von Anfang an mitführen, besonders für kommerzielle Film-Assets.

**Offene Unsicherheit:** Formvervollständigung aus einer Ansicht ist mehrdeutig, synthetische Skizzen können den Stil verzerren, Part-Labels sind verrauscht, und ob eine Consumer-GPU reicht, hängt von Repräsentation und Latenzziel ab. Gut belegt ist ein spezialisierter Latent-Decoder plus Skizzen-Encoder; „Echtzeit, hohe Qualität und echtes CAD“ bleibt ein unbewiesenes Produktziel.

---

## Trainingsdaten

Ziel: Daten mit **handgezeichneter Skizze + echtem Foto + 3D-Modell + Beschreibung** für möglichst alle Objektarten (Autos, Alltagsgegenstände, Filmprops, Möbel, Räume, technische Teile).

> **Wichtigster Befund:** Die Recherche hat **kein** verifiziertes Dataset gefunden, das für dieselbe Instanz Handskizze, echtes Foto, 3D-Modell und Text zusammen enthält. Es gibt nur Teilkombinationen (siehe unten). Der realistische Weg ist, **synthetische Skizzen und Texte aus lizenzierten 3D-Modellen zu erzeugen** und mit kleinen echten Handskizzen-Sets zu validieren und zu kalibrieren.
>
> **Lizenzen:** Fast alle Forschungsdatensätze erlauben nur nicht-kommerzielle Nutzung oder haben Rechte pro Objekt. Die Angaben unten stammen aus den Quellen und sind keine Rechtsberatung. Vor kommerziellem Training Rechte prüfen und pro Asset dokumentieren.

### Top 10: Skizze direkt gepaart mit 3D-Modell

Zusammenfassung einer eigenen Recherche nur zu Datasets, in denen eine Skizze direkt einem 3D-Modell zugeordnet ist (wie Sketchy, aber für 3D). Alles wurde über Projektseiten, Repos oder Papers geprüft. Angaben mit „unverifiziert“ konnten nicht bestätigt werden.

| # | Dataset | Skizzen / 3D | Skizzenart | Kategorien | Paarung | Download / Format / Lizenz |
|---|---|---|---|---|---|---|
| 1 | **Sketch2Vox** ([ECCV 2024](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/9384_ECCV_2024_paper.php)) | 12.877 Handskizzen zu ShapeNet-Objekten (30 Personen) + ModelNet10-Synthetik | Hand (MS Paint) + Canny | 9: Flugzeug, Bank, Schrank, Stuhl, Display, Lampe, Lautsprecher, Sofa, Tisch | exakt pro Objekt | Google-Drive-Link im Paper; **Voxel 32³**, kein Mesh; Lizenz unverifiziert |
| 2 | **Sketch2Model: ShapeNet-Sketch + Synthetic** ([GitHub](https://github.com/bennyguo/sketch2model)) | 1.300 Handskizzen (Test) + synthetisches Trainingsset | Hand (Test), Kanten (Training) | 13: Flugzeug, Bank, Schrank, Auto, Stuhl, Display, Lampe, Lautsprecher, Gewehr, Sofa, Tisch, Telefon, Boot | exakt pro Objekt, blickwinkelbewusst | Drive-Links (`shapenet-sketch.zip`, `shapenet-synthetic.zip`); ShapeNet-Meshes; Code MIT, Daten erben ShapeNet-Bedingungen |
| 3 | **SketchEPM / THU-CAD** ([Seite](https://di-huang.github.io/THU-CAD-Freehand-Sketch-Dataset/index.html)) | 33.300 Handskizzen + 35.873 synthetische / 9.759 CAD-Modelle | Hand + synthetisch | 23 technische Kategorien (Namen nicht lesbar) | Skizze ↔ CAD, Granularität unverifiziert | Baidu Pan; B-Rep; Lizenz unverifiziert |
| 4 | **SHREC'14 Sketch-Based 3D Retrieval** ([Daten](https://sites.usm.edu/bli/sharp/sharp/contest/2014/SBR/data.html)) | 12.680 Handskizzen / 8.987 Modelle | Hand | 171 Klassen (breit, nicht aufgelistet) | nur Klassen-/Relevanzebene | ZIP ca. 1,03 GB; Format und Lizenz unverifiziert |
| 5 | **SHREC'13 Sketch-Based 3D Retrieval** ([NIST](https://catalog.data.gov/dataset/shrec13-track-large-scale-sketch-based-3d-shape-retrieval)) | 7.200 Handskizzen / 1.258 Modelle (PSB) | Hand | 80–90 Klassen (Quellen weichen ab) | nur Klassen-/Relevanzebene | ZIP ca. 603 MB; NIST Open License laut Eintrag |
| 6 | **SHREC'22 Sketch-Based 3D in the Wild** ([Paper](https://arxiv.org/abs/2207.04945)) | 145.000 Skizzen / 46.000 CAD- + 1.700 Scan-Punktwolken | QuickDraw-basiert | QuickDraw/ModelNet40/ShapeNet/ScanObjectNN | Klassenebene | Drive-Zugang; **Punktwolken**; Lizenz unverifiziert |
| 7 | **DifferSketching** ([Projekt](https://chufengxiao.github.io/DifferSketching/)) | 3.620 Handskizzen (70 Novizen, 38 Experten) / 136 Objekte, 362 Ansichten | Hand, multi-view | u. a. Tierköpfe und gemischte Objekte | exakt, registriert | Drive-Link; **nur nicht-kommerziell**, Modelle aus dem Netz mit Einschränkungen |
| 8 | **KO3D+** ([CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Chen_Rapid_3D_Model_Generation_with_Intuitive_3D_Input_CVPR_2024_paper.pdf)) | 4.200 VR-3D-Skizzen (600 je Kategorie) | 3D-Handskizze (VR) | 7: Auto, Sofa, Flugzeug, Bank, Display, Boot, Tisch | exakt (über ShapeNet-Form gezeichnet) | **Release nicht verifiziert** |
| 9 | **VRChairSketch** ([Seite](https://cvssp.org/data/VRChairSketch/)) | 1.497 VR-Skizzen / 1.005 Stühle (50 Personen) | 3D-Handskizze (VR, OBJ) | nur Stühle | exakt, Shape-ID im Dateinamen | Download vorhanden; Lizenz nicht genannt, ShapeNet-Bedingungen |
| 10 | **OpenSketch** ([Inria](https://repo-sam.inria.fr/d3/OpenSketch/)) | über 400 Designer-Skizzen / 12 Objekte | Hand (Designer), 2 Perspektiven | 12 Produktobjekte | exakt mit Korrespondenzen | `OpenSketch.zip` 906 MB (SVG/JSON + 3D); **CC0** laut Projekt |

**Weitere brauchbare Kandidaten:** [CADSketchNet](https://github.com/agcl-mr/CADSketchNet) (58.696 generierte + 801 handgezeichnete Skizzen, CC BY-NC-SA 4.0) · [MM-CAD](https://exanos.github.io/MMCAD/) ([HF](https://huggingface.co/datasets/exanos/MMCAD), 33.816 CAD-Modelle, ca. 3.000 Hand- + 1.000 nachgezeichnete Skizzen, quellabhängige Lizenzen) · [Sketch2Mesh-Testset](https://github.com/cvlab-epfl/sketch2mesh) (Autos/Stühle, Skizzen 8 MB + Meshes 530 MB, GPL-3.0) · [AmateurSketch-3D / ProSketch-3D](https://openaccess.thecvf.com/content/CVPR2024/papers/Bandyopadhyay_Doodle_Your_3D_From_Abstract_Freehand_Sketches_to_Precise_3D_CVPR_2024_paper.pdf) (nur Stühle, Download unverifiziert) · [SketchANIMAR](https://arxiv.org/abs/2304.05731) (140 Skizzen / 711 Tiermodelle, >50 Tierklassen, Zugang unverifiziert).

**Angekündigt, aber noch nicht nutzbar:** [VRSketch2Shape](https://github.com/chenyizi086/VRSketch2Shape) (>20.000 synthetische + 900 echte Paare behauptet; öffentlich nur Inferenz-Daten, Training „coming soon“) · VRsketch2Gaussian (2.097 Paare in 55 ShapeNet-Kategorien behauptet, kein Download gefunden) · ShapeNet-Sketch3D (HF-Karte [zwgd/sketch3D](https://huggingface.co/datasets/zwgd/sketch3D) ist ein leerer Platzhalter) · MSU-3D (Release nicht verifiziert) · SketchBodyNet (nur menschliche Körper, kein Download).

**Befund zur Abdeckung:**
- Fast alles deckt nur **menschengemachte Objekte** ab (Möbel, Fahrzeuge, Technik). **Tiere** gibt es nur in DifferSketching (Tierköpfe) und SketchANIMAR (Zugang offen). **Gemüse/Essen** und **Pflanzen** hat kein verifiziertes Dataset mit Skizze↔3D-Paarung.
- Echte, exakt gepaarte Handskizzen gibt es in der Größenordnung von **einigen zehntausend** (Sketch2Vox, SketchEPM). Die breiten Sets (SHREC) sind nur auf Klassenebene gepaart.
- **Konsequenz:** Für Tiere, Essen, Gemüse und Filmprops müssen wir Skizzen **synthetisch aus Objaverse-/Poly-Haven-Modellen rendern** (siehe Datenrezept) und die menschlichen Sets für Feinabstimmung und Validierung nutzen.

### A. Skizze gepaart mit Foto, 3D, CAD oder Text

| Dataset | Umfang | Paarung | Nutzen |
|---|---|---|---|
| [Sketchy](https://patsorn.me/projects/sketchy/) | 75.471 Skizzen / 12.500 Fotos / 125 Klassen | Handskizze ↔ genaues Foto | Stärkste Objekt-Skizze↔Foto-Basis |
| [FS-COCO](https://www.cvssp.org/data/fscoco/) ([Paper](https://arxiv.org/abs/2203.02113)) | 10.000 Szenen | Handskizze ↔ Foto ↔ Textbeschreibung | Szenenkomposition und Prompt-Abgleich |
| [SketchEPM / THU-CAD](https://di-huang.github.io/THU-CAD-Freehand-Sketch-Dataset/index.html) | 9.759 B-Rep-CAD-Modelle, 33.300 echte + 35.873 synthetische Skizzen, 23 Kategorien | Handskizze ↔ CAD | **Beste Engineering-Skizze→CAD-Supervision** |
| [OpenSketch](https://opensketch.github.io/) | über 400 Designer-Skizzen, 12 Objekte | Designer-Skizze ↔ 3D-Modell | Hochwertig, aber klein; laut Projekt CC0 (Seite von der Recherche nicht geöffnet) |
| [CADSketchNet](https://bharadwaj-manda.github.io/CADSketchNet/) | 801 Handskizzen + 58.696 gerenderte Skizzen | Skizze ↔ CAD-Modell | CAD-Domäne, gemischt echt/synthetisch |
| [SketchyCOCO](https://github.com/sysu-imsl/SketchyCOCO/blob/master/README.md) | 20.198 Objekt-Triplets, 14.081 Szenenpaare | Skizze ↔ Foto ↔ Kanten | Objekte im Kontext, Segmentierung |
| [SketchyScene](https://github.com/SketchyScene/SketchyScene) | 7.265 Szenenskizzen (+ synthetische Varianten) | Skizze ↔ Referenzbild + Labels | Layout und Objektbeziehungen (Referenzen sind Cartoons) |
| [Photo-Sketching](https://mtli.github.io/sketch/) | Fotos mit menschlichen Konturzeichnungen | Foto ↔ Skizze (Strichdaten) | Realistischer Konturstil |
| [PSC6k](https://arxiv.org/abs/2307.12967) | 6.250 Sketchy-Paare, 150K Korrespondenzen | Skizzenteil ↔ Fotoregion | Teile-Zuordnung |
| SHREC-Retrieval-Tracks ([Übersicht](https://www.projects.science.uu.nl/shrec/tracks%20overview.html), [Wild 2022](https://github.com/firmamentqj/SBSRW)) | 7.200 Skizzen / 1.258 Modelle (’13), 12.680 / 8.987 (’14) | Skizze ↔ passendes 3D-Modell (Klassenebene) | Breite Formabdeckung, Labels eher Retrieval als 1:1 |
| [Quick, Draw!](https://quickdraw.withgoogle.com/data) | über 50 Mio. Kritzeleien, 345 Klassen | nur Klassenlabel | Strich-Vorwissen, keine Paare |
| [TU-Berlin](https://huggingface.co/datasets/sdiaeyu6n/tu-berlin) (Mirror) | 20.000 Skizzen, 250 Klassen | nur Klassenlabel | Konzeptskizzen; Original-URL lieferte 404 |
| [DomainNet](https://www.tensorflow.org/datasets/catalog/domainnet) | ca. 600K Bilder, 345 Klassen | Skizzen- und Foto-Domäne klassenweise | Domänenabgleich, keine Instanzpaare |
| QMUL-Sets (Schuhe, Stühle, Handtaschen; [Übersicht](https://www.aimspress.com/aimspress-data/mbe/2023/12/PDF/mbe-20-12-937.pdf)) | 300–6.700 Skizzen je Set | Skizze ↔ Produktfoto | Feingranular, schmale Kategorien |

Synthetische Skizzen aus Bildern oder 3D (Werkzeuge, keine Datensätze): [CLIPasso](https://clipasso.github.io/clipasso/) · [Doodle Your 3D](https://hmrishavbandy.github.io/doodle23d/) (Rezept für synthetische Skizzen + Teile) · [DexiNed](https://github.com/xavysp/DexiNed) · [Informative Drawings](https://informative-drawings.github.io/) · [ControlNet Scribble](https://github.com/lllyasviel/ControlNet) · [Blender Freestyle](https://docs.blender.org/manual/en/latest/render/freestyle/index.html). Ein einheitlicher „ShapeNet-Sketch“-Download konnte nicht verifiziert werden.

### B. 3D-Objekte und -Szenen nach Kategorie

Größen sind veröffentlichte Näherungswerte. „Prüfen“ heißt: Seite war nicht abrufbar oder Rechte hängen am Einzelobjekt.

**Allgemein / Alltagsgegenstände / Props**

| Dataset | Umfang | Inhalt | Lizenz laut Recherche |
|---|---|---|---|
| [Objaverse](https://huggingface.co/datasets/allenai/objaverse) | 800K+ | Assets, Metadaten, Tags | ODC-By plus Original-Lizenz je Objekt |
| [Objaverse-XL](https://objaverse.allenai.org/objaverse-xl/) | 10M+ | Web-Assets | Quellabhängig, prüfen |
| [ShapeNetCore / ShapeNetSem](https://shapenet.org/) | 51K+ (55 Kat.) / ca. 12K (270 Kat.) | CAD-artige Meshes, Taxonomie | Zugangsantrag, nicht pauschal kommerziell |
| [ModelNet](https://modelnet.cs.princeton.edu/) | 12.311 Modelle (ModelNet40) | Saubere CAD-Meshes | Forschung, prüfen |
| [Thingi10K](https://ten-thousand-models.appspot.com/) | 10.000 | STL, Tags | Lizenz je Modell |
| [OmniObject3D](https://omniobject3d.github.io/) | 6.000 Scans / 190 Kat. | Texturierte Meshes, Multi-View | Forschung, kommerziell prüfen |
| [Google Scanned Objects](https://research.google/resources/datasets/scanned-objects-by-google-research/) | 1.030 | Texturierte Haushaltsobjekte | Prüfen |
| [ABO](https://amazon-berkeley-objects.s3.amazonaws.com/index.html) | 147K Produkte, 8.222 3D-Modelle | Produktbilder, Beschreibungen, 3D | CC BY-NC 4.0 (nicht kommerziell) |
| [Toys4K](https://github.com/rehg-lab/Toys4K) | 4.179 Spielzeuge | Meshes, Bilder | Prüfen |
| [Smithsonian 3D](https://3d.si.edu/) | 10K+ | Hochauflösende Scans | Je Objekt |
| [Poly Haven](https://polyhaven.com/models) | einige hundert | Modelle, PBR-Texturen | **CC0** |
| [Kenney](https://kenney.nl/assets) | großer Katalog | Low-Poly-Props, Fahrzeuge, Gebäude | CC0 (je Paket bestätigen) |
| [Quaternius](https://quaternius.com/) | große Paketsammlung | Low-Poly, Rigs | Eigene Free-Lizenz, prüfen |
| [Sketchfab (CC-Modelle)](https://sketchfab.com/licenses) | großer Katalog | Props, Texturen | Je Modell (CC0/CC-BY bis NC/ND) |
| [Fab / Megascans](https://www.fab.com/) · [BlenderKit](https://www.blenderkit.com/) · [TurboSquid](https://www.turbosquid.com/Search/3D-Models/free) · [CGTrader](https://www.cgtrader.com/free-3d-models) | Marktplätze | Props, PBR | Gemischt, Training-Rechte prüfen |

**Fahrzeuge:** [DrivAerNet](https://drivaernet.com/) (4.000+ Designs) · [DrivAerNet++](https://github.com/AmirMansourzadeh/DrivAerNetPlusPlus) (ca. 8.000) · ShapeNet-Auto-Kategorie · Objaverse-Fahrzeug-Teilmenge. Alle mit Forschungs- bzw. Pro-Objekt-Lizenz.

**Möbel und Räume**

| Dataset | Umfang | Lizenz laut Recherche |
|---|---|---|
| [3D-FUTURE](https://3d-future.org/) | 20.240 Möbelmodelle | Forschung |
| [3D-FRONT](https://tianchi.aliyun.com/specials/promotion/alibaba-3d-scene-dataset) | 18.968 eingerichtete Räume | Nur wissenschaftliche Nutzung |
| [Structured3D](https://structured3d-dataset.org/) | 3.500 Szenen / 21K Räume | Forschung |
| [ScanNet](https://github.com/ScanNet/ScanNet) | 1.513 Scans | Forschungsvereinbarung |
| [Matterport3D](https://niessner.github.io/Matterport/) | 90 Gebäude | Nur Forschung |
| [Replica](https://github.com/facebookresearch/Replica-Dataset) | 18 Szenen | Forschungsfokus |
| [HM3D](https://aihabitat.org/datasets/hm3d/) | 1.000+ Häuser | Forschungslizenz |
| [Hypersim](https://github.com/apple/ml-hypersim) | 461 Szenen / 77K Bilder | Forschung |
| [ARKitScenes](https://github.com/apple/ARKitScenes) | 5.047 Scans | Apple-Bedingungen |

SUNCG ist zurückgezogen und rechtlich unklar, nicht verwenden.

**CAD / Technik:** [ABC](https://deep-geometry.github.io/abc-dataset/) (1 Mio. CAD-Modelle, STEP/OBJ/STL) · [DeepCAD](https://github.com/ChrisWu1997/DeepCAD) (178K Sequenzen) · [Fusion 360 Gallery](https://github.com/AutodeskAILab/Fusion360GalleryDataset) (8.625 Designs, laut Recherche nur nicht-kommerziell) · [CADParser](https://github.com/AutodeskAILab/CADParser) (abgeleitet, Quellbedingungen erben).

**Teile-Annotation (für Einzelteilbearbeitung):** [PartNet](https://partnet.cs.stanford.edu/) (26.671 Modelle, 573.585 Teile) · [PartNet-Mobility](https://sapien.ucsd.edu/) (2.346 bewegliche Objekte) · [ShapeNet-Part](https://shapenet.cs.stanford.edu/) (16.881 Modelle) · [PartObjaverse-Tiny](https://github.com/3dlg-hcvc/part-objaverse) · [BuildingNet](https://buildingnet.org/) · [3DCoMPaT](https://3dcompat-dataset.org/) (Materialien/Attribute).

### C. Echte Fotos zu 3D

| Dataset | Umfang | Nutzen / Lizenz |
|---|---|---|
| [Pix3D](https://pix3d.csail.mit.edu/) | 395 Modelle, 9 Kategorien, pixelgenau ausgerichtete Fotos | Enge Foto↔Form-Ausrichtung, klein; offizielle Lizenz prüfen |
| [CO3D](https://ai.meta.com/datasets/co3d-downloads/) | ca. 19K Videos, 50 Kategorien | Echte Multi-View-Daten; Meta-Vereinbarung |
| [Objectron](https://github.com/google-research-datasets/Objectron) | ca. 15K Videos, 9 Kategorien | Pose/Boxen, keine Meshes |
| [Pascal3D+](https://cvgl.stanford.edu/projects/pascal3d.html) / [ObjectNet3D](https://cvgl.stanford.edu/projects/objectnet3d/) | ca. 90K Bilder, 100 Kategorien (ObjectNet3D) | CAD-Zuordnung nur ungefähr |
| OmniObject3D, ABO, GSO | siehe Tabelle B | Reale Scans und Produktbilder |

### D. Text und technische Beschreibungen

| Dataset | Umfang | Anmerkung |
|---|---|---|
| [Cap3D](https://cap3d-um.github.io/) | ca. 1 Mio. Captions zu Objaverse-Objekten | Automatische Captions, nur schwache Labels |
| [Text2Shape](https://svl.stanford.edu/projects/text2shape/) | 75K Beschreibungen / 10K Formen (Stühle, Tische) | Menschlich, aber schmal |
| [ShapeGlot](https://shape.csail.mit.edu/) | ca. 31K Beschreibungen / 4K Formen | Vergleichende Sprache |
| [ScanRefer](https://davered.github.io/scanrefer/) | 51K Beschreibungen in Innenräumen | Räumliche Sprache |
| ABO-Metadaten | Produkttitel und Attribute | Realistisches Produktvokabular, nicht kommerziell |
| [CubiCasa5k](https://github.com/CubiCasa/CubiCasa5k) · [RPLAN](https://github.com/wwang1/housegan) | Grundrisse | Nur falls Architektur in den Scope kommt |

Nicht verifiziert (nur Namen/Leads): Technische-Zeichnungs-Datensätze, CADTalk, Text2CAD-Annotationen, Describe-3D, ShapeLLM/PointLLM, MultiModal-CAD. „Technische Beschreibungen“ in Ingenieursqualität gibt es also nicht als fertigen, lizenzierten Datensatz. Wir würden sie aus Metadaten, Teilen und Maßen **selbst erzeugen und stichprobenartig menschlich prüfen**.

### E. Pipeline für synthetische Daten

[BlenderProc](https://github.com/DLR-RM/BlenderProc) (GPL-3.0; RGB, Tiefe, Normalen, Segmentierung) · [Kubric](https://github.com/google-research/kubric) · [Objaverse-XL-Skripte](https://github.com/allenai/objaverse-xl) · Blender Freestyle. Die Rechte der gerenderten Daten bleiben bei den Quell-Assets.

### Vorgeschlagenes Datenrezept (Skizze + Foto + 3D + Text)

1. **Asset-Register mit Herkunft zuerst:** Pro Asset ID, Quelle, Lizenz, Attribution und Einschränkungen speichern. Objaverse nur mit bekannter, kompatibler Lizenz übernehmen. Forschungsquellen wie ABO getrennt halten.
2. **Synthetische Quadrupel aus geklärten Meshes:** Mehrere Ansichten als RGB, Silhouette, Tiefe, Normalen und Teile-Masken rendern. Strichskizzen in mehreren Abstraktionsgraden mit Freestyle/CLIPasso erzeugen und mit Rauschen versehen.
3. **Text anhängen:** Metadaten der Ersteller und passende Cap3D-Captions als schwache Labels, dazu Attribut-Vorlagen aus Teilen, Material und Maßen. Kleines menschlich geprüftes Gold-Set. LLM-Texte nicht als verifizierte Spezifikation ausgeben.
4. **Echte Foto-Anker:** Pix3D (klein, eng ausgerichtet), CO3D und OmniObject3D für echtes Aussehen, Objectron/Pascal3D+/ObjectNet3D nur für Pose und Kategorie.
5. **Echte Handskizzen:** SketchEPM, OpenSketch und Sketchy für Validierung und Kalibrierung gegen den Synthetik-Bias, FS-COCO für Prompt-Sprache.
6. **Teile-Labels:** PartNet/ShapeNet-Part nur nach Klärung der Lizenz. Für andere Assets Masken aus sinnvollen Mesh-Komponenten.
7. **Split nach Asset und Quellprodukt**, nicht nach Ansicht, sonst Datenleck. Getrennte Lizenz-Kohorten führen und auf zurückgehaltenen echten Skizzen und Fotos evaluieren.

**Kommerziell am unkompliziertesten:** Poly Haven (CC0), Kenney (CC0, je Paket prüfen), Teile von Quaternius, öffentliche-Domäne-Objekte der Smithsonian, einzeln gefilterte CC0/CC-BY-Assets aus Sketchfab und Objaverse. **Erst nach Klärung nutzbar:** ShapeNet, ModelNet, OmniObject3D, Pix3D, CO3D, 3D-FRONT, 3D-FUTURE, ScanNet, Matterport3D, Hypersim, PartNet, ABC, Fusion 360 und ABO.

---

## Geplante Architektur (Entwurf, noch nicht entschieden)

```
┌──────────────┐   Strich-Events    ┌────────────────────┐   3D-Repräsentation   ┌──────────────────┐
│  2D-Canvas   │ ─────────────────▶ │ Echtzeit-Modell    │ ────────────────────▶ │  3D-Viewport     │
│ (Excalidraw- │                    │ (selbst trainiert, │                       │  (three.js o. ä.)│
│  artig)      │ ◀───────────────── │  inkrementell)     │                       └────────┬─────────┘
└──────────────┘   Overlay/Feedback └────────────────────┘                                │
                                                                                          ▼
                                                                              ┌──────────────────────┐
                                                                              │ CAD-Konvertierung &  │
                                                                              │ parametrischer Editor│
                                                                              └──────────────────────┘
```

### Offene Designfragen

1. **Ausgabe-Repräsentation des Modells:** Mesh (wie MeshPad), SDF/Voxel, Gaussian Splats oder direkt ein **CAD-Programm** (Sketch + Extrude, wie bei CADrawer/Sketch2CAD)? Letzteres macht den Schritt zu „echtem CAD“ am direktesten, ist aber schwerer zu trainieren.
2. **Echtzeit-Budget:** Zielwert festlegen (z. B. < 200 ms pro Strich). Mögliche Hebel: kleine Modelle, Distillation (wenige Diffusionsschritte), Speculative Decoding, inkrementelles Update statt Komplett-Neuberechnung.
3. **Eingabeperspektive:** Einzelne Ansicht, mehrere Ansichten (Front/Seite/Oben) oder frei gezeichnete Perspektive?
4. **Trainingsdaten:** Synthetische Skizzen aus vorhandenen CAD-/Mesh-Datensätzen (Kantenextraktion, Strichsimulation) sowie echte Zeichnungen für die Feinabstimmung. Datensatz- und Lizenzfragen sind noch zu klären.
5. **Von 3D zu CAD:** Wie wird aus der Modellausgabe eine saubere, editierbare Feature-Historie (Primitive-Fitting, Program Synthesis, Constraint-Solver)?
6. **Lizenzen:** MeshPad-Code ist nicht-kommerziell lizenziert, daher als Referenz nutzen, nicht als Codebasis, solange die Nutzung nicht geklärt ist.

---

## Roadmap (Vorschlag)

- [ ] **Phase 0 – Recherche:** Paper-Review abschließen, MeshPad lokal reproduzieren, Latenz messen.
- [ ] **Phase 1 – Canvas-Prototyp:** Zeichnen im Browser, Strichdaten als Ereignisstrom.
- [ ] **Phase 2 – Datensatz-Pipeline:** Synthetische Skizzen aus 3D-/CAD-Daten erzeugen.
- [ ] **Phase 3 – Basismodell:** Skizze → 3D (nicht Echtzeit) trainieren und evaluieren.
- [ ] **Phase 4 – Echtzeit & Inkrementalität:** Beschleunigung, Add-/Delete-Edits.
- [ ] **Phase 5 – CAD-Brücke:** Konvertierung in editierbare CAD-Strukturen, Export (STEP).
- [ ] **Phase 6 – Produkt-UX:** Zusammenspiel Canvas, 3D-Viewport und CAD-Werkzeuge.

---

## Mitmachen

Das Projekt steht ganz am Anfang. Ideen, Paper-Hinweise und Issues sind willkommen: <https://github.com/janoschbl/SketchToCAD>

## Lizenz

Noch nicht festgelegt.
