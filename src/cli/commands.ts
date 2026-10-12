import { aliasCommand, getCommand, initCommand, lsCommand, rmCommand, setCommand } from "./cmd-crud.ts";
import { exportCommand, importEnvCommand } from "./cmd-io.ts";
import { mapCommand } from "./map.ts";

/** The importable command table: notebook feature map ctx/check consumes this. */
export const COMMANDS = {
	init: initCommand(),
	set: setCommand(),
	get: getCommand(),
	ls: lsCommand(),
	rm: rmCommand(),
	alias: aliasCommand(),
	map: mapCommand(),
	"import-env": importEnvCommand(),
	export: exportCommand(),
} as const;
