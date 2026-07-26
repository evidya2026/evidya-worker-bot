export async function onRequestPost({ request, env }) {
  const { fileType, sourceText, submittedText } = await request.json();

  const prompt = `You are a strict content quality checker for a school study app for Class 9 students in Odisha, India. 
The material is written mostly in Odia language content wrapped in JavaScript data structures.

SOURCE CHAPTER TEXT (the ground truth the content must be based on):
"""
${sourceText || "(not provided)"}
"""

FILE TYPE: ${fileType}

WORKER-SUBMITTED CONTENT TO CHECK:
"""
${submittedText}
"""

Check for:
1. Factual accuracy vs the source chapter text (no invented facts, no contradictions).
2. Correct answers (for MCQs, true/false, fill-in-blanks, matching — is the marked "correct" answer actually correct?).
3. Odia language errors, gibberish, or garbled/broken text.
4. Content that is empty, repeated, or clearly a placeholder.
5. Anything a Class 9 student would find confusing or misleading.

Respond ONLY with strict JSON, nothing else, in this exact shape:
{"verdict":"PASS" or "FAIL","issues":["short issue 1","short issue 2"],"confidence":"high"|"medium"|"low"}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        })
      }
    );

const data = await geminiRes.json();
    if (!data.candidates) {
      throw new Error("Gemini raw reply: " + JSON.stringify(data));
    }
    const raw = data.candidates[0].content.parts[0].text;
    const verdict = JSON.parse(raw);

    return new Response(JSON.stringify({ success: true, ...verdict }), {
      headers: { 'Content-Type': 'application/json' }
    });
 } catch (err) {
    return new Response(JSON.stringify({
      success: true,
      verdict: "FAIL",
      issues: ["DEBUG ERROR: " + err.message],
      confidence: "low"
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}
