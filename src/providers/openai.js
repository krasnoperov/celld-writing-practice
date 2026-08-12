import {
  ANSWER_SYSTEM_PROMPT,
  READING_SCHEMA,
  RESEARCH_SYSTEM_PROMPT,
  REVIEW_SCHEMA,
  REVIEW_SYSTEM_PROMPT,
  REVISION_FEEDBACK_SYSTEM_PROMPT,
  answerPrompt,
  draftFeedbackPrompt,
  draftFeedbackSystem,
  researchPrompt,
  reviewPrompt,
  revisionFeedbackPrompt,
} from "../prompts.js";

const REQUEST_TIMEOUT_MS = 120_000;

function output(payload) {
  const chunks = [];
  const citations = [];
  if (typeof payload.output_text === "string") chunks.push(payload.output_text);
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && !chunks.includes(content.text)) {
        chunks.push(content.text);
      }
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          citations.push({ title: annotation.title || annotation.url, url: annotation.url });
        }
      }
    }
  }
  const markdown = chunks.join("\n").trim();
  if (!markdown) throw new Error("The model response did not contain Markdown text");
  return { markdown, citations };
}

function appendSources(markdown, citations) {
  const unique = [...new Map(citations.map((source) => [source.url, source])).values()];
  if (!unique.length) return markdown;
  const links = unique.slice(0, 12).map((source) => `- [${source.title.replaceAll("[", "").replaceAll("]", "")}](${source.url})`);
  return `${markdown}\n\n### Sources\n\n${links.join("\n")}`;
}

async function callOpenAI(env, { system, input, webSearch = false, jsonSchema = null }) {
  if (!env.OPENAI_API_KEY) throw new Error("COACH_PROVIDER=openai requires OPENAI_API_KEY");
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const requestBody = {
    model: env.OPENAI_MODEL || "gpt-5.6-sol",
    store: false,
    input: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
  };
  if (webSearch) {
    requestBody.tools = [{ type: "web_search", search_context_size: "medium" }];
    requestBody.max_tool_calls = 4;
    requestBody.include = ["web_search_call.action.sources"];
  }
  if (jsonSchema) {
    requestBody.text = { format: { type: "json_schema", name: jsonSchema.name, strict: true, schema: jsonSchema.schema } };
  }
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`Model request failed (${response.status}): ${detail}`);
  }
  return output(await response.json());
}

export function createOpenAIProvider(env) {
  return {
    name: "openai",
    research: async (input) => {
      const result = await callOpenAI(env, {
        system: RESEARCH_SYSTEM_PROMPT,
        input: researchPrompt(input),
        webSearch: true,
        jsonSchema: { name: "reading", schema: READING_SCHEMA },
      });
      let reading;
      try {
        reading = JSON.parse(result.markdown);
      } catch {
        throw new Error("The reading response was not valid JSON");
      }
      return { ...reading, full: appendSources(reading.full, result.citations) };
    },
    analyzeDraft: async (input) => (await callOpenAI(env, {
      system: draftFeedbackSystem(input.draftMarkdown),
      input: draftFeedbackPrompt(input),
    })).markdown,
    answer: async (input) => {
      const result = await callOpenAI(env, {
        system: ANSWER_SYSTEM_PROMPT,
        input: answerPrompt(input),
        webSearch: true,
      });
      return appendSources(result.markdown, result.citations);
    },
    reviewRevision: async (input) => (await callOpenAI(env, {
      system: REVISION_FEEDBACK_SYSTEM_PROMPT,
      input: revisionFeedbackPrompt(input),
    })).markdown,
    review: async (input) => {
      const result = await callOpenAI(env, {
        system: REVIEW_SYSTEM_PROMPT,
        input: reviewPrompt(input),
        jsonSchema: { name: "margin_notes", schema: REVIEW_SCHEMA },
      });
      try {
        return JSON.parse(result.markdown);
      } catch {
        throw new Error("The margin-note response was not valid JSON");
      }
    },
  };
}
