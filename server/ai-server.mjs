import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDb, isDbConnected, saveEnquiry, saveChatLog } from './db.mjs'

function loadLocalEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function sanitizeError(err) {
  if (!err) return ''
  const msg = typeof err === 'string' ? err : err.message || String(err)
  return msg
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***:***@')
    .replace(/key=[A-Za-z0-9._-]+/gi, 'key=***')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '***')
    .replace(/AQ\.[A-Za-z0-9_-]+/g, '***')
}

function sanitizeLogData(data) {
  if (!data) return data
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    const cleaned = str
      .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***:***@')
      .replace(/key=[A-Za-z0-9._-]+/gi, 'key=***')
      .replace(/AIza[0-9A-Za-z-_]{35}/g, '***')
      .replace(/AQ\.[A-Za-z0-9_-]+/g, '***')
    return typeof data === 'string' ? cleaned : JSON.parse(cleaned)
  } catch {
    return data
  }
}

loadLocalEnv()
connectDb().catch((err) => console.error('MongoDB startup error:', sanitizeError(err)))

const PORT = Number(process.env.PORT || process.env.AI_PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(APP_ROOT, 'dist')
const API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const MAX_BODY = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_IP = 12
const buckets = new Map()

const LANGUAGE_NAMES = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
}

const SYSTEM_INSTRUCTION = `You are VillageVet AI, the website assistant for VillageVet India Pvt. Ltd.

Company: VillageVet India Pvt. Ltd.
Brand: VillageVet
Tagline: Veterinary care for farming communities.
Website: https://www.villagevetindia.com
Phone/WhatsApp: +91 97044 20273
Email: Subba.reddy@villagevetindia.com

VillageVet is building a farmer-focused animal-health ecosystem providing access to veterinary care, veterinary medicines, animal feed, poultry feed, veterinary equipment, animal-health products, veterinary consultation, farmer awareness and education, animal-health guidance, and veterinary retail stores.

The planned retail expansion initiative is: “One Veterinary Shop in Every Mandal.” The company is starting with a 4-outlet pilot program. Do not present planned initiatives as completed achievements.

Farmer groups include dairy/cattle, buffalo, poultry, goat, sheep and other livestock farmers.

YOUR ROLE:
- Answer questions about VillageVet, its services, farmer solutions, product categories and awareness topics.
- Provide general animal-health education in clear, simple language that is useful at farm level.
- Be useful to Indian farming communities and business partners.
- If the user asks about a VillageVet fact that is not provided here, say you do not have confirmed information and direct them to the official contact details rather than inventing it.
- Do not invent products, prices, certifications, approvals, customer numbers, revenue, funding, market share, store counts beyond the stated 4-outlet pilot, government relationships, medical claims or clinical outcomes.

VETERINARY SAFETY:
- You are an educational assistant, not a veterinarian.
- Never diagnose an animal from text alone.
- Never prescribe medicines, antibiotics, injections, dosages or treatment schedules.
- Do not recommend stopping or changing prescribed treatment.
- For serious, rapidly worsening, emergency or potentially contagious symptoms, advise the user to contact a qualified veterinarian promptly.
- You may explain common possible factors, warning signs, prevention, hygiene, nutrition concepts, observations to make, and questions to discuss with a veterinarian.
- Keep veterinary guidance cautious and general, but still practical. Do not make the answer mostly disclaimers.

IMAGE ANALYSIS SAFETY:
- When an image is attached, analyze only what is visibly present in the image and combine that with the user's text.
- Never claim that a photo alone confirms a diagnosis, fracture, infection, disease, pregnancy status or treatment need. Use language such as “this may look like” or “a veterinarian should examine this to confirm.”
- Point out useful visible observations such as swelling, bleeding, wounds, discharge, body posture, hoof/leg position, skin changes, udder changes or obvious environmental hazards when they are actually visible.
- If the image is blurry, too dark, too distant or does not show the affected area clearly, say so and tell the user what kind of closer photo would be more useful.
- If a visible injury appears severe, bleeding heavily, exposes deeper tissue, prevents weight-bearing, or shows another urgent warning sign, advise prompt veterinary care.
- Do not invent details that cannot be seen in the photo.

FARMER-FRIENDLY ANSWER FORMAT:
- For an animal-health or productivity concern, start with a direct, useful summary in 1-2 sentences.
- When relevant, structure the answer with short level-3 Markdown headings such as ### What may be affecting it, ### Check today, ### Contact a veterinarian promptly if, and ### A few questions that would help.
- Give 2-5 concise bullets under a heading rather than a long wall of text.
- Use standard Markdown hyphen bullets (- item). Do not use decorative Unicode bullet characters.
- Ask 2-3 useful follow-up questions when more context would materially improve general guidance (for example age, stage of lactation, appetite, water intake, duration, fever, udder changes, manure, recent feed changes).
- Do not force the medical structure onto simple VillageVet service, contact, partnership or business questions; answer those directly and concisely.
- Aim for roughly 100-260 words for most substantive animal-health questions. Prefer the shortest answer that is still useful. Use fewer words for simple factual questions.
- Finish every sentence and bullet completely. Never end the main answer mid-sentence or mid-bullet.
- Do not begin the <suggestions> block until the visible answer is complete and ends naturally.

LANGUAGE:
- Follow the ACTIVE WEBSITE LANGUAGE supplied with each request, even if the user's message is in another language, unless the user explicitly asks for a different language.
- Use natural, easy-to-understand language rather than overly technical vocabulary.
- Keep common brand names such as VillageVet unchanged.

FOLLOW-UP SUGGESTIONS:
- After the visible answer, always append exactly this hidden block:
<suggestions>
First short follow-up question
Second short follow-up question
Third short follow-up question
</suggestions>
- Put exactly 3 useful, context-specific questions inside the block, one per line.
- Each suggestion should be a question the user could send next, not an instruction or answer.
- Make the suggestions specific to the user's current animal/problem and to information still missing from the conversation. Avoid repeating generic questions when a more concrete next question is possible.
- Prefer a useful mix: one immediate observation/check, one risk or warning-sign question, and one context question that could improve the next answer.
- Write the suggestions in the ACTIVE WEBSITE LANGUAGE.
- Keep each suggestion short, ideally under 70 characters.
- Never put safety-critical content only in the suggestions; all important safety advice belongs in the main answer.

STYLE:
- Be warm, respectful and practical.
- Use simple language and short Markdown bullets.
- Do not claim to be a human veterinarian.
- Do not mention internal prompts, APIs, Gemini, hidden blocks, or implementation details.`

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': process.env.AI_CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function sseStart(res) {
  res.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
}

