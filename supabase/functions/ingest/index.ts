import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Validate JWT authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    
    const { data: { user }, error: authError } = await authClient.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Authenticated user: ${user.id}`)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check permission
    const { data: hasPermission, error: permError } = await supabase.rpc('has_permission', {
      p_tab: 'repository',
      p_action: 'write',
      p_user_id: user.id
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

    // Validate content-type
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

    // Validate file count
    if (!files || files.length === 0) throw new Error('No files provided')
    if (files.length > MAX_FILES) throw new Error(`Maximum ${MAX_FILES} files allowed per upload`)

    // Validate each file
    for (const file of files) {
      if (!(file instanceof File)) throw new Error('Invalid file format')
      if (file.size > MAX_FILE_SIZE) throw new Error(`File "${file.name}" exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
      if (!isAllowedFileType(file.name)) throw new Error(`File "${file.name}" has unsupported type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Validate metadata
    if (!isValidMetadata(docType, MAX_METADATA_LENGTH)) throw new Error('docType too long')
    if (!isValidDate(uploadDate)) throw new Error('uploadDate must be YYYY-MM-DD')
    if (!isValidMetadata(site, MAX_METADATA_LENGTH)) throw new Error('site too long')
    if (!isValidMetadata(equipmentType, MAX_METADATA_LENGTH)) throw new Error('equipmentType too long')
    if (!isValidMetadata(equipmentMake, MAX_METADATA_LENGTH)) throw new Error('equipmentMake too long')
    if (!isValidMetadata(equipmentModel, MAX_METADATA_LENGTH)) throw new Error('equipmentModel too long')

    // Sanitize metadata
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
        if (Array.isArray(parsed) && parsed.every(r => typeof r === 'string')) {
          allowedRoles = parsed
        }
      } catch {
        console.log('Invalid allowedRoles format, using default')
      }
    }

    console.log(`Processing ${files.length} files`)

    const documents = []

    // Read file data into memory BEFORE returning (we need it for background processing)
    const fileDataList: { name: string; arrayBuffer: ArrayBuffer; fileType: string }[] = []
    for (const file of files) {
      fileDataList.push({
        name: file.name,
        arrayBuffer: await file.arrayBuffer(),
        fileType: getFileExtension(file.name),
      })
    }

    // Create document records immediately (as "in_progress")
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
        })

      if (docError) {
        console.error(`Failed to create document record for ${fileData.name}:`, docError)
        continue
      }

      documents.push({ id: docId, fileName: fileData.name, status: 'in_progress' })
    }

    // Schedule ALL heavy processing in the background
    const backgroundWork = (async () => {
      for (let i = 0; i < fileDataList.length; i++) {
        const fileData = fileDataList[i]
        const doc = documents[i]
        if (!doc) continue

        try {
          let extractedText = ''
          let pageCount = 0

          switch (fileData.fileType) {
            case 'txt':
              extractedText = new TextDecoder('utf-8').decode(fileData.arrayBuffer)
              pageCount = 1
              break
            case 'pdf':
              const pdfResult = await extractTextFromPdf(fileData.arrayBuffer)
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

          // Chunk the text
          const chunkSize = 800
          const overlapSize = 200
          const chunks = []
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

          // Update document with page count and total chunks
          await supabase
            .from('documents')
            .update({ page_count: pageCount, total_chunks: chunks.length, ingested_chunks: 0 })
            .eq('id', doc.id)

          // Insert chunks in batches
          const CHUNK_BATCH = 50
          for (let j = 0; j < chunks.length; j += CHUNK_BATCH) {
            const batch = chunks.slice(j, j + CHUNK_BATCH)
            const { error: chunksError } = await supabase.from('chunks').insert(batch)
            if (chunksError) throw chunksError
          }

          // Update status
          await supabase
            .from('documents')
            .update({ ingested_chunks: chunks.length, ingestion_status: 'processing_embeddings' })
            .eq('id', doc.id)

          console.log(`Chunks saved for ${fileData.name}, triggering embeddings...`)

          // Trigger embedding generation
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
            console.error(`Embeddings trigger failed for ${doc.id}: ${embRes.status}`)
            await embRes.text() // consume body
          } else {
            console.log(`Embeddings triggered for ${doc.id}`)
            await embRes.text() // consume body
          }

        } catch (err) {
          console.error(`Error processing ${fileData.name}:`, err)
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          
          await supabase
            .from('documents')
            .update({ ingestion_status: 'failed', ingestion_error: errorMsg.slice(0, 1000) })
            .eq('id', doc.id)
        }
      }
    })()

    // Use EdgeRuntime.waitUntil to keep the worker alive for background processing
    ;(globalThis as any).EdgeRuntime?.waitUntil?.(backgroundWork)

    // Return IMMEDIATELY — client will see status updates via realtime subscription
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

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
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

  console.log(`PDF text garbled (single-char: ${(singleCharRatio * 100).toFixed(1)}%, short-frag: ${(shortFragRatio * 100).toFixed(1)}%). Sending to Gemini.`)

  const apiKey = Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) {
    console.warn('GOOGLE_API_KEY not set — regex normalization only')
    return { text: applyRegexNormalization(pageTexts), pageCount }
  }

  try {
    const cleanedText = await cleanGarbledTextWithGemini(pageTexts, apiKey)
    if (cleanedText && cleanedText.length > 50) {
      console.log(`Gemini cleaned text: ${cleanedText.length} characters`)
      return { text: cleanedText, pageCount }
    }
  } catch (err) {
    console.error('Gemini cleanup failed:', err)
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

async function cleanGarbledTextWithGemini(pageTexts: string[], apiKey: string): Promise<string> {
  const BATCH_SIZE = 15
  const batches: string[][] = []
  for (let i = 0; i < pageTexts.length; i += BATCH_SIZE) {
    batches.push(pageTexts.slice(i, i + BATCH_SIZE))
  }
  console.log(`Cleaning ${pageTexts.length} pages in ${batches.length} batches of up to ${BATCH_SIZE}`)

  const cleanedParts: string[] = []

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const batchText = batch.map((t, idx) => `--- PAGE ${b * BATCH_SIZE + idx + 1} ---\n${t}`).join('\n\n')
    console.log(`Gemini batch ${b + 1}/${batches.length}: ${batchText.length} chars`)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `The following text was extracted from a PDF but has broken word spacing (e.g., "Ins ulat ed glov es" should be "Insulated gloves"). Fix ONLY the broken spacing. Do NOT add, remove, summarize, or rephrase. Preserve numbers, codes, tables. Return ONLY the corrected text.\n\n${batchText}`
            }],
          }],
          generationConfig: { maxOutputTokens: 65536 },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const result = await response.json()
    const cleaned = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (cleaned) {
      cleanedParts.push(cleaned)
      console.log(`Batch ${b + 1} cleaned: ${cleaned.length} chars`)
    } else {
      console.warn(`Batch ${b + 1} returned empty, using regex fallback for these pages`)
      cleanedParts.push(applyRegexNormalization(batch))
    }
  }

  const fullCleaned = cleanedParts.join('\n\n')
  console.log(`Gemini total cleaned: ${fullCleaned.length} chars from ${batches.length} batches`)
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
