#!/usr/bin/env bash
# Variante A+: wartet auf data_procad, kopiert Daten + Code auf den Heim-PC und startet train_mix.py als systemd-Unit.
set -euo pipefail
H=janosch@100.86.99.105; K=~/.ssh/meshpad_ed25519; RUN=${RUN:-mix_v1}; EPOCHS=${EPOCHS:-20}
cd "$(dirname "$0")"
while pgrep -f "realdata.build_procad" >/dev/null; do sleep 30; done
test -f data_procad/meta.json || { echo "data_procad/meta.json fehlt – Aufbereitung fehlgeschlagen?"; exit 1; }
rsync -a -e "ssh -i $K" model_v2.py train_mix.py serve_v2.py $H:dev/sketchlab/
rsync -a -e "ssh -i $K" data_procad/sketch128.npy data_procad/vox64_packed.npy data_procad/meta.json $H:dev/sketchlab/data_procad/
ssh -i $K $H "cd ~/dev/sketchlab && rm -rf /tmp/mixtest && mkdir -p runs/$RUN/preview && ln -sfn ../runs/$RUN/preview web/preview && ln -sfn ../runs/$RUN/status.json web/status.json && \
  systemd-run --user --unit=sketchlab-train-$RUN --working-directory=\$HOME/dev/sketchlab \
  -E PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  \$HOME/dev/meshpad/.venv/bin/python -u train_mix.py --data data_real data_procad --out runs/$RUN --epochs $EPOCHS"
echo "gestartet $(date): journalctl --user -u sketchlab-train-$RUN -f · Dashboard http://100.86.99.105:8780/dashboard.html"
