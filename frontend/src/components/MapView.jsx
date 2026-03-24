import React, { useMemo, useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const UNIVERSITIES_CACHE_KEY = 'universities_by_city_cache_v2'
const SCHOOLS_CACHE_KEY = 'schools_by_city_cache_v1'
const CLINICS_CACHE_KEY = 'clinics_by_city_cache_v1'
const POST_OFFICES_CACHE_KEY = 'post_offices_by_city_cache_v1'
const RESTAURANTS_CACHE_KEY = 'restaurants_by_city_cache_v1'
const PHARMACIES_CACHE_KEY = 'pharmacies_by_city_cache_v1'
const KINDERGARTENS_CACHE_KEY = 'kindergartens_by_city_cache_v1'
const UNIVERSITIES_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const OVERPASS_DEBUG_LOGS = import.meta.env.VITE_OVERPASS_DEBUG === 'true'
const OVERPASS_REQUEST_TIMEOUT_MS = 30000
const OVERPASS_FAILED_CITY_COOLDOWN_MS = 1000 * 60 * 10
const OVERPASS_PREFETCH_CONCURRENCY = 3
const POI_AUTO_REFRESH_BATCH_DELAY_MS = 1000 * 60
const POI_AUTO_REFRESH_META_KEY = 'poi_auto_refresh_meta_v1'
const APARTMENT_SNAP_DISTANCE_METERS = 180

function msUntilNextMidnight(nowMs = Date.now()) {
  const now = new Date(nowMs)
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - now.getTime())
}

