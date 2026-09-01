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

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacRaw(key, msg) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
}
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }

async function r2Sign({ method, accountId, accessKeyId, secretAccessKey, bucket, key, body }) {
  const region = 'auto', service = 's3';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const bodyBytes = body || new Uint8Array(0);
  const payloadHash = await sha256Hex(bodyBytes);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmacRaw(new TextEncoder().encode('AWS4' + secretAccessKey), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  const kSigning = await hmacRaw(kService, 'aws4_request');
  const signature = hex(await hmacRaw(kSigning, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `https://${host}${canonicalUri}`,
    headers: { Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
  };
}

async function backupToSecondBucket(env, key, binary) {
  if (!env.R2_BACKUP_ACCOUNT_ID || !env.R2_BACKUP_ACCESS_KEY_ID || !env.R2_BACKUP_SECRET_ACCESS_KEY || !env.R2_BACKUP_BUCKET) return;
  try {
    const signed = await r2Sign({
      method: 'PUT',
      accountId: env.R2_BACKUP_ACCOUNT_ID,
      accessKeyId: env.R2_BACKUP_ACCESS_KEY_ID,
      secretAccessKey: env.R2_BACKUP_SECRET_ACCESS_KEY,
      bucket: env.R2_BACKUP_BUCKET,
      key,
      body: binary
    });
    await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: binary });
  } catch (e) {
    console.error('R2 backup upload failed (non-fatal):', e.message);
  }
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

    // Mirror this worker's upload into the second (backup) Cloudflare account's
    // bucket too, under the exact same key/folder path — never deleted from there.
    await backupToSecondBucket(env, key, new Uint8Array(arrayBuffer));

    return new Response(JSON.stringify({ success: true, key }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
