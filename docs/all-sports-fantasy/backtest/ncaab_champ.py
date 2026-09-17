import json,sys
from core import get, odds_devig, mult, pmap
def team_games(tid):
    d=get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/{tid}/schedule?season=2024")
    out=[]
    for e in d.get('events',[]):
        c=e['competitions'][0]
        if not c['status']['type'].get('completed'): continue
        cs=c['competitors']
        try:
            me=next(x for x in cs if x['team']['id']==str(tid))
            opp=next(x for x in cs if x['team']['id']!=str(tid))
            ms,os_=int(me['score']['value']),int(opp['score']['value'])
        except: 
            try:
                me=next(x for x in cs if x['team']['id']==str(tid)); opp=next(x for x in cs if x['team']['id']!=str(tid))
                ms,os_=int(me['score']),int(opp['score'])
            except: continue
        if ms<=os_: continue
        side=me['homeAway']
        out.append((e['id'],side))
    return out
for name,tid in [('UConn',41),('Duke',150),('Nevada(bubble)',2440)]:
    gs=team_games(tid)
    probs=pmap(lambda g: odds_devig('basketball','mens-college-basketball',g[0],g[1]), gs, workers=10)
    adj=sum(mult(p) if mult(p) is not None else 1.0 for p in probs)
    noln=sum(1 for p in probs if mult(p) is None)
    print(f"{name}: wins {len(gs)}  adj {adj:.1f}  (noln {noln})")
