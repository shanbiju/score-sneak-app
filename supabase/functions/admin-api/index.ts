const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REST_BASE = `${SUPABASE_URL}/rest/v1`;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function restRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers({
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  });

  if (init.headers) {
    const incoming = new Headers(init.headers);
    incoming.forEach((value, key) => headers.set(key, value));
  }

  const res = await fetch(`${REST_BASE}/${path}`, {
    ...init,
    headers,
  });

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getAdminPassword() {
  const data = (await restRequest(
    'admin_settings?key=eq.admin_password&select=value&limit=1',
    { method: 'GET' }
  )) as Array<{ value: string }> | null;

  return data?.[0]?.value ?? null;
}

async function upsertAdminSetting(key: string, value: string) {
  await restRequest('admin_settings', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        key,
        value,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse({ success: false, error: 'Server configuration missing' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { action, password } = body;

    if (action === 'verify') {
      const currentPassword = await getAdminPassword();
      const valid = currentPassword === password;
      return jsonResponse({ success: valid });
    }

    const currentPassword = await getAdminPassword();
    if (!currentPassword || currentPassword !== password) {
      return jsonResponse({ success: false, error: 'Invalid admin password' }, 401);
    }

    if (action === 'upload_timetable') {
      const { rows } = body as { rows?: Array<Record<string, string>> };

      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return jsonResponse({ success: false, error: 'No rows provided' }, 400);
      }

      await restRequest('exam_timetable?id=neq.00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      });

      await restRequest('exam_timetable', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(
          rows.map((r) => ({
            date: r.date,
            day: r.day || '',
            semester: r.semester,
            scheme: r.scheme || '2019',
            subject_code: r.subject_code || '',
            slot: r.slot || '',
            session: r.session || '',
          }))
        ),
      });

      return jsonResponse({ success: true, count: rows.length });
    }

    if (action === 'update_settings') {
      const { email, newPassword } = body as { email?: string; newPassword?: string };

      if (email !== undefined) {
        await upsertAdminSetting('admin_email', email);
      }

      if (newPassword) {
        await upsertAdminSetting('admin_password', newPassword);
      }

      return jsonResponse({ success: true });
    }

    if (action === 'add_announcement') {
      const { title, link, published_date } = body as { title: string; link?: string; published_date?: string };
      if (!title) return jsonResponse({ success: false, error: 'Title is required' }, 400);

      const res = await restRequest('admin_announcements', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ title, link, published_date: published_date || new Date().toISOString().split('T')[0] }]),
      });

      return jsonResponse({ success: true, data: res });
    }

    if (action === 'edit_announcement') {
      const { id, title, link, published_date } = body as { id: string; title: string; link?: string; published_date?: string };
      if (!id || !title) return jsonResponse({ success: false, error: 'ID and Title are required' }, 400);

      const res = await restRequest(`admin_announcements?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title, link, published_date }),
      });

      return jsonResponse({ success: true, data: res });
    }

    if (action === 'delete_announcement') {
      const { id } = body as { id: string };
      if (!id) return jsonResponse({ success: false, error: 'ID is required' }, 400);

      await restRequest(`admin_announcements?id=eq.${id}`, {
        method: 'DELETE',
      });

      return jsonResponse({ success: true });
    }

    if (action === 'run_sql') {
      const { sql } = body as { sql: string };

      if (!sql) {
        return jsonResponse({ success: false, error: 'No SQL provided' }, 400);
      }

      // Execute SQL using the Postgres REST interface (requires RPC or service role bypass)
      // Since there's no direct SQL execution via REST without pg_graphql or rpc, 
      // we'll create the tables and policies using standard REST endpoints if possible, 
      // or we just define a temp RPC function.
      return jsonResponse({ success: false, error: 'SQL execution not supported via REST directly yet' }, 501);
    }

    if (action === 'get_settings') {
      const data = (await restRequest('admin_settings?select=key,value', {
        method: 'GET',
      })) as Array<{ key: string; value: string }> | null;

      const settings: Record<string, string> = {};
      for (const row of data || []) {
        if (row.key !== 'admin_password') settings[row.key] = row.value;
      }

      return jsonResponse({ success: true, settings });
    }

    return jsonResponse({ success: false, error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('Admin API error:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : 'Server error' },
      500
    );
  }
});
