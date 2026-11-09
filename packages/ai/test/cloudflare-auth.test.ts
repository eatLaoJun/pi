import { describe, expect, it } from "vitest";
import type { AuthContext, AuthPrompt } from "../src/auth/types.ts";
import { cloudflareAIGatewayAuth, cloudflareWorkersAIAuth } from "../src/providers/cloudflare-auth.ts";

const signal = new AbortController().signal;

function authContext(env: Record<string, string>): AuthContext {
	return { env: async (name) => env[name], fileExists: async () => false };
}

// Regression for https://github.com/earendil-works/pi/issues/10627
describe("Cloudflare AI Gateway custom domain auth", () => {
	it("allows a custom domain without a gateway token or account/gateway IDs", async () => {
		const result = await cloudflareAIGatewayAuth().resolve({
			ctx: authContext({ CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com" }),
			signal,
		});
		expect(result).toEqual({
			auth: { headers: { "cf-aig-authorization": null, Authorization: null, "x-api-key": null } },
			env: { CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com" },
			source: "CLOUDFLARE_GATEWAY_BASE_URL",
		});
	});

	it("still sends a gateway token when a custom domain uses gateway authentication", async () => {
		const result = await cloudflareAIGatewayAuth().resolve({
			ctx: authContext({ CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com", CLOUDFLARE_API_KEY: "cf-key" }),
			signal,
		});
		expect(result?.auth.headers?.["cf-aig-authorization"]).toBe("Bearer cf-key");
	});

	it("prefers stored domain configuration and allows explicitly disabling an ambient token", async () => {
		const result = await cloudflareAIGatewayAuth().resolve({
			ctx: authContext({
				CLOUDFLARE_GATEWAY_BASE_URL: "https://ambient.example.com",
				CLOUDFLARE_API_KEY: "ambient",
			}),
			credential: { type: "api_key", key: "", env: { CLOUDFLARE_GATEWAY_BASE_URL: "https://stored.example.com" } },
			signal,
		});
		expect(result?.env).toEqual({ CLOUDFLARE_GATEWAY_BASE_URL: "https://stored.example.com" });
		expect(result?.auth.headers?.["cf-aig-authorization"]).toBeNull();
		expect(result?.source).toBe("stored credential");
	});

	it.each(["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"])(
		"still requires %s for the default endpoint",
		async (missing) => {
			const env: Record<string, string> = {
				CLOUDFLARE_API_KEY: "cf-key",
				CLOUDFLARE_ACCOUNT_ID: "account",
				CLOUDFLARE_GATEWAY_ID: "gateway",
			};
			delete env[missing];
			expect(await cloudflareAIGatewayAuth().resolve({ ctx: authContext(env), signal })).toBeUndefined();
		},
	);

	it("does not configure Workers AI from a gateway domain", async () => {
		expect(
			await cloudflareWorkersAIAuth().resolve({
				ctx: authContext({ CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com" }),
				signal,
			}),
		).toBeUndefined();
	});

	it.each([
		["https://ai.example.com", ""],
		["https://ai.example.com", "cf-key"],
	])("stores custom-domain login without requesting account/gateway IDs (%s, %s)", async (baseUrl, key) => {
		const answers = [baseUrl, key];
		const prompts: AuthPrompt[] = [];
		const credential = await cloudflareAIGatewayAuth().login?.({
			signal,
			prompt: async (prompt) => {
				prompts.push(prompt);
				return answers.shift()!;
			},
			notify: () => {},
		});
		expect(credential).toEqual({ type: "api_key", key, env: { CLOUDFLARE_GATEWAY_BASE_URL: baseUrl } });
		expect(prompts.map((prompt) => prompt.type)).toEqual(["text", "secret"]);
	});

	it("keeps the default-endpoint login when the custom URL is left empty", async () => {
		const answers = ["", "cf-key", "account", "gateway"];
		expect(
			await cloudflareAIGatewayAuth().login?.({
				signal,
				prompt: async () => answers.shift()!,
				notify: () => {},
			}),
		).toEqual({
			type: "api_key",
			key: "cf-key",
			env: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" },
		});
	});
});
