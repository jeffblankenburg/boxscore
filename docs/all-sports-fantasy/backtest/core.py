import json, subprocess, time
from concurrent.futures import ThreadPoolExecutor

def _curl(url):
    try:
        out=subprocess.run(['curl','-s','--compressed','--max-time','15',url],
                           capture_output=True, text=True, timeout=20)
        if out.returncode==0 and out.stdout.strip():
            return json.loads(out.stdout)
    except Exception:
        return None
    return None

def get(url, tries=3):
    for i in range(tries):
        d=_curl(url)
        if d is not None: return d
        time.sleep(0.3)
    return None

def pmap(fn, items, workers=10):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(fn, items))

def implied(ml):
    if ml is None: return None
    ml=float(ml); return (-ml)/(-ml+100) if ml<0 else 100/(ml+100)

def devig(hml,aml,side):
    ph,pa=implied(hml),implied(aml)
    if ph is None or pa is None: return None
    s=ph+pa; return (ph/s) if side=='home' else (pa/s)

MEDIUM=[(0.715,0.85),(0.60,0.92),(0.524,1.0),(0.476,1.1),(0.286,1.25),(0,1.5)]
def mult(p,curve=MEDIUM):
    if p is None: return None
    for thr,val in curve:
        if p>=thr: return val
    return 1.0

def odds_devig(sportpath,league,eid,side):
    d=get(f"https://sports.core.api.espn.com/v2/sports/{sportpath}/leagues/{league}/events/{eid}/competitions/{eid}/odds")
    if not d: return None
    items=d.get('items',[])
    prefer=['DraftKings','ESPN BET','Caesars Sportsbook','Caesars Sportsbook (New Jersey)','William Hill (New Jersey)']
    it=None
    for nm in prefer:
        for x in items:
            if x.get('provider',{}).get('name')==nm and (x.get('homeTeamOdds') or {}).get('moneyLine') is not None:
                it=x;break
        if it:break
    if not it:
        for x in items:
            if (x.get('homeTeamOdds') or {}).get('moneyLine') is not None: it=x;break
    if not it: return None
    return devig((it['homeTeamOdds'] or {}).get('moneyLine'),(it['awayTeamOdds'] or {}).get('moneyLine'),side)

def scoreboard_games(sportpath,league,params):
    # returns list of (eid, winner_abbr, side, seasontype)
    d=get(f"https://site.api.espn.com/apis/site/v2/sports/{sportpath}/{league}/scoreboard?{params}")
    out=[]
    if not d: return out
    st=(d.get('season') or {}).get('type')
    for e in d.get('events',[]):
        c=e['competitions'][0]
        if not c['status']['type']['completed']: continue
        comps=c['competitors']
        try:
            h=next(x for x in comps if x['homeAway']=='home'); a=next(x for x in comps if x['homeAway']=='away')
            hs,as_=int(h['score']),int(a['score'])
        except Exception: continue
        if hs==as_:
            out.append((e['id'],None,'draw',st)); continue
        side='home' if hs>as_ else 'away'
        wab=(h if side=='home' else a)['team']['abbreviation']
        out.append((e['id'],wab,side,st))
    return out

def scoreboard_full(sportpath,league,params):
    # returns list of dicts with both teams
    d=get(f"https://site.api.espn.com/apis/site/v2/sports/{sportpath}/{league}/scoreboard?{params}")
    out=[]
    if not d: return out
    for e in d.get('events',[]):
        c=e['competitions'][0]
        if not c['status']['type']['completed']: continue
        comps=c['competitors']
        try:
            h=next(x for x in comps if x['homeAway']=='home'); a=next(x for x in comps if x['homeAway']=='away')
            hs,as_=int(h['score']),int(a['score'])
        except Exception: continue
        out.append({'eid':e['id'],'h':h['team']['abbreviation'],'a':a['team']['abbreviation'],
                    'hs':hs,'as':as_})
    return out
