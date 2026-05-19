import type { Config } from '@netlify/functions'

// CRUD operations for DM automation materials
export default async (req: Request) => {
  const url = new URL(req.url)
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: '서버 설정 오류' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  // GET - List materials for a user
  if (req.method === 'GET') {
    const userId = url.searchParams.get('user_id')
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const res = await fetch(
      `${supabaseUrl}/rest/v1/dm_materials?user_id=eq.${userId}&order=created_at.desc`,
      { headers }
    )
    const data = await res.json()

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // POST - Create or update a material
  if (req.method === 'POST') {
    const body = await req.json()
    const { id, user_id, name, status, keywords, exclude_keywords, post_condition, scheduled_send, message_type, message_content, dm_keyword, dm_body_template, send_condition } = body

    if (!user_id || !name) {
      return new Response(JSON.stringify({ error: 'user_id와 name이 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const record = {
      user_id,
      name,
      status: status || 'draft',
      keywords: keywords || [],
      exclude_keywords: exclude_keywords || [],
      post_condition: post_condition || 'all',
      send_condition: send_condition || 'all',
      scheduled_send: scheduled_send || false,
      message_type: message_type || 'text',
      message_content: message_content || '',
      dm_keyword: dm_keyword || '',
      dm_body_template: dm_body_template || '',
      updated_at: new Date().toISOString(),
    }

    let res: Response
    if (id) {
      // Update
      res = await fetch(
        `${supabaseUrl}/rest/v1/dm_materials?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify(record),
        }
      )
    } else {
      // Create
      res = await fetch(
        `${supabaseUrl}/rest/v1/dm_materials`,
        {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=representation' },
          body: JSON.stringify({ ...record, created_at: new Date().toISOString() }),
        }
      )
    }

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      status: id ? 200 : 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // DELETE - Remove a material
  if (req.method === 'DELETE') {
    const materialId = url.searchParams.get('id')
    if (!materialId) {
      return new Response(JSON.stringify({ error: 'id가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    await fetch(`${supabaseUrl}/rest/v1/dm_materials?id=eq.${materialId}`, {
      method: 'DELETE',
      headers,
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  })
}

export const config: Config = {
  path: '/api/dm-materials'
}
