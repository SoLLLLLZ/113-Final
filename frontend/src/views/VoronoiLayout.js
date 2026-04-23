import { Delaunay } from 'd3-delaunay'

// ── Circle polygon for clipping ─────────────────────────────────────────────
function makeCirclePoly(radius, segments = 48) {
  const pts = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  return pts
}

// ── Sutherland-Hodgman polygon clipping against a convex polygon ────────────
function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function lineIntersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1]
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1]
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-10) return p1
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom
  return [p1[0] + d1x * t, p1[1] + d1y * t]
}

function clipToConvex(subject, clip) {
  let output = subject.map(p => [...p])
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return []
    const input = output
    output = []
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    for (let j = 0; j < input.length; j++) {
      const c = input[j]
      const d = input[(j + 1) % input.length]
      const cIn = cross2(a, b, c) >= 0
      const dIn = cross2(a, b, d) >= 0
      if (cIn) {
        output.push(c)
        if (!dIn) output.push(lineIntersect(c, d, a, b))
      } else if (dIn) {
        output.push(lineIntersect(c, d, a, b))
      }
    }
  }
  return output
}

// ── Find shared edge vertices between two adjacent Voronoi cells ────────────
function findSharedEdge(polyA, polyB) {
  const EPS = 0.5
  const shared = []
  for (const pa of polyA) {
    for (const pb of polyB) {
      if (Math.abs(pa[0] - pb[0]) < EPS && Math.abs(pa[1] - pb[1]) < EPS) {
        // Avoid duplicates
        if (!shared.some(s => Math.abs(s[0] - pa[0]) < EPS && Math.abs(s[1] - pa[1]) < EPS)) {
          shared.push([pa[0], pa[1]])
        }
      }
    }
  }
  return shared
}

// ── Add fracture-like perturbation to polygon edges ─────────────────────────
function fracturePoly(poly, seed) {
  let s = seed >>> 0
  function rand() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }

  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    out.push(a)
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 8) continue
    const nx = -dy / len, ny = dx / len
    // Add 1-2 micro points per edge
    const breaks = 1 + Math.floor(rand() * 1.5)
    for (let j = 1; j <= breaks; j++) {
      const t = j / (breaks + 1) + (rand() - 0.5) * 0.08
      const disp = (rand() - 0.5) * len * 0.06
      out.push([
        a[0] + dx * t + nx * disp,
        a[1] + dy * t + ny * disp,
      ])
    }
  }
  return out
}

// ── Main Voronoi layout computation ─────────────────────────────────────────
export function computeVoronoiLayout(count, shardW) {
  if (count === 0) return { cells: [], seamEdges: [], radius: 0 }

  const clusterRadius = Math.max(shardW * 1.2, Math.sqrt(count) * shardW * 0.38)

  // Golden-angle spiral for initial seed points
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const coords = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    const r = clusterRadius * Math.sqrt((i + 0.5) / count)
    const theta = i * goldenAngle
    coords[i * 2] = r * Math.cos(theta)
    coords[i * 2 + 1] = r * Math.sin(theta)
  }

  // Lloyd's relaxation — 5 iterations for even, natural-looking cells
  const bounds = [-clusterRadius * 1.5, -clusterRadius * 1.5,
                   clusterRadius * 1.5,  clusterRadius * 1.5]
  for (let iter = 0; iter < 5; iter++) {
    const del = new Delaunay(coords)
    const vor = del.voronoi(bounds)
    for (let i = 0; i < count; i++) {
      const cell = vor.cellPolygon(i)
      if (!cell) continue
      let cx = 0, cy = 0
      const n = cell.length - 1 // last point is duplicate of first
      for (let j = 0; j < n; j++) { cx += cell[j][0]; cy += cell[j][1] }
      cx /= n; cy /= n
      coords[i * 2]     = coords[i * 2]     * 0.25 + cx * 0.75
      coords[i * 2 + 1] = coords[i * 2 + 1] * 0.25 + cy * 0.75
    }
  }

  // Final Voronoi diagram
  const delaunay = new Delaunay(coords)
  const voronoi = delaunay.voronoi(bounds)
  const clipPoly = makeCirclePoly(clusterRadius, 48)

  // Extract clipped cells
  const cells = []
  for (let i = 0; i < count; i++) {
    const raw = voronoi.cellPolygon(i)
    if (!raw) { cells.push(null); continue }
    const poly = raw.slice(0, -1) // remove closing duplicate
    const clipped = clipToConvex(poly, clipPoly)
    if (clipped.length < 3) { cells.push(null); continue }
    cells.push({
      center: [coords[i * 2], coords[i * 2 + 1]],
      polygon: clipped,
    })
  }

  // Extract shared edges between neighboring cells
  const seamEdges = []
  for (let i = 0; i < count; i++) {
    for (const j of delaunay.neighbors(i)) {
      if (j <= i) continue // avoid duplicates
      const rawI = voronoi.cellPolygon(i)
      const rawJ = voronoi.cellPolygon(j)
      if (!rawI || !rawJ) continue
      const shared = findSharedEdge(rawI.slice(0, -1), rawJ.slice(0, -1))
      if (shared.length >= 2) {
        seamEdges.push({ i, j, points: shared })
      }
    }
  }

  return { cells, seamEdges, radius: clusterRadius }
}
