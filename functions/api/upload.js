async function getAccessToken(env) {
  const email = env.FIREBASE_CLIENT_EMAIL;
  const key = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const signingInput = b64url(header) + '.' + b64url(claim);
  const pemBody = key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const jwt = signingInput + '.' + sigB64;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  const data = await res.json();
  return data.access_token;
}

async function getFirestoreDoc(env, token, path) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/evidya-academy/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const key = formData.get('key');
    const workerCode = formData.get('workerCode');
    const jobId = formData.get('jobId');

    if (!file || !key || !workerCode || !jobId) {
      return new Response(JSON.stringify({ error: 'Missing file, key, workerCode or jobId' }), { status: 400 });
    }

    const token = await getAccessToken(env);

    const workerDoc = await getFirestoreDoc(env, token, `workers/${workerCode}`);
    if (!workerDoc || !workerDoc.fields || workerDoc.fields.status?.stringValue === 'BLOCKED') {
      return new Response(JSON.stringify({ error: 'Invalid or blocked worker code' }), { status: 403 });
    }

    const jobDoc = await getFirestoreDoc(env, token, `jobs/${jobId}`);
    if (!jobDoc || !jobDoc.fields) {
      return new Response(JSON.stringify({ error: 'Job not found' }), { status: 403 });
    }
    const jobAssignedWorker = jobDoc.fields.assignedWorker?.stringValue;
    const jobR2Key = jobDoc.fields.r2Key?.stringValue;
    const jobStatus = jobDoc.fields.status?.stringValue;

    if (jobAssignedWorker !== workerCode) {
      return new Response(JSON.stringify({ error: 'This job is not assigned to you' }), { status: 403 });
    }
    if (jobR2Key !== key) {
      return new Response(JSON.stringify({ error: 'File key does not match this job' }), { status: 403 });
    }
    if (jobStatus !== 'open' && jobStatus !== 'rejected') {
      return new Response(JSON.stringify({ error: 'This job is not open for upload' }), { status: 403 });
    }

    const MAX_SIZE = 150 * 1024 * 1024;
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
