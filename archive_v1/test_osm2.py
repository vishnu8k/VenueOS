import urllib.request
import json
query = b'[out:json][timeout:25];way["name"](around:1500,13.0627,80.2791);out tags geom;'
req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=query, method='POST')
with urllib.request.urlopen(req) as res:
    js = json.loads(res.read())
    if js.get('elements'):
        for el in js['elements']:
            if 'geometry' in el:
                print('Example geom:', el['geometry'][0])
                break
