import React from 'react'

function setApartmentType(setForm, key) {
  setForm((prev) => ({
    ...prev,
    type_apartmentBuilding: key === 'type_apartmentBuilding',
    type_blockOfFlats: key === 'type_blockOfFlats',
    type_tenement: key === 'type_tenement'
  }))
}

export default function Sidebar({ form, setForm, onPredict, toggleOpen, isPredicting = false, predictionError = '', predictionResult = null, poiLoadingNotice = '' }) {
  const roomsPerM2 = form.squareMeters > 0 ? (form.rooms / form.squareMeters).toFixed(6) : '0'

  return (
    <aside className="w-full md:w-96 bg-white shadow-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Wyceń mieszkanie</h2>
        <button className="text-sm text-slate-500" onClick={toggleOpen}>Zamknij</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-600">Powierzchnia (m²)</label>
          <input type="number" value={form.squareMeters}
            onChange={(e)=>setForm({...form,squareMeters: Number(e.target.value)})}
            className="w-full border rounded p-2" />
        </div>
        <div>
          <label className="text-sm text-slate-600">Pokoje</label>
          <input type="number" value={form.rooms}
            onChange={(e)=>setForm({...form,rooms: Number(e.target.value)})}
            className="w-full border rounded p-2" />
        </div>
        <div>
          <label className="text-sm text-slate-600">Piętro</label>
          <input type="number" value={form.floor}
            onChange={(e)=>setForm({...form,floor: Number(e.target.value)})}
            className="w-full border rounded p-2" />
        </div>
        <div>
          <label className="text-sm text-slate-600">Liczba pięter</label>
          <input type="number" value={form.floorCount}
            onChange={(e)=>setForm({...form,floorCount: Number(e.target.value)})}
            className="w-full border rounded p-2" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-slate-600">Typ budynku</label>
        <div className="grid grid-cols-1 gap-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="apartmentType"
              checked={form.type_apartmentBuilding}
              onChange={() => setApartmentType(setForm, 'type_apartmentBuilding')}
            />
            apartmentBuilding
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="apartmentType"
              checked={form.type_blockOfFlats}
              onChange={() => setApartmentType(setForm, 'type_blockOfFlats')}
            />
            blockOfFlats
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="apartmentType"
              checked={form.type_tenement}
              onChange={() => setApartmentType(setForm, 'type_tenement')}
            />
            tenement
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-slate-600">Wiek budynku</label>
        <input
          type="number"
          min="0"
          step="1"
          placeholder="Podaj wiek budynku w latach"
          value={form.building_age}
          onChange={(e) => setForm({ ...form, building_age: Number(e.target.value) })}
          className="w-full border rounded p-2"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm text-slate-600">Udogodnienia</label>
        <div className="grid grid-cols-1 gap-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.hasParkingSpace} onChange={(e)=>setForm({...form,hasParkingSpace: e.target.checked})} />
            Parking
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.hasBalcony} onChange={(e)=>setForm({...form,hasBalcony: e.target.checked})} />
            Balkon
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.hasElevator} onChange={(e)=>setForm({...form,hasElevator: e.target.checked})} />
            Winda
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.hasSecurity} onChange={(e)=>setForm({...form,hasSecurity: e.target.checked})} />
            Ochrona
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.hasStorageRoom} onChange={(e)=>setForm({...form,hasStorageRoom: e.target.checked})} />
            Schowek
          </label>
        </div>
      </div>

      <div>
        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">Wiecej informacji (z mapy i obliczen)</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">Miasto</label>
              <input readOnly value={form.city || ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">Latitude</label>
              <input readOnly value={form.latitude || ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">Longitude</label>
              <input readOnly value={form.longitude || ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">centreDistance</label>
              <input readOnly value={form.centreDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">poiCount</label>
              <input readOnly value={form.poiCount ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">collegeDistance</label>
              <input readOnly value={form.collegeDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">schoolDistance</label>
              <input readOnly value={form.schoolDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">clinicDistance</label>
              <input readOnly value={form.clinicDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">postOfficeDistance</label>
              <input readOnly value={form.postOfficeDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">kindergartenDistance</label>
              <input readOnly value={form.kindergartenDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">restaurantDistance</label>
              <input readOnly value={form.restaurantDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">pharmacyDistance</label>
              <input readOnly value={form.pharmacyDistance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">nearset_poi_distance</label>
              <input readOnly value={form.nearset_poi_distance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">poi_sum_distance</label>
              <input readOnly value={form.poi_sum_distance ?? ''} className="w-full border rounded p-2 bg-white" />
            </div>
            <div>
              <label className="text-sm text-slate-600">rooms_per_m2 (auto)</label>
              <input readOnly value={roomsPerM2} className="w-full border rounded p-2 bg-white" />
            </div>
          </div>
        </details>
      </div>

      <div>
        <button
          onClick={onPredict}
          disabled={isPredicting}
          className="w-full py-3 rounded text-white bg-accent">
          {isPredicting ? 'Wysyłanie...' : 'Sprawdz'}
        </button>
        {predictionError && (
          <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
            {predictionError}
          </div>
        )}
        {poiLoadingNotice && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            {poiLoadingNotice}
          </div>
        )}
        {predictionResult && (
          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Przewidywana cena</div>
            <div className="mt-1 text-xl font-bold">
              {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: predictionResult.currency || 'PLN' }).format(
                Number.isFinite(predictionResult.predictedPriceTotal)
                  ? predictionResult.predictedPriceTotal
                  : (predictionResult.predictedPrice || 0)
              )}
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              Model: {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: predictionResult.currency || 'PLN' }).format(predictionResult.predictedPrice || 0)} / m2
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
