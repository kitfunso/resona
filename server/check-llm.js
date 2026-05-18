import 'dotenv/config';
import { askGLMText, MODEL, isConfigured } from './llm.js';

async function main() {
  if (!isConfigured()) {
    console.error('Resona LLM check: FAILED — OPENAI_API_KEY is not set.');
    process.exit(1);
  }
  process.stdout.write(`Resona LLM check: pinging ${MODEL}... `);
  try {
    const reply = await askGLMText(
      [{ role: 'user', content: 'Respond with exactly the string READY if you can hear me.' }],
      { tag: 'test-llm', temperature: 0, max_tokens: 50 },
    );
    const clean = reply.trim();
    if (/\bREADY\b/i.test(clean)) {
      console.log(`\nResona LLM check: READY`);
      console.log(`  model: ${MODEL}`);
      console.log(`  reply: ${JSON.stringify(clean)}`);
      process.exit(0);
    }
    console.error(`\nResona LLM check: FAILED, model returned unexpected text`);
    console.error(`  reply: ${JSON.stringify(clean)}`);
    process.exit(1);
  } catch (err) {
    console.error(`\nResona LLM check: FAILED`);
    console.error(`  error: ${err.message}`);
    process.exit(1);
  }
}

main();
