export interface StaticRoute {
  method: string;
  path: string;
  file: string;
  line: number;
  framework: string;
}

export interface StaticCommand {
  name: string;
  file: string;
  line: number;
  source: string;
}

export interface StaticEventHandler {
  event: string;
  file: string;
  line: number;
}

export interface StaticJob {
  name: string;
  file: string;
  line: number;
  schedule?: string;
}

export interface StaticAnalysisResult {
  routes: StaticRoute[];
  commands: StaticCommand[];
  eventHandlers: StaticEventHandler[];
  jobs: StaticJob[];
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
}

interface RepositoryFile {
  path: string;
  content: string;
}

function lineOfIndex(content: string, index: number) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function collectMatches(
  content: string,
  pattern: RegExp,
  callback: (match: RegExpExecArray, line: number) => void,
) {
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match = regex.exec(content);
  while (match) {
    callback(match, lineOfIndex(content, match.index));
    match = regex.exec(content);
  }
}

function parsePackageJson(file: RepositoryFile, result: StaticAnalysisResult) {
  try {
    const parsed = JSON.parse(file.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    result.dependencies = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    };
    result.scripts = parsed.scripts ?? {};

    for (const [name] of Object.entries(result.scripts)) {
      result.commands.push({
        name,
        file: file.path,
        line: 1,
        source: 'package.json script',
      });
    }
  } catch {
    // Invalid package.json files are ignored; the model can still inspect the raw text.
  }
}

function parseNextRoutePath(filePath: string) {
  const match = filePath.match(/(?:^|\/)(?:app|src\/app)\/(.*)\/route\.(?:ts|tsx|js|jsx)$/);
  if (!match) return null;

  const segments = match[1]
    .split('/')
    .filter((segment) => segment !== '(app)' && segment !== '(routes)');

  return `/${segments.join('/')}`.replace(/\/+/g, '/');
}

export function analyzeStaticFiles(files: RepositoryFile[]): StaticAnalysisResult {
  const result: StaticAnalysisResult = {
    routes: [],
    commands: [],
    eventHandlers: [],
    jobs: [],
    dependencies: {},
    scripts: {},
  };

  for (const file of files) {
    if (file.path.endsWith('package.json')) {
      parsePackageJson(file, result);
    }

    const nextRoutePath = parseNextRoutePath(file.path);
    if (nextRoutePath) {
      result.routes.push({
        method: 'route',
        path: nextRoutePath,
        file: file.path,
        line: 1,
        framework: 'Next.js App Router',
      });
    }

    collectMatches(
      file.content,
      /(?<![@A-Za-z0-9_])(?:app|router|server|api)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/,
      (match, line) => {
        result.routes.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: file.path,
          line,
          framework: 'Express-style route',
        });
      },
    );

    collectMatches(
      file.content,
      /@(?:app|router|api)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/,
      (match, line) => {
        result.routes.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: file.path,
          line,
          framework: 'Python web framework',
        });
      },
    );

    collectMatches(
      file.content,
      /(?:program|cli|command)\.command\(\s*['"`]([^'"`]+)['"`]/,
      (match, line) => {
        result.commands.push({
          name: match[1],
          file: file.path,
          line,
          source: 'Commander-style CLI',
        });
      },
    );

    collectMatches(
      file.content,
      /\.on\(\s*['"`]([^'"`]+)['"`]/,
      (match, line) => {
        result.eventHandlers.push({
          event: match[1],
          file: file.path,
          line,
        });
      },
    );

    collectMatches(
      file.content,
      /addEventListener\(\s*['"`]([^'"`]+)['"`]/,
      (match, line) => {
        result.eventHandlers.push({
          event: match[1],
          file: file.path,
          line,
        });
      },
    );

    collectMatches(
      file.content,
      /cron\.schedule\(\s*['"`]([^'"`]+)['"`]/,
      (match, line) => {
        result.jobs.push({
          name: 'cron job',
          file: file.path,
          line,
          schedule: match[1],
        });
      },
    );

    collectMatches(
      file.content,
      /setInterval\(/,
      (_match, line) => {
        result.jobs.push({
          name: 'interval job',
          file: file.path,
          line,
        });
      },
    );
  }

  return result;
}
