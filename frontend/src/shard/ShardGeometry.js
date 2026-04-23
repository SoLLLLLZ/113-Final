export class ShardGeometry {
  constructor(seed) {
    this.seed = seed >>> 0
    this.points = this._generate()
  }

  _rand() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0
    return this.seed / 0x100000000
  }

  _generate() {
    const count = 8 + Math.floor(this._rand() * 5)  // 8–12 radial points
    const pts = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      // Base radius — slightly irregular
      let r = 0.20 + this._rand() * 0.16
      // ~30% chance of a spike — the jagged splinter look
      if (this._rand() > 0.70) {
        r *= 1.3 + this._rand() * 0.55
      }
      pts.push([0.5 + Math.cos(angle) * r, 0.5 + Math.sin(angle) * r])
    }
    return pts
  }

  toPixiPoints(x, y, w, h) {
    return this.points.flatMap(([px, py]) => [x + px * w, y + py * h])
  }

  toThreePoints(w, h) {
    return this.points.map(([px, py]) => [px * w, py * h])
  }
}
