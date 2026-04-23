import { google } from 'googleapis'
import { supabase } from './index.js'
import { processFormResponse } from './pipeline.js'

const POLL_INTERVAL_MS = 60_000

// Google Form column layout (0-based):
// A=Timestamp, B=proud, C=regret, D=half-finished, E=go back in time, F=world needs more, G=define success
const QUESTION_COLUMNS = [
  { col: 1, category: 'proud' },
  { col: 2, category: 'regret' },
  { col: 3, category: 'half-finished' },
  { col: 4, category: 'go back in time' },
  { col: 5, category: 'world needs more' },
  { col: 6, category: 'define success' },
]

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

async function getProcessedRows() {
  const { data } = await supabase
    .from('processed_rows')
    .select('row_index')
  return new Set((data ?? []).map(r => r.row_index))
}

async function markRowProcessed(rowIndex) {
  await supabase.from('processed_rows').insert({ row_index: rowIndex })
}

let _polling = false

async function pollSheet() {
  if (_polling) return
  _polling = true
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A2:G',  // Timestamp + 6 question columns
    })

    const rows = res.data.values ?? []
    const processed = await getProcessedRows()

    for (let i = 0; i < rows.length; i++) {
      const rowIndex = i + 2  // 1-based, skip header
      if (processed.has(rowIndex)) continue

      const row = rows[i]
      let anyProcessed = false

      for (const { col, category } of QUESTION_COLUMNS) {
        const response_text = (row[col] ?? '').trim()
        if (!response_text) continue

        console.log(`Processing row ${rowIndex} [${category}]: "${response_text.slice(0, 50)}..."`)
        try {
          await processFormResponse({ response_text, category })
          anyProcessed = true
        } catch (err) {
          console.error(`Failed row ${rowIndex} [${category}]:`, err.message)
        }
      }

      if (anyProcessed) await markRowProcessed(rowIndex)
    }
  } catch (err) {
    console.error('Sheet poll error:', err.message)
  } finally {
    _polling = false
  }
}

export function startSheetsPoller() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('Google Sheets not configured — skipping poller')
    return
  }
  console.log('Starting Google Sheets poller (60s interval)')
  pollSheet()
  setInterval(pollSheet, POLL_INTERVAL_MS)
}
