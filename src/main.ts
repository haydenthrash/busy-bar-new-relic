import { Display } from './busybar.js';
import { deviceConfig, loadDotEnv, newRelicConfig } from './config.js';
import { exitOnSignal, message, startLoop } from './loop.js';
import { NewRelicClient } from './newrelic.js';

async function main(): Promise<void> {
  loadDotEnv();
  const device = deviceConfig();
  const nr = newRelicConfig();

  const client = new NewRelicClient(nr);
  const entity = await client.resolve();
  console.log(`Watching ${entity.name} (${entity.domain}/${entity.type}, account ${entity.accountId}, ${entity.region} region)`);
  if (entity.domain !== 'APM') console.warn(`Warning: entity domain is ${entity.domain}, expected APM`);
  console.log(`Drawing to BUSY Bar at ${device.addr} (priority ${device.priority}); poll ${nr.pollSeconds}s, flip ${device.flipSeconds}s. Ctrl-C to stop.`);

  const display = new Display(device);
  const loop = startLoop({ display, poll: () => client.poll(), pollSeconds: nr.pollSeconds, flipSeconds: device.flipSeconds });
  exitOnSignal(loop, display);
}

main().catch((err) => {
  console.error(message(err));
  process.exit(1);
});
