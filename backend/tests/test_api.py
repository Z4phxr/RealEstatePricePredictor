from fastapi.testclient import TestClient

import app.main as main_module


def _predict_payload():
    return {
        "squareMeters": 52,
        "rooms": 2,
        "floor": 3,
        "floorCount": 7,
        "latitude": 52.2297,
        "longitude": 21.0122,
        "centreDistance": 2.1,
        "poiCount": 320,
        "schoolDistance": 0.7,
        "clinicDistance": 1.2,
        "postOfficeDistance": 0.9,
        "kindergartenDistance": 0.8,
        "restaurantDistance": 0.4,
        "collegeDistance": 1.8,
        "pharmacyDistance": 0.5,
        "hasParkingSpace": True,
        "hasBalcony": True,
        "hasElevator": True,
        "hasSecurity": False,
        "hasStorageRoom": False,
        "building_age": 12,
        "nearset_poi_distance": 0.4,
        "poi_sum_distance": 6.3,
        "rooms_per_m2": 0.03846,
        "type_apartmentBuilding": True,
        "type_blockOfFlats": False,
        "type_tenement": False,
        "type_unknown": False,
        "city": "warszawa",
    }


def test_health_endpoint():
    client = TestClient(main_module.app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_dataset_endpoints_with_mocked_loader(monkeypatch):
    client = TestClient(main_module.app)

    rows = [
        {
            "id": "x1",
            "city": "Warszawa",
            "squareMeters": 50.0,
            "rooms": 2.0,
            "floor": 3.0,
            "floorCount": 7.0,
            "latitude": 52.2,
            "longitude": 21.0,
        }
    ]
    profiles = [
        {
            "city": "Warszawa",
            "cityKey": "warszawa",
            "centerLat": 52.2,
            "centerLng": 21.0,
            "radiusMeters": 15000,
            "polygon": [[52.1, 20.9], [52.1, 21.1], [52.3, 21.1], [52.3, 20.9]],
        }
    ]
    monkeypatch.setattr(main_module, "load_dataset_if_needed", lambda: (rows, profiles))

    apartments_resp = client.get("/api/apartments")
    assert apartments_resp.status_code == 200
    apartments = apartments_resp.json()
    assert len(apartments) == 1
    assert apartments[0]["city"] == "Warszawa"

    profiles_resp = client.get("/api/cities/profiles")
    assert profiles_resp.status_code == 200
    payload = profiles_resp.json()
    assert payload["count"] == 1
    assert payload["items"][0]["cityKey"] == "warszawa"


def test_predict_uses_loaded_model(monkeypatch):
    client = TestClient(main_module.app)

    class DummyModel:
        def predict(self, X):
            return [12345.67]

    monkeypatch.setattr(main_module, "load_prediction_model", lambda: DummyModel())
    monkeypatch.setattr(main_module, "loaded_model_path", "model.joblib")

    response = client.post("/api/predict", json=_predict_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["predictedPrice"] == 12345.67
    assert body["modelVersion"].startswith("joblib:")


def test_predict_fallback_when_model_unavailable(monkeypatch):
    client = TestClient(main_module.app)

    monkeypatch.setattr(main_module, "load_prediction_model", lambda: None)
    monkeypatch.setattr(main_module, "model_load_error", "ModuleNotFoundError: catboost")

    response = client.post("/api/predict", json=_predict_payload())
    assert response.status_code == 503
    body = response.json()
    assert body["detail"].startswith("prediction-model-unavailable")


def test_poi_fetch_server_cache_hit(monkeypatch):
    client = TestClient(main_module.app)

    monkeypatch.setattr(
        main_module,
        "get_cache_entry",
        lambda _key: {"updatedAt": 123, "points": [{"name": "X", "lat": 52.2, "lng": 21.0}]},
    )
    monkeypatch.setattr(main_module, "is_fresh", lambda _entry: True)

    payload = {
        "poiType": "pharmacy",
        "city": "warszawa",
        "centerLat": 52.2297,
        "centerLng": 21.0122,
        "radiusMeters": 20000,
        "polygon": [[52.1, 20.9], [52.1, 21.1], [52.3, 21.1], [52.3, 20.9]],
        "forceRefresh": False,
    }

    response = client.post("/api/poi/fetch", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["cacheHit"] is True
    assert body["source"] == "server-cache"
    assert len(body["points"]) == 1


def test_poi_cache_status_endpoint(monkeypatch):
    client = TestClient(main_module.app)

    monkeypatch.setattr(
        main_module,
        "load_cache",
        lambda: {
            "entries": {
                "warszawa::pharmacy": {
                    "updatedAt": int(main_module.time.time()),
                    "points": [{"name": "A", "lat": 52.1, "lng": 21.0}],
                }
            },
            "failed": {"warszawa::pharmacy": int(main_module.time.time())},
        },
    )

    response = client.get("/api/poi/cache/status")
    assert response.status_code == 200
    body = response.json()
    assert body["totalEntries"] == 1
    item = body["items"][0]
    assert item["cityKey"] == "warszawa"
    assert item["poiType"] == "pharmacy"
    assert item["pointCount"] == 1
    assert item["isFresh"] is True
    assert item["isInCooldown"] is True
