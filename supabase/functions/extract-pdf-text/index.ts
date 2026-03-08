import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
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

    console.log(`Extracting PDF text for user: ${user.id}`)
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      throw new Error('No file provided')
    }

    console.log(`Extracting text from PDF: ${file.name}, size: ${file.size} bytes`)

    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    // Use pdfjs-serverless for proper PDF parsing
    const { getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.0/pdfjs')
    const pdf = await getDocumentProxy(uint8Array)
    const pageCount = pdf.numPages

    // Extract text from all pages in parallel
    const pagePromises: Promise<string>[] = []
    for (let i = 1; i <= pageCount; i++) {
      pagePromises.push(
        pdf.getPage(i).then(async (page: any) => {
          const textContent = await page.getTextContent()
          return textContent.items
            .map((item: any) => item.str)
            .join(' ')
        })
      )
    }

    const pageTexts = await Promise.all(pagePromises)
    const text = pageTexts.join('\n\n')

    console.log(`Extracted ${text.length} characters from ${pageCount} pages`)

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
