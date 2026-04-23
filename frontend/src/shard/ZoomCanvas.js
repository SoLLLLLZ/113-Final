const MAX_LEVEL = 4

export class ZoomCanvas {
  constructor() {
    this.el = document.createElement('canvas')
    this.el.style.cssText = 'position:fixed;inset:0;z-index:200;display:none;'
    document.body.appendChild(this.el)
    this.ctx = this.el.getContext('2d')

    this._zoom          = 1.0
    this._targetZoom    = 1.0
    this._currentImg    = null
    this._nextImg       = null
    this._active        = false
    this._raf           = null
    this._currentLevel  = 1
    this._nextRequested = false
    this._nextReady     = false
    this._onNeedNext    = null
    this._onComplete    = null
    this._onExit        = null
    this._completing    = false

    // Generating-next-world HUD
    this._hud = document.createElement('div')
    this._hud.style.cssText = [
      'position:fixed', 'bottom:32px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:201', 'display:none', 'pointer-events:none',
      'background:rgba(8,6,3,0.85)', 'border:1px solid rgba(212,175,55,0.5)',
      'border-radius:20px', 'padding:8px 20px',
      'font-family:system-ui,sans-serif', 'font-size:12px',
      'color:rgba(212,175,55,0.9)', 'letter-spacing:2px',
    ].join(';')
    this._hud.textContent = '✦ GENERATING NEXT WORLD'
    document.body.appendChild(this._hud)

    // Emotional text overlay — fades in 1.5s after level loads, fades out as zoom starts
    this._textEl = document.createElement('div')
    this._textEl.style.cssText = [
      'position:fixed', 'bottom:18%', 'left:50%', 'transform:translateX(-50%)',
      'z-index:202', 'display:none', 'pointer-events:none',
      'max-width:55ch', 'text-align:center',
      'font-family:Georgia,serif', 'font-size:17px', 'line-height:1.7',
      'color:rgba(255,255,255,0.88)', 'text-shadow:0 2px 12px rgba(0,0,0,0.8)',
      'opacity:0', 'transition:opacity 1.2s ease',
    ].join(';')
    document.body.appendChild(this._textEl)

    this._textTimer   = null
    this._textVisible = false
    this._level1Text  = ''

    this._onWheel = this._onWheel.bind(this)
    this._tick    = this._tick.bind(this)
  }

  get active() { return this._active }

  activate(imageUrl, level, level1Text, onNeedNext, onComplete, onExit) {
    const dpr = window.devicePixelRatio || 1
    this.el.width  = window.innerWidth  * dpr
    this.el.height = window.innerHeight * dpr
    this.el.style.width  = window.innerWidth  + 'px'
    this.el.style.height = window.innerHeight + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    this._zoom          = 1.0
    this._targetZoom    = 1.0
    this._currentLevel  = level
    this._nextRequested = false
    this._nextReady     = false
    this._nextImg       = null
    this._active        = true
    this._completing    = false
    this._onNeedNext    = onNeedNext
    this._onComplete    = onComplete
    this._onExit        = onExit
    this._level1Text    = level1Text ?? ''

    this.el.style.opacity    = '0'
    this.el.style.transition = 'opacity 0.3s'
    this.el.style.display    = 'block'
    requestAnimationFrame(() => { this.el.style.opacity = '1' })

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      this._currentImg = img
      this._scheduleText(level)
    }
    img.src = imageUrl

