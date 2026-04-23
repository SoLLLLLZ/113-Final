import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { gsap } from 'gsap'
import { Shard } from '../shard/Shard.js'
import { ShardGeometry } from '../shard/ShardGeometry.js'
import { LodManager } from '../shard/LodManager.js'
import { ZoomCanvas } from '../shard/ZoomCanvas.js'

const W = 650
const H = 650
const DEPTH = 18
const BEVEL_T = 13
const BEVEL_S = 11
const GAP = 40

const CATEGORY_COLORS = {
  proud:      '#d4a843',
  regret:     '#9966cc',
  unfinished: '#3a8aaa',
  advice:     '#a855f7',
  world:      '#6aaa44',
  success:    '#c8922a',
}

// ── Noise helpers for organic tendril paths ───────────────────────────────────
function _nhash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function valueNoise(t, seed) {
  const i = Math.floor(t)
  const f = t - i
  const s = seed * 1.7319
  const a = _nhash(i + s), b = _nhash(i + 1 + s)
  return a + (b - a) * (f * f * (3 - 2 * f))
}

function generateNoisyPath(start, end, segments, amplitude, seed) {
  const dir = end.clone().sub(start)
  const len = dir.length()
  const perp = new THREE.Vector3(-dir.y / len, dir.x / len, 0)

  const pts = [start.clone()]
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const base = start.clone().lerp(end, t)
    const n1 = (valueNoise(t * 5 + 1.3, seed) - 0.5) * 2
    const n2 = (valueNoise(t * 5 + 8.7, seed + 99) - 0.5) * 2
    base.addScaledVector(perp, n1 * amplitude)
    base.z = start.z + (end.z - start.z) * t + n2 * 28
    pts.push(base)
  }
  pts.push(end.clone())
  return new THREE.CatmullRomCurve3(pts)
}

