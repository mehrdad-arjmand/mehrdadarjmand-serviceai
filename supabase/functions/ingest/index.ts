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
    const equipmentType = formData.get('equipmentType') as string

    if (!files || files.length === 0) {
      throw new Error('No files provided')
    }

    console.log(`Processing ${files.length} files`)

    const documents = []

    for (const file of files) {
      const doc = {
        id: crypto.randomUUID(),
        fileName: file.name,
        fileType: getFileType(file.name),
        docType,
        equipmentType,
        createdAt: new Date().toISOString(),
        extractedText: '',
        textLength: 0,
        error: null as string | null,
      }

      try {
        const arrayBuffer = await file.arrayBuffer()
        
        switch (doc.fileType) {
          case 'txt':
            doc.extractedText = await extractTextFromTxt(arrayBuffer)
            break
          case 'pdf':
            doc.extractedText = await extractTextFromPdf(arrayBuffer)
            break
          case 'docx':
            doc.extractedText = await extractTextFromDocx(arrayBuffer)
            break
          default:
            throw new Error(`Unsupported file type: ${doc.fileType}`)
        }

        doc.textLength = doc.extractedText.length
        console.log(`Extracted ${doc.textLength} characters from ${doc.fileName}`)
        
        // Save to database
        const { data: docData, error: docError } = await supabase
          .from('documents')
          .insert({
            id: doc.id,
            filename: doc.fileName,
            doc_type: docType || 'unknown',
          })
          .select()
          .single()

        if (docError) {
          throw docError
        }

        // Split text into chunks (simple: ~1000 chars per chunk)
        const chunkSize = 1000
        const chunks = []
        for (let i = 0; i < doc.extractedText.length; i += chunkSize) {
          chunks.push({
            document_id: doc.id,
            chunk_index: Math.floor(i / chunkSize),
            text: doc.extractedText.slice(i, i + chunkSize),
            equipment: equipmentType || null,
          })
        }

        // Save chunks and generate embeddings
        if (chunks.length > 0) {
          const { data: insertedChunks, error: chunksError } = await supabase
            .from('chunks')
            .insert(chunks)
            .select()

          if (chunksError) {
            throw chunksError
          }

          // Generate embeddings for all chunks
          console.log(`Generating embeddings for ${insertedChunks.length} chunks`)
          const chunkTexts = insertedChunks.map(c => c.text)
          const embeddings = await generateEmbeddings(chunkTexts)

          // Update chunks with embeddings
          for (let i = 0; i < insertedChunks.length; i++) {
            const { error: updateError } = await supabase
              .from('chunks')
              .update({ embedding: embeddings[i] })
              .eq('id', insertedChunks[i].id)

            if (updateError) {
              console.error(`Failed to update embedding for chunk ${i}:`, updateError)
            }
          }
          console.log(`Successfully generated embeddings for ${doc.fileName}`)
        }

      } catch (error) {
        console.error(`Error extracting text from ${doc.fileName}:`, error)
        doc.error = error instanceof Error ? error.message : 'Unknown error'
      }

      documents.push(doc)
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        documents 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error in ingest:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ 
        success: false,
        error: message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

function getFileType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext || 'unknown'
}

async function extractTextFromTxt(arrayBuffer: ArrayBuffer): Promise<string> {
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(arrayBuffer)
}

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Use pdfjs-serverless for proper PDF text extraction
    const document = await getDocument({
      data: uint8Array,
      useSystemFonts: true,
    }).promise
    
    const textParts: string[] = []
    
    // Iterate through each page and extract text
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ')
      textParts.push(pageText)
    }
    
    // Join all pages with newlines and clean up whitespace
    return textParts
      .join('\n\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100000) // Limit to 100k chars
  } catch (error) {
    console.error('PDF extraction error:', error)
    throw new Error(`Failed to extract PDF text: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // Import mammoth for proper DOCX parsing
    const mammoth = await import('https://esm.sh/mammoth@1.6.0')
    
    const result = await mammoth.extractRawText({ arrayBuffer })
    
    // Remove null bytes and other problematic characters
    const cleanedText = result.value
      .replace(/\x00/g, '') // Remove null bytes
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .slice(0, 100000) // Limit to 100k chars
    
    return cleanedText
  } catch (error) {
    console.error('DOCX extraction error:', error)
    throw new Error(`Failed to extract DOCX text: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured')
  }

  // Generate embeddings for each text using Google's API
  const embeddings: number[][] = []
  
  for (const text of texts) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text }]
          }
        })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to generate embedding: ${error}`)
    }

    const data = await response.json()
    embeddings.push(data.embedding.values)
  }

  return embeddings
}
