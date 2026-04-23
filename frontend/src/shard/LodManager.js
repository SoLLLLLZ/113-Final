import { get as idbGet, set as idbSet } from 'idb-keyval'

const API = import.meta.env.VITE_API_URL ?? ''

export class LodManager {
  constructor(shardId, level1Url) {
    this.shardId       = shardId
    this._urls         = new Map([[1, level1Url]])  // LOD 1 = original FLUX image
    this._focusObjects = new Map()
    this._layerTexts   = new Map()
    this._loading      = new Set()
    this._waiters      = new Map()  // level → resolve[]
    this._errors       = new Map()  // level → timestamp of last failure (10s cooldown)
  }

  // Best available URL at or below `level`
  getBestUrl(level) {
    for (let l = level; l >= 1; l--) {
      if (this._urls.has(l)) return this._urls.get(l)
    }
    return null
  }

  hasLevel(level) { return this._urls.has(level) }
  isLoading(level) { return this._loading.has(level) }
  getFocusObject(level) { return this._focusObjects.get(level) ?? null }
  getLayerText(level) { return this._layerTexts.get(level) ?? null }

  // Returns a Promise<{ url, focusObject, layerText }>. Deduplicates concurrent requests.
  async ensure(level) {
    if (level < 1) level = 1
    if (this._urls.has(level)) return {
      url: this._urls.get(level),
      focusObject: this._focusObjects.get(level) ?? null,
      layerText: this._layerTexts.get(level) ?? null,
    }

    // Check idb cache first — avoids a backend round-trip on revisit
    const key      = `shard-${this.shardId}-lod-${level}`
    const focusKey = `shard-${this.shardId}-lod-${level}-focus`
    const textKey  = `shard-${this.shardId}-lod-${level}-text`
    const cached = await idbGet(key).catch(() => null)
    if (cached) {
      const cachedFocus = await idbGet(focusKey).catch(() => null)
      const cachedText  = await idbGet(textKey).catch(() => null)
      this._urls.set(level, cached)
      if (cachedFocus) this._focusObjects.set(level, cachedFocus)
      if (cachedText)  this._layerTexts.set(level, cachedText)
      return { url: cached, focusObject: cachedFocus ?? null, layerText: cachedText ?? null }
    }

    // Deduplicate in-flight requests for the same level
    if (this._loading.has(level)) {
      return new Promise(res => {
        if (!this._waiters.has(level)) this._waiters.set(level, [])
        this._waiters.get(level).push(res)
      })
    }

    // Don't retry a recently failed level — prevents frame-rate spam on error
    const lastErr = this._errors.get(level)
    if (lastErr && Date.now() - lastErr < 10_000) {
      throw new Error(`LOD ${level} cooldown`)
    }

    this._loading.add(level)
    try {
      const r = await fetch(`${API}/api/shard/${this.shardId}/lod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      })
      if (!r.ok) throw new Error(`LOD ${level} failed: ${r.statusText}`)
      const { image_url, focus_object, layer_text } = await r.json()
      await idbSet(key, image_url).catch(() => {})
      if (focus_object) await idbSet(focusKey, focus_object).catch(() => {})
      if (layer_text)   await idbSet(textKey, layer_text).catch(() => {})
      this._urls.set(level, image_url)
      if (focus_object) this._focusObjects.set(level, focus_object)
      if (layer_text)   this._layerTexts.set(level, layer_text)
      this._errors.delete(level)
      const result = { url: image_url, focusObject: focus_object ?? null, layerText: layer_text ?? null }
      for (const cb of (this._waiters.get(level) ?? [])) cb(result)
      this._waiters.delete(level)
      return result
    } catch (err) {
      this._errors.set(level, Date.now())
      throw err
    } finally {
      this._loading.delete(level)
    }
  }
}
