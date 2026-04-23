The gold seam system has three distinct contexts — the 2D mural, the transition animation, and the 3D pottery surface. Each needs different geometry but they should feel like the same material throughout.

The Core Data Structure
A seam is always an edge between two shards. Define it once, render it differently per context.
javascriptclass Seam {
  id: string
  shardA: Shard
  shardB: Shard
  label: string          // "two lives, one ache"
  weight: number         // 0-1, semantic similarity score from Claude
  sharedEdge: Point[]    // the actual polygon edge they share
  
  // computed per context
  mural2D: { path, pixiGraphic }
  pottery3D: { curve, tubeMesh }
  transition: { currentT, gsapTween }
}
The sharedEdge is the key — it's the actual geometric boundary between the two shard polygons. In 2D it's a line segment. In 3D it's a projected curve on the vase surface. Same data, different projections.

2D Mural Seams
In the mural, seams run through the gap between shards. The gap is typically 8–15px of dark background. The gold line runs through the center of that gap.
Finding the shared edge midpoint:
javascriptfunction computeMuralSeam(shardA, shardB) {
  // get the two closest polygon vertices between shards
  const [pA, pB] = findClosestEdgePair(shardA.polygon, shardB.polygon)
  
  // midpoint of each shard's closest edge
  const midA = midpoint(pA[0], pA[1])
  const midB = midpoint(pB[0], pB[1])
  
  // seam runs from midA to midB through the gap
  // add organic bow — perpendicular offset based on shard ID pair
  const bow = computeBow(shardA.id, shardB.id)
  const cp = perpendicularOffset(midA, midB, bow)
  
  return { start: midA, end: midB, controlPoint: cp }
}

function computeBow(idA, idB) {
  // deterministic but varied — same two shards always get same bow
  const hash = (idA.charCodeAt(0) + idB.charCodeAt(0)) % 40
  return (hash - 20) * 0.8  // -16 to +16 pixels
}
Rendering in PixiJS:
javascriptfunction drawMuralSeam(seam, graphics, mouseProximity) {
  const { start, end, controlPoint } = seam.muralPath
  const prox = mouseProximity  // 0-1
  
  // outer glow layer
  graphics.lineStyle({
    width: 6 + prox * 8,
    color: 0xfff0a0,
    alpha: 0.12 + prox * 0.2,
    cap: LINE_CAP.ROUND,
  })
  graphics.moveTo(start.x, start.y)
  graphics.quadraticCurveTo(controlPoint.x, controlPoint.y, end.x, end.y)
  
  // core gold line
  graphics.lineStyle({
    width: 2.5 + prox * 4,
    color: 0xd4af37,
    alpha: 0.5 + prox * 0.45,
    cap: LINE_CAP.ROUND,
  })
  graphics.moveTo(start.x, start.y)
  graphics.quadraticCurveTo(controlPoint.x, controlPoint.y, end.x, end.y)
  
  // bright core highlight
  graphics.lineStyle({
    width: 0.8 + prox * 1.5,
    color: 0xfffde0,
    alpha: 0.3 + prox * 0.5,
    cap: LINE_CAP.ROUND,
  })
  graphics.moveTo(start.x, start.y)
  graphics.quadraticCurveTo(controlPoint.x, controlPoint.y, end.x, end.y)
}
Three layers drawn in order — glow, gold, highlight — gives you the metallic liquid gold look without any shader work.
Seam label on hover:
javascriptfunction onSeamHover(seam, mousePos) {
  const dist = distanceToQuadraticCurve(mousePos, seam.muralPath)
  
  if (dist < 30) {
    showSeamLabel({
      text: seam.label,
      position: seam.muralPath.controlPoint,
      weight: seam.weight,  // heavier seams = larger label
    })
  }
}

Seam Weight — Semantic Similarity
Not all seams should look the same. Shards with stronger thematic connections get thicker, brighter seams. Claude assigns a weight when generating the seam label.
javascript// Claude prompt
const prompt = `
You are connecting two human story fragments with a gold seam.
Fragment A (${shardA.category}): "${shardA.text}"
Fragment B (${shardB.category}): "${shardB.text}"

Return JSON:
{
  "label": "a short poetic phrase showing their connection (max 6 words)",
  "weight": 0.0-1.0  // how deeply connected these two stories are
}
`

// weight affects visual thickness
const baseWidth = 2.5
const weightedWidth = baseWidth + seam.weight * 4

Seam Generation Strategy — Which Shards Connect
You don't want every shard connected to every other shard. That's visually noisy and expensive. Use a proximity + category hybrid:
javascriptfunction generateEdges(shards) {
  const edges = []
  
  shards.forEach((a, i) => {
    // 1. always connect to nearest 2-3 spatial neighbors
    const nearest = getNearestNeighbors(a, shards, 3)
    nearest.forEach(b => edges.push([a, b]))
    
    // 2. occasionally connect same-category shards across distance
    // regrets connect to regrets, proud to proud — thematic clusters
    const sameCategory = shards
      .filter(b => b.category === a.category && b.id !== a.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 1)
    sameCategory.forEach(b => edges.push([a, b]))
    
    // 3. rare long-range cross-category connections
    // these are the most poetically interesting seams
    if (Math.random() < 0.15) {
      const distant = getFarthestShard(a, shards)
      edges.push([a, distant])
    }
  })
  
  // deduplicate
  return uniqueEdges(edges)
}
This gives you the Obsidian graph feel — dense local clusters, occasional long tendrils crossing the canvas.

