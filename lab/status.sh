#!/usr/bin/env bash
# Status des Trainings auf dem Heim-PC: ./status.sh   (Dashboard: http://100.86.99.105:8780/dashboard.html)
ssh -i ~/.ssh/meshpad_ed25519 janosch@100.86.99.105 'cat ~/dev/sketchlab/runs/${1:-base}/status.json' | python3 -c "
import json,sys,time
j=json.load(sys.stdin);h=j['hist'];l=h[-1] if h else {}
p=j['step']/j['total']*100;e=j['eta_s']
print(f\"{j['run']} [{j['state']}] {p:.1f}%  Epoche {j['epoch']}/{j['epochs']}  Rest ~{(e or 0)/60:.0f} min\")
print('loss',round(j.get('loss',0),3),' val IoU',round(l.get('iou',0),3),' info',round(l.get('iou_info',0),3),' einfach',l.get('iou_simple'))"
