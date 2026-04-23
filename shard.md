The Core Challenge
You need a zoomable canvas where:

Shards exist in both 2D mural and 3D pottery space
Zooming in generates new AI content progressively
Everything is the same underlying data object regardless of view
Performance stays smooth at any zoom level


The Right Mental Model
Think of each shard as a tile pyramid — exactly like Google Maps. Google Maps doesn't load one giant image, it loads tiles at different zoom levels. You need the same thing per shard.
Zoom Level 0 — tiny thumbnail (64x64), just color + shape
Zoom Level 1 — medium image (256x256), FLUX generated
Zoom Level 2 — full image (512x512), FLUX generated, more detail
Zoom Level 3 — deep zoom (1024x1024), FLUX generated, intimate detail
Zoom Level 4 — infinite: new AI content generated on demand
Each level is a new FLUX generation with a progressively more detailed prompt. The shard shape stays the same, the content inside gets richer.

Tech Stack for This Specific Problem
Spatial Index — rbush
Better than d3-quadtree for this use case. It's an R-tree, handles dynamic insertion of moving objects, and has extremely fast nearest-neighbor and bounding-box queries. When you zoom, you query only visible shard IDs.
javascriptimport RBush from 'rbush'
const tree = new RBush()
tree.insert({ minX, minY, maxX, maxY, shardId })
const visible = tree.search({ minX, minY, maxX, maxY })
Viewport + Camera — PixiJS Viewport (pixi-viewport)
A plugin built specifically for PixiJS that handles pan, zoom, pinch, and gives you world coordinates vs screen coordinates. This is what translates "user scrolled in" into "these are the new world bounds."
javascriptimport { Viewport } from 'pixi-viewport'
const viewport = new Viewport({ screenWidth, screenHeight, worldWidth, worldHeight })
viewport.drag().pinch().wheel().decelerate()
viewport.on('zoomed', onZoom)
viewport.on('moved', onMove)
Tile/LOD Management — custom ShardManager class
This is the class you write that sits between the viewport and your data. It:

Tracks current zoom level
Queries rbush for visible shards
Decides which LOD level each shard needs
Requests new image generation when needed
Caches everything so you don't regenerate

javascriptclass ShardManager {
  constructor(viewport, supabase, rbush) {}
  
  onViewportChange() {
    const visible = this.getVisibleShards()
    const lod = this.calculateLOD(viewport.scale.x)
    visible.forEach(shard => this.ensureLOD(shard, lod))
  }
  
  async ensureLOD(shard, level) {
    if (shard.hasLevel(level)) return
    if (shard.isGenerating(level)) return
    await this.generateLevel(shard, level)
  }
}
Image Caching — idb-keyval
IndexedDB wrapper. Store generated tile images client-side so zooming back to a previously seen level doesn't re-request. Persists across sessions.
javascriptimport { get, set } from 'idb-keyval'
const key = `shard-${shardId}-level-${level}`
const cached = await get(key)
if (!cached) {
  const imageBlob = await generateImage(prompt)
  await set(key, imageBlob)
}
Shard Geometry — shared ShardGeometry class
The polygon shape of each shard needs to be the same object whether it's in PixiJS or Three.js. Define it once as a list of normalized points (0–1 coordinates), then each renderer scales it to its own coordinate space.
javascriptclass ShardGeometry {
  constructor(seed) {
    this.points = generateIrregularPolygon(seed) // normalized 0-1
  }
  
  toPixiPolygon(x, y, w, h) {
    return this.points.map(([px, py]) => [x + px*w, y + py*h])
  }
  
  toThreeShape(w, h) {
    const shape = new THREE.Shape()
    this.points.forEach(([px, py], i) => {
      i === 0 ? shape.moveTo(px*w, py*h) : shape.lineTo(px*w, py*h)
    })
    return shape
  }
}
3D Pottery Mapping — UV coordinates
When a shard moves from 2D mural to 3D vase, the shard's texture stays the same. You precompute UV coordinates that map the shard's normalized polygon onto the vase surface. This is what lets you click a shard on the pot and zoom into the same image hierarchy.

