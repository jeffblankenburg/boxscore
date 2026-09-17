import sys, json
from datetime import date, timedelta
from core import scoreboard_full, odds_devig, mult, pmap

def daterange(s,e):
    d=date.fromisoformat(s); end=date.fromisoformat(e); out=[]
    while d<=end: out.append(d.strftime('%Y%m%d')); d+=timedelta(days=1)
    return out

CFG={
 'mlb':   ('baseball','mlb','2024-03-28','2024-09-29'),
 'nba':   ('basketball','nba','2023-10-24','2024-04-14'),
 'nhl':   ('hockey','nhl','2023-10-10','2024-04-18'),
 'epl':   ('soccer','eng.1','2023-08-11','2024-05-19'),
 'mls':   ('soccer','usa.1','2024-02-21','2024-10-19'),
}
key=sys.argv[1]; sp,lg,s,e=CFG[key]
dates=daterange(s,e)
# fetch all games across dates (parallel over dates)
def fetch_date(dt): return scoreboard_full(sp,lg,f"dates={dt}")
chunks=pmap(fetch_date, dates, workers=12)
games=[g for ch in chunks for g in ch]
print(f"{key}: {len(games)} completed games over {len(dates)} dates", file=sys.stderr)
# fetch odds parallel
def fo(g):
    if g['hs']==g['as']: return None  # draw, no winner
    side='home' if g['hs']>g['as'] else 'away'
    return odds_devig(sp,lg,g['eid'],side)
probs=pmap(fo, games, workers=12)
# score
adj={}; wins={}; draws={}; noln=0; played={}
def acc(d,k,v): d[k]=d.get(k,0)+v
for g,p in zip(games,probs):
    acc(played,g['h'],1); acc(played,g['a'],1)
    if g['hs']==g['as']:
        acc(draws,g['h'],1); acc(draws,g['a'],1)
        acc(adj,g['h'],1/3); acc(adj,g['a'],1/3)  # draw = 1/3, flat
        continue
    win=g['h'] if g['hs']>g['as'] else g['a']
    m=mult(p)
    if m is None: noln+=1; m=1.0
    acc(wins,win,1); acc(adj,win,m)
teams=sorted(adj, key=lambda t:-adj[t])
res={'key':key,'games':len(games),'noln':noln,
     'adj':adj,'wins':wins,'draws':draws,'played':played}
json.dump(res, open(f'results/{key}_res.json','w'))
# compact summary
au=[adj[t] for t in teams]
print("%-4s  top: %s | median adj %.1f | min adj %.1f | noln %d/%d"%(
    key, ", ".join(f"{t}:{adj[t]:.1f}(W{wins.get(t,0)})" for t in teams[:5]),
    sorted(au)[len(au)//2], min(au), noln, len(games)))