function readAutoRefreshMeta() {
  try {
    const raw = localStorage.getItem(POI_AUTO_REFRESH_META_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeAutoRefreshMeta(metaPatch) {
  try {
    const prev = readAutoRefreshMeta()
    localStorage.setItem(POI_AUTO_REFRESH_META_KEY, JSON.stringify({ ...prev, ...metaPatch }))
  } catch (_error) {
    // ignore storage write issues
  }
}

function logOverpass(level, message, details) {
  if (!OVERPASS_DEBUG_LOGS) return
  const prefix = '[overpass]'
  if (details) {
    console[level](`${prefix} ${message}`, details)
  } else {
    console[level](`${prefix} ${message}`)
  }
}

async function runPrefetchBatches(
  boundaries,
  worker,
  isCancelled,
  concurrency = OVERPASS_PREFETCH_CONCURRENCY,
  batchDelayMs = 0
) {
  const delayMs = Number.isFinite(batchDelayMs) ? Math.max(0, Number(batchDelayMs)) : 0
  for (let i = 0; i < boundaries.length; i += concurrency) {
    if (isCancelled()) return
    const batch = boundaries.slice(i, i + concurrency)
    await Promise.allSettled(batch.map((boundary) => worker(boundary)))
    const hasMore = (i + concurrency) < boundaries.length
    if (hasMore && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    if (isCancelled()) return
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchPoiFromBackend(poiType, city, cityGeometry, cityPolygon, options = {}) {
  if (!cityGeometry) return []
  const { forceRefresh = false } = options
  const { centerLat, centerLng, radiusMeters } = cityGeometry
  logOverpass('info', `backend poi request type=${poiType} city=${city} forceRefresh=${forceRefresh}`)

  const response = await fetchJsonWithTimeout(
    '/api/poi/fetch',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        poiType,
        city,
        centerLat,
        centerLng,
        radiusMeters,
        polygon: cityPolygon || [],
        forceRefresh
      })
    },
    OVERPASS_REQUEST_TIMEOUT_MS
  )

  if (!response.ok) {
    logOverpass('warn', `backend poi non-200 type=${poiType} city=${city} status=${response.status}`)
    return []
  }

  const data = await response.json()
  const points = Array.isArray(data?.points) ? data.points : []
  logOverpass('info', `backend poi result type=${poiType} city=${city} count=${points.length} source=${data?.source || 'unknown'}`)
  return points
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

function toNullableNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function roundDistance(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null
}

function normalizePoiCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function computePoiAggregate(distances) {
  const values = distances.filter((v) => Number.isFinite(v))
  if (!values.length) {
    return {
      nearset_poi_distance: null,
      poi_sum_distance: null
    }
  }
  return {
    nearset_poi_distance: roundDistance(Math.min(...values)),
    poi_sum_distance: roundDistance(values.reduce((sum, v) => sum + v, 0))
  }
}

function cleanCityName(value) {
  return String(value || '').replace(/\uFEFF/g, '').trim().replace(/\s+/g, ' ')
}

function normalizeCityName(value) {
  return cleanCityName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function displayCityName(value) {
  const cleaned = cleanCityName(value)
  if (!cleaned) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371 // kilometers
  const toRad = (v) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function cross(o, a, b) {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
}

function convexHull(points) {
  if (points.length <= 3) return points
  const sorted = [...points].sort((p1, p2) => (p1.lng - p2.lng) || (p1.lat - p2.lat))
  const lower = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function createBoxPolygon(points) {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng }
  ]
}

function expandPolygon(points, bufferMeters) {
  const centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length
  const metersPerDegLat = 111320
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180)

  return points.map((p) => {
    const dx = (p.lng - centerLng) * metersPerDegLng
    const dy = (p.lat - centerLat) * metersPerDegLat
    const distance = Math.hypot(dx, dy)
    if (distance < 1e-6) {
      const latShift = bufferMeters / metersPerDegLat
      return { lat: p.lat + latShift, lng: p.lng }
    }
    const scale = (distance + bufferMeters) / distance
    return {
      lat: centerLat + ((dy * scale) / metersPerDegLat),
      lng: centerLng + ((dx * scale) / metersPerDegLng)
    }
  })
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]

    const intersect = ((yi > lng) !== (yj > lng))
      && (lat < ((xj - xi) * (lng - yi)) / (yj - yi + Number.EPSILON) + xi)

    if (intersect) inside = !inside
  }
  return inside
}

function buildCityCenterReferences(apartments) {
  const byCity = {}

  for (const apartment of apartments) {
    const city = normalizeCityName(apartment.city)
    if (!city) continue
    if (!Number.isFinite(apartment.centreDistance)) continue
    if (!Number.isFinite(apartment.latitude) || !Number.isFinite(apartment.longitude)) continue

    const current = byCity[city]
    if (!current || apartment.centreDistance < current.centreDistance) {
      byCity[city] = {
        latitude: apartment.latitude,
        longitude: apartment.longitude,
        centreDistance: apartment.centreDistance
      }
    }
  }

  return byCity
}

function readUniversitiesCache() {
  try {
    const raw = localStorage.getItem(UNIVERSITIES_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeUniversitiesCache(cache) {
  try {
    localStorage.setItem(UNIVERSITIES_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues (quota/private mode)
  }
}

function getCachedUniversities(city) {
  const cache = readUniversitiesCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedUniversities(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readUniversitiesCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writeUniversitiesCache(cache)
}

function readSchoolsCache() {
  try {
    const raw = localStorage.getItem(SCHOOLS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeSchoolsCache(cache) {
  try {
    localStorage.setItem(SCHOOLS_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedSchools(city) {
  const cache = readSchoolsCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `school cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedSchools(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readSchoolsCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writeSchoolsCache(cache)
}

function readClinicsCache() {
  try {
    const raw = localStorage.getItem(CLINICS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeClinicsCache(cache) {
  try {
    localStorage.setItem(CLINICS_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedClinics(city) {
  const cache = readClinicsCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `clinic cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedClinics(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readClinicsCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writeClinicsCache(cache)
}

function readPostOfficesCache() {
  try {
    const raw = localStorage.getItem(POST_OFFICES_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writePostOfficesCache(cache) {
  try {
    localStorage.setItem(POST_OFFICES_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedPostOffices(city) {
  const cache = readPostOfficesCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `postOffice cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedPostOffices(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readPostOfficesCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writePostOfficesCache(cache)
}

function readRestaurantsCache() {
  try {
    const raw = localStorage.getItem(RESTAURANTS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeRestaurantsCache(cache) {
  try {
    localStorage.setItem(RESTAURANTS_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedRestaurants(city) {
  const cache = readRestaurantsCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `restaurant cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedRestaurants(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readRestaurantsCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writeRestaurantsCache(cache)
}

function readPharmaciesCache() {
  try {
    const raw = localStorage.getItem(PHARMACIES_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writePharmaciesCache(cache) {
  try {
    localStorage.setItem(PHARMACIES_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedPharmacies(city) {
  const cache = readPharmaciesCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `pharmacy cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedPharmacies(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readPharmaciesCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writePharmaciesCache(cache)
}

function readKindergartensCache() {
  try {
    const raw = localStorage.getItem(KINDERGARTENS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writeKindergartensCache(cache) {
  try {
    localStorage.setItem(KINDERGARTENS_CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // ignore storage write issues
  }
}

function getCachedKindergartens(city) {
  const cache = readKindergartensCache()
  const item = cache[city]
  if (!item) return null
  const isFresh = Number.isFinite(item.updatedAt) && (Date.now() - item.updatedAt) < UNIVERSITIES_CACHE_TTL_MS
  if (!isFresh || !Array.isArray(item.points)) return null
  logOverpass('info', `kindergarten cache hit for city=${city}, count=${item.points.length}`)
  return item.points
}

function putCachedKindergartens(city, points) {
  if (!Array.isArray(points) || points.length === 0) return
  const cache = readKindergartensCache()
  cache[city] = {
    points,
    updatedAt: Date.now()
  }
  writeKindergartensCache(cache)
}

function buildCityGeometry(apartments) {
  const byCity = apartments.reduce((acc, apartment) => {
    const key = normalizeCityName(apartment.city)
    if (!key) return acc
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push({ lat: apartment.latitude, lng: apartment.longitude })
    return acc
  }, {})

  const geometry = {}
  for (const [city, points] of Object.entries(byCity)) {
    if (!points.length) continue
    const centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
    const centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length
    let maxDistanceKm = 0
    for (const p of points) {
      const d = haversineKm(centerLat, centerLng, p.lat, p.lng)
      if (d > maxDistanceKm) maxDistanceKm = d
    }
    geometry[city] = {
      centerLat,
      centerLng,
      radiusMeters: Math.max(10000, Math.ceil((maxDistanceKm + 10) * 1000))
    }
  }

  return geometry
}

async function fetchUniversitiesForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('college', city, cityGeometry, cityPolygon, options)
}

async function fetchSchoolsForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('school', city, cityGeometry, cityPolygon, options)
}

async function fetchClinicsForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('clinic', city, cityGeometry, cityPolygon, options)
}

async function fetchPostOfficesForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('postOffice', city, cityGeometry, cityPolygon, options)
}

async function fetchRestaurantsForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('restaurant', city, cityGeometry, cityPolygon, options)
}

async function fetchPharmaciesForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('pharmacy', city, cityGeometry, cityPolygon, options)
}

async function fetchKindergartensForCity(city, cityGeometry, cityPolygon, options = {}) {
  return fetchPoiFromBackend('kindergarten', city, cityGeometry, cityPolygon, options)
}

function estimateMapFeatures(
  lat,
  lng,
  apartments,
  city,
  cityCenterReferences,
  universitiesByCity,
  universitiesOverride,
  schoolsByCity,
  schoolsOverride,
  clinicsByCity,
  clinicsOverride,
  postOfficesByCity,
  postOfficesOverride,
  restaurantsByCity,
  restaurantsOverride,
  pharmaciesByCity,
  pharmaciesOverride,
  kindergartensByCity,
  kindergartensOverride
) {
  const cityKey = normalizeCityName(city)
  const candidates = []

  for (const apartment of apartments) {
    if (cityKey && normalizeCityName(apartment.city) !== cityKey) continue
    if (!Number.isFinite(apartment.latitude) || !Number.isFinite(apartment.longitude)) continue
    const dLat = apartment.latitude - lat
    const dLng = apartment.longitude - lng
    const distance2 = dLat * dLat + dLng * dLng
    candidates.push({ apartment, distance2 })
  }

  if (!candidates.length) {
    return {
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
      poi_sum_distance: null
    }
  }

  candidates.sort((a, b) => a.distance2 - b.distance2)
  const nearest = candidates.slice(0, 8)

  function weightedAverage(getter) {
    let weightedSum = 0
    let weightSum = 0
    for (const item of nearest) {
      const value = getter(item.apartment)
      if (!Number.isFinite(value)) continue
      const weight = 1 / (Math.sqrt(item.distance2) + 1e-6)
      weightedSum += value * weight
      weightSum += weight
    }
    if (!weightSum) return null
    return weightedSum / weightSum
  }

  const schoolDistanceInterpolated = weightedAverage((row) => row.schoolDistance)
  const clinicDistanceInterpolated = weightedAverage((row) => row.clinicDistance)
  const postOfficeDistanceInterpolated = weightedAverage((row) => row.postOfficeDistance)
  const kindergartenDistanceInterpolated = weightedAverage((row) => row.kindergartenDistance)
  const restaurantDistanceInterpolated = weightedAverage((row) => row.restaurantDistance)
  const collegeDistanceInterpolated = weightedAverage((row) => row.collegeDistance)
  const pharmacyDistanceInterpolated = weightedAverage((row) => row.pharmacyDistance)

  const cityCenterRef = cityCenterReferences[cityKey]
  const centreDistance = cityCenterRef
    ? cityCenterRef.centreDistance + haversineKm(lat, lng, cityCenterRef.latitude, cityCenterRef.longitude)
    : weightedAverage((row) => row.centreDistance)

  const universityPoints = universitiesOverride ?? (universitiesByCity[cityKey] || [])
  let collegeDistanceActual = null
  if (universityPoints.length) {
    for (const uni of universityPoints) {
      const distanceKm = haversineKm(lat, lng, uni.lat, uni.lng)
      if (!Number.isFinite(collegeDistanceActual) || distanceKm < collegeDistanceActual) {
        collegeDistanceActual = distanceKm
      }
    }
  }

  const schoolPoints = schoolsOverride ?? (schoolsByCity[cityKey] || [])
  let schoolDistanceActual = null
  if (schoolPoints.length) {
    for (const school of schoolPoints) {
      const distanceKm = haversineKm(lat, lng, school.lat, school.lng)
      if (!Number.isFinite(schoolDistanceActual) || distanceKm < schoolDistanceActual) {
        schoolDistanceActual = distanceKm
      }
    }
  }

  const schoolDistance = schoolDistanceActual ?? schoolDistanceInterpolated

  const clinicPoints = clinicsOverride ?? (clinicsByCity[cityKey] || [])
  let clinicDistanceActual = null
  if (clinicPoints.length) {
    for (const clinic of clinicPoints) {
      const distanceKm = haversineKm(lat, lng, clinic.lat, clinic.lng)
      if (!Number.isFinite(clinicDistanceActual) || distanceKm < clinicDistanceActual) {
        clinicDistanceActual = distanceKm
      }
    }
  }

  const clinicDistance = clinicDistanceActual ?? clinicDistanceInterpolated

  const postOfficePoints = postOfficesOverride ?? (postOfficesByCity[cityKey] || [])
  let postOfficeDistanceActual = null
  if (postOfficePoints.length) {
    for (const postOffice of postOfficePoints) {
      const distanceKm = haversineKm(lat, lng, postOffice.lat, postOffice.lng)
      if (!Number.isFinite(postOfficeDistanceActual) || distanceKm < postOfficeDistanceActual) {
        postOfficeDistanceActual = distanceKm
      }
    }
  }

  const postOfficeDistance = postOfficeDistanceActual ?? postOfficeDistanceInterpolated

  const restaurantPoints = restaurantsOverride ?? (restaurantsByCity[cityKey] || [])
  let restaurantDistanceActual = null
  if (restaurantPoints.length) {
    for (const restaurant of restaurantPoints) {
      const distanceKm = haversineKm(lat, lng, restaurant.lat, restaurant.lng)
      if (!Number.isFinite(restaurantDistanceActual) || distanceKm < restaurantDistanceActual) {
        restaurantDistanceActual = distanceKm
      }
    }
  }
  const restaurantDistance = restaurantDistanceActual ?? restaurantDistanceInterpolated

  const pharmacyPoints = pharmaciesOverride ?? (pharmaciesByCity[cityKey] || [])
  let pharmacyDistanceActual = null
  if (pharmacyPoints.length) {
    for (const pharmacy of pharmacyPoints) {
      const distanceKm = haversineKm(lat, lng, pharmacy.lat, pharmacy.lng)
      if (!Number.isFinite(pharmacyDistanceActual) || distanceKm < pharmacyDistanceActual) {
        pharmacyDistanceActual = distanceKm
      }
    }
  }
  const pharmacyDistance = pharmacyDistanceActual ?? pharmacyDistanceInterpolated

  const kindergartenPoints = kindergartensOverride ?? (kindergartensByCity[cityKey] || [])
  let kindergartenDistanceActual = null
  if (kindergartenPoints.length) {
    for (const kindergarten of kindergartenPoints) {
      const distanceKm = haversineKm(lat, lng, kindergarten.lat, kindergarten.lng)
      if (!Number.isFinite(kindergartenDistanceActual) || distanceKm < kindergartenDistanceActual) {
        kindergartenDistanceActual = distanceKm
      }
    }
  }
  const kindergartenDistance = kindergartenDistanceActual ?? kindergartenDistanceInterpolated

  const poiDistances = [
    schoolDistance,
    clinicDistance,
    postOfficeDistance,
    kindergartenDistance,
    restaurantDistance,
    collegeDistanceActual ?? collegeDistanceInterpolated,
    pharmacyDistance
  ]

  const aggregated = computePoiAggregate(poiDistances)

  return {
    centreDistance: roundDistance(centreDistance),
    poiCount: normalizePoiCount(weightedAverage((row) => row.poiCount)),
    collegeDistance: roundDistance(collegeDistanceActual ?? collegeDistanceInterpolated),
    schoolDistance: roundDistance(schoolDistance),
    clinicDistance: roundDistance(clinicDistance),
    postOfficeDistance: roundDistance(postOfficeDistance),
    kindergartenDistance: roundDistance(kindergartenDistance),
    restaurantDistance: roundDistance(restaurantDistance),
    pharmacyDistance: roundDistance(pharmacyDistance),
    nearset_poi_distance: aggregated.nearset_poi_distance,
    poi_sum_distance: aggregated.poi_sum_distance
  }
}

function buildCityBoundaries(apartments) {
  const byCity = apartments.reduce((acc, apartment) => {
    const key = normalizeCityName(apartment.city)
    if (!key) return acc
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push({ lat: apartment.latitude, lng: apartment.longitude })
    return acc
  }, {})

  return Object.entries(byCity).map(([city, points]) => {
    const basePolygon = points.length >= 3 ? convexHull(points) : createBoxPolygon(points)
    const buffered = expandPolygon(basePolygon, 1700)
    return {
      city,
      polygon: buffered.map((p) => [p.lat, p.lng])
    }
  })
}

function getFeaturesFromApartment(apartment) {
  const normalized = {
    centreDistance: roundDistance(apartment.centreDistance),
    poiCount: normalizePoiCount(apartment.poiCount),
    collegeDistance: roundDistance(apartment.collegeDistance),
    schoolDistance: roundDistance(apartment.schoolDistance),
    clinicDistance: roundDistance(apartment.clinicDistance),
    postOfficeDistance: roundDistance(apartment.postOfficeDistance),
    kindergartenDistance: roundDistance(apartment.kindergartenDistance),
    restaurantDistance: roundDistance(apartment.restaurantDistance),
    pharmacyDistance: roundDistance(apartment.pharmacyDistance)
  }

  const recomputedAggregates = computePoiAggregate([
    normalized.schoolDistance,
    normalized.clinicDistance,
    normalized.postOfficeDistance,
    normalized.kindergartenDistance,
    normalized.restaurantDistance,
    normalized.collegeDistance,
    normalized.pharmacyDistance
  ])

  return {
    ...normalized,
    nearset_poi_distance: roundDistance(apartment.nearset_poi_distance) ?? recomputedAggregates.nearset_poi_distance,
    poi_sum_distance: roundDistance(apartment.poi_sum_distance) ?? recomputedAggregates.poi_sum_distance
  }
}

function findNearestApartmentWithin(apartments, city, lat, lng, maxMeters) {
  let best = null
  const cityKey = city ? normalizeCityName(city) : ''

  for (const apartment of apartments) {
    if (!Number.isFinite(apartment.latitude) || !Number.isFinite(apartment.longitude)) continue
    if (cityKey && normalizeCityName(apartment.city) !== cityKey) continue

    const distanceMeters = haversineKm(lat, lng, apartment.latitude, apartment.longitude) * 1000
    if (distanceMeters > maxMeters) continue
    if (!best || distanceMeters < best.distanceMeters) {
      best = { apartment, distanceMeters }
    }
  }

  return best
}

function ViewportTracker({ onViewportChange }) {
  const map = useMap()

  useEffect(() => {
    function emitViewport() {
      const bounds = map.getBounds()
      onViewportChange({
        zoom: map.getZoom(),
        bounds: {
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast()
        }
      })
    }

    emitViewport()
    map.on('moveend', emitViewport)
    map.on('zoomend', emitViewport)
    return () => {
      map.off('moveend', emitViewport)
      map.off('zoomend', emitViewport)
    }
  }, [map, onViewportChange])

  return null
}

function ClickHandler({
  onMapClick,
  boundaries,
  apartments,
  cityCenterReferences,
  universitiesByCity,
  ensureUniversitiesForCity,
  schoolsByCity,
  ensureSchoolsForCity,
  clinicsByCity,
  ensureClinicsForCity,
  postOfficesByCity,
  ensurePostOfficesForCity,
  restaurantsByCity,
  ensureRestaurantsForCity,
  pharmaciesByCity,
  ensurePharmaciesForCity,
  kindergartensByCity,
  ensureKindergartensForCity
}) {
  useMapEvents({
    async click(e) {
      const { lat, lng } = e.latlng

      let matched = ''
      let matchedBoundary = null
      for (const boundary of boundaries) {
        if (pointInPolygon(lat, lng, boundary.polygon)) {
          matched = boundary.city
          matchedBoundary = boundary
          break
        }
      }

      const snapped = findNearestApartmentWithin(
        apartments,
        matched || null,
        lat,
        lng,
        APARTMENT_SNAP_DISTANCE_METERS
      )

      let universitiesOverride = null
      let schoolsOverride = null
      let clinicsOverride = null
      let postOfficesOverride = null
      let restaurantsOverride = null
      let pharmaciesOverride = null
      let kindergartensOverride = null
      if (!snapped && matched && matchedBoundary) {
        universitiesOverride = await ensureUniversitiesForCity(matched, matchedBoundary.polygon)
        schoolsOverride = await ensureSchoolsForCity(matched, matchedBoundary.polygon)
        clinicsOverride = await ensureClinicsForCity(matched, matchedBoundary.polygon)
        postOfficesOverride = await ensurePostOfficesForCity(matched, matchedBoundary.polygon)
        restaurantsOverride = await ensureRestaurantsForCity(matched, matchedBoundary.polygon)
        pharmaciesOverride = await ensurePharmaciesForCity(matched, matchedBoundary.polygon)
        kindergartensOverride = await ensureKindergartensForCity(matched, matchedBoundary.polygon)
      }

      const features = snapped
        ? getFeaturesFromApartment(snapped.apartment)
        : matched
        ? estimateMapFeatures(
            lat,
            lng,
            apartments,
            matched,
            cityCenterReferences,
            universitiesByCity,
            universitiesOverride,
            schoolsByCity,
            schoolsOverride,
            clinicsByCity,
            clinicsOverride,
            postOfficesByCity,
            postOfficesOverride,
            restaurantsByCity,
            restaurantsOverride,
            pharmaciesByCity,
            pharmaciesOverride,
            kindergartensByCity,
            kindergartensOverride
          )
        : {
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
            poi_sum_distance: null
          }

      if (snapped) {
        matched = snapped.apartment.city || matched
      }

      onMapClick({
        lat,
        lng,
        city: matched,
        centreDistance: features.centreDistance,
        poiCount: features.poiCount,
        collegeDistance: features.collegeDistance,
        schoolDistance: features.schoolDistance,
        clinicDistance: features.clinicDistance,
        postOfficeDistance: features.postOfficeDistance,
        kindergartenDistance: features.kindergartenDistance,
        restaurantDistance: features.restaurantDistance,
        pharmacyDistance: features.pharmacyDistance,
        nearset_poi_distance: features.nearset_poi_distance,
        poi_sum_distance: features.poi_sum_distance
      })
    }
  })
  return null
}

export default function MapView({
  onMapClick,
  onApartmentClick,
  selectedPoint,
  showCollegePoi = false,
  showSchoolPoi = false,
  showClinicPoi = false,
  showPostOfficePoi = false,
  showRestaurantPoi = false,
  showPharmacyPoi = false,
  showKindergartenPoi = false
}) {
  const center = useMemo(() => [52.069167, 19.480556], []) // center of Poland
  const [apartments, setApartments] = useState([])
  const [viewport, setViewport] = useState({
    zoom: 6,
    bounds: null
  })
  const cityBoundaries = useMemo(() => buildCityBoundaries(apartments), [apartments])
  const [universitiesByCity, setUniversitiesByCity] = useState({})
  const [schoolsByCity, setSchoolsByCity] = useState({})
  const [clinicsByCity, setClinicsByCity] = useState({})
  const [postOfficesByCity, setPostOfficesByCity] = useState({})
  const [restaurantsByCity, setRestaurantsByCity] = useState({})
  const [pharmaciesByCity, setPharmaciesByCity] = useState({})
  const [kindergartensByCity, setKindergartensByCity] = useState({})
  const inFlightUniversitiesRef = useRef({})
  const inFlightSchoolsRef = useRef({})
  const inFlightClinicsRef = useRef({})
  const inFlightPostOfficesRef = useRef({})
  const inFlightRestaurantsRef = useRef({})
  const inFlightPharmaciesRef = useRef({})
  const inFlightKindergartensRef = useRef({})
  const universitiesByCityRef = useRef({})
  const schoolsByCityRef = useRef({})
  const clinicsByCityRef = useRef({})
  const postOfficesByCityRef = useRef({})
  const restaurantsByCityRef = useRef({})
  const pharmaciesByCityRef = useRef({})
  const kindergartensByCityRef = useRef({})
  const failedUniversityCityFetchRef = useRef({})
  const failedSchoolCityFetchRef = useRef({})
  const failedClinicCityFetchRef = useRef({})
  const failedPostOfficeCityFetchRef = useRef({})
  const failedRestaurantCityFetchRef = useRef({})
  const failedPharmacyCityFetchRef = useRef({})
  const failedKindergartenCityFetchRef = useRef({})
  const autoRefreshInFlightRef = useRef(false)
  const prefetchStartedRef = useRef({ college: false, school: false, clinic: false, postOffice: false, restaurant: false, pharmacy: false, kindergarten: false })
  const cityGeometry = useMemo(() => buildCityGeometry(apartments), [apartments])
  const cityCenterReferences = useMemo(() => buildCityCenterReferences(apartments), [apartments])
  const universityPoints = useMemo(() => Object.values(universitiesByCity).flat(), [universitiesByCity])
  const schoolPoints = useMemo(() => Object.values(schoolsByCity).flat(), [schoolsByCity])
  const clinicPoints = useMemo(() => Object.values(clinicsByCity).flat(), [clinicsByCity])
  const postOfficePoints = useMemo(() => Object.values(postOfficesByCity).flat(), [postOfficesByCity])
  const restaurantPoints = useMemo(() => Object.values(restaurantsByCity).flat(), [restaurantsByCity])
  const pharmacyPoints = useMemo(() => Object.values(pharmaciesByCity).flat(), [pharmaciesByCity])

  const visibleApartments = useMemo(() => {
    if (!apartments.length) return []

    let inView = apartments
    const b = viewport.bounds
    if (b) {
      inView = apartments.filter((a) => (
        Number.isFinite(a.latitude)
        && Number.isFinite(a.longitude)
        && a.latitude >= b.south
        && a.latitude <= b.north
        && a.longitude >= b.west
        && a.longitude <= b.east
      ))
    }

    // Keep first paint responsive by limiting marker count on lower zoom levels.
    let maxMarkers = 4000
    if (viewport.zoom < 8) maxMarkers = 300
    else if (viewport.zoom < 10) maxMarkers = 700
    else if (viewport.zoom < 12) maxMarkers = 1500

    if (inView.length <= maxMarkers) return inView

    const sampled = []
    const step = inView.length / maxMarkers
    for (let i = 0; i < maxMarkers; i += 1) {
      sampled.push(inView[Math.floor(i * step)])
    }
    return sampled
  }, [apartments, viewport])

  useEffect(()=>{
    let cancelled = false

    async function loadApartments() {
      try {
        const response = await fetch('/api/apartments')
        if (!response.ok) {
          logOverpass('warn', `apartments api non-200 status=${response.status}`)
          return
        }

        const data = await response.json()
        if (!Array.isArray(data)) {
          logOverpass('warn', 'apartments api returned non-array payload')
          return
        }

        const rows = data.map((r, idx) => ({
          id: r.id ?? `${cleanCityName(r.city)}-${toNumber(r.latitude)}-${toNumber(r.longitude)}-${idx}`,
          rawRecord: r,
          city: cleanCityName(r.city),
          type: r.type,
          squareMeters: toNumber(r.squareMeters),
          rooms: toNumber(r.rooms),
          floor: toNumber(r.floor),
          floorCount: toNumber(r.floorCount),
          buildingAge: toNumber(r.building_age ?? r.buildingAge ?? r.buildYear),
          latitude: toNumber(r.latitude),
          longitude: toNumber(r.longitude),
          centreDistance: toNullableNumber(r.centreDistance),
          poiCount: toNullableNumber(r.poiCount),
          collegeDistance: toNullableNumber(r.collegeDistance),
          schoolDistance: toNullableNumber(r.schoolDistance),
          clinicDistance: toNullableNumber(r.clinicDistance),
          postOfficeDistance: toNullableNumber(r.postOfficeDistance),
          kindergartenDistance: toNullableNumber(r.kindergartenDistance),
          restaurantDistance: toNullableNumber(r.restaurantDistance),
          pharmacyDistance: toNullableNumber(r.pharmacyDistance),
          price: toNumber(r.price),
          condition: r.condition,
          hasParkingSpace: toBoolean(r.hasParkingSpace),
          hasBalcony: toBoolean(r.hasBalcony),
          hasElevator: toBoolean(r.hasElevator),
          hasSecurity: toBoolean(r.hasSecurity),
          hasStorageRoom: toBoolean(r.hasStorageRoom)
        }))

        const filtered = rows.filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
        if (!cancelled) {
          setApartments(filtered)
        }
      } catch (_error) {
        logOverpass('warn', 'apartments api request failed')
      }
    }

    loadApartments()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!apartments.length) {
      setUniversitiesByCity({})
      setSchoolsByCity({})
      setClinicsByCity({})
      setPostOfficesByCity({})
      setRestaurantsByCity({})
      setPharmaciesByCity({})
      setKindergartensByCity({})
      return
    }

    const cities = Array.from(new Set(apartments.map((a) => normalizeCityName(a.city)).filter(Boolean)))
    const fromCache = {}
    const schoolsFromCache = {}
    const clinicsFromCache = {}
    const postOfficesFromCache = {}
    const restaurantsFromCache = {}
    const pharmaciesFromCache = {}
    const kindergartensFromCache = {}
    for (const city of cities) {
      const cached = getCachedUniversities(city)
      if (cached) fromCache[city] = cached
      const cachedSchools = getCachedSchools(city)
      if (cachedSchools) schoolsFromCache[city] = cachedSchools
      const cachedClinics = getCachedClinics(city)
      if (cachedClinics) clinicsFromCache[city] = cachedClinics
      const cachedPostOffices = getCachedPostOffices(city)
      if (cachedPostOffices) postOfficesFromCache[city] = cachedPostOffices
      const cachedRestaurants = getCachedRestaurants(city)
      if (cachedRestaurants) restaurantsFromCache[city] = cachedRestaurants
      const cachedPharmacies = getCachedPharmacies(city)
      if (cachedPharmacies) pharmaciesFromCache[city] = cachedPharmacies
      const cachedKindergartens = getCachedKindergartens(city)
      if (cachedKindergartens) kindergartensFromCache[city] = cachedKindergartens
    }
    setUniversitiesByCity(fromCache)
    setSchoolsByCity(schoolsFromCache)
    setClinicsByCity(clinicsFromCache)
    setPostOfficesByCity(postOfficesFromCache)
    setRestaurantsByCity(restaurantsFromCache)
    setPharmaciesByCity(pharmaciesFromCache)
    setKindergartensByCity(kindergartensFromCache)
  }, [apartments])

  useEffect(() => {
    universitiesByCityRef.current = universitiesByCity
  }, [universitiesByCity])

  useEffect(() => {
    schoolsByCityRef.current = schoolsByCity
  }, [schoolsByCity])

  useEffect(() => {
    clinicsByCityRef.current = clinicsByCity
  }, [clinicsByCity])

  useEffect(() => {
    postOfficesByCityRef.current = postOfficesByCity
  }, [postOfficesByCity])

  useEffect(() => {
    restaurantsByCityRef.current = restaurantsByCity
  }, [restaurantsByCity])

  useEffect(() => {
    pharmaciesByCityRef.current = pharmaciesByCity
  }, [pharmaciesByCity])

  useEffect(() => {
    kindergartensByCityRef.current = kindergartensByCity
  }, [kindergartensByCity])

  async function ensureUniversitiesForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)

    const failedAt = failedUniversityCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) {
      logOverpass('warn', `college cooldown active city=${cityKey}, skip retry`)
      return []
    }

    const statePoints = universitiesByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedUniversities(cityKey)
      if (!Array.isArray(stateBackedByFreshLocalCache) || stateBackedByFreshLocalCache.length === 0) {
        logOverpass('info', `college state is stale city=${cityKey}, forcing refresh`)
      } else {
        logOverpass('info', `state hit city=${cityKey} count=${statePoints.length}`)
        return statePoints
      }
    }

    if (inFlightUniversitiesRef.current[cityKey]) {
      logOverpass('info', `in-flight hit city=${cityKey}`)
      return inFlightUniversitiesRef.current[cityKey]
    }

    const cached = forceRefresh ? null : getCachedUniversities(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setUniversitiesByCity((prev) => ({ ...prev, [cityKey]: cached }))
      logOverpass('info', `cache loaded into state city=${cityKey} count=${cached.length}`)
      return cached
    }

    logOverpass('info', `${forceRefresh ? 'force refresh' : 'cache miss'} city=${cityKey}`)
    const requestPromise = (async () => {
      const points = await fetchUniversitiesForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedUniversities(cityKey, points)
      setUniversitiesByCity((prev) => ({ ...prev, [cityKey]: points }))
      logOverpass('info', `state updated from network city=${cityKey} count=${points.length}`)
      if (!points.length) {
        failedUniversityCityFetchRef.current[cityKey] = Date.now()
      } else {
        delete failedUniversityCityFetchRef.current[cityKey]
      }
      return points
    })()

    inFlightUniversitiesRef.current[cityKey] = requestPromise
    try {
      return await requestPromise
    } finally {
      delete inFlightUniversitiesRef.current[cityKey]
    }
  }

  async function ensureSchoolsForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)

    const failedAt = failedSchoolCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) {
      logOverpass('warn', `school cooldown active city=${cityKey}, skip retry`)
      return []
    }

    const statePoints = schoolsByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedSchools(cityKey)
      if (!Array.isArray(stateBackedByFreshLocalCache) || stateBackedByFreshLocalCache.length === 0) {
        logOverpass('info', `school state is stale city=${cityKey}, forcing refresh`)
      } else {
        logOverpass('info', `school state hit city=${cityKey} count=${statePoints.length}`)
        return statePoints
      }
    }

    if (inFlightSchoolsRef.current[cityKey]) {
      logOverpass('info', `school in-flight hit city=${cityKey}`)
      return inFlightSchoolsRef.current[cityKey]
    }

    const cached = forceRefresh ? null : getCachedSchools(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setSchoolsByCity((prev) => ({ ...prev, [cityKey]: cached }))
      logOverpass('info', `school cache loaded into state city=${cityKey} count=${cached.length}`)
      return cached
    }

    logOverpass('info', `school ${forceRefresh ? 'force refresh' : 'cache miss'} city=${cityKey}`)
    const requestPromise = (async () => {
      const points = await fetchSchoolsForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedSchools(cityKey, points)
      setSchoolsByCity((prev) => ({ ...prev, [cityKey]: points }))
      logOverpass('info', `school state updated from network city=${cityKey} count=${points.length}`)
      if (!points.length) {
        failedSchoolCityFetchRef.current[cityKey] = Date.now()
      } else {
        delete failedSchoolCityFetchRef.current[cityKey]
      }
      return points
    })()

    inFlightSchoolsRef.current[cityKey] = requestPromise
    try {
      return await requestPromise
    } finally {
      delete inFlightSchoolsRef.current[cityKey]
    }
  }

  async function ensureClinicsForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)

    const failedAt = failedClinicCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) {
      logOverpass('warn', `clinic cooldown active city=${cityKey}, skip retry`)
      return []
    }

    const statePoints = clinicsByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedClinics(cityKey)
      if (!Array.isArray(stateBackedByFreshLocalCache) || stateBackedByFreshLocalCache.length === 0) {
        logOverpass('info', `clinic state is stale city=${cityKey}, forcing refresh`)
      } else {
        logOverpass('info', `clinic state hit city=${cityKey} count=${statePoints.length}`)
        return statePoints
      }
    }

    if (inFlightClinicsRef.current[cityKey]) {
      logOverpass('info', `clinic in-flight hit city=${cityKey}`)
      return inFlightClinicsRef.current[cityKey]
    }

    const cached = forceRefresh ? null : getCachedClinics(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setClinicsByCity((prev) => ({ ...prev, [cityKey]: cached }))
      logOverpass('info', `clinic cache loaded into state city=${cityKey} count=${cached.length}`)
      return cached
    }

    logOverpass('info', `clinic ${forceRefresh ? 'force refresh' : 'cache miss'} city=${cityKey}`)
    const requestPromise = (async () => {
      const points = await fetchClinicsForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedClinics(cityKey, points)
      setClinicsByCity((prev) => ({ ...prev, [cityKey]: points }))
      logOverpass('info', `clinic state updated from network city=${cityKey} count=${points.length}`)
      if (!points.length) {
        failedClinicCityFetchRef.current[cityKey] = Date.now()
      } else {
        delete failedClinicCityFetchRef.current[cityKey]
      }
      return points
    })()

    inFlightClinicsRef.current[cityKey] = requestPromise
    try {
      return await requestPromise
    } finally {
      delete inFlightClinicsRef.current[cityKey]
    }
  }

  async function ensurePostOfficesForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)

    const failedAt = failedPostOfficeCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) {
      logOverpass('warn', `postOffice cooldown active city=${cityKey}, skip retry`)
      return []
    }

    const statePoints = postOfficesByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedPostOffices(cityKey)
      if (!Array.isArray(stateBackedByFreshLocalCache) || stateBackedByFreshLocalCache.length === 0) {
        logOverpass('info', `postOffice state is stale city=${cityKey}, forcing refresh`)
      } else {
        logOverpass('info', `postOffice state hit city=${cityKey} count=${statePoints.length}`)
        return statePoints
      }
    }

    if (inFlightPostOfficesRef.current[cityKey]) {
      logOverpass('info', `postOffice in-flight hit city=${cityKey}`)
      return inFlightPostOfficesRef.current[cityKey]
    }

    const cached = forceRefresh ? null : getCachedPostOffices(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setPostOfficesByCity((prev) => ({ ...prev, [cityKey]: cached }))
      logOverpass('info', `postOffice cache loaded into state city=${cityKey} count=${cached.length}`)
      return cached
    }

    logOverpass('info', `postOffice ${forceRefresh ? 'force refresh' : 'cache miss'} city=${cityKey}`)
    const requestPromise = (async () => {
      const points = await fetchPostOfficesForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedPostOffices(cityKey, points)
      setPostOfficesByCity((prev) => ({ ...prev, [cityKey]: points }))
      logOverpass('info', `postOffice state updated from network city=${cityKey} count=${points.length}`)
      if (!points.length) {
        failedPostOfficeCityFetchRef.current[cityKey] = Date.now()
      } else {
        delete failedPostOfficeCityFetchRef.current[cityKey]
      }
      return points
    })()

    inFlightPostOfficesRef.current[cityKey] = requestPromise
    try {
      return await requestPromise
    } finally {
      delete inFlightPostOfficesRef.current[cityKey]
    }
  }

  async function ensureRestaurantsForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)
    const failedAt = failedRestaurantCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) return []
    const statePoints = restaurantsByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedRestaurants(cityKey)
      if (Array.isArray(stateBackedByFreshLocalCache) && stateBackedByFreshLocalCache.length > 0) return statePoints
      logOverpass('info', `restaurant state is stale city=${cityKey}, forcing refresh`)
    }
    if (inFlightRestaurantsRef.current[cityKey]) return inFlightRestaurantsRef.current[cityKey]
    const cached = forceRefresh ? null : getCachedRestaurants(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setRestaurantsByCity((prev) => ({ ...prev, [cityKey]: cached }))
      return cached
    }
    const requestPromise = (async () => {
      const points = await fetchRestaurantsForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedRestaurants(cityKey, points)
      setRestaurantsByCity((prev) => ({ ...prev, [cityKey]: points }))
      if (!points.length) failedRestaurantCityFetchRef.current[cityKey] = Date.now()
      else delete failedRestaurantCityFetchRef.current[cityKey]
      return points
    })()
    inFlightRestaurantsRef.current[cityKey] = requestPromise
    try { return await requestPromise } finally { delete inFlightRestaurantsRef.current[cityKey] }
  }

  async function ensurePharmaciesForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)
    const failedAt = failedPharmacyCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) return []
    const statePoints = pharmaciesByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedPharmacies(cityKey)
      if (Array.isArray(stateBackedByFreshLocalCache) && stateBackedByFreshLocalCache.length > 0) return statePoints
      logOverpass('info', `pharmacy state is stale city=${cityKey}, forcing refresh`)
    }
    if (inFlightPharmaciesRef.current[cityKey]) return inFlightPharmaciesRef.current[cityKey]
    const cached = forceRefresh ? null : getCachedPharmacies(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setPharmaciesByCity((prev) => ({ ...prev, [cityKey]: cached }))
      return cached
    }
    const requestPromise = (async () => {
      const points = await fetchPharmaciesForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedPharmacies(cityKey, points)
      setPharmaciesByCity((prev) => ({ ...prev, [cityKey]: points }))
      if (!points.length) failedPharmacyCityFetchRef.current[cityKey] = Date.now()
      else delete failedPharmacyCityFetchRef.current[cityKey]
      return points
    })()
    inFlightPharmaciesRef.current[cityKey] = requestPromise
    try { return await requestPromise } finally { delete inFlightPharmaciesRef.current[cityKey] }
  }

  async function ensureKindergartensForCity(city, cityPolygon, options = {}) {
    const cityKey = normalizeCityName(city)
    if (!cityKey) return []
    const forceRefresh = Boolean(options.forceRefresh)
    const failedAt = failedKindergartenCityFetchRef.current[cityKey]
    if (!forceRefresh && Number.isFinite(failedAt) && (Date.now() - failedAt) < OVERPASS_FAILED_CITY_COOLDOWN_MS) return []
    const statePoints = kindergartensByCityRef.current[cityKey]
    if (!forceRefresh && Array.isArray(statePoints) && statePoints.length > 0) {
      const stateBackedByFreshLocalCache = getCachedKindergartens(cityKey)
      if (Array.isArray(stateBackedByFreshLocalCache) && stateBackedByFreshLocalCache.length > 0) return statePoints
      logOverpass('info', `kindergarten state is stale city=${cityKey}, forcing refresh`)
    }
    if (inFlightKindergartensRef.current[cityKey]) return inFlightKindergartensRef.current[cityKey]
    const cached = forceRefresh ? null : getCachedKindergartens(cityKey)
    if (!forceRefresh && Array.isArray(cached) && cached.length > 0) {
      setKindergartensByCity((prev) => ({ ...prev, [cityKey]: cached }))
      return cached
    }
    const requestPromise = (async () => {
      const points = await fetchKindergartensForCity(cityKey, cityGeometry[cityKey], cityPolygon, { forceRefresh })
      putCachedKindergartens(cityKey, points)
      setKindergartensByCity((prev) => ({ ...prev, [cityKey]: points }))
      if (!points.length) failedKindergartenCityFetchRef.current[cityKey] = Date.now()
      else delete failedKindergartenCityFetchRef.current[cityKey]
      return points
    })()
    inFlightKindergartensRef.current[cityKey] = requestPromise
    try { return await requestPromise } finally { delete inFlightKindergartensRef.current[cityKey] }
  }

  useEffect(() => {
    if (!cityBoundaries.length) return undefined

    let cancelled = false
    let timeoutId = null

    const ensureByType = {
      college: ensureUniversitiesForCity,
      school: ensureSchoolsForCity,
      clinic: ensureClinicsForCity,
      postOffice: ensurePostOfficesForCity,
      restaurant: ensureRestaurantsForCity,
      pharmacy: ensurePharmaciesForCity,
      kindergarten: ensureKindergartensForCity
    }

    const boundaryByCityKey = cityBoundaries.reduce((acc, boundary) => {
      const cityKey = normalizeCityName(boundary.city)
      if (cityKey) acc[cityKey] = boundary
      return acc
    }, {})

    async function refreshStalePoiEntries() {
      if (cancelled || autoRefreshInFlightRef.current) return
      autoRefreshInFlightRef.current = true
      writeAutoRefreshMeta({
        lastStartedAt: Date.now()
      })

      try {
        const response = await fetchJsonWithTimeout('/api/poi/cache/status', {}, OVERPASS_REQUEST_TIMEOUT_MS)
        if (!response.ok) {
          writeAutoRefreshMeta({ lastError: `status-${response.status}` })
          return
        }

        const payload = await response.json()
        const items = Array.isArray(payload?.items) ? payload.items : []
        const staleTargets = []

        for (const item of items) {
          const cityKey = normalizeCityName(item?.cityKey)
          const poiType = String(item?.poiType || '')
          const ensureFn = ensureByType[poiType]
          const boundary = boundaryByCityKey[cityKey]
          if (!cityKey || !poiType || !ensureFn || !boundary) continue
          if (item?.isFresh || item?.isInCooldown) continue
          staleTargets.push({ city: boundary.city, polygon: boundary.polygon, ensureFn, poiType })
        }

        if (!staleTargets.length) {
          writeAutoRefreshMeta({
            lastCompletedAt: Date.now(),
            lastRefreshedCount: 0,
            lastError: null
          })
          return
        }

        logOverpass('info', `auto refresh start staleTargets=${staleTargets.length}`)
        await runPrefetchBatches(
          staleTargets,
          (target) => target.ensureFn(target.city, target.polygon, { forceRefresh: true }),
          () => cancelled,
          2,
          POI_AUTO_REFRESH_BATCH_DELAY_MS
        )
        writeAutoRefreshMeta({
          lastCompletedAt: Date.now(),
          lastRefreshedCount: staleTargets.length,
          lastError: null
        })
        logOverpass('info', `auto refresh completed staleTargets=${staleTargets.length}`)
      } catch (_error) {
        writeAutoRefreshMeta({
          lastCompletedAt: Date.now(),
          lastError: 'fetch-failed'
        })
      } finally {
        autoRefreshInFlightRef.current = false
      }
    }

    const scheduleNextMidnightRefresh = () => {
      if (cancelled) return
      const delayMs = msUntilNextMidnight()
      writeAutoRefreshMeta({ nextScheduledAt: Date.now() + delayMs })
      timeoutId = setTimeout(async () => {
        await refreshStalePoiEntries()
        scheduleNextMidnightRefresh()
      }, delayMs)
    }

    scheduleNextMidnightRefresh()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [cityBoundaries])

  useEffect(() => {
    let cancelled = false

    async function prefetchAllCitiesForPoi() {
      if (!showCollegePoi && !showSchoolPoi && !showClinicPoi && !showPostOfficePoi && !showRestaurantPoi && !showPharmacyPoi && !showKindergartenPoi) {
        prefetchStartedRef.current = { college: false, school: false, clinic: false, postOffice: false, restaurant: false, pharmacy: false, kindergarten: false }
        return
      }
      if (!cityBoundaries.length) return

      if (showCollegePoi && !prefetchStartedRef.current.college) {
        const missingCollegeBoundaries = cityBoundaries.filter((boundary) => {
          const cityKey = normalizeCityName(boundary.city)
          const points = universitiesByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })

        prefetchStartedRef.current.college = true
        if (!missingCollegeBoundaries.length) {
          logOverpass('info', 'college prefetch skipped - all cities already loaded in state/cache')
        } else {
          logOverpass('info', `college prefetch start for cities=${missingCollegeBoundaries.length} concurrency=${OVERPASS_PREFETCH_CONCURRENCY}`)
          await runPrefetchBatches(
            missingCollegeBoundaries,
            (boundary) => ensureUniversitiesForCity(boundary.city, boundary.polygon),
            () => cancelled
          )
          if (!cancelled) logOverpass('info', 'college prefetch completed for POI layer')
        }
      }

      if (showSchoolPoi && !prefetchStartedRef.current.school) {
        const missingSchoolBoundaries = cityBoundaries.filter((boundary) => {
          const cityKey = normalizeCityName(boundary.city)
          const points = schoolsByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })

        prefetchStartedRef.current.school = true
        if (!missingSchoolBoundaries.length) {
          logOverpass('info', 'school prefetch skipped - all cities already loaded in state/cache')
        } else {
          logOverpass('info', `school prefetch start for cities=${missingSchoolBoundaries.length} concurrency=${OVERPASS_PREFETCH_CONCURRENCY}`)
          await runPrefetchBatches(
            missingSchoolBoundaries,
            (boundary) => ensureSchoolsForCity(boundary.city, boundary.polygon),
            () => cancelled
          )
          if (!cancelled) logOverpass('info', 'school prefetch completed for POI layer')
        }
      }

      if (showClinicPoi && !prefetchStartedRef.current.clinic) {
        const missingClinicBoundaries = cityBoundaries.filter((boundary) => {
          const cityKey = normalizeCityName(boundary.city)
          const points = clinicsByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })

        prefetchStartedRef.current.clinic = true
        if (!missingClinicBoundaries.length) {
          logOverpass('info', 'clinic prefetch skipped - all cities already loaded in state/cache')
        } else {
          logOverpass('info', `clinic prefetch start for cities=${missingClinicBoundaries.length} concurrency=${OVERPASS_PREFETCH_CONCURRENCY}`)
          await runPrefetchBatches(
            missingClinicBoundaries,
            (boundary) => ensureClinicsForCity(boundary.city, boundary.polygon),
            () => cancelled
          )
          if (!cancelled) logOverpass('info', 'clinic prefetch completed for POI layer')
        }
      }

      if (showPostOfficePoi && !prefetchStartedRef.current.postOffice) {
        const missingPostOfficeBoundaries = cityBoundaries.filter((boundary) => {
          const cityKey = normalizeCityName(boundary.city)
          const points = postOfficesByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })

        prefetchStartedRef.current.postOffice = true
        if (!missingPostOfficeBoundaries.length) {
          logOverpass('info', 'postOffice prefetch skipped - all cities already loaded in state/cache')
        } else {
          logOverpass('info', `postOffice prefetch start for cities=${missingPostOfficeBoundaries.length} concurrency=${OVERPASS_PREFETCH_CONCURRENCY}`)
          await runPrefetchBatches(
            missingPostOfficeBoundaries,
            (boundary) => ensurePostOfficesForCity(boundary.city, boundary.polygon),
            () => cancelled
          )
          if (!cancelled) logOverpass('info', 'postOffice prefetch completed for POI layer')
        }
      }

      if (showRestaurantPoi && !prefetchStartedRef.current.restaurant) {
        const missing = cityBoundaries.filter((b) => {
          const cityKey = normalizeCityName(b.city)
          const points = restaurantsByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })
        prefetchStartedRef.current.restaurant = true
        await runPrefetchBatches(
          missing,
          (boundary) => ensureRestaurantsForCity(boundary.city, boundary.polygon),
          () => cancelled
        )
      }

      if (showPharmacyPoi && !prefetchStartedRef.current.pharmacy) {
        const missing = cityBoundaries.filter((b) => {
          const cityKey = normalizeCityName(b.city)
          const points = pharmaciesByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })
        prefetchStartedRef.current.pharmacy = true
        await runPrefetchBatches(
          missing,
          (boundary) => ensurePharmaciesForCity(boundary.city, boundary.polygon),
          () => cancelled
        )
      }

      if (showKindergartenPoi && !prefetchStartedRef.current.kindergarten) {
        const missing = cityBoundaries.filter((b) => {
          const cityKey = normalizeCityName(b.city)
          const points = kindergartensByCityRef.current[cityKey]
          return !Array.isArray(points) || points.length === 0
        })
        prefetchStartedRef.current.kindergarten = true
        await runPrefetchBatches(
          missing,
          (boundary) => ensureKindergartensForCity(boundary.city, boundary.polygon),
          () => cancelled
        )
      }
    }

    prefetchAllCitiesForPoi()
    return () => {
      cancelled = true
    }
  }, [showCollegePoi, showSchoolPoi, showClinicPoi, showPostOfficePoi, showRestaurantPoi, showPharmacyPoi, showKindergartenPoi, cityBoundaries])

  return (
    <MapContainer center={center} zoom={6} zoomAnimation={false} markerZoomAnimation={false} className="h-full w-full">
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ViewportTracker onViewportChange={setViewport} />

      {cityBoundaries.map((boundary) => (
        <Polygon
          key={boundary.city}
          positions={boundary.polygon}
          pathOptions={{ color: '#0f766e', fillColor: '#2dd4bf', weight: 1, opacity: 0.6, fillOpacity: 0.06 }}
        />
      ))}

      {selectedPoint && (
        <CircleMarker
          center={[selectedPoint.lat, selectedPoint.lng]}
          radius={15}
          pathOptions={{ color: '#166534', fillColor: '#22c55e', weight: 2, fillOpacity: 0.95 }}
        />
      )}

      {showCollegePoi && universityPoints.map((uni, index) => (
        <CircleMarker
          key={`uni-${index}-${uni.lat}-${uni.lng}`}
          center={[uni.lat, uni.lng]}
          radius={5}
          pathOptions={{ color: '#c2410c', fillColor: '#f97316', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Uniwersytet</div>
              <div>{uni.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showSchoolPoi && schoolPoints.map((school, index) => (
        <CircleMarker
          key={`school-${index}-${school.lat}-${school.lng}`}
          center={[school.lat, school.lng]}
          radius={5}
          pathOptions={{ color: '#a16207', fillColor: '#facc15', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Szkoła</div>
              <div>{school.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showClinicPoi && clinicPoints.map((clinic, index) => (
        <CircleMarker
          key={`clinic-${index}-${clinic.lat}-${clinic.lng}`}
          center={[clinic.lat, clinic.lng]}
          radius={5}
          pathOptions={{ color: '#be185d', fillColor: '#ec4899', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Szpital</div>
              <div>{clinic.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showPostOfficePoi && postOfficePoints.map((po, index) => (
        <CircleMarker
          key={`post-${index}-${po.lat}-${po.lng}`}
          center={[po.lat, po.lng]}
          radius={5}
          pathOptions={{ color: '#0369a1', fillColor: '#22d3ee', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Poczta</div>
              <div>{po.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showRestaurantPoi && restaurantPoints.map((r, index) => (
        <CircleMarker
          key={`restaurant-${index}-${r.lat}-${r.lng}`}
          center={[r.lat, r.lng]}
          radius={5}
          pathOptions={{ color: '#15803d', fillColor: '#22c55e', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Restauracja</div>
              <div>{r.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showPharmacyPoi && pharmacyPoints.map((p, index) => (
        <CircleMarker
          key={`pharmacy-${index}-${p.lat}-${p.lng}`}
          center={[p.lat, p.lng]}
          radius={5}
          pathOptions={{ color: '#1e3a8a', fillColor: '#1d4ed8', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Apteka</div>
              <div>{p.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {showKindergartenPoi && Object.values(kindergartensByCity).flat().map((k, index) => (
        <CircleMarker
          key={`kindergarten-${index}-${k.lat}-${k.lng}`}
          center={[k.lat, k.lng]}
          radius={5}
          pathOptions={{ color: '#6d28d9', fillColor: '#8b5cf6', weight: 1, fillOpacity: 0.9 }}
        >
          <Popup>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontWeight: 600 }}>Przedszkole/Żłobek</div>
              <div>{k.name}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {/* apartment markers */}
      {visibleApartments.map((a) => (
        <CircleMarker
          key={a.id}
          center={[a.latitude, a.longitude]}
          radius={14}
          bubblingMouseEvents={false}
          pathOptions={{ color: '#ef4444', fillColor: '#f87171', weight: 1, fillOpacity: 0.95 }}
          eventHandlers={{ click: (e) => { 
              // prevent the map-level click handler from firing after marker click
              if (e.originalEvent) {
                e.originalEvent.preventDefault()
                e.originalEvent.stopPropagation()
              }
              onApartmentClick && onApartmentClick(a)
            } }}
        >
          <Popup>
            <div style={{minWidth:120}}>
              <div style={{fontWeight:600}}>{a.city} - {a.type}</div>
              <div>Area: {a.squareMeters} m²</div>
              <div>Price: {a.price} PLN</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      <ClickHandler
        onMapClick={onMapClick}
        boundaries={cityBoundaries}
        apartments={apartments}
        cityCenterReferences={cityCenterReferences}
        universitiesByCity={universitiesByCity}
        ensureUniversitiesForCity={ensureUniversitiesForCity}
        schoolsByCity={schoolsByCity}
        ensureSchoolsForCity={ensureSchoolsForCity}
        clinicsByCity={clinicsByCity}
        ensureClinicsForCity={ensureClinicsForCity}
        postOfficesByCity={postOfficesByCity}
        ensurePostOfficesForCity={ensurePostOfficesForCity}
        restaurantsByCity={restaurantsByCity}
        ensureRestaurantsForCity={ensureRestaurantsForCity}
        pharmaciesByCity={pharmaciesByCity}
        ensurePharmaciesForCity={ensurePharmaciesForCity}
        kindergartensByCity={kindergartensByCity}
        ensureKindergartensForCity={ensureKindergartensForCity}
      />
    </MapContainer>
  )
}
