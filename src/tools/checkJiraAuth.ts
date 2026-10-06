import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

dotenvConfig({ override: true });

const EnvSchema = z.object({
  JIRA_BASE_URL: z.string().url().transform((v) => v.replace(/\/+$/, "")),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1)
});

function mask(value: string): string {
  if (value.length <= 6) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
  const basicAuth = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`;

  console.log(`Jira base URL: ${env.JIRA_BASE_URL}`);
  console.log(`Jira email: ${mask(env.JIRA_EMAIL)} (len=${env.JIRA_EMAIL.length})`);
  console.log(`Jira token length: ${env.JIRA_API_TOKEN.length}`);

  const serverInfo = await fetch(`${env.JIRA_BASE_URL}/rest/api/3/serverInfo`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  console.log(`serverInfo status: ${serverInfo.status}`);

  const myself = await fetch(`${env.JIRA_BASE_URL}/rest/api/3/myself`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth
    }
  });

  const responseBody = await myself.text();
  console.log(`myself status: ${myself.status}`);

  if (myself.ok) {
    const user = JSON.parse(responseBody) as { displayName?: string; accountId?: string; active?: boolean };
    console.log(`Authenticated as: ${user.displayName ?? "<unknown>"} (${user.accountId ?? "<unknown>"})`);
    console.log(`Account active: ${String(user.active)}`);
    return;
  }

  const loginReason = myself.headers.get("x-seraph-loginreason") ?? "";
  const wwwAuth = myself.headers.get("www-authenticate") ?? "";
  console.log(`x-seraph-loginreason: ${loginReason || "<none>"}`);
  console.log(`www-authenticate: ${wwwAuth || "<none>"}`);
  console.log(`response body: ${responseBody.slice(0, 400)}`);

  if (myself.status === 401) {
    console.log("\nLikely causes:");
    console.log("1) JIRA_EMAIL and JIRA_API_TOKEN do not belong to the same Atlassian account.");
    console.log("2) API token is revoked/expired or copied incorrectly.");
    console.log("3) Atlassian Access policy blocks API token usage for this managed account.");
    console.log("4) Account can sign in via SSO/OAuth but lacks Jira API product access.");
  }

  process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Unknown error.");
  }
  process.exit(1);
});
