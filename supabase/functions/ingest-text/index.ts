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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Verify the user's JWT token via direct API call
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey,
      },
    })

    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const user = await userRes.json()
    if (!user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check permission
    const { data: hasPermission } = await supabase.rpc('has_permission', { p_tab: 'repository', p_action: 'write', p_user_id: user.id })
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { documentId, documentName, content, docType, site, equipmentType, equipmentMake, equipmentModel, allowedRoles, projectId, dynamicMetadata, isUpdate } = await req.json()

    if (!documentName || !content || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Document name and content are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Ensure .docx extension
    const filename = documentName.endsWith('.docx') ? documentName : `${documentName}.docx`

    let docId: string

    if (isUpdate && documentId) {
      // Update existing document
      docId = documentId
      await supabase.from('chunks').delete().eq('document_id', docId)
      const { error: updateError } = await supabase.from('documents').update({
        filename,
        ingestion_status: 'in_progress',
        ingestion_error: null,
        total_chunks: 0,
        ingested_chunks: 0,
        page_count: Math.ceil(content.length / 3000) || 1,
      }).eq('id', docId)
      if (updateError) throw updateError
    } else {
      // Create new document
      docId = crypto.randomUUID()
      const { error: docError } = await supabase.from('documents').insert({
        id: docId,
        filename,
        doc_type: docType || 'unknown',
        upload_date: new Date().toISOString().split('T')[0],
        site: site || null,
        equipment_make: equipmentMake || null,
        equipment_model: equipmentModel || null,
        page_count: Math.ceil(content.length / 3000) || 1,
        total_chunks: 0,
        ingested_chunks: 0,
        ingestion_status: 'in_progress',
        allowed_roles: allowedRoles || ['all'],
        project_id: projectId || null,
        metadata: dynamicMetadata || {},
      })
      if (docError) throw docError
    }

    // Background processing
    const backgroundWork = (async () => {
      try {
        const chunkSize = 800
        const overlapSize = 200
        const chunks: { document_id: string; chunk_index: number; text: string; equipment: string | null }[] = []
        let chunkIndex = 0

        for (let j = 0; j < content.length; j += (chunkSize - overlapSize)) {
          const chunkText = content.slice(j, j + chunkSize)
          if (chunkText.trim().length > 0) {
            chunks.push({
              document_id: docId,
              chunk_index: chunkIndex++,
              text: chunkText,
              equipment: equipmentType || null,
            })
          }
        }

        await supabase.from('documents').update({ total_chunks: chunks.length }).eq('id', docId)

        const BATCH = 50
        for (let j = 0; j < chunks.length; j += BATCH) {
          const { error } = await supabase.from('chunks').insert(chunks.slice(j, j + BATCH))
          if (error) throw error
        }

        await supabase.from('documents').update({ ingested_chunks: 0, ingestion_status: 'processing_embeddings' }).eq('id', docId)

        // Trigger embeddings
        const embRes = await fetch(`${supabaseUrl}/functions/v1/generate-embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': authHeader!, 'apikey': supabaseAnonKey },
          body: JSON.stringify({ documentId: docId, mode: 'full' }),
        })
        await embRes.text()
      } catch (err) {
        console.error('Text ingestion error:', err)
        const msg = err instanceof Error ? err.message : 'Unknown error'
        await supabase.from('documents').update({ ingestion_status: 'failed', ingestion_error: msg.slice(0, 1000) }).eq('id', docId)
      }
    })()

    ;(globalThis as any).EdgeRuntime?.waitUntil?.(backgroundWork)

    return new Response(
      JSON.stringify({ success: true, document: { id: docId, fileName: filename, status: 'in_progress' } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in ingest-text:', error)
    return new Response(
      JSON.stringify({ error: 'Text ingestion failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
