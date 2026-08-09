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

PRIORITY 1 — CHARACTER-LEVEL ODIA SPELLING CHECK (this is the most commonly missed error type — check with extreme care):
Go through the submitted text WORD BY WORD. For each Odia word, mentally spell it out character by character and ask: "Is this the exact correct spelling of this word, with no extra, missing, or wrong character/matra (vowel sign)?"
This includes catching subtle single-character errors such as:
- An extra vowel sign or consonant added to an otherwise correct word (example pattern: a correct word like ଟିସୁ being wrongly written as ଟିସୁଆ or ଟିସୁକ — these look almost identical to the correct word but are NOT real Odia words)
- A missing case-marker matra that changes grammar (example pattern: ଉଦ୍ଭିଦକୁ ("to the plant") wrongly written as ଉଦ୍ଭିଦକ, which drops the ୁ matra and changes/breaks the meaning)
- Swapped, doubled, or dropped consonants or vowel signs anywhere in a word
Do NOT rely on "does this word look roughly familiar in context" — actively compare each word's exact character sequence against what you know is the correct Odia spelling, and against how the same or similar words appear in the SOURCE CHAPTER TEXT if present there. A single extra or missing character makes a word WRONG even if the rest of the sentence still makes sense.

PRIORITY 2 — ODIA LANGUAGE COMPREHENSIBILITY (word by word):
Beyond pure spelling, also flag:
- Garbled, malformed, or corrupted character sequences that are not real Odia words at all
- Words that are a different real word than intended, changing the meaning
- Sentences that do not grammatically parse as valid Odia
Do NOT pass a word just because it looks visually similar to a correct word or is in the right position in the sentence. When in doubt, treat it as a FAIL, not a PASS.

PRIORITY 3 — Factual accuracy vs the source chapter text (no invented facts, no contradictions).
PRIORITY 4 — Correct answers (for MCQs, true/false, fill-in-blanks, matching — is the marked "correct" answer actually correct?).
PRIORITY 5 — Content that is empty, repeated, or clearly a placeholder.
PRIORITY 6 — Anything else a Class 9 student would find confusing or misleading.

If ANY Priority 1 or Priority 2 issue is found, the verdict MUST be "FAIL" regardless of how minor it seems — even a single extra or missing character in one word must cause a FAIL.

For EVERY issue you find (any priority), you MUST provide a "wrong" and "correct" pair so it can be auto-fixed:
- "wrong": the EXACT substring as it appears in WORKER-SUBMITTED CONTENT (copy it character-for-character, so it can be found with an exact text match).
- "correct": the exact replacement text that should be substituted in.
- "reason": a short explanation of why it's wrong.
If an issue cannot be expressed as a simple wrong→correct text substitution, still include it but set "wrong" and "correct" to empty strings "" and put the full explanation in "reason".

Respond ONLY with strict JSON, nothing else, in this exact shape:
{"verdict":"PASS" or "FAIL","issues":[{"wrong":"exact wrong text","correct":"exact correct text","reason":"short reason"}],"confidence":"high"|"medium"|"low"}`;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
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
      issues: [{ wrong: "", correct: "", reason: "AI check could not run — please review this manually." }],
      confidence: "low"
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}
