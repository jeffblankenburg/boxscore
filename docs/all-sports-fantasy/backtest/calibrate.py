import json
from core import mult, MEDIUM
# NFL from per-game file (medium curve)
g=json.load(open('results/nfl2023_games.json'))
nfl_adj={}; nfl_w={}
for wab,p,rnd in g:
    if rnd=='' and wab:
        nfl_adj[wab]=nfl_adj.get(wab,0)+mult(p); nfl_w[wab]=nfl_w.get(wab,0)+1
def load(k):
    r=json.load(open(f'results/{k}_res.json')); return r['adj'], r.get('wins',{})
data={'nfl':(nfl_adj,nfl_w)}
for k in ['mlb','nba','nhl','epl','mls']:
    data[k]=load(k)
# champion abbr + playoff wins (rounds) + whether table-title (no playoff)
champ={'nfl':('KC',4,False),'mlb':('LAD',13,False),'nba':('BOS',16,False),
       'nhl':('FLA',16,False),'epl':('MNC',0,True),'mls':('LA',6,False)}
print("%-5s %-5s %7s %7s %7s %7s %8s %7s"%("LG","CHMP","chAdj","bestAdj","medAdj","B/win","chReg","PObonus"))
ideal={}
for k,(adj,w) in data.items():
    cab,powins,table=champ[k]
    vals=sorted(adj.values(),reverse=True)
    best=vals[0]; med=vals[len(vals)//2]; cadj=adj.get(cab,0)
    if table:
        B=1000/cadj; chreg=1000; pob=0
    else:
        B=700/best; chreg=cadj*B; pob=1000-chreg
    ideal[k]=(round(B,1),round(pob))
    print("%-5s %-5s %7.1f %7.1f %7.1f %7.1f %8.0f %7.0f"%(k,cab,cadj,best,med,B,chreg,pob))
print("\nideal per-win base + playoff-run bonus to reach ~1000:")
for k,(B,pob) in ideal.items(): print(f"  {k}: {B}/win  +{pob} for the title run")
