export interface SoulStackFiles {
  soul?: string;
  style?: string;
  skill?: string;
  memory?: string;
  examples?: string;
}

export interface LoadedSoulStack {
  directory: string;
  files: SoulStackFiles;
  loaded: string[];
}

export interface SoulFileStatus {
  soul: boolean;
  style: boolean;
  skill: boolean;
  memory: boolean;
  examples: boolean;
}

export interface SoulStatus {
  directory: string;
  active: boolean;
  files: SoulFileStatus;
}

export interface InitSoulResult {
  directory: string;
  created: string[];
}
