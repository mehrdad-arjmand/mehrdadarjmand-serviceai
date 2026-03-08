import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Input validation constants
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_FILES = 50
const MAX_METADATA_LENGTH = 500
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt']

function isValidMetadata(value: FormDataEntryValue | null, maxLength: number): boolean {
  if (value === null) return true
  if (typeof value !== 'string') return false
  return value.length <= maxLength
}

function sanitizeMetadata(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  return value.trim().slice(0, MAX_METADATA_LENGTH)
}

function isValidDate(value: FormDataEntryValue | null): boolean {
  if (value === null) return true
  if (typeof value !== 'string') return true
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || value === ''
}

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() || 'unknown'
}

function isAllowedFileType(fileName: string): boolean {
  const ext = getFileExtension(fileName)
  return ALLOWED_EXTENSIONS.includes(ext)
}

// Call Google Gemini API directly for text cleaning
async function callGeminiForCleaning(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [{ text: 'You fix broken word spacing in OCR-extracted text. Fix ONLY broken spacing. Do NOT add, remove, summarize, or rephrase. Preserve numbers, codes, tables. Return ONLY the corrected text.' }]
        },
        generationConfig: { temperature: 0.1 }
      }),
    }
  )

  if (response.status === 429) {
    const errText = await response.text()
    throw new Error(`Rate limited: ${errText.slice(0, 200)}`)
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`)
  }

  const result = await response.json()
  return result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: supabaseAnonKey },
    })
    if (!userRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const user = await userRes.json()
    if (!user?.id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Authenticated user: ${user.id}`)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
      p_tab: 'repository', p_action: 'write', p_user_id: user.id
    })
    if (permError) {
      return new Response(
        JSON.stringify({ error: 'Permission check failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: You do not have permission to upload documents' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user's API tier from their role
    const { data: userApiTier } = await supabase.rpc('get_user_api_tier', { p_user_id: user.id })
    const apiTier = userApiTier || 'free'
    console.log(`User API tier: ${apiTier}`)

    const contentType = req.headers.get('content-type')
    if (!contentType?.includes('multipart/form-data')) {
      throw new Error('Content-Type must be multipart/form-data')
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      throw new Error('Invalid form data')
    }

    const files = formData.getAll('files') as File[]
    const docType = formData.get('docType')
    const uploadDate = formData.get('uploadDate')
    const site = formData.get('site')
    const equipmentType = formData.get('equipmentType')
    const equipmentMake = formData.get('equipmentMake')
    const equipmentModel = formData.get('equipmentModel')
    const allowedRolesRaw = formData.get('allowedRoles')
    const projectIdRaw = formData.get('projectId')
    const dynamicMetadataRaw = formData.get('dynamicMetadata')

    let dynamicMetadata: Record<string, string> = {}
    if (dynamicMetadataRaw && typeof dynamicMetadataRaw === 'string') {
      try { dynamicMetadata = JSON.parse(dynamicMetadataRaw) } catch { /* ignore */ }
    }

    if (!files || files.length === 0) throw new Error('No files provided')
    if (files.length > MAX_FILES) throw new Error(`Maximum ${MAX_FILES} files allowed per upload`)

    for (const file of files) {
      if (!(file instanceof File)) throw new Error('Invalid file format')
      if (file.size > MAX_FILE_SIZE) throw new Error(`File "${file.name}" exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
      if (!isAllowedFileType(file.name)) throw new Error(`File "${file.name}" has unsupported type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    if (!isValidMetadata(docType, MAX_METADATA_LENGTH)) throw new Error('docType too long')
    if (!isValidDate(uploadDate)) throw new Error('uploadDate must be YYYY-MM-DD')
    if (!isValidMetadata(site, MAX_METADATA_LENGTH)) throw new Error('site too long')
    if (!isValidMetadata(equipmentType, MAX_METADATA_LENGTH)) throw new Error('equipmentType too long')
    if (!isValidMetadata(equipmentMake, MAX_METADATA_LENGTH)) throw new Error('equipmentMake too long')
    if (!isValidMetadata(equipmentModel, MAX_METADATA_LENGTH)) throw new Error('equipmentModel too long')

    const sanitizedDocType = sanitizeMetadata(docType) || 'unknown'
    const sanitizedUploadDate = sanitizeMetadata(uploadDate)
    const sanitizedSite = sanitizeMetadata(site)
    const sanitizedEquipmentType = sanitizeMetadata(equipmentType)
    const sanitizedEquipmentMake = sanitizeMetadata(equipmentMake)
    const sanitizedEquipmentModel = sanitizeMetadata(equipmentModel)
    
    let allowedRoles: string[] = ['admin']
    if (allowedRolesRaw && typeof allowedRolesRaw === 'string') {
      try {
        const parsed = JSON.parse(allowedRolesRaw)
        if (Array.isArray(parsed) && parsed.every(r => typeof r === 'string')) allowedRoles = parsed
      } catch { /* ignore */ }
    }

    console.log(`Processing ${files.length} files`)

    const documents: { id: string; fileName: string; status: string }[] = []

    const fileDataList: { name: string; arrayBuffer: ArrayBuffer; fileType: string }[] = []
    for (const file of files) {
      fileDataList.push({
        name: file.name,
        arrayBuffer: await file.arrayBuffer(),
        fileType: getFileExtension(file.name),
      })
    }

    for (const fileData of fileDataList) {
      const docId = crypto.randomUUID()
      const { error: docError } = await supabase
        .from('documents')
        .insert({
          id: docId,
          filename: fileData.name.slice(0, 500),
          doc_type: sanitizedDocType,
          upload_date: sanitizedUploadDate || null,
          site: sanitizedSite || null,
          equipment_make: sanitizedEquipmentMake || null,
          equipment_model: sanitizedEquipmentModel || null,
          page_count: 0,
          total_chunks: 0,
          ingested_chunks: 0,
          ingestion_status: 'in_progress',
          allowed_roles: allowedRoles,
          project_id: projectIdRaw ? String(projectIdRaw) : null,
          metadata: dynamicMetadata,
        })

      if (docError) {
        console.error(`Failed to create document record for ${fileData.name}:`, docError)
        continue
      }
      documents.push({ id: docId, fileName: fileData.name, status: 'in_progress' })
    }

    // Background processing
    const backgroundWork = (async () => {
      // Pick API key based on tier
      const googleApiKey = apiTier === 'paid'
        ? (Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_API_KEY_FREE'))
        : (Deno.env.get('GOOGLE_API_KEY_FREE') || Deno.env.get('GOOGLE_API_KEY'))

      const processFile = async (fileData: typeof fileDataList[0], doc: typeof documents[0]) => {
        try {
          let extractedText = ''
          let pageCount = 0

          switch (fileData.fileType) {
            case 'txt':
              extractedText = new TextDecoder('utf-8').decode(fileData.arrayBuffer)
              pageCount = 1
              break
            case 'pdf':
              const pdfResult = await extractTextFromPdf(fileData.arrayBuffer, googleApiKey)
              extractedText = pdfResult.text
              pageCount = pdfResult.pageCount
              break
            case 'docx':
              extractedText = await extractTextFromDocx(fileData.arrayBuffer)
              pageCount = Math.ceil(extractedText.length / 3000)
              break
            default:
              throw new Error(`Unsupported file type: ${fileData.fileType}`)
          }

          console.log(`Extracted ${extractedText.length} chars, ${pageCount} pages from ${fileData.name}`)

          const chunkSize = 800
          const overlapSize = 200
          const chunks: { document_id: string; chunk_index: number; text: string; equipment: string | null }[] = []
          let chunkIndex = 0
          
          for (let j = 0; j < extractedText.length; j += (chunkSize - overlapSize)) {
            const chunkText = extractedText.slice(j, j + chunkSize)
            if (chunkText.trim().length > 0) {
              chunks.push({
                document_id: doc.id,
                chunk_index: chunkIndex++,
                text: chunkText,
                equipment: sanitizedEquipmentType || null,
              })
            }
          }

          await supabase
            .from('documents')
            .update({ page_count: pageCount, total_chunks: chunks.length, ingested_chunks: 0 })
            .eq('id', doc.id)

          const CHUNK_BATCH = 50
          for (let j = 0; j < chunks.length; j += CHUNK_BATCH) {
            const batch = chunks.slice(j, j + CHUNK_BATCH)
            const { error: chunksError } = await supabase.from('chunks').insert(batch)
            if (chunksError) throw chunksError
          }

          await supabase
            .from('documents')
            .update({ ingested_chunks: chunks.length, ingestion_status: 'processing_embeddings' })
            .eq('id', doc.id)

          console.log(`Chunks saved for ${fileData.name}, triggering embeddings...`)
        } catch (err) {
          console.error(`Error processing ${fileData.name}:`, err)
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          await supabase
            .from('documents')
            .update({ ingestion_status: 'failed', ingestion_error: errorMsg.slice(0, 1000) })
            .eq('id', doc.id)
        }
      }

      // Phase 1: Extract + chunk all files in parallel
      await Promise.allSettled(
        fileDataList.map((fileData, i) => {
          const doc = documents[i]
          if (!doc) return Promise.resolve()
          return processFile(fileData, doc)
        })
      )

      // Phase 2: Trigger embeddings for ALL documents in parallel
      console.log(`All chunking complete. Triggering embeddings for ${documents.length} documents in parallel...`)
      await Promise.allSettled(
        documents.map(async (doc) => {
          try {
            console.log(`Triggering embeddings for document ${doc.id} (${doc.fileName})...`)
            const embRes = await fetch(
              `${supabaseUrl}/functions/v1/generate-embeddings`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': authHeader!,
                  'apikey': supabaseAnonKey,
                },
                body: JSON.stringify({ documentId: doc.id, mode: 'full' }),
              }
            )
            if (!embRes.ok) {
              console.error(`Embeddings failed for ${doc.id}: ${embRes.status}`)
            } else {
              console.log(`Embeddings complete for ${doc.id}`)
            }
            await embRes.text()
          } catch (err) {
            console.error(`Embedding error for ${doc.id}:`, err)
          }
        })
      )
    })()

    ;(globalThis as any).EdgeRuntime?.waitUntil?.(backgroundWork)

    return new Response(
      JSON.stringify({ success: true, documents }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in ingest:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Document processing failed. Please try again.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function extractTextFromPdf(arrayBuffer: ArrayBuffer, googleApiKey?: string | null): Promise<{ text: string; pageCount: number }> {
  const { getDocument } = await import('https://esm.sh/pdfjs-serverless@0.2.2')
  const uint8Array = new Uint8Array(arrayBuffer)
  
  const document = await getDocument({ data: uint8Array, useSystemFonts: true }).promise
  const pageCount = document.numPages

  const pageTexts: string[] = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await document.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map((item: any) => item.str).join(' ')
    pageTexts.push(pageText)
  }

  let rawText = pageTexts.join('\n\n')
  rawText = rawText.replace(/\s+/g, ' ').trim()

  // Check text quality
  const words = rawText.split(/\s+/)
  const commonShortWords = new Set(['a','an','the','is','in','on','to','of','it','or','as','at','by','if','no','so','up','we','do','be','he','me','my','us','am','go','oh','ok','vs','id','dc','ac'])
  const singleCharWords = words.filter(w => w.length === 1 && /[a-zA-Z]/.test(w)).length
  const shortFragments = words.filter(w => w.length <= 3 && /^[a-zA-Z]+$/.test(w) && !commonShortWords.has(w.toLowerCase())).length
  const singleCharRatio = words.length > 0 ? singleCharWords / words.length : 0
  const shortFragRatio = words.length > 0 ? shortFragments / words.length : 0
  const isGarbled = singleCharRatio > 0.10 || shortFragRatio > 0.15 || rawText.length < 50

  if (!isGarbled) {
    console.log(`PDF text quality OK (single-char: ${(singleCharRatio * 100).toFixed(1)}%, short-frag: ${(shortFragRatio * 100).toFixed(1)}%)`)
    return { text: rawText, pageCount }
  }

  console.log(`PDF text garbled (single-char: ${(singleCharRatio * 100).toFixed(1)}%, short-frag: ${(shortFragRatio * 100).toFixed(1)}%). Sending to Google API for cleaning.`)

  if (!googleApiKey) {
    console.warn('GOOGLE_API_KEY not set — regex normalization only')
    return { text: applyRegexNormalization(pageTexts), pageCount }
  }

  try {
    const cleanedText = await cleanGarbledText(pageTexts, googleApiKey)
    if (cleanedText && cleanedText.length > 50) {
      console.log(`Google AI cleaned text: ${cleanedText.length} characters`)
      return { text: cleanedText, pageCount }
    }
  } catch (err) {
    console.error('Google AI text cleanup failed:', err)
  }

  return { text: applyRegexNormalization(pageTexts), pageCount }
}

function applyRegexNormalization(pageTexts: string[]): string {
  let text = pageTexts.join('\n\n')
  text = text.replace(/\b([A-Za-z])\s+(?=[A-Za-z]\s+[A-Za-z])/g, (_match, char) => char)
  text = text.replace(/(?<=[A-Za-z])\s(?=[A-Za-z](?:\s[A-Za-z])+\b)/g, '')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

async function cleanGarbledText(pageTexts: string[], googleApiKey: string): Promise<string> {
  const BATCH_SIZE = 15
  const batches: string[][] = []
  for (let i = 0; i < pageTexts.length; i += BATCH_SIZE) {
    batches.push(pageTexts.slice(i, i + BATCH_SIZE))
  }
  console.log(`Cleaning ${pageTexts.length} pages in ${batches.length} batches via Google API`)

  // Clean all batches in parallel (paid tier handles concurrency)
  const cleanedParts = await Promise.all(
    batches.map(async (batch, b) => {
      const batchText = batch.map((t, idx) => `--- PAGE ${b * BATCH_SIZE + idx + 1} ---\n${t}`).join('\n\n')
      console.log(`Google AI batch ${b + 1}/${batches.length}: ${batchText.length} chars`)

      try {
        const cleaned = await callGeminiForCleaning(
          `The following text was extracted from a PDF but has broken word spacing (e.g., "Ins ulat ed glov es" should be "Insulated gloves"). Fix ONLY the broken spacing. Preserve numbers, codes, tables. Return ONLY the corrected text.\n\n${batchText}`,
          googleApiKey
        )
        if (cleaned) {
          console.log(`Batch ${b + 1} cleaned: ${cleaned.length} chars`)
          return cleaned
        }
        console.warn(`Batch ${b + 1} returned empty, using regex fallback`)
        return applyRegexNormalization(batch)
      } catch (err) {
        console.error(`Batch ${b + 1} error:`, err)
        return applyRegexNormalization(batch)
      }
    })
  )

  const fullCleaned = cleanedParts.join('\n\n')
  console.log(`Google AI total cleaned: ${fullCleaned.length} chars from ${batches.length} batches`)
  return fullCleaned
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('https://esm.sh/mammoth@1.6.0')
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
    .replace(/\x00/g, '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
