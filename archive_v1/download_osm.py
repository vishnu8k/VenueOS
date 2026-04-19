import urllib.request
import json
import time

query = b'[out:json][timeout:25];way["name"](around:1500,13.0627,80.2791);out tags geom;'
endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]

success = False
for ep in endpoints:
    print('Trying', ep)
    req = urllib.request.Request(ep, data=query, method='POST', headers={'User-Agent': 'VenueOS/1.0 (Hackathon)'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            with open('frontend-organiser/osm_roads.json', 'wb') as f:
                f.write(res.read())
            print('Success from', ep)
            success = True
            break
    except Exception as e:
        print('Failed:', e)
        time.sleep(1)

if not success:
    exit(1)
