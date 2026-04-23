The Core Challenge
You need to:

Generate a random pottery shape every time
Tile irregular shard polygons onto a 3D curved surface without gaps or overlaps
Map each shard's image texture onto its 3D position
Fill empty space with placeholder shards
Make it feel like one coherent broken-and-repaired object


Tech Stack for This Specific Problem
3D Rendering — Three.js + React Three Fiber
R3F gives you React component model for Three.js, which makes managing shard state much cleaner. Each shard is a component that receives its geometry and texture as props.
Pottery Shape — Custom Lathe Geometry
LatheGeometry takes a 2D profile curve and revolves it 360° to make a pot. You generate the profile randomly each time using a seeded noise function.
javascriptimport { createNoise2D } from 'simplex-noise'

function generatePotteryProfile(seed) {
  const noise = createNoise2D(() => seed)
  const points = []
  const segments = 20
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments  // 0 = bottom, 1 = top
    
    // base silhouette — vase-like curve
    const baseRadius = Math.sin(t * Math.PI) * 0.5 + 0.1
    
    // add random personality
    const noisyRadius = baseRadius + noise(t * 3, seed) * 0.15
    const height = t * 2 - 1  // -1 to 1
    
    points.push(new THREE.Vector2(Math.max(0.05, noisyRadius), height))
  }
  return points
}

const profile = generatePotteryProfile(Math.random())
const geometry = new THREE.LatheGeometry(profile, 64)
Shard UV Mapping — Spherical Projection
When a shard lands on the vase surface, you need to know exactly where on the texture it sits. Use spherical UV projection — convert each shard's 2D polygon points into spherical coordinates (theta, phi) based on their position on the vase surface.
javascriptfunction projectShardOntoVase(shardPoints, vaseSection) {
  // vaseSection = { thetaStart, thetaEnd, phiStart, phiEnd }
  // shardPoints = normalized 0-1 polygon
  
  return shardPoints.map(([x, y]) => ({
    theta: vaseSection.thetaStart + x * (vaseSection.thetaEnd - vaseSection.thetaStart),
    phi: vaseSection.phiStart + y * (vaseSection.phiEnd - vaseSection.phiStart),
    // convert to 3D point on vase surface
    position: getVaseSurfacePoint(theta, phi, profile)
  }))
}
Shard Tiling — Voronoi Decomposition
This is the key insight for making irregular shards tile perfectly on a 3D surface. Use a Voronoi decomposition of the vase UV space — each real shard gets a Voronoi cell, and placeholder shards fill the remaining cells. Voronoi cells are naturally irregular and tile without gaps.
javascriptimport { Delaunay } from 'd3-delaunay'

