import { green } from "colors";
import { parse } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFile } from 'fs';

console.log("Generating dev environment.ts file");

let localEnvPath = __dirname + "/.env";
let localEnv: any = {};
if (existsSync(localEnvPath)) {
  console.log(green("Using local .env file values to generate environment.ts"));
  localEnv = parse(readFileSync(localEnvPath));
}

const prodEnv = {
  production: true,
  RedPackets: {
    webUrl: 'https://packet.fun',
    serviceUrl: 'https://api.packet.fun/api/v1'
  }
}

const devEnv = {
  production: false,
  RedPackets: {
    webUrl: localEnv.NG_APP_RED_PACKETS_WEB_URL || prodEnv.RedPackets.webUrl,
    serviceUrl: localEnv.NG_APP_RED_PACKETS_SERVICE_URL || prodEnv.RedPackets.serviceUrl
  }
}

const devEnvironmentFile = `
// DO NOT EDIT - GENERATED BY set_env.ts
export const environment = ${JSON.stringify(devEnv, null, 2)};
`;

const prodEnvironmentFile = `
// DO NOT EDIT - GENERATED BY set_env.ts
export const environment = ${JSON.stringify(prodEnv, null, 2)};
`;

if (!existsSync("./src/environments"))
  mkdirSync("./src/environments");

writeFile('./src/environments/environment.ts', devEnvironmentFile, function (err) {
  if (err) {
    throw console.error(err);
  } else {
    console.log(`environment.ts file generated`);
  }
});

writeFile('./src/environments/environment.prod.ts', prodEnvironmentFile, function (err) {
  if (err) {
    throw console.error(err);
  } else {
    console.log(`environment.prod.ts file generated`);
  }
});