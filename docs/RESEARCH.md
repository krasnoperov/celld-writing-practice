# Research: an agentic writing coach that teaches

This is the design research behind Writing Practice. The current product shape lives in README.md and docs/VOICE.md.

## Conclusion

The useful product is not an automatic editor. It is a longitudinal coach whose unit of progress is **independent transfer**: can the learner use a writing strategy in a different task without being reminded?

The lesson loop is:

1. Authentic rhetorical mission with audience, purpose, genre, constraints, and visible success criteria.
2. Unaided first thoughts, written before the research arrives.
3. Learner self-assessment of intended reader effect and uncertainty.
4. One prioritized diagnosis, addressing higher-order concerns before sentence-level correction.
5. Progressive hint that makes the learner revise instead of accepting a replacement.
6. Learner-authored revision, checked only against the selected focus and regressions.
7. Learner reflection: what changed, why it works, and the reusable principle.
8. Delayed, disguised transfer task in a new context.

## Evidence and established practice

- The US Institute of Education Sciences recommends explicit writing strategies in a **Model–Practice–Reflect** cycle, integration of reading and writing, and assessment-informed instruction: [Teaching Secondary Students to Write Effectively](https://ies.ed.gov/ncee/WWC/PracticeGuide/22/Published).
- Writing-center guidance prioritizes higher-order concerns such as purpose, audience, ideas, and organization before grammar, and recommends focusing feedback on only one or two revision needs: [UW–Madison feedback guide](https://writing.wisc.edu/a-quick-reference-guide-for-written-feedback/) and [UC Merced HOC/LOC hierarchy](https://writingcenter.ucmerced.edu/node/231).
- Formative feedback is most useful while the text is still unfinished and meaningful revision remains open: [Texas A&M Writing Center](https://writingcenter.tamu.edu/faculty/resources/formative-feedback.html).
- Selective correction codes and staged resubmission encourage self-correction instead of teacher rewriting: [British Council](https://www.teachingenglish.org.uk/teaching-resources/teaching-secondary/activities/beginner-a1/writing-correction-code).
- Writing-transfer research emphasizes repurposing rhetorical knowledge across contexts and using reflection to develop meta-awareness: [Elon Statement on Writing Transfer](https://wacclearinghouse.org/docs/books/ansonmoore/appendixa.pdf).
- LLM revision judgments improve with detailed rubrics but do not consistently agree with human ratings across proficiency levels. Model diagnoses should therefore remain evidence-backed hypotheses rather than grades: [BEA 2024 study](https://aclanthology.org/2024.bea-1.30/).

## Current industry patterns

- [Khanmigo Writing Coach](https://blog.khanacademy.org/meet-khanmigo-writing-coach-helping-learners-become-better-writers/) stages understanding, outlining, drafting, feedback, and revision, while explicitly avoiding writing for the student.
- [Cambridge Write & Improve](https://www.cambridgeenglish.org/learning-english/free-resources/write-and-improve/index.aspx?level=independent&rows=24) uses task-based practice, actionable feedback, repeated submissions, and visible progress.
- [Grammarly Goals](https://support.grammarly.com/hc/en-us/articles/360054679292-What-are-Goals) conditions feedback on audience, formality, domain, and intent.
- [ETS Criterion](https://www-vantage-prod-publish.ets.org/criterion/how-it-works.html) provides trait-level diagnostics followed by revise-and-resubmit.

These are product precedents, not proof of long-term learning outcomes. The underdeveloped opportunity is durable evidence of learner independence and delayed transfer.

## Guardrails

- Never return a fully rewritten draft by default.
- Give one primary higher-order focus and at most one recurring language pattern.
- Quote the learner's text and state the likely reader effect.
- Separate errors, audience mismatches, clarity problems, and optional preferences.
- Preserve dialect and intentional voice unless they conflict with the declared audience and goal.
- Store learner disagreement and uncertainty; do not freeze disputed diagnoses into a profile.
- Do not declare mastery from a corrected draft. Require unaided success in changed contexts.
- Keep the correspondence — letters, verdicts, replies — inspectable and deletable; the page is the only draft, and the coach reads it as it stands.

## Product metrics

Measure unaided task success, quality of learner self-diagnosis, revision outcome, help level required, learner explanation, later independent transfer, and declining support. Do not optimize primarily for suggestion acceptance or similarity to a model rewrite.