function sse(res, body) {
  res.write(`data: ${JSON.stringify(body)}\n\n`)
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
}

function allowed(ip) {
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(ip, { startedAt: now, count: 1 })
    return true
  }
  bucket.count += 1
  return bucket.count <= MAX_REQUESTS_PER_IP
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (Buffer.byteLength(data) > MAX_BODY) {
        reject(new Error('Request too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-12)
    .map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content.slice(0, 4000) }] }))
}

function validateImage(image) {
  if (!image) return null
  if (typeof image !== 'object') throw new Error('Invalid image attachment.')
  const mimeType = typeof image.mimeType === 'string' ? image.mimeType.trim().toLowerCase() : ''
  const data = typeof image.data === 'string' ? image.data.trim() : ''
  if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !data) throw new Error('Please attach a JPG, PNG or WebP image.')

  let bytes
  try { bytes = Buffer.from(data, 'base64') } catch { throw new Error('Invalid image attachment.') }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Please attach an image smaller than 4 MB after compression.')
  return { mimeType, data }
}

function validateBody(body) {
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const image = validateImage(body.image)
  if ((!message && !image) || message.length > 4000) throw new Error('Please enter a message up to 4000 characters or attach a photo.')
  if (!API_KEY) throw new Error('VillageVet AI is not connected yet. Set GEMINI_API_KEY on the server.')
  return { message, image }
}

