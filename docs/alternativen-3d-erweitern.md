# Alternativen zum nachträglichen Erweitern von 3D-Modellen

Stand: 2026-11-21. Gegenüberstellung zur bestehenden Architektur in [erweiterbare-modelle.md](erweiterbare-modelle.md).

**Kennzeichnung:** [geprüft] bedeutet, die verlinkte Quelle wurde geöffnet und bestätigt die Aussage. [Annahme] bedeutet technische Einschätzung oder nicht unabhängig geprüfte Aussage. Recherche fokussiert auf die für SketchToCAD relevanten Kandidaten; Lizenzangaben beziehen sich auf die jeweils verlinkten Projektinformationen und sind vor Produktveröffentlichung samt Modellkarten/Abhängigkeiten nochmals juristisch zu prüfen.

## Kurzfazit

[geprüft] Der beste direkte Kandidat für echtes, trainingsfreies Editing im 3D-Raum ist **VoxHammer**: Es erhält Regionen über 3D-Masken und arbeitet auf TRELLIS-Latents. Allerdings verlangt das offizielle Projekt mindestens 40 GB VRAM. [Annahme] Auf 8-GB-Hardware ist deshalb kurzfristig die robusteste Produktarchitektur weiterhin ein Teilgraph mit unveränderlichen Meshes, ergänzt um Mehransichten und explizite Nutzerplatzierung; ein Editormodell erzeugt den neuen Anbau als vollwertiges 3D-Teil.

[geprüft] TRELLIS.2 ist Image-to-3D, aber kein dokumentiertes lokales Editiersystem; offiziell mindestens 24 GB VRAM. Die strukturierte Darstellung allein garantiert keine Unverändertheit. [geprüft] PartCrafter kann aus einem RGB-Bild mehrere Teile gemeinsam generieren, ist damit interessant für Erstgenerierung/Zerlegung, aber nicht für gezieltes Hinzufügen zu einem vorhandenen Modell.

## Vergleich

