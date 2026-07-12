/**
 * Craft exemplars and named hook formulas ported from the imagine
 * content-writer prompt (v0.4, imagine-ai-inc deprecated in-app pipeline).
 * Principles with annotated illustrations, NOT copy templates: generation
 * must adapt the structure and never reuse the stories, names, or numbers.
 */

export const POST_CRAFT_PRINCIPLES = `POST CRAFT (principles distilled from top-performing posts - internalize the structure, NEVER copy the stories, names, or numbers):

1. Precise hook: a striking number, known name, or provocative question in line one. "Have you ever watched $40M+ burn right in front of you?" works because it is dramatic, visual, and specific.
2. Curiosity gap with payoff: the hook creates tension, the body must resolve it fully. Tension without payoff is forbidden.
3. Micro-story arc: hook, then conflict or journey, then resolution. Walk the reader through stages and land on one shift.
4. Quantified contrast: show change with numbers, not adjectives. "40% win rate before, 70% after" beats "it improved".
5. Borrowed authority: a direct quote from an investor, customer, or expert validates a point better than self-assertion. Only quote people and words that appear in the brief or context.
6. Actionable takeaway: leave the reader a checklist, framework, or steps they can use today. Value is utility.
7. Effortless scanning: white space and signposting so the core message lands in seconds on a phone.
8. Ground in a universal emotion: insecurity, ambition, fear of falling behind. Logic persuades, emotion connects.
9. Concrete and sensory over abstract: not "an insane work ethic" but "He worked Christmas. He worked New Year's. He worked Thanksgiving."
10. Close with an open question that asks for the reader's own story, never a yes/no.
11. Transferable lesson: the anecdote is the vehicle, the timeless principle is the destination. The reader should keep the lesson long after forgetting the story.`;

export const HOOK_FORMULAS = `HOOK FORMULAS (pick the ONE that fits the topic and the audience's real pain point; first line only, under 200 characters):
- Problem-Solution: name a specific pain point, promise the fix.
- Question: a pointed question aimed at a documented frustration or aspiration.
- Statistic: a surprisingly high or low number taken from the brief or context. Never invent one.
- Contrarian: challenge a belief the audience holds. "Everyone says you need [common advice]. They're wrong."
- Story: "[Time ago], I was [pain point]. Today, [outcome]. Here's what changed." Only with real facts from the brief.`;

export const THREAD_HOOK_FORMULAS = `THREAD OPENER FORMULAS (the first tweet decides whether anyone reads tweet two - pick one):
- Strong declarative: a confident claim that signals a worldview.
- Controversial opinion: "99% of business books are 1 idea stretched across 300 pages."
- Moment in time: "Over the past 10 years, I have read over 500 business books."
- Vulnerable statement: "I almost quit three times. Here's what saved me." Only with real facts from the brief.
- Weird, unique insight: an odd specific observation the reader has not heard before.`;

export const COMMENT_CRAFT = `COMMENT CRAFT
Pick the ONE comment type that best fits the parent post:
- funny: light, clever, or sarcastic, still on-topic. Should earn a smile.
- valuable: one sharp insight or lived experience, simple and non-preachy.
- counterpoint: respectfully disagree or add nuance without sounding combative.
Rules:
- NEVER "great post", "thanks for sharing", "so true", or any restatement of the post.
- Respond to the specific point with personality; do not summarize.
- No buzzwords, no motivational cliches, no fluff.
- 1 to 3 sentences in a single paragraph. Skipping the final period is fine when it reads more natural.`;
