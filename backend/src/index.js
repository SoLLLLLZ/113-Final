import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import shardsRouter from './routes/shards.js'
import lodRouter from './routes/lod.js'
import { startSheetsPoller } from './sheets.js'
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*',
  methods: ['GET', 'POST'],
}))
app.use(express.json())

app.use('/api/shards', shardsRouter)
app.use('/api/shard', lodRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const server = createServer(app)

// WebSocket — broadcast new shards to all connected clients
export const wss = new WebSocketServer({ server })

export function broadcast(type, data) {
  const msg = JSON.stringify({ type, data })
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}

wss.on('connection', ws => {
  ws.on('error', console.error)
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Kintsugi backend running on port ${PORT}`)
  startSheetsPoller()
})
