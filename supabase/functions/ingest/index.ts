const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
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
  // Simple PDF text extraction - looks for text content between stream markers
  const uint8Array = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text = decoder.decode(uint8Array)
  
  // Extract text from PDF streams and objects
  // This is a basic approach - production would use a proper PDF library
  text = text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ' ') // Remove control chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
  
  // Try to extract readable text chunks
  const readableText = text.match(/[A-Za-z0-9\s.,!?;:'"()-]{10,}/g)?.join(' ') || text
  
  return readableText.slice(0, 100000) // Limit to 100k chars
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // DOCX is a ZIP file containing XML files
  // For MVP, we'll do basic extraction by looking for text in the raw data
  const uint8Array = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const content = decoder.decode(uint8Array)
  
  // Look for text between XML tags (w:t elements in DOCX)
  const textMatches = content.match(/>([^<]+)</g)
  if (textMatches) {
    return textMatches
      .map(match => match.slice(1, -1)) // Remove >< markers
      .filter(text => text.trim().length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100000) // Limit to 100k chars
  }
  
  return content
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100000)
}
