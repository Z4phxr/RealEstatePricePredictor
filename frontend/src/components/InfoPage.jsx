import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

const SAMPLE_PREDICT_PAYLOAD = {
  squareMeters: 52,
  rooms: 2,
  floor: 3,
  floorCount: 7,
  latitude: 52.2297,
  longitude: 21.0122,
  centreDistance: 2.1,
  poiCount: 320,
  schoolDistance: 0.7,
  clinicDistance: 1.2,
  postOfficeDistance: 0.9,
  kindergartenDistance: 0.8,
  restaurantDistance: 0.4,
  collegeDistance: 1.8,
  pharmacyDistance: 0.5,
  hasParkingSpace: true,
  hasBalcony: true,
  hasElevator: true,
  hasSecurity: false,
  hasStorageRoom: false,
  building_age: 12,
  nearset_poi_distance: 0.4,
  poi_sum_distance: 6.3,
  rooms_per_m2: 2 / 52,
  type_apartmentBuilding: true,
  type_blockOfFlats: false,
  type_tenement: false,
  type_unknown: false,
  city: 'warszawa'
}

function statusBadge(ok) {
  return ok
    ? 'inline-flex items-center rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700'
    : 'inline-flex items-center rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700'
}

export default function InfoPage() {
  const [loading, setLoading] = useState(true)
  const [warming, setWarming] = useState(false)
  const [error, setError] = useState('')
  const [healthData, setHealthData] = useState(null)
  const [cacheData, setCacheData] = useState(null)
  const [predictData, setPredictData] = useState(null)
  const [profilesData, setProfilesData] = useState(null)
  const [requestLogs, setRequestLogs] = useState([])

  function addLog(message) {
    const ts = new Date().toLocaleTimeString()
    setRequestLogs((prev) => [`[${ts}] ${message}`, ...prev].slice(0, 120))
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async function loadInfo() {
    setLoading(true)
    setError('')

    try {
      const [healthResp, cacheResp, predictResp, profilesResp] = await Promise.allSettled([
        fetch('/api/health'),
        fetch('/api/poi/cache/status'),
        fetch('/api/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(SAMPLE_PREDICT_PAYLOAD)
        }),
        fetch('/api/cities/profiles')
      ])

      if (healthResp.status === 'fulfilled') {
        const ok = healthResp.value.ok
        const payload = ok ? await healthResp.value.json() : null
        setHealthData({ ok, status: healthResp.value.status, payload })
      } else {
        setHealthData({ ok: false, status: 0, payload: null })
      }

      if (cacheResp.status === 'fulfilled') {
        const ok = cacheResp.value.ok
        const payload = ok ? await cacheResp.value.json() : null
        setCacheData({ ok, status: cacheResp.value.status, payload })
      } else {
        setCacheData({ ok: false, status: 0, payload: null })
      }

      if (predictResp.status === 'fulfilled') {
        const ok = predictResp.value.ok
        const payload = ok ? await predictResp.value.json() : null
        setPredictData({ ok, status: predictResp.value.status, payload })
      } else {
        setPredictData({ ok: false, status: 0, payload: null })
      }

      if (profilesResp.status === 'fulfilled') {
        const ok = profilesResp.value.ok
        const payload = ok ? await profilesResp.value.json() : null
        setProfilesData({ ok, status: profilesResp.value.status, payload })
      } else {
        setProfilesData({ ok: false, status: 0, payload: null })
      }
    } catch (e) {
      setError(String(e?.message || e || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  async function runMissingCacheWarmup() {
    const profiles = Array.isArray(profilesData?.payload?.items) ? profilesData.payload.items : []
    if (!profiles.length) {
      addLog('No city profiles available, cannot warm missing cache')
      return
    }

    const items = Array.isArray(cacheData?.payload?.items) ? cacheData.payload.items : []
    const present = new Set(items.map((x) => `${x.cityKey}::${x.poiType}`))
    const types = ['college', 'school', 'clinic', 'postOffice', 'restaurant', 'pharmacy', 'kindergarten']

    const missing = []
    for (const profile of profiles) {
      for (const poiType of types) {
        const key = `${profile.cityKey}::${poiType}`
        if (!present.has(key)) {
          missing.push({ profile, poiType })
        }
      }
    }

    if (!missing.length) {
      addLog('No missing cache entries found')
      return
    }

    setWarming(true)
    addLog(`Starting missing cache warmup for ${missing.length} requests`)

    const concurrency = 2
    for (let i = 0; i < missing.length; i += concurrency) {
      const batch = missing.slice(i, i + concurrency)
      await Promise.allSettled(batch.map(async ({ profile, poiType }) => {
        const city = profile.city
        addLog(`Request ${poiType} for ${city}`)
        try {
          const response = await fetchWithTimeout('/api/poi/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              poiType,
              city: profile.city,
              centerLat: profile.centerLat,
              centerLng: profile.centerLng,
              radiusMeters: profile.radiusMeters,
              polygon: profile.polygon,
              forceRefresh: true
            })
          }, 35000)
          if (!response.ok) {
            addLog(`Failed ${poiType} for ${city} status=${response.status}`)
            return
          }
          const payload = await response.json()
          const count = Array.isArray(payload?.points) ? payload.points.length : 0
          addLog(`Done ${poiType} for ${city} points=${count} source=${payload?.source || 'unknown'}`)
        } catch (err) {
          if (err?.name === 'AbortError') {
            addLog(`Timeout ${poiType} for ${city}`)
          } else {
            addLog(`Error ${poiType} for ${city}`)
          }
        }
      }))
    }

    addLog('Warmup finished, refreshing status')
    await loadInfo()
    setWarming(false)
  }

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const root = document.getElementById('root')

    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevRootOverflow = root?.style.overflow
    const prevRootHeight = root?.style.height

    html.style.overflow = 'auto'
    body.style.overflow = 'auto'
    if (root) {
      root.style.overflow = 'auto'
      root.style.height = 'auto'
    }

    loadInfo()

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      if (root) {
        root.style.overflow = prevRootOverflow || ''
        root.style.height = prevRootHeight || ''
      }
    }
  }, [])

  const groupedCache = useMemo(() => {
    const items = Array.isArray(cacheData?.payload?.items) ? cacheData.payload.items : []
    const byPoi = {}
    for (const item of items) {
      const key = item.poiType || 'unknown'
      if (!byPoi[key]) byPoi[key] = []
      byPoi[key].push(item)
    }
    for (const key of Object.keys(byPoi)) {
      byPoi[key].sort((a, b) => String(a.cityKey).localeCompare(String(b.cityKey)))
    }
    return byPoi
  }, [cacheData])

  const poiTypes = useMemo(() => {
    const types = new Set(['college', 'school', 'clinic', 'postOffice', 'restaurant', 'pharmacy', 'kindergarten'])
    const items = Array.isArray(cacheData?.payload?.items) ? cacheData.payload.items : []
    for (const item of items) {
      if (item?.poiType) types.add(item.poiType)
    }
    return Array.from(types)
  }, [cacheData])

  const cityPoiMatrix = useMemo(() => {
    const items = Array.isArray(cacheData?.payload?.items) ? cacheData.payload.items : []
    const profiles = Array.isArray(profilesData?.payload?.items) ? profilesData.payload.items : []
    const byCity = {}

    for (const profile of profiles) {
      const city = String(profile?.cityKey || '')
      if (city && !byCity[city]) {
        byCity[city] = {}
      }
    }

    for (const item of items) {
      const city = String(item?.cityKey || '')
      const poiType = String(item?.poiType || '')
      if (!city || !poiType) continue
      if (!byCity[city]) byCity[city] = {}
      byCity[city][poiType] = item
    }
    const cities = Object.keys(byCity).sort((a, b) => a.localeCompare(b))
    return { byCity, cities }
  }, [cacheData, profilesData])

  const totalEntries = cacheData?.payload?.totalEntries ?? 0

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">System Info</h1>
            <p className="text-sm text-slate-600">Backend health, predict test and POI cache status</p>
          </div>
          <div className="flex gap-2">
            <Link to="/" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Back to map
            </Link>
            <button
              type="button"
              onClick={runMissingCacheWarmup}
              disabled={warming || loading}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {warming ? 'Warming...' : 'Get missing cache'}
            </button>
            <button
              type="button"
              onClick={loadInfo}
              className="rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-slate-700">API Health</div>
            <div className={statusBadge(Boolean(healthData?.ok))}>{healthData?.ok ? 'OK' : 'DOWN'}</div>
            <div className="mt-2 text-xs text-slate-500">HTTP: {healthData?.status ?? '-'}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-slate-700">Predict Endpoint</div>
            <div className={statusBadge(Boolean(predictData?.ok))}>{predictData?.ok ? 'OK' : 'FAIL'}</div>
            <div className="mt-2 text-xs text-slate-500">HTTP: {predictData?.status ?? '-'}</div>
            <div className="mt-1 text-xs text-slate-500">
              Result: {predictData?.payload?.predictedPrice ?? '-'} {predictData?.payload?.currency || ''}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-slate-700">POI Cache</div>
            <div className={statusBadge(Boolean(cacheData?.ok))}>{cacheData?.ok ? 'OK' : 'FAIL'}</div>
            <div className="mt-2 text-xs text-slate-500">Entries: {totalEntries}</div>
            <div className="mt-1 text-xs text-slate-500">TTL: {cacheData?.payload?.ttlSeconds ?? '-'} s</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">Cache matrix (cities x POI types)</div>

          {loading ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : cityPoiMatrix.cities.length === 0 ? (
            <div className="text-sm text-slate-500">No cache entries yet</div>
          ) : (
            <div className="overflow-auto rounded-md border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2">City</th>
                    {poiTypes.map((poiType) => (
                      <th key={`h-${poiType}`} className="px-3 py-2">{poiType}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cityPoiMatrix.cities.map((city) => (
                    <tr key={`m-${city}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{city}</td>
                      {poiTypes.map((poiType) => {
                        const cell = cityPoiMatrix.byCity[city]?.[poiType]
                        const hasCache = Boolean(cell)
                        return (
                          <td key={`${city}-${poiType}`} className="px-3 py-2">
                            {hasCache ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                cache ({cell.pointCount})
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700">
                                no cache
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">Cache details by POI type and city</div>

          {loading ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : Object.keys(groupedCache).length === 0 ? (
            <div className="text-sm text-slate-500">No cache entries yet</div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedCache).map(([poiType, items]) => (
                <div key={poiType}>
                  <div className="mb-2 text-sm font-semibold text-slate-800">{poiType}</div>
                  <div className="overflow-auto rounded-md border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="px-3 py-2">City</th>
                          <th className="px-3 py-2">Points</th>
                          <th className="px-3 py-2">Fresh</th>
                          <th className="px-3 py-2">Cooldown</th>
                          <th className="px-3 py-2">Age (s)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={`${poiType}-${item.cityKey}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-700">{item.cityKey}</td>
                            <td className="px-3 py-2 text-slate-700">{item.pointCount}</td>
                            <td className="px-3 py-2 text-slate-700">{item.isFresh ? 'yes' : 'no'}</td>
                            <td className="px-3 py-2 text-slate-700">{item.isInCooldown ? 'yes' : 'no'}</td>
                            <td className="px-3 py-2 text-slate-700">{item.ageSeconds ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">Request logs</div>
          <div className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-emerald-300">
            {requestLogs.length === 0 ? (
              <div className="text-slate-400">No logs yet</div>
            ) : (
              requestLogs.map((line, idx) => <div key={`log-${idx}`}>{line}</div>)
            )}
          </div>
        </div>

        <div className="pb-6 text-center text-xs text-slate-500">
          POI data source: OpenStreetMap Overpass API. Learn more at{' '}
          <a
            href="https://overpass-api.de/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-teal-700 underline"
          >
            overpass-api.de
          </a>
          .
        </div>
      </div>
    </div>
  )
}
