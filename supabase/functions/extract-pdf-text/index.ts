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

    // For MVP, we'll use a simple extraction approach
    // In production, you'd use a proper PDF parsing library
    const arrayBuffer = await file.arrayBuffer()
    const text = await extractTextFromPDF(arrayBuffer)

    console.log(`Extracted ${text.length} characters`)

    return new Response(
      JSON.stringify({ 
        success: true,
        text,
        filename: file.name
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

async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  // Simple text extraction - looks for text content in PDF
  const uint8Array = new Uint8Array(arrayBuffer)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text = decoder.decode(uint8Array)
  
  // Clean up PDF formatting
  text = text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
  
  return text
}