import React from 'react'

export default function ResultCard({ result }){
  if (!result) return null
  const value = result.predictedPrice ?? result.price
  return (
    <div className="mt-4 p-6 bg-gradient-to-r from-slate-50 to-white rounded-lg shadow-md">
      <div className="text-sm text-slate-500">Przewidywana cena</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)}</div>
      <div className="text-sm text-slate-500 mt-1">Cena całkowita mieszkania</div>
    </div>
  )
}
