#!/usr/bin/env bash
# Daten + Code auf den Heim-PC kopieren und Training real_v1 als systemd-Unit starten.
set -euo pipefail
H=janosch@100.86.99.105; K=~/.ssh/meshpad_ed25519; RUN=${RUN:-real_v1}; EPOCHS=${EPOCHS:-150}
cd "$(dirname "$0")"
rsync -a -e "ssh -i $K" model_v2.py train_real.py serve_v2.py $H:dev/sketchlab/
rsync -a -e "ssh -i $K" data_real/sketch128.npy data_real/vox64_packed.npy data_real/meta.json data_real/ood $H:dev/sketchlab/data_real/
ssh -i $K $H "cd ~/dev/sketchlab && mkdir -p runs/$RUN/preview && ln -sfn ../runs/$RUN/preview web/preview && ln -sfn ../runs/$RUN/status.json web/status.json && \
  systemd-run --user --unit=sketchlab-train-$RUN --working-directory=\$HOME/dev/sketchlab \
  -E PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  \$HOME/dev/meshpad/.venv/bin/python -u train_real.py --data data_real --out runs/$RUN --epochs $EPOCHS"
echo "gestartet: journalctl --user -u sketchlab-train-$RUN -f   ·   Dashboard http://100.86.99.105:8780/dashboard.html"
