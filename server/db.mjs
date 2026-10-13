import { MongoClient } from 'mongodb'

function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return ''
  return msg.replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***:***@')
}

let client = null
let db = null
let isConnecting = false

export async function connectDb() {
  if (db) return db
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB || 'villagevet'

  if (!uri) {
    console.warn('MongoDB URI not configured. Database operations will be skipped.')
    return null
  }
  if (isConnecting) return null

  try {
    isConnecting = true
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    })
    await client.connect()
    db = client.db(dbName)
    console.log(`Connected to MongoDB Atlas (database: ${dbName})`)
    isConnecting = false
    return db
  } catch (error) {
    isConnecting = false
    console.error('Failed to connect to MongoDB:', sanitizeMessage(error?.message))
    return null
  }
}

export function isDbConnected() {
  return Boolean(db)
}

export async function saveEnquiry(enquiry) {
  const database = await connectDb()
  if (!database) {
    console.warn('MongoDB not connected; enquiry not persisted to database.')
    return { saved: false, reason: 'database_unavailable' }
  }

  const doc = {
    name: String(enquiry.name || '').trim(),
    phone: String(enquiry.phone || '').trim(),
    email: String(enquiry.email || '').trim(),
    enquiryType: String(enquiry.enquiryType || 'General Enquiry').trim(),
    message: String(enquiry.message || '').trim(),
    ip: enquiry.ip || null,
    userAgent: enquiry.userAgent || null,
    source: enquiry.source || 'website_contact_form',
    createdAt: new Date(),
    status: 'new',
  }

  const result = await database.collection('enquiries').insertOne(doc)
  return { saved: true, id: result.insertedId }
}

export async function saveChatLog(log) {
  const database = await connectDb()
  if (!database) return { saved: false }

  const doc = {
    message: String(log.message || '').trim(),
    reply: String(log.reply || '').trim(),
    language: log.language || 'en',
    hasImage: Boolean(log.hasImage),
    imageMimeType: log.imageMimeType || null,
    ip: log.ip || null,
    userAgent: log.userAgent || null,
    createdAt: new Date(),
  }

  try {
    const result = await database.collection('chat_logs').insertOne(doc)
    return { saved: true, id: result.insertedId }
  } catch (err) {
    console.error('Failed to save chat log to MongoDB:', sanitizeMessage(err?.message))
    return { saved: false, error: 'Database write error' }
  }
}

export async function closeDb() {
  if (client) {
    await client.close()
    client = null
    db = null
  }
}
