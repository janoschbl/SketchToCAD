#!/usr/bin/env bash
# mix_v2: Weitertraining ab mix_v1 (best.pt) mit Möbeln (data_furn) + Objaverse (data_obja). Daten/Läufe auf /mnt/storage des Heim-PCs.
set -euo pipefail
H=janosch@100.86.99.105; K=~/.ssh/meshpad_ed25519; RUN=${RUN:-mix_v2}; EPOCHS=${EPOCHS:-8}; S=/mnt/storage/sketchlab_data
cd "$(dirname "$0")"
test -f data_furn/meta.json || { echo "data_furn/meta.json fehlt"; exit 1; }
rsync -a -e "ssh -i $K" data_furn/ $H:$S/data_furn/
rsync -a -e "ssh -i $K" data_obja/ $H:$S/data_obja/
ssh -i $K $H "cd ~/dev/sketchlab && mkdir -p $S/runs/$RUN/preview && ln -sfn $S/runs/$RUN runs/$RUN && ln -sfn $S/runs/$RUN/preview web/preview && ln -sfn $S/runs/$RUN/status.json web/status.json && \
  systemd-run --user --unit=sketchlab-train-$RUN --working-directory=\$HOME/dev/sketchlab \
  -E PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  \$HOME/dev/meshpad/.venv/bin/python -u train_mix.py --data data_real data_procad $S/data_furn $S/data_obja --out runs/$RUN --epochs $EPOCHS \
  --init runs/mix_v1/best.pt --lr 3e-4 --mix procad:0.35,obja:0.3,c2s:0.15,ds:0.2"
echo "gestartet $(date)"
