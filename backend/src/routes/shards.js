import { Router } from 'express'
import { supabase } from '../index.js'

const router = Router()

// GET /api/shards — all shards + edges for initial canvas load
router.get('/', async (_req, res) => {
  const [shardsRes, edgesRes] = await Promise.all([
    supabase.from('shards').select('*').order('created_at', { ascending: true }),
    supabase.from('edges').select('*'),
  ])

  if (shardsRes.error) return res.status(500).json({ error: shardsRes.error.message })
  if (edgesRes.error) return res.status(500).json({ error: edgesRes.error.message })

  res.json({ shards: shardsRes.data, edges: edgesRes.data })
})

// POST /api/shards/process — manually trigger processing a response
// (also called internally by the sheets poller)
router.post('/process', async (req, res) => {
  const { response_text, category } = req.body
  if (!response_text || !category) {
    return res.status(400).json({ error: 'response_text and category required' })
  }

  try {
    const { processFormResponse } = await import('../pipeline.js')
    const result = await processFormResponse({ response_text, category })
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

export default router
