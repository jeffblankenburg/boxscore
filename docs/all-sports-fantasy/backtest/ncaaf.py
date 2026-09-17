import json,sys
from core import get, odds_devig, mult, pmap
games=[]
def wk(w):
    d=get(f"https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=2024&seasontype=2&week={w}&groups=80&limit=400")
    out=[]
    if not d: return out
    for e in d.get('events',[]):
        c=e['competitions'][0]
        if not c['status']['type']['completed']: continue
        cs=c['competitors']
        try:
            h=next(x for x in cs if x['homeAway']=='home');a=next(x for x in cs if x['homeAway']=='away')
            hs,as_=int(h['score']),int(a['score'])
        except: continue
        if hs==as_: continue
        side='home' if hs>as_ else 'away'
        out.append((e['id'],(h if side=='home' else a)['team']['abbreviation'],side))
    return out
for w in range(1,16):
    games+=wk(w); print('wk',w,len(games),file=sys.stderr)
def fo(g): return odds_devig('football','college-football',g[0],g[2])
probs=pmap(fo,games,workers=12)
adj={};wins={};noln=0
for (eid,ab,side),p in zip(games,probs):
    m=mult(p)
    if m is None: noln+=1;m=1.0
    adj[ab]=adj.get(ab,0)+m; wins[ab]=wins.get(ab,0)+1
json.dump({'adj':adj,'wins':wins,'noln':noln,'games':len(games)},open('results/ncaaf_res.json','w'))
t=sorted(adj,key=lambda x:-adj[x])
print("ncaaf top:", ", ".join(f"{x}:{adj[x]:.1f}(W{wins[x]})" for x in t[:6]), "| noln",noln,"/",len(games))
