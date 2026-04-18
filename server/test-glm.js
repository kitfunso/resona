import 'dotenv/config';
import { askGLMText, MODEL } from './glm-service.js';

async function main() {
  process.stdout.write(`Resona GLM check: pinging ${MODEL}... `);
  try {
    const reply = await askGLMText(
      [{ role: 'user', content: 'Respond with exactly the string READY if you can hear me.' }],
      { tag: 'test-glm', temperature: 0, max_tokens: 2000 },
    );
    const clean = reply.trim();
    if (/\bREADY\b/i.test(clean)) {
      console.log(`\nResona GLM check: READY`);
      console.log(`  model: ${MODEL}`);
      console.log(`  reply: ${JSON.stringify(clean)}`);
      process.exit(0);
    }
    console.error(`\nResona GLM check: FAILED, model returned unexpected text`);
    console.error(`  reply: ${JSON.stringify(clean)}`);
    process.exit(1);
  } catch (err) {
    console.error(`\nResona GLM check: FAILED`);
    console.error(`  error: ${err.message}`);
    if (err.status) console.error(`  status: ${err.status}`);
    if (err.response?.data) console.error(`  body: ${JSON.stringify(err.response.data)}`);
    process.exit(1);
  }
}

main();
