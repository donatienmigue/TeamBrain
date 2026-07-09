#!/usr/bin/env node
import { buildProgram } from './program.js';

// parseAsync: the init action is async; plain parse() would leave its
// promise dangling and turn any unexpected rejection into a crash.
await buildProgram().parseAsync();
