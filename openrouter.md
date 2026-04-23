Good place to start. Here's the full OpenRouter API design for this.

The Two-Step Pipeline
Form response
    ↓
Step 1: Claude → image prompt
    ↓
Step 2: FLUX → generated image
    ↓
Stored in R2 + Supabase

Step 1 — Claude Prompt Generation
The system prompt is where you lock in the visual style. This is what makes all images feel like they belong together despite being completely different content.
javascriptconst STYLE_FINGERPRINT = `
Abstract expressionist oil painting. 
Dark, rich backgrounds with deep blacks and midnight blues.
Subjects emerge from shadow — partially formed, emotionally raw.
Texture is heavy and physical — visible brushstrokes, impasto technique.
Color palette is desaturated except for one dominant accent color per image.
Composition is asymmetric and intimate, never centered or posed.
Mood: melancholic beauty. Like Anselm Kiefer meets Egon Schiele.
No text. No photorealism. No clean lines. No digital polish.
`

const SYSTEM_PROMPT = `
You are an art director for a collaborative human emotion mural called Kintsugi Network.
Your job is to turn a person's written fragment into a vivid image generation prompt.

The visual style for ALL images in this mural is fixed and must never change:
${STYLE_FINGERPRINT}

Rules:
- Every prompt must feel emotionally specific to this person's words
- No two prompts should produce similar compositions even if the themes overlap
- Never describe the words literally — translate emotion into visual metaphor
- Always include: lighting description, texture description, one dominant color, composition notes
- Prompts should be 80-120 words
- Never mention people's names or identifying details
- Output ONLY the image prompt, nothing else
`
The user message:
javascriptfunction buildClaudeMessage(response) {
  const categoryContext = {
    'regret': 'This person is sharing something they wish had gone differently. Find the grief and longing underneath.',
    'proud': 'This person is sharing a moment of hard-won triumph. Find the quiet strength and cost of it.',
    'half-finished': 'This person is sharing something they started but never completed. Find the tension between hope and abandonment.'
  }
  
  return `
Category: ${response.category}
Context: ${categoryContext[response.category]}
Their words: "${response.text}"

Generate the image prompt now.
`
}
The API call:
javascriptasync function generateImagePrompt(response) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://your-site.com',
      'X-Title': 'Kintsugi Network',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildClaudeMessage(response) }
      ],
      max_tokens: 200,
      temperature: 0.9,  // high — we want variety
    })
  })
  
  const data = await res.json()
  return data.choices[0].message.content.trim()
}

Step 2 — FLUX Image Generation
FLUX on OpenRouter takes a prompt via the chat completions endpoint but you need to handle the response differently — it returns a URL or base64 image.
javascriptasync function generateImage(imagePrompt, shardId) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://your-site.com',
      'X-Title': 'Kintsugi Network',
    },
    body: JSON.stringify({
      model: 'black-forest-labs/flux-dev',
      messages: [
        { 
          role: 'user', 
          content: imagePrompt + STYLE_SUFFIX
        }
      ],
    })
  })
  
  const data = await res.json()
  
  // OpenRouter returns image as base64 in content
  const imageData = data.choices[0].message.content
  return imageData  // handle as base64 or URL depending on response format
}

// appended to every FLUX prompt to reinforce style consistency
const STYLE_SUFFIX = ` 
-- Style lock: abstract expressionist oil painting, 
dark background, heavy impasto texture, 
single dominant accent color, asymmetric composition, 
emotionally raw, no text, no photorealism.`

Uniqueness Strategy
The main risk is two similar responses (e.g. two people both wrote "I never finished my novel") producing near-identical images. You prevent this at the Claude level.
javascript// keep a rolling buffer of recent prompts
const recentPrompts = []

async function generateImagePrompt(response) {
  const avoidance = recentPrompts.length > 0 
    ? `\nIMPORTANT: These compositions have already been used — yours must be completely different:\n${recentPrompts.slice(-5).join('\n')}`
    : ''
  
  const message = buildClaudeMessage(response) + avoidance
  
  const prompt = await callClaude(message)
  
  // store for future avoidance
  recentPrompts.push(extractCompositionSummary(prompt))
  if (recentPrompts.length > 20) recentPrompts.shift()
  
  return prompt
}
Additionally, Claude naturally introduces variation because temperature: 0.9 means even identical inputs produce different outputs.

