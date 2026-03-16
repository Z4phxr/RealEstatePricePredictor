import React, { useMemo, useState } from 'react'

function AmenityRow({ label, enabled }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-slate-700">{label}</span>
      <span
        className={`text-xs font-semibold px-2 py-1 rounded-full ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
      >
        {enabled ? 'TAK' : 'NIE'}
      </span>
    </div>
  )
}

export default function ApartmentCard({ apartment, onClose }){
  if (!apartment) return null
  const buildingAge = Number.isFinite(apartment.buildingAge) ? apartment.buildingAge : null
  const [showAllInfo, setShowAllInfo] = useState(false)

  const datasetEntries = useMemo(() => {
    const source = apartment.rawRecord && typeof apartment.rawRecord === 'object'
      ? apartment.rawRecord
      : apartment

    return Object.entries(source)
      .filter(([key]) => key !== 'rawRecord')
      .sort(([a], [b]) => a.localeCompare(b))
  }, [apartment])

  function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-'
    return String(value)
  }

  return (
    <div className="max-w-sm p-4 bg-white rounded-lg shadow-lg">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm text-slate-500">{apartment.city} • {apartment.type}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      <div className="mt-3">
        <div className="text-sm text-slate-500">Price</div>
        <div className="text-2xl font-bold mt-1">{new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(apartment.price)}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700">
        <div>Area: <span className="font-medium">{apartment.squareMeters} m²</span></div>
        <div>Rooms: <span className="font-medium">{apartment.rooms}</span></div>
        <div>Floor: <span className="font-medium">{apartment.floor ?? '-'}</span></div>
        <div>Building age: <span className="font-medium">{buildingAge ?? '-'}</span></div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-slate-500 mb-2">Udogodnienia</div>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <AmenityRow label="Parking" enabled={Boolean(apartment.hasParkingSpace)} />
          <AmenityRow label="Balkon" enabled={Boolean(apartment.hasBalcony)} />
          <AmenityRow label="Winda" enabled={Boolean(apartment.hasElevator)} />
          <AmenityRow label="Ochrona" enabled={Boolean(apartment.hasSecurity)} />
          <AmenityRow label="Schowek" enabled={Boolean(apartment.hasStorageRoom)} />
        </div>
      </div>

      <div className="mt-3 text-sm text-slate-600">
        <div>Coordinates: {apartment.latitude}, {apartment.longitude}</div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowAllInfo((prev) => !prev)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showAllInfo ? 'Ukryj wszystkie informacje' : 'Pokaż wszystkie informacje'}
        </button>
      </div>

      {showAllInfo && (
        <div className="mt-3 max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Dataset record details</div>
          <div className="space-y-1 text-xs">
            {datasetEntries.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white px-2 py-1">
                <span className="font-medium text-slate-600">{key}</span>
                <span className="text-right text-slate-800 break-all">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
