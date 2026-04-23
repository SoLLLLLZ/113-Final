import { ShardGeometry } from './ShardGeometry.js'
import { get, set } from 'idb-keyval'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

class LODManager {
  constructor(shardId) {
    this.shardId = shardId
    this._cache = new Map()
    this._pending = new Set()
  }

  async getLevel(level) {
    if (this._cache.has(level)) return this._cache.get(level)
    const url = await get(`shard-${this.shardId}-level-${level}`)
    if (url) {
      this._cache.set(level, url)
      return url
    }
    return null
  }

  async requestLevel(level) {
    if (this._pending.has(level)) return null
    this._pending.add(level)
    try {
      const res = await fetch(`${API_URL}/api/shard/${this.shardId}/lod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      })
      if (!res.ok) return null
      const data = await res.json()
      const imageUrl = data.imageUrl
      if (imageUrl) {
        this._cache.set(level, imageUrl)
        await set(`shard-${this.shardId}-level-${level}`, imageUrl)
      }
      return imageUrl ?? null
    } catch {
      return null
    } finally {
      this._pending.delete(level)
    }
  }
}

export class Shard {
  constructor(data) {
    this.id = data.id
    this.responseText = data.response_text
    this.category = data.category
    this.imagePrompt = data.image_prompt
    this.imageUrl = data.image_url
    this.gridX = data.grid_x ?? 0
    this.gridY = data.grid_y ?? 0
    this.seed = data.seed ?? Math.floor(Math.random() * 0xffffffff)
    this.createdAt = data.created_at

    this.geometry = new ShardGeometry(this.seed)
    this.lod = new LODManager(this.id)

    // PixiJS state — populated by ShardManager
    this.mural = {
      x: this.gridX,
      y: this.gridY,
      container: null,
    }

    // Three.js state — populated by PotteryView
    this.pottery = {
      uvX: (this.seed % 1000) / 1000,
      uvY: ((this.seed >>> 10) % 1000) / 1000,
      mesh: null,
    }
  }
}
