import 'dotenv/config';
import { askGPTText, MODEL } from './gpt-service.js';

async function main() {
  process.stdout.write(`Resona GPT check: pinging ${MODEL}... `);
  try {
    const reply = await askGPTText(
      [{ role: 'user', content: 'Respond with exactly the string READY if you can hear me.' }],
      { tag: 'test-gpt', temperature: 0, max_tokens: 2000 },
    );
    const clean = reply.trim();
    if (/\bREADY\b/i.test(clean)) {
      console.log(`\nResona GPT check: READY`);
      console.log(`  model: ${MODEL}`);
      console.log(`  reply: ${JSON.stringify(clean)}`);
      process.exit(0);
    }
    console.error(`\nResona GPT check: FAILED, model returned unexpected text`);
    console.error(`  reply: ${JSON.stringify(clean)}`);
    process.exit(1);
  } catch (err) {
    console.error(`\nResona GPT check: FAILED`);
    console.error(`  error: ${err.message}`);
    if (err.status) console.error(`  status: ${err.status}`);
    if (err.response?.data) console.error(`  body: ${JSON.stringify(err.response.data)}`);
    process.exit(1);
  }
}

main();
