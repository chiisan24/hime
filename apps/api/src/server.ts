import { createApp } from "./app.js";
import { resolveLocalServerConfig } from "./server/localServerConfig.js";

const { host, port } = resolveLocalServerConfig(process.env);

createApp().listen(port, host, () => {
  console.log(`Ehime Vote Navigator API listening on http://${host}:${port}`);
});
