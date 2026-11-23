"""People for the fakeprint training set, from Deezer's related artists.

Starts from artists known to be people (the earlier samples), walks Deezer's "related artists",
and keeps an artist only if Deezer lists an album or single of theirs released in 2018 or earlier:
music from before AI music generators existed is made by people (the investigator's own pre-2020
rule, with a year's margin). Artists on any AI list are never kept.

Usage: .venv/bin/python human_crawl.py <seeds.json> <ai-artists.json> <out.json> [--max N]
"""
import argparse
import collections
import json
import urllib.parse

from sample import get, norm


def first_year(artist_id):
    albums = get(f'https://api.deezer.com/artist/{artist_id}/albums?limit=100').get('data') or []
    years = [int(a['release_date'][:4]) for a in albums if (a.get('release_date') or '')[:4].isdigit()]
    return min(years) if years else None


def find(name):
    found = get(f'https://api.deezer.com/search/artist?q={urllib.parse.quote(name)}&limit=10').get('data') or []
    ids = {a['id'] for a in found if norm(a.get('name')) == norm(name)}
    return next(iter(ids)) if len(ids) == 1 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('seeds'); ap.add_argument('ai'); ap.add_argument('out'); ap.add_argument('--max', type=int, default=2000)
    a = ap.parse_args()
    ai = {norm(r['name']) for r in json.load(open(a.ai))['artists']}
    seeds = [r['name'] for r in json.load(open(a.seeds))['artists']]
    queue = collections.deque(i for i in (find(n) for n in seeds) if i)
    seen, kept = set(queue), []
    while queue and len(kept) < a.max:
        aid = queue.popleft()
        try:
            related = get(f'https://api.deezer.com/artist/{aid}/related?limit=20').get('data') or []
        except Exception:
            continue
        for r in related:
            if r['id'] in seen:
                continue
            seen.add(r['id'])
            queue.append(r['id'])
            if norm(r.get('name')) in ai:
                continue
            try:
                y = first_year(r['id'])
            except Exception:
                continue
            if y is not None and y <= 2018:
                kept.append({'name': r['name'], 'deezerId': r['id'], 'firstYear': y})
                if len(kept) % 100 == 0:
                    json.dump({'artists': kept}, open(a.out, 'w'))
                    print(f'{len(kept)}/{a.max} people', flush=True)
            if len(kept) >= a.max:
                break
    json.dump({'artists': kept}, open(a.out, 'w'))
    print(f'done: {len(kept)} people', flush=True)


if __name__ == '__main__':
    main()
