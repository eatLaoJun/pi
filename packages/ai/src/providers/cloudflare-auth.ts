import type { ApiKeyAuth, ApiKeyCredential, AuthContext } from "../auth/types.ts";
import type { ProviderEnv } from "../types.ts";

const CLOUDFLARE_API_KEY = "CLOUDFLARE_API_KEY";
const CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
const CLOUDFLARE_GATEWAY_ID = "CLOUDFLARE_GATEWAY_ID";
const CLOUDFLARE_GATEWAY_BASE_URL = "CLOUDFLARE_GATEWAY_BASE_URL";

type CloudflareAuthKind = "workers-ai" | "ai-gateway";

async function resolveValue(
	name: string,
	ctx: AuthContext,
	credential: ApiKeyCredential | undefined,
	signal: AbortSignal,
): Promise<string | undefined> {
	// Per-field merge: prefer the credential value, fall back to ambient env.
	// A credential carrying only the API key must still pick up the account /
	// gateway id from the environment.
	const fromCredential = credential
		? name === CLOUDFLARE_API_KEY
			? credential.key
			: credential.env?.[name]
		: undefined;
	if (fromCredential !== undefined) return fromCredential;
	signal.throwIfAborted();
	const value = await ctx.env(name);
	signal.throwIfAborted();
	return value;
}

async function resolveCloudflareEnv(
	kind: CloudflareAuthKind,
	ctx: AuthContext,
	credential: ApiKeyCredential | undefined,
	signal: AbortSignal,
): Promise<{ apiKey: string | undefined; env: ProviderEnv; source: string } | undefined> {
	const apiKey = await resolveValue(CLOUDFLARE_API_KEY, ctx, credential, signal);
	const accountId = await resolveValue(CLOUDFLARE_ACCOUNT_ID, ctx, credential, signal);
	const gatewayId =
		kind === "ai-gateway" ? await resolveValue(CLOUDFLARE_GATEWAY_ID, ctx, credential, signal) : undefined;
	const baseUrl =
		kind === "ai-gateway" ? await resolveValue(CLOUDFLARE_GATEWAY_BASE_URL, ctx, credential, signal) : undefined;

	// Custom domains identify the account/gateway and can authenticate through Access headers.
	if (!baseUrl && (!apiKey || !accountId || (kind === "ai-gateway" && !gatewayId))) return undefined;

	return {
		apiKey,
		env: {
			...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
			...(gatewayId ? { CLOUDFLARE_GATEWAY_ID: gatewayId } : {}),
			...(baseUrl ? { CLOUDFLARE_GATEWAY_BASE_URL: baseUrl } : {}),
		},
		source: credential ? "stored credential" : apiKey ? CLOUDFLARE_API_KEY : CLOUDFLARE_GATEWAY_BASE_URL,
	};
}

export function cloudflareWorkersAIAuth(): ApiKeyAuth {
	return {
		name: "Cloudflare API key",
		login: async (interaction) => {
			const key = await interaction.prompt({ type: "secret", message: "Enter Cloudflare API key" });
			const accountId = await interaction.prompt({ type: "text", message: "Enter Cloudflare account ID" });
			return { type: "api_key", key, env: { CLOUDFLARE_ACCOUNT_ID: accountId } };
		},
		resolve: async ({ ctx, credential, signal }) => {
			const resolved = await resolveCloudflareEnv("workers-ai", ctx, credential, signal);
			if (!resolved) return undefined;
			return {
				auth: { apiKey: resolved.apiKey },
				env: resolved.env,
				source: resolved.source,
			};
		},
	};
}

export function cloudflareAIGatewayAuth(): ApiKeyAuth {
	return {
		name: "Cloudflare API key",
		login: async (interaction): Promise<ApiKeyCredential> => {
			const baseUrl = await interaction.prompt({
				type: "text",
				message: "Enter custom gateway base URL (leave empty for the default endpoint)",
				placeholder: "https://ai.example.com",
			});
			const key = await interaction.prompt({
				type: "secret",
				message: baseUrl ? "Enter Cloudflare API key (optional for custom domains)" : "Enter Cloudflare API key",
			});
			if (baseUrl) return { type: "api_key", key, env: { CLOUDFLARE_GATEWAY_BASE_URL: baseUrl } };
			const accountId = await interaction.prompt({ type: "text", message: "Enter Cloudflare account ID" });
			const gatewayId = await interaction.prompt({ type: "text", message: "Enter Cloudflare AI Gateway ID" });
			return {
				type: "api_key",
				key,
				env: { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_GATEWAY_ID: gatewayId },
			};
		},
		resolve: async ({ ctx, credential, signal }) => {
			const resolved = await resolveCloudflareEnv("ai-gateway", ctx, credential, signal);
			if (!resolved) return undefined;
			return {
				auth: {
					headers: {
						"cf-aig-authorization": resolved.apiKey ? `Bearer ${resolved.apiKey}` : null,
						Authorization: null,
						"x-api-key": null,
					},
				},
				env: resolved.env,
				source: resolved.source,
			};
		},
	};
}
