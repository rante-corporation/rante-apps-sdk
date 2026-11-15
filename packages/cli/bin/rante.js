#!/usr/bin/env node
'use strict';

const { main } = require('../lib/cli');

process.exitCode = main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd()
});
