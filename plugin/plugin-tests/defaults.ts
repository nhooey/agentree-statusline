// The defaults file in the harness, which has no file system: its text as
// tools/gen-plugin-fixtures.ts carries it, read as the plugin reads it, and
// answered where the plugin looks for it, `$.plugin.root` + DEFAULTS_REL.
import { DEFAULTS_TEXT } from './fixtures.gen.ts'
import { DEFAULTS_REL, parseDefaults } from '../src/config.ts'

export { DEFAULTS_TEXT }

/** The shipped defaults, every option by name. */
export const DEFAULTS = parseDefaults(DEFAULTS_REL, DEFAULTS_TEXT)

/** Whether `path` is the defaults file the plugin reads, under its folder. */
export const isDefaults = (path: string): boolean =>
  path.endsWith('/' + DEFAULTS_REL)