function tileVaseWithShards(shards, vaseSurfaceArea) {
  // generate seed points in UV space
  const realPoints = shards.map(s => [s.uvX, s.uvY])
  const placeholderCount = Math.max(0, MIN_SHARDS - shards.length)
  const placeholderPoints = Array.from({ length: placeholderCount }, 
    () => [Math.random(), Math.random()])
  
  const allPoints = [...realPoints, ...placeholderPoints]
  const delaunay = Delaunay.from(allPoints)
  const voronoi = delaunay.voronoi([0, 0, 1, 1])
  
  return allPoints.map((point, i) => ({
    polygon: voronoi.cellPolygon(i),
    isReal: i < shards.length,
    shard: i < shards.length ? shards[i] : null
  }))
}
3D Shard Mesh — ShapeGeometry + Surface Projection
Each Voronoi cell becomes a THREE.ShapeGeometry, then you project every vertex onto the vase surface by finding the nearest point on the LatheGeometry.
javascriptfunction buildShardMesh(voronoiCell, vaseProfile, texture) {
  // build flat 2D shape from voronoi cell
  const shape = new THREE.Shape()
  voronoiCell.forEach(([u, v], i) => {
    i === 0 ? shape.moveTo(u, v) : shape.lineTo(u, v)
  })
  
  const geometry = new THREE.ShapeGeometry(shape)
  
  // project each vertex onto vase surface
  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i)
    const v = positions.getY(i)
    const point = uvToVaseSurface(u, v, vaseProfile)
    positions.setXYZ(i, point.x, point.y, point.z)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.8,
    metalness: 0.1,
  })
  
  return new THREE.Mesh(geometry, material)
}
Gold Seams — TubeGeometry along shard edges
For every shared edge between two real shards, draw a TubeGeometry along that edge projected onto the vase surface. The tube sits slightly above the surface (offset along the normal) so it appears to sit in the crack.
javascriptfunction buildGoldSeam(edgePoints, vaseProfile) {
  const curve = new THREE.CatmullRomCurve3(
    edgePoints.map(([u, v]) => {
      const p = uvToVaseSurface(u, v, vaseProfile)
      const normal = getVaseNormal(u, v, vaseProfile)
      return p.add(normal.multiplyScalar(0.002)) // sit above surface
    })
  )
  
  const geometry = new THREE.TubeGeometry(curve, 20, 0.004, 8, false)
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0xd4af37,
    emissiveIntensity: 0.3,
  })
  
  return new THREE.Mesh(geometry, material)
}
Placeholder Shards — procedural ceramic texture
Empty cells get a procedurally generated ceramic-like texture — off-white with subtle surface variation, same roughness material as real shards so they look like undecorated pottery.
javascriptfunction buildPlaceholderTexture(seed) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  
  // warm off-white ceramic base
  ctx.fillStyle = '#e8e0d5'
  ctx.fillRect(0, 0, 256, 256)
  
  // subtle noise texture
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    const alpha = Math.random() * 0.06
    ctx.fillStyle = `rgba(120,100,80,${alpha})`
    ctx.fillRect(x, y, 1, 1)
  }
  
  return new THREE.CanvasTexture(canvas)
}
Controls — React Three Fiber + Drei
javascriptimport { OrbitControls, PresentationControls } from '@react-three/drei'

// OrbitControls for desktop drag-to-rotate
// PresentationControls for mobile touch
// Limit polar angle so you can't flip it upside down
<OrbitControls 
  minPolarAngle={Math.PI * 0.1}
  maxPolarAngle={Math.PI * 0.9}
  enableZoom={true}
  enablePan={false}
/>

The Transition Animation
When the user hits "Combine," shards animate from their 2D mural positions into their 3D vase positions using GSAP.
javascriptasync function transitionToVase(shards) {
  // 1. fade out gold seams on mural
  // 2. shards lift off canvas — z position animates from 0
  // 3. camera pulls back
  // 4. shards fly to their vase UV positions
  // 5. vase rotates in slowly
  // 6. gold seams grow along cracks

  const tl = gsap.timeline()
  
  tl.to(murals2DSeams, { opacity: 0, duration: 0.4 })
  .to(shardMeshes, { 
    z: 50, 
    duration: 0.6, 
    stagger: 0.02,
    ease: 'power2.in' 
  })
  .to(camera.position, { z: 8, duration: 0.8 })
  .call(() => assembleOnVase(shards))
  .to(vaseGroup.rotation, { y: Math.PI * 2, duration: 1.5, ease: 'power2.out' })
  .call(() => growGoldSeams())
}

Randomness — what changes each generation
Every time you hit combine, these are seeded randomly:

Pottery silhouette profile (tall/wide/bulbous/narrow neck)
Voronoi seed point distribution (where shards land on the surface)
Rotation of individual shards on the surface
Slight position perturbation so shards look hand-placed
Lighting angle and color temperature
Number of placeholder vs real shards ratio


Shared Shard Object
Tying this back to the previous discussion — the shard class that works in both views:
javascriptclass Shard {
  id: string
  geometry: ShardGeometry      // shared normalized polygon
  texture: THREE.Texture       // same texture in 2D and 3D
  lodManager: LODManager       // same zoom hierarchy
  
  // 2D mural state
  mural: { x, y, scale, pixiSprite }
  
  // 3D pottery state  
  pottery: { uvX, uvY, voronoiCell, threeMesh }
  
  // transitions between the two
  currentView: '2d' | '3d' | 'transitioning'
}

Full pottery tech summary

