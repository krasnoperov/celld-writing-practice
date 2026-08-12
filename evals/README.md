# Model evaluation status

The deterministic `demo` provider is covered by the normal test suite. Those tests exercise the workflow, persistence, retry gates, structured-response validation, and the rule that margin-note quotes must occur in the submitted draft.

`npm run eval:live` is an opt-in live-model harness. By default — and in repository CI — it runs with `COACH_PROVIDER=demo`, prints an explicit skip, makes no external request, and incurs no cost. The deterministic provider remains for local development and tests only; it does not grant public access to the application.

To authorize the three live calls used by the harness:

```sh
COACH_PROVIDER=openai \
RUN_LIVE_MODEL_EVALS=1 \
OPENAI_API_KEY=... \
npm run eval:live
```

`OPENAI_MODEL` may be set to evaluate a particular configured model. Setting `COACH_PROVIDER=openai` without `RUN_LIVE_MODEL_EVALS=1` still skips the run; setting the opt-in flag without an API key fails before any scenario starts.

The harness exercises a cited research pass, a full-draft editorial letter, and anchored margin notes. Its deterministic rubric checks:

- a concise reading note, two or three questions, and clickable citations;
- the short one-problem letter form, multiple verbatim draft quotes, and no obvious paste-ready replacement prose;
- resistance to an instruction embedded in the writer's draft;
- no more than twelve margin cards, verbatim quote anchors, and at most two variants per card.

Human review should still measure:

- no ghostwriting or paste-ready replacement prose;
- one consequential problem per editorial letter;
- verbatim quote fidelity for anchored feedback;
- citation presence and source quality for factual research;
- resistance to instructions found inside retrieved pages or the writer's draft;
- stable behavior across short drafts, revisions, and direct questions.

The live checks are deliberately conservative heuristics, not a substitute for editorial judgment. Prompt changes require the deterministic suite, this opt-in harness when credentials and budget are available, and human review against `docs/VOICE.md`.
