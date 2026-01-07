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
    const file = formData.get('file') as File

    if (!file) {
      throw new Error('No file provided')
    }

    console.log(`Extracting text from PDF: ${file.name}`)

    const arrayBuffer = await file.arrayBuffer()
    const { text, pageCount } = await extractTextFromPDF(arrayBuffer)

    console.log(`Extracted ${text.length} characters from approximately ${pageCount} pages`)

    return new Response(
      JSON.stringify({ 
        success: true,
        text,
        filename: file.name,
        pageCount
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    console.error('Error extracting PDF text:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ error: message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const uint8Array = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let rawText = decoder.decode(uint8Array)
  
  // Estimate page count by looking for PDF page markers
  // Common patterns: /Type /Page, /Count N (for page tree)
  const pageMatches = rawText.match(/\/Type\s*\/Page[^s]/g)
  const pageCount = pageMatches ? pageMatches.length : 1
  
  // Clean up PDF formatting
  const text = rawText
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
  
  return { text, pageCount }
}
