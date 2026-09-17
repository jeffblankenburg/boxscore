from nfl_fulltest import get, odds_for
import json,sys
games=[]  # (winner_abbr, devig_prob_or_None, round)  round='' for reg
def week(st,wk,rnd=''):
    d=get(f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2023&seasontype={st}&week={wk}")
    if not d: return
    for e in d.get('events',[]):
        c=e['competitions'][0]
        if not c['status']['type']['completed']: continue
        comps=c['competitors']
        h=next(x for x in comps if x['homeAway']=='home'); a=next(x for x in comps if x['homeAway']=='away')
        hs,as_=int(h['score']),int(a['score'])
        if hs==as_: continue
        side='home' if hs>as_ else 'away'
        wab=(h if side=='home' else a)['team']['abbreviation']
        p=odds_for('football','nfl',e['id'],side)
        games.append([wab,p,rnd])
for wk in range(1,19): week(2,wk); print('reg',wk,len(games),file=sys.stderr)
for wk,r in [(1,'WC'),(2,'DIV'),(3,'CONF'),(5,'SB')]: week(3,wk,r)
json.dump(games, open('results/nfl2023_games.json','w'))
print('saved',len(games),'games; with-line:',sum(1 for g in games if g[1] is not None))
