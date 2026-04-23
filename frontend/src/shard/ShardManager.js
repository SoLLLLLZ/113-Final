import RBush from 'rbush'
import { Container, Graphics, Sprite, Text, ColorMatrixFilter, Assets } from 'pixi.js'
import { gsap } from 'gsap'
import { Shard } from './Shard.js'

const SHARD_W = 240
const SHARD_H = 240

const LOD_THRESHOLDS = [
  [0, 3, 0],
  [3, 8, 1],
  [8, 20, 2],
  [20, 60, 3],
  [60, Infinity, 4],
]

const FOCUS_THRESHOLD = 8

const CATEGORY_COLORS = {
  proud:      0xd4a843,
  regret:     0x9966cc,
  unfinished: 0x3a8aaa,
  advice:     0xa855f7,
  world:      0x6aaa44,
  success:    0xc8922a,
}

function bezierPt(ax, ay, mx, my, bx, by, t) {
  const mt = 1 - t
  return {
    x: mt * mt * ax + 2 * mt * t * mx + t * t * bx,
    y: mt * mt * ay + 2 * mt * t * my + t * t * by,
  }
}

export class ShardManager {
  constructor(viewport) {
    this.viewport = viewport
    this.shards = new Map()
    this.spatial = new RBush()
    this._edges = []
    this._lodDebounce = null

    this.seamLayer = new Container()
    this.shardLayer = new Container()
    viewport.addChild(this.seamLayer)
    viewport.addChild(this.shardLayer)

    viewport.on('zoomed', () => this._scheduleLod())
    viewport.on('moved', () => this._scheduleLod())
  }

  async loadAll(shardsData, edgesData) {
    const urls = shardsData.map(d => d.image_url).filter(Boolean)
    if (urls.length) await Assets.load(urls).catch(() => {})

    for (const d of shardsData) this._addInternal(d, false)
    this._edges = edgesData ?? []
    this._drawAllSeams()
  }

  addShard(data, animated = true) {
    return this._addInternal(data, animated)
  }

  addEdge(edge, animated = true) {
    this._edges.push(edge)
    this._drawSeam(edge, animated)
  }

  getAllShards() {
    return [...this.shards.values()]
  }

  _addInternal(data, animated) {
    if (this.shards.has(data.id)) return this.shards.get(data.id)
    const shard = new Shard(data)
    this.shards.set(shard.id, shard)
    this.spatial.insert({
      minX: shard.mural.x, minY: shard.mural.y,
      maxX: shard.mural.x + SHARD_W, maxY: shard.mural.y + SHARD_H,
      id: shard.id,
    })
    this._renderShard(shard, animated)
    return shard
  }

  _renderShard(shard, animated) {
    const W = SHARD_W, H = SHARD_H
    const pts = shard.geometry.toPixiPoints(0, 0, W, H)

    const outer = new Container()
    outer.x = shard.mural.x
    outer.y = shard.mural.y
    // Deterministic tilt (±4°)
    outer.rotation = ((shard.seed % 1000) / 1000 - 0.5) * 0.14

    // --- Inner container clipped to polygon ---
    const inner = new Container()
    const maskG = new Graphics()
    maskG.poly(pts).fill(0xffffff)
    inner.mask = maskG
    inner.addChild(maskG)

    // 1. Image (or dark placeholder)
    if (shard.imageUrl) {
      const sprite = Sprite.from(shard.imageUrl)
      sprite.width = W
      sprite.height = H
      const cm = new ColorMatrixFilter()
      cm.saturate(-0.12, true)
      sprite.filters = [cm]
      inner.addChild(sprite)
    } else {
      const ph = new Graphics()
      ph.rect(0, 0, W, H).fill({ color: 0x1a1520 })
      inner.addChild(ph)
    }

    // 2. Diagonal reflection highlight (top-left)
    const refl = new Graphics()
    refl.poly([0, 0, W * 0.65, 0, 0, H * 0.65]).fill({ color: 0xffffff, alpha: 0.09 })
    inner.addChild(refl)

    // 3. Gradient dark overlay on lower third (still inside mask for clean look)
    const overlay = new Graphics()
    overlay.rect(0, H * 0.55, W, H * 0.45).fill({ color: 0x000000, alpha: 0.62 })
    inner.addChild(overlay)

    outer.addChild(inner)

    // --- Text is OUTSIDE the mask so it's never clipped ---
    const catColor = CATEGORY_COLORS[shard.category] ?? 0xd4af37
    const catTag = new Text({
      text: shard.category.toUpperCase(),
      style: { fontSize: 9, fill: catColor, fontWeight: 'bold', letterSpacing: 2 },
    })
    catTag.x = 12
    catTag.y = H * 0.58

    const body = new Text({
      text: shard.responseText,
      style: {
        fontSize: 13, fill: 0xffffff, fontWeight: '600',
        wordWrap: true, wordWrapWidth: W - 24, lineHeight: 18,
      },
    })
    body.x = 12
    body.y = H * 0.58 + 16
    // Scale down if text is too tall
    const maxTextH = H * 0.38
    if (body.height > maxTextH) body.scale.set(maxTextH / body.height)

    outer.addChild(catTag, body)

    // --- Bevel + shadow edges (unmasked, draws over polygon boundary) ---
    const bevel = new Graphics()

    // Shadow on bottom-right facing edges
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const x1 = pts[i * 2], y1 = pts[i * 2 + 1]
      const x2 = pts[((i + 1) % n) * 2], y2 = pts[((i + 1) % n) * 2 + 1]
      if ((x2 - x1) * 0.707 + (y2 - y1) * 0.707 > 0) {
        bevel.moveTo(x1, y1).lineTo(x2, y2)
          .stroke({ width: 3, color: 0x000000, alpha: 0.55 })
      }
    }

