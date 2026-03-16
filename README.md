# Real Estate Price Predictor

Monorepo aplikacji do wyceny mieszkań:
- frontend (React + Vite)
- backend (FastAPI + model ML)
- integracja danych POI (Overpass) z cache po stronie serwera

## Aktualny status produkcyjny

Repozytorium zostało przygotowane pod wdrożenie produkcyjne z naciskiem na:
- czystość repozytorium i kontrolę wersji
- automatyczną walidację jakości w CI
- jednolity deployment na Railway (jedna usługa)
- produkcyjne serwowanie frontendu z backendu

## Struktura repo

- backend: API FastAPI i logika modelu
- frontend: aplikacja React
- Dockerfile (root): obraz produkcyjny pod Railway (build frontend + runtime backend)
- railway.toml: konfiguracja deploymentu Railway
- .github/workflows/ci.yml: pipeline CI
- docker-compose.yml: lokalne uruchomienie deweloperskie backend + frontend

## Wymagane zmienne środowiskowe

- PORT: port runtime (Railway ustawia automatycznie)
- MODEL_PATH: ścieżka do modelu, domyślnie `/app/model.joblib`
- ALLOWED_ORIGINS: dozwolone originy CORS, np. `https://twoja-domena.pl`

## Uruchomienie lokalne (development)

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

Frontend w dev używa proxy `/api` na `http://localhost:8000`.

## Uruchomienie lokalne przez Docker Compose

1. `docker compose up --build`
2. Frontend: `http://localhost:5173`
3. Backend API: `http://localhost:8000/api/health`

## Deployment na Railway

Repo jest przygotowane do deploymentu przez rootowy Dockerfile.

### Co robi obraz produkcyjny

1. Buduje frontend (`npm run build`) w etapie build.
2. Instaluje backend i zależności Pythona.
3. Uruchamia FastAPI pod `0.0.0.0:$PORT`.
4. Serwuje statyczny frontend z backendu.

### Kroki deployu

1. Podłącz repo do Railway.
2. Railway wykryje `Dockerfile` w root.
3. Ustaw ewentualnie `ALLOWED_ORIGINS`.
4. Wdróż i zweryfikuj:
	- `/api/health`
	- `/api/predict`
	- `/` (frontend)

## CI

Pipeline w `.github/workflows/ci.yml` uruchamia:
- backend: instalacja, check składni, testy `pytest`
- frontend: instalacja, build produkcyjny

## Release i wersjonowanie

- Aktualna wersja projektu jest utrzymywana w pliku `VERSION`.
- Historia zmian jest utrzymywana w `CHANGELOG.md`.
- Manualny release uruchamiasz workflow `Release` (`.github/workflows/release.yml`) z numerem wersji semver (np. `0.2.1`).
- Workflow release wykonuje walidację (testy + build), tworzy tag `v<wersja>` i publikuje GitHub Release.

Checklistę publikacji znajdziesz w `docs/RELEASE_CHECKLIST.md`.

## Branch protection

Repo zawiera gotową konfigurację ochrony gałęzi:
- `scripts/branch-protection.json`
- `scripts/apply-branch-protection.ps1`

Przykład uruchomienia:

`./scripts/apply-branch-protection.ps1 -Owner <github-owner> -Repo <repo-name> -Branch master`

Wymagane: zainstalowany i zalogowany GitHub CLI (`gh`) z uprawnieniami administracyjnymi do repozytorium.

## Bezpieczeństwo i stabilność

- CORS konfigurowany przez `ALLOWED_ORIGINS`
- brak cichego fallbacku predykcji; brak modelu zwraca `503`
- endpoint health do monitoringu runtime
- usunięte artefakty developerskie z repo i dodany `.gitignore`

## Uwaga o danych

`frontend/public/data/data.csv` zawiera dane wykorzystywane przez aplikację i jest częścią działania systemu.
Przed produkcyjną publikacją należy traktować ten plik jako dane biznesowe i ocenić politykę ich udostępniania.
