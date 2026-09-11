import assert from 'node:assert/strict';
import { test } from 'node:test';

import Fastify from 'fastify';

import type { ClassifyInput } from './classify.js';
import { OpenAIClassifier } from './openai.js';

const item = (id: string, title: string): ClassifyInput => ({ id, title, snippet: null, source: 'واس', tier: 'official', lang: 'ar', hint: null });
const log = Fastify({ logger: false }).log;

test('OpenAI labels are parsed, cleaned and clamped; unknown ids fall back to keywords', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const content = JSON.stringify({
      results: [
        { id: 'a', topics: ['markets', 'bogus', 'economy', 'finance', 'tech'], decision: true, business_angle: true, relevance: 140 },
        { id: 'b', topics: ['sports'], decision: false, business_angle: false, relevance: -5 },
      ],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const classifier = new OpenAIClassifier({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl });
  const labels = await classifier.classify([item('a', 'مجلس الوزراء يوافق على نظام'), item('b', 'الهلال يفوز'), item('c', 'شركة ناشئة تغلق جولة تمويل')]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0]?.body.model, 'gpt-test');
  assert.deepEqual(labels[0], { topics: ['markets', 'economy', 'finance'], decision: true, businessAngle: true, relevance: 100 });
  assert.deepEqual(labels[1], { topics: ['sports'], decision: false, businessAngle: false, relevance: 0 });
  assert.ok(labels[2]?.topics.includes('startups'), 'missing id labelled by keywords');
});

test('an OpenAI failure falls back to keywords for the whole batch', async () => {
  const fetchImpl: typeof fetch = async () => new Response('rate limited', { status: 429 });
  const classifier = new OpenAIClassifier({ apiKey: 'sk-test', model: 'gpt-test', log, fetchImpl });
  const labels = await classifier.classify([item('a', 'مجلس الوزراء يوافق على نظام الاستثمار')]);
  assert.equal(labels[0]?.decision, true);
});
