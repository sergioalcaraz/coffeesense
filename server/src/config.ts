import { getPathDepth, normalizeFileNameToFsPath, normalizeAbsolutePath } from './utils/paths';
import { findConfigFile } from './utils/workspace';

export interface LSPConfig {
  coffeesense: {
    ignoreProjectWarning: boolean;
    useWorkspaceDependencies: boolean;
    completion: {
      autoImport: boolean;
    };
    validation: {
      script: boolean;
    };
    languageFeatures: {
      codeActions: boolean;
      updateImportOnFileMove: boolean;
    };
    trace: {
      server: 'off' | 'messages' | 'verbose';
    };
    dev: {
      lspPath: string;
      lspPort: number;
      logLevel: 'INFO' | 'DEBUG';
    };
  };
}

export interface LSPFullConfig extends LSPConfig {
  emmet?: any;
  html?: any;
  css?: any;
  sass?: any;
  javascript?: any;
  typescript?: any;
  prettier?: any;
  stylusSupremacy?: any;
}

export function getDefaultLSPConfig(): LSPFullConfig {
  return {
    coffeesense: {
      ignoreProjectWarning: false,
      useWorkspaceDependencies: false,
      validation: {
        script: true
      },
      completion: {
        autoImport: false
      },
      languageFeatures: {
        codeActions: true,
        updateImportOnFileMove: true
      },
      trace: {
        server: 'off'
      },
      dev: {
        lspPath: '',
        lspPort: -1,
        logLevel: 'INFO'
      }
    },
    typescript: {
      tsdk: null
    }
  };
}

export interface CoffeeSenseProject {
  root: string;
  package?: string;
  tsconfig?: string;
}

export interface CoffeeSenseFullConfig {
  settings: Record<string, boolean | string | number>;
  projects: CoffeeSenseProject[];
}

export type CoffeeSenseConfig = Partial<Pick<CoffeeSenseFullConfig, 'settings'>> & {
  projects?: Array<string | (Pick<CoffeeSenseProject, 'root'> & Partial<CoffeeSenseProject>)>;
};

export async function getCoffeeSenseFullConfig(
  rootPathForConfig: string,
  workspacePath: string,
  coffeesenseConfig: CoffeeSenseConfig
): Promise<CoffeeSenseFullConfig> {
  const oldProjects = coffeesenseConfig.projects ?? [workspacePath];
  const projects = oldProjects
    .map(project => {
      const getFallbackPackagePath = (projectRoot: string) => {
        const fallbackPackage = findConfigFile(projectRoot, 'package.json');
        return fallbackPackage ? normalizeFileNameToFsPath(fallbackPackage) : undefined;
      };
      const getFallbackTsconfigPath = (projectRoot: string) => {
        const jsconfigPath = findConfigFile(projectRoot, 'jsconfig.json');
        const tsconfigPath = findConfigFile(projectRoot, 'tsconfig.json');
        if (jsconfigPath && tsconfigPath) {
          const tsconfigFsPath = normalizeFileNameToFsPath(tsconfigPath);
          const jsconfigFsPath = normalizeFileNameToFsPath(jsconfigPath);
          return getPathDepth(tsconfigPath, '/') >= getPathDepth(jsconfigFsPath, '/') ? tsconfigFsPath : jsconfigFsPath;
        }
        const configPath = tsconfigPath || jsconfigPath;
        return configPath ? normalizeFileNameToFsPath(configPath) : undefined;
      };

      if (typeof project === 'string') {
        const projectRoot = normalizeAbsolutePath(project, rootPathForConfig);

        return {
          root: projectRoot,
          package: getFallbackPackagePath(projectRoot),
          tsconfig: getFallbackTsconfigPath(projectRoot)
        } as CoffeeSenseProject;
      }

      const projectRoot = normalizeAbsolutePath(project.root, rootPathForConfig);
      return {
        root: projectRoot,
        package: project.package
          ? normalizeAbsolutePath(project.package, projectRoot)
          : getFallbackPackagePath(projectRoot),
        tsconfig: project.tsconfig
          ? normalizeAbsolutePath(project.tsconfig, projectRoot)
          : getFallbackTsconfigPath(projectRoot)
      } as CoffeeSenseProject;
    })
    .sort((a, b) => getPathDepth(b.root, '/') - getPathDepth(a.root, '/'));

  return {
    settings: coffeesenseConfig.settings ?? {},
    projects
  } as CoffeeSenseFullConfig;
}
