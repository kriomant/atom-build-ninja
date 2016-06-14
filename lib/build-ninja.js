'use babel';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import voucher from 'voucher';
import { EventEmitter } from 'events';

export const config = {
  ninjaCommand: {
    title: 'Ninja command',
    description: 'Command to execute Ninja, must be either absolute path or reachable using PATH environment variable',
    type: 'string',
    default: 'ninja',
    order: 1
  },
  subdirs: {
    title: 'Build directories',
    description: 'List of project subdirectories to search for build.ninja file',
    type: 'array',
    default: ['src/out/Debug'],
    items: { type: 'string' },
    order: 2
  },
  targetTypes: {
    title: 'Types of targets to list',
    description: 'List of target types to show. Leave empty to show all targets.',
    type: 'array',
    default: [],
    items: { type: 'string' },
    order: 3,
  },
  targetDepth: {
    title: 'Depth of target search',
    description: 'List targets reachable from root target with specified depth.',
    type: 'integer',
    default: 1,
    minimum: 1,
    order: 4,
  },
  ninjaOptions: {
    title: 'Ninja options',
    description: 'Additional Ninja options (separated by comma)',
    type: 'array',
    default: [],
    items: { type: 'string' },
    order: 5,
  }
};

export function provideBuilder() {
  const gccErrorMatch = '(?<file>([A-Za-z]:[\\/])?[^:\\n]+):(?<line>\\d+):(?<col>\\d+):\\s*(fatal error|error|warning):\\s*(?<message>.+)';
  const errorMatch = [ gccErrorMatch ];

  return class NinjaBuildProvider extends EventEmitter {
    constructor(cwd) {
      super();
      this.cwd = cwd;
      atom.config.observe('build-make.subdirs', () => this.emit('refresh'));
      atom.config.observe('build-make.ninjaCommand', () => this.emit('refresh'));
      atom.config.observe('build-make.ninjaOptions', () => this.emit('refresh'));
      atom.config.observe('build-make.targetTypes', () => this.emit('refresh'));
      atom.config.observe('build-make.targetDepth', () => this.emit('refresh'));
    }

    getNiceName() {
      return 'Ninja';
    }

    isEligible() {
      this.dirs = atom.config.get('build-ninja.subdirs')
        .filter(d => fs.existsSync(path.join(this.cwd, d, 'build.ninja')));
      return this.dirs.length > 0;
    }

    settings() {
      const ninjaOptions = atom.config.get('build-ninja.ninjaOptions');
      const targetTypes = atom.config.get('build-ninja.targetTypes');
      const targetDepth = atom.config.get('build-ninja.targetDepth');
      const addDirPrefix = this.dirs.length > 1;

      const promises = this.dirs.map(dir => {
        const buildDir = path.join(this.cwd, dir);
        const args = ['-C', buildDir, '-t', 'targets', 'depth', targetDepth];
        const ninjaCommand = atom.config.get('build-ninja.ninjaCommand');
        return voucher(execFile, ninjaCommand, args, { cwd: this.cwd }).then(output => {
          let targets = extractTargets(output);
          if (targetTypes.length != 0)
            targets = targets.filter(t => targetTypes.indexOf(t.type) != -1);
          return targets.map(target => createTargetConfig(this.cwd, dir, target.name, ninjaCommand, ninjaOptions, addDirPrefix));
        }, error => {
          atom.notifications.addError(
              'Failed to fetch Ninja targets',
              { detail: `Can\'t execute \`${ninjaCommand}\` in \`${buildDir}\` directory: ${error}` });
        });
      });
      return Promise.all(promises).then(lists => [].concat(...lists));
    }
  };
}

function extractTargets(output) {
  const lines = output.split(/\n/);
  let targets = [];
  for (line of lines) {
    const m = /^\s*(\w+): (\w+)$/.exec(line);
    if (m != null)
      targets.push({ name: m[1], type: m[2] });
  }
  return targets;
}

function createTargetConfig(projectDir, dir, targetName, ninjaCommand, ninjaOptions, addDirPrefix) {
  if (addDirPrefix)
    targetName = dir + ': ' + targetName;
  const buildDir = path.join(projectDir, dir);

  return {
    exec: ninjaCommand,
    args: ninjaOptions.concat([targetName]),
    cwd: buildDir,
    name: 'Ninja: ' + targetName,
    sh: false,
  };
}
