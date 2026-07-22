export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const key = formData.get('key');

    if (!file || !key) {
      return new Response(JSON.stringify({ error: 'Missing file or key' }), { status: 400 });
    }

    const MAX_SIZE = 150 * 1024 * 1024; // 150 MB safety limit
    if (file.size > MAX_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 150MB)' }), { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    await env.EVIDYA_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });

    return new Response(JSON.stringify({ success: true, key }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
