import json, subprocess, sys, time

def get(url, tries=3):
    for i in range(tries):
        try:
            out=subprocess.run(['curl','-s','--compressed','--max-time','15',url],
                               capture_output=True, text=True, timeout=20)
            if out.returncode==0 and out.stdout.strip():
                return json.loads(out.stdout)
        except Exception:
            pass
        time.sleep(0.4)
    return None

def implied(ml):
    if ml is None: return None
    ml=float(ml)
    return (-ml)/(-ml+100) if ml<0 else 100/(ml+100)

def devig(home_ml, away_ml, side):
    ph,pa=implied(home_ml),implied(away_ml)
    if ph is None or pa is None: return None
    s=ph+pa
    return (ph/s) if side=='home' else (pa/s)

def mult(p):
    if p is None: return 1.0
    if p>=0.715: return 0.7
    if p>=0.60:  return 0.85
    if p>=0.524: return 1.0
    if p>=0.476: return 1.15
    if p>=0.286: return 1.4
    return 1.8

def odds_for(sportpath, league, eid, side):
    d=get(f"https://sports.core.api.espn.com/v2/sports/{sportpath}/leagues/{league}/events/{eid}/competitions/{eid}/odds")
    if not d: return None
    items=d.get('items',[])
    prefer=['DraftKings','Caesars Sportsbook','ESPN BET','Caesars Sportsbook (New Jersey)']
    it=None
    for name in prefer:
        for x in items:
            if x.get('provider',{}).get('name')==name and (x.get('homeTeamOdds') or {}).get('moneyLine') is not None:
                it=x; break
        if it: break
    if not it:
        for x in items:
            if (x.get('homeTeamOdds') or {}).get('moneyLine') is not None: it=x; break
    if not it: return None
    return devig((it['homeTeamOdds'] or {}).get('moneyLine'),(it['awayTeamOdds'] or {}).get('moneyLine'), side)

def run_nfl_2023():
    teams={}
    def rec(a): return teams.setdefault(a,{'w':0,'adj':0.0,'noln':0,'po':{}})
    def week(st, wk, rnd=None):
        d=get(f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2023&seasontype={st}&week={wk}")
        if not d: return 0
        n=0
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
            r=rec(wab)
            if rnd is None:
                r['w']+=1; r['adj']+=mult(p)
                if p is None: r['noln']+=1
            else:
                r['po'][rnd]=r['po'].get(rnd,0)+1
            n+=1
        return n
    tot=0
    for wk in range(1,19):
        tot+=week(2,wk); print(f"  reg wk{wk}: total {tot}", file=sys.stderr)
    for wk,rnd in [(1,'WC'),(2,'DIV'),(3,'CONF'),(5,'SB')]:
        week(3,wk,rnd)
    json.dump(teams, open('results/nfl2023.json','w'))
    return teams

if __name__=='__main__':
    t=run_nfl_2023()
    rows=sorted(t.items(), key=lambda kv:-kv[1]['adj'])
    print("\n%-4s %3s %7s %5s  %s"%("TM","W","ADJ","noln","PO"))
    for ab,d in rows:
        print("%-4s %3d %7.2f %5d  %s"%(ab,d['w'],d['adj'],d['noln'],",".join(f"{k}{v}" for k,v in d['po'].items())))
    adj=[d['adj'] for d in t.values()]
    print("\nteams %d | ADJ win-units  max %.2f  median %.2f  min %.2f | flat wins max %d min %d"%(
        len(t),max(adj),sorted(adj)[len(adj)//2],min(adj),max(d['w'] for d in t.values()),min(d['w'] for d in t.values())))