The Zoom Pipeline
User scrolls in
    ↓
pixi-viewport fires 'zoomed' event
    ↓
ShardManager.onViewportChange()
    ↓
rbush query → visible shard IDs
    ↓
for each visible shard:
    calculate required LOD level
    check idb cache → hit? load texture
    miss? check Supabase → exists? load from R2 URL
    doesn't exist? → POST to backend
        ↓
    Backend: Claude generates deeper prompt
    Backend: FLUX generates higher-res image
    Backend: saves to R2 + Supabase
    Backend: WebSocket pushes URL back
        ↓
    Frontend: loads new texture into PixiJS sprite
    Frontend: stores in idb for next time

Supabase Schema for LOD
sqlshard_levels (
  id uuid,
  shard_id uuid references shards(id),
  level int,           -- 0,1,2,3,4...
  image_url text,
  prompt text,
  width int,
  height int,
  created_at timestamp,
  unique(shard_id, level)
)

Key Insight for the Pottery View
The shard is the same object in both views. The only thing that changes is the transform applied to it — in 2D it has an x/y/scale, in 3D it has a UV position on the vase surface. The zoom hierarchy, the cached images, the text — all identical. You write one Shard class and two renderers that consume it.

The missing piece is a focus lock. When you zoom past a certain threshold, the viewport should lock onto one shard and all generation only fires for that shard ID. Everything else freezes at whatever LOD they already have.
javascriptclass ShardManager {
  focusedShardId = null
  
  onViewportChange() {
    const zoom = viewport.scale.x
    
    if (zoom > FOCUS_THRESHOLD) {
      if (!this.focusedShardId) {
        // lock onto the shard closest to viewport center
        this.focusedShardId = this.getShardAtCenter()
      }
      // ONLY generate for the focused shard
      this.ensureLOD(this.focusedShardId, this.calculateLOD(zoom))
      return
    }
    
    // below focus threshold — normal mural mode, no generation
    this.focusedShardId = null
    this.renderVisibleShards() // just display existing LOD 0/1
  }
}

The full LOD strategy for credit safety
Zoom 1x–3x   → LOD 0: pre-rendered thumbnail, NO generation
Zoom 3x–8x   → LOD 1: already generated on submission, NO generation  
Zoom 8x–20x  → LOD 2: generate only if focused shard, once, cache forever
Zoom 20x–60x → LOD 3: generate only if focused shard, once, cache forever
Zoom 60x+    → LOD 4+: generate only if focused shard, once, cache forever
LOD 0 and 1 never cost credits — LOD 1 is just the original FLUX image from submission. Generation only triggers at LOD 2 and above, only for one shard, and only once per level thanks to the idb cache.

Performance — the three things that matter
1. Texture pooling
Don't create a new PixiJS sprite for every shard on every frame. Create a fixed pool of sprite objects at startup and reuse them. Shards outside the viewport get their texture swapped out and returned to the pool.
javascriptclass TexturePool {
  pool = []
  
  acquire() {
    return this.pool.pop() || new PIXI.Sprite()
  }
  
  release(sprite) {
    sprite.texture = PIXI.Texture.EMPTY
    this.pool.push(sprite)
  }
}
2. Debounce generation requests
User zoom is continuous — they spin the scroll wheel and fire 50 zoom events per second. You need to debounce generation calls so you only fire when zoom has settled.
javascriptconst debouncedGenerate = debounce((shardId, level) => {
  generateLevel(shardId, level)
}, 600) // wait 600ms after zoom stops
3. Progressive texture swap
When a new LOD image arrives, don't swap the texture instantly — crossfade over 300ms so the zoom feels smooth rather than a sudden pop.
javascriptasync function swapTexture(sprite, newUrl) {
  const newTexture = await PIXI.Assets.load(newUrl)
  const oldAlpha = sprite.alpha
  gsap.to(sprite, { alpha: 0, duration: 0.15, onComplete: () => {
    sprite.texture = newTexture
    gsap.to(sprite, { alpha: oldAlpha, duration: 0.15 })
  }})
}