import requests, json
VENUE_LAT = 13.0627
VENUE_LNG = 80.2791
FETCH_M = 800

query = f"""[out:json][timeout:25];
way["highway"]["name"](around:{FETCH_M},{VENUE_LAT},{VENUE_LNG});
out tags geom;"""

print('Fetching fresh OSM road data...')
res = requests.post('https://overpass-api.de/api/interpreter', data=query)
if res.status_code == 200:
    data = res.json()
    with open('frontend-organiser/osm_roads.json', 'w', encoding='utf-8') as f:
        json.dump(data, f)
    print(f"Successfully wrote {len(data.get('elements', []))} road elements to osm_roads.json")
else:
    print('Failed to fetch:', res.status_code, res.text)
