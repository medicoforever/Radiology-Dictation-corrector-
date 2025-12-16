
export enum AppStatus {
  Idle = 'idle',
  Recording = 'recording',
  Processing = 'processing',
  Success = 'success',
  Error = 'error',
}

export interface IdentifiedError {
  findingIndex: number;
  errorDescription: string;
  severity: 'WARNING' | 'INFO';
}