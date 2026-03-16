import React from 'react'

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

  return (
    <div className="max-w-sm p-4 bg-white rounded-lg shadow-lg">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm text-slate-500">Apartment ID</div>
          <div className="font-medium text-slate-800">{apartment.id}</div>
          <div className="text-sm text-slate-500 mt-2">{apartment.city} • {apartment.type}</div>
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
        <div>Year: <span className="font-medium">{apartment.buildYear ?? '-'}</span></div>
        <div>Ownership: <span className="font-medium">{apartment.ownership ?? '-'}</span></div>
      </div>

      <div className="mt-4">
        <div className="text-sm text-slate-500 mb-2">Udogodnienia</div>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <AmenityRow label="Parking" enabled={Boolean(apartment.hasParkingSpace)} />
          <AmenityRow label="Balkon" enabled={Boolean(apartment.hasBalcony)} />
          <AmenityRow label="Winda" enabled={Boolean(apartment.hasElevator)} />
          <AmenityRow label="Ochrona" enabled={Boolean(apartment.hasSecurity)} />
          <AmenityRow label="Komorka lokatorska" enabled={Boolean(apartment.hasStorageRoom)} />
        </div>
      </div>

      <div className="mt-3 text-sm text-slate-600">
        <div>Coordinates: {apartment.latitude}, {apartment.longitude}</div>
      </div>
    </div>
  )
}
