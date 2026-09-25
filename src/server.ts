import { config } from "./config/env";
import { createApp } from "./app";
import { startCampaignScheduler } from "./services/whatsapp/campaignWorker";

const app = createApp();

startCampaignScheduler();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${config.port} (${config.nodeEnv})`);
});
