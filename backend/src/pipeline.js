import { v4 as uuidv4 } from 'uuid'
import { supabase } from './index.js'
import { broadcast } from './index.js'
import {
  generateImagePrompt,
  generateImage,
  generateAllLayerPrompts,
  generateLODPrompt,
  generateSeamLabel,
  withRetry,
} from './openrouter.js'
import { uploadImage, ensureBucket } from './storage.js'

// Assign a grid position for the new shard (spiral outward from center)
async function assignGridPosition() {
  const { count } = await supabase
    .from('shards')
    .select('*', { count: 'exact', head: true })

  const n = count ?? 0
  // Simple sunflower/phyllotaxis spiral placement
  const angle = n * 2.399963  // golden angle in radians
  const radius = Math.sqrt(n) * 260  // pixels in world space (sized for 560px shards)
  return {
    grid_x: Math.round(Math.cos(angle) * radius),
    grid_y: Math.round(Math.sin(angle) * radius),
  }
}

// Get nearest shards by grid distance
async function getNearestShards(x, y, excludeId, limit = 3) {
  const { data } = await supabase.from('shards').select('*')
  if (!data || data.length === 0) return []

  return data
    .filter(s => s.id !== excludeId)
    .map(s => ({ ...s, dist: Math.hypot(s.grid_x - x, s.grid_y - y) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
}

async function _generateEmotionalLayers(shardId, response, level1Prompt, baseSeed) {
  const result = await withRetry(() => generateAllLayerPrompts(response, level1Prompt))
  if (!result?.layers) return

  await Promise.allSettled(
    result.layers.map(async ({ depth, imagePrompt, text, focusObject }) => {
      const seed = baseSeed + depth * 1337
      const imageData = await withRetry(() => generateImage(imagePrompt, seed, depth))
      const imageUrl = await uploadImage(imageData, `${shardId}/lod${depth}.jpg`)
      await supabase.from('shard_levels').insert({
        shard_id: shardId,
        level: depth,
        image_url: imageUrl,
        prompt: imagePrompt,
        focus_object: focusObject,
        layer_text: text,
        seed,
        width: 512,
        height: 512,
      })
      broadcast('shard:lod', { shardId, level: depth, imageUrl, focusObject, layerText: text })
    })
  )
}

export async function processFormResponse(response) {
  await ensureBucket()

  const shardId = uuidv4()
  const seed = Math.floor(Math.random() * 2147483647)
  const { grid_x, grid_y } = await assignGridPosition()

  // Step 1 — generate image prompt via Claude
  const imagePrompt = await withRetry(() => generateImagePrompt(response))

  // Step 2 — generate image via FLUX
  const imageData = await withRetry(() => generateImage(imagePrompt, seed, 1))

  // Step 3 — upload to Supabase Storage
  const imageUrl = await uploadImage(imageData, `${shardId}/lod1.jpg`)

  // Step 4 — save to Supabase (LOD 1 = the original generated image)
  const shardRow = {
    id: shardId,
    response_text: response.response_text,
    category: response.category,
    image_prompt: imagePrompt,
    image_url: imageUrl,
    grid_x,
    grid_y,
    seed,
  }

  const { error: shardErr } = await supabase.from('shards').insert(shardRow)
  if (shardErr) throw new Error(`Shard insert failed: ${shardErr.message}`)

  // Also store as shard_levels LOD 1
  await supabase.from('shard_levels').insert({
    shard_id: shardId,
    level: 1,
    image_url: imageUrl,
    prompt: imagePrompt,
    width: 512,
    height: 512,
  })

  // Step 5 — generate seam labels for nearest neighbors
  const neighbors = await getNearestShards(grid_x, grid_y, shardId, 3)
  if (neighbors.length > 0) {
    const seamLabels = await Promise.allSettled(
      neighbors.map(n => withRetry(() => generateSeamLabel(response, n)))
    )

    const edgeRows = seamLabels
      .filter(r => r.status === 'fulfilled')
      .map((r, i) => ({
        shard_a: shardId,
        shard_b: neighbors[i].id,
        seam_label: r.value.text,
        weight: r.value.weight,
      }))

    if (edgeRows.length > 0) {
      await supabase.from('edges').insert(edgeRows)
    }
  }

  // Step 6 — broadcast to frontend via WebSocket
  broadcast('shard:new', shardRow)

  // Step 7 — fire-and-forget: generate emotional layers 2-4 in background
  _generateEmotionalLayers(shardId, response, imagePrompt, seed).catch(console.error)

  return { success: true, shardId, imageUrl }
}

export async function generateLODLevel(shardId, level) {
  const { data: shard, error } = await supabase
    .from('shards')
    .select('*')
    .eq('id', shardId)
    .single()

  if (error || !shard) throw new Error('Shard not found')

  // Fetch the previous level's prompt and focus_object for narrative chaining
  let previousPrompt = null
  let previousFocusObject = null
  if (level > 1) {
    const { data: prev } = await supabase
      .from('shard_levels')
      .select('prompt, focus_object')
      .eq('shard_id', shardId)
      .eq('level', level - 1)
      .single()
    previousPrompt = prev?.prompt ?? null
    previousFocusObject = prev?.focus_object ?? null
  }

  const { prompt: lodPrompt, focus_object } =
    await withRetry(() => generateLODPrompt(shard, level, previousPrompt, previousFocusObject))

  const seed = shard.seed + level * 1337
  const imageData = await withRetry(() => generateImage(lodPrompt, seed, level))
  const imageUrl = await uploadImage(imageData, `${shardId}/lod${level}.jpg`)

  await supabase.from('shard_levels').insert({
    shard_id: shardId,
    level,
    image_url: imageUrl,
    prompt: lodPrompt,
    focus_object,
    layer_text: null,
    seed,
    width: 512,
    height: 512,
  })

  broadcast('shard:lod', { shardId, level, imageUrl, focusObject: focus_object })
  return { image_url: imageUrl, focus_object, layer_text: null }
}
