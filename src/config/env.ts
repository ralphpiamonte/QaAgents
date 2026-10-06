import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

dotenvConfig({ override: true });

const BaseEnvSchema = z.object({
  JIRA_BASE_URL: z.string().url().transform((v) => v.replace(/\/+$/, "")),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1),
  AI_PROVIDER: z.enum(["openai", "azure", "azure_apim"]).default("azure_apim"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_VERSION: z.string().min(1).optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1).optional(),
  AZURE_APIM_BASE_URL: z.string().url().optional(),
  AZURE_APIM_SUBSCRIPTION_KEY: z.string().min(1).optional(),
  AZURE_APIM_BEARER_TOKEN: z.string().min(1).optional(),
  AZURE_APIM_SUPPLIER: z.string().min(1).optional(),
  ZEPHYR_SCALE_BASE_URL: z.string().url().default("https://api.zephyrscale.smartbear.com/v2"),
  ZEPHYR_SCALE_API_TOKEN: z.string().min(1).optional(),
  ZEPHYR_SCALE_PROJECT_KEY: z.string().min(1).optional(),
  ZEPHYR_SCALE_ROOT_FOLDER_NAME: z.string().min(1).default("Ordering _ Integrated UI"),
  AUDIT_LOG_PATH: z.string().min(1).default("logs/audit.log")
});

interface CommonEnv {
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  OPENAI_MODEL: string;
  ZEPHYR_SCALE_BASE_URL: string;
  ZEPHYR_SCALE_API_TOKEN?: string;
  ZEPHYR_SCALE_PROJECT_KEY?: string;
  ZEPHYR_SCALE_ROOT_FOLDER_NAME: string;
  AUDIT_LOG_PATH: string;
}

export interface OpenAIEnv extends CommonEnv {
  AI_PROVIDER: "openai";
  OPENAI_API_KEY: string;
}

export interface AzureEnv extends CommonEnv {
  AI_PROVIDER: "azure";
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_API_KEY: string;
  OPENAI_API_VERSION: string;
  AZURE_OPENAI_DEPLOYMENT: string;
}

export interface AzureApimEnv extends CommonEnv {
  AI_PROVIDER: "azure_apim";
  AZURE_APIM_BASE_URL: string;
  AZURE_APIM_SUBSCRIPTION_KEY: string;
  AZURE_APIM_BEARER_TOKEN: string;
  AZURE_APIM_SUPPLIER?: string;
}

export type AppEnv = OpenAIEnv | AzureEnv | AzureApimEnv;