    window.addEventListener('wheel', this._onWheel, { passive: false })
    this._raf = requestAnimationFrame(this._tick)
  }

  setNextImage(url, layerText) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      this._nextImg       = img
      this._nextLayerText = layerText ?? null
      this._nextReady     = true
      this._hud.style.display = 'none'
    }
    img.src = url
  }

  _scheduleText(level) {
    clearTimeout(this._textTimer)
    this._hideText()
    const text = level === 1 ? this._level1Text : (this._currentLayerText ?? '')
    if (!text) return
    this._textTimer = setTimeout(() => {
      this._showText(text)
    }, 1500)
  }

  _showText(text) {
    this._textEl.textContent = text
    this._textEl.style.display = 'block'
    requestAnimationFrame(() => { this._textEl.style.opacity = '1' })
    this._textVisible = true
  }

  _hideText() {
    this._textEl.style.opacity = '0'
    this._textVisible = false
    clearTimeout(this._textTimer)
  }

  _onWheel(e) {
    e.preventDefault()
    e.stopPropagation()
    if (e.deltaY > 0) {
      this._targetZoom -= 0.4
      if (this._targetZoom < 0.7) { this.deactivate(); this._onExit?.() }
    }
  }

  _tick() {
    if (!this._active) return

    // Slow auto-advance near transition zone to give generation time
    const inTransition = this._zoom > 2.0 && !this._nextReady
    this._targetZoom += inTransition ? 0.0004 : 0.003
    if (!this._nextReady) this._targetZoom = Math.min(3.6, this._targetZoom)

    this._zoom += (this._targetZoom - this._zoom) * 0.08

    // Hide text overlay when zoom animation starts
    if (this._zoom > 2.0 && this._textVisible) {
      this._hideText()
    }

    this._draw()

    // Request next level early — at zoom 1.1 there's ~13s before the crossfade
    if (this._zoom > 1.1 && !this._nextRequested) {
      const nextLevel = this._currentLevel + 1
      // At MAX_LEVEL there's no next world — let the crossfade play then complete
      if (this._currentLevel < MAX_LEVEL) {
        this._nextRequested = true
        this._hud.style.display = 'block'
        this._onNeedNext(nextLevel)
          .then(({ url, layerText }) => this.setNextImage(url, layerText))
          .catch(() => { this._hud.style.display = 'none' })
      } else {
        // Mark as ready with a transparent placeholder so crossfade triggers
        this._nextRequested = true
        this._nextReady     = true
        this._nextImg       = null  // null = fade to black
      }
    }

    // Swap / complete at zoom >= 3.5
    if (this._zoom >= 3.5 && this._nextReady && !this._completing) {
      if (this._currentLevel >= MAX_LEVEL) {
        // End of journey — fade to dark then return to mural
        this._completing = true
        this.el.style.transition = 'opacity 1s'
        this.el.style.opacity = '0'
        setTimeout(() => {
          this.deactivate()
          this._onComplete?.()
        }, 1000)
        return
      }

      // Normal level swap
      this._currentLayerText  = this._nextLayerText ?? null
      this._currentImg        = this._nextImg
      this._currentLevel     += 1
      this._nextImg           = null
      this._nextLayerText     = null
      this._nextReady         = false
      this._nextRequested     = false
      const overshoot         = (this._zoom - 3.5) / 3.5
      this._zoom              = 1.0 + overshoot
      this._targetZoom        = Math.max(1.05, this._targetZoom - 2.5)
      this._scheduleText(this._currentLevel)
    }

    this._raf = requestAnimationFrame(this._tick)
  }

  _draw() {
    const ctx = this.ctx
    const w = window.innerWidth, h = window.innerHeight

    ctx.fillStyle = '#03030d'
    ctx.fillRect(0, 0, w, h)

    // Crossfade zone: zoom 2.2 → 3.5
    const FADE_START = 2.2
    const FADE_END   = 3.5
    const t = Math.max(0, Math.min(1, (this._zoom - FADE_START) / (FADE_END - FADE_START)))

    if (this._currentImg) {
      ctx.save()
      ctx.globalAlpha = 1 - t
      if (t > 0) ctx.filter = `blur(${(t * 32).toFixed(1)}px)`
      this._drawCover(this._currentImg, w, h, this._zoom)
      ctx.restore()
    }

    // Next image always drawn at full screen scale — no small square edge ever visible
    if (this._nextImg && t > 0) {
      ctx.save()
      ctx.globalAlpha = t
      this._drawCover(this._nextImg, w, h, 1.0)
      ctx.restore()
    }
  }

  _drawCover(img, w, h, scale) {
    const aspect = img.naturalWidth / img.naturalHeight
    let dw, dh
    if (w / h > aspect) { dw = w * scale; dh = dw / aspect }
    else                { dh = h * scale; dw = dh * aspect }
    this.ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  }

  deactivate() {
    if (!this._active) return
    this._active = false
    this.el.style.display = 'none'
    this._hud.style.display = 'none'
    this._hideText()
    this._textEl.style.display = 'none'
    cancelAnimationFrame(this._raf)
    window.removeEventListener('wheel', this._onWheel)
  }

  dispose() {
    this.deactivate()
    this.el.remove()
    this._hud.remove()
    this._textEl.remove()
  }
}
