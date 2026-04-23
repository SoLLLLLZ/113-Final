import { Router } from 'express'
import { supabase } from '../index.js'
import { generateLODLevel } from '../pipeline.js'

const router = Router()

// POST /api/shard/:id/lod — request a higher LOD for a shard
router.post('/:id/lod', async (req, res) => {
  const { id } = req.params
  const { level } = req.body

  if (typeof level !== 'number' || level < 2) {
    return res.status(400).json({ error: 'level must be >= 2' })
  }

  // check if already exists
  const { data: existing } = await supabase
    .from('shard_levels')
    .select('image_url, focus_object, layer_text')
    .eq('shard_id', id)
    .eq('level', level)
    .single()

  if (existing) return res.json({
    image_url: existing.image_url,
    focus_object: existing.focus_object,
    layer_text: existing.layer_text ?? null,
    cached: true,
  })

  try {
    const { image_url, focus_object, layer_text } = await generateLODLevel(id, level)
    res.json({ image_url, focus_object, layer_text: layer_text ?? null, cached: false })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/shard/:id/levels — all cached LOD levels for a shard
router.get('/:id/levels', async (req, res) => {
  const { data, error } = await supabase
    .from('shard_levels')
    .select('level, image_url, layer_text')
    .eq('shard_id', req.params.id)
    .order('level')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
