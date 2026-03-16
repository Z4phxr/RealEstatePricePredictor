import json
import unicodedata
from pathlib import Path

import pandas as pd

FEATURE_COLUMNS = [
    "squareMeters",
    "rooms",
    "floor",
    "floorCount",
    "latitude",
    "longitude",
    "centreDistance",
    "poiCount",
    "schoolDistance",
    "clinicDistance",
    "postOfficeDistance",
    "kindergartenDistance",
    "restaurantDistance",
    "collegeDistance",
    "pharmacyDistance",
    "hasParkingSpace",
    "hasBalcony",
    "hasElevator",
    "hasSecurity",
    "hasStorageRoom",
    "building_age",
    "nearset_poi_distance",
    "poi_sum_distance",
    "rooms_per_m2",
    "type_apartmentBuilding",
    "type_blockOfFlats",
    "type_tenement",
    "type_unknown",
    "city_bialystok",
    "city_bydgoszcz",
    "city_czestochowa",
    "city_gdansk",
    "city_gdynia",
    "city_katowice",
    "city_krakow",
    "city_lodz",
    "city_lublin",
    "city_poznan",
    "city_radom",
    "city_rzeszow",
    "city_szczecin",
    "city_warszawa",
    "city_wroclaw",
]

CITY_DUMMY_COLS = [c for c in FEATURE_COLUMNS if c.startswith("city_")]
BOOL_COLUMNS = [
    "hasParkingSpace",
    "hasBalcony",
    "hasElevator",
    "hasSecurity",
    "hasStorageRoom",
    "type_apartmentBuilding",
    "type_blockOfFlats",
    "type_tenement",
    "type_unknown",
    *CITY_DUMMY_COLS,
]


def normalize_city(value: str) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("ł", "l")
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def payload_to_dataframe(payload: dict) -> pd.DataFrame:
    return pd.DataFrame([payload]).copy()


def align_for_model(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()

    # Requested behavior: always False.
    result["type_unknown"] = False

    city_value = normalize_city(result.iloc[0].get("city", ""))
    for col in CITY_DUMMY_COLS:
        result[col] = (col == f"city_{city_value}")

    for col in FEATURE_COLUMNS:
        if col not in result.columns:
            result[col] = False if col in BOOL_COLUMNS else 0.0

    # Ensure stable model schema and ordering.
    result = result[FEATURE_COLUMNS]

    # Normalize booleans and numeric fields.
    for col in BOOL_COLUMNS:
        result[col] = result[col].fillna(False).astype(bool)

    numeric_cols = [c for c in FEATURE_COLUMNS if c not in BOOL_COLUMNS]
    for col in numeric_cols:
        result[col] = pd.to_numeric(result[col], errors="coerce").fillna(0.0)

    return result


if __name__ == "__main__":
    test_path = Path(__file__).resolve().parents[2] / "test.json"
    with test_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    df = payload_to_dataframe(payload)
    aligned = align_for_model(df)
    print(aligned)
    print("shape:", aligned.shape)
    print(aligned.columns.tolist())
