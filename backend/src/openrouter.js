const OR_CHAT = 'https://openrouter.ai/api/v1/chat/completions'

const STYLE_FINGERPRINT = `
Surrealist dreamscape, inspired by Salvador Dali and René Magritte.
Ethereal, whimsical, and thought-provoking. Floating or levitating elements.
Soft, diffused, often otherworldly lighting, with glowing or luminous objects.
Color palettes are often muted or pastel, with occasional vibrant, symbolic accents.
Composition is often expansive, with deep perspectives, or unexpected juxtapositions.
Mood: contemplative, mysterious, hopeful, or melancholic wonder.
Symbolism must be directly derived from concrete elements mentioned or implied in the user’s text. Metaphors must stay traceable to real-world objects, settings, or actions in the input.
No photorealism in a mundane sense. No sharp, gritty textures. Do NOT avoid literal elements from the input. Always include at least one recognizable literal anchor from the user's text (object, place, action, or event), even if transformed stylistically.
`

const STYLE_SUFFIX = `
-- Style lock: surrealist dreamscape, Dali-inspired, ethereal lighting,
floating elements, symbolic, deep perspective, whimsical, no mundane photorealism.`

const LAYER_STYLE = {
  2: `-- surrealist dreamscape, expanded dreamlike scene, symbolic detail, central surreal passage`,
  3: `-- surrealist dreamscape, symbolic interior emotional landscape, metaphorical, Magritte-inspired, central luminous vortex`,
  4: `-- ethereal abstraction, fragmented floating forms, pure emotion, soft diffused light, symbolic, glowing central void`,
}

const SYSTEM_PROMPT = `
You are an art director for a collaborative human emotion mural called Kintsugi Network.
Your job is to turn a person's written fragment into a vivid image generation prompt.

The visual style for ALL images in this mural is fixed and must never change:
${STYLE_FINGERPRINT}

Rules:
- Every prompt must be grounded in specific objects, places, or actions from the person's words, then enhanced with subtle surreal transformation.
- No two prompts should produce similar compositions even if the themes overlap.
- Always include a direct visual representation of at least one key element from the user’s words. Then layer symbolic or surreal interpretation on top of it.
- Always include: ethereal lighting description, texture description (e.g., cloud-like, liquid, crystalline), one dominant symbolic color, composition notes (e.g., deep perspective, floating elements).
- Prompts should be 80-120 words.
- Do NOT remove concrete details from the input. Preserve real-world anchors (e.g. school, relationship, achievement, failure context) unless absolutely impossible.
- Output ONLY the image prompt, nothing else.
`

const CATEGORY_CONTEXT = {
  regret: 'This person is describing a specific past action, decision, or event they regret. First visualize the literal situation described in their words. Then show emotional meaning through subtle visual distortion of that same scene.',
  proud: 'Depict the actual achievement or moment described. Show the real-world environment first (school, event, place, object), then elevate it visually to express pride.',
  'half-finished': 'Show the actual unfinished project or situation described. Only then introduce visual symbolism of incompleteness (partial structures, paused motion, etc.).',
  'go back in time': 'This person is reflecting on past choices. Create a surreal scene involving shifting timelines, echoes of past selves, or a path branching into impossible futures.',
  'world needs more': 'This person is expressing a societal need. Illustrate this as a symbolic void being filled, a collective dream manifesting, or a delicate balance being restored in a fantastical landscape.',
  'define success': 'This person is articulating their personal definition of achievement. Represent this as a unique, symbolic destination, a personal constellation, or a journey\'s end in an otherworldly realm.',
}

