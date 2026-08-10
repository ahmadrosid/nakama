export interface SoulStackFiles {
  examples?: string;
  instructions?: string;
  memory?: string;
  soul?: string;
  style?: string;
}

export interface LoadedSoulStack {
  directory: string;
  files: SoulStackFiles;
  loaded: string[];
}

export interface SoulFileStatus {
  examples: boolean;
  instructions: boolean;
  memory: boolean;
  soul: boolean;
  style: boolean;
}

export interface SoulStatus {
  active: boolean;
  directory: string;
  files: SoulFileStatus;
}

export interface InitSoulResult {
  created: string[];
  directory: string;
}
