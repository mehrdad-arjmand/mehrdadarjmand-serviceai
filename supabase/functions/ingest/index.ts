import { getDocument } from 'https://esm.sh/pdfjs-serverless@0.2.2'
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
  if (typeof value !== 'string') return true // Will be validated as string
  // Basic ISO date format check (YYYY-MM-DD)
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

    // Verify the user's JWT token using getUser
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Authenticated user: ${user.id}`)

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

    // Validate file count
    if (!files || files.length === 0) {
      throw new Error('No files provided')
    }
    if (files.length > MAX_FILES) {
      throw new Error(`Maximum ${MAX_FILES} files allowed per upload`)
    }

    // Validate each file
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

    // Validate metadata
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

    // Sanitize metadata
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
            const pdfResult = await extractTextFromPdf(arrayBuffer)
            extractedText = pdfResult.text
            pageCount = pdfResult.pageCount
            break
          case 'docx':
            extractedText = await extractTextFromDocx(arrayBuffer)
            pageCount = Math.ceil(extractedText.length / 3000) // Estimate
            break
          default:
            throw new Error(`Unsupported file type: ${fileType}`)
        }

        console.log(`Extracted ${extractedText.length} characters, ${pageCount} pages from ${file.name}`)
        
        // Split text into chunks FIRST to know total_chunks
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

        // Save document to database with total_chunks known upfront
        const { error: docError } = await supabase
          .from('documents')
          .insert({
            id: docId,
            filename: file.name.slice(0, 500), // Limit filename length
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

        // Save all chunks WITHOUT embeddings
        if (chunks.length > 0) {
          const CHUNK_BATCH = 50
          for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
            const batch = chunks.slice(i, i + CHUNK_BATCH)
            const { error: chunksError } = await supabase.from('chunks').insert(batch)
            if (chunksError) throw chunksError
          }

          // Update ingested_chunks to reflect all chunks are stored (but not yet embedded)
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
            ingestion_error: error.slice(0, 1000) // Limit error message length
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

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const uint8Array = new Uint8Array(arrayBuffer)
  const document = await getDocument({ data: uint8Array, useSystemFonts: true }).promise
  
  const textParts: string[] = []
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i)
    const content = await page.getTextContent()
    // Join items with proper spacing consideration
    const pageText = content.items.map((item: any) => item.str).join(' ')
    textParts.push(pageText)
  }
  
  // Normalize text: fix broken character spacing (e.g., "T i a n j i n" -> "Tianjin")
  let text = textParts.join('\n\n')
  
  // Fix single-character spacing pattern (common in PDF table extraction)
  // Match sequences where single letters are separated by single spaces
  text = text.replace(/\b([A-Za-z])\s+(?=[A-Za-z]\s+[A-Za-z])/g, (match, char) => {
    return char
  })
  // Additional pass to clean remaining single-char spaces
  text = text.replace(/(?<=[A-Za-z])\s(?=[A-Za-z](?:\s[A-Za-z])+\b)/g, '')
  
  // Final cleanup
  text = text.replace(/\s+/g, ' ').trim()
  
  return {
    text,
    pageCount: document.numPages
  }
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