LOD Prompt Variation
When the user zooms in and you need deeper LOD levels, you don't regenerate from scratch — you zoom Claude in too.
javascriptconst LOD_INSTRUCTIONS = {
  0: 'Wide establishing shot. Suggest the emotion through environment and atmosphere.',
  1: 'Standard composition. Subject and setting in balance.',
  2: 'Move closer. Fill the frame with texture and emotional detail. Less environment.',
  3: 'Extreme close-up. One detail rendered with obsessive precision. Abstract almost.',
  4: 'Microscopic. Pure texture, color, and feeling. No recognizable subject.',
}

async function generateLODPrompt(baseShard, level) {
  const message = `
Original fragment: "${baseShard.responseText}"
Original prompt that was used: "${baseShard.imagePrompt}"

Now generate a DEEPER zoom into this same emotional world.
Zoom level: ${level} of 4
Instruction: ${LOD_INSTRUCTIONS[level]}

The new image should feel like you are zooming further into the original painting.
Same style, same color palette as the original, but revealing more intimate detail.
Output only the new image prompt.
`
  return await callClaude(message)
}

Full Pipeline Function
javascriptasync function processFormResponse(response) {
  try {
    // Step 1 — generate prompt
    const imagePrompt = await generateImagePrompt(response)
    
    // Step 2 — generate image
    const imageData = await generateImage(imagePrompt, response.id)
    
    // Step 3 — upload to R2
    const imageUrl = await uploadToR2(imageData, `shards/${response.id}/lod0.jpg`)
    
    // Step 4 — generate seam label for nearby shards
    const neighbors = await getNearestShards(response.id, 3)
    const seamLabels = await Promise.all(
      neighbors.map(neighbor => generateSeamLabel(response, neighbor))
    )
    
    // Step 5 — save everything to Supabase
    await supabase.from('shards').insert({
      id: response.id,
      response_text: response.text,
      category: response.category,
      image_prompt: imagePrompt,
      image_url: imageUrl,
      created_at: new Date(),
    })
    
    await supabase.from('edges').insert(
      seamLabels.map((label, i) => ({
        shard_a: response.id,
        shard_b: neighbors[i].id,
        seam_label: label.text,
        weight: label.weight,
      }))
    )
    
    // Step 6 — broadcast to frontend via Supabase realtime
    // happens automatically when supabase row is inserted
    
    return { success: true, imageUrl }
    
  } catch (err) {
    console.error('Pipeline failed:', err)
    // save response text even if image gen fails
    // retry image gen async
  }
}

Seam Label Generation
javascriptasync function generateSeamLabel(shardA, shardB) {
  const res = await callClaude({
    system: `You connect human stories with poetic gold seam labels for the Kintsugi Network mural. 
             Labels are 3-6 words. Poetic, not literal. Like titles of paintings.`,
    user: `
Fragment A (${shardA.category}): "${shardA.responseText}"
Fragment B (${shardB.category}): "${shardB.responseText}"

Return JSON only:
{
  "text": "the seam label",
  "weight": 0.0-1.0
}
`
  })
  
  return JSON.parse(res)
}

Error Handling + Retry
OpenRouter can fail or timeout, especially FLUX which takes 5-15 seconds. Build retry logic from the start.
javascriptasync function withRetry(fn, maxAttempts = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms`)
      await sleep(delayMs * attempt)  // exponential backoff
    }
  }
}

// usage
const imagePrompt = await withRetry(() => generateImagePrompt(response))
const imageData = await withRetry(() => generateImage(imagePrompt))

Cost Per Submission Estimate
Claude prompt generation  ~$0.002
FLUX Dev image            ~$0.025
Seam labels (3x Claude)   ~$0.006
LOD 2 image (on zoom)     ~$0.025
LOD 3 image (on zoom)     ~$0.025
LOD 4 image (on zoom)     ~$0.025
─────────────────────────────────
Base cost per submission  ~$0.033
Max cost if fully zoomed  ~$0.108
Most users will never zoom deep so real average cost is closer to $0.03-0.05 per submission.