/**
 * Typed, validated access to server environment variables.
 * Import ONLY from server code — never from client components.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get geminiApiKey() {
    return optional("GEMINI_API_KEY");
  },
  get geminiFastModel() {
    return optional("GEMINI_FAST_MODEL", "gemini-flash-lite-latest");
  },
  get geminiSmartModel() {
    return optional("GEMINI_SMART_MODEL", "gemini-flash-latest");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get googleRedirectUri() {
    return optional(
      "GOOGLE_REDIRECT_URI",
      `${optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000")}/api/gmail/callback`
    );
  },
  get encryptionKey() {
    return required("ENCRYPTION_KEY");
  },
  get redisUrl() {
    return optional("REDIS_URL", "redis://localhost:6379");
  },
  get appUrl() {
    return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
} as const;
