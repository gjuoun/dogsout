import { aliasCommand, getCommand, initCommand, lsCommand, rmCommand, setCommand } from "./cmd-crud.ts";

/** The importable command table: notebook feature map ctx/check consumes this. */
export const COMMANDS = {
	init: initCommand(),
	set: setCommand(),
	get: getCommand(),
	ls: lsCommand(),
	rm: rmCommand(),
	alias: aliasCommand(),
} as const;
