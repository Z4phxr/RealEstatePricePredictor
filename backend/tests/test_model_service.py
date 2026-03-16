from app.model_service import FEATURE_COLUMNS, align_for_model, payload_to_dataframe


def test_payload_to_dataframe_single_row():
    payload = {"city": "warszawa", "squareMeters": 52}
    df = payload_to_dataframe(payload)

    assert df.shape == (1, 2)
    assert df.iloc[0]["city"] == "warszawa"
    assert df.iloc[0]["squareMeters"] == 52


def test_align_for_model_enforces_schema_order_and_city_dummies():
    payload = {
        "city": "warszawa",
        "squareMeters": "52",
        "rooms": "2",
        "floor": "3",
        "floorCount": "7",
        "latitude": "52.2297",
        "longitude": "21.0122",
        "centreDistance": "2.1",
        "poiCount": "320",
        "schoolDistance": "0.7",
        "clinicDistance": "1.2",
        "postOfficeDistance": "0.9",
        "kindergartenDistance": "0.8",
        "restaurantDistance": "0.4",
        "collegeDistance": "1.8",
        "pharmacyDistance": "0.5",
        "hasParkingSpace": True,
        "hasBalcony": True,
        "hasElevator": True,
        "hasSecurity": False,
        "hasStorageRoom": False,
        "building_age": "12",
        "nearset_poi_distance": "0.4",
        "poi_sum_distance": "6.3",
        "rooms_per_m2": "0.03846",
        "type_apartmentBuilding": True,
        "type_blockOfFlats": False,
        "type_tenement": False,
        "type_unknown": True,
    }

    aligned = align_for_model(payload_to_dataframe(payload))

    assert aligned.shape == (1, len(FEATURE_COLUMNS))
    assert aligned.columns.tolist() == FEATURE_COLUMNS
    assert bool(aligned.iloc[0]["type_unknown"]) is False
    assert bool(aligned.iloc[0]["city_warszawa"]) is True
    assert bool(aligned.iloc[0]["city_krakow"]) is False
    assert float(aligned.iloc[0]["squareMeters"]) == 52.0


def test_align_for_model_normalizes_polish_city_name_to_dummy():
    payload = {
        "city": "Łódź",
        "squareMeters": 50,
        "rooms": 2,
        "floor": 1,
        "floorCount": 4,
        "latitude": 51.7592,
        "longitude": 19.455,
    }

    aligned = align_for_model(payload_to_dataframe(payload))

    assert bool(aligned.iloc[0]["city_lodz"]) is True
    assert bool(aligned.iloc[0]["city_warszawa"]) is False


def test_align_for_model_unknown_city_keeps_all_city_dummies_false():
    payload = {
        "city": "unknown-city",
        "squareMeters": 40,
        "rooms": 1,
        "floor": 2,
        "floorCount": 5,
        "latitude": 50.0,
        "longitude": 19.0,
    }

    aligned = align_for_model(payload_to_dataframe(payload))

    city_cols = [c for c in FEATURE_COLUMNS if c.startswith("city_")]
    assert not any(bool(aligned.iloc[0][c]) for c in city_cols)
