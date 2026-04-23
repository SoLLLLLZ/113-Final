import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { MuralScene } from './MuralScene.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function MuralView({ onSceneReady, style }) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)

  useEffect(() => {
    let channel
    let cleanupResize

    async function init() {
      const scene = new MuralScene(canvasRef.current)
      sceneRef.current = scene
      if (onSceneReady) onSceneReady(scene)

      try {
        const res = await fetch(`${API_URL}/api/shards`)
        const { shards = [], edges = [] } = await res.json()
        await scene.loadAll(shards, edges)
      } catch (e) {
        console.warn('Could not load shards:', e.message)
      }

      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        channel = supabase
          .channel('public:shards')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shards' },
            (payload) => scene.addShard(payload.new, true))
          .subscribe()
      }

      const onResize = () => scene.resize()
      window.addEventListener('resize', onResize)
      cleanupResize = () => window.removeEventListener('resize', onResize)
    }

    init()

    return () => {
      channel?.unsubscribe()
      cleanupResize?.()
      sceneRef.current?.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100vw', height: '100vh', ...style }}
    />
  )
}
