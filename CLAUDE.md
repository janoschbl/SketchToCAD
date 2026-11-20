# SketchToCAD – Hinweise für Claude

- **Sub-Agents sind immer GPT-6-Luna-Agents.** Jedes Mal, wenn ein Sub-Agent/Delegate gestartet wird, über `delegate_task` mit `target: { providerInstanceId: "codex", model: "gpt-6-luna" }` (Reasoning-Effort standardmäßig `high` für Recherche). Keine native Claude-`Agent`-Subagents für Recherche oder Arbeitsaufträge verwenden.
- README und Dokumentation auf Deutsch schreiben; Quellen immer mit Link angeben und nur Links aufnehmen, die tatsächlich geöffnet/verifiziert wurden.
- Repo: <https://github.com/janoschbl/SketchToCAD>
