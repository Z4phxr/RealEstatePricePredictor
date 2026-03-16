import json
import csv
import math
import os
import threading
import time
import unicodedata
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple, Any
from urllib import error, parse, request

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import joblib

from .model_service import payload_to_dataframe, align_for_model

app = FastAPI(title="price-api", version="0.2.0")


def parse_allowed_origins(raw: str) -> List[str]:
    values = [item.strip() for item in (raw or "").split(",") if item.strip()]
    return values or ["*"]


allowed_origins = parse_allowed_origins(os.getenv("ALLOWED_ORIGINS", "*"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

CACHE_TTL_SECONDS = 60 * 60 * 24 * 7
FAILED_COOLDOWN_SECONDS = 60 * 10
OVERPASS_TIMEOUT_SECONDS = 30
OVERPASS_MAX_CONCURRENCY = 3
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

POI_TYPE = Literal["college", "school", "clinic", "postOffice", "restaurant", "pharmacy", "kindergarten"]

POI_CONFIG: Dict[str, Dict[str, object]] = {
    "college": {
        "overpass_selector": '"amenity"~"^(university|college)$"',
        "include": ["uniwersytet", "politechnika", "akademia"],
        "exclude": ["wydzial", "instytut", "katedra", "centrum", "biblioteka", "akademik", "campus", "filia"],
    },
    "school": {
        "overpass_selector": '"amenity"="school"',
        "include": ["szkola", "liceum", "technikum", "zespol szkol", "podstawowa"],
        "exclude": [],
    },
    "clinic": {
        "overpass_selector": '"amenity"="hospital"',
        "include": ["szpital"],
        "exclude": [],
    },
    "postOffice": {
        "overpass_selector": '"amenity"~"^(post_office|post_depot)$"',
        "include": ["poczta", "pocztowy", "urzad pocztowy", "poczta polska"],
        "exclude": [],
    },
    "restaurant": {
        "overpass_selector": '"amenity"="restaurant"',
        "include": ["restauracja", "restaurant"],
        "exclude": [],
    },
    "pharmacy": {
        "overpass_selector": '"amenity"="pharmacy"',
        "include": ["apteka"],
        "exclude": [],
    },
    "kindergarten": {
        "overpass_selector": '"amenity"~"^(kindergarten|childcare)$"',
        "include": ["przedszkole", "zlobek"],
        "exclude": [],
    },
}

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "poi_cache.json"
CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

DATA_CSV_CANDIDATES = [
    Path("/app/source_data/data.csv"),
    Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "data.csv",
]

cache_lock = threading.Lock()
overpass_semaphore = threading.Semaphore(OVERPASS_MAX_CONCURRENCY)
dataset_lock = threading.Lock()
dataset_cache: Dict[str, Any] = {
    "path": None,
    "mtime": None,
    "rows": [],
    "profiles": [],
}

MODEL_PATH_CANDIDATES = [
    os.getenv("MODEL_PATH", "").strip(),
    str(Path("/app/model.joblib")),
    str(Path(__file__).resolve().parents[2] / "model.joblib"),
]

FRONTEND_DIST_CANDIDATES = [
    Path("/app/frontend_dist"),
    Path(__file__).resolve().parents[2] / "frontend" / "dist",
]

loaded_model = None
loaded_model_path = None
model_load_error = None


def find_frontend_dist() -> Optional[Path]:
    for candidate in FRONTEND_DIST_CANDIDATES:
        if (candidate / "index.html").exists():
            return candidate
    return None


frontend_dist_path = find_frontend_dist()
if frontend_dist_path:
    assets_dir = frontend_dist_path / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    data_dir = frontend_dist_path / "data"
    if data_dir.exists():
        app.mount("/data", StaticFiles(directory=data_dir), name="data")


def load_prediction_model():
    global loaded_model, loaded_model_path, model_load_error
    if loaded_model is not None:
        return loaded_model
    if model_load_error is not None:
        return None

    for candidate in MODEL_PATH_CANDIDATES:
        if not candidate:
            continue
        path = Path(candidate)
        if not path.exists():
            continue
        try:
            loaded_model = joblib.load(path)
            loaded_model_path = str(path)
            return loaded_model
        except Exception as exc:
            model_load_error = str(exc)
            return None

    return None


class PointFeaturesRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    city: Optional[str] = None


class PointFeaturesResponse(BaseModel):
    city: Optional[str]
    latitude: float
    longitude: float
    centreDistance: Optional[float] = None
    poiCount: Optional[float] = None
    collegeDistance: Optional[float] = None
    schoolDistance: Optional[float] = None
    clinicDistance: Optional[float] = None
    postOfficeDistance: Optional[float] = None
    kindergartenDistance: Optional[float] = None
    restaurantDistance: Optional[float] = None
    pharmacyDistance: Optional[float] = None
    nearset_poi_distance: Optional[float] = None
    poi_sum_distance: Optional[float] = None


class PredictRequest(BaseModel):
    city: str
    latitude: float
    longitude: float
    centreDistance: Optional[float] = None
    poiCount: Optional[float] = None
    collegeDistance: Optional[float] = None
    schoolDistance: Optional[float] = None
    clinicDistance: Optional[float] = None
    postOfficeDistance: Optional[float] = None
    kindergartenDistance: Optional[float] = None
    restaurantDistance: Optional[float] = None
    pharmacyDistance: Optional[float] = None
    nearset_poi_distance: Optional[float] = None
    poi_sum_distance: Optional[float] = None
    squareMeters: float
    rooms: float
    floor: float
    floorCount: float
    hasParkingSpace: bool
    hasBalcony: bool
    hasElevator: bool
    hasSecurity: bool
    hasStorageRoom: bool
    type_apartmentBuilding: bool
    type_blockOfFlats: bool
    type_tenement: bool
    type_unknown: Optional[bool] = False
    building_age: float
    rooms_per_m2: float


class PredictResponse(BaseModel):
    predictedPrice: float
    currency: str = "PLN"
    modelVersion: str = "placeholder-v1"


class PoiFetchRequest(BaseModel):
    poiType: POI_TYPE
    city: str
    centerLat: float = Field(..., ge=-90, le=90)
    centerLng: float = Field(..., ge=-180, le=180)
    radiusMeters: int = Field(..., ge=1000, le=100000)
    polygon: List[List[float]]
    forceRefresh: bool = False


class PoiPoint(BaseModel):
    name: str
    lat: float
    lng: float


class PoiFetchResponse(BaseModel):
    poiType: POI_TYPE
    city: str
    points: List[PoiPoint]
    cacheHit: bool
    source: str


class PoiCacheStatusItem(BaseModel):
    cityKey: str
    poiType: str
    pointCount: int
    updatedAt: Optional[int] = None
    ageSeconds: Optional[int] = None
    isFresh: bool
    isInCooldown: bool
    failedAt: Optional[int] = None


class PoiCacheStatusResponse(BaseModel):
    generatedAt: int
    ttlSeconds: int
    failedCooldownSeconds: int
    totalEntries: int
    items: List[PoiCacheStatusItem]


class ApartmentRecord(BaseModel):
    id: str
    city: str
    type: Optional[str] = None
    squareMeters: Optional[float] = None
    rooms: Optional[float] = None
    floor: Optional[float] = None
    floorCount: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    centreDistance: Optional[float] = None
    poiCount: Optional[float] = None
    schoolDistance: Optional[float] = None
    clinicDistance: Optional[float] = None
    postOfficeDistance: Optional[float] = None
    kindergartenDistance: Optional[float] = None
    restaurantDistance: Optional[float] = None
    collegeDistance: Optional[float] = None
    pharmacyDistance: Optional[float] = None
    hasParkingSpace: Optional[bool] = None
    hasBalcony: Optional[bool] = None
    hasElevator: Optional[bool] = None
    hasSecurity: Optional[bool] = None
    hasStorageRoom: Optional[bool] = None
    price: Optional[float] = None
    building_age: Optional[float] = None
    nearset_poi_distance: Optional[float] = None
    poi_sum_distance: Optional[float] = None
    rooms_per_m2: Optional[float] = None


class CityProfile(BaseModel):
    city: str
    cityKey: str
    centerLat: float
    centerLng: float
    radiusMeters: int
    polygon: List[List[float]]


class CityProfilesResponse(BaseModel):
    count: int
    items: List[CityProfile]


def normalize_text(value: str) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def to_float(value: Any) -> Optional[float]:
    try:
        n = float(value)
        if math.isfinite(n):
            return n
        return None
    except Exception:
        return None


def to_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    text = normalize_text(str(value or ""))
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    return None


def find_data_csv() -> Optional[Path]:
    for candidate in DATA_CSV_CANDIDATES:
        if candidate.exists():
            return candidate
    return None


def build_city_profiles(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_city: Dict[str, List[Dict[str, float]]] = {}
    for row in rows:
        city = str(row.get("city") or "").strip()
        lat = row.get("latitude")
        lng = row.get("longitude")
        if not city or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        by_city.setdefault(city, []).append({"lat": float(lat), "lng": float(lng)})

    profiles: List[Dict[str, Any]] = []
    for city, points in by_city.items():
        lats = [p["lat"] for p in points]
        lngs = [p["lng"] for p in points]
        min_lat = min(lats)
        max_lat = max(lats)
        min_lng = min(lngs)
        max_lng = max(lngs)

        buffer_deg = 0.015
        polygon = [
            [min_lat - buffer_deg, min_lng - buffer_deg],
            [min_lat - buffer_deg, max_lng + buffer_deg],
            [max_lat + buffer_deg, max_lng + buffer_deg],
            [max_lat + buffer_deg, min_lng - buffer_deg],
        ]

        center_lat = sum(lats) / len(lats)
        center_lng = sum(lngs) / len(lngs)
        max_dist_km = 0.0
        for p in points:
            d_lat = (p["lat"] - center_lat) * 111.32
            d_lng = (p["lng"] - center_lng) * 111.32 * math.cos(math.radians(center_lat))
            dist = math.sqrt(d_lat * d_lat + d_lng * d_lng)
            if dist > max_dist_km:
                max_dist_km = dist

        profiles.append(
            {
                "city": city,
                "cityKey": normalize_text(city),
                "centerLat": center_lat,
                "centerLng": center_lng,
                "radiusMeters": int(max(10000, (max_dist_km + 10.0) * 1000)),
                "polygon": polygon,
            }
        )

    profiles.sort(key=lambda p: p["cityKey"])
    return profiles


def load_dataset_if_needed() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    csv_path = find_data_csv()
    if not csv_path:
        return [], []

    mtime = csv_path.stat().st_mtime
    with dataset_lock:
        if dataset_cache["path"] == str(csv_path) and dataset_cache["mtime"] == mtime:
            return dataset_cache["rows"], dataset_cache["profiles"]

        rows: List[Dict[str, Any]] = []
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for idx, r in enumerate(reader):
                city = str(r.get("city") or "").strip()
                lat = to_float(r.get("latitude"))
                lng = to_float(r.get("longitude"))
                if not city or lat is None or lng is None:
                    continue
                rows.append(
                    {
                        "id": str(r.get("id") or f"{normalize_text(city)}-{lat}-{lng}-{idx}"),
                        "city": city,
                        "type": r.get("type"),
                        "squareMeters": to_float(r.get("squareMeters")),
                        "rooms": to_float(r.get("rooms")),
                        "floor": to_float(r.get("floor")),
                        "floorCount": to_float(r.get("floorCount")),
                        "latitude": lat,
                        "longitude": lng,
                        "centreDistance": to_float(r.get("centreDistance")),
                        "poiCount": to_float(r.get("poiCount")),
                        "schoolDistance": to_float(r.get("schoolDistance")),
                        "clinicDistance": to_float(r.get("clinicDistance")),
                        "postOfficeDistance": to_float(r.get("postOfficeDistance")),
                        "kindergartenDistance": to_float(r.get("kindergartenDistance")),
                        "restaurantDistance": to_float(r.get("restaurantDistance")),
                        "collegeDistance": to_float(r.get("collegeDistance")),
                        "pharmacyDistance": to_float(r.get("pharmacyDistance")),
                        "hasParkingSpace": to_bool(r.get("hasParkingSpace")),
                        "hasBalcony": to_bool(r.get("hasBalcony")),
                        "hasElevator": to_bool(r.get("hasElevator")),
                        "hasSecurity": to_bool(r.get("hasSecurity")),
                        "hasStorageRoom": to_bool(r.get("hasStorageRoom")),
                        "price": to_float(r.get("price")),
                        "building_age": to_float(r.get("building_age")),
                        "nearset_poi_distance": to_float(r.get("nearset_poi_distance")),
                        "poi_sum_distance": to_float(r.get("poi_sum_distance")),
                        "rooms_per_m2": to_float(r.get("rooms_per_m2")),
                    }
                )

        profiles = build_city_profiles(rows)
        dataset_cache["path"] = str(csv_path)
        dataset_cache["mtime"] = mtime
        dataset_cache["rows"] = rows
        dataset_cache["profiles"] = profiles
        return rows, profiles


def cache_key(city: str, poi_type: str) -> str:
    return f"{normalize_text(city)}::{poi_type}"


def point_in_polygon(lat: float, lng: float, polygon: List[List[float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersect = ((yi > lng) != (yj > lng)) and (
            lat < ((xj - xi) * (lng - yi)) / ((yj - yi) + 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def load_cache() -> Dict[str, object]:
    if not CACHE_FILE.exists():
        return {"entries": {}, "failed": {}}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"entries": {}, "failed": {}}


def save_cache(data: Dict[str, object]) -> None:
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=True), encoding="utf-8")


def get_cache_entry(key: str) -> Optional[Dict[str, object]]:
    with cache_lock:
        data = load_cache()
        return data.get("entries", {}).get(key)


def set_cache_entry(key: str, points: List[Dict[str, object]]) -> None:
    with cache_lock:
        data = load_cache()
        entries = data.setdefault("entries", {})
        entries[key] = {
            "updatedAt": int(time.time()),
            "points": points,
        }
        failed = data.setdefault("failed", {})
        if key in failed:
            del failed[key]
        save_cache(data)


def set_failed(key: str) -> None:
    with cache_lock:
        data = load_cache()
        failed = data.setdefault("failed", {})
        failed[key] = int(time.time())
        save_cache(data)


def is_failed_recently(key: str) -> bool:
    with cache_lock:
        data = load_cache()
        failed_at = data.get("failed", {}).get(key)
    if not failed_at:
        return False
    return (time.time() - failed_at) < FAILED_COOLDOWN_SECONDS


def get_failed_at(key: str) -> Optional[int]:
    with cache_lock:
        data = load_cache()
        failed_at = data.get("failed", {}).get(key)
    if isinstance(failed_at, int):
        return failed_at
    return None


def is_fresh(entry: Optional[Dict[str, object]]) -> bool:
    if not entry:
        return False
    updated_at = entry.get("updatedAt")
    if not isinstance(updated_at, int):
        return False
    return (time.time() - updated_at) < CACHE_TTL_SECONDS


def overpass_query(selector: str, center_lat: float, center_lng: float, radius_meters: int) -> str:
    return (
        "[out:json][timeout:25];\n"
        "(\n"
        f"  node[{selector}](around:{radius_meters},{center_lat},{center_lng});\n"
        f"  way[{selector}](around:{radius_meters},{center_lat},{center_lng});\n"
        f"  relation[{selector}](around:{radius_meters},{center_lat},{center_lng});\n"
        ");\n"
        "out center tags;"
    )


def fetch_overpass(endpoint: str, query: str) -> Tuple[int, Dict[str, object]]:
    body = parse.urlencode({"data": query}).encode("utf-8")
    req = request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with overpass_semaphore:
        with request.urlopen(req, timeout=OVERPASS_TIMEOUT_SECONDS) as response:
            status = int(getattr(response, "status", 200))
            payload = json.loads(response.read().decode("utf-8"))
            return status, payload


def apply_name_filter(name: str, include: List[str], exclude: List[str]) -> bool:
    normalized = normalize_text(name)
    if not normalized:
        return False
    if include and not any(k in normalized for k in include):
        return False
    if exclude and any(k in normalized for k in exclude):
        return False
    return True


def fetch_points(req: PoiFetchRequest) -> Tuple[List[Dict[str, object]], str]:
    config = POI_CONFIG[req.poiType]
    selector = str(config["overpass_selector"])
    include = list(config.get("include", []))
    exclude = list(config.get("exclude", []))
    query = overpass_query(selector, req.centerLat, req.centerLng, req.radiusMeters)

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            status, payload = fetch_overpass(endpoint, query)
            if status != 200:
                continue
            elements = payload.get("elements", [])
            points: List[Dict[str, object]] = []
            seen = set()
            for el in elements:
                lat = el.get("lat")
                lng = el.get("lon")
                if lat is None or lng is None:
                    center = el.get("center", {})
                    lat = center.get("lat")
                    lng = center.get("lon")
                if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                    continue
                tags = el.get("tags", {})
                name = str(tags.get("name") or "unknown")
                if not apply_name_filter(name, include, exclude):
                    continue
                if req.polygon and len(req.polygon) >= 3 and not point_in_polygon(float(lat), float(lng), req.polygon):
                    continue
                dedupe_key = f"{normalize_text(name)}|{round(float(lat), 5)}|{round(float(lng), 5)}"
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                points.append({"name": name, "lat": float(lat), "lng": float(lng)})
            if points:
                return points, endpoint

            # Some post offices can be tagged inconsistently or placed just outside
            # dataset-derived city polygons. Retry once with relaxed filters.
            if req.poiType == "postOffice" and req.polygon:
                relaxed_points: List[Dict[str, object]] = []
                relaxed_seen = set()
                for el in elements:
                    lat = el.get("lat")
                    lng = el.get("lon")
                    if lat is None or lng is None:
                        center = el.get("center", {})
                        lat = center.get("lat")
                        lng = center.get("lon")
                    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                        continue
                    tags = el.get("tags", {})
                    name = str(tags.get("name") or "unknown")
                    if not apply_name_filter(name, [], exclude):
                        continue
                    dedupe_key = f"{normalize_text(name)}|{round(float(lat), 5)}|{round(float(lng), 5)}"
                    if dedupe_key in relaxed_seen:
                        continue
                    relaxed_seen.add(dedupe_key)
                    relaxed_points.append({"name": name, "lat": float(lat), "lng": float(lng)})

                if relaxed_points:
                    return relaxed_points, f"{endpoint}#postOffice-relaxed"
        except error.HTTPError:
            continue
        except error.URLError:
            continue
        except TimeoutError:
            continue
        except Exception:
            continue
    return [], "none"


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
def api_health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/apartments", response_model=List[ApartmentRecord])
def api_apartments() -> List[ApartmentRecord]:
    rows, _profiles = load_dataset_if_needed()
    return [ApartmentRecord(**r) for r in rows]


@app.get("/api/cities/profiles", response_model=CityProfilesResponse)
def api_cities_profiles() -> CityProfilesResponse:
    _rows, profiles = load_dataset_if_needed()
    items = [CityProfile(**p) for p in profiles]
    return CityProfilesResponse(count=len(items), items=items)


@app.post("/api/poi/fetch", response_model=PoiFetchResponse)
def poi_fetch(payload: PoiFetchRequest) -> PoiFetchResponse:
    key = cache_key(payload.city, payload.poiType)

    entry = get_cache_entry(key)
    if is_fresh(entry) and not payload.forceRefresh:
        points = entry.get("points", []) if entry else []
        return PoiFetchResponse(
            poiType=payload.poiType,
            city=payload.city,
            points=[PoiPoint(**p) for p in points],
            cacheHit=True,
            source="server-cache",
        )

    if is_failed_recently(key) and not payload.forceRefresh:
        stale_points = entry.get("points", []) if entry else []
        return PoiFetchResponse(
            poiType=payload.poiType,
            city=payload.city,
            points=[PoiPoint(**p) for p in stale_points],
            cacheHit=bool(stale_points),
            source="cooldown",
        )

    points, source = fetch_points(payload)
    if points:
        set_cache_entry(key, points)
        return PoiFetchResponse(
            poiType=payload.poiType,
            city=payload.city,
            points=[PoiPoint(**p) for p in points],
            cacheHit=False,
            source=source,
        )

    set_failed(key)
    stale_points = entry.get("points", []) if entry else []
    return PoiFetchResponse(
        poiType=payload.poiType,
        city=payload.city,
        points=[PoiPoint(**p) for p in stale_points],
        cacheHit=bool(stale_points),
        source="fallback-stale-cache" if stale_points else "empty",
    )


@app.get("/api/poi/cache/status", response_model=PoiCacheStatusResponse)
def poi_cache_status() -> PoiCacheStatusResponse:
    with cache_lock:
        data = load_cache()
    entries = data.get("entries", {})
    now = int(time.time())
    items: List[PoiCacheStatusItem] = []

    for key, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        city_key, poi_type = (key.split("::", 1) + ["unknown"])[:2]
        updated_at = entry.get("updatedAt") if isinstance(entry.get("updatedAt"), int) else None
        points = entry.get("points") if isinstance(entry.get("points"), list) else []
        age_seconds = (now - updated_at) if isinstance(updated_at, int) else None
        failed_at = get_failed_at(key)

        items.append(
            PoiCacheStatusItem(
                cityKey=city_key,
                poiType=poi_type,
                pointCount=len(points),
                updatedAt=updated_at,
                ageSeconds=age_seconds,
                isFresh=bool(updated_at and age_seconds is not None and age_seconds < CACHE_TTL_SECONDS),
                isInCooldown=bool(failed_at and (now - failed_at) < FAILED_COOLDOWN_SECONDS),
                failedAt=failed_at,
            )
        )

    items.sort(key=lambda x: (x.poiType, x.cityKey))
    return PoiCacheStatusResponse(
        generatedAt=now,
        ttlSeconds=CACHE_TTL_SECONDS,
        failedCooldownSeconds=FAILED_COOLDOWN_SECONDS,
        totalEntries=len(items),
        items=items,
    )


@app.post("/api/features/from-point", response_model=PointFeaturesResponse)
def features_from_point(payload: PointFeaturesRequest) -> PointFeaturesResponse:
    return PointFeaturesResponse(
        city=payload.city,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )


@app.post("/api/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    model = load_prediction_model()
    if model is None:
        error_suffix = model_load_error.split(":")[0] if model_load_error else "not-found"
        raise HTTPException(status_code=503, detail=f"prediction-model-unavailable:{error_suffix}")

    raw = payload.model_dump()
    df = payload_to_dataframe(raw)
    X = align_for_model(df)
    y = model.predict(X)
    return PredictResponse(
        predictedPrice=round(float(y[0]), 2),
        modelVersion=f"joblib:{Path(loaded_model_path).name}" if loaded_model_path else "joblib",
    )


@app.get("/", include_in_schema=False)
def spa_root() -> FileResponse:
    if not frontend_dist_path:
        raise HTTPException(status_code=404, detail="frontend-not-built")
    return FileResponse(frontend_dist_path / "index.html")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str) -> FileResponse:
    if not frontend_dist_path:
        raise HTTPException(status_code=404, detail="not-found")

    # Keep API and health paths explicit and avoid masking unknown API routes.
    if full_path.startswith("api/") or full_path == "health":
        raise HTTPException(status_code=404, detail="not-found")

    target = frontend_dist_path / full_path
    if target.is_file():
        return FileResponse(target)
    return FileResponse(frontend_dist_path / "index.html")