    // Bright bevel on all edges
    bevel.poly(pts).stroke({ width: 5, color: 0xffffff, alpha: 0.8 })

    // Second highlight pass (thinner, brighter inner edge)
    bevel.poly(pts).stroke({ width: 1.5, color: 0xffffff, alpha: 0.95 })

    outer.addChild(bevel)
    shard.mural.container = outer

    if (animated) {
      outer.alpha = 0
      gsap.to(outer, { alpha: 1, duration: 0.6, ease: 'power2.out' })
    }

    this.shardLayer.addChild(outer)
  }

  _scheduleLod() {
    clearTimeout(this._lodDebounce)
    this._lodDebounce = setTimeout(() => this._updateLod(), 600)
  }

  _updateLod() {
    const scale = this.viewport.scale.x
    if (scale < FOCUS_THRESHOLD) return

    const level = (LOD_THRESHOLDS.find(([min, max]) => scale >= min && scale < max) ?? [0, 0, 0])[2]
    if (level < 2) return

    const center = this.viewport.toWorld(
      this.viewport.screenWidth / 2,
      this.viewport.screenHeight / 2,
    )
    const hits = this.spatial.search({
      minX: center.x - SHARD_W, minY: center.y - SHARD_H,
      maxX: center.x + SHARD_W, maxY: center.y + SHARD_H,
    })
    if (!hits.length) return
    const shard = this.shards.get(hits[0].id)
    if (shard) this._loadLod(shard, level)
  }

  async _loadLod(shard, level) {
    let url = await shard.lod.getLevel(level)
    if (!url) url = await shard.lod.requestLevel(level)
    if (!url || !shard.mural.container) return

    const inner = shard.mural.container.getChildAt(0)
    const oldSprite = inner.children.find(c => c instanceof Sprite)
    if (!oldSprite) return

    const tex = await Assets.load(url)
    const newSprite = new Sprite(tex)
    newSprite.width = SHARD_W
    newSprite.height = SHARD_H
    newSprite.alpha = 0
    inner.addChildAt(newSprite, inner.getChildIndex(oldSprite))
    gsap.to(newSprite, {
      alpha: 1, duration: 0.3,
      onComplete: () => inner.removeChild(oldSprite),
    })
  }

  _drawAllSeams() {
    for (const edge of this._edges) this._drawSeam(edge, false)
  }

  _drawSeam(edge, animated) {
    const a = this.shards.get(edge.shard_a)
    const b = this.shards.get(edge.shard_b)
    if (!a || !b) return

    const ax = a.mural.x + SHARD_W * 0.5
    const ay = a.mural.y + SHARD_H * 0.5
    const bx = b.mural.x + SHARD_W * 0.5
    const by = b.mural.y + SHARD_H * 0.5

    // Deterministic organic bow
    const h = ((ax * 31 + ay * 17 + bx * 7 + by * 3) % 60) - 30
    const mx = (ax + bx) / 2 + h
    const my = (ay + by) / 2 + h

    const weight = edge.weight ?? 0.5
    const extra = weight * 2.5

    const g = new Graphics()

    // Outer glow halo
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by)
      .stroke({ width: 10 + extra, color: 0xffd060, alpha: 0.07 })

    // Mid glow
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by)
      .stroke({ width: 5 + extra, color: 0xffb830, alpha: 0.14 })

    // Core gold line
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by)
      .stroke({ width: 2 + extra * 0.4, color: 0xd4af37, alpha: 0.92 })

    // Fine highlight
    g.moveTo(ax, ay).quadraticCurveTo(mx, my, bx, by)
      .stroke({ width: 0.7, color: 0xfffde0, alpha: 0.5 })

    // Particle dots along the seam
    const steps = Math.floor(3 + weight * 4)
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      const { x, y } = bezierPt(ax, ay, mx, my, bx, by, t)
      const r = 1 + Math.sin(t * Math.PI) * 1.2
      g.circle(x, y, r).fill({ color: 0xffd060, alpha: 0.55 })
    }

    // Glowing node at each shard center
    g.circle(ax, ay, 4).fill({ color: 0xffb820, alpha: 0.15 })
    g.circle(ax, ay, 2.5).fill({ color: 0xffd060, alpha: 0.8 })
    g.circle(bx, by, 4).fill({ color: 0xffb820, alpha: 0.15 })
    g.circle(bx, by, 2.5).fill({ color: 0xffd060, alpha: 0.8 })

    if (animated) {
      g.alpha = 0
      gsap.to(g, { alpha: 1, duration: 0.8, ease: 'power2.out' })
    }

    this.seamLayer.addChild(g)
  }
}