3D Pottery Seams
On the vase, seams run along the cracks between Voronoi cells projected onto the surface. These are the most visually complex seams.
javascriptfunction build3DSeam(shardA, shardB, vaseProfile) {
  // get the shared Voronoi edge in UV space
  const sharedEdgeUV = getSharedVoronoiEdge(shardA.voronoiCell, shardB.voronoiCell)
  
  // project UV edge points onto vase surface
  const surfacePoints = sharedEdgeUV.map(([u, v]) => {
    const point = uvToVaseSurface(u, v, vaseProfile)
    const normal = getVaseNormal(u, v, vaseProfile)
    // offset slightly above surface so seam sits proud
    return point.clone().add(normal.multiplyScalar(0.003))
  })
  
  // add intermediate points along the curve for smoothness
  const densified = densifyCurve(surfacePoints, 8)
  
  // build tube geometry
  const curve = new THREE.CatmullRomCurve3(densified)
  const tubeRadius = 0.003 + seam.weight * 0.004
  const geometry = new THREE.TubeGeometry(curve, 30, tubeRadius, 8, false)
  
  return new THREE.Mesh(geometry, GOLD_MATERIAL)
}

const GOLD_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  metalness: 0.95,
  roughness: 0.08,
  emissive: 0xd4af37,
  emissiveIntensity: 0.25,
})
Environmental lighting for gold:
Gold only looks like gold with the right lighting. Add a warm point light and a cool ambient to make the metalness pop.
javascript<ambientLight intensity={0.3} color="#c8b8a0" />
<pointLight position={[3, 4, 3]} intensity={1.2} color="#fff5e0" />
<pointLight position={[-3, 1, -2]} intensity={0.4} color="#e0f0ff" />
<spotLight 
  position={[0, 6, 0]} 
  angle={0.4} 
  penumbra={0.5}
  intensity={0.8}
  color="#ffe8c0"
/>

Transition — Seams Morphing from 2D to 3D
This is where it gets interesting. During the transition animation, seams need to morph from flat bezier curves in 2D space into 3D tubes on the vase surface.
javascriptasync function transitionSeams(seams, vaseProfile) {
  const tl = gsap.timeline()
  
  seams.forEach((seam, i) => {
    // compute both states upfront
    const mural2DPoints = seam.muralPath  // flat x,y,z=0 points
    const vase3DPoints = compute3DSeamPoints(seam, vaseProfile)  // projected points
    
    // interpolate between them
    tl.to(seam, {
      progress: 1,
      duration: 1.2,
      delay: i * 0.02,  // stagger so seams grow in sequence
      ease: 'power2.inOut',
      onUpdate: () => {
        const interpolated = interpolateSeamPoints(
          mural2DPoints, 
          vase3DPoints, 
          seam.progress
        )
        updateSeamGeometry(seam, interpolated)
      }
    }, 0.6)  // start after shards have begun assembling
  })
  
  // seam glow pulses as it lands on the vase
  tl.to(GOLD_MATERIAL, {
    emissiveIntensity: 0.8,
    duration: 0.4,
    yoyo: true,
    repeat: 1,
  }, '-=0.3')
}

Seam Grow-On Animation
When a new shard is added to the live mural, its seams should grow outward from the shard center like cracks forming — not just appear instantly.
javascriptfunction animateSeamGrowth(seam) {
  // draw seam progressively from start to end
  let progress = 0
  
  gsap.to({ p: 0 }, {
    p: 1,
    duration: 0.8,
    ease: 'power1.out',
    onUpdate: function() {
      progress = this.targets()[0].p
      drawPartialSeam(seam, progress)
    }
  })
}

function drawPartialSeam(seam, t) {
  // only draw the first t% of the bezier curve
  const partial = getQuadraticBezierPoint(
    seam.start, seam.controlPoint, seam.end, t
  )
  // redraw graphics up to this point
}

Seam Label System
Labels need to appear at different zoom levels:
Far zoom    → no labels visible
Mid zoom    → labels appear on hover only
Close zoom  → labels always visible, fading in
Deep zoom   → labels expand into full seam insight paragraph
javascriptfunction updateSeamLabels(viewport) {
  const zoom = viewport.scale.x
  
  seams.forEach(seam => {
    if (zoom < 2) {
      seam.label.alpha = 0
    } else if (zoom < 5) {
      seam.label.alpha = seam.isHovered ? 1 : 0
    } else if (zoom < 15) {
      seam.label.alpha = Math.min(1, (zoom - 5) / 5)
      seam.label.text = seam.shortLabel  // "two lives, one ache"
    } else {
      seam.label.alpha = 1
      seam.label.text = seam.fullInsight  // Claude-generated paragraph
    }
  })
}

Summary of Seam Tech

2D mural — three-layer PixiJS quadratic bezier (glow + gold + highlight), weight-based thickness, proximity hover
3D pottery — TubeGeometry along projected Voronoi edges, MeshStandardMaterial with high metalness, warm lighting rig
Transition — GSAP point interpolation morphing flat curves into 3D tubes
Growth animation — progressive bezier drawing when new shards arrive
Labels — zoom-aware visibility, short label at mid zoom, full Claude insight at deep zoom
Edge strategy — local neighbors + same-category clusters + rare long-range tendrils