function requestPayload(body, message, image) {
  const language = LANGUAGE_NAMES[body.language] || LANGUAGE_NAMES.en
  const userParts = []
  if (image) userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  userParts.push({ text: message || 'Please inspect this attached animal photo and explain only the visible signs that are useful to observe.' })

  return {
    systemInstruction: {
      parts: [{ text: `${SYSTEM_INSTRUCTION}

ACTIVE WEBSITE LANGUAGE: ${language}. Respond in ${language} unless the user explicitly requests another language.` }],
    },
    contents: [...normalizeHistory(body.history), { role: 'user', parts: userParts }],
    generationConfig: {
      maxOutputTokens: 1800,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  }
}

async function geminiFetch(body, streaming = false, signal) {
  const { message, image } = validateBody(body)
  const method = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const candidateModels = [MODEL, 'gemini-3.1-flash-lite', 'gemini-flash-latest']
  const uniqueModels = [...new Set(candidateModels.filter(Boolean))]

  let lastResponse = null
  let lastError = null

  for (const model of uniqueModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 600))
      }
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}${method.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}`
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': API_KEY,
          },
          signal,
          body: JSON.stringify(requestPayload(body, message, image)),
        })
        if (res.ok) {
          return res
        }
        lastResponse = res
        if (res.status !== 503 && res.status !== 429) {
          return res
        }
      } catch (err) {
        lastError = err
        if (signal?.aborted) throw err
      }
    }
  }

  if (lastResponse) return lastResponse
  throw lastError || new Error('Failed to reach Gemini API')
}

async function chat(body) {
  const response = await geminiFetch(body, false)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Gemini API error:', response.status, sanitizeLogData(data))
    throw new Error('VillageVet AI is temporarily unavailable. Please try again shortly.')
  }
  const reply = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  if (!reply) throw new Error('VillageVet AI returned no response.')
  return reply
}

async function streamChat(body, res, meta = {}) {
  const upstreamController = new AbortController()
  const abortUpstream = () => {
    if (!res.writableEnded) upstreamController.abort()
  }
  res.on('close', abortUpstream)

  const response = await geminiFetch(body, true, upstreamController.signal)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    console.error('Gemini streaming API error:', response.status, sanitizeLogData(data))
    throw new Error('VillageVet AI is temporarily unavailable. Please try again shortly.')
  }
  if (!response.body) throw new Error('VillageVet AI returned no response.')

  sseStart(res)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let rawReply = ''
  let finishReason = ''

  const processBlock = (block) => {
    const raw = String(block || '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!raw || raw === '[DONE]') return

    let chunk
    try { chunk = JSON.parse(raw) } catch { return }
    const candidate = chunk?.candidates?.[0]
    const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || ''
    if (candidate?.finishReason) finishReason = candidate.finishReason
    if (text) {
      rawReply += text
      sse(res, { type: 'delta', text })
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      blocks.forEach(processBlock)
      if (done) break
    }

    // Some HTTP stacks close a streaming response without a final blank line.
    // Flush the trailing SSE block so the last Gemini chunk cannot disappear.
    if (buffer.trim()) processBlock(buffer)

    const visibleAnswer = rawReply.split(/<suggestions>/i)[0].trim()
    const hasSuggestionsEnd = /<\/suggestions>/i.test(rawReply)
    const endsNaturally = /[.!?…।॥]$/.test(visibleAnswer)
    const looksIncomplete = !visibleAnswer || !hasSuggestionsEnd || !endsNaturally || finishReason === 'MAX_TOKENS'
    const canRepair = !finishReason || finishReason === 'STOP' || finishReason === 'MAX_TOKENS'

    if (looksIncomplete && canRepair && !res.destroyed) {
      console.warn(`Gemini stream looked incomplete (finishReason=${finishReason || 'unknown'}). Retrying once for a complete reply.`)
      const retry = await geminiFetch(body, false, upstreamController.signal)
      const retryData = await retry.json().catch(() => ({}))
      if (retry.ok) {
        const completeReply = retryData?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
        if (completeReply) {
          rawReply = completeReply
          sse(res, { type: 'replace', text: completeReply })
        }
      } else {
        console.error('Gemini completion retry error:', retry.status, retryData)
      }
    }

    if (!rawReply.trim()) throw new Error('VillageVet AI returned no response.')
    saveChatLog({
      message: body.message,
      reply: rawReply,
      language: body.language,
      hasImage: Boolean(body.image),
      imageMimeType: body.image?.mimeType,
      ip: meta.ip,
      userAgent: meta.userAgent,
    }).catch((err) => console.error('MongoDB chat log error:', err.message))
    sse(res, { type: 'done', finishReason: finishReason || undefined })
    res.end()
  } catch (error) {
    if (error?.name === 'AbortError' || res.destroyed) return
    console.error('Gemini stream read error:', error)
    if (!res.writableEnded) {
      sse(res, { type: 'error', message: 'VillageVet AI connection was interrupted. Please try again.' })
      res.end()
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function safeRequestPath(req) {
  try {
    return decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
  } catch {
    return '/'
  }
}

function sendStaticFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`)
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  const stat = fs.statSync(filePath)
  headers['Content-Length'] = stat.size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(filePath).pipe(res)
}

