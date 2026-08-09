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

Check the submitted content against ALL of the following, in this priority order:

PRIORITY 1 — ODIA LANGUAGE COMPREHENSIBILITY (check this most carefully, word by word):
Read every single Odia word and sentence in the submitted content the way a Class 9 native Odia-speaking student would. For EACH word, ask: "Is this a real, correctly-spelled, meaningful Odia word that I would immediately understand?"
You MUST flag as an issue any of the following, even if only ONE word is affected:
- Garbled, malformed, or corrupted character sequences that are not real Odia words (e.g. missing or wrong matras/vowel signs that break the word)
- Words that look "close to" a correct word but are actually a different, wrong, or nonsensical word
- Sentences that do not grammatically parse as valid Odia
- Any word or phrase you cannot confidently state the meaning of
Do NOT pass a word just because it looks visually similar to a correct word or is in the right position in the sentence — it must be independently readable and meaningful on its own merit. When in doubt about whether a word is real Odia, treat it as a FAIL, not a PASS.
For every such word/phrase found, quote the exact broken text and state what you believe the correct word should be, based on context and the source chapter.

PRIORITY 2 — Factual accuracy vs the source chapter text (no invented facts, no contradictions).
PRIORITY 3 — Correct answers (for MCQs, true/false, fill-in-blanks, matching — is the marked "correct" answer actually correct?).
PRIORITY 4 — Content that is empty, repeated, or clearly a placeholder.
PRIORITY 5 — Anything else a Class 9 student would find confusing or misleading.

If ANY Priority 1 issue is found, the verdict MUST be "FAIL" regardless of how minor it seems — a student cannot learn from an unreadable or wrong word, even a single one.

Respond ONLY with strict JSON, nothing else, in this exact shape:
{"verdict":"PASS" or "FAIL","issues":["short issue 1 (quote the broken word/phrase and the suggested fix)","short issue 2"],"confidence":"high"|"medium"|"low"}`;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${env.GEMINI_API_KEY}`,
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
    const raw = data.candidates[0].content.parts[0].text;
    const verdict = JSON.parse(raw);
    return new Response(JSON.stringify({ success: true, ...verdict }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: true,
      verdict: "FAIL",
      issues: ["AI check could not run — please review this manually."],
      confidence: "low"
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}