export function loadEnv(): AppEnv {
  const env = BaseEnvSchema.parse(process.env);

  if (env.AI_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    }

    return {
      AI_PROVIDER: "openai",
      JIRA_BASE_URL: env.JIRA_BASE_URL,
      JIRA_EMAIL: env.JIRA_EMAIL,
      JIRA_API_TOKEN: env.JIRA_API_TOKEN,
      OPENAI_MODEL: env.OPENAI_MODEL,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ZEPHYR_SCALE_BASE_URL: env.ZEPHYR_SCALE_BASE_URL,
      ...(env.ZEPHYR_SCALE_API_TOKEN ? { ZEPHYR_SCALE_API_TOKEN: env.ZEPHYR_SCALE_API_TOKEN } : {}),
      ...(env.ZEPHYR_SCALE_PROJECT_KEY ? { ZEPHYR_SCALE_PROJECT_KEY: env.ZEPHYR_SCALE_PROJECT_KEY } : {}),
      ZEPHYR_SCALE_ROOT_FOLDER_NAME: env.ZEPHYR_SCALE_ROOT_FOLDER_NAME,
      AUDIT_LOG_PATH: env.AUDIT_LOG_PATH
    };
  }

  if (env.AI_PROVIDER === "azure") {
    if (!env.AZURE_OPENAI_ENDPOINT) {
      throw new Error("AZURE_OPENAI_ENDPOINT is required when AI_PROVIDER=azure");
    }
    if (!env.AZURE_OPENAI_API_KEY) {
      throw new Error("AZURE_OPENAI_API_KEY is required when AI_PROVIDER=azure");
    }
    if (!env.OPENAI_API_VERSION) {
      throw new Error("OPENAI_API_VERSION is required when AI_PROVIDER=azure");
    }
    if (!env.AZURE_OPENAI_DEPLOYMENT) {
      throw new Error("AZURE_OPENAI_DEPLOYMENT is required when AI_PROVIDER=azure");
    }

    return {
      AI_PROVIDER: "azure",
      JIRA_BASE_URL: env.JIRA_BASE_URL,
      JIRA_EMAIL: env.JIRA_EMAIL,
      JIRA_API_TOKEN: env.JIRA_API_TOKEN,
      OPENAI_MODEL: env.OPENAI_MODEL,
      AZURE_OPENAI_ENDPOINT: env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
      OPENAI_API_VERSION: env.OPENAI_API_VERSION,
      AZURE_OPENAI_DEPLOYMENT: env.AZURE_OPENAI_DEPLOYMENT,
      ZEPHYR_SCALE_BASE_URL: env.ZEPHYR_SCALE_BASE_URL,
      ...(env.ZEPHYR_SCALE_API_TOKEN ? { ZEPHYR_SCALE_API_TOKEN: env.ZEPHYR_SCALE_API_TOKEN } : {}),
      ...(env.ZEPHYR_SCALE_PROJECT_KEY ? { ZEPHYR_SCALE_PROJECT_KEY: env.ZEPHYR_SCALE_PROJECT_KEY } : {}),
      ZEPHYR_SCALE_ROOT_FOLDER_NAME: env.ZEPHYR_SCALE_ROOT_FOLDER_NAME,
      AUDIT_LOG_PATH: env.AUDIT_LOG_PATH
    };
  }

  if (!env.AZURE_APIM_BASE_URL) {
    throw new Error("AZURE_APIM_BASE_URL is required when AI_PROVIDER=azure_apim");
  }
  if (!env.AZURE_APIM_SUBSCRIPTION_KEY) {
    throw new Error("AZURE_APIM_SUBSCRIPTION_KEY is required when AI_PROVIDER=azure_apim");
  }

  return {
    AI_PROVIDER: "azure_apim",
    JIRA_BASE_URL: env.JIRA_BASE_URL,
    JIRA_EMAIL: env.JIRA_EMAIL,
    JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    OPENAI_MODEL: env.OPENAI_MODEL,
    AZURE_APIM_BASE_URL: env.AZURE_APIM_BASE_URL,
    AZURE_APIM_SUBSCRIPTION_KEY: env.AZURE_APIM_SUBSCRIPTION_KEY,
    AZURE_APIM_BEARER_TOKEN: env.AZURE_APIM_BEARER_TOKEN ?? "do-not-change-this-value",
    ZEPHYR_SCALE_BASE_URL: env.ZEPHYR_SCALE_BASE_URL,
    ...(env.ZEPHYR_SCALE_API_TOKEN ? { ZEPHYR_SCALE_API_TOKEN: env.ZEPHYR_SCALE_API_TOKEN } : {}),
    ...(env.ZEPHYR_SCALE_PROJECT_KEY ? { ZEPHYR_SCALE_PROJECT_KEY: env.ZEPHYR_SCALE_PROJECT_KEY } : {}),
    ZEPHYR_SCALE_ROOT_FOLDER_NAME: env.ZEPHYR_SCALE_ROOT_FOLDER_NAME,
    AUDIT_LOG_PATH: env.AUDIT_LOG_PATH,
    ...(env.AZURE_APIM_SUPPLIER ? { AZURE_APIM_SUPPLIER: env.AZURE_APIM_SUPPLIER } : {})
  };
}

