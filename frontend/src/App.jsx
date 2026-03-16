import React, { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import cities from './data/cities.json'
import ApartmentCard from './components/ApartmentCard'
import InfoPage from './components/InfoPage'

function findCityName(value) {
  if (!value) return ''
  const normalized = String(value).trim().toLowerCase()
  const match = cities.find((c) => c.name.toLowerCase() === normalized)
  if (match) return match.name
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function MapPage(){

  const [open, setOpen] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [debugLayers, setDebugLayers] = useState({
    college: false,
    school: false,
    clinic: false,
    postOffice: false,
    restaurant: false,
    pharmacy: false
  })
  const [form, setForm] = useState({
    squareMeters: 50,
    rooms: 2,
    floor: 1,
    floorCount: 4,
    hasParkingSpace: false,
    hasBalcony: false,
    hasElevator: false,
    hasSecurity: false,
    hasStorageRoom: false,
    type_apartmentBuilding: true,
    type_blockOfFlats: false,
    type_tenement: false,
    building_age: 12,
    latitude: null,
    longitude: null,
    centreDistance: null,
    poiCount: null,
    collegeDistance: null,
    schoolDistance: null,
    clinicDistance: null,
    postOfficeDistance: null,
    kindergartenDistance: null,
    restaurantDistance: null,
    pharmacyDistance: null,
    nearset_poi_distance: null,
    poi_sum_distance: null,
    city: ''
  })
  const [selectedApartment, setSelectedApartment] = useState(null)
  const [predictionResult, setPredictionResult] = useState(null)
  const [predictionError, setPredictionError] = useState('')
  const [isPredicting, setIsPredicting] = useState(false)

  function handleMapClick(payload){
    if (!payload) return

    // normal map click with lat/lng
    const { lat, lng, city } = payload
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const matchedCity = findCityName(city)
      if (!matchedCity) {
        setOpen(false)
        setSelectedPoint(null)
        return
      }

      setSelectedPoint({ lat, lng })
      setForm((f)=>({
        ...f,
        latitude: lat.toFixed(6),
        longitude: lng.toFixed(6),
        city: matchedCity,
        centreDistance: payload.centreDistance,
        poiCount: payload.poiCount,
        collegeDistance: payload.collegeDistance,
        schoolDistance: payload.schoolDistance,
        clinicDistance: payload.clinicDistance,
        postOfficeDistance: payload.postOfficeDistance,
        kindergartenDistance: payload.kindergartenDistance,
        restaurantDistance: payload.restaurantDistance,
        pharmacyDistance: payload.pharmacyDistance,
        nearset_poi_distance: payload.nearset_poi_distance,
        poi_sum_distance: payload.poi_sum_distance
      }))
      setOpen(true)
    }
    
    // Do not automatically clear previous prediction when clicking outside a city.
    // Users may want the result to persist until they explicitly change inputs.
  }

  function handleApartmentClick(apartment){
    if (!apartment) return
    const matchedCity = findCityName(apartment.city)
    setSelectedApartment(apartment)
    setForm((f)=>({
      ...f,
      latitude: apartment.latitude,
      longitude: apartment.longitude,
      city: matchedCity
    }))
      setOpen(false)
  }
  

  async function handlePredict(){
    const roomsPerM2 = form.squareMeters > 0 ? Number((form.rooms / form.squareMeters).toFixed(6)) : 0

    const payload = {
      squareMeters: form.squareMeters,
      rooms: form.rooms,
      floor: form.floor,
      floorCount: form.floorCount,
      latitude: form.latitude,
      longitude: form.longitude,
      centreDistance: form.centreDistance,
      poiCount: form.poiCount,
      schoolDistance: form.schoolDistance,
      clinicDistance: form.clinicDistance,
      postOfficeDistance: form.postOfficeDistance,
      kindergartenDistance: form.kindergartenDistance,
      restaurantDistance: form.restaurantDistance,
      collegeDistance: form.collegeDistance,
      pharmacyDistance: form.pharmacyDistance,
      hasParkingSpace: form.hasParkingSpace,
      hasBalcony: form.hasBalcony,
      hasElevator: form.hasElevator,
      hasSecurity: form.hasSecurity,
      hasStorageRoom: form.hasStorageRoom,
      building_age: form.building_age,
      nearset_poi_distance: form.nearset_poi_distance,
      poi_sum_distance: form.poi_sum_distance,
      rooms_per_m2: roomsPerM2,
      type_apartmentBuilding: form.type_apartmentBuilding,
      type_blockOfFlats: form.type_blockOfFlats,
      type_tenement: form.type_tenement,
      type_unknown: false,
      city: form.city
    }
    setPredictionError('')
    setPredictionResult(null)
    setIsPredicting(true)
    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const text = await response.text()
        setPredictionError(`Predict failed (${response.status}): ${text || 'unknown error'}`)
        setPredictionResult(null)
        return
      }

      const result = await response.json()
      const predictedPricePerM2 = Number(result?.predictedPrice)
      const squareMeters = Number(form.squareMeters)
      const predictedPriceTotal = Number.isFinite(predictedPricePerM2) && Number.isFinite(squareMeters)
        ? Number((predictedPricePerM2 * squareMeters).toFixed(2))
        : null

      setPredictionResult({
        ...result,
        predictedPricePerM2,
        predictedPriceTotal
      })
    } catch (_error) {
      setPredictionError('Predict request failed. Check backend connection.')
      setPredictionResult(null)
    } finally {
      setIsPredicting(false)
    }
  }

  return (
    <div className="relative h-screen w-screen flex overflow-hidden bg-slate-50">
      <div className="flex-1 relative">
        <MapView
          onMapClick={handleMapClick}
          onApartmentClick={handleApartmentClick}
          selectedPoint={selectedPoint}
          showCollegeDebug={debugLayers.college}
          showSchoolDebug={debugLayers.school}
          showClinicDebug={debugLayers.clinic}
          showPostOfficeDebug={debugLayers.postOffice}
          showRestaurantDebug={debugLayers.restaurant}
          showPharmacyDebug={debugLayers.pharmacy}
        />

        <div className="absolute left-20 top-4 z-[2200]">
          <button
            type="button"
            onClick={() => setShowDebugPanel((v) => !v)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow"
          >
            Debug layers
          </button>

          {showDebugPanel && (
            <div className="mt-2 w-56 rounded-md border border-slate-300 bg-white p-3 shadow-lg">
              <div className="text-xs font-semibold text-slate-600">Points of interest</div>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.college}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, college: e.target.checked }))}
                />
                College/University
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.school}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, school: e.target.checked }))}
                />
                School
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.clinic}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, clinic: e.target.checked }))}
                />
                Clinic/Hospital
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.postOffice}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, postOffice: e.target.checked }))}
                />
                Post office
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.restaurant}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, restaurant: e.target.checked }))}
                />
                Restaurant
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={debugLayers.pharmacy}
                  onChange={(e) => setDebugLayers((prev) => ({ ...prev, pharmacy: e.target.checked }))}
                />
                Pharmacy
              </label>

              <div className="mt-3 border-t border-slate-200 pt-2">
                <div className="text-xs font-semibold text-slate-600">Marker colors</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400 ring-1 ring-blue-700" />
                  College/University
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 ring-1 ring-amber-700" />
                  School
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500 ring-1 ring-rose-700" />
                  Clinic/Hospital
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500 ring-1 ring-violet-700" />
                  Post office
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-1 ring-emerald-700" />
                  Restaurant
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-500 ring-1 ring-cyan-700" />
                  Pharmacy
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                Debug POI layers are fetched and cached per city.
              </div>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="absolute right-0 top-0 h-full w-full md:w-96 z-[2100]">
          <div className="h-full overflow-auto">
            <Sidebar
              form={form}
              setForm={setForm}
              onPredict={handlePredict}
              toggleOpen={()=>setOpen(false)}
              isPredicting={isPredicting}
              predictionError={predictionError}
              predictionResult={predictionResult}
            />
          </div>
        </div>
      )}

      {isPredicting && (
        <div className="fixed right-6 top-6 z-[2200] rounded border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow">
          Wysyłanie zapytania do modelu...
        </div>
      )}

      {predictionError && (
        <div className="fixed right-6 top-16 z-[2200] max-w-[min(90vw,420px)] rounded border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow">
          {predictionError}
        </div>
      )}

      {selectedApartment && (
        <div className="fixed left-6 bottom-6 z-[2000]">
          <ApartmentCard apartment={selectedApartment} onClose={()=>setSelectedApartment(null)} />
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MapPage />} />
      <Route path="/info" element={<InfoPage />} />
    </Routes>
  )
}
