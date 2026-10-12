import { err, ok, type Result } from "neverthrow";
import { parseSessionFile, type SessionFile, type SessionManifest } from "../../contracts/session.ts";
import { sessionsPath } from "../cli/paths.ts";

export async function loadSessions(home: string): Promise<Result<SessionFile, string>> {
	const path = sessionsPath(home);
	const file = Bun.file(path);
	if (!(await file.exists())) return ok({ version: 1, sessions: [] });
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch {
		return err("sessions.json is not valid JSON");
	}
	const parsed = parseSessionFile(raw);
	return parsed.ok ? ok(parsed.file) : err(parsed.error);
}

async function saveSessions(home: string, file: SessionFile): Promise<Result<void, string>> {
	try {
		const path = sessionsPath(home);
		const tmp = path + ".tmp." + process.pid;
		await Bun.write(tmp, JSON.stringify(file, null, 2));
		const { chmodSync, renameSync } = await import("node:fs");
		chmodSync(tmp, 0o600);
		renameSync(tmp, path);
		return ok(undefined);
	} catch (e) {
		return err(String(e));
	}
}

/** Open (or re-open) a session from a manifest. */
export async function openSession(
	home: string,
	manifest: SessionManifest,
	now: Date = new Date(),
): Promise<Result<void, string>> {
	const file = await loadSessions(home);
	if (file.isErr()) return err(file.error);
	const existing = file.value.sessions.find((s) => s.id === manifest.id);
	if (existing) {
		existing.principal = manifest.principal;
		return (await saveSessions(home, file.value)).isErr() ? err("write failed") : ok(undefined);
	}
	file.value.sessions.push({
		id: manifest.id,
		principal: manifest.principal,
		opened_at: now.toISOString(),
		last_approvals: [],
		replayed: false,
	});
	const saved = await saveSessions(home, file.value);
	return saved.isErr() ? err(saved.error) : ok(undefined);
}

/** Remember the aliases a session approved this run — the resume replay list. */
export async function recordApprovals(
	home: string,
	sessionId: string,
	aliases: string[],
): Promise<Result<void, string>> {
	const file = await loadSessions(home);
	if (file.isErr()) return err(file.error);
	const s = file.value.sessions.find((x) => x.id === sessionId);
	if (!s) return err("session not found: " + sessionId);
	s.last_approvals = [...aliases];
	s.replayed = false;
	const saved = await saveSessions(home, file.value);
	return saved.isErr() ? err(saved.error) : ok(undefined);
}

/** One-shot resume replay: returns the last approval list and burns the replay. */
export async function takeReplay(home: string, sessionId: string): Promise<Result<string[], string>> {
	const file = await loadSessions(home);
	if (file.isErr()) return err(file.error);
	const s = file.value.sessions.find((x) => x.id === sessionId);
	if (!s) return err("session not found: " + sessionId);
	if (s.replayed) return err("session " + sessionId + " already resumed once — permissions replay is one-shot");
	const list = [...s.last_approvals];
	s.replayed = true;
	const saved = await saveSessions(home, file.value);
	if (saved.isErr()) return err(saved.error);
	return ok(list);
}

/** Session end: drop the record entirely (grants withdrawn separately in the same flow). */
export async function closeSession(home: string, sessionId: string): Promise<Result<void, string>> {
	const file = await loadSessions(home);
	if (file.isErr()) return err(file.error);
	file.value.sessions = file.value.sessions.filter((s) => s.id !== sessionId);
	const saved = await saveSessions(home, file.value);
	return saved.isErr() ? err(saved.error) : ok(undefined);
}
