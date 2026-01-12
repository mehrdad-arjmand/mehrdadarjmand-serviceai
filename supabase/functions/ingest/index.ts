import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Input validation constants
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_FILES = 10
const MAX_METADATA_LENGTH = 500
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt']

// PDF processing limits to avoid CPU timeout
const MAX_PAGES_PER_REQUEST = 50 // Process max 50 pages at a time

// Validation helpers
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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

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

    if (!files || files.length === 0) {
      throw new Error('No files provided')
    }
    if (files.length > MAX_FILES) {
      throw new Error(`Maximum ${MAX_FILES} files allowed per upload`)
    }

    for (const file of files) {
      if (!(file instanceof File)) {
        throw new Error('Invalid file format')
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File "${file.name}" exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
      }
      if (!isAllowedFileType(file.name)) {
        throw new Error(`File "${file.name}" has unsupported type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
      }
    }

    if (!isValidMetadata(docType, MAX_METADATA_LENGTH)) {
      throw new Error(`docType exceeds maximum length of ${MAX_METADATA_LENGTH} characters`)
    }
    if (!isValidDate(uploadDate)) {
      throw new Error('uploadDate must be in YYYY-MM-DD format')
    }
    if (!isValidMetadata(site, MAX_METADATA_LENGTH)) {
      throw new Error(`site exceeds maximum length of ${MAX_METADATA_LENGTH} characters`)
    }
    if (!isValidMetadata(equipmentType, MAX_METADATA_LENGTH)) {
      throw new Error(`equipmentType exceeds maximum length of ${MAX_METADATA_LENGTH} characters`)
    }
    if (!isValidMetadata(equipmentMake, MAX_METADATA_LENGTH)) {
      throw new Error(`equipmentMake exceeds maximum length of ${MAX_METADATA_LENGTH} characters`)
    }
    if (!isValidMetadata(equipmentModel, MAX_METADATA_LENGTH)) {
      throw new Error(`equipmentModel exceeds maximum length of ${MAX_METADATA_LENGTH} characters`)
    }

    const sanitizedDocType = sanitizeMetadata(docType) || 'unknown'
    const sanitizedUploadDate = sanitizeMetadata(uploadDate)
    const sanitizedSite = sanitizeMetadata(site)
    const sanitizedEquipmentType = sanitizeMetadata(equipmentType)
    const sanitizedEquipmentMake = sanitizeMetadata(equipmentMake)
    const sanitizedEquipmentModel = sanitizeMetadata(equipmentModel)

    console.log(`Processing ${files.length} files`)

    const documents = []

    for (const file of files) {
      const docId = crypto.randomUUID()
      const fileType = getFileExtension(file.name)
      
      let extractedText = ''
      let pageCount = 0
      let error: string | null = null

      try {
        const arrayBuffer = await file.arrayBuffer()
        
        switch (fileType) {
          case 'txt':
            extractedText = await extractTextFromTxt(arrayBuffer)
            pageCount = 1
            break
          case 'pdf':
            // Use lightweight extraction for large PDFs to avoid CPU timeout
            const pdfResult = await extractTextFromPdfLightweight(arrayBuffer)
            extractedText = pdfResult.text
            pageCount = pdfResult.pageCount
            break
          case 'docx':
            extractedText = await extractTextFromDocx(arrayBuffer)
            pageCount = Math.ceil(extractedText.length / 3000)
            break
          default:
            throw new Error(`Unsupported file type: ${fileType}`)
        }

        console.log(`Extracted ${extractedText.length} characters, ${pageCount} pages from ${file.name}`)
        
        const chunkSize = 800
        const overlapSize = 200
        const chunks = []
        let chunkIndex = 0
        
        for (let i = 0; i < extractedText.length; i += (chunkSize - overlapSize)) {
          const chunkText = extractedText.slice(i, i + chunkSize)
          if (chunkText.trim().length > 0) {
            chunks.push({
              document_id: docId,
              chunk_index: chunkIndex++,
              text: chunkText,
              equipment: sanitizedEquipmentType || null,
            })
          }
        }

        const totalChunks = chunks.length

        const { error: docError } = await supabase
          .from('documents')
          .insert({
            id: docId,
            filename: file.name.slice(0, 500),
            doc_type: sanitizedDocType,
            upload_date: sanitizedUploadDate || null,
            site: sanitizedSite || null,
            equipment_make: sanitizedEquipmentMake || null,
            equipment_model: sanitizedEquipmentModel || null,
            page_count: pageCount,
            total_chunks: totalChunks,
            ingested_chunks: 0,
            ingestion_status: 'in_progress',
          })

        if (docError) throw docError

        if (chunks.length > 0) {
          const CHUNK_BATCH = 50
          for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
            const batch = chunks.slice(i, i + CHUNK_BATCH)
            const { error: chunksError } = await supabase.from('chunks').insert(batch)
            if (chunksError) throw chunksError
          }

          await supabase
            .from('documents')
            .update({ 
              ingested_chunks: totalChunks,
              ingestion_status: 'processing_embeddings'
            })
            .eq('id', docId)
        }

        documents.push({
          id: docId,
          fileName: file.name,
          pageCount,
          totalChunks,
          status: 'processing_embeddings'
        })

      } catch (err) {
        console.error(`Error processing ${file.name}:`, err)
        error = err instanceof Error ? err.message : 'Unknown error'
        
        await supabase
          .from('documents')
          .upsert({
            id: docId,
            filename: file.name.slice(0, 500),
            ingestion_status: 'failed',
            ingestion_error: error.slice(0, 1000)
          })

        documents.push({
          id: docId,
          fileName: file.name,
          error
        })
      }
    }

    return new Response(
      JSON.stringify({ success: true, documents }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in ingest:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function extractTextFromTxt(arrayBuffer: ArrayBuffer): Promise<string> {
  return new TextDecoder('utf-8').decode(arrayBuffer)
}

// Lightweight PDF extraction that doesn't use pdfjs-serverless page-by-page processing
// This avoids CPU timeout for large documents by using raw byte parsing
async function extractTextFromPdfLightweight(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const uint8Array = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const rawContent = decoder.decode(uint8Array)
  
  // Count pages from PDF structure
  const pageMatches = rawContent.match(/\/Type\s*\/Page[^s]/g)
  const pageCount = pageMatches ? pageMatches.length : 1
  
  // Extract text streams from PDF
  const textParts: string[] = []
  
  // Match text content between stream markers (common PDF structure)
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g
  let match
  while ((match = streamRegex.exec(rawContent)) !== null) {
    const streamContent = match[1]
    // Extract readable text (skip binary content)
    const textMatches = streamContent.match(/\(([^)]+)\)/g)
    if (textMatches) {
      for (const textMatch of textMatches) {
        const text = textMatch.slice(1, -1) // Remove parentheses
        if (text && /[a-zA-Z0-9]/.test(text)) {
          textParts.push(text)
        }
      }
    }
    // Also match Tj/TJ operators for text
    const tjMatches = streamContent.match(/\[([^\]]+)\]\s*TJ/g)
    if (tjMatches) {
      for (const tjMatch of tjMatches) {
        const innerText = tjMatch.match(/\(([^)]+)\)/g)
        if (innerText) {
          for (const t of innerText) {
            const cleaned = t.slice(1, -1)
            if (cleaned && /[a-zA-Z0-9]/.test(cleaned)) {
              textParts.push(cleaned)
            }
          }
        }
      }
    }
  }
  
  // Fallback: extract any readable ASCII sequences if streams didn't yield much
  if (textParts.join(' ').length < 1000) {
    // Find readable text patterns in the raw content
    const readableMatches = rawContent.match(/[A-Za-z][A-Za-z0-9\s.,;:!?'"()-]{10,}/g)
    if (readableMatches) {
      textParts.push(...readableMatches.filter(m => !m.includes('obj') && !m.includes('endobj')))
    }
  }
  
  // Clean up extracted text
  let text = textParts.join(' ')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\\n/g, ' ') // Handle escaped newlines
    .replace(/\\r/g, ' ')
    .trim()
  
  return { text, pageCount }
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
