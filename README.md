# Apartment Price Predictor (Poland)

## Project Overview

This project is a machine learning system that predicts apartment prices in Poland.

At the model level, prediction is made as **price per square meter**. The final apartment price is then derived from:

`final_price = predicted_price_per_m2 * apartment_area_m2`

The application is delivered as a full-stack solution:

- **Backend**: FastAPI service hosting the trained CatBoost model and geospatial data logic
- **Frontend**: React + Vite map-based interface for interactive pricing

## Model Development

Model development was performed in **Google Colab**. The repository includes (or will include) a Colab notebook that documents the full experimentation workflow:

- feature analysis
- data preprocessing
- model experimentation
- model selection process

After comparing multiple candidates, the selected model was **CatBoost**, with approximately **91.5% accuracy**.

The modeling approach focuses on predicting **price per square meter**, which provides more stable behavior than predicting total price directly. The final apartment price is then computed from the predicted unit price and apartment area.

Detailed experimentation and data handling steps are documented in the Colab notebook.

## Dataset

Training was based on the Kaggle dataset **"Apartment Prices in Poland"**.

- Dataset link: [Dataset link here]
- Data ownership: the dataset is an **external resource from Kaggle** and **is not owned by the project author**

## Backend Architecture

The backend is responsible for model serving and geospatial feature support.

At a high level, it:

1. hosts the trained CatBoost model
2. receives prediction requests from the frontend
3. processes apartment and location parameters
4. returns predicted pricing values

The backend also manages points-of-interest (POI) geospatial data (for example pharmacies, hospitals, post offices, restaurants, and similar amenities).

POI data is retrieved from the **Overpass API** (OpenStreetMap data), cached on the backend, and refreshed over time through cache lifecycle and refresh flows.

Additional operational details are available on the frontend **`/info`** page.

## Frontend Interface

The frontend provides a map-based pricing workflow.

Users can:

1. click a location on the map
2. enter apartment parameters (for example number of rooms, area in square meters, and other available attributes)
3. submit the request for prediction

The frontend sends request payloads to the backend and displays the predicted apartment price returned by the model service.

Predictions are based on the trained model and training dataset scope, and are limited to cities supported by the dataset.

## Points of Interest Data

POI features are integrated into the prediction pipeline to represent neighborhood context.

The system uses categories such as:

- pharmacies
- clinics/hospitals
- post offices
- restaurants
- schools
- colleges/universities

These data points are used both for feature generation and for transparency/debug visualization.

## Debug Layers

The frontend includes a **Debug Layers** mode.

When enabled, it visualizes POI points directly on the map (for example restaurants, clinics, pharmacies, and other amenities) so users can inspect the geographic factors influencing model inputs.

## Features

The table below describes the model features and how they are produced.

| Feature | Type | Source | How it is produced |
|---|---|---|---|
| city | string | Dataset + map matching | Determined from supported dataset city boundaries for the selected map point |
| latitude | float | Map click | Latitude of selected map position |
| longitude | float | Map click | Longitude of selected map position |
| centreDistance | float | Geospatial calculation + dataset fallback | Estimated distance to city center using city reference geometry and interpolation fallback |
| poiCount | float | Dataset interpolation | Interpolated neighborhood density signal based on nearest dataset points |
| collegeDistance | float | Overpass API + cache + fallback | Nearest cached college/university point, with interpolation fallback when unavailable |
| schoolDistance | float | Overpass API + cache + fallback | Nearest cached school point, with interpolation fallback when unavailable |
| clinicDistance | float | Overpass API + cache + fallback | Nearest cached clinic/hospital point, with interpolation fallback when unavailable |
| postOfficeDistance | float | Overpass API + cache + fallback | Nearest cached post office point, with interpolation fallback when unavailable |
| restaurantDistance | float | Overpass API + cache + fallback | Nearest cached restaurant point, with interpolation fallback when unavailable |
| pharmacyDistance | float | Overpass API + cache + fallback | Nearest cached pharmacy point, with interpolation fallback when unavailable |
| kindergartenDistance | float | Dataset interpolation | Interpolated from nearby dataset entries |
| nearset_poi_distance | float | Derived geospatial aggregation | Minimum value among selected POI distance features used in the payload |
| poi_sum_distance | float | Derived geospatial aggregation | Sum of selected POI distance features used in the payload |
| squareMeters | float | User input | Apartment area provided in the form |
| rooms | float | User input | Number of rooms provided in the form |
| floor | float | User input | Apartment floor provided in the form |
| floorCount | float | User input | Building floor count provided in the form |
| hasParkingSpace | bool | User input | Amenity flag from form |
| hasBalcony | bool | User input | Amenity flag from form |
| hasElevator | bool | User input | Amenity flag from form |
| hasSecurity | bool | User input | Amenity flag from form |
| hasStorageRoom | bool | User input | Amenity flag from form |
| type_apartmentBuilding | bool | User input | One-hot building type flag |
| type_blockOfFlats | bool | User input | One-hot building type flag |
| type_tenement | bool | User input | One-hot building type flag |
| building_age | float | User input mapping | Building age bucket selected in UI and converted to numeric value |
| rooms_per_m2 | float | Derived feature | Calculated as rooms divided by square meters |

## APIs and Data Sources

| Resource | Type | Purpose | Link |
|---|---|---|---|
| Overpass API (OpenStreetMap) | External API | Retrieve points of interest used for geospatial features | [Overpass API link here] |
| Apartment Prices in Poland (Kaggle) | External dataset | Train and evaluate the apartment pricing model | [Dataset link here] |

Notes:

- External data sources are used by the project but are not owned by the project author.
- The Kaggle dataset remains third-party content under its original licensing terms.

## Repository Structure

- `backend/`: FastAPI API, model serving, POI data and caching logic
- `frontend/`: React + Vite application
- `Dockerfile`: production container build (frontend build + backend runtime)
- `railway.toml`: Railway deployment configuration
- `.github/workflows/ci.yml`: CI checks (backend tests + frontend build)
- `.github/workflows/release.yml`: manual release workflow

## Environment Variables

| Variable | Required | Description | Default |
|---|---|---|---|
| `PORT` | Platform-managed | Runtime port used by the backend service | `8080` fallback in container command |
| `MODEL_PATH` | No | Path to trained model file | `/app/model.joblib` |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated CORS allowed origins | `*` |

## Local Development

### Backend

1. `cd backend`
2. `python -m venv .venv`
3. `./.venv/Scripts/activate` (Windows)
4. `pip install -r requirements.txt pytest`
5. `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`

### Frontend

1. `cd frontend`
2. `npm install`
3. `npm run dev`

In development mode, frontend `/api` traffic is proxied to `http://localhost:8000`.

## Deployment

The repository is prepared for Railway deployment via the root `Dockerfile` and `railway.toml`.

Suggested validation endpoints after deploy:

- `/api/health`
- `/api/predict`
- `/`

## Release and Versioning

- Project version is tracked in `VERSION`
- Release history is tracked in `CHANGELOG.md`
- The `Release` workflow (`.github/workflows/release.yml`) performs validation, creates tag `v<version>`, and publishes a GitHub Release

Release checklist: `docs/RELEASE_CHECKLIST.md`
