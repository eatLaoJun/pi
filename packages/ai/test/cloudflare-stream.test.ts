import { describe, expect, it } from "vitest";
import { cloudflareStreams, resolveCloudflareModel } from "../src/providers/cloudflare-stream.ts";
import type { Api, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<Api> = {
	id: "model",
	name: "model",
	api: "openai-completions",
	provider: "cloudflare-ai-gateway",
	baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context = normalizeContext({ messages: [] });

describe("Cloudflare provider streams", () => {
	// Regression for https://github.com/earendil-works/pi/issues/10627
	it.each(["openai", "anthropic", "compat"])("keeps the /%s route on a custom gateway domain", (route) => {
		const requestModel = { ...model, baseUrl: model.baseUrl.replace(/openai$/, route) };
		const resolved = resolveCloudflareModel(requestModel, {
			CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com/",
		});
		expect(resolved.baseUrl).toBe(`https://ai.example.com/${route}`);
		expect(requestModel.baseUrl).toBe(model.baseUrl.replace(/openai$/, route));
	});

	it.each([
		"https://override.example.com/compat",
		"https://gateway.ai.cloudflare.com/v1/other-account/other-gateway/compat",
	])("preserves an explicit model endpoint override (%s)", (baseUrl) => {
		const requestModel = { ...model, baseUrl };
		expect(resolveCloudflareModel(requestModel, { CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com" })).toBe(
			requestModel,
		);
	});

	it("does not redirect Workers AI endpoints to a custom gateway domain", () => {
		const requestModel = {
			...model,
			baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
		};
		expect(
			resolveCloudflareModel(requestModel, {
				CLOUDFLARE_ACCOUNT_ID: "account",
				CLOUDFLARE_GATEWAY_BASE_URL: "https://ai.example.com",
			}).baseUrl,
		).toBe("https://api.cloudflare.com/client/v4/accounts/account/ai/v1");
	});

	it("materializes the model endpoint before dispatch", () => {
		const captured: string[] = [];
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
		});
		const env = {
			CLOUDFLARE_ACCOUNT_ID: "account",
			CLOUDFLARE_GATEWAY_ID: "gateway",
		};

		streams.stream(model, context, { env });
		streams.streamSimple(model, context, { env });

		expect(captured).toEqual([
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
		]);
	});

	it("keeps placeholders when the provider env does not resolve them", () => {
		let captured: string | undefined;
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
		});

		streams.streamSimple(model, context, {});

		expect(captured).toBe(model.baseUrl);
	});
});
