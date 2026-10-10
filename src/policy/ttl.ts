import type { TtlTier } from "../../contracts/ask.ts";

export interface DecaySettings {
	/** always-tier horizon, e.g. "720h" (30d). From config settings.always_decay. */
	always_decay: string;
}

/** Parse a duration like "10m", "24h", "30d" into milliseconds. */
export function parseDuration(s: string): number | null {
	const m = /^([0-9]+(?:\.[0-9]+)?)([smhd])$/.exec(s.trim());
	if (!m) return null;
	const n = Number(m[1]);
	const unit = m[2];
	const ms = n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
	return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Milliseconds a tier keeps a grant alive.
 * once → 0 (consumed on use); session → null (dies with session end, no clock expiry);
 * always → the always_decay horizon (fixed 30d by default, 2026-10-10 ruling).
 */
export function ttlToMs(tier: TtlTier, settings: DecaySettings): number | null {
	switch (tier) {
		case "once":
			return 0;
		case "10m":
			return 10 * 60_000;
		case "1h":
			return 3_600_000;
		case "24h":
			return 86_400_000;
		case "30d":
			return 30 * 86_400_000;
		case "always":
			return parseDuration(settings.always_decay) ?? 30 * 86_400_000;
		case "session":
			return null;
	}
}

/** Absolute expiry for a grant approved at approvedAt; null only for the session tier. */
export function expiryFor(tier: TtlTier, approvedAt: Date, settings: DecaySettings): string | null {
	const ms = ttlToMs(tier, settings);
	if (ms === null) return null;
	return new Date(approvedAt.getTime() + ms).toISOString();
}