| Methode | Signal / Aufgabe | Region erhalten? | Code, Gewichte, Lizenz | Speicher / Laufzeit / Reife | Einschätzung |
|---|---|---|---|---|---|
| [VoxHammer Paper](https://arxiv.org/abs/2508.19247), [Code](https://github.com/Nelipot-Lee/VoxHammer) | [geprüft] Vorhandenes 3D-Modell + 3D-Maske; zusätzlich Text-Condition-Pipeline. Führt Inversion und Editieren in TRELLIS-Latents aus. | [geprüft] Explizite Preserve-Masken und Ersetzen der Features erhaltener Bereiche. Das zielt auf präzise Erhaltung, aber keine Garantie für byte-identische Mesh-Dateien nach Decode. | [geprüft] Code MIT (TRELLIS-Teil hat eigene Lizenzbedingungen). Gewichte stammen aus zugrunde liegenden Checkpoints; separate Lizenz im verlinkten Readme vor Nutzung prüfen. | [geprüft] Code und Inferenz veröffentlicht; mindestens 40 GB VRAM, A100 80 GB empfohlen. Keine belastbare Laufzeitangabe im geöffneten Readme. | **Erste Wahl für den Forschungs-Prototyp**, nicht für 2070. Eingabe ist 3D-Maske, keine Skizze; Skizzenmaske muss in 3D überführt werden. |
| [TRELLIS.2 Paper/Projekt](https://microsoft.github.io/TRELLIS.2/), [Code](https://github.com/microsoft/TRELLIS.2) | [geprüft] Einzelbild → 3D, strukturierte O-Voxel/Sparse-3D-VAE-Latents. | [geprüft] Kein lokales Editieren oder Preserve-Masken im veröffentlichten Umfang dokumentiert; deshalb keine Erhaltungsgarantie. | [geprüft] MIT laut Repo; Gewichte verfügbar. | [geprüft] Mindestens 24 GB VRAM; Zeiten 3/17/60 s für 512³/1024³/1536³ auf H100. Veröffentlichung als 4B Image-to-3D. | Gut für neues vollständiges Objekt oder künftig als Teilgenerator; kein direkter Ersatz für lokales Editieren. Für RTX 2070 ungeeignet. |
| [PartCrafter Paper](https://arxiv.org/abs/2506.05573), [Code](https://github.com/wgsxm/PartCrafter) | [geprüft] Ein RGB-Bild → mehrere zusammenhängend generierte Mesh-Teile. | [geprüft] Teile sind strukturiert, aber kein Editing eines vorhandenen Modells mit festgehaltenem Rest. | [geprüft] Repository MIT. Gewichts-/Checkpoint-Lizenz im geöffneten Repository nicht eindeutig separat ausgewiesen: vor kommerzieller Nutzung verifizieren. | [geprüft] Offizieller Code veröffentlicht; keine VRAM- oder Laufzeitangabe aus den geöffneten Quellen übernommen. | Nützlich als Baseline für initiale Teilezerlegung, nicht inkrementelles Skizzen-Editing. Skizze müsste als RGB-Bild geeignet sein. |
| [SAMPart3D Paper](https://arxiv.org/abs/2411.07184), [Projekt-Code](https://github.com/yhyang-myron/SAMPart3D) | [geprüft] Vorhandenes 3D-Objekt segmentieren; mehrere Granularitäten, semantikfrei. | [Annahme] Segmentierung ermöglicht Teilgraph-Aufbau, erzeugt aber selbst keine Geometrie und garantiert keine sauberen mechanischen Schnittflächen. | [Annahme] Paper beschreibt Methode; Repository/Lizenz/Checkpoint-Lizenz vor Integration separat prüfen. | [geprüft] Paper belegt zweistufiges Training und 3D-Feature-Backbone; VRAM/Laufzeit hier nicht verifiziert. | Interessant, um monolithische Erstmodelle einmalig in editierbare Teile zu zerlegen; nicht für Anbau-Generierung. |
| Multiview-Edit → 3D-Rekonstruktion | [Annahme] Skizzenansicht plus generierte/abgeleitete Ansichten, danach Multi-View-Rekonstruktion. | [geprüft] VoxHammer-Paper beschreibt als Motivation, dass Multi-View-Methoden uneditierte Teile schlechter erhalten. | [Annahme] Hier keine einzelne Methode mit geprüfter Lizenz und lokaler Garantie ausgewählt. | [Annahme] Mehrere Bildgenerierungen und Rekonstruktion erhöhen Laufzeit und können Ansichten widersprüchlich machen. | Mehr Ansichten verbessern Tiefenhinweise, sind aber kein Schutz gegen Änderungen am Bestand. Nur mit festen Kameras/Geometrie-Constraints testen. |
| TRELLIS (V1) strukturierte Latents | [geprüft] Einzelbild → Mesh und strukturierte Latents; Basis für VoxHammer. | [geprüft] TRELLIS selbst ist kein lokales Editing-System; VoxHammer ergänzt Preserve-Masken/Inversion. | [geprüft] [Code](https://github.com/microsoft/TRELLIS); Projekt nennt MIT für Modelle und den Großteil des Codes, mit Ausnahmen für Unterkomponenten. | [Annahme] Geringere Hürde als TRELLIS.2, aber weiterhin GPU-intensiv; konkrete Mindest-VRAM dieser Matrix nicht unabhängig vermessen. | Als Basis bei möglicher Anpassung von VoxHammer prüfen; direkter Skizzen-Edit fehlt. |

## Skizzenbasiertes Editing und weitere Kandidaten

[Annahme] In dieser Recherche ließ sich kein 2024–2026-Kandidat mit geöffneten Primärquellen verifizieren, der zugleich (1) Handskizze als Edit-Signal annimmt, (2) nur eine lokale 3D-Region neu generiert und (3) den übrigen Bestand garantiert erhält. SKED, SketchDream und Magic3DSketch sollten daher nicht als fertige Lösung eingeplant werden, bevor offizielle Paper-/Code-/Lizenzseiten geprüft sind.

[Annahme] PartCrafter und SAMPart3D lösen komplementäre Probleme: ersterer erzeugt mehrere Teile aus einem Bild, letzterer zerlegt ein vorhandenes 3D-Modell. Keiner ersetzt den inkrementellen, skizzengeführten Editierschritt. TRELLIS.2 liefert hochwertige Geometrie, aber ist weder lokal noch in 8 GB realistisch.

## Empfehlung für SketchToCAD

### 1. Wahl: unveränderliche Teile + 3D-Masken-Edit als austauschbares Backend

[Annahme] Beibehalten des bereits getesteten Teilgraphen und SHA-256-Schutz der nicht bearbeiteten Teile. Neue Skizzenstriche zunächst in ein Zielteil oder einen neuen Anbau umwandeln; die nutzerseitige Skizze liefert Silhouette und Kontur, während Generator/3D-Editmodell die tatsächliche Geometrie erzeugt. Für Farbänderungen nur Material/Vertexfarben im Zielbereich ändern. Neue Teile als separate GLB-Knoten anfügen; niemals den gesamten Bestand exportseitig neu backen.

[geprüft] Für einen späteren GPU-Server-Prototyp VoxHammer ist der konkrete Kandidat, weil es Text, 3D-Eingabe und explizite 3D-Maske für lokales Editing verbindet. [Annahme] Skizze aus zwei oder mehr Kamerarichtungen in 3D-Maske und Edit-Referenzbilder projizieren; wenn nur eine Ansicht vorliegt, Tiefe als Nutzerentscheidung erfassen (Platzierungs-Gizmo/Extrusion), nicht vom Modell erraten lassen. Die exakte Erhaltung wird weiterhin durch separate Teildateien und Hashes abgesichert.

**Hardware/Lizenz:** [geprüft] VoxHammer nennt ≥40 GB VRAM; für vorhandene RTX 2070 daher nicht lokal lauffähig laut offizieller Anforderung. MIT-Code laut Repo, TRELLIS-Unterkomponente hat eigene Bedingungen; Gewichtsbedingungen vor Produktivbetrieb einzeln klären. [Annahme] Eine gemietete 48-GB-GPU könnte genügen, sofern verfügbar und kompatibel; Kosten wurden nicht verifiziert und sind hier bewusst nicht beziffert.

### 2. Wahl: SketchToCAD-Teilgenerator mit Multi-View-Assistenz

[Annahme] Kurzfristig für bestehende 8-GB-Umgebung: Skizze bleibt editierbar, das System generiert nur ein neues Teil und hängt es an, aber mit zwei expliziten Ansichten (Vorder- und Seitenansicht) plus Kontakt-/Tiefe-Gizmo. Zunächst darf ein lokaler Bild-zu-3D-Generator ein vollständiges Teil aus einem zusammengesetzten Referenzbild generieren; dessen Ausgabe wird beschnitten/ausgerichtet und als einzelner Knoten importiert. Das Modell erhält nie Schreibzugriff auf bestehende Teilmeshes. Diese Architektur garantiert Bestandserhaltung durch Datenmodell, nicht durch Diffusionsmodell.

[Annahme] Bei dünnen Flächen (Flügel) braucht es mindestens Seitenansicht oder Dickenregler, bei farbigen Änderungen Rückseitenfarbe separat definieren. Für langfristige Zerlegung kann SAMPart3D einmalig evaluiert werden; PartCrafter eignet sich als Baseline für initiale part-aware Generierung. Keine der beiden Methoden ist Voraussetzung für den ersten vertikalen Versuch.

## Erstes Experiment

1. [geprüft] Auf einer Miet-GPU mit mindestens 40 GB VRAM VoxHammer gemäß offiziellem Readme installieren; Kosten vor Buchung separat aktuell prüfen. Lokale RTX 2070 nicht als Zielgerät verwenden.
2. [geprüft] Das im Repository enthaltene `assets/example/model.glb` und zugehörige `mask.glb` mit Text-Pipeline testen; zuerst das unveränderte Beispiel reproduzieren.
3. [Annahme] Anschließend eine Katzenfigur als GLB und einen Flügel als neue, geschlossene 3D-Maske erstellen. Die Strichsilhouette aus Vorder- und Seitenansicht wird manuell in eine Maske/Gizmo-Position übersetzt; Textprompt beschreibt Material/Form.
4. Abnahmekriterium: [Annahme] neue Geometrie ist sichtbar verbunden und in beiden Ansichten plausibel; unmaskierte Oberfläche des alten Meshes nach Registrierung mit maximal 0,1 % Vertex-/Flächenabweichung; alle nicht betroffenen Teildateien byte-identisch (SHA-256 unverändert); Gesamtprozess auf der gemieteten GPU protokolliert.
5. [Annahme] Bei Fehlschlag in erster Linie Masken-/Inversionsstabilität und Modelllizenz klären. Der Produktpfad bleibt Teilgraph mit deterministischem Schutz; kein Wechsel zu vollständiger Modell-Neugenerierung.

## Geöffnete Quellen

- [VoxHammer Code/Readme und MIT-Lizenz](https://github.com/Nelipot-Lee/VoxHammer)
- [VoxHammer Paper](https://arxiv.org/abs/2508.19247)
- [TRELLIS.2 Code/Readme](https://github.com/microsoft/TRELLIS.2)
- [TRELLIS.2 Projektseite/Paper-Link](https://microsoft.github.io/TRELLIS.2/)
- [PartCrafter Code/Readme](https://github.com/wgsxm/PartCrafter)
- [PartCrafter Paper](https://arxiv.org/abs/2506.05573)
- [SAMPart3D Paper](https://arxiv.org/abs/2411.07184)
- [TRELLIS Code/Readme](https://github.com/microsoft/TRELLIS)
