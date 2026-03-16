import json
import urllib.request
url = 'http://localhost:8000/api/predict'
data = {
  "city": "warszawa",
  "latitude": 52.2297,
  "longitude": 21.0122,
  "squareMeters": 50,
  "rooms": 2,
  "floor": 1,
  "floorCount": 4,
  "hasParkingSpace": False,
  "hasBalcony": False,
  "hasElevator": False,
  "hasSecurity": False,
  "hasStorageRoom": False,
  "type_apartmentBuilding": True,
  "type_blockOfFlats": False,
  "type_tenement": False,
  "building_age": 12,
  "rooms_per_m2": 0.04
}
req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode('utf-8')
        print('Status:', resp.status)
        print(body)
except Exception as e:
  try:
    # If HTTPError, print body
    body = e.read().decode('utf-8')
    print('Request HTTP error body:', body)
  except Exception:
    print('Request error:', e)