simplex-noise — random vase profile
d3-delaunay — Voronoi tiling of vase surface
THREE.LatheGeometry — vase shape
THREE.ShapeGeometry + surface projection — individual shard meshes
THREE.TubeGeometry — gold seams in cracks
THREE.CanvasTexture — placeholder ceramic shards
React Three Fiber + Drei — scene management + controls
GSAP — transition animation

The Approach — Archetype Library + Parametric Profiles
Define a set of pottery archetypes, each with its own profile generation function. When the user hits combine, randomly pick one archetype and generate a profile from it. Every archetype uses the same downstream pipeline — LatheGeometry, Voronoi tiling, gold seams — so the rest of your code doesn't change at all.

Archetype Definitions
javascriptconst ARCHETYPES = [
  {
    name: 'vase',
    generate: (seed) => generateVaseProfile(seed),
    uvOrientation: 'vertical',   // shards run top to bottom
    seamDensity: 'medium',
  },
  {
    name: 'bowl',
    generate: (seed) => generateBowlProfile(seed),
    uvOrientation: 'radial',     // shards radiate from center
    seamDensity: 'low',
  },
  {
    name: 'cup',
    generate: (seed) => generateCupProfile(seed),
    uvOrientation: 'vertical',
    seamDensity: 'medium',
  },
  {
    name: 'plate',
    generate: (seed) => generatePlateProfile(seed),
    uvOrientation: 'radial',
    seamDensity: 'high',
  },
  {
    name: 'teapot_body',
    generate: (seed) => generateTeapotProfile(seed),
    uvOrientation: 'vertical',
    seamDensity: 'medium',
  },
  {
    name: 'jug',
    generate: (seed) => generateJugProfile(seed),
    uvOrientation: 'vertical',
    seamDensity: 'medium',
  },
  {
    name: 'wide_jar',
    generate: (seed) => generateWideJarProfile(seed),
    uvOrientation: 'vertical',
    seamDensity: 'high',
  },
]

Profile Functions
Each one returns an array of THREE.Vector2 points — radius vs height — that LatheGeometry revolves. The key insight is that all pottery shapes are just different 2D curves.
javascriptfunction generateVaseProfile(seed) {
  const r = seededRandom(seed)
  const points = []
  const h = 20  // segments
  for (let i = 0; i <= h; i++) {
    const t = i / h
    // narrow base, wide belly, narrow neck, small lip
    const base    = 0.15 + r() * 0.05
    const belly   = 0.45 + r() * 0.15
    const neck    = 0.12 + r() * 0.08
    const lip     = 0.18 + r() * 0.06
    
    let radius
    if (t < 0.15)       radius = lerp(base * 0.8, base, t/0.15)
    else if (t < 0.55)  radius = lerp(base, belly, (t-0.15)/0.4)
    else if (t < 0.75)  radius = lerp(belly, neck, (t-0.55)/0.2)
    else if (t < 0.9)   radius = lerp(neck, lip, (t-0.75)/0.15)
    else                radius = lip
    
    points.push(new THREE.Vector2(radius, t * 2 - 1))
  }
  return points
}

function generateBowlProfile(seed) {
  const r = seededRandom(seed)
  const points = []
  const h = 20
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const depth  = 0.4 + r() * 0.3   // how deep the bowl is
    const rimW   = 0.6 + r() * 0.2   // how wide the rim
    const footW  = 0.08 + r() * 0.06 // small foot
    
    // bowl is a quarter-circle from foot to rim
    const angle = t * Math.PI * 0.5
    const radius = lerp(footW, rimW, Math.sin(angle))
    const height = lerp(-depth, 0, Math.pow(t, 0.6))
    
    points.push(new THREE.Vector2(Math.max(0.01, radius), height))
  }
  return points
}

function generatePlateProfile(seed) {
  const r = seededRandom(seed)
  const points = []
  const h = 20
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const rimH   = 0.08 + r() * 0.06  // very flat
    const rimW   = 0.7 + r() * 0.2
    const footW  = 0.12 + r() * 0.05
    const wellD  = 0.04 + r() * 0.03  // slight depression in center
    
    let radius, height
    if (t < 0.6) {
      radius = lerp(footW, rimW * 0.85, t/0.6)
      height = lerp(-rimH * 0.5, -wellD, Math.sin(t/0.6 * Math.PI))
    } else {
      radius = lerp(rimW * 0.85, rimW, (t-0.6)/0.4)
      height = lerp(-wellD, rimH, (t-0.6)/0.4)
    }
    
    points.push(new THREE.Vector2(Math.max(0.01, radius), height))
  }
  return points
}