const DRILL_SYSTEM = `
You are creating an infinite zoom-in narrative for the Kintsugi Network mural.
The viewer zooms through nested worlds — each level reveals a NEW complete scene
discovered inside the previous one, like falling through a portal into a smaller universe.

The visual style is fixed and must never change:
${STYLE_FINGERPRINT}

Rules for drill-down scenes:
- Each scene must feel like it EXISTS SPATIALLY INSIDE the previous scene, maintaining the surrealist aesthetic.
- Each scene is a COMPLETE NAVIGABLE ENVIRONMENT — a place you could explore in a dream.
- Never generate abstract close-ups, textures, or microscopic views. Always maintain a sense of scale and place.
- Always show: a surreal setting with depth, ethereal atmosphere, a symbolic light source, and implied scale.
- The emotional theme of the original fragment must still resonate through symbolic elements.
- 80-120 words for the prompt.

CRITICAL COMPOSITION RULE:
Every image must have ONE clear zoom target at the exact CENTER of the frame —
a tunnel, archway, corridor, vortex, doorway, cave entrance, well, or similar passage, rendered in a surreal, dreamlike manner.
This portal must occupy roughly 20-30% of the center area and lead visually inward/deeper into a new, smaller dreamscape.
Everything else in the image frames or draws attention toward this central portal.
The viewer will zoom directly into this central point to discover the next world.
NO wide open compositions. NO portals placed off-center. The center must invite inward travel into a new surreal reality.

Output ONLY valid JSON (no markdown, no explanation):
{"prompt": "...", "focus_object": "short label for the central portal (e.g. 'floating archway', 'luminous vortex', 'dream corridor')"}
`

const LAYER_SYSTEM = `
You create 3 deeper emotional layers for a Kintsugi Network shard.
Each layer zooms deeper into the emotional truth of someone's story.
The visual style is fixed and must never change:
${STYLE_FINGERPRINT}

Layer structure:
- Layer 2 (Expanded Scene): A more specific, intimate scene from their story. 2-3 sentences of reflective text shown to the viewer.
- Layer 3 (Internal/Symbolic): What they felt inside. Metaphorical and poetic. 1-2 sentences.
- Layer 4 (Core Abstraction): The purest distillation of the emotion. 3-8 words only.

For each layer produce:
- imagePrompt: 80-120 word surrealist dreamscape image prompt following the style above
- CRITICAL: Every image must have ONE clear central tunnel/archway/vortex/portal at the center (20-30% of frame). No wide open compositions. No portals off-center.
- text: the emotional text shown to the viewer at this layer
- focusObject: short label for the central portal (e.g. 'luminous archway', 'dream vortex', 'glowing corridor')

Output ONLY valid JSON (no markdown, no explanation):
{"layers": [
  {"depth": 2, "imagePrompt": "...", "text": "...", "focusObject": "..."},
  {"depth": 3, "imagePrompt": "...", "text": "...", "focusObject": "..."},
  {"depth": 4, "imagePrompt": "...", "text": "...", "focusObject": "..."}
]}`

const recentPrompts = []

