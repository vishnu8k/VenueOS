import urllib.request
import urllib.error
import urllib.parse
import json

query = b'[out:json][timeout:25];way["name"](around:1500,13.0627,80.2791);out tags geom;'
req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=query, method='POST')
try:
    with urllib.request.urlopen(req) as res:
        data = res.read()
        print('Status:', res.status)
        js = json.loads(data)
        print('Elements:', len(js.get('elements', [])))
except urllib.error.HTTPError as e:
    print('HTTPError:', e.code, e.reason)
except Exception as e:
    print('Error:', e)
