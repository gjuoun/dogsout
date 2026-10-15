import { aliasCommand } from "./alias.ts";
import { exportCommand } from "./export.ts";
import { getCommand } from "./get.ts";
import { grantsCommand } from "./grants/grants.ts";
import { grantsLsCommand } from "./grants/ls.ts";
import { grantsRmCommand } from "./grants/rm.ts";
import { importEnvCommand } from "./import-env.ts";
import { initCommand } from "./init.ts";
import { lsCommand } from "./ls.ts";
import { mapCommand } from "./map.ts";
import {
	configSetCommand,
	configShowCommand,
	principalAddCommand,
	principalRmCommand,
	ruleAddCommand,
	ruleRmCommand,
} from "./policy/config.ts";
import { policyCommand } from "./policy/policy.ts";
import { simulateCommand } from "./policy/simulate.ts";
import { policyTestCommand } from "./policy/test.ts";
import { whyCommand } from "./policy/why.ts";
import { rmCommand } from "./rm.ts";
import { runCommand } from "./run.ts";
import { setCommand } from "./set.ts";

/** The importable command table: notebook feature map ctx/check consumes this. */
export const COMMANDS = {
	init: initCommand(),
	set: setCommand(),
	get: getCommand(),
	ls: lsCommand(),
	rm: rmCommand(),
	alias: aliasCommand(),
	map: mapCommand(),
	run: runCommand(),
	policy: policyCommand(),
	grants: grantsCommand(),
	"import-env": importEnvCommand(),
	export: exportCommand(),
} as const;

/**
 * Subcommand tree mirroring COMMANDS for nested groups (cmd-ts subcommands products
 * do not expose runtime enumeration; the map walks this instead).
 */
export const SUBCOMMANDS = {
	policy: {
		simulate: simulateCommand(),
		why: whyCommand(),
		test: policyTestCommand(),
		config: {
			show: configShowCommand(),
			set: configSetCommand(),
			rule: { add: ruleAddCommand(), rm: ruleRmCommand() },
			principal: { add: principalAddCommand(), rm: principalRmCommand() },
		},
	},
	grants: {
		ls: grantsLsCommand(),
		rm: grantsRmCommand(),
	},
} as const;
