import { getDocument } from 'https://esm.sh/pdfjs-serverless@0.2.2'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const docType = formData.get('docType') as string
    const uploadDate = formData.get('uploadDate') as string
    const site = formData.get('site') as string
    const equipmentType = formData.get('equipmentType') as string
    const equipmentMake = formData.get('equipmentMake') as string
    const equipmentModel = formData.get('equipmentModel') as string

    if (!files || files.length === 0) {
      throw new Error('No files provided')
    }

    console.log(`Processing ${files.length} files`)

    const documents = []

    for (const file of files) {
      const docId = crypto.randomUUID()
      const fileType = getFileType(file.name)
      
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
        
        // Save document to database with pending status
        const { error: docError } = await supabase
          .from('documents')
          .insert({
            id: docId,
            filename: file.name,
            doc_type: docType || 'unknown',
            upload_date: uploadDate || null,
            site: site || null,
            equipment_make: equipmentMake || null,
            equipment_model: equipmentModel || null,
            page_count: pageCount,
            ingestion_status: 'pending',
            ingested_chunks: 0,
          })

        if (docError) throw docError

        // Split text into chunks
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
              equipment: equipmentType || null,
            })
          }
        }

        // Save all chunks WITHOUT embeddings first (fast)
        if (chunks.length > 0) {
          // Insert in batches to avoid payload limits
          const CHUNK_BATCH = 50
          for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
            const batch = chunks.slice(i, i + CHUNK_BATCH)
            const { error: chunksError } = await supabase.from('chunks').insert(batch)
            if (chunksError) throw chunksError
          }

          // Update status to show chunks are saved, embeddings pending
          await supabase
            .from('documents')
            .update({ 
              ingestion_status: 'processing_embeddings',
              ingested_chunks: chunks.length 
            })
            .eq('id', docId)
        }

        documents.push({
          id: docId,
          fileName: file.name,
          pageCount,
          chunkCount: chunks.length,
          status: 'chunks_saved'
        })

      } catch (err) {
        console.error(`Error processing ${file.name}:`, err)
        error = err instanceof Error ? err.message : 'Unknown error'
        
        await supabase
          .from('documents')
          .update({ 
            ingestion_status: 'failed',
            ingestion_error: error 
          })
          .eq('id', docId)

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

function getFileType(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() || 'unknown'
}

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
    const pageText = content.items.map((item: any) => item.str).join(' ')
    textParts.push(pageText)
  }
  
  return {
    text: textParts.join('\n\n').replace(/\s+/g, ' ').trim(),
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
