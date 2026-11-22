#!/usr/bin/env bash
# Dashboard (Heim-PC, Port 8780) auf einen Trainingslauf zeigen lassen: ./setrun.sh <run-name>
R=${1:?run-name}
ssh -i ~/.ssh/meshpad_ed25519 janosch@100.86.99.105 "cd ~/dev/sketchlab/web && mkdir -p ../runs/$R/preview && ln -sfn ../runs/$R/status.json status.json && ln -sfn ../runs/$R/preview preview && ls -l"
