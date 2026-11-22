#!/usr/bin/env bash
# Objaverse verteilt: Laptop rechnet Shards 5-9/10 (nach procad-Aufbereitung + Trainingsstart), Heim-PC 0-4/10 (Unit sgen-obja).
# Holt fertige Dateien vom Heim-PC (/tmp = RAM) alle 3 Min. nach out/obja_pc und löscht sie dort.
cd "$(dirname "$0")"; H=janosch@100.86.99.105; K=~/.ssh/meshpad_ed25519
pull() {
  while true; do
    ssh -i $K $H 'cd /tmp/obja_pc 2>/dev/null && find . -mindepth 2 -type f -mmin +2' > .obja_pull.lst 2>/dev/null
    [ -s .obja_pull.lst ] && rsync -a --remove-source-files --files-from=.obja_pull.lst -e "ssh -i $K" $H:/tmp/obja_pc/ out/obja_pc/
    rsync -a -e "ssh -i $K" "$H:/tmp/obja_pc/*.txt" "$H:/tmp/obja_pc/*.jsonl" out/obja_pc/ 2>/dev/null
    sleep 180
  done
}
mkdir -p out/obja_pc; pull &
while pgrep -f "start_mix.sh" >/dev/null || pgrep -f "realdata.build_procad" >/dev/null; do sleep 30; done
.venv/bin/python -u -m sketchgen.objaverse_stream --out out/obja_lap --target 10000 --views 2 --batch 100 --workers 13 --train --shard 5,6,7,8,9/10
wait