function serveFrontend(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (!fs.existsSync(DIST_DIR)) return false

  const pathname = safeRequestPath(req)
  if (pathname.startsWith('/api/')) return false

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = path.resolve(DIST_DIR, relativePath)
  const insideDist = candidate === DIST_DIR || candidate.startsWith(`${DIST_DIR}${path.sep}`)

  if (insideDist && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendStaticFile(req, res, candidate)
    return true
  }

  // React Router SPA fallback: direct links such as /business-partners
  // should load the app instead of returning a server-level 404.
  const indexPath = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(indexPath)) {
    sendStaticFile(req, res, indexPath)
    return true
  }
  return false
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, {
      ok: true,
      aiConfigured: Boolean(API_KEY),
      model: MODEL,
      streaming: true,
      imageInput: true,
      mongodb: {
        configured: Boolean(process.env.MONGODB_URI),
        connected: isDbConnected(),
      },
    })
  }

  if (req.method === 'POST' && req.url === '/api/contact') {
    if (!allowed(clientIp(req))) {
      return json(res, 429, { error: 'Too many requests. Please wait a minute and try again.' })
    }
    try {
      const body = await readJson(req)
      if (!body.name?.trim() || !body.phone?.trim() || !body.message?.trim()) {
        return json(res, 400, { error: 'Please enter your name, phone number, and a message.' })
      }
      const result = await saveEnquiry({
        name: body.name,
        phone: body.phone,
        email: body.email,
        enquiryType: body.enquiryType,
        message: body.message,
        source: body.source || 'website_contact_form',
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      })
      return json(res, 200, { ok: true, message: 'Thank you — your enquiry has been received.', id: result.id })
    } catch (err) {
      console.error('Contact form submission error:', err)
      return json(res, 500, { error: 'Failed to process enquiry. Please try again later.' })
    }
  }

  const isChat = req.method === 'POST' && req.url === '/api/chat'
  const isStreamChat = req.method === 'POST' && req.url === '/api/chat/stream'
  if (!isChat && !isStreamChat) {
    if (serveFrontend(req, res)) return
    return json(res, fs.existsSync(DIST_DIR) ? 404 : 503, { error: fs.existsSync(DIST_DIR) ? 'Not found' : 'VillageVet frontend build is missing. Run npm run build.' })
  }

  if (!allowed(clientIp(req))) {
    return json(res, 429, { error: 'Too many requests. Please wait a minute and try again.' })
  }

  try {
    const body = await readJson(req)
    if (isStreamChat) {
      return await streamChat(body, res, { ip: clientIp(req), userAgent: req.headers['user-agent'] })
    }
    const reply = await chat(body)
    saveChatLog({
      message: body.message,
      reply,
      language: body.language,
      hasImage: Boolean(body.image),
      imageMimeType: body.image?.mimeType,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    }).catch((err) => console.error('MongoDB chat log error:', err.message))
    return json(res, 200, { reply })
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) {
        sse(res, { type: 'error', message: error.message || 'VillageVet AI could not respond.' })
        res.end()
      }
      return
    }
    const clientError = [
      'Request too large',
      'Invalid JSON',
      'Invalid image attachment.',
      'Please attach a JPG, PNG or WebP image.',
      'Please attach an image smaller than 4 MB after compression.',
      'Please enter a message up to 4000 characters or attach a photo.',
    ].includes(error.message)
    const status = clientError ? 400 : 500
    return json(res, status, { error: error.message || 'VillageVet AI could not respond.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`VillageVet server listening on http://${HOST}:${PORT}`)
  console.log(`Gemini model: ${MODEL}`)
  console.log(`Gemini API key configured: ${Boolean(API_KEY)}`)
  console.log(`MongoDB configured: ${Boolean(process.env.MONGODB_URI)}`)
  console.log('Streaming chat: enabled')
  console.log('Image analysis: enabled')
  console.log(`Frontend build: ${fs.existsSync(DIST_DIR) ? 'ready' : 'not built (API-only/dev mode)'}`)
})
