import { supabase } from './index.js'

const BUCKET = 'shards'

// Ensure the bucket exists (call once at startup if needed)
export async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some(b => b.name === BUCKET)
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, { public: true })
  }
}

// Upload image data (base64, data URI, or URL) → returns public URL
export async function uploadImage(imageData, path) {
  let buffer

  if (typeof imageData === 'string' && imageData.startsWith('http')) {
    // it's a URL — fetch the image bytes
    const res = await fetch(imageData)
    if (!res.ok) throw new Error(`Failed to fetch image URL: ${res.status}`)
    const arrayBuf = await res.arrayBuffer()
    buffer = Buffer.from(arrayBuf)
  } else if (typeof imageData === 'string') {
    // base64 or data URI
    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
    buffer = Buffer.from(base64, 'base64')
  } else {
    buffer = imageData
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
