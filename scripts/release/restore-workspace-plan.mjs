#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { decodeWorkspacePlanOutput } from './workspace-release.mjs';

const target = process.argv[2];
const encoded = process.env.RELEASE_PLAN_GZIP_BASE64;
if (!target) throw new Error('restore-workspace-plan: a target path is required.');
if (!encoded) throw new Error('restore-workspace-plan: RELEASE_PLAN_GZIP_BASE64 is empty; the plan job output did not arrive.');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, decodeWorkspacePlanOutput(encoded));