function generateCupProfile(seed) {
  const r = seededRandom(seed)
  const points = []
  const h = 20
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const baseW  = 0.18 + r() * 0.05
    const topW   = 0.22 + r() * 0.08
    const taper  = r() * 0.3  // 0 = straight, 1 = tapered in/out
    const lipFlare = 0.02 + r() * 0.03
    
    let radius
    if (t < 0.9) {
      // slight curve from base to top
      radius = lerp(baseW, topW, t/0.9) + Math.sin(t * Math.PI) * taper * 0.05
    } else {
      radius = topW + lipFlare * ((t - 0.9) / 0.1)
    }
    
    points.push(new THREE.Vector2(Math.max(0.01, radius), t * 1.4 - 0.7))
  }
  return points
}

function generateJugProfile(seed) {
  const r = seededRandom(seed)
  // wide bottom, narrow neck, flared top
  // similar to vase but squatter with wider neck
  const points = []
  const h = 20
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const base   = 0.25 + r() * 0.08
    const belly  = 0.38 + r() * 0.1
    const neck   = 0.18 + r() * 0.06
    const spout  = 0.22 + r() * 0.05
    
    let radius
    if (t < 0.2)       radius = lerp(base * 0.7, base, t/0.2)
    else if (t < 0.5)  radius = lerp(base, belly, (t-0.2)/0.3)
    else if (t < 0.72) radius = lerp(belly, neck, (t-0.5)/0.22)
    else               radius = lerp(neck, spout, (t-0.72)/0.28)
    
    points.push(new THREE.Vector2(radius, t * 2.2 - 1.1))
  }
  return points
}

function generateWideJarProfile(seed) {
  const r = seededRandom(seed)
  const points = []
  const h = 20
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const base   = 0.2 + r() * 0.05
    const belly  = 0.55 + r() * 0.15  // very wide
    const neck   = 0.25 + r() * 0.1   // still fairly wide
    const lip    = 0.28 + r() * 0.08
    
    let radius
    if (t < 0.2)       radius = lerp(base * 0.8, base, t/0.2)
    else if (t < 0.6)  radius = lerp(base, belly, (t-0.2)/0.4)
    else if (t < 0.8)  radius = lerp(belly, neck, (t-0.6)/0.2)
    else               radius = lerp(neck, lip, (t-0.8)/0.2)
    
    points.push(new THREE.Vector2(radius, t * 1.6 - 0.8))
  }
  return points
}

Seeded Random Helper
All profile functions take a seed so the same seed always produces the same pot — important for the pottery view being consistent if you revisit it.
javascriptfunction seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function lerp(a, b, t) {
  return a + (b - a) * Math.clamp(t, 0, 1)
}

The Picker
javascriptfunction generatePottery(shards) {
  const seed = Math.random()
  const archetype = ARCHETYPES[Math.floor(seed * ARCHETYPES.length)]
  const profile = archetype.generate(seed)
  
  return {
    archetype: archetype.name,
    seed,
    profile,
    geometry: new THREE.LatheGeometry(profile, 64),
    uvOrientation: archetype.uvOrientation,
    seamDensity: archetype.seamDensity,
  }
}

Why This Is Seamless
The downstream pipeline never needs to know what shape it is. It just receives:

A LatheGeometry to project onto
A uvOrientation hint for how to lay shards out
A seamDensity hint for how many Voronoi cells to generate

Everything else — Voronoi tiling, shard projection, gold seams, textures, controls — is identical regardless of whether it's a plate or a vase.

What this gives you

7 archetypes × infinite parametric variation = no two pots ever look the same
Every archetype uses the same code downstream
Adding a new shape is just writing one new profile function
Seed-based so you can save and share a specific pot