async function orFetch(body) {
  const res = await fetch(OR_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kintsugi-network.github.io',
      'X-Title': 'Kintsugi Network',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${text}`)
  }
  return res.json()
}

export async function generateImagePrompt(response) {
  const avoidance = recentPrompts.length > 0
    ? `\nIMPORTANT: These compositions have already been used — yours must be completely different:\n${recentPrompts.slice(-5).join('\n')}`
    : ''

  const userMsg = `Category: ${response.category}
Context: ${CATEGORY_CONTEXT[response.category] ?? ''}
Their words: "${response.response_text}"

Generate the image prompt now.${avoidance}`

  const data = await orFetch({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    max_tokens: 200,
    temperature: 0.9,
  })

  const prompt = data.choices[0].message.content.trim()
  recentPrompts.push(prompt.slice(0, 100))
  if (recentPrompts.length > 20) recentPrompts.shift()
  return prompt
}

// Serializes all Pollinations requests — one at a time, 1.5s gap between each
let _pollinationsQueue = Promise.resolve()

function queuePollinations(fn) {
  const next = _pollinationsQueue.then(
    () => fn().then(r => new Promise(res => setTimeout(() => res(r), 1500))),
    () => fn().then(r => new Promise(res => setTimeout(() => res(r), 1500))),
  )
  _pollinationsQueue = next.catch(() => {})
  return next
}

// Free image generation via Pollinations.AI — no API key needed
export async function generateImage(imagePrompt, seed, depth = 1) {
  return queuePollinations(async () => {
    const styleSuffix = LAYER_STYLE[depth] ?? STYLE_SUFFIX
    const encoded = encodeURIComponent(imagePrompt + '\n' + styleSuffix)
    const seedParam = seed != null ? `&seed=${seed}` : ''
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true&model=flux${seedParam}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`Pollinations error: ${res.status}`)
      const arrayBuf = await res.arrayBuffer()
      return Buffer.from(arrayBuf)  // raw image bytes — storage.js handles Buffer directly
    } finally {
      clearTimeout(timeout)
    }
  })
}

export async function generateAllLayerPrompts(response, level1Prompt) {
  const data = await orFetch({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [
      { role: 'system', content: LAYER_SYSTEM },
      {
        role: 'user',
        content: `Category: ${response.category}
Their words: "${response.response_text}"
Surface scene (layer 1): "${level1Prompt}"

Generate the 3 deeper layers now.`,
      },
    ],
    max_tokens: 900,
    temperature: 0.88,
  })

  try {
    return JSON.parse(data.choices[0].message.content.trim())
  } catch {
    return null
  }
}

export async function generateLODPrompt(baseShard, level, previousPrompt, previousFocusObject) {
  const prevScene = previousPrompt ?? baseShard.image_prompt
  const zoomTarget = previousFocusObject
    ? `\nYou are now zooming INTO: "${previousFocusObject}" — this specific thing must become the center of the new scene.`
    : ''

  const userMsg = `Original emotional fragment: "${baseShard.response_text}"

The viewer has been zooming deeper into a nested world.
This is zoom level ${level} — an infinite chain with no end.

Previous scene (what the viewer just left):
"${prevScene}"
${zoomTarget}
Your task: Imagine what the viewer DISCOVERS when they zoom into the previous scene.
They are falling through layers of reality connected to the original emotion.

Think of it like this example chain for "getting into college felt impossible":
- They saw: stone stairs ascending into dark fog → focus_object: "stone staircase"
- Zoom in → discover: a grand gothic university entrance at the top → focus_object: "arched entrance door"
- Zoom in → discover: a bustling hallway with students → focus_object: "wooden classroom door"
- Zoom in → discover: a candlelit classroom with a globe → focus_object: "antique globe"
- Zoom in → discover: inside the globe, a mountain range under impossible stars → focus_object: "distant mountain peak"
(this continues forever)

Generate the next scene in the chain. It must feel spatially INSIDE the previous scene.
It must be a complete world the viewer can explore — not an abstract texture.
Output ONLY valid JSON.`

  const data = await orFetch({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [
      { role: 'system', content: DRILL_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    max_tokens: 280,
    temperature: 0.92,
  })

  const raw = data.choices[0].message.content.trim()
  try {
    return JSON.parse(raw)
  } catch {
    return { prompt: raw, focus_object: 'a detail in the distance' }
  }
}

export async function generateSeamLabel(shardA, shardB) {
  const data = await orFetch({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [
      {
        role: 'system',
        content: 'You connect human stories with poetic gold seam labels for the Kintsugi Network mural. Labels are 3-6 words. Poetic, not literal. Like titles of paintings. Return only valid JSON.',
      },
      {
        role: 'user',
        content: `Fragment A (${shardA.category}): "${shardA.response_text}"
Fragment B (${shardB.category}): "${shardB.response_text}"

Return JSON only:
{"text": "the seam label", "weight": 0.0}`,
      },
    ],
    max_tokens: 80,
    temperature: 0.85,
  })

  try {
    return JSON.parse(data.choices[0].message.content.trim())
  } catch {
    return { text: 'shared light', weight: 0.5 }
  }
}

export async function withRetry(fn, maxAttempts = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      console.log(`Attempt ${attempt} failed (${err.message}), retrying in ${delayMs * attempt}ms`)
      await new Promise(r => setTimeout(r, delayMs * attempt))
    }
  }
}
