import { createApp } from './app.js';

const bootstrap = async () => {
  const app = await createApp();
  const port = app.config.PORT;

  await app.listen({
    host: '0.0.0.0',
    port,
  });
};

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