// Procedural cracked-glass surface texture — gives the 3D faceted surface look
function makeCrackNormalTex(S = 512) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')

  // Base: flat normal encoded as RGB (128,128,255)
  ctx.fillStyle = `rgb(128,128,255)`
  ctx.fillRect(0, 0, S, S)

  // A few large, sparse facets — subtle tilt per region, not wall-to-wall bumps
  for (let i = 0; i < 12; i++) {
    const cx = Math.random() * S, cy = Math.random() * S
    const n = 4 + Math.floor(Math.random() * 4)
    const r = 80 + Math.random() * 160  // large regions so they're not noisy

    ctx.beginPath()
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.7
      const rj = r * (0.6 + Math.random() * 0.4)
      j === 0
        ? ctx.moveTo(cx + Math.cos(a) * rj, cy + Math.sin(a) * rj)
        : ctx.lineTo(cx + Math.cos(a) * rj, cy + Math.sin(a) * rj)
    }
    ctx.closePath()
    // Very subtle XY tilt — close to flat (128,128) so image stays readable
    const nx = Math.floor(128 + (Math.random() - 0.5) * 22)
    const ny = Math.floor(128 + (Math.random() - 0.5) * 22)
    ctx.fillStyle = `rgba(${nx},${ny},255,0.35)`
    ctx.fill()
  }

  // Just a handful of crack lines along natural fracture directions
  for (let i = 0; i < 6; i++) {
    let x = Math.random() * S, y = Math.random() * S
    const angle = Math.random() * Math.PI * 2
    const len = 120 + Math.random() * 200
    const segs = 4
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < segs; s++) {
      x += Math.cos(angle + (Math.random() - 0.5) * 0.5) * (len / segs)
      y += Math.sin(angle + (Math.random() - 0.5) * 0.5) * (len / segs)
      ctx.lineTo(x, y)
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.3})`
    ctx.lineWidth = 1 + Math.random() * 1.2
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

// Displace front-face vertices of the glass extrusion — creates actual 3D facets,
// not just a shading trick. Each polygon corner moves forward/back independently,
// so the triangulated surface becomes a set of angled planes catching light differently.
function displaceGlassFace(geo, seed) {
  const pos = geo.attributes.position
  let s = seed >>> 0
  const lcg = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000 }

  let maxZ = -Infinity
  for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i))

  // Front-face vertices sit at maxZ. Displace each one independently:
  // some pushed forward (protruding facets), a few pulled back (concave pockets).
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) >= maxZ - 0.1) {
      const r = lcg()
      if (r < 0.50) {
        pos.setZ(i, pos.getZ(i) + 18 + lcg() * 26)  // protrude 18–44 units
      } else if (r < 0.72) {
        pos.setZ(i, pos.getZ(i) - 8 - lcg() * 14)   // recede slightly
      }
      // ~28 % stay at base — creates flat reference planes between bumps
    }
  }

  pos.needsUpdate = true
  geo.computeVertexNormals()  // recomputes normals → angular facet shading
}

// Remap ExtrudeGeometry UVs so the shape fills [0,1] relative to W×H canvas
function normalizeUVs(geo, w, h) {
  const uv = geo.attributes.uv
  if (!uv) return
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h)
  }
  uv.needsUpdate = true
}

// Remap ShapeGeometry UVs so the FULL image fills the polygon's actual bounding box
function fitImageUVs(geo) {
  const uv = geo.attributes.uv
  if (!uv) return
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (let i = 0; i < uv.count; i++) {
    uMin = Math.min(uMin, uv.getX(i)); uMax = Math.max(uMax, uv.getX(i))
    vMin = Math.min(vMin, uv.getY(i)); vMax = Math.max(vMax, uv.getY(i))
  }
  const uR = uMax - uMin || 1, vR = vMax - vMin || 1
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - uMin) / uR, (uv.getY(i) - vMin) / vR)
  }
  uv.needsUpdate = true
}

function makeTextTexture(shard, iconImg) {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')

  const color = CATEGORY_COLORS[shard.category] || '#d4af37'

  const iconSize = 46
  const gap = 10
  const textColW = 150
  const blockW = iconSize + gap + textColW
  const blockX = (size - blockW) / 2
  const iconX = blockX
  const textX = blockX + iconSize + gap
  const iconY = size * 0.63

  ctx.shadowColor = 'rgba(0,0,0,0.95)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1

  if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize)
    ctx.restore()
    ctx.shadowColor = 'transparent'
    ctx.beginPath()
    ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2 + 1.5, 0, Math.PI * 2)
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.85; ctx.stroke()
    ctx.globalAlpha = 1
  } else {
    const cx = iconX + iconSize / 2, cy = iconY + iconSize / 2, r = iconSize * 0.42
    ctx.beginPath()
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.6, cy)
    ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.6, cy)
    ctx.closePath()
    ctx.fillStyle = color; ctx.globalAlpha = 0.5; ctx.fill()
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke()
  }

  ctx.shadowColor = 'rgba(0,0,0,0.95)'
  ctx.shadowBlur = 10
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.fillStyle = '#ffffff'
  const words = shard.responseText.split(' ')
  let line = '', y = iconY + 20
  for (const word of words) {
    const test = line + word + ' '
    if (ctx.measureText(test).width > textColW && line) {
      ctx.fillText(line.trimEnd(), textX, y)
      line = word + ' '
      y += 22
      if (y > size - 30) break
    } else {
      line = test
    }
  }
  if (y <= size - 30) ctx.fillText(line.trimEnd(), textX, y)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const _crackTex = makeCrackNormalTex()

// Shared glass material.
// - No base normalMap so transmission is undistorted (image stays readable)
// - clearcoatNormalMap adds micro surface variation only to the shiny outer skin
// - Actual 3D facets come from vertex displacement (displaceGlassFace), not shading tricks
const GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1.0,
  thickness: DEPTH * 2,
  roughness: 0.04,
  metalness: 0,
  ior: 1.5,
  clearcoat: 0,
  envMapIntensity: 0,
  attenuationDistance: 200,
  attenuationColor: new THREE.Color(0xaac8e0),
})

function buildFallbackGroup(shard, imageTex, iconImg, pos) {
  const hw = W * 0.35, hh = H * 0.35
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh)
  shape.lineTo(hw, hh); shape.lineTo(-hw, hh); shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, GLASS_MAT))
  const textGeo = new THREE.PlaneGeometry(W * 0.7, H * 0.7)
  group.add(new THREE.Mesh(textGeo, new THREE.MeshBasicMaterial({
    map: makeTextTexture(shard, iconImg), transparent: true, depthWrite: false,
  })))
  group.position.set(pos.x, -pos.y, 0)
  return group
}

function buildShardGroup(shard, imageTex, iconImg, pos) {
  const pts = shard.geometry.toThreePoints(W, H)

  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0] - W / 2, -(pts[0][1] - H / 2))
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0] - W / 2, -(pts[i][1] - H / 2))
  }
  shape.closePath()

  // Image plane — sits just behind the glass so transmission shows it distorted
  const imgGeo = new THREE.ShapeGeometry(shape)
  fitImageUVs(imgGeo)
  const imgMesh = new THREE.Mesh(
    imgGeo,
    new THREE.MeshBasicMaterial({
      map: imageTex ?? null,
      color: imageTex ? 0xffffff : 0x1a1520,
      side: THREE.DoubleSide,
    }),
  )
  imgMesh.userData.lodUrl = null
  imgMesh.position.z = -(BEVEL_T + 1)

  // Glass extrusion
  const glassGeo = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL_T,
    bevelSize: BEVEL_S,
    bevelSegments: 3,  // more segments = more edge facets catching light
  })
  normalizeUVs(glassGeo, W, H)
  displaceGlassFace(glassGeo, shard.seed)
  const glassMesh = new THREE.Mesh(glassGeo, GLASS_MAT)

  // Text overlay — full rectangle floating above glass, transparent bg
  const textGeo = new THREE.PlaneGeometry(W, H)
  const textMesh = new THREE.Mesh(
    textGeo,
    new THREE.MeshBasicMaterial({
      map: makeTextTexture(shard, iconImg),
      transparent: true,
      depthWrite: false,
      depthTest: false,   // always renders above glass regardless of protrusion depth
    }),
  )
  // Displaced vertices can protrude up to ~90 units — sit well above that
  textMesh.position.z = BEVEL_T * 2 + DEPTH + 60
  textMesh.renderOrder = 2

  const group = new THREE.Group()
  group.add(imgMesh, glassMesh, textMesh)
  group.userData.imgMesh = imgMesh  // LOD system swaps textures here
  group.position.set(pos.x, -pos.y, 0)

  const r = shard.seed
  group.rotation.set(
    ((r % 500) / 500 - 0.5) * 0.22,
    (((r >>> 5) % 500) / 500 - 0.5) * 0.22,
    ((r % 1000) / 1000 - 0.5) * 0.14,
  )

  return group
}

export class MuralScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.3

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x03030d)

    // Post-processing: bloom makes gold tendrils glow
    this._composer = new EffectComposer(this.renderer)
    this._composer.addPass(new RenderPass(this.scene, null))
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.12,  // strength — barely-there glow
      0.18,  // radius — tight, not a giant halo
      0.55,  // threshold
    )
    this._bloom = bloom
    this._composer.addPass(bloom)

    // Environment map — required for glass reflections and clearcoat
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 10000)
    this._panX = 0
    this._panY = 0
    this._camZ = 2200
    this._applyCamera()
    this._composer.passes[0].camera = this.camera

    this._addLights()

    this.shardGroup = new THREE.Group()
    this.seamGroup = new THREE.Group()
    this.scene.add(this.seamGroup)
    this.scene.add(this.shardGroup)

    this.shards = new Map()
    this._loader = new THREE.TextureLoader()
    this._icons = new Map()
    this._iconsReady = this._preloadIcons()
    this._seamMeshes = []
    this._lodManagers  = new Map()
    this._focusedId    = null
    this._activeLod    = 1
    this._zoomCanvas   = new ZoomCanvas()

    this._hoverLight = new THREE.PointLight(0xffcc44, 0, 1200)
    this._hoverLight.position.z = 60
    this.scene.add(this._hoverLight)

    this._seamAmbient = new THREE.PointLight(0xffaa22, 0.12, 1200)
    this._seamAmbient.position.z = 80
    this.scene.add(this._seamAmbient)

    this._loadingHUD = this._createLoadingHUD()
    this._zoomLabel  = this._createZoomLabel()

    this._tooltip = this._createTooltip()
    this._setupControls(canvas)
    this._setupSeamHover(canvas)
    this._setupClickZoom(canvas)
    this._rafId = requestAnimationFrame(this._tick.bind(this))
  }

  _createLoadingHUD() {
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'bottom:32px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:500', 'pointer-events:none', 'display:none',
      'background:rgba(8,6,3,0.85)', 'border:1px solid rgba(212,175,55,0.5)',
      'border-radius:20px', 'padding:8px 20px',
      'font-family:system-ui,sans-serif', 'font-size:12px',
      'color:rgba(212,175,55,0.9)', 'letter-spacing:2px',
      'animation:pulse 1.5s ease-in-out infinite',
    ].join(';')
    el.textContent = '✦ GENERATING NEXT WORLD'

    const style = document.createElement('style')
    style.textContent = '@keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }'
    document.head.appendChild(style)
    document.body.appendChild(el)
    return el
  }

  _showLoadingHUD() { this._loadingHUD.style.display = 'block' }
  _hideLoadingHUD() { this._loadingHUD.style.display = 'none' }

  _createZoomLabel() {
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'bottom:72px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:500', 'pointer-events:none', 'display:none',
      'background:rgba(8,6,3,0.80)', 'border:1px solid rgba(212,175,55,0.35)',
      'border-radius:20px', 'padding:6px 18px',
      'font-family:system-ui,sans-serif', 'font-size:11px',
      'color:rgba(212,175,55,0.75)', 'letter-spacing:1.5px',
    ].join(';')
    document.body.appendChild(el)
    return el
  }

  _showZoomLabel(text) {
    this._zoomLabel.textContent = `↳ ${text}`
    this._zoomLabel.style.display = 'block'
    clearTimeout(this._zoomLabelTimer)
    this._zoomLabelTimer = setTimeout(() => { this._zoomLabel.style.display = 'none' }, 3000)
  }

  _hideZoomLabel() {
    clearTimeout(this._zoomLabelTimer)
    this._zoomLabel.style.display = 'none'
  }

  _createTooltip() {
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'pointer-events:none', 'display:none', 'z-index:200',
      'background:rgba(8,6,3,0.90)', 'border:1px solid rgba(212,175,55,0.55)',
      'border-radius:10px', 'padding:12px 16px', 'max-width:240px',
      'box-shadow:0 0 24px rgba(212,175,55,0.25)', 'backdrop-filter:blur(6px)',
      'font-family:system-ui,sans-serif', 'color:#fff',
    ].join(';')
    document.body.appendChild(el)
    return el
  }

  _buildSeams(_edgesData) {
    for (const s of this._seamMeshes) for (const l of s.pathLights) this.scene.remove(l)
    while (this.seamGroup.children.length) this.seamGroup.remove(this.seamGroup.children[0])
    this._seamMeshes = []
  }

  _buildSeams_disabled(edgesData) {
    for (const s of this._seamMeshes) {
      for (const l of s.pathLights) this.scene.remove(l)
    }
    while (this.seamGroup.children.length) this.seamGroup.remove(this.seamGroup.children[0])
    this._seamMeshes = []

    const GOLD = new THREE.Color(0xd4af37)
    const GLOW = new THREE.Color(0xffcc44)

    for (const edge of edgesData) {
      const posA = this._layoutMap?.get(edge.shard_a)
      const posB = this._layoutMap?.get(edge.shard_b)
      if (!posA || !posB) continue

      const z = -3  // behind glass front face — visible through transmission
      const start = new THREE.Vector3(posA.x, -posA.y, z)
      const end   = new THREE.Vector3(posB.x, -posB.y, z)

      const seed = Math.abs((posA.x * 31 + posA.y * 17 + posB.x * 7 + posB.y * 3) | 0) % 9999
      const dist = start.distanceTo(end)
      const amplitude = Math.min(dist * 0.18, 140)

      const curve = generateNoisyPath(start, end, 8, amplitude, seed)

      const coreMat = new THREE.MeshStandardMaterial({
        color: GOLD, metalness: 0.95, roughness: 0.08,
        emissive: GLOW, emissiveIntensity: 0.18,
      })
      const coreGeo = new THREE.TubeGeometry(curve, 16, 0.9, 6, false)
      const core = new THREE.Mesh(coreGeo, coreMat)

      // Wide halo — nearly invisible at rest, swells opaque on hover
      const glowMat = new THREE.MeshStandardMaterial({
        color: GLOW, transparent: true, opacity: 0.04,
        emissive: GLOW, emissiveIntensity: 0.3,
        side: THREE.BackSide, depthWrite: false,
      })
      const glowGeo = new THREE.TubeGeometry(curve, 16, 7, 6, false)
      const glow = new THREE.Mesh(glowGeo, glowMat)

      // Invisible wide hit tube for raycasting
      const hitGeo = new THREE.TubeGeometry(curve, 16, 9, 5, false)
      const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }))

      const nodeMat = new THREE.MeshStandardMaterial({
        color: 0xffe066, emissive: new THREE.Color(0xffdd44), emissiveIntensity: 0.5,
        metalness: 0.92, roughness: 0.06,
      })
      const nodeA = new THREE.Mesh(new THREE.SphereGeometry(2.8, 6, 6), nodeMat)
      const nodeB = new THREE.Mesh(new THREE.SphereGeometry(2.8, 6, 6), nodeMat.clone())
      nodeA.position.copy(start.clone().setZ(z + 2))
      nodeB.position.copy(end.clone().setZ(z + 2))

      const pathLights = []
      const lpos = curve.getPoint(0.5)
      const pl = new THREE.PointLight(0xffcc44, 0.45, 350, 2)
      pl.position.set(lpos.x, lpos.y, lpos.z + 40)
      this.scene.add(pl)
      pathLights.push(pl)

      const midpt = curve.getPoint(0.5).clone().setZ(z + 18)

      const group = new THREE.Group()
      group.add(glow, core, hit, nodeA, nodeB)
      this.seamGroup.add(group)

      this._seamMeshes.push({ core, glow, hit, edge, midpt, pathLights, group })
    }
  }

  _setupSeamHover(canvas) {
    const raycaster = new THREE.Raycaster()
    raycaster.params.Mesh = { threshold: 4 }
    let hoveredIdx = -1

    const onMove = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(mouse, this.camera)
      const meshes = this._seamMeshes.map(s => s.hit)
      const hits = raycaster.intersectObjects(meshes)

      if (hits.length) {
        const idx = meshes.indexOf(hits[0].object)
        if (idx !== hoveredIdx) {
          if (hoveredIdx >= 0) this._dimSeam(hoveredIdx)
          hoveredIdx = idx
          this._brightenSeam(idx)
        }
        const s = this._seamMeshes[idx]
        this._hoverLight.position.set(s.midpt.x, s.midpt.y, s.midpt.z + 40)
        this._hoverLight.intensity = 6
        this._showTooltip(clientX, clientY, s.edge)
      } else {
        if (hoveredIdx >= 0) { this._dimSeam(hoveredIdx); hoveredIdx = -1 }
        this._hoverLight.intensity = 0
        this._hideTooltip()
      }
    }

    canvas.addEventListener('mousemove', e => onMove(e.clientX, e.clientY))
    canvas.addEventListener('mouseleave', () => {
      if (hoveredIdx >= 0) { this._dimSeam(hoveredIdx); hoveredIdx = -1 }
      this._hoverLight.intensity = 0
      this._hideTooltip()
    })
  }

  _brightenSeam(idx) {
    const { core, glow, pathLights } = this._seamMeshes[idx]
    gsap.to(core.material, { emissiveIntensity: 1.0, duration: 0.22, ease: 'power2.out' })
    gsap.to(core.material.color, { r: 1, g: 0.9, b: 0.45, duration: 0.22 })
    gsap.to(glow.material, { opacity: 0.42, emissiveIntensity: 1.8, duration: 0.22, ease: 'power2.out' })
    for (const pl of pathLights) gsap.to(pl, { intensity: 2.5, duration: 0.22 })
    if (this._bloom) gsap.to(this._bloom, { strength: 0.28, duration: 0.2 })
  }

  _dimSeam(idx) {
    const { core, glow, pathLights } = this._seamMeshes[idx]
    gsap.to(core.material, { emissiveIntensity: 0.18, duration: 0.35, ease: 'power2.in' })
    gsap.to(core.material.color, { r: 0.831, g: 0.686, b: 0.216, duration: 0.35 })
    gsap.to(glow.material, { opacity: 0.04, emissiveIntensity: 0.3, duration: 0.35, ease: 'power2.in' })
    for (const pl of pathLights) gsap.to(pl, { intensity: 0.45, duration: 0.35 })
    if (this._bloom) gsap.to(this._bloom, { strength: 0.12, duration: 0.25 })
  }

  _showTooltip(x, y, edge) {
    const label = edge.seam_label ?? 'Connection'
    this._tooltip.innerHTML = `
      <div style="color:#d4af37;font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:6px">
        ✦ CONNECTION
      </div>
      <div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.92)">${label}</div>
    `
    this._tooltip.style.display = 'block'
    this._tooltip.style.left = `${x + 18}px`
    this._tooltip.style.top = `${y - 10}px`
  }

  _hideTooltip() {
    this._tooltip.style.display = 'none'
  }

  _preloadIcons() {
    const base = import.meta.env.BASE_URL || '/'
    const cats = ['proud', 'regret', 'unfinished', 'advice', 'world', 'success']
    return Promise.allSettled(cats.map(cat => new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        this._icons.set(cat, img)
        if (cat === 'unfinished') this._icons.set('half-finished', img)
        resolve()
      }
      img.onerror = resolve
      img.src = `${base}icons/${cat}.png`
    })))
  }

  _addLights() {
    this.scene.add(new THREE.AmbientLight(0x607090, 0.6))

    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(400, 500, 700)
    this.scene.add(key)

    const key2 = new THREE.DirectionalLight(0xddeeff, 1.0)
    key2.position.set(-300, 250, 400)
    this.scene.add(key2)

    const rim = new THREE.DirectionalLight(0xffffff, 1.4)
    rim.position.set(0, -100, -600)
    this.scene.add(rim)

    const fill = new THREE.DirectionalLight(0xffd4a0, 0.5)
    fill.position.set(0, -500, 200)
    this.scene.add(fill)
  }

  _applyCamera() {
    this.camera.position.set(this._panX, this._panY, this._camZ)
    this.camera.lookAt(this._panX, this._panY, 0)
  }

  _setupControls(el) {
    let dragging = false, sx = 0, sy = 0

    el.addEventListener('mousedown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY })
    el.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const s = this._camZ / 700
      this._panX -= (e.clientX - sx) * s
      this._panY += (e.clientY - sy) * s
      sx = e.clientX; sy = e.clientY
      this._applyCamera()
    })
    el.addEventListener('mouseup', () => { dragging = false })
    el.addEventListener('mouseleave', () => { dragging = false })

    el.addEventListener('wheel', (e) => {
      if (this._zoomCanvas.active) return
      e.preventDefault()
      this._camZ *= e.deltaY > 0 ? 1.12 : 0.89
      this._camZ = Math.max(10, Math.min(6000, this._camZ))
      this._applyCamera()
    }, { passive: false })

    let lastDist = 0, t0x = 0, t0y = 0
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) { dragging = true; t0x = e.touches[0].clientX; t0y = e.touches[0].clientY }
      if (e.touches.length === 2) lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    }, { passive: true })
    el.addEventListener('touchmove', (e) => {
      e.preventDefault()
      if (e.touches.length === 1 && dragging) {
        const s = this._camZ / 700
        this._panX -= (e.touches[0].clientX - t0x) * s
        this._panY += (e.touches[0].clientY - t0y) * s
        t0x = e.touches[0].clientX; t0y = e.touches[0].clientY
        this._applyCamera()
      }
      if (e.touches.length === 2 && lastDist) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        this._camZ *= lastDist / d
        this._camZ = Math.max(10, Math.min(6000, this._camZ))
        lastDist = d
        this._applyCamera()
      }
    }, { passive: false })
    el.addEventListener('touchend', () => { dragging = false; lastDist = 0 })
  }

  // Hard-constraint collision resolver — guaranteed no overlap, tight packing
  _computeLayout(shardsData) {
    const GRAVITY = 0.02
    const ITERS = 400

    const items = shardsData.map(d => {
      const geo = new ShardGeometry(d.seed ?? 0)
      const r = Math.max(...geo.points.map(([px, py]) => Math.hypot(px - 0.5, py - 0.5))) * W + BEVEL_S
      return { x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100, r }
    })

    for (let iter = 0; iter < ITERS; iter++) {
      for (const it of items) {
        it.x += (0 - it.x) * GRAVITY
        it.y += (0 - it.y) * GRAVITY
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = a.r + b.r + GAP
          if (dist < minDist && dist > 0.001) {
            const overlap = minDist - dist
            const nx = dx / dist, ny = dy / dist
            const push = overlap * 0.5
            a.x -= nx * push; a.y -= ny * push
            b.x += nx * push; b.y += ny * push
          }
        }
      }
    }

    return items.map(({ x, y, r }) => ({ x, y, r }))
  }

  async loadAll(shardsData, edgesData) {
    await this._iconsReady
    const texMap = new Map()
    await Promise.allSettled(
      shardsData.filter(d => d.image_url).map(d =>
        this._loader.loadAsync(d.image_url).then(tex => {
          tex.colorSpace = THREE.SRGBColorSpace
          texMap.set(d.id, tex)
        }),
      ),
    )

    const layout = this._computeLayout(shardsData)
    this._layoutMap = new Map(shardsData.map((d, i) => [d.id, layout[i]]))

    for (let i = 0; i < shardsData.length; i++) {
      this._addInternal(shardsData[i], false, texMap.get(shardsData[i].id), layout[i])
    }

    if (layout.length > 0) {
      this._panX = layout.reduce((s, p) => s + p.x, 0) / layout.length
      this._panY = layout.reduce((s, p) => s + p.y, 0) / layout.length
      this._applyCamera()
    }

    this._buildSeams(edgesData ?? [])

    if (layout.length > 0) {
      this._seamAmbient.position.set(this._panX, this._panY, 80)
    }
  }

  addShard(data, animated = true) {
    const load = data.image_url
      ? this._loader.loadAsync(data.image_url).then(tex => { tex.colorSpace = THREE.SRGBColorSpace; return tex }).catch(() => null)
      : Promise.resolve(null)
    load.then(tex => {
      const geo = new ShardGeometry(data.seed ?? 0)
      const r = Math.max(...geo.points.map(([px, py]) => Math.hypot(px - 0.5, py - 0.5))) * W + BEVEL_S
      const existing = [...(this._layoutMap?.values() ?? [])]
      let pos = { x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100, r }
      for (let i = 0; i < 150; i++) {
        pos.x += (0 - pos.x) * 0.02
        pos.y += (0 - pos.y) * 0.02
        for (const e of existing) {
          const dx = pos.x - e.x, dy = pos.y - e.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = r + e.r + GAP
          if (dist < minDist && dist > 0.001) {
            const overlap = (minDist - dist)
            pos.x += (dx / dist) * overlap
            pos.y += (dy / dist) * overlap
          }
        }
      }
      this._layoutMap?.set(data.id, pos)
      this._addInternal(data, animated, tex, pos)
    })
  }

  _addInternal(data, animated, imageTex, pos) {
    if (this.shards.has(data.id)) return
    const shard = new Shard(data)
    this.shards.set(shard.id, shard)
    const iconImg = this._icons.get(shard.category) ?? null
    const layoutPos = pos ?? { x: shard.mural.x, y: shard.mural.y }
    let group
    try {
      group = buildShardGroup(shard, imageTex, iconImg, layoutPos)
    } catch (e) {
      console.warn('Shard geometry failed, using fallback:', e.message)
      group = buildFallbackGroup(shard, imageTex, iconImg, layoutPos)
    }
    group.userData.shardId = shard.id

    if (animated) {
      group.scale.set(0.01, 0.01, 0.01)
      gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.55, ease: 'back.out(1.7)' })
    }
    shard.mural.group = group
    this.shardGroup.add(group)

    // Create LOD manager — LOD 1 = the already-loaded image
    if (shard.imageUrl) {
      const lod = new LodManager(shard.id, shard.imageUrl)
      this._lodManagers.set(shard.id, lod)
      // Pre-generate levels 2→3→4 in the background so they're cached before the user zooms
      this._pregenerateLevels(lod, 2, 4)
    }
  }

  _pregenerateLevels(lod, fromLevel, toLevel) {
    if (fromLevel > toLevel) return
    lod.ensure(fromLevel)
      .then(() => this._pregenerateLevels(lod, fromLevel + 1, toLevel))
      .catch(() => {})
  }

  _setupClickZoom(_canvas) {}

  _autoFocus() {
    if (!this._layoutMap) return
    let bestId = null, bestDist = Infinity
    for (const [id, pos] of this._layoutMap) {
      const dx = pos.x - this._panX, dy = (-pos.y) - this._panY
      const d = dx * dx + dy * dy
      if (d < bestDist) { bestDist = d; bestId = id }
    }
    if (bestId && bestId !== this._focusedId) {
      this._focusedId = bestId
      this._activeLod = 1
    }
  }

  // ── Infinite zoom (Zoomquilt-style via ZoomCanvas) ──────────────────────────
  _updateLOD() {
    if (this._zoomCanvas.active) return  // ZoomCanvas owns scroll + render
    this._autoFocus()
    if (!this._focusedId) return
    const lod = this._lodManagers.get(this._focusedId)
    if (!lod) return

    const LOAD_Z          = 1800
    const ZOOM_ACTIVATE_Z = 400  // shard roughly fills screen

    const nextLevel = this._activeLod + 1

    // Pre-generate next level while user zooms in
    if (this._camZ < LOAD_Z && !lod.isLoading(nextLevel) && !lod.hasLevel(nextLevel)) {
      this._showLoadingHUD()
      lod.ensure(nextLevel).then(() => this._hideLoadingHUD()).catch(() => this._hideLoadingHUD())
    }

    // Hand off to ZoomCanvas when shard fills the screen
    if (this._camZ < ZOOM_ACTIVATE_Z) {
      const currentUrl = lod.getBestUrl(this._activeLod)
      if (currentUrl) {
        this._hideLoadingHUD()
        // Kick off the next 2 levels immediately so they're likely cached by the time ZoomCanvas needs them
        this._pregenerateLevels(lod, this._activeLod + 1, this._activeLod + 3)
        const shard = this.shards.get(this._focusedId)
        this._zoomCanvas.activate(
          currentUrl,
          this._activeLod,
          shard?.responseText ?? '',
          (level) => {
            const l = this._lodManagers.get(this._focusedId)
            return l ? l.ensure(level) : Promise.reject(new Error('no lod'))
          },
          () => { this._returnToMural() },
          () => { this._camZ = 600; this._applyCamera() }
        )
      }
    }
  }

  _returnToMural() {
    this._focusedId = null
    this._activeLod = 1
    this._camZ = 2200
    this._applyCamera()
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this._composer.setSize(window.innerWidth, window.innerHeight)
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
  }

  getAllShards() { return [...this.shards.values()] }

  _tick() {
    this._rafId = requestAnimationFrame(this._tick.bind(this))
    this._updateLOD()
    this._composer.render()
  }

  dispose() {
    cancelAnimationFrame(this._rafId)
    for (const s of this._seamMeshes) for (const l of s.pathLights) this.scene.remove(l)
    this.renderer.dispose()
    this._tooltip?.remove()
    this._loadingHUD?.remove()
    this._zoomLabel?.remove()
    this._zoomCanvas.dispose()
  }
}
