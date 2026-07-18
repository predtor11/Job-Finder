import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Gmail OAuth — tokens live encrypted in gmail_accounts; never passwords.
 * Scopes: send + readonly + modify (thread sync, mark-as-read).
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** googleapis ships its own google-auth-library — derive the type from it. */
export type GmailOAuthClient = InstanceType<typeof google.auth.OAuth2>;

export function createOAuthClient(): GmailOAuthClient {
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri
  );
}

/** Step 1 — URL the user visits to grant access. `state` carries the userId. */
export function getAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always mint a refresh_token
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Step 2 — exchange the callback code, encrypt + store tokens. */
export async function handleOAuthCallback(
  userId: string,
  code: string
): Promise<{ email: string }> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      "Google did not return tokens. Remove the app's access at myaccount.google.com/permissions and reconnect."
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();
  const email = userInfo.email;
  if (!email) throw new Error("Could not read the Gmail address.");

  await prisma.gmailAccount.upsert({
    where: { userId_email: { userId, email } },
    create: {
      userId,
      email,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
      status: "CONNECTED",
    },
    update: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
      status: "CONNECTED",
    },
  });

  return { email };
}

/**
 * Authorized client for a user's connected Gmail account.
 * Refreshes the access token when near expiry and persists the rotation.
 */
export async function getAuthorizedClient(userId: string): Promise<{
  client: GmailOAuthClient;
  accountEmail: string;
  accountId: string;
}> {
  const account = await prisma.gmailAccount.findFirst({
    where: { userId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    throw new Error("No Gmail account connected. Connect one in Settings → Email.");
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decrypt(account.accessTokenEnc),
    refresh_token: decrypt(account.refreshTokenEnc),
    expiry_date: account.tokenExpiresAt?.getTime(),
  });

  const expiresSoon =
    !account.tokenExpiresAt ||
    account.tokenExpiresAt.getTime() < Date.now() + 2 * 60_000;

  if (expiresSoon) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      await prisma.gmailAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: credentials.access_token
            ? encrypt(credentials.access_token)
            : account.accessTokenEnc,
          refreshTokenEnc: credentials.refresh_token
            ? encrypt(credentials.refresh_token)
            : account.refreshTokenEnc,
          tokenExpiresAt: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : account.tokenExpiresAt,
          status: "CONNECTED",
        },
      });
    } catch (error) {
      await prisma.gmailAccount.update({
        where: { id: account.id },
        data: { status: "EXPIRED" },
      });
      throw new Error(
        `Gmail token refresh failed — reconnect in Settings → Email. (${error})`
      );
    }
  }

  return { client, accountEmail: account.email, accountId: account.id };
}

/** Disconnect: revoke at Google and delete the stored tokens. */
export async function disconnectGmail(userId: string, accountId: string) {
  const account = await prisma.gmailAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) return;
  try {
    const client = createOAuthClient();
    await client.revokeToken(decrypt(account.refreshTokenEnc));
  } catch {
    // Already revoked at Google — still remove locally.
  }
  await prisma.gmailAccount.delete({ where: { id: account.id } });
}
