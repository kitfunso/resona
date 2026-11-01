import { createAnalyticsServer } from './app.mjs';

const port = Number(process.env.SENSOR_PORT || 5190);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sensor demo port');
const server = createAnalyticsServer({ apiKey: process.env.OPENAI_API_KEY, accessToken: process.env.SENSOR_ACCESS_TOKEN, staticDir: process.env.SENSOR_STATIC_DIR });
server.listen(port, '127.0.0.1', () => console.info(`Sensor analysis service listening on 127.0.0.1:${port}`